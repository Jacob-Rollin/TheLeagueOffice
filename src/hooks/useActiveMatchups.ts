import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { liveRefreshMs, useNflGameProgress } from "@/hooks/useNflGameProgress";
import { getConnectionMatchups } from "@/lib/league.functions";

/** Weekly host matchup rows for the active synced league. */
export function useActiveMatchups(week: number | null | undefined) {
  const { activeLeague } = useActiveLeague();
  const id = activeLeague?.id ?? null;
  const safeWeek = week != null && week > 0 ? week : null;
  // Shares the scoreboard query with the page, so this adds no extra requests.
  const { progressByNflTeam, currentWeek } = useNflGameProgress(safeWeek);
  const isPastWeek = safeWeek != null && currentWeek != null && safeWeek < currentWeek;

  const query = useQuery({
    queryKey: ["active-matchups", id, safeWeek],
    enabled: Boolean(activeLeague?.leagueId && safeWeek),
    retry: false,
    staleTime: isPastWeek ? 10 * 60 * 1000 : 8 * 1000,
    refetchInterval: liveRefreshMs(safeWeek, currentWeek, progressByNflTeam),
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
