/**
 * Batch upsert helpers for synced league snapshots into TiDB.
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

export async function upsertSyncedRosters(rows: TidbRosterUpsert[]): Promise<number> {
  if (!tidbConfigured() || rows.length === 0) return 0;
  const cols = ["league_id", "team_id", "owner_name", "players", "starters", "bench"];
  let written = 0;
  for (const chunk of chunkRows(rows, 100)) {
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
  for (const chunk of chunkRows(rows, 100)) {
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
