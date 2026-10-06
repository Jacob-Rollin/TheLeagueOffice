/**
 * TiDB-backed research aggregate snapshots.
 * Cron writes; request path only SELECTs (no nflverse gunzip / club scrapes).
 */
import { tidbConfigured, tidbExecute } from "@/lib/tidb";

export type AggTable =
  | "agg_redzone"
  | "agg_targets"
  | "agg_are_they_playing"
  | "agg_sos"
  | "agg_fpa"
  | "agg_matchups_guide"
  | "agg_sos_analysis"
  | "agg_fantasy_leaders";

/** Coalesce Fluid-isolate stampede on CDN miss (snaps change on cron, not per request). */
const AGG_READ_TTL_MS = 60 * 1000;
const aggReadMemo = new Map<string, { at: number; value: Promise<unknown | null> }>();

function memoKey(table: AggTable, key: string): string {
  return `${table}|${key}`;
}

export async function readAggJson<T>(table: AggTable, key: string): Promise<T | null> {
  if (!tidbConfigured()) return null;
  const mk = memoKey(table, key);
  const hit = aggReadMemo.get(mk);
  if (hit && Date.now() - hit.at < AGG_READ_TTL_MS) {
    return (await hit.value) as T | null;
  }

  const value = (async (): Promise<unknown | null> => {
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
  })();

  aggReadMemo.set(mk, { at: Date.now(), value });
  return (await value) as T | null;
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
    aggReadMemo.delete(memoKey(table, key));
    return;
  }
  await tidbExecute(
    `INSERT INTO ${table} (season, payload) VALUES (?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
    [key, json],
  );
  aggReadMemo.delete(memoKey(table, key));
}

/**
 * TiDB-first research helper: serve snap, empty on miss (request), or compute+write (cron).
 * Never double-invokes compute on failure (that was inflating Fluid timeouts / 5xx).
 */
export async function withResearchSnap<T>(
  table: AggTable,
  key: string,
  opts: { allowCompute?: boolean } | undefined,
  empty: T,
  compute: () => Promise<T>,
): Promise<T> {
  const allowCompute = opts?.allowCompute === true;

  if (tidbConfigured()) {
    try {
      const cached = await readAggJson<T>(table, key);
      if (cached != null) return cached;
    } catch {
      /* treat as miss */
    }
    if (!allowCompute) return empty;
    try {
      const payload = await compute();
      void writeAggJson(table, key, payload).catch(() => undefined);
      return payload;
    } catch (error) {
      console.warn(`[research-agg] compute ${table}/${key} failed`, error);
      return empty;
    }
  }

  // Local/dev without TiDB may still compute on the request path.
  return compute();
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
