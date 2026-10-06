import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useNflState } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  getConnectionMatchups,
  getConnectionSettings,
  getRestOfSeasonProjections,
  getStartingSlotRanks,
} from "@/lib/league.functions";
import { computeStandingsAnalytics, type TeamAnalytics } from "@/lib/standings-analytics";

export type RowAnalytics = TeamAnalytics & {
  pfRank: number | null;
  maxPfRank: number | null;
  effRank: number | null;
};

/** 1 = highest; rows without a value are left out. */
export function rankBy<T>(items: T[], key: (item: T) => number | null, id: (item: T) => number) {
  const ranked = items.filter((item) => key(item) != null).sort((a, b) => key(b)! - key(a)!);
  return new Map(ranked.map((item, index) => [id(item), index + 1]));
}

function connectionArgs(league: ReturnType<typeof useActiveLeague>["activeLeague"]) {
  return {
    identifier: league?.leagueId ?? "",
    platform: (league?.platform ?? "sleeper").trim().toLowerCase(),
    ...(league?.s2 ? { s2: league.s2 } : {}),
    ...(league?.swid ? { swid: league.swid } : {}),
  };
}

/**
 * League-wide standings analytics shared by Standings and My Team: completed-week matchups,
 * the remaining schedule, rest-of-season projections, and the simulated playoff / title odds.
 * `history` loads completed weeks; `forecast` also loads the schedule and runs the simulation.
 */
