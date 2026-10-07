/**
 * Browser-side Fantasy Leaders from public Sleeper week stats.
 * Used when the TiDB/CDN research snap is cold — avoids Fluid allowCompute.
 *
 * Per-visitor IndexedDB cache + concurrency cap; each user uses their own
 * Sleeper rate-limit pool.
 */

import { getCached } from "@/lib/sleeper-cache";
import {
  POSITIONS,
  SLEEPER_BASE,
  currentSeason,
  num,
  positionsQuery,
  type Pos,
  type SleeperRow,
} from "@/lib/players-build";
import { fetchNflStateClient } from "@/lib/sleeper-client";
import type { FantasyLeaderRow, FantasyLeaders } from "@/lib/players.server";

const HOUR = 60 * 60 * 1000;
/** Keep week-stat fan-out polite (same spirit as projection week bundles). */
const WEEK_STATS_CONCURRENCY = 2;

async function sleeperFetch(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status !== 429) return res;
  await new Promise((r) => setTimeout(r, 1200));
  return fetch(url, { headers: { accept: "application/json" } });
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

async function weekStatRows(season: string, week: number): Promise<SleeperRow[]> {
  const safeWeek = Math.min(18, Math.max(1, week));
  return getCached(`leaders-week-stats-v1:${season}|${safeWeek}`, 30 * 60 * 1000, async () => {
    const url = `${SLEEPER_BASE}/stats/nfl/${season}/${safeWeek}?season_type=regular&${positionsQuery()}`;
    const res = await sleeperFetch(url);
    if (!res.ok) return [] as SleeperRow[];
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? (json as SleeperRow[]) : [];
  });
}

/** Assemble leaders from Sleeper in the browser (no Vercel Fluid). */
export async function computeFantasyLeadersClient(seasonInput?: string): Promise<FantasyLeaders> {
  const seasonKnown = seasonInput && /^\d{4}$/.test(seasonInput) ? seasonInput : null;
  const state = await fetchNflStateClient().catch(() => null);
  const season = seasonKnown ?? state?.season ?? currentSeason();
  const empty: FantasyLeaders = { season, maxWeek: 0, rows: [] };

  const lastWeek =
    !state || season === state.season
      ? Math.min(18, Math.max(0, state?.week ?? 0))
      : Number(season) < Number(state.season)
        ? 18
        : 0;
  if (lastWeek < 1) return empty;

  const weekRows = await mapPool(
    Array.from({ length: lastWeek }, (_, i) => i + 1),
    WEEK_STATS_CONCURRENCY,
    (week) => weekStatRows(season, week).catch(() => [] as SleeperRow[]),
  );

  let maxWeek = 0;
  const byId = new Map<string, FantasyLeaderRow>();
  weekRows.forEach((rows, index) => {
    for (const row of rows) {
      const stats = row.stats;
      const pos = (row.player?.position ?? "") as Pos;
      if (!row.player_id || !stats || !POSITIONS.includes(pos)) continue;
      if (!(Number(stats["gp"]) > 0)) continue;
      maxWeek = Math.max(maxWeek, index + 1);
      const id = String(row.player_id);
      let entry = byId.get(id);
      if (!entry) {
        const first = row.player?.first_name?.trim() ?? "";
        const last = row.player?.last_name?.trim() ?? "";
        entry = {
          id,
          name: `${first} ${last}`.trim() || id,
          pos,
          team: (row.team ?? row.player?.team ?? "").trim() || "FA",
          weeks: [],
        };
        byId.set(id, entry);
      } else if (row.team) {
        entry.team = row.team.trim();
      }
      const round = (v: unknown) => Math.round(num(v, 0) * 100) / 100;
      entry.weeks[index] = [
        round(stats["pts_std"]),
        round(stats["pts_half_ppr"]),
        round(stats["pts_ppr"]),
      ];
    }
  });

  if (!maxWeek) return empty;

  const rows = [...byId.values()].map((row) => ({
    ...row,
    weeks: Array.from({ length: maxWeek }, (_, i) => row.weeks[i] ?? null),
  }));

  return { season, maxWeek, rows };
}

/** Cache the assembled board so format toggles / revisits skip the week fan-out. */
export async function fetchFantasyLeadersClient(season?: string): Promise<FantasyLeaders> {
  const key = `fantasy-leaders-client-v1:${season && /^\d{4}$/.test(season) ? season : "auto"}`;
  return getCached(key, HOUR, () => computeFantasyLeadersClient(season));
}
