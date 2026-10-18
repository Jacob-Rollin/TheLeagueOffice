/**
 * Parse Sleeper `/stats/nfl/regular/{season}/{week}` payloads.
 *
 * Sleeper usually returns a flat dict: `{ [playerId]: { pass_yd, … } }`.
 * Some callers / older shapes use arrays or nested `{ stats: { … } }` —
 * accept all three so live scoring never silently empties.
 *
 * Note: `/stats/nfl/{season}/{week}?season_type=regular` returns empty `{}`
 * rows in current Sleeper — always use the `/regular/` path segment.
 */

import { SLEEPER_BASE, positionsQuery } from "@/lib/players-build";
import { R2_SNAP_KEYS, r2Url, snapCdnPublicBase } from "@/lib/r2-public";
import { getCached } from "@/lib/sleeper-cache";
import { sleeperFetchJson } from "@/lib/sleeper-http";

/** Shared IndexedDB key — matchup overlay + Statistics tab share one download. */
export const WEEKLY_ACTUAL_STATS_CACHE_KEY = (season: string | number, week: number) =>
  `weekly-actual-stats-v5-regular-snap:${season}|${week}`;

/**
 * Budgeted Sleeper week actuals. Callers pass TTL so broadcast pages (~12s)
 * and default boards (~30s) coalesce on the same cache key.
 *
 * On Sleeper miss/empty: warm snap-cdn fallback (Actions publish) — never
 * write an empty `{}` into IndexedDB (that poisoned native Matchup 0.00s).
 */
export async function fetchWeeklyActualStatRows(
  season: string | number,
  week: number,
  ttlMs: number,
): Promise<Record<string, Record<string, number>>> {
  const safeSeason = String(season || new Date().getUTCFullYear());
  const safeWeek = Math.max(1, Math.min(18, Math.floor(week) || 1));
  return getCached(WEEKLY_ACTUAL_STATS_CACHE_KEY(safeSeason, safeWeek), ttlMs, async () => {
    const url = `${SLEEPER_BASE}/stats/nfl/regular/${safeSeason}/${safeWeek}?${positionsQuery()}`;
    const rows = await sleeperFetchJson<unknown>(url, "live");
    if (rows == null) {
      const snap = await fetchSnapWeekStatRows(safeSeason, safeWeek);
      if (snap && Object.keys(snap).length > 0) return snap;
      throw new Error("sleeper week stats unavailable");
    }
    const parsed = parseSleeperWeekStatRows(rows);
    if (Object.keys(parsed).length > 0) return parsed;
    const snap = await fetchSnapWeekStatRows(safeSeason, safeWeek);
    if (snap && Object.keys(snap).length > 0) return snap;
    throw new Error("empty week stats");
  });
}

async function fetchSnapWeekStatRows(
  season: string,
  week: number,
): Promise<Record<string, Record<string, number>> | null> {
  if (!snapCdnPublicBase()) return null;
  const url = r2Url(R2_SNAP_KEYS.nativeWeekStats(season, week));
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as { stats?: unknown };
    if (!json?.stats || typeof json.stats !== "object") return null;
    return parseSleeperWeekStatRows(json.stats);
  } catch {
    return null;
  }
}

function coerceStatLine(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const nested = record["stats"];
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : record;
  const stats: Record<string, number> = {};
  for (const [k, v] of Object.entries(source)) {
    if (k === "stats" || k === "player_id" || k === "player" || k === "team" || k === "opponent") {
      continue;
    }
    const n = Number(v);
    if (Number.isFinite(n)) stats[k] = n;
  }
  return Object.keys(stats).length > 0 ? stats : null;
}

/** player_id → numeric stat line (empty players omitted). */
export function parseSleeperWeekStatRows(
  rows: unknown,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  if (!rows) return out;

  if (Array.isArray(rows)) {
    for (const row of rows as { player_id?: string; stats?: unknown }[]) {
      const id = String(row?.player_id ?? "").trim();
      if (!id) continue;
      const stats = coerceStatLine(row);
      if (stats) out[id] = stats;
    }
    return out;
  }

  if (typeof rows === "object") {
    for (const [id, row] of Object.entries(rows as Record<string, unknown>)) {
      const clean = String(id ?? "").trim();
      if (!clean) continue;
      const stats = coerceStatLine(row);
      if (stats) out[clean] = stats;
    }
  }
  return out;
}

/** Map form used by `useWeeklyActualStats` / pickup helpers. */
export function parseSleeperWeekStatMap(
  rows: unknown,
): Map<string, Record<string, number>> {
  return new Map(Object.entries(parseSleeperWeekStatRows(rows)));
}
