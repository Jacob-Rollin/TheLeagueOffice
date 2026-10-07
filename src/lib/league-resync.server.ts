/**
 * Synced-league cache: wipe/repair, delta sync, and Supabase read helpers.
 *
 * `weekly_matchups` + `league_transactions` are the durable cache so page loads
 * do not wait on Sleeper/ESPN. Live current-week scores still hit the host
 * (short TTL); past weeks prefer Supabase.
 */

import type { LeagueWeekMatchups, WeeklyMatchupEntry } from "./league.server";

export type ForceResyncInput = {
  connectionId: string;
  leagueId: string;
  platform: string;
  s2?: string | null | undefined;
  swid?: string | null | undefined;
  /** Inclusive week range to re-hydrate into weekly_matchups (defaults 1..current). */
  throughWeek?: number | undefined;
  /**
   * When true, also backfill any missing weeks 1..throughWeek (schedule holes)
   * in addition to refreshing current + prior. Used by the daily season-fill cron.
   */
  fillSeason?: boolean | undefined;
};

export type ForceResyncResult = {
  ok: boolean;
  clearedTransactions: number;
  clearedMatchups: number;
  insertedTransactions: number;
  insertedMatchups: number;
  weeksSynced: number[];
  error?: string;
  mode?: "full" | "delta";
};

type MatchupCacheRow = {
  roster_id: number;
  matchup_id: number | null;
  points: number;
  projected_points: number;
  team_name: string | null;
  owner_name: string | null;
  starters: string[] | null;
  player_points: Record<string, number> | null;
  platform: string | null;
};

function roundPoints(value: number): number {
  return Number((Number(value) || 0).toFixed(2));
}

function sanitizeStoredPlayerId(raw: string | number | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "";
  const asText = String(raw).trim();
  // Preserve name-index keys written by the boxscore ingest (`n:ceeedeelamb`).
  if (asText.startsWith("n:")) return asText;
  const asNum = Number(asText);
  if (Number.isFinite(asNum) && /^-?\d+(\.\d+)?$/.test(asText)) {
    const truncated = Math.trunc(asNum);
    const abs = Math.abs(truncated);
    // Keep ESPN D/ST negatives so they don't collide with athlete espn_ids.
    if (truncated < 0 && abs >= 16001 && abs <= 16034) return String(truncated);
    return String(abs);
  }
  return asText;
}

function stampWinProbabilities(entries: WeeklyMatchupEntry[]): void {
  const byMatchup = new Map<number, WeeklyMatchupEntry[]>();
  for (const entry of entries) {
    if (entry.matchupId == null) continue;
    const bucket = byMatchup.get(entry.matchupId) ?? [];
    bucket.push(entry);
    byMatchup.set(entry.matchupId, bucket);
  }
  for (const pair of byMatchup.values()) {
    if (pair.length !== 2) continue;
    const [a, b] = pair;
    if (!a || !b) continue;
    const mine = a.projectedPoints;
    const opp = b.projectedPoints;
    const total = Math.abs(mine) + Math.abs(opp);
    if (total <= 0) {
      a.winProbabilityPct = 50;
      b.winProbabilityPct = 50;
      continue;
    }
    // Lightweight provider-style split from projected totals (mirrors server stamp).
    const pct = Math.max(1, Math.min(99, Math.round((mine / (mine + opp || 1)) * 100)));
    a.winProbabilityPct = pct;
    b.winProbabilityPct = 100 - pct;
  }
}

