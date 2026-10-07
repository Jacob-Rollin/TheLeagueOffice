/**
 * Browser-scored pickup production for Transactions insights.
 * Prefer over Fluid getPickupResults for Sleeper so that page stays off Active CPU.
 */

import {
  espnFluidCacheKey,
  espnFluidMemo,
  ESPN_FLUID_TTL_MS,
} from "@/lib/espn-fluid-cache";
import { fetchLeagueScoringPreferred } from "@/lib/scoring-client";
import { scoreStats } from "@/lib/scoring-map";
import { getCached } from "@/lib/sleeper-cache";
import { sleeperFetchJson } from "@/lib/sleeper-http";

const SLEEPER = "https://api.sleeper.app/v1";
const STATS_TTL_MS = 30 * 60 * 1000;

export type PickupRequest = { key: string; playerId: string; fromWeek: number; toWeek: number };
export type PickupResult = { pts: number; games: number };

async function sleeperJson<T>(url: string): Promise<T | null> {
  return sleeperFetchJson<T>(url, "warm");
}

async function weekStatMap(season: string, week: number): Promise<Map<string, Record<string, number>>> {
  return getCached(`sleeper-week-stats-v1:${season}:${week}`, STATS_TTL_MS, async () => {
    const rows = await sleeperJson<Record<string, { stats?: Record<string, number> }> | unknown[]>(
      `${SLEEPER}/stats/nfl/${season}/${week}?season_type=regular`,
    );
    const map = new Map<string, Record<string, number>>();
    if (!rows) return map;
    if (Array.isArray(rows)) {
      for (const row of rows as { player_id?: string; stats?: Record<string, number> }[]) {
        if (row.player_id && row.stats) map.set(String(row.player_id), row.stats);
      }
      return map;
    }
    for (const [id, row] of Object.entries(rows as Record<string, { stats?: Record<string, number> }>)) {
      if (row?.stats) map.set(String(id), row.stats);
    }
    return map;
  });
}

function allowFluidFallback(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

/** League-scored fantasy points each picked-up player produced over a week range. */
export async function fetchPickupResultsPreferred(input: {
  identifier: string;
  platform: string;
  s2?: string | null;
  swid?: string | null;
  requests: PickupRequest[];
}): Promise<Record<string, PickupResult>> {
  const platform = String(input.platform ?? "sleeper").trim().toLowerCase();
  const requests = input.requests ?? [];
  if (!requests.length) return {};

  if (platform === "sleeper" && /^\d{6,}$/.test(String(input.identifier ?? "").trim())) {
    try {
      const state = await getCached("nfl-state-pickup-v1", 10 * 60 * 1000, async () => {
        const s = await sleeperJson<{ season?: string; week?: number }>(`${SLEEPER}/state/nfl`);
        return {
          season: String(s?.season ?? new Date().getFullYear()),
          week: Math.max(1, Number(s?.week ?? 1) || 1),
        };
      });
      const scoring = await fetchLeagueScoringPreferred({
        identifier: input.identifier,
        platform,
      });
      const lastWeek = Math.min(18, state.week);
      const weeks = new Set<number>();
      for (const r of requests) {
        for (let w = Math.max(1, r.fromWeek); w <= Math.min(lastWeek, r.toWeek); w++) weeks.add(w);
      }
      const lines = new Map<number, Map<string, Record<string, number>>>();
      await Promise.all(
        [...weeks].map(async (w) => {
          lines.set(w, await weekStatMap(state.season, w));
        }),
      );

      const out: Record<string, PickupResult> = {};
      for (const r of requests) {
        let pts = 0;
        let games = 0;
        for (let w = Math.max(1, r.fromWeek); w <= Math.min(lastWeek, r.toWeek); w++) {
          const stats = lines.get(w)?.get(r.playerId);
          if (!stats) continue;
          const scored = scoreStats(stats, scoring.map);
          if (scored == null) continue;
          pts += scored;
          games += 1;
        }
        out[r.key] = { pts: Math.round(pts * 10) / 10, games };
      }
      return out;
    } catch {
      if (!allowFluidFallback()) return {};
    }
  }

  if (!allowFluidFallback() && platform === "sleeper") return {};

  const identifier = String(input.identifier ?? "").trim();
  const fingerprint = requests
    .map((r) => `${r.key}:${r.playerId}:${r.fromWeek}-${r.toWeek}`)
    .sort()
    .join("|");
  const fluidKey = espnFluidCacheKey("pickup", identifier, platform, fingerprint);
  const { getPickupResults } = await import("@/lib/players.functions");
  return espnFluidMemo(fluidKey, ESPN_FLUID_TTL_MS, () =>
    getPickupResults({
      data: {
        identifier,
        platform,
        ...(input.s2 ? { s2: input.s2 } : {}),
        ...(input.swid ? { swid: input.swid } : {}),
        requests,
      },
    }),
  );
}