export function useLeagueAnalytics({ history, forecast }: { history: boolean; forecast: boolean }) {
  const { activeLeague } = useActiveLeague();
  const { standings } = useActiveStandings();
  const { rosterPositions } = useLeagueRosters([]);
  const { data: playersPayload } = useSleeperPlayers();
  const nflWeek = useNflState();
  const currentWeek = nflWeek.data?.week ?? null;
  const leagueId = activeLeague?.id ?? null;
  const hasLeague = Boolean(activeLeague?.leagueId);
  const loadHistory = history || forecast;

  /** Completed NFL weeks only (1 … current−1). The live week is excluded. */
  const completedWeekNumbers = useMemo(() => {
    if (currentWeek == null || currentWeek <= 1) return [] as number[];
    return Array.from({ length: currentWeek - 1 }, (_, i) => i + 1);
  }, [currentWeek]);

  const historyQueries = useQueries({
    queries: completedWeekNumbers.map((week) => ({
      queryKey: ["active-matchups", leagueId, week],
      enabled: hasLeague && loadHistory,
      retry: false,
      staleTime: 10 * 60 * 1000,
      queryFn: async () =>
        await getConnectionMatchups({
          data: {
            ...connectionArgs(activeLeague),
            week,
            ...(activeLeague?.id ? { connectionId: activeLeague.id } : {}),
          },
        }),
    })),
  });
  const historyStamp = historyQueries
    .map((q) => `${q.dataUpdatedAt}:${q.data?.week ?? "x"}:${q.data?.entries?.length ?? 0}`)
    .join("|");
  const historyLoading = historyQueries.some((q) => q.isLoading);

  const settingsQuery = useQuery({
    queryKey: ["dashboard-league-settings", leagueId],
    enabled: hasLeague && forecast,
    retry: false,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => await getConnectionSettings({ data: connectionArgs(activeLeague) }),
  });
  const playoffStartWeek = settingsQuery.data?.playoffStartWeek ?? 15;
  const playoffTeams = settingsQuery.data?.playoffTeams ?? ((standings?.rows.length ?? 0) >= 10 ? 6 : 4);

  /** Rest of the regular season, current week included (it isn't final yet). */
  const remainingWeekNumbers = useMemo(() => {
    if (currentWeek == null || currentWeek >= playoffStartWeek) return [] as number[];
    return Array.from({ length: playoffStartWeek - currentWeek }, (_, i) => currentWeek + i);
  }, [currentWeek, playoffStartWeek]);

  const scheduleQueries = useQueries({
    queries: remainingWeekNumbers.map((week) => ({
      queryKey: ["active-matchups", leagueId, week],
      enabled: hasLeague && forecast,
      retry: false,
      staleTime: 30 * 60 * 1000,
      queryFn: async () =>
        await getConnectionMatchups({
          data: {
            ...connectionArgs(activeLeague),
            week,
            ...(activeLeague?.id ? { connectionId: activeLeague.id } : {}),
          },
        }),
    })),
  });
  const scheduleStamp = scheduleQueries.map((q) => `${q.dataUpdatedAt}:${q.data?.entries?.length ?? 0}`).join("|");

  const rosProjections = useQuery({
    queryKey: ["ros-projections", leagueId, remainingWeekNumbers[0] ?? null, remainingWeekNumbers.at(-1) ?? null],
    enabled: hasLeague && forecast && remainingWeekNumbers.length > 0,
    retry: false,
    staleTime: 30 * 60 * 1000,
    queryFn: async () =>
      await getRestOfSeasonProjections({
        data: {
          ...connectionArgs(activeLeague),
          fromWeek: remainingWeekNumbers[0]!,
          toWeek: remainingWeekNumbers.at(-1)!,
        },
      }),
  });
  const scheduleLoading = scheduleQueries.some((q) => q.isLoading) || rosProjections.isLoading;

  const analytics = useMemo((): Map<number, RowAnalytics> | null => {
    const rows = standings?.rows ?? [];
    if (!forecast || !rows.length || !playersPayload || currentWeek == null) return null;
    if (historyLoading || scheduleLoading) return null;
    const posById = new Map(playersPayload.players.map((p) => [p.id, p.pos]));
    const posOf = (id: string) => posById.get(id) ?? (/^[A-Z]{2,3}$/.test(id) ? "DEF" : null);

    const base = computeStandingsAnalytics({
      teams: rows,
      completedWeeks: historyQueries.map((q) => q.data?.entries ?? []).filter((entries) => entries.length >= 2),
      remainingWeeks: scheduleQueries.map((q) => q.data?.entries ?? []),
      rosterPositions,
      posOf,
      playoffTeams,
      projectedByWeek: remainingWeekNumbers.map((week) => {
        const index = rosProjections.data?.weeks.indexOf(week) ?? -1;
        const row = index >= 0 ? rosProjections.data?.byWeek[index] : undefined;
        return new Map(Object.entries(row ?? {}).map(([slot, pts]) => [Number(slot), pts]));
      }),
    });

    const list = rows.map((r) => ({ id: r.rosterId, pf: r.pointsFor, a: base.get(r.rosterId) }));
    const pfRank = rankBy(list, (x) => x.pf, (x) => x.id);
    const maxRank = rankBy(list, (x) => x.a?.maxPf ?? null, (x) => x.id);
    const effRank = rankBy(list, (x) => x.a?.efficiency ?? null, (x) => x.id);
    const out = new Map<number, RowAnalytics>();
    for (const { id, a } of list) {
      if (!a) continue;
      out.set(id, {
        ...a,
        pfRank: pfRank.get(id) ?? null,
        maxPfRank: maxRank.get(id) ?? null,
        effRank: effRank.get(id) ?? null,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query stamps track fetch completion
  }, [
    forecast,
    standings,
    playersPayload,
    currentWeek,
    historyStamp,
    historyLoading,
    scheduleStamp,
    scheduleLoading,
    rosterPositions,
    playoffTeams,
    remainingWeekNumbers,
    rosProjections.data,
  ]);

  return {
    currentWeek,
    nflWeekLoading: nflWeek.isLoading,
    completedWeekNumbers,
    historyQueries,
    historyStamp,
    historyLoading,
    remainingWeekNumbers,
    scheduleQueries,
    scheduleLoading,
    rosProjections: rosProjections.data ?? null,
    playoffStartWeek,
    playoffTeams,
    playoffTeamsSetting: settingsQuery.data?.playoffTeams ?? null,
    analytics,
    analyticsLoading:
      forecast && analytics == null && (nflWeek.isLoading || historyLoading || scheduleLoading || !playersPayload),
  };
}

/** Best offensive lineup per team by projected rest-of-season points per game (current week → 17). */
export function useStartingSlotRanks(currentWeek: number | null, enabled = true) {
  const { activeLeague } = useActiveLeague();
  const fromWeek = currentWeek == null ? null : Math.min(Math.max(currentWeek, 1), 17);
  return useQuery({
    queryKey: ["starting-slot-ranks", activeLeague?.id ?? null, fromWeek],
    enabled: Boolean(enabled && activeLeague?.leagueId && fromWeek != null),
    retry: false,
    staleTime: 30 * 60 * 1000,
    queryFn: async () =>
      await getStartingSlotRanks({
        data: { ...connectionArgs(activeLeague), fromWeek: fromWeek!, toWeek: 17 },
      }),
  });
}
