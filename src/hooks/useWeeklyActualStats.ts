import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import { useNflState } from "@/hooks/useLeagueProjections";
import { liveRefreshMs, useNflGameProgress } from "@/hooks/useNflGameProgress";
import { isPageVisible, visibleRefetchInterval } from "@/lib/page-visibility";
import { fetchWeeklyActualStatRows } from "@/lib/sleeper-week-stats";

/** Floor live box-score polls so visitor IPs stay far under Sleeper's ~1000/min. */
const LIVE_STATS_FLOOR_MS = 45 * 1000;
/**
 * TLN / mobile broadcast: shorter floor so box scores move with the 5s matchup
 * poll without a second Sleeper stampede (shared getCached key coalesces).
 */
const BROADCAST_STATS_FLOOR_MS = 12 * 1000;
const DEFAULT_STATS_CACHE_MS = 30 * 1000;
const BROADCAST_STATS_CACHE_MS = 12 * 1000;

export type WeeklyActualStatsPace = "default" | "broadcast";

/**
 * Live / final weekly box-score stat lines for the Statistics tab.
 * Pass `week` to follow the My Team week selector.
 * Hidden tabs never poll; in-game floor is 45s (12s on broadcast).
 */
export function useWeeklyActualStats(
  week?: number | null,
  opts?: { pace?: WeeklyActualStatsPace },
) {
  const pace = opts?.pace ?? "default";
  const broadcast = pace === "broadcast";
  const safeWeek = week != null && week > 0 ? week : null;
  const nflState = useNflState();
  const season = nflState.data?.season ?? String(new Date().getUTCFullYear());
  const pollWeek = safeWeek ?? nflState.data?.week ?? null;
  const { progressByNflTeam, currentWeek } = useNflGameProgress(pollWeek);
  const liveMs = liveRefreshMs(pollWeek, currentWeek, progressByNflTeam);
  const floor = broadcast ? BROADCAST_STATS_FLOOR_MS : LIVE_STATS_FLOOR_MS;
  const cacheTtl = broadcast ? BROADCAST_STATS_CACHE_MS : DEFAULT_STATS_CACHE_MS;
  const capped =
    liveMs === false ? false : Math.max(floor, typeof liveMs === "number" ? liveMs : floor);

  const query = useQuery({
    queryKey: ["sleeper-weekly-actual-stats", season, safeWeek ?? "auto", pace],
    enabled: Boolean(nflState.data?.season || safeWeek),
    staleTime: cacheTtl,
    refetchInterval: visibleRefetchInterval(capped),
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async () => {
      if (!isPageVisible()) return new Map<string, Record<string, number>>();
      const rows = await fetchWeeklyActualStatRows(season, pollWeek ?? 1, cacheTtl);
      return new Map(Object.entries(rows));
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
