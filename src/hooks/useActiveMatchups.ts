import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { liveRefreshMs, useNflGameProgress } from "@/hooks/useNflGameProgress";
import {
  boardHasSchedulePairings,
  boardHasUsableScores,
  fetchLeagueMatchupsHistory,
  fetchLeagueWeekMatchupsCdn,
  isPastWeekMatchupFresh,
  maybeRefreshMatchupsViaFluid,
  type LeagueMatchupsCdnHit,
} from "@/lib/league-matchups-cdn";
import { isPageVisible, visibleRefetchInterval } from "@/lib/page-visibility";
import { fetchSleeperWeekMatchupsClient } from "@/lib/sleeper-matchups-client";
import { sleeperBudgetRemaining } from "@/lib/sleeper-rate-budget";
import type { LeagueWeekMatchups } from "@/lib/league.server";

/**
 * Live current-week scoring via the visitor's browser → Sleeper.
 * In-game polls ~30s (well under Sleeper's ~1000 req/min per IP).
 * Hidden tabs never poll. Fluid is not used on the live path.
 */
const LIVE_POLL_MS = 30 * 1000;
const BETWEEN_GAMES_POLL_MS = 2 * 60 * 1000;
/** ESPN/Yahoo polls hit our `/api/data/league` CDN — keep quieter between games. */
const ESPN_BETWEEN_GAMES_POLL_MS = 5 * 60 * 1000;
const ALL_FINAL_POLL_MS = 15 * 60 * 1000;

function boardIsDisplayable(board: LeagueWeekMatchups | null | undefined): boolean {
  return boardHasUsableScores(board) || boardHasSchedulePairings(board);
}

export function activeMatchupsQueryKey(connectionId: string | null, week: number) {
  return ["active-matchups", connectionId, week] as const;
}

function isSleeperPlatform(platform: string): boolean {
  return platform === "sleeper";
}

/**
 * Resolve one week:
 * - Sleeper: visitor→api.sleeper.app first (IndexedDB + rate budget), TiDB CDN only
 *   as fallback — keeps Hobby CDN Requests off the live path.
 * - ESPN/Yahoo: CDN first, throttled Fluid for holes.
 */
async function loadWeekMatchups(input: {
  leagueId: string;
  week: number;
  currentWeek: number | null;
  platform: string;
  connectionId: string | null;
  s2?: string;
  swid?: string;
}): Promise<LeagueWeekMatchups | null> {
  let { leagueId } = input;
  const { week, currentWeek, platform } = input;
  if (platform === "native") {
    const linkId = String(input.connectionId ?? "").trim();
    if (!linkId) return null;
    const { fetchNativeWeekMatchups } = await import("@/lib/native-league-sync-adapter");
    return fetchNativeWeekMatchups(linkId, week, currentWeek);
  }
  const past = currentWeek != null && week < currentWeek;
  const isCurrent = currentWeek != null && week === currentWeek;
  const sleeperPlatform = isSleeperPlatform(platform);

  // Always resolve Sleeper ids — numeric user ids fail /league/{id} otherwise.
  if (sleeperPlatform) {
    const { ensureSleeperNumericLeagueId, persistResolvedSleeperLeagueId } = await import(
      "@/lib/sleeper-resolve-client"
    );
    const resolved = await ensureSleeperNumericLeagueId(leagueId).catch(() => null);
    if (resolved) {
      if (resolved !== leagueId && input.connectionId) {
        void persistResolvedSleeperLeagueId(input.connectionId, resolved);
      }
      leagueId = resolved;
    } else {
      // Production: never Fluid-fallthrough for unresolved Sleeper ids.
      try {
        if (import.meta.env.PROD) return null;
      } catch {
        return null;
      }
    }
  }
  const sleeper = sleeperPlatform && /^\d{6,}$/.test(leagueId);

  // Sleeper: burn the visitor IP pool before our Vercel CDN.
  if (sleeper && isPageVisible()) {
    if (isCurrent) {
      const live = await fetchSleeperWeekMatchupsClient(leagueId, week, currentWeek, {
        mode: "live",
      });
      if (boardIsDisplayable(live)) return live;
    }
    const warm = await fetchSleeperWeekMatchupsClient(leagueId, week, currentWeek, {
      mode: "warm",
    });
    if (boardIsDisplayable(warm)) return warm;
  }

  const cdn = await fetchLeagueWeekMatchupsCdn(leagueId, week);
  const cdnDisplayable = cdn != null && boardIsDisplayable(cdn.board);

  if (sleeper) {
    // Client miss/429 — TiDB CDN is the soft fallback (never Fluid).
    if (cdnDisplayable && cdn) return cdn.board;
    return null;
  }

  // Unresolved Sleeper username: soft-empty (never Fluid).
  if (sleeperPlatform) return cdnDisplayable && cdn ? cdn.board : null;

  if (cdnDisplayable && cdn) {
    if (isCurrent) {
      // ESPN/Yahoo: prefer warm CDN — Fluid burns host + Active CPU.
      return cdn.board;
    }
    const pastNeedsRefresh =
      past && !boardHasUsableScores(cdn.board) && isPageVisible();
    if (!pastNeedsRefresh) {
      if (
        isPastWeekMatchupFresh(week, currentWeek, cdn.syncedAtMs, platform) ||
        !isPageVisible()
      ) {
        return cdn.board;
      }
    }
  }

  // ESPN/Yahoo: throttled Fluid for past / unscored holes only.
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
  if (cdnDisplayable && cdn) return cdn.board;
  return refreshed?.entries?.length ? refreshed : null;
}

