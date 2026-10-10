/**
 * Batch upsert helpers for synced league snapshots into TiDB.
 *
 * RU guard: skip full JSON rewrites when fingerprint matches the existing row.
 * Unchanged rows only get a cheap `synced_at` bump so freshness gates stay valid
 * without paying write RUs for identical starters/player_points payloads.
 */
import { chunkRows, tidbConfigured, tidbExecute } from "@/lib/tidb";

export type TidbRosterUpsert = {
  league_id: string;
  team_id: number;
  owner_name?: string | null;
  players?: unknown;
  starters?: unknown;
  bench?: unknown;
};

export type TidbMatchupUpsert = {
  league_id: string;
  connection_id?: string | null;
  platform?: string;
  week: number;
  team_id: number;
  matchup_id?: number | null;
  roster_points?: number;
  projected_points?: number;
  opponent_team_id?: number | null;
  team_name?: string | null;
  owner_name?: string | null;
  starters?: unknown;
  player_points?: unknown;
};

/** Stable JSON for content compares (sorted keys, rounded numbers). */
function normalizeForFingerprint(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalizeForFingerprint);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = normalizeForFingerprint(obj[key]);
    }
    return out;
  }
  return String(value);
}

function fingerprint(value: unknown): string {
  return JSON.stringify(normalizeForFingerprint(value));
}

