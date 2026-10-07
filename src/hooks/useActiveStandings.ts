import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { getConnectionStandings } from "@/lib/league.functions";
import {
  canFetchStandingsClient,
  fetchSleeperStandingsClient,
} from "@/lib/sleeper-standings-client";

/** Standings for the globally selected league, cached per connection. */
export function useActiveStandings() {
  const { activeLeague } = useActiveLeague();
  const id = activeLeague?.id ?? null;
  const leagueId = activeLeague?.leagueId ?? "";
  const platform = (activeLeague?.platform ?? "sleeper").trim().toLowerCase();

  const query = useQuery({
    queryKey: ["active-standings", id],
    enabled: Boolean(leagueId),
    retry: false,
    staleTime: 15 * 60 * 1000,
    queryFn: async () => {
      if (canFetchStandingsClient(platform, leagueId)) {
        const client = await fetchSleeperStandingsClient(leagueId).catch(() => null);
        if (client?.rows?.length) return client;
        // Production: do not burn Fluid for public Sleeper standings.
        try {
          if (import.meta.env.PROD) return client;
        } catch {
          /* ignore */
        }
      }
      return await getConnectionStandings({
        data: {
          identifier: leagueId,
          platform,
          ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
          ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
        },
      });
    },
  });

  return { activeLeague, standings: query.data ?? null, loading: query.isLoading };
}
