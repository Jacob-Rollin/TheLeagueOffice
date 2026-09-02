import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { getConnectionRosters } from "@/lib/league.functions";
import type { Player } from "@/lib/draft";
import {
  markRevalidated,
  readRosterCache,
  shouldRevalidate,
  writeRosterCache,
} from "@/lib/roster-cache";

export type ResolvedRosterTeam = {
  slot: number;
  team: string;
  owner: string;
  isMine: boolean;
  /** Every rostered asset (starters + bench + IR). */
  players: Player[];
  /** Native starter order from the host platform, aligned to rosterPositions. */
  starters: (Player | null)[];
  /** Players parked in a designated IR / IL slot. */
  ir: Player[];
  /** Everything that is neither a native starter nor on IR. */
  bench: Player[];
};

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Defense aliases: host platforms emit "Lions D/ST", "Detroit Lions",
 * "DET D/ST" etc. Reduce all of them to the team nickname so multiple
 * defenses on one roster resolve cleanly instead of falling through as
 * unmapped "Empty slot" rows.
 */
const defenseKey = (raw: string) => {
  const cleaned = raw
    .toLowerCase()
    .replace(/d\s*\/?\s*st|dst|defense|special teams/g, " ")
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.length ? normalize(parts[parts.length - 1]!) : "";
};

/**
 * Rosters for every team in the active synced league, resolved against the
 * loaded player registry so the UI can work with plain Player objects.
 */
export function useLeagueRosters(players: Player[], options?: { cacheKey?: string }) {
  const { activeLeague } = useActiveLeague();
  const identifier = activeLeague?.leagueId ?? "";
  const platform = activeLeague?.platform ?? "sleeper";
  const queryClient = useQueryClient();

  const leagueKey = activeLeague?.id ?? "none";
  const queryKey = useMemo(() => ["league-rosters", leagueKey] as const, [leagueKey]);
  const storeKey = `${leagueKey}:${options?.cacheKey ?? "all"}`;

  // Hard 5-minute barrier, resolved once per mount so the decision cannot
  // flip mid-render and trigger an unexpected network burst.
  const [barrierOpen] = useState(() => shouldRevalidate(storeKey));
  const hydrated = useRef(false);

  // Instant paint from the local IndexedDB snapshot.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    void (async () => {
      if (queryClient.getQueryData(queryKey)) return;
      const cached = await readRosterCache<Awaited<ReturnType<typeof getConnectionRosters>>>(
        storeKey,
      );
      if (cached && !queryClient.getQueryData(queryKey)) {
        queryClient.setQueryData(queryKey, cached);
      }
    })();
  }, [queryClient, queryKey, storeKey]);

  const query = useQuery({
    queryKey,
    enabled: Boolean(identifier),
    staleTime: 5 * 60 * 1000,
    // Stale-while-revalidate: serve the cached snapshot instantly, then
    // silently refresh from the league provider — but only once the
    // 5-minute revalidation barrier has elapsed for this team.
    refetchOnMount: barrierOpen ? "always" : false,
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

  // Persist every successful sync and stamp the barrier.
  useEffect(() => {
    if (!query.data || query.isFetching) return;
    markRevalidated(storeKey);
    void writeRosterCache(storeKey, query.data);
  }, [query.data, query.isFetching, storeKey]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const byName = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) {
      const key = p.pos === "DEF" ? defenseKey(p.name) : normalize(p.name);
      if (key && !map.has(key)) map.set(key, p);
      const plain = normalize(p.name);
      if (plain && !map.has(plain)) map.set(plain, p);
    }
    return map;
  }, [players]);

  const rosterPositions = useMemo(
    () => query.data?.rosterPositions ?? [],
    [query.data],
  );

  const teams = useMemo<ResolvedRosterTeam[]>(() => {
    const rows = query.data?.teams ?? [];
    const lookup = (raw: string): Player | undefined =>
      byName.get(normalize(raw)) ?? byName.get(defenseKey(raw));

    return rows.map((t) => {
      const resolved: Player[] = [];
      const seen = new Set<string>();
      const push = (p: Player | undefined) => {
        if (p && !seen.has(p.id)) {
          seen.add(p.id);
          resolved.push(p);
        }
      };
      for (const id of t?.playerIds ?? []) push(byId.get(id));
      for (const name of t?.playerNames ?? []) push(lookup(name));

      // Native starters, aligned index-for-index with the slot template.
      const starterSource = (t?.starterIds ?? []).length
        ? (t?.starterIds ?? []).map((id) => (id && id !== "0" ? byId.get(id) ?? null : null))
        : (t?.starterNames ?? []).map((n) => lookup(n) ?? null);
      const starters = starterSource.map((p) => p ?? null);

      const irSource = (t?.irIds ?? []).length
        ? (t?.irIds ?? []).map((id) => byId.get(id))
        : (t?.irNames ?? []).map((n) => lookup(n));
      const ir = irSource.filter((p): p is Player => Boolean(p));

      const usedIds = new Set<string>();
      for (const p of starters) if (p) usedIds.add(p.id);
      for (const p of ir) usedIds.add(p.id);
      const bench = resolved.filter((p) => !usedIds.has(p.id));

      return {
        slot: t?.slot ?? 0,
        team: t?.team ?? "Team",
        owner: t?.owner ?? "",
        isMine: Boolean(t?.isMine),
        players: resolved,
        starters,
        ir,
        bench,
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
    rosterPositions,
    rosteredIds,
  };
}