/** Reconstruct a week board from durable `weekly_matchups` rows. */
export function matchupsFromCacheRows(
  week: number,
  rows: MatchupCacheRow[],
): LeagueWeekMatchups | null {
  if (!rows.length) return null;
  const platform = String(rows[0]?.platform ?? "sleeper")
    .trim()
    .toLowerCase();
  const source = platform === "espn" ? "espn" : platform === "yahoo" ? "yahoo" : "sleeper";

  const entries: WeeklyMatchupEntry[] = rows.map((row) => {
    const starters = (row.starters ?? []).map((id) => sanitizeStoredPlayerId(id));
    const playerPoints: Record<string, number> = {};
    for (const [rawId, pts] of Object.entries(row.player_points ?? {})) {
      const key = sanitizeStoredPlayerId(rawId);
      if (!key) continue;
      playerPoints[key] = roundPoints(Number(pts) || 0);
    }
    const playerIdSet = new Set<string>([
      ...starters.filter(Boolean),
      ...Object.keys(playerPoints),
    ]);
    return {
      rosterId: Number(row.roster_id),
      matchupId: row.matchup_id == null ? null : Number(row.matchup_id),
      points: roundPoints(Number(row.points) || 0),
      projectedPoints: roundPoints(Number(row.projected_points) || 0),
      winProbabilityPct: null,
      teamName: row.team_name?.trim() || `Team ${row.roster_id}`,
      owner: row.owner_name?.trim() || "",
      logo: null,
      starters,
      playerIds: [...playerIdSet],
      irIds: [],
      playerPoints,
    };
  });

  stampWinProbabilities(entries);
  return { week, entries, source };
}

/** Read a past (or any) week from Supabase cache. Returns null on miss. */
export async function loadCachedWeekMatchups(
  leagueId: string,
  week: number,
  connectionId?: string | null,
): Promise<LeagueWeekMatchups | null> {
  const cleanLeague = leagueId.trim();
  const safeWeek = Math.max(1, Math.floor(Number(week) || 1));
  if (!cleanLeague) return null;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    let query = db
      .from("weekly_matchups")
      .select(
        "roster_id, matchup_id, points, projected_points, team_name, owner_name, starters, player_points, platform",
      )
      .eq("league_id", cleanLeague)
      .eq("week", safeWeek);

    const conn = connectionId?.trim();
    if (conn) query = query.eq("connection_id", conn);

    const { data, error } = await query;
    if (error || !Array.isArray(data) || !data.length) return null;
    return matchupsFromCacheRows(safeWeek, data as MatchupCacheRow[]);
  } catch {
    return null;
  }
}

export type TidbWeekMatchupsHit = {
  board: LeagueWeekMatchups;
  /** Newest synced_at among rows (ms epoch), or 0. */
  syncedAtMs: number;
};

/** Coalesce concurrent matchup polls in one Fluid isolate onto one TiDB SELECT. */
const TIDB_MATCHUP_READ_TTL_MS = 20 * 1000;
const tidbMatchupReadMemo = new Map<
  string,
  { at: number; value: Promise<TidbWeekMatchupsHit | null> }
>();

