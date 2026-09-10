import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { getConnectionTransactions, type LeagueActivityEvent } from "@/lib/league.functions";

/** Recent host-platform transactions for the active synced league. */
export function useLeagueActivity() {
  const { activeLeague } = useActiveLeague();
  const id = activeLeague?.id ?? null;

  const query = useQuery({
    queryKey: ["league-activity", id],
    enabled: Boolean(activeLeague?.leagueId),
    retry: false,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<LeagueActivityEvent[]> =>
      (await getConnectionTransactions({
        data: {
          identifier: activeLeague?.leagueId ?? "",
          platform: activeLeague?.platform ?? "sleeper",
          ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
          ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
        },
      })) ?? [],
  });

  return {
    events: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
