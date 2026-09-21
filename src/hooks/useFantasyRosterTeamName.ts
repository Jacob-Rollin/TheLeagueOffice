import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { getConnectionRosters } from "@/lib/league.functions";

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Fantasy team name that currently rosters this player in the active synced
 * league. Returns null when no league is synced or the player is a free agent.
 * Shares the same React Query cache as `useLeagueRosters`.
 */
export function useFantasyRosterTeamName(
  playerId: string | null | undefined,
  playerName?: string | null,
): string | null {
  const { activeLeague } = useActiveLeague();
  const identifier = activeLeague?.leagueId ?? "";
  const platform = activeLeague?.platform ?? "sleeper";
  const leagueKey = activeLeague?.id ?? "none";

  const query = useQuery({
    queryKey: ["league-rosters", leagueKey] as const,
    enabled: Boolean(identifier && playerId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: () =>
      getConnectionRosters({
        data: {
          identifier,
          platform,
          ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
          ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
        },
      }),
  });

  return useMemo(() => {
    if (!activeLeague || !playerId) return null;
    const teams = query.data?.teams ?? [];
    if (teams.length === 0) return null;

    const byId = teams.find((t) => (t.playerIds ?? []).includes(playerId));
    if (byId?.team?.trim()) return byId.team.trim();

    const needle = playerName ? normalize(playerName) : "";
    if (!needle) return null;
    const byName = teams.find((t) =>
      (t.playerNames ?? []).some((n) => normalize(String(n)) === needle),
    );
    return byName?.team?.trim() || null;
  }, [activeLeague, playerId, playerName, query.data?.teams]);
}
