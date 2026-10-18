/**
 * Parse Sleeper `/v1/stats/nfl/regular/{season}/{week}` payloads.
 *
 * Sleeper usually returns a flat dict: `{ [playerId]: { pass_yd, … } }`.
 * Some callers / older shapes use arrays or nested `{ stats: { … } }` —
 * accept all three so live scoring never silently empties.
 *
 * Path must include `/v1` — without it `/stats/nfl/regular/...` 404s.
 * Also avoid `/stats/nfl/{season}/{week}?season_type=regular` (empty `{}` rows).
 */

import { SLEEPER_BASE, positionsQuery } from "@/lib/players-build";
import { R2_SNAP_KEYS, r2Url, snapCdnPublicBase } from "@/lib/r2-public";
import { getCached } from "@/lib/sleeper-cache";
import { waitForSleeperPermit } from "@/lib/sleeper-rate-budget";

/** Shared IndexedDB key — matchup overlay + Statistics tab share one download. */
export const WEEKLY_ACTUAL_STATS_CACHE_KEY = (season: string | number, week: number) =>
  `weekly-actual-stats-v7-v1-path:${season}|${week}`;

/**
 * Live week actuals from browser → Sleeper (IndexedDB `getCached`).
 * Waits for a live rate-budget permit so Matchup scoring is not starved.
 * Snap-cdn is a soft warm fallback only — Actions finalize TiDB later.
 */
export async function fetchWeeklyActualStatRows(
  season: string | number,
  week: number,
  ttlMs: number,
): Promise<Record<string, Record<string, number>>> {
  const safeSeason = String(season || new Date().getUTCFullYear());
  const safeWeek = Math.max(1, Math.min(18, Math.floor(week) || 1));
  return getCached(WEEKLY_ACTUAL_STATS_CACHE_KEY(safeSeason, safeWeek), ttlMs, async () => {
    // `/v1` required — bare `/stats/nfl/regular/...` returns 404 HTML.
    const url = `${SLEEPER_BASE}/v1/stats/nfl/regular/${safeSeason}/${safeWeek}?${positionsQuery()}`;
    const rows = await fetchSleeperWeekStatsJson(url);
    if (rows != null) {
      const parsed = parseSleeperWeekStatRows(rows);
      if (Object.keys(parsed).length > 0) return parsed;
    }
    const snap = await fetchSnapWeekStatRows(safeSeason, safeWeek);
    if (snap && Object.keys(snap).length > 0) return snap;
    throw new Error("sleeper week stats unavailable");
  });
}

/** Wait for live budget, then GET — critical for native Matchup scoring. */
async function fetchSleeperWeekStatsJson(url: string): Promise<unknown | null> {
  if (!(await waitForSleeperPermit("live", 6_000))) return null;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200));
      if (!(await waitForSleeperPermit("live", 4_000))) return null;
      const retry = await fetch(url, { headers: { accept: "application/json" } });
      if (!retry.ok) return null;
      return (await retry.json()) as unknown;
    }
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
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