function liveMatchupPollMs(
  week: number | null,
  currentWeek: number | null,
  liveMs: number | false,
  platform: string,
): number | false {
  if (week == null || currentWeek == null || week !== currentWeek) return false;
  if (liveMs === false) return false;
  // Native polls hit auth serverFns (+ live stats snap) — keep ESPN-quiet cadence.
  const espnish = platform === "espn" || platform === "yahoo" || platform === "native";
  // ESPN/Yahoo polls also hit our CDN route (and sometimes Fluid). Keep them
  // calmer than Sleeper's browser→api.sleeper.app live path.
  const inGame = espnish ? ESPN_BETWEEN_GAMES_POLL_MS : LIVE_POLL_MS;
  const between = espnish ? ESPN_BETWEEN_GAMES_POLL_MS : BETWEEN_GAMES_POLL_MS;
  if (typeof liveMs === "number" && liveMs <= 30_000) return inGame;
  if (typeof liveMs === "number" && liveMs >= ALL_FINAL_POLL_MS) return ALL_FINAL_POLL_MS;
  return Math.max(inGame, Math.min(between, liveMs));
}

/** Weekly host matchup rows for the active synced league. */
export function useActiveMatchups(week: number | null | undefined) {
  const { activeLeague } = useActiveLeague();
  const id = activeLeague?.id ?? null;
  const leagueId = activeLeague?.leagueId ?? "";
  const platform = (activeLeague?.platform ?? "sleeper").trim().toLowerCase();
  const safeWeek = week != null && week > 0 ? week : null;
  const { progressByNflTeam, currentWeek } = useNflGameProgress(safeWeek);
  const isPastWeek = safeWeek != null && currentWeek != null && safeWeek < currentWeek;
  const isCurrentWeek = safeWeek != null && currentWeek != null && safeWeek === currentWeek;
  const liveMs = liveRefreshMs(safeWeek, currentWeek, progressByNflTeam);
  const pollMs = liveMatchupPollMs(safeWeek, currentWeek, liveMs, platform);

  const query = useQuery({
    queryKey: [...activeMatchupsQueryKey(id, safeWeek ?? 0), currentWeek ?? "na"],
    enabled: Boolean(leagueId && safeWeek),
    retry: false,
    // Live boards go stale quickly so RQ refetches on the poll interval.
    staleTime: isPastWeek ? 10 * 60 * 1000 : isCurrentWeek ? 15 * 1000 : 60 * 1000,
    refetchInterval: visibleRefetchInterval(pollMs),
    refetchIntervalInBackground: false,
    queryFn: async () =>
      loadWeekMatchups({
        leagueId,
        week: safeWeek ?? 1,
        currentWeek,
        platform,
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
 * Yields to the live score budget — never stampede Sleeper during games.
 */
export function usePrefetchLeagueMatchupWeeks(enabled = true) {
  const { activeLeague } = useActiveLeague();
  const queryClient = useQueryClient();
  const id = activeLeague?.id ?? null;
  const leagueId = activeLeague?.leagueId ?? "";
  const platform = (activeLeague?.platform ?? "sleeper").trim().toLowerCase();
  const { currentWeek, progressByNflTeam } = useNflGameProgress(null);
  const gamesLive = [...(progressByNflTeam?.values() ?? [])].some((g) => g.phase === "in");

  useEffect(() => {
    if (!enabled || !leagueId || !id) return;
    // Native weeks load on demand via getNativeMatchupWeek — skip 1–17 warm.
    if (platform === "native") return;
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
        // Prefetch must not burn Fluid — CDN + browser only.
        allowFluid: false,
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

      if (!isSleeperPlatform(platform)) return;

      // During live games, only fill missing weeks if budget remains; never
      // compete with the 30s scoreboard poll.
      if (gamesLive && sleeperBudgetRemaining("warm") < 10) return;

      const missing = weeks.filter((week) => {
        if (currentWeek != null && week === currentWeek) return false; // live hook owns this
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
          if (sleeperBudgetRemaining("warm") < 4) {
            await new Promise((r) => setTimeout(r, 1_000));
            if (sleeperBudgetRemaining("warm") < 4) return;
          }
          const week = missing[next++]!;
          const board = await fetchSleeperWeekMatchupsClient(leagueId, week, currentWeek, {
            mode: "warm",
          }).catch(() => null);
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
    gamesLive,
    activeLeague?.s2,
    activeLeague?.swid,
    queryClient,
  ]);
}
