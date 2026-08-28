import { supabaseB } from "@/lib/supabaseB";

/**
 * Player Warehouse aggregation pipeline (Database B).
 *
 * Ingests 4 player data vectors and anchors every record to the master
 * `sleeper_id` primary key to prevent cross-platform identity confusion:
 *
 *   1. Sleeper base stats / player registry
 *   2. FantasyCalc trade values
 *   3. LeagueLogs injury status tags
 *   4. FantasyPros ECR + standard deviation
 *
 * All reads/writes go exclusively through `supabaseB`. Database A (auth,
 * profiles, synced leagues) is never touched from this module.
 */

export const WAREHOUSE_TABLE = "player_warehouse" as const;

/** Normalized row shape for the player_warehouse table. */
export interface PlayerWarehouseRow {
  sleeper_id: string; // primary anchor key
  full_name?: string | null;
  position?: string | null;
  team?: string | null;
  fantasycalc_value?: number | null;
  leaguelogs_status?: string | null;
  fantasypros_ecr?: number | null;
  fantasypros_sd?: number | null;
  updated_at?: string;
}

/** Incoming record from any provider before identity anchoring. */
export interface ProviderRecord {
  /** Master Sleeper ID, resolved by the identity translation layer. */
  sleeper_id: string;
  full_name?: string | null;
  position?: string | null;
  team?: string | null;
  fantasycalc_value?: number | null;
  leaguelogs_status?: string | null;
  fantasypros_ecr?: number | null;
  fantasypros_sd?: number | null;
}

/**
 * Merge-provider upsert: anchors each incoming record to its sleeper_id and
 * writes only the fields that provider supplies (partial-column merge).
 */
async function upsertBatch(rows: PlayerWarehouseRow[]): Promise<{ written: number }> {
  if (rows.length === 0) return { written: 0 };

  const { error } = await supabaseB
    .from(WAREHOUSE_TABLE)
    .upsert(rows, { onConflict: "sleeper_id" });

  if (error) throw new Error(`[aggregation] upsert failed: ${error.message}`);
  return { written: rows.length };
}

/** Ingest Sleeper base player data (identity anchor source). */
export async function ingestSleeperBase(records: ProviderRecord[]) {
  const rows: PlayerWarehouseRow[] = records.map((r) => ({
    sleeper_id: r.sleeper_id,
    full_name: r.full_name ?? null,
    position: r.position ?? null,
    team: r.team ?? null,
    updated_at: new Date().toISOString(),
  }));
  return upsertBatch(rows);
}

/** Ingest FantasyCalc trade values. */
export async function ingestFantasyCalcValues(records: ProviderRecord[]) {
  const rows: PlayerWarehouseRow[] = records.map((r) => ({
    sleeper_id: r.sleeper_id,
    fantasycalc_value: r.fantasycalc_value ?? null,
    updated_at: new Date().toISOString(),
  }));
  return upsertBatch(rows);
}

/** Ingest LeagueLogs injury status tags. */
export async function ingestLeagueLogsStatus(records: ProviderRecord[]) {
  const rows: PlayerWarehouseRow[] = records.map((r) => ({
    sleeper_id: r.sleeper_id,
    leaguelogs_status: r.leaguelogs_status ?? null,
    updated_at: new Date().toISOString(),
  }));
  return upsertBatch(rows);
}

/** Ingest FantasyPros ECR + standard deviation. */
export async function ingestFantasyProsRanks(records: ProviderRecord[]) {
  const rows: PlayerWarehouseRow[] = records.map((r) => ({
    sleeper_id: r.sleeper_id,
    fantasypros_ecr: r.fantasypros_ecr ?? null,
    fantasypros_sd: r.fantasypros_sd ?? null,
    updated_at: new Date().toISOString(),
  }));
  return upsertBatch(rows);
}

/**
 * Skeleton master ingestion loop: runs each provider vector through the
 * anchored upsert pipeline in sequence.
 */
export async function runWarehouseIngestion(sources: {
  sleeper?: ProviderRecord[];
  fantasycalc?: ProviderRecord[];
  leaguelogs?: ProviderRecord[];
  fantasypros?: ProviderRecord[];
}) {
  const results: Record<string, number> = {};

  if (sources.sleeper) results.sleeper = (await ingestSleeperBase(sources.sleeper)).written;
  if (sources.fantasycalc) results.fantasycalc = (await ingestFantasyCalcValues(sources.fantasycalc)).written;
  if (sources.leaguelogs) results.leaguelogs = (await ingestLeagueLogsStatus(sources.leaguelogs)).written;
  if (sources.fantasypros) results.fantasypros = (await ingestFantasyProsRanks(sources.fantasypros)).written;

  return results;
}

/** Read the full warehouse payload (used by the master_player_brain compiler). */
export async function readWarehouse(): Promise<PlayerWarehouseRow[]> {
  const { data, error } = await supabaseB.from(WAREHOUSE_TABLE).select("*");
  if (error) throw new Error(`[aggregation] read failed: ${error.message}`);
  return (data ?? []) as PlayerWarehouseRow[];
}
