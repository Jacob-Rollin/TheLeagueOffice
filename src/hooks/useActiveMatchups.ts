import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { liveRefreshMs, useNflGameProgress } from "@/hooks/useNflGameProgress";
import {
  boardHasSchedulePairings,
  boardHasUsableScores,
  fetchLeagueMatchupsHistory,
  fetchLeagueWeekMatchupsCdn,
  isLiveMatchupFresh,
  isPastWeekMatchupFresh,
  maybeRefreshMatchupsViaFluid,
  type LeagueMatchupsCdnHit,
} from "@/lib/league-matchups-cdn";
import { isPageVisible, visibleRefetchInterval } from "@/lib/page-visibility";
import { fetchSleeperWeekMatchupsClient } from "@/lib/sleeper-matchups-client";
import type { LeagueWeekMatchups } from "@/lib/league.server";

/**
 * During live games, keep a 45s ceiling so lineup/score shifts show quickly.
 * Polls hit CDN/TiDB first; Fluid host refresh only when the snap is cold
 * and this tab is visible.
 */
const LIVE_LINEUP_CEILING_MS = 45 * 1000;

function boardIsDisplayable(board: LeagueWeekMatchups | null | undefined): boolean {
  return boardHasUsableScores(board) || boardHasSchedulePairings(board);
}

export function activeMatchupsQueryKey(connectionId: string | null, week: number) {
  return ["active-matchups", connectionId, week] as const;
}

/** Resolve one week: CDN → Sleeper browser → Fluid. */
async function loadWeekMatchups(input: {
  leagueId: string;
  week: number;
  currentWeek: number | null;
  platform: string;
  connectionId: string | null;
  s2?: string;
  swid?: string;
}): Promise<LeagueWeekMatchups | null> {
  const { leagueId, week, currentWeek, platform } = input;
  const past = currentWeek != null && week < currentWeek;
  const cdn = await fetchLeagueWeekMatchupsCdn(leagueId, week);

  const cdnDisplayable = cdn != null && boardIsDisplayable(cdn.board);
  if (cdnDisplayable && cdn) {
    // Prefer scored boards for past weeks; schedule pairings are enough to show the page.
    const pastNeedsRefresh =
      past &&
      !boardHasUsableScores(cdn.board) &&
      isPageVisible();
    if (!pastNeedsRefresh) {
      if (!past) {
        if (isLiveMatchupFresh(cdn.syncedAtMs) || !isPageVisible()) return cdn.board;
      } else if (isPastWeekMatchupFresh(week, currentWeek, cdn.syncedAtMs) || !isPageVisible()) {
        return cdn.board;
      }
    }
  }

  if (platform === "sleeper" && /^\d{6,}$/.test(leagueId)) {
    const client = await fetchSleeperWeekMatchupsClient(leagueId, week, currentWeek);
    if (boardIsDisplayable(client)) return client;
  }

  const refreshed = await maybeRefreshMatchupsViaFluid({
    leagueId,
    week,
    platform,
    ...(input.s2 ? { s2: input.s2 } : {}),
    ...(input.swid ? { swid: input.swid } : {}),
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    allow: isPageVisible(),
    force: past && currentWeek != null && week === currentWeek - 1,
  });
  if (boardIsDisplayable(refreshed)) return refreshed;

  // Last resort: any displayable CDN board (even hollow scores) beats a blank page.
  if (cdnDisplayable && cdn) return cdn.board;
  return refreshed?.entries?.length ? refreshed : null;
}