/** Read a week board from TiDB `synced_matchups` (delta-sync / persist dual-write). */
export async function loadTidbWeekMatchups(
  leagueId: string,
  week: number,
  connectionId?: string | null,
): Promise<TidbWeekMatchupsHit | null> {
  const cleanLeague = leagueId.trim().slice(0, 64);
  const safeWeek = Math.max(1, Math.floor(Number(week) || 1));
  if (!cleanLeague) return null;
  const conn = connectionId?.trim().slice(0, 64) ?? "";
  const memoKey = `${cleanLeague}|${safeWeek}|${conn}`;
  const hit = tidbMatchupReadMemo.get(memoKey);
  if (hit && Date.now() - hit.at < TIDB_MATCHUP_READ_TTL_MS) return hit.value;

  const value = (async (): Promise<TidbWeekMatchupsHit | null> => {
    try {
      const { tidbConfigured, tidbExecute } = await import("@/lib/tidb");
      if (!tidbConfigured()) return null;

      const params: unknown[] = [cleanLeague, safeWeek];
      let connClause = "";
      if (conn) {
        connClause = "AND (connection_id = ? OR connection_id IS NULL)";
        params.push(conn);
      }

      const rows = await tidbExecute<{
        team_id: number;
        matchup_id: number | null;
        roster_points: number;
        projected_points: number;
        team_name: string | null;
        owner_name: string | null;
        starters: unknown;
        player_points: unknown;
        platform: string | null;
        synced_at: string | Date | null;
      }>(
        `SELECT team_id, matchup_id, roster_points, projected_points, team_name, owner_name,
                starters, player_points, platform, synced_at
         FROM synced_matchups
         WHERE league_id = ? AND week = ? ${connClause}
         ORDER BY team_id ASC
         LIMIT 64`,
        params,
      );
      if (!rows.length) return null;

      const parseJson = <T,>(raw: unknown, fallback: T): T => {
        if (raw == null) return fallback;
        if (typeof raw === "string") {
          try {
            return JSON.parse(raw) as T;
          } catch {
            return fallback;
          }
        }
        return raw as T;
      };

      let syncedAtMs = 0;
      const cacheRows: MatchupCacheRow[] = rows.map((r) => {
        const at = r.synced_at ? Date.parse(String(r.synced_at)) : 0;
        if (Number.isFinite(at)) syncedAtMs = Math.max(syncedAtMs, at);
        return {
          roster_id: Number(r.team_id),
          matchup_id: r.matchup_id == null ? null : Number(r.matchup_id),
          points: Number(r.roster_points) || 0,
          projected_points: Number(r.projected_points) || 0,
          team_name: r.team_name,
          owner_name: r.owner_name,
          starters: parseJson<string[]>(r.starters, []),
          player_points: parseJson<Record<string, number>>(r.player_points, {}),
          platform: r.platform,
        };
      });

      const board = matchupsFromCacheRows(safeWeek, cacheRows);
      if (!board) return null;
      return { board, syncedAtMs };
    } catch {
      return null;
    }
  })();

  tidbMatchupReadMemo.set(memoKey, { at: Date.now(), value });
  return value;
}

/**
 * Cap dual-writes when many viewers miss the TiDB freshness window together.
 * 60s still lets live boards refresh every minute without N viewers each writing.
 */
const PERSIST_MIN_INTERVAL_MS = 60 * 1000;
const lastPersistAt = new Map<string, number>();

/** Upsert one week's host board into `weekly_matchups` (fire-and-forget safe). */
export async function persistWeekMatchups(input: {
  leagueId: string;
  connectionId?: string | null;
  platform: string;
  board: LeagueWeekMatchups;
}): Promise<number> {
  const leagueId = input.leagueId.trim();
  const connectionId = input.connectionId?.trim() || null;
  const platform = input.platform.trim().toLowerCase() || "sleeper";
  const week = input.board.week;
  if (!leagueId || !input.board.entries.length) return 0;

  const persistKey = `${leagueId}|${week}`;
  const now = Date.now();
  const prev = lastPersistAt.get(persistKey) ?? 0;
  if (now - prev < PERSIST_MIN_INTERVAL_MS) return 0;
  lastPersistAt.set(persistKey, now);
  // Drop stale in-process reads so the next poll can see the upsert.
  for (const key of tidbMatchupReadMemo.keys()) {
    if (key.startsWith(`${persistKey}|`)) tidbMatchupReadMemo.delete(key);
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const rows = input.board.entries.map((entry) => {
      const playerPoints: Record<string, number> = {};
      for (const [rawId, pts] of Object.entries(entry.playerPoints ?? {})) {
        const key = sanitizeStoredPlayerId(rawId);
        if (!key) continue;
        playerPoints[key] = roundPoints(Number(pts) || 0);
      }
      const starters = (entry.starters ?? [])
        .map((id) => sanitizeStoredPlayerId(id))
        .filter(Boolean);

      return {
        league_id: leagueId,
        connection_id: connectionId,
        platform,
        week,
        roster_id: entry.rosterId,
        matchup_id: entry.matchupId,
        points: roundPoints(entry.points),
        projected_points: roundPoints(entry.projectedPoints),
        team_name: entry.teamName,
        owner_name: entry.owner,
        starters,
        player_points: playerPoints,
      };
    });

    const { error, data } = await db
      .from("weekly_matchups")
      .upsert(rows, { onConflict: "league_id,week,roster_id" })
      .select("id");
    if (error) {
      console.warn(`[persistWeekMatchups] week ${week}:`, error.message);
      return 0;
    }

    // Dual-write TiDB synced_matchups (batch ON DUPLICATE KEY UPDATE).
    void import("@/lib/tidb-sync.server")
      .then(({ upsertSyncedMatchups }) =>
        upsertSyncedMatchups(
          rows.map((r: {
            league_id: string;
            connection_id: string | null;
            platform: string;
            week: number;
            roster_id: number;
            matchup_id: number | null;
            points: number;
            projected_points: number;
            team_name: string | null;
            owner_name: string | null;
            starters: string[];
            player_points: Record<string, number>;
          }) => ({
            league_id: r.league_id,
            connection_id: r.connection_id,
            platform: r.platform,
            week: r.week,
            team_id: r.roster_id,
            matchup_id: r.matchup_id,
            roster_points: r.points,
            projected_points: r.projected_points,
            team_name: r.team_name,
            owner_name: r.owner_name,
            starters: r.starters,
            player_points: r.player_points,
          })),
        ),
      )
      .catch((err) => console.warn("[persistWeekMatchups] TiDB:", err));

    return data?.length ?? rows.length;
  } catch (err) {
    console.warn("[persistWeekMatchups] failed:", err);
    return 0;
  }
}

