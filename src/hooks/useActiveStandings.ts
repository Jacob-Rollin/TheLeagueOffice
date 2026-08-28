import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { getConnectionStandings } from "@/lib/league.functions";

/** Standings for the globally selected league, cached per connection. */
export function useActiveStandings() {
  const { activeLeague } = useActiveLeague();
  const id = activeLeague?.id ?? null;

  const query = useQuery({
    queryKey: ["active-standings", id],
    enabled: Boolean(activeLeague?.leagueId),
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () =>
      await getConnectionStandings({
        data: {
          identifier: activeLeague?.leagueId ?? "",
          platform: activeLeague?.platform ?? "sleeper",
          ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
          ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
        },
      }),
  });

  return { activeLeague, standings: query.data ?? null, loading: query.isLoading };
}
