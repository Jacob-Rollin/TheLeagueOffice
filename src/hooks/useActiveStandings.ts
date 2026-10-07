import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { getConnectionStandings } from "@/lib/league.functions";
import {
  canFetchStandingsClient,
  fetchSleeperStandingsClient,
} from "@/lib/sleeper-standings-client";
import { ensureSleeperNumericLeagueId } from "@/lib/sleeper-resolve-client";

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
      let hostId = leagueId;
      if (platform === "sleeper" && !canFetchStandingsClient(platform, hostId)) {
        hostId = (await ensureSleeperNumericLeagueId(hostId).catch(() => null)) ?? hostId;
      }
      if (canFetchStandingsClient(platform, hostId)) {
        const client = await fetchSleeperStandingsClient(hostId).catch(() => null);
        if (client?.rows?.length) return client;
        // Production: do not burn Fluid for public Sleeper standings.
        try {
          if (import.meta.env.PROD) return client;
        } catch {
          /* ignore */
        }
      }
      if (platform === "sleeper") {
        try {
          if (import.meta.env.PROD) return null;
        } catch {
          /* ignore */
        }
      }
      return await getConnectionStandings({
        data: {
          identifier: hostId,
          platform,
          ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
          ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
        },
      });
    },
  });

  return { activeLeague, standings: query.data ?? null, loading: query.isLoading };
}