/**
 * Forced wipe: empty every row for this league_id (and connection_id) before
 * any ESPN / Sleeper ingest runs.
 */
async function forceWipeLeagueCache(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  leagueId: string,
  connectionId: string,
): Promise<{ clearedTransactions: number; clearedMatchups: number }> {
  let clearedTransactions = 0;
  let clearedMatchups = 0;

  for (const table of ["league_transactions", "weekly_matchups"] as const) {
    let wiped = 0;
    try {
      const { data: byLeague, error: errLeague } = await db
        .from(table)
        .delete()
        .eq("league_id", leagueId)
        .select("id");
      if (!errLeague) wiped += byLeague?.length ?? 0;
    } catch {
      /* table may not exist yet */
    }
    try {
      const { data: byConn, error: errConn } = await db
        .from(table)
        .delete()
        .eq("connection_id", connectionId)
        .select("id");
      if (!errConn) wiped += byConn?.length ?? 0;
    } catch {
      /* table may not exist yet */
    }
    if (table === "league_transactions") clearedTransactions = wiped;
    else clearedMatchups = wiped;
  }

  return { clearedTransactions, clearedMatchups };
}

export async function resolveCurrentNflWeek(): Promise<number> {
  try {
    const res = await fetch("https://api.sleeper.app/v1/state/nfl", {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return 1;
    const json = (await res.json()) as { week?: number };
    return Math.max(1, Math.min(18, Number(json?.week ?? 1) || 1));
  } catch {
    return 1;
  }
}

async function countCachedMatchups(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  leagueId: string,
  connectionId: string,
): Promise<number> {
  try {
    const { count, error } = await db
      .from("weekly_matchups")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .eq("connection_id", connectionId);
    if (error) return 0;
    return Number(count ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Distinct weeks already present in the durable matchup cache. */
async function listCachedMatchupWeeks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  leagueId: string,
  connectionId: string,
): Promise<Set<number>> {
  const out = new Set<number>();
  try {
    const { data, error } = await db
      .from("weekly_matchups")
      .select("week")
      .eq("league_id", leagueId)
      .eq("connection_id", connectionId)
      .limit(500);
    if (error || !Array.isArray(data)) return out;
    for (const row of data) {
      const w = Math.floor(Number((row as { week?: number }).week) || 0);
      if (w >= 1 && w <= 18) out.add(w);
    }
  } catch {
    /* ignore */
  }
  // TiDB may be ahead of Supabase on some deploys — merge distinct weeks.
  try {
    const { tidbConfigured, tidbExecute } = await import("@/lib/tidb");
    if (!tidbConfigured()) return out;
    const rows = await tidbExecute<{ week: number }>(
      `SELECT DISTINCT week FROM synced_matchups
       WHERE league_id = ? AND (connection_id = ? OR connection_id IS NULL)
       LIMIT 32`,
      [leagueId, connectionId],
    );
    for (const row of rows) {
      const w = Math.floor(Number(row.week) || 0);
      if (w >= 1 && w <= 18) out.add(w);
    }
  } catch {
    /* ignore */
  }
  return out;
}

async function ingestTransactions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  leagueId: string,
  connectionId: string,
  platform: string,
  s2: string | null,
  swid: string | null,
  opts: { replaceExisting: boolean },
): Promise<number> {
  const { loadConnectionTransactions } = await import("./league.server");
  const events = await loadConnectionTransactions(leagueId, platform, s2, swid);
  if (!events.length) return 0;

  if (opts.replaceExisting) {
    try {
      await db.from("league_transactions").delete().eq("league_id", leagueId);
      await db.from("league_transactions").delete().eq("connection_id", connectionId);
    } catch {
      /* ignore */
    }
  }

  const rows = events.map((event) => ({
    league_id: leagueId,
    connection_id: connectionId,
    platform,
    event_id: event.id,
    event_at: new Date(event.at).toISOString(),
    kind: event.kind,
    team_name: event.teamName,
    payload: {
      text: event.text,
      moves: (event.moves ?? []).map((m) => ({
        ...m,
        playerId: sanitizeStoredPlayerId(m.playerId) || m.playerId,
      })),
    },
  }));
  const { error, data } = await db.from("league_transactions").insert(rows).select("id");
  if (error) {
    console.warn("[ingestTransactions]:", error.message);
    return 0;
  }
  return data?.length ?? rows.length;
}

async function ingestMatchupWeeks(
  leagueId: string,
  connectionId: string,
  platform: string,
  s2: string | null,
  swid: string | null,
  weeks: number[],
): Promise<{ insertedMatchups: number; weeksSynced: number[] }> {
  const { loadConnectionMatchups } = await import("./league.server");
  const weeksSynced: number[] = [];
  let insertedMatchups = 0;

  for (const week of weeks) {
    // Bypass cache-first for the weeks we are actively refreshing by fetching
    // through loadConnectionMatchups — past weeks may short-circuit to DB, so
    // for explicit ingest we call fetch via a force path: pass no connection
    // preference... Actually loadConnectionMatchups will prefer DB for past
    // weeks. For sync we need upstream. Use persist after a forced upstream
    // read by temporarily skipping cache — handled via `preferCache: false`
    // option on loadConnectionMatchups.
    const board = await loadConnectionMatchups(leagueId, platform, week, s2, swid, connectionId, {
      preferCache: false,
      persist: true,
    });
    if (!board?.entries?.length) continue;
    weeksSynced.push(week);
    insertedMatchups += board.entries.length;
  }

  return { insertedMatchups, weeksSynced };
}

/**
 * Wipe corrupted mock history for a synced league, then re-pull live
 * transactions + boxscore matchups from the host platform.
 * Keep for explicit "Repair sync" — not for routine page loads.
 */
export async function forceClearAndReSyncLeague(
  input: ForceResyncInput,
): Promise<ForceResyncResult> {
  const connectionId = String(input.connectionId ?? "").trim();
  const leagueId = String(input.leagueId ?? "").trim();
  const platform = String(input.platform ?? "espn")
    .trim()
    .toLowerCase();
  const s2 = input.s2 ?? null;
  const swid = input.swid ?? null;

  if (!connectionId || !leagueId) {
    return {
      ok: false,
      clearedTransactions: 0,
      clearedMatchups: 0,
      insertedTransactions: 0,
      insertedMatchups: 0,
      weeksSynced: [],
      mode: "full",
      error: "Missing connection or league id.",
    };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;

  const { clearedTransactions, clearedMatchups } = await forceWipeLeagueCache(
    db,
    leagueId,
    connectionId,
  );

  const insertedTransactions = await ingestTransactions(
    db,
    leagueId,
    connectionId,
    platform,
    s2,
    swid,
    { replaceExisting: false },
  );

  const currentWeek = await resolveCurrentNflWeek();
  const throughWeek = Math.max(
    1,
    Math.min(18, Math.floor(Number(input.throughWeek ?? 0) || 0) || currentWeek),
  );
  const weeks = Array.from({ length: throughWeek }, (_, i) => i + 1);
  const { insertedMatchups, weeksSynced } = await ingestMatchupWeeks(
    leagueId,
    connectionId,
    platform,
    s2,
    swid,
    weeks,
  );

  return {
    ok: true,
    clearedTransactions,
    clearedMatchups,
    insertedTransactions,
    insertedMatchups,
    weeksSynced,
    mode: "full",
  };
}

/**
 * Lightweight sync for routine page loads / cron:
 * - If cache is empty → full backfill (no wipe needed)
 * - Else → upsert current + previous week, refresh transactions
 * - Optional fillSeason → also ingest any missing weeks 1..throughWeek
 */
export async function deltaSyncLeague(input: ForceResyncInput): Promise<ForceResyncResult> {
  const connectionId = String(input.connectionId ?? "").trim();
  const leagueId = String(input.leagueId ?? "").trim();
  const platform = String(input.platform ?? "espn")
    .trim()
    .toLowerCase();
  const s2 = input.s2 ?? null;
  const swid = input.swid ?? null;
  const fillSeason = Boolean(input.fillSeason);

  if (!connectionId || !leagueId) {
    return {
      ok: false,
      clearedTransactions: 0,
      clearedMatchups: 0,
      insertedTransactions: 0,
      insertedMatchups: 0,
      weeksSynced: [],
      mode: "delta",
      error: "Missing connection or league id.",
    };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;

  const cachedCount = await countCachedMatchups(db, leagueId, connectionId);
  if (cachedCount <= 0) {
    // First sync: backfill without a wipe (nothing durable yet).
    const currentWeek = await resolveCurrentNflWeek();
    const throughWeek = Math.max(
      1,
      Math.min(18, Math.floor(Number(input.throughWeek ?? 0) || 0) || Math.max(currentWeek, 17)),
    );
    const insertedTransactions = await ingestTransactions(
      db,
      leagueId,
      connectionId,
      platform,
      s2,
      swid,
      { replaceExisting: false },
    );
    const weeks = Array.from({ length: throughWeek }, (_, i) => i + 1);
    const { insertedMatchups, weeksSynced } = await ingestMatchupWeeks(
      leagueId,
      connectionId,
      platform,
      s2,
      swid,
      weeks,
    );
    return {
      ok: true,
      clearedTransactions: 0,
      clearedMatchups: 0,
      insertedTransactions,
      insertedMatchups,
      weeksSynced,
      mode: "full",
    };
  }

  const currentWeek = await resolveCurrentNflWeek();
  // Always re-pull current + prior. Prior week is soft-final through Tuesday
  // morning — ingest uses preferCache:false so midweek scores are replaced.
  const weeks = new Set<number>([currentWeek, Math.max(1, currentWeek - 1)]);

  if (fillSeason) {
    const throughWeek = Math.max(
      1,
      Math.min(18, Math.floor(Number(input.throughWeek ?? 0) || 0) || Math.max(currentWeek, 17)),
    );
    const present = await listCachedMatchupWeeks(db, leagueId, connectionId);
    for (let w = 1; w <= throughWeek; w += 1) {
      if (!present.has(w)) weeks.add(w);
    }
  }

  const weekList = [...weeks].sort((a, b) => a - b);

  const insertedTransactions = await ingestTransactions(
    db,
    leagueId,
    connectionId,
    platform,
    s2,
    swid,
    { replaceExisting: true },
  );
  const { insertedMatchups, weeksSynced } = await ingestMatchupWeeks(
    leagueId,
    connectionId,
    platform,
    s2,
    swid,
    weekList,
  );

  return {
    ok: true,
    clearedTransactions: 0,
    clearedMatchups: 0,
    insertedTransactions,
    insertedMatchups,
    weeksSynced,
    mode: fillSeason ? "full" : "delta",
  };
}

export type DeltaSyncAllOptions = {
  limit?: number;
  /** Backfill missing weeks 1..17 for each league. */
  fillSeason?: boolean;
  /** Prefer recently touched leagues (gameday). Default rotates oldest-first. */
  recentFirst?: boolean;
  /** Only Sleeper connections (skip ESPN credential work on free warm passes). */
  sleeperOnly?: boolean;
};

/** Cron helper: delta-sync synced_leagues rows (service role). */
export async function deltaSyncAllConnections(
  limitOrOpts: number | DeltaSyncAllOptions = 50,
): Promise<{
  ok: boolean;
  processed: number;
  fillSeason: boolean;
  results: { id: string; ok: boolean; mode?: string; error?: string; weeks?: number[] }[];
}> {
  const opts: DeltaSyncAllOptions =
    typeof limitOrOpts === "number" ? { limit: limitOrOpts } : (limitOrOpts ?? {});
  const limit = Math.max(1, Math.min(200, Math.floor(Number(opts.limit ?? 50)) || 50));
  const fillSeason = Boolean(opts.fillSeason);
  const recentFirst = Boolean(opts.recentFirst);
  const sleeperOnly = Boolean(opts.sleeperOnly);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  let query = db
    .from("synced_leagues")
    .select("id, league_id, platform, espn_s2, swid, updated_at")
    .order("updated_at", { ascending: !recentFirst })
    .limit(limit);
  if (sleeperOnly) {
    query = query.eq("platform", "sleeper");
  }
  const { data, error } = await query;

  if (error || !Array.isArray(data)) {
    return {
      ok: false,
      processed: 0,
      fillSeason,
      results: [{ id: "-", ok: false, error: error?.message }],
    };
  }

  const results: { id: string; ok: boolean; mode?: string; error?: string; weeks?: number[] }[] =
    [];
  for (const row of data) {
    const result = await deltaSyncLeague({
      connectionId: String(row.id),
      leagueId: String(row.league_id),
      platform: String(row.platform ?? "sleeper"),
      s2: row.espn_s2 ?? null,
      swid: row.swid ?? null,
      fillSeason,
      ...(fillSeason ? { throughWeek: 17 } : {}),
    });
    results.push({
      id: String(row.id),
      ok: result.ok,
      ...(result.mode ? { mode: result.mode } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.weeksSynced?.length ? { weeks: result.weeksSynced } : {}),
    });
    // Touch updated_at so the next cron pass rotates fairly.
    try {
      await db
        .from("synced_leagues")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", row.id);
    } catch {
      /* ignore */
    }
  }

  return { ok: true, processed: results.length, fillSeason, results };
}

/** Active Sleeper league ids for planning-snap / CDN warm jobs. */
export async function listActiveSleeperLeagueIds(limit = 40): Promise<
  { connectionId: string; leagueId: string }[]
> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("synced_leagues")
    .select("id, league_id, platform, updated_at")
    .eq("platform", "sleeper")
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));
  if (error || !Array.isArray(data)) return [];
  return data
    .map((row: { id?: string; league_id?: string }) => ({
      connectionId: String(row.id ?? ""),
      leagueId: String(row.league_id ?? "").trim(),
    }))
    .filter((r: { leagueId: string }) => /^\d{6,}$/.test(r.leagueId));
}
