/**
 * TiDB-backed research aggregate snapshots.
 * Cron writes; request path only SELECTs (no nflverse gunzip / club scrapes).
 */
import { tidbConfigured, tidbExecute } from "@/lib/tidb";

export type AggTable =
  | "agg_redzone"
  | "agg_targets"
  | "agg_are_they_playing"
  | "agg_sos";

export async function readAggJson<T>(table: AggTable, key: string): Promise<T | null> {
  if (!tidbConfigured()) return null;
  try {
    if (table === "agg_are_they_playing") {
      const rows = await tidbExecute<{ payload: string | T }>(
        `SELECT payload FROM ${table} WHERE snapshot_key = ? LIMIT 1`,
        [key],
      );
      const raw = rows[0]?.payload;
      if (raw == null) return null;
      return typeof raw === "string" ? (JSON.parse(raw) as T) : (raw as T);
    }
    const rows = await tidbExecute<{ payload: string | T }>(
      `SELECT payload FROM ${table} WHERE season = ? LIMIT 1`,
      [key],
    );
    const raw = rows[0]?.payload;
    if (raw == null) return null;
    return typeof raw === "string" ? (JSON.parse(raw) as T) : (raw as T);
  } catch (error) {
    console.warn(`[research-agg] read ${table} failed`, error);
    return null;
  }
}

export async function writeAggJson(
  table: AggTable,
  key: string,
  payload: unknown,
): Promise<void> {
  if (!tidbConfigured()) return;
  const json = JSON.stringify(payload);
  if (table === "agg_are_they_playing") {
    await tidbExecute(
      `INSERT INTO ${table} (snapshot_key, payload) VALUES (?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
      [key, json],
    );
    return;
  }
  await tidbExecute(
    `INSERT INTO ${table} (season, payload) VALUES (?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
    [key, json],
  );
}

export async function readWeekPlaysMeta(
  season: string,
  week: number,
): Promise<unknown | null> {
  if (!tidbConfigured()) return null;
  try {
    const rows = await tidbExecute<{ payload: string | unknown }>(
      `SELECT payload FROM agg_week_plays_meta WHERE season = ? AND week = ? LIMIT 1`,
      [season, week],
    );
    const raw = rows[0]?.payload;
    if (raw == null) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export async function writeWeekPlaysMeta(
  season: string,
  week: number,
  payload: unknown,
): Promise<void> {
  if (!tidbConfigured()) return;
  await tidbExecute(
    `INSERT INTO agg_week_plays_meta (season, week, payload) VALUES (?, ?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
    [season, week, JSON.stringify(payload)],
  );
}
