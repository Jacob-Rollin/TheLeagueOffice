import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { fetchLeagueActivityForConnection } from "@/lib/league-activity-fetch";
import type { LeagueActivityEvent } from "@/lib/league.functions";

/** Recent host-platform transactions for the active synced league. */
export function useLeagueActivity() {
  const { activeLeague } = useActiveLeague();
  const id = activeLeague?.id ?? null;

  const query = useQuery({
    queryKey: ["league-activity", id],
    enabled: Boolean(activeLeague?.leagueId),
    retry: false,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<LeagueActivityEvent[]> =>
      fetchLeagueActivityForConnection({
        leagueId: activeLeague?.leagueId ?? "",
        platform: activeLeague?.platform ?? "sleeper",
        connectionId: activeLeague?.id,
        ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
        ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
      }),
  });

  return {
    events: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
