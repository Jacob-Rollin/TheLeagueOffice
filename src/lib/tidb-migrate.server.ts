/**
 * TiDB schema apply + warehouse seed helpers (server-only).
 */
import { buildUpsertSql, chunkRows, tidbConfigured, tidbExecute } from "@/lib/tidb";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS player_warehouse (
  sleeper_id VARCHAR(32) NOT NULL,
  player_name VARCHAR(128) NULL,
  position VARCHAR(8) NULL,
  team VARCHAR(8) NULL,
  fantasycalc_value DECIMAL(12, 2) NULL,
  leaguelogs_status VARCHAR(64) NULL,
  injury_type VARCHAR(64) NULL,
  injury_notes TEXT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (sleeper_id),
  INDEX idx_pw_position (position),
  INDEX idx_pw_player_name (player_name),
  INDEX idx_pw_team (team),
  INDEX idx_pw_pos_name (position, player_name)
)`,
  `CREATE TABLE IF NOT EXISTS synced_leagues (
  league_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  platform ENUM('sleeper', 'espn') NOT NULL,
  name VARCHAR(255) NULL,
  total_teams INT NULL,
  total_rounds INT NULL,
  playoff_start_week INT NULL,
  scoring_settings JSON NULL,
  synced_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (league_id),
  INDEX idx_sl_user_id (user_id),
  INDEX idx_sl_platform (platform)
)`,
  `CREATE TABLE IF NOT EXISTS synced_rosters (
  id BIGINT NOT NULL AUTO_INCREMENT,
  league_id VARCHAR(64) NOT NULL,
  team_id INT NOT NULL,
  owner_name VARCHAR(255) NULL,
  players JSON NULL,
  starters JSON NULL,
  bench JSON NULL,
  synced_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_league_team (league_id, team_id),
  INDEX idx_sr_league_id (league_id)
)`,
  `CREATE TABLE IF NOT EXISTS synced_matchups (
  id BIGINT NOT NULL AUTO_INCREMENT,
  league_id VARCHAR(64) NOT NULL,
  connection_id VARCHAR(64) NULL,
  platform VARCHAR(16) NOT NULL DEFAULT 'espn',
  week INT NOT NULL,
  team_id INT NOT NULL,
  matchup_id INT NULL,
  roster_points DECIMAL(8, 2) NOT NULL DEFAULT 0,
  projected_points DECIMAL(8, 2) NOT NULL DEFAULT 0,
  opponent_team_id INT NULL,
  team_name VARCHAR(255) NULL,
  owner_name VARCHAR(255) NULL,
  starters JSON NULL,
  player_points JSON NULL,
  synced_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_league_week_team (league_id, week, team_id),
  INDEX idx_sm_league_week (league_id, week),
  INDEX idx_sm_league_id (league_id)
)`,
  `CREATE TABLE IF NOT EXISTS agg_redzone (
  season VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season)
)`,
  `CREATE TABLE IF NOT EXISTS agg_targets (
  season VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season)
)`,
  `CREATE TABLE IF NOT EXISTS agg_sos (
  season VARCHAR(16) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season)
)`,
  `CREATE TABLE IF NOT EXISTS agg_fpa (
  season VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season)
)`,
  `CREATE TABLE IF NOT EXISTS agg_matchups_guide (
  season VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season)
)`,
  `CREATE TABLE IF NOT EXISTS agg_sos_analysis (
  season VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season)
)`,
  `CREATE TABLE IF NOT EXISTS agg_are_they_playing (
  snapshot_key VARCHAR(32) NOT NULL DEFAULT 'latest',
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (snapshot_key)
)`,
  `CREATE TABLE IF NOT EXISTS agg_week_plays_meta (
  season VARCHAR(16) NOT NULL,
  week INT NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season, week)
)`,
  `CREATE TABLE IF NOT EXISTS agg_fantasy_leaders (
  season VARCHAR(16) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season)
)`,
  // Widen keys if an older VARCHAR(8) schema was applied (composite research keys).
  `ALTER TABLE agg_redzone MODIFY season VARCHAR(64) NOT NULL`,
  `ALTER TABLE agg_targets MODIFY season VARCHAR(64) NOT NULL`,
  `ALTER TABLE agg_fpa MODIFY season VARCHAR(64) NOT NULL`,
  `ALTER TABLE agg_matchups_guide MODIFY season VARCHAR(64) NOT NULL`,
  `ALTER TABLE agg_sos_analysis MODIFY season VARCHAR(64) NOT NULL`,
];

export type WarehouseSeedRow = {
  sleeper_id: string;
  player_name?: string | null;
  position?: string | null;
  team?: string | null;
  fantasycalc_value?: number | null;
  leaguelogs_status?: string | null;
  injury_type?: string | null;
  injury_notes?: string | null;
};

export async function applyTidbSchema(): Promise<{ applied: number }> {
  if (!tidbConfigured()) throw new Error("DATABASE_URL not configured");
  let applied = 0;
  for (const sql of SCHEMA_STATEMENTS) {
    try {
      await tidbExecute(sql);
      applied += 1;
    } catch (error) {
      // ALTER on missing table / identical column is non-fatal during bootstrap.
      const message = error instanceof Error ? error.message : String(error);
      if (/ALTER TABLE/i.test(sql) && /doesn't exist|1146|42S02|Duplicate|same/i.test(message)) {
        continue;
      }
      if (/already exists|1050/i.test(message)) {
        continue;
      }
      throw error;
    }
  }
  return { applied };
}

export async function seedPlayerWarehouse(
  rows: WarehouseSeedRow[],
): Promise<{ written: number; total: number }> {
  if (!tidbConfigured()) throw new Error("DATABASE_URL not configured");
  if (rows.length === 0) return { written: 0, total: 0 };

  const cols = [
    "sleeper_id",
    "player_name",
    "position",
    "team",
    "fantasycalc_value",
    "leaguelogs_status",
    "injury_type",
    "injury_notes",
    "updated_at",
  ];
  const updateCols = cols.filter((c) => c !== "sleeper_id");
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const values: unknown[][] = [];
  for (const r of rows) {
    const id = String(r.sleeper_id ?? "").slice(0, 32);
    if (!id) continue;
    values.push([
      id,
      r.player_name?.slice(0, 128) || null,
      r.position?.slice(0, 8) || null,
      r.team?.slice(0, 8) || null,
      r.fantasycalc_value ?? null,
      r.leaguelogs_status?.slice(0, 64) || null,
      r.injury_type?.slice(0, 64) || null,
      r.injury_notes || null,
      now,
    ]);
  }

  let written = 0;
  for (const chunk of chunkRows(values, 200)) {
    await tidbExecute(buildUpsertSql("player_warehouse", cols, chunk.length, updateCols), chunk.flat());
    written += chunk.length;
  }
  const countRows = await tidbExecute<{ c: number }>("SELECT COUNT(*) AS c FROM player_warehouse");
  return { written, total: Number(countRows[0]?.c ?? written) };
}

let ensureSeedPromise: Promise<{
  migrated: boolean;
  count: number;
  detail?: string;
}> | null = null;

/**
 * One-shot: if TiDB has no warehouse rows (or missing table), apply schema +
 * seed from Supabase brain. Safe to call from export/cron; concurrent callers
 * share one in-flight migrate.
 */
export async function ensureTidbWarehouseSeeded(): Promise<{
  migrated: boolean;
  count: number;
  detail?: string;
}> {
  if (!tidbConfigured()) {
    return { migrated: false, count: 0, detail: "DATABASE_URL not configured" };
  }
  if (ensureSeedPromise) return ensureSeedPromise;

  ensureSeedPromise = (async () => {
    try {
      try {
        const status = await tidbWarehouseStatus();
        if (status.playerWarehouseCount >= 100) {
          return { migrated: false, count: status.playerWarehouseCount };
        }
      } catch {
        // Table missing or first connect — fall through to migrate.
      }

      await applyTidbSchema();
      const loaded = await loadSeedRowsFromSupabase();
      if (loaded.rows.length < 100) {
        ensureSeedPromise = null; // allow retry
        return {
          migrated: false,
          count: loaded.rows.length,
          detail: `seed source too small (${loaded.rows.length}) from ${loaded.source}`,
        };
      }
      const seeded = await seedPlayerWarehouse(loaded.rows);
      return {
        migrated: true,
        count: seeded.total,
        detail: `seeded ${seeded.written} from ${loaded.source}`,
      };
    } catch (error) {
      ensureSeedPromise = null; // allow retry after hard failure
      throw error;
    }
  })();

  return ensureSeedPromise;
}

export async function tidbWarehouseStatus(): Promise<{
  configured: boolean;
  playerWarehouseCount: number;
  database?: string;
  sample?: { sleeper_id: string; player_name: string | null }[];
}> {
  if (!tidbConfigured()) {
    return { configured: false, playerWarehouseCount: 0 };
  }
  try {
    const { normalizeTidbDatabaseUrl, tidbDatabaseFromUrl } = await import("@/lib/tidb");
    const raw = process.env["DATABASE_URL"]?.trim() ?? "";
    const database = tidbDatabaseFromUrl(normalizeTidbDatabaseUrl(raw));
    const countRows = await tidbExecute<{ c: number }>("SELECT COUNT(*) AS c FROM player_warehouse");
    const sample = await tidbExecute<{ sleeper_id: string; player_name: string | null }>(
      "SELECT sleeper_id, player_name FROM player_warehouse ORDER BY player_name ASC LIMIT 5",
    );
    return {
      configured: true,
      database,
      playerWarehouseCount: Number(countRows[0]?.c ?? 0),
      sample,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`TiDB status failed: ${message}`);
  }
}

type BrainPayload = {
  ids?: string[];
  names?: string[];
  positions?: string[];
  teams?: string[];
  values?: number[];
  injuries?: string[];
  injury_types?: string[];
  injury_notes?: string[];
};

function brainUrl(): string | null {
  const raw =
    process.env["VITE_SUPABASE_URL_B"] ??
    (typeof import.meta !== "undefined"
      ? (import.meta.env["VITE_SUPABASE_URL_B"] as string | undefined)
      : undefined);
  if (!raw) return null;
  const origin = raw.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
  return `${origin}/storage/v1/object/public/player_brain/master_player_brain.json`;
}

/** Load seed rows from Supabase Storage brain, else Supabase B warehouse table. */
export async function loadSeedRowsFromSupabase(): Promise<{
  source: "brain" | "warehouse";
  rows: WarehouseSeedRow[];
}> {
  const url = brainUrl();
  if (url) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const brain = (await res.json()) as BrainPayload;
      const ids = Array.isArray(brain.ids) ? brain.ids : [];
      if (ids.length > 0) {
        const rows: WarehouseSeedRow[] = [];
        for (let i = 0; i < ids.length; i++) {
          const id = String(ids[i] ?? "").slice(0, 32);
          if (!id) continue;
          rows.push({
            sleeper_id: id,
            player_name: String(brain.names?.[i] ?? "") || null,
            position: String(brain.positions?.[i] ?? "") || null,
            team: String(brain.teams?.[i] ?? "") || null,
            fantasycalc_value: Number(brain.values?.[i] ?? 0) || null,
            leaguelogs_status: String(brain.injuries?.[i] ?? "") || null,
            injury_type: String(brain.injury_types?.[i] ?? "") || null,
            injury_notes: String(brain.injury_notes?.[i] ?? "") || null,
          });
        }
        return { source: "brain", rows };
      }
    }
  }

  // Fall back to Supabase B warehouse table (never TiDB — this is the migration source).
  const { supabaseB } = await import("@/lib/supabaseB");
  const PAGE = 1000;
  const rows: WarehouseSeedRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseB
      .from("player_warehouse")
      .select(
        "sleeper_id, player_name, position, team, fantasycalc_value, leaguelogs_status, injury_type, injury_notes",
      )
      .order("sleeper_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Supabase warehouse read failed: ${error.message}`);
    const page = (data ?? []) as WarehouseSeedRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return { source: "warehouse", rows };
}
