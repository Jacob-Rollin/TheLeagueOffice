import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import { useNflState } from "@/hooks/useLeagueProjections";
import { liveRefreshMs, useNflGameProgress } from "@/hooks/useNflGameProgress";
import { getCached } from "@/lib/sleeper-cache";
import { SLEEPER_BASE, positionsQuery } from "@/lib/players-build";
import { isPageVisible, visibleRefetchInterval } from "@/lib/page-visibility";
import { acquireSleeperPermit } from "@/lib/sleeper-rate-budget";

/** Floor live box-score polls so visitor IPs stay far under Sleeper's ~1000/min. */
const LIVE_STATS_FLOOR_MS = 45 * 1000;

async function fetchWeeklyActualStats(
  season: string,
  week: number,
): Promise<Map<string, Record<string, number>>> {
  return getCached(`weekly-actual-stats-v1:${season}|${week}`, 30 * 1000, async () => {
    if (!acquireSleeperPermit("live")) return new Map();
    const url = `${SLEEPER_BASE}/stats/nfl/${season}/${week}?season_type=regular&${positionsQuery()}`;
    const res = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
    if (res?.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!acquireSleeperPermit("live")) return new Map();
      const retry = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
      if (!retry?.ok) return new Map();
      return parseStats(await retry.json());
    }
    if (!res?.ok) return new Map();
    return parseStats(await res.json());
  });
}

function parseStats(rows: unknown): Map<string, Record<string, number>> {
  const map = new Map<string, Record<string, number>>();
  if (Array.isArray(rows)) {
    for (const row of rows as { player_id?: string; stats?: Record<string, number> }[]) {
      if (row?.player_id && row.stats) map.set(String(row.player_id), row.stats);
    }
  }
  return map;
}

/**
 * Live / final weekly box-score stat lines for the Statistics tab.
 * Pass `week` to follow the My Team week selector.
 * Hidden tabs never poll; in-game floor is 45s.
 */
export function useWeeklyActualStats(week?: number | null) {
  const safeWeek = week != null && week > 0 ? week : null;
  const nflState = useNflState();
  const season = nflState.data?.season ?? String(new Date().getUTCFullYear());
  const pollWeek = safeWeek ?? nflState.data?.week ?? null;
  const { progressByNflTeam, currentWeek } = useNflGameProgress(pollWeek);
  const liveMs = liveRefreshMs(pollWeek, currentWeek, progressByNflTeam);
  const capped =
    liveMs === false ? false : Math.max(LIVE_STATS_FLOOR_MS, typeof liveMs === "number" ? liveMs : LIVE_STATS_FLOOR_MS);

  const query = useQuery({
    queryKey: ["sleeper-weekly-actual-stats", season, safeWeek ?? "auto"],
    enabled: Boolean(nflState.data?.season || safeWeek),
    staleTime: 30 * 1000,
    refetchInterval: visibleRefetchInterval(capped),
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: () => {
      if (!isPageVisible()) return Promise.resolve(new Map<string, Record<string, number>>());
      return fetchWeeklyActualStats(season, pollWeek ?? 1);
    },
  });

  const statsFor = useCallback(
    (playerId: string): Record<string, number> | null => {
      return query.data?.get(playerId) ?? null;
    },
    [query.data],
  );

  return {
    statsFor,
    loading: query.isLoading,
    dataUpdatedAt: query.dataUpdatedAt,
  };
}
