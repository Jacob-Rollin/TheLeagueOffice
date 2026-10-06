import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { liveRefreshMs, useNflGameProgress } from "@/hooks/useNflGameProgress";
import {
  fetchLeagueWeekMatchupsCdn,
  isLiveMatchupFresh,
  maybeRefreshMatchupsViaFluid,
} from "@/lib/league-matchups-cdn";
import { isPageVisible, visibleRefetchInterval } from "@/lib/page-visibility";

/**
 * During live games, keep a 45s ceiling so lineup/score shifts show quickly.
 * Polls hit CDN/TiDB first; Fluid host refresh only when the snap is cold
 * and this tab is visible.
 */
const LIVE_LINEUP_CEILING_MS = 45 * 1000;

/** Weekly host matchup rows for the active synced league. */
export function useActiveMatchups(week: number | null | undefined) {
  const { activeLeague } = useActiveLeague();
  const id = activeLeague?.id ?? null;
  const leagueId = activeLeague?.leagueId ?? "";
  const safeWeek = week != null && week > 0 ? week : null;
  const { progressByNflTeam, currentWeek } = useNflGameProgress(safeWeek);
  const isPastWeek = safeWeek != null && currentWeek != null && safeWeek < currentWeek;
  const liveMs = liveRefreshMs(safeWeek, currentWeek, progressByNflTeam);
  const anyInProgress = [...(progressByNflTeam?.values() ?? [])].some((g) => g.phase === "in");
  const refetchInterval =
    liveMs === false
      ? false
      : anyInProgress
        ? Math.min(liveMs, LIVE_LINEUP_CEILING_MS)
        : liveMs;

  const query = useQuery({
    queryKey: ["active-matchups", id, safeWeek],
    enabled: Boolean(leagueId && safeWeek),
    retry: false,
    staleTime: isPastWeek ? 10 * 60 * 1000 : 60 * 1000,
    refetchInterval: visibleRefetchInterval(refetchInterval),
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const week = safeWeek ?? 1;
      const cdn = await fetchLeagueWeekMatchupsCdn(leagueId, week);
      const past = currentWeek != null && week < currentWeek;
      if (cdn?.board.entries.length) {
        if (past || isLiveMatchupFresh(cdn.syncedAtMs) || !isPageVisible()) {
          return cdn.board;
        }
      }
      // Cold/stale live board: one throttled Fluid refresh (writes TiDB for peers).
      const refreshed = await maybeRefreshMatchupsViaFluid({
        leagueId,
        week,
        platform: (activeLeague?.platform ?? "sleeper").trim().toLowerCase(),
        ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
        ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
        ...(id ? { connectionId: id } : {}),
        allow: isPageVisible(),
      });
      if (refreshed?.entries?.length) return refreshed;
      return cdn?.board ?? null;
    },
  });

  return {
    matchups: query.data ?? null,
    loading: query.isLoading,
  };
}
