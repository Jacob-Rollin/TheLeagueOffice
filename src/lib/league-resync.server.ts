/**
 * Force-purge stale synced-league cache rows and re-ingest live host data.
 * Clears `league_transactions` + `weekly_matchups` for the active league FIRST,
 * then pulls authentic ESPN/Sleeper transactions and mBoxscore matchup points.
 */

export type ForceResyncInput = {
  connectionId: string;
  leagueId: string;
  platform: string;
  s2?: string | null | undefined;
  swid?: string | null | undefined;
  /** Inclusive week range to re-hydrate into weekly_matchups (defaults 1..current). */
  throughWeek?: number | undefined;
};

export type ForceResyncResult = {
  ok: boolean;
  clearedTransactions: number;
  clearedMatchups: number;
  insertedTransactions: number;
  insertedMatchups: number;
  weeksSynced: number[];
  error?: string;
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
    return String(Math.abs(asNum));
  }
  return asText;
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

async function resolveCurrentNflWeek(): Promise<number> {
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

/**
 * Wipe corrupted mock history for a synced league, then re-pull live
 * transactions + boxscore matchups from the host platform.
 */
export async function forceClearAndReSyncLeague(
  input: ForceResyncInput,
): Promise<ForceResyncResult> {
  const connectionId = String(input.connectionId ?? "").trim();
  const leagueId = String(input.leagueId ?? "").trim();
  const platform = String(input.platform ?? "espn").trim().toLowerCase();
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
      error: "Missing connection or league id.",
    };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;

  // ── 1) FORCED DELETE PASS — empty stale rows BEFORE any host API pull ────
  const { clearedTransactions, clearedMatchups } = await forceWipeLeagueCache(
    db,
    leagueId,
    connectionId,
  );

  const { loadConnectionTransactions, loadConnectionMatchups } = await import(
    "./league.server"
  );

  // ── 2) LIVE TRANSACTION INGEST ───────────────────────────────────────────
  const events = await loadConnectionTransactions(leagueId, platform, s2, swid);
  let insertedTransactions = 0;
  if (events.length) {
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
      console.warn("[forceClearAndReSyncLeague] transaction insert:", error.message);
    } else {
      insertedTransactions = data?.length ?? rows.length;
    }
  }

  // ── 3) LIVE MATCHUP / BOXSCORE INGEST ────────────────────────────────────
  const currentWeek = await resolveCurrentNflWeek();
  const throughWeek = Math.max(
    1,
    Math.min(
      18,
      Math.floor(Number(input.throughWeek ?? 0) || 0) || currentWeek,
    ),
  );
  const weeksSynced: number[] = [];
  let insertedMatchups = 0;

  for (let week = 1; week <= throughWeek; week++) {
    const board = await loadConnectionMatchups(
      leagueId,
      platform,
      week,
      s2,
      swid,
      connectionId,
    );
    if (!board?.entries?.length) continue;
    weeksSynced.push(week);

    const rows = board.entries.map((entry) => {
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
      console.warn(`[forceClearAndReSyncLeague] week ${week} insert:`, error.message);
    } else {
      insertedMatchups += data?.length ?? rows.length;
    }
  }

  return {
    ok: true,
    clearedTransactions,
    clearedMatchups,
    insertedTransactions,
    insertedMatchups,
    weeksSynced,
  };
}
