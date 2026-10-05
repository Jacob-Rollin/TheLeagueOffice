import { useMemo } from "react";

import { useNflState } from "@/hooks/useLeagueProjections";
import { usePublicScoreboard } from "@/hooks/usePublicScoreboard";
import { buildNflGameProgressMap, type NflGameProgress } from "@/lib/rolling-live-projection";

const LIVE_MS = 20 * 1000;
const BETWEEN_GAMES_MS = 2 * 60 * 1000;
const ALL_FINAL_MS = 10 * 60 * 1000;

/**
 * How often live week data should re-poll. Only the current NFL week polls:
 * past weeks are final and future weeks have no games yet (they refresh on
 * tab focus instead). Hidden tabs never poll (React Query default).
 * Between games the next poll lands right at the upcoming kickoff so the
 * first scores show without waiting out the slow interval.
 */
export function liveRefreshMs(
  week: number | null,
  currentWeek: number | null,
  progress: Map<string, NflGameProgress> | undefined,
): number | false {
  if (week == null) return false;
  if (currentWeek == null) return BETWEEN_GAMES_MS;
  if (week !== currentWeek) return false;
  const games = [...(progress?.values() ?? [])];
  if (games.some((g) => g.phase === "in")) return LIVE_MS;
  const upcoming = games.filter((g) => g.phase === "pre");
  if (games.length === 0) return BETWEEN_GAMES_MS;
  if (!upcoming.length) return ALL_FINAL_MS;
  const now = Date.now();
  const nextKickoff = Math.min(
    ...upcoming.map((g) => (g.kickoffIso ? Date.parse(g.kickoffIso) : NaN)).filter(Number.isFinite),
  );
  if (!Number.isFinite(nextKickoff)) return BETWEEN_GAMES_MS;
  // Kickoff passed but the scoreboard hasn't flipped to live yet: poll fast.
  if (nextKickoff <= now) return LIVE_MS;
  return Math.max(LIVE_MS, Math.min(BETWEEN_GAMES_MS, nextKickoff - now + 5_000));
}

/** Client-cached NFL game progress for 3-tier live matchup projections. */
export function useNflGameProgress(week: number | null | undefined) {
  const safeWeek = week != null && week > 0 ? week : null;
  const nflState = useNflState();
  const currentWeek = nflState.data?.week ?? null;

  // Regular-season scoreboard is seasontype=2 — same React Query key as ScoreTicker.
  const scoreboard = usePublicScoreboard(safeWeek, safeWeek != null ? 2 : null);

  const progressByNflTeam = useMemo(() => {
    if (scoreboard.data == null) return new Map<string, NflGameProgress>();
    return buildNflGameProgressMap(scoreboard.data);
  }, [scoreboard.data]);

  return {
    progressByNflTeam,
    currentWeek,
    loading: scoreboard.isLoading,
  };
}
