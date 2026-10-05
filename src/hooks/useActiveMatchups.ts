import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { liveRefreshMs, useNflGameProgress } from "@/hooks/useNflGameProgress";
import { getConnectionMatchups } from "@/lib/league.functions";

/**
 * Lineup edits on the host happen any time before kickoff, so the current week
 * keeps a 45s floor even between games. These calls never touch Supabase and
 * hidden tabs don't poll.
 */
const LINEUP_REFRESH_MS = 45 * 1000;

/** Weekly host matchup rows for the active synced league. */
export function useActiveMatchups(week: number | null | undefined) {
  const { activeLeague } = useActiveLeague();
  const id = activeLeague?.id ?? null;
  const safeWeek = week != null && week > 0 ? week : null;
  // Shares the scoreboard query with the page, so this adds no extra requests.
  const { progressByNflTeam, currentWeek } = useNflGameProgress(safeWeek);
  const isPastWeek = safeWeek != null && currentWeek != null && safeWeek < currentWeek;
  const liveMs = liveRefreshMs(safeWeek, currentWeek, progressByNflTeam);
  const refetchInterval = liveMs === false ? false : Math.min(liveMs, LINEUP_REFRESH_MS);

  const query = useQuery({
    queryKey: ["active-matchups", id, safeWeek],
    enabled: Boolean(activeLeague?.leagueId && safeWeek),
    retry: false,
    staleTime: isPastWeek ? 10 * 60 * 1000 : 20 * 1000,
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
