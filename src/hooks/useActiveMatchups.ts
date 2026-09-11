import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { getConnectionMatchups } from "@/lib/league.functions";

/** Current-week host matchup rows for the active synced league. */
export function useActiveMatchups(week: number | null | undefined) {
  const { activeLeague } = useActiveLeague();
  const id = activeLeague?.id ?? null;
  const safeWeek = week != null && week > 0 ? week : null;

  const query = useQuery({
    queryKey: ["active-matchups", id, safeWeek],
    enabled: Boolean(activeLeague?.leagueId && safeWeek),
    retry: false,
    staleTime: 30 * 1000,
    refetchInterval: 45 * 1000,
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
