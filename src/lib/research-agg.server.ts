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

/** Coalesce concurrent cron/request computes for the same snap key. */
const aggComputeMemo = new Map<string, Promise<unknown>>();
/** After a cold compute, cool down before allowing another fan-out on this isolate. */
const aggColdComputeAt = new Map<string, number>();
const COLD_COMPUTE_COOLDOWN_MS = 60 * 1000;

export type ResearchSnapOpts<T> = {
  allowCompute?: boolean;
  /** When set, cold/empty snaps are treated as misses (cron may rebuild; request soft-empties). */
  isWarm?: (payload: T) => boolean;
};

/**
 * TiDB-first research helper: serve warm snap, empty on miss (request), or compute+write (cron).
 * Never double-invokes compute on failure (that was inflating Fluid timeouts / 5xx).
 * Empty/cold payloads are not treated as hits and are not persisted — a one-time failed
 * warm must not pin the board empty forever.
 */
export async function withResearchSnap<T>(
  table: AggTable,
  key: string,
  opts: ResearchSnapOpts<T> | undefined,
  empty: T,
  compute: () => Promise<T>,
): Promise<T> {
  const allowCompute = opts?.allowCompute === true;
  const isWarm = opts?.isWarm;
  const warm = (payload: T) => (isWarm ? isWarm(payload) : true);

  if (tidbConfigured()) {
    try {
      const cached = await readAggJson<T>(table, key);
      if (cached != null && warm(cached)) return cached;
    } catch {
      /* treat as miss */
    }
    if (!allowCompute) return empty;

    const mk = memoKey(table, key);
    const coldAt = aggColdComputeAt.get(mk);
    if (coldAt != null && Date.now() - coldAt < COLD_COMPUTE_COOLDOWN_MS) {
      return empty;
    }

    const pending = aggComputeMemo.get(mk);
    if (pending) return (await pending) as T;

    const run = (async (): Promise<T> => {
      try {
        const payload = await compute();
        // Only persist warm snaps so a transient upstream miss cannot pin empty.
        if (warm(payload)) {
          aggColdComputeAt.delete(mk);
          void writeAggJson(table, key, payload).catch(() => undefined);
        } else {
          aggColdComputeAt.set(mk, Date.now());
        }
        return payload;
      } catch (error) {
        console.warn(`[research-agg] compute ${table}/${key} failed`, error);
        aggColdComputeAt.set(mk, Date.now());
        return empty;
      } finally {
        aggComputeMemo.delete(mk);
      }
    })();
    aggComputeMemo.set(mk, run);
    return await run;
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
