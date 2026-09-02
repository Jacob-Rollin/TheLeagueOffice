import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { getConnectionRosters } from "@/lib/league.functions";
import type { Player } from "@/lib/draft";

export type ResolvedRosterTeam = {
  slot: number;
  team: string;
  owner: string;
  isMine: boolean;
  players: Player[];
};

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Rosters for every team in the active synced league, resolved against the
 * loaded player registry so the UI can work with plain Player objects.
 */
export function useLeagueRosters(players: Player[]) {
  const { activeLeague } = useActiveLeague();
  const identifier = activeLeague?.leagueId ?? "";
  const platform = activeLeague?.platform ?? "sleeper";

  const query = useQuery({
    queryKey: ["league-rosters", activeLeague?.id ?? "none"],
    enabled: Boolean(identifier),
    staleTime: 5 * 60 * 1000,
    // Stale-while-revalidate: serve the cached snapshot instantly, then
    // silently refresh from the league provider on every mount.
    refetchOnMount: "always",
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

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const byName = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) {
      const key = normalize(p.name);
      if (!map.has(key)) map.set(key, p);
    }
    return map;
  }, [players]);

  const teams = useMemo<ResolvedRosterTeam[]>(() => {
    const rows = query.data?.teams ?? [];
    return rows.map((t) => {
      const resolved: Player[] = [];
      const seen = new Set<string>();
      for (const id of t?.playerIds ?? []) {
        const p = byId.get(id);
        if (p && !seen.has(p.id)) {
          seen.add(p.id);
          resolved.push(p);
        }
      }
      for (const name of t?.playerNames ?? []) {
        const p = byName.get(normalize(name));
        if (p && !seen.has(p.id)) {
          seen.add(p.id);
          resolved.push(p);
        }
      }
      return {
        slot: t?.slot ?? 0,
        team: t?.team ?? "Team",
        owner: t?.owner ?? "",
        isMine: Boolean(t?.isMine),
        players: resolved,
      };
    });
  }, [query.data, byId, byName]);

  const myTeam = useMemo(() => teams.find((t) => t.isMine) ?? null, [teams]);

  const rosteredIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of teams) for (const p of t.players) set.add(p.id);
    return set;
  }, [teams]);

  return {
    synced: Boolean(activeLeague) && teams.length > 0,
    loading: query.isLoading,
    /** True while a silent background revalidation is in flight. */
    refreshing: query.isFetching && !query.isLoading,
    teams,
    myTeam,
    myTeamName: query.data?.myTeamName ?? activeLeague?.teamName ?? null,
    rosteredIds,
  };
}
