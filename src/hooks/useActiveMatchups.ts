import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { liveRefreshMs, useNflGameProgress } from "@/hooks/useNflGameProgress";
import { getConnectionMatchups } from "@/lib/league.functions";

/**
 * During live games, keep a 45s ceiling so lineup/score shifts show quickly.
 * Between games / all-final, honor the slower liveRefreshMs (2–10m) so we do
 * not hammer Fluid with getConnectionMatchups every 45s.
 */
const LIVE_LINEUP_CEILING_MS = 45 * 1000;

/** Weekly host matchup rows for the active synced league. */
export function useActiveMatchups(week: number | null | undefined) {
  const { activeLeague } = useActiveLeague();
  const id = activeLeague?.id ?? null;
  const safeWeek = week != null && week > 0 ? week : null;
  // Shares the scoreboard query with the page, so this adds no extra requests.
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
    enabled: Boolean(activeLeague?.leagueId && safeWeek),
    retry: false,
    staleTime: isPastWeek ? 10 * 60 * 1000 : 60 * 1000,
    refetchInterval,
    queryFn: async () =>
      await getConnectionMatchups({
        data: {
          identifier: activeLeague?.leagueId ?? "",
          platform: (activeLeague?.platform ?? "sleeper").trim().toLowerCase(),
          week: safeWeek ?? 1,
          ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
          ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
          ...(id ? { connectionId: id } : {}),
        },
      }),
  });

  return {
    matchups: query.data ?? null,
    loading: query.isLoading,
  };
}
