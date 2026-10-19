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
 * Live / final weekly box-score stat lines (Sleeper client cache first).
 * Hidden tabs skip refetch without wiping good data; soft-retry once.
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
    retry: 1,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      // Never commit an empty Map while hidden — that wiped live scores to 0.00.
      if (!isPageVisible()) {
        throw new Error("page-hidden");
      }
      const rows = await fetchWeeklyActualStatRows(season, pollWeek ?? 1, cacheTtl);
      return new Map(Object.entries(rows));
    },
  });

  const statsFor = useCallback(
    (playerId: string): Record<string, number> | null => {
      const id = String(playerId ?? "").trim();
      if (!id) return null;
      return query.data?.get(id) ?? null;
    },
    [query.data],
  );

  return {
    statsFor,
    /** Full week map — same client cache mobile Matchup/Team use for live overlays. */
    statsById: query.data,
    loading: query.isLoading,
    ready: Boolean(query.data && query.data.size > 0),
    dataUpdatedAt: query.dataUpdatedAt,
  };
}