/** Weekly host matchup rows for the active synced league. */
export function useActiveMatchups(week: number | null | undefined) {
  const { activeLeague } = useActiveLeague();
  const id = activeLeague?.id ?? null;
  const leagueId = activeLeague?.leagueId ?? "";
  const safeWeek = week != null && week > 0 ? week : null;
  const { progressByNflTeam, currentWeek } = useNflGameProgress(safeWeek);
  const isPastWeek = safeWeek != null && currentWeek != null && safeWeek < currentWeek;
  const liveMs = liveRefreshMs(safeWeek, currentWeek, progressByNflTeam);
  const anyInProgress = [...(progressByNflTeam?.values() ?? [])].some((g) => g.phase === "in");
  const refetchInterval =
    liveMs === false
      ? false
      : anyInProgress
        ? Math.min(liveMs, LIVE_LINEUP_CEILING_MS)
        : liveMs;

  const query = useQuery({
    queryKey: [...activeMatchupsQueryKey(id, safeWeek ?? 0), currentWeek ?? "na"],
    enabled: Boolean(leagueId && safeWeek),
    retry: false,
    staleTime: isPastWeek ? 10 * 60 * 1000 : 60 * 1000,
    refetchInterval: visibleRefetchInterval(refetchInterval),
    refetchIntervalInBackground: false,
    queryFn: async () =>
      loadWeekMatchups({
        leagueId,
        week: safeWeek ?? 1,
        currentWeek,
        platform: (activeLeague?.platform ?? "sleeper").trim().toLowerCase(),
        connectionId: id,
        ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
        ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
      }),
  });

  return {
    matchups: query.data ?? null,
    loading: query.isLoading,
  };
}

/**
 * Warm React Query for weeks 1–17 so the Matchup week picker is not empty
 * when users step through the season. CDN/history first, then Sleeper fill.
 */
export function usePrefetchLeagueMatchupWeeks(enabled = true) {
  const { activeLeague } = useActiveLeague();
  const queryClient = useQueryClient();
  const id = activeLeague?.id ?? null;
  const leagueId = activeLeague?.leagueId ?? "";
  const platform = (activeLeague?.platform ?? "sleeper").trim().toLowerCase();
  const { currentWeek } = useNflGameProgress(null);

  useEffect(() => {
    if (!enabled || !leagueId || !id) return;
    let cancelled = false;

    (async () => {
      const weeks = Array.from({ length: 17 }, (_, i) => i + 1);
      const history = await fetchLeagueMatchupsHistory({
        leagueId,
        platform,
        weeks,
        currentWeek,
        completedThrough: currentWeek != null && currentWeek > 1 ? currentWeek - 1 : currentWeek,
        ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
        ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
        ...(id ? { connectionId: id } : {}),
        allowFluid: isPageVisible(),
      }).catch(() => new Map<number, LeagueMatchupsCdnHit>());

      if (cancelled) return;

      for (const week of weeks) {
        const hit = history.get(week);
        if (hit && boardIsDisplayable(hit.board)) {
          queryClient.setQueryData(
            [...activeMatchupsQueryKey(id, week), currentWeek ?? "na"],
            hit.board,
          );
        }
      }

      // Fill any still-missing weeks from Sleeper in the background (capped concurrency).
      if (platform === "sleeper" && /^\d{6,}$/.test(leagueId)) {
        const missing = weeks.filter((week) => {
          const cached = queryClient.getQueryData<LeagueWeekMatchups>([
            ...activeMatchupsQueryKey(id, week),
            currentWeek ?? "na",
          ]);
          return !boardIsDisplayable(cached);
        });
        let next = 0;
        const workers = Array.from({ length: Math.min(2, missing.length) }, async () => {
          while (next < missing.length) {
            if (cancelled) return;
            const week = missing[next++]!;
            const board = await fetchSleeperWeekMatchupsClient(leagueId, week, currentWeek).catch(
              () => null,
            );
            if (cancelled) return;
            if (boardIsDisplayable(board)) {
              queryClient.setQueryData(
                [...activeMatchupsQueryKey(id, week), currentWeek ?? "na"],
                board,
              );
            }
          }
        });
        await Promise.all(workers);
      }
    })().catch(() => {
      /* best-effort warm */
    });

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    leagueId,
    id,
    platform,
    currentWeek,
    activeLeague?.s2,
    activeLeague?.swid,
    queryClient,
  ]);
}
