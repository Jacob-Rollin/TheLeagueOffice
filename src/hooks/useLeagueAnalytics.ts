import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useNflState } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  completedWeekNumberList,
  completedWeeksThrough,
  standingsGamesPlayed,
} from "@/lib/completed-weeks";
import { getConnectionSettings } from "@/lib/league.functions";
import { boardHasUsableScores, fetchLeagueMatchupsHistory } from "@/lib/league-matchups-cdn";
import { isPageVisible, visibleRefetchInterval } from "@/lib/page-visibility";
import { fetchSnapRestOfSeason, fetchSnapStartingSlotRanks } from "@/lib/snap-cdn";
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
 * League-wide standings analytics shared by Standings and My Team.
 * Matchup history/schedule come from one CDN/TiDB snap (not N Fluid week calls).
 */
export function useLeagueAnalytics({ history, forecast }: { history: boolean; forecast: boolean }) {
  const { activeLeague } = useActiveLeague();
  const { standings } = useActiveStandings();
  const { rosterPositions } = useLeagueRosters([]);
  const { data: playersPayload } = useSleeperPlayers();
  const nflWeek = useNflState();
  const currentWeek = nflWeek.data?.week ?? null;
  const displayWeek = nflWeek.data?.displayWeek ?? null;
  const leagueId = activeLeague?.id ?? null;
  const platformLeagueId = activeLeague?.leagueId ?? "";
  const hasLeague = Boolean(platformLeagueId);
  const loadHistory = history || forecast;

  const gamesPlayed = useMemo(() => standingsGamesPlayed(standings?.rows), [standings?.rows]);
  const completedThrough = useMemo(
    () =>
      completedWeeksThrough({
        nflWeek: currentWeek,
        displayWeek,
        gamesPlayed,
      }),
    [currentWeek, displayWeek, gamesPlayed],
  );
  const completedWeekNumbers = useMemo(
    () =>
      completedWeekNumberList({
        nflWeek: currentWeek,
        displayWeek,
        gamesPlayed,
      }),
    [currentWeek, displayWeek, gamesPlayed],
  );

  const settingsQuery = useQuery({
    queryKey: ["dashboard-league-settings", leagueId],
    enabled: hasLeague && forecast,
    retry: false,
    staleTime: 60 * 60 * 1000,
    refetchIntervalInBackground: false,
    queryFn: async () => await getConnectionSettings({ data: connectionArgs(activeLeague) }),
  });
  const playoffStartWeek = settingsQuery.data?.playoffStartWeek ?? 15;
  const playoffTeams = settingsQuery.data?.playoffTeams ?? ((standings?.rows.length ?? 0) >= 10 ? 6 : 4);

  const remainingWeekNumbers = useMemo(() => {
    if (currentWeek == null || currentWeek >= playoffStartWeek) return [] as number[];
    // Remaining schedule starts after the latest completed slate when that
    // slate is still the NFL "current" week (standings already include it).
    const from = Math.max(currentWeek, completedThrough + 1);
    if (from >= playoffStartWeek) return [] as number[];
    return Array.from({ length: playoffStartWeek - from }, (_, i) => from + i);
  }, [currentWeek, completedThrough, playoffStartWeek]);

  const historyWeeks = useMemo(() => {
    const weeks = [...completedWeekNumbers];
    if (forecast) weeks.push(...remainingWeekNumbers);
    return weeks;
  }, [completedWeekNumbers, remainingWeekNumbers, forecast]);

  // CDN/TiDB first; Fluid backfill for weeks still missing (cold TiDB / unsynced history).
  const allMatchups = useQuery({
    queryKey: ["league-matchups-history", leagueId, historyWeeks.join(","), currentWeek, completedThrough],
    enabled: hasLeague && loadHistory && historyWeeks.length > 0,
    retry: false,
    staleTime: 10 * 60 * 1000,
    // Soft-poll CDN when the latest completed slate is still hollow — rate-limited
    // Fluid backfill lives inside fetchLeagueMatchupsHistory (no 15s storms).
    refetchInterval: visibleRefetchInterval((query) => {
      if (!history || completedThrough <= 0) return false;
      const map = query.state.data as Map<number, { board: unknown }> | undefined;
      const hit = map?.get(completedThrough) as
        | { board?: Parameters<typeof boardHasUsableScores>[0] }
        | undefined;
      return boardHasUsableScores(hit?.board) ? false : 120_000;
    }),
    refetchIntervalInBackground: false,
    queryFn: () =>
      fetchLeagueMatchupsHistory({
        leagueId: platformLeagueId,
        platform: (activeLeague?.platform ?? "sleeper").trim().toLowerCase(),
        weeks: historyWeeks,
        currentWeek,
        completedThrough,
        ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
        ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
        ...(leagueId ? { connectionId: leagueId } : {}),
        allowFluid: isPageVisible(),
      }),
  });
  const historyLoading = allMatchups.isLoading;
  const historyStamp = `${allMatchups.dataUpdatedAt}:${allMatchups.data?.size ?? 0}`;

  const rosProjections = useQuery({
    queryKey: ["ros-projections", leagueId, remainingWeekNumbers[0] ?? null, remainingWeekNumbers.at(-1) ?? null],
    enabled: hasLeague && forecast && remainingWeekNumbers.length > 0,
    retry: false,
    staleTime: 30 * 60 * 1000,
    refetchIntervalInBackground: false,
    queryFn: async () =>
      fetchSnapRestOfSeason({
        ...connectionArgs(activeLeague),
        fromWeek: remainingWeekNumbers[0]!,
        toWeek: remainingWeekNumbers.at(-1)!,
      }),
  });
  const scheduleLoading = allMatchups.isLoading || rosProjections.isLoading;
  const scheduleStamp = historyStamp;

  // Compatibility shape for callers that still map over historyQueries / scheduleQueries.
  const historyQueries = useMemo(
    () =>
      completedWeekNumbers.map((week) => ({
        data: allMatchups.data?.get(week)?.board ?? null,
        dataUpdatedAt: allMatchups.dataUpdatedAt,
        isLoading: allMatchups.isLoading,
      })),
    [completedWeekNumbers, allMatchups.data, allMatchups.dataUpdatedAt, allMatchups.isLoading],
  );
  const scheduleQueries = useMemo(
    () =>
      remainingWeekNumbers.map((week) => ({
        data: allMatchups.data?.get(week)?.board ?? null,
        dataUpdatedAt: allMatchups.dataUpdatedAt,
        isLoading: allMatchups.isLoading,
      })),
    [remainingWeekNumbers, allMatchups.data, allMatchups.dataUpdatedAt, allMatchups.isLoading],
  );

  const analytics = useMemo((): Map<number, RowAnalytics> | null => {
    const rows = standings?.rows ?? [];
    // Max PF / coaching efficiency only need completed-week boards — do not
    // require forecast/ROS (that gated dashboard efficiency behind a heavier path).
    if (!rows.length || !playersPayload || currentWeek == null) return null;
    if (loadHistory && historyLoading) return null;
    if (forecast && scheduleLoading) return null;
    const posById = new Map(playersPayload.players.map((p) => [p.id, p.pos]));
    const posOf = (id: string) => posById.get(id) ?? (/^[A-Z]{2,3}$/.test(id) ? "DEF" : null);

    const base = computeStandingsAnalytics({
      teams: rows,
      completedWeeks: historyQueries
        .map((q) => q.data?.entries ?? [])
        .filter((entries) => entries.length >= 2),
      remainingWeeks: forecast ? scheduleQueries.map((q) => q.data?.entries ?? []) : [],
      rosterPositions,
      posOf,
      playoffTeams,
      projectedByWeek: forecast
        ? remainingWeekNumbers.map((week) => {
            const index = rosProjections.data?.weeks.indexOf(week) ?? -1;
            const row = index >= 0 ? rosProjections.data?.byWeek[index] : undefined;
            return new Map(
              Object.entries(row ?? {}).map(([slot, pts]) => [Number(slot), pts as number]),
            );
          })
        : [],
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
    loadHistory,
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
    completedThrough,
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
      loadHistory &&
      analytics == null &&
      (nflWeek.isLoading || historyLoading || !playersPayload || (forecast && scheduleLoading)),
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
    refetchIntervalInBackground: false,
    queryFn: async () =>
      fetchSnapStartingSlotRanks({
        ...connectionArgs(activeLeague),
        fromWeek: fromWeek!,
        toWeek: 17,
      }),
  });
}