function parseJsonColumn(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

function rosterFingerprint(r: {
  owner_name?: string | null;
  players?: unknown;
  starters?: unknown;
  bench?: unknown;
}): string {
  return fingerprint({
    owner_name: r.owner_name ?? null,
    players: r.players ?? [],
    starters: r.starters ?? [],
    bench: r.bench ?? [],
  });
}

function matchupFingerprint(r: {
  connection_id?: string | null;
  platform?: string | null;
  matchup_id?: number | null;
  roster_points?: number | null;
  projected_points?: number | null;
  opponent_team_id?: number | null;
  team_name?: string | null;
  owner_name?: string | null;
  starters?: unknown;
  player_points?: unknown;
}): string {
  return fingerprint({
    connection_id: r.connection_id ?? null,
    platform: r.platform ?? "espn",
    matchup_id: r.matchup_id ?? null,
    roster_points: r.roster_points ?? 0,
    projected_points: r.projected_points ?? 0,
    opponent_team_id: r.opponent_team_id ?? null,
    team_name: r.team_name ?? null,
    owner_name: r.owner_name ?? null,
    starters: r.starters ?? [],
    player_points: r.player_points ?? {},
  });
}

async function touchRosterSyncedAt(
  keys: Array<{ league_id: string; team_id: number }>,
): Promise<void> {
  if (keys.length === 0) return;
  // Group by league to keep IN lists small.
  const byLeague = new Map<string, number[]>();
  for (const k of keys) {
    const list = byLeague.get(k.league_id) ?? [];
    list.push(k.team_id);
    byLeague.set(k.league_id, list);
  }
  for (const [leagueId, teamIds] of byLeague) {
    const unique = [...new Set(teamIds.filter((id) => Number.isFinite(id)))];
    for (const chunk of chunkRows(unique, 64)) {
      const placeholders = chunk.map(() => "?").join(", ");
      await tidbExecute(
        `UPDATE synced_rosters SET synced_at = CURRENT_TIMESTAMP
         WHERE league_id = ? AND team_id IN (${placeholders})`,
        [leagueId, ...chunk],
      );
    }
  }
}

async function touchMatchupSyncedAt(
  keys: Array<{ league_id: string; week: number; team_id: number }>,
): Promise<void> {
  if (keys.length === 0) return;
  const byLeagueWeek = new Map<string, { league_id: string; week: number; team_ids: number[] }>();
  for (const k of keys) {
    const mk = `${k.league_id}|${k.week}`;
    const hit = byLeagueWeek.get(mk);
    if (hit) hit.team_ids.push(k.team_id);
    else byLeagueWeek.set(mk, { league_id: k.league_id, week: k.week, team_ids: [k.team_id] });
  }
  for (const group of byLeagueWeek.values()) {
    const unique = [...new Set(group.team_ids.filter((id) => Number.isFinite(id)))];
    for (const chunk of chunkRows(unique, 64)) {
      const placeholders = chunk.map(() => "?").join(", ");
      await tidbExecute(
        `UPDATE synced_matchups SET synced_at = CURRENT_TIMESTAMP
         WHERE league_id = ? AND week = ? AND team_id IN (${placeholders})`,
        [group.league_id, group.week, ...chunk],
      );
    }
  }
}

export async function upsertSyncedRosters(rows: TidbRosterUpsert[]): Promise<number> {
  if (!tidbConfigured() || rows.length === 0) return 0;

  const leagueIds = [...new Set(rows.map((r) => r.league_id).filter(Boolean))];
  const existing = new Map<string, string>();
  for (const leagueId of leagueIds) {
    const prior = await tidbExecute<{
      league_id: string;
      team_id: number;
      owner_name: string | null;
      players: unknown;
      starters: unknown;
      bench: unknown;
    }>(
      `SELECT league_id, team_id, owner_name, players, starters, bench
       FROM synced_rosters WHERE league_id = ? LIMIT 64`,
      [leagueId],
    );
    for (const row of prior) {
      existing.set(
        `${row.league_id}|${row.team_id}`,
        rosterFingerprint({
          owner_name: row.owner_name,
          players: parseJsonColumn(row.players) ?? [],
          starters: parseJsonColumn(row.starters) ?? [],
          bench: parseJsonColumn(row.bench) ?? [],
        }),
      );
    }
  }

  const changed: TidbRosterUpsert[] = [];
  const unchangedKeys: Array<{ league_id: string; team_id: number }> = [];
  for (const r of rows) {
    const key = `${r.league_id}|${r.team_id}`;
    const next = rosterFingerprint(r);
    if (existing.has(key) && existing.get(key) === next) {
      unchangedKeys.push({ league_id: r.league_id, team_id: r.team_id });
    } else {
      changed.push(r);
    }
  }

  if (unchangedKeys.length) {
    await touchRosterSyncedAt(unchangedKeys).catch(() => undefined);
  }

  if (changed.length === 0) return 0;

  const cols = ["league_id", "team_id", "owner_name", "players", "starters", "bench"];
  let written = 0;
  for (const chunk of chunkRows(changed, 100)) {
    const flat: unknown[] = [];
    for (const r of chunk) {
      flat.push(
        r.league_id,
        r.team_id,
        r.owner_name ?? null,
        JSON.stringify(r.players ?? []),
        JSON.stringify(r.starters ?? []),
        JSON.stringify(r.bench ?? []),
      );
    }
    const placeholders = Array.from(
      { length: chunk.length },
      () => `(${cols.map(() => "?").join(", ")})`,
    ).join(", ");
    const sql = `INSERT INTO synced_rosters (${cols.join(", ")}) VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        owner_name=VALUES(owner_name),
        players=VALUES(players),
        starters=VALUES(starters),
        bench=VALUES(bench),
        synced_at=CURRENT_TIMESTAMP`;
    await tidbExecute(sql, flat);
    written += chunk.length;
  }
  return written;
}

export async function upsertSyncedMatchups(rows: TidbMatchupUpsert[]): Promise<number> {
  if (!tidbConfigured() || rows.length === 0) return 0;

  // Load existing rows per league+week present in the batch.
  const leagueWeeks = new Map<string, { league_id: string; week: number }>();
  for (const r of rows) {
    const week = Math.max(1, Math.floor(Number(r.week) || 1));
    leagueWeeks.set(`${r.league_id}|${week}`, { league_id: r.league_id, week });
  }

  const existing = new Map<string, string>();
  for (const { league_id, week } of leagueWeeks.values()) {
    const prior = await tidbExecute<{
      league_id: string;
      week: number;
      team_id: number;
      connection_id: string | null;
      platform: string | null;
      matchup_id: number | null;
      roster_points: number | null;
      projected_points: number | null;
      opponent_team_id: number | null;
      team_name: string | null;
      owner_name: string | null;
      starters: unknown;
      player_points: unknown;
    }>(
      `SELECT league_id, week, team_id, connection_id, platform, matchup_id,
              roster_points, projected_points, opponent_team_id, team_name, owner_name,
              starters, player_points
       FROM synced_matchups
       WHERE league_id = ? AND week = ?
       LIMIT 64`,
      [league_id, week],
    );
    for (const row of prior) {
      existing.set(
        `${row.league_id}|${row.week}|${row.team_id}`,
        matchupFingerprint({
          connection_id: row.connection_id,
          platform: row.platform,
          matchup_id: row.matchup_id,
          roster_points: Number(row.roster_points) || 0,
          projected_points: Number(row.projected_points) || 0,
          opponent_team_id: row.opponent_team_id,
          team_name: row.team_name,
          owner_name: row.owner_name,
          starters: parseJsonColumn(row.starters) ?? [],
          player_points: parseJsonColumn(row.player_points) ?? {},
        }),
      );
    }
  }

  const changed: TidbMatchupUpsert[] = [];
  const unchangedKeys: Array<{ league_id: string; week: number; team_id: number }> = [];
  for (const r of rows) {
    const week = Math.max(1, Math.floor(Number(r.week) || 1));
    const key = `${r.league_id}|${week}|${r.team_id}`;
    const next = matchupFingerprint(r);
    if (existing.has(key) && existing.get(key) === next) {
      unchangedKeys.push({ league_id: r.league_id, week, team_id: r.team_id });
    } else {
      changed.push({ ...r, week });
    }
  }

  if (unchangedKeys.length) {
    await touchMatchupSyncedAt(unchangedKeys).catch(() => undefined);
  }

  if (changed.length === 0) return 0;

  const cols = [
    "league_id",
    "connection_id",
    "platform",
    "week",
    "team_id",
    "matchup_id",
    "roster_points",
    "projected_points",
    "opponent_team_id",
    "team_name",
    "owner_name",
    "starters",
    "player_points",
  ];
  let written = 0;
  for (const chunk of chunkRows(changed, 100)) {
    const flat: unknown[] = [];
    for (const r of chunk) {
      flat.push(
        r.league_id,
        r.connection_id ?? null,
        r.platform ?? "espn",
        r.week,
        r.team_id,
        r.matchup_id ?? null,
        r.roster_points ?? 0,
        r.projected_points ?? 0,
        r.opponent_team_id ?? null,
        r.team_name ?? null,
        r.owner_name ?? null,
        JSON.stringify(r.starters ?? []),
        JSON.stringify(r.player_points ?? {}),
      );
    }
    const placeholders = Array.from(
      { length: chunk.length },
      () => `(${cols.map(() => "?").join(", ")})`,
    ).join(", ");
    const sql = `INSERT INTO synced_matchups (${cols.join(", ")}) VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        connection_id=VALUES(connection_id),
        platform=VALUES(platform),
        matchup_id=VALUES(matchup_id),
        roster_points=VALUES(roster_points),
        projected_points=VALUES(projected_points),
        opponent_team_id=VALUES(opponent_team_id),
        team_name=VALUES(team_name),
        owner_name=VALUES(owner_name),
        starters=VALUES(starters),
        player_points=VALUES(player_points),
        synced_at=CURRENT_TIMESTAMP`;
    await tidbExecute(sql, flat);
    written += chunk.length;
  }
  return written;
}
