import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import { useNflState } from "@/hooks/useLeagueProjections";
import { liveRefreshMs, useNflGameProgress } from "@/hooks/useNflGameProgress";
import { SLEEPER_BASE, positionsQuery } from "@/lib/players-build";

/** Raw Sleeper live / final weekly box-score stats keyed by player id. */
async function fetchWeeklyActualStats(
  season: string,
  week: number,
): Promise<Map<string, Record<string, number>>> {
  const url = `${SLEEPER_BASE}/stats/nfl/${season}/${week}?season_type=regular&${positionsQuery()}`;
  const res = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
  const rows = res && res.ok ? ((await res.json()) as unknown) : null;
  const map = new Map<string, Record<string, number>>();
  if (Array.isArray(rows)) {
    for (const row of rows as { player_id?: string; stats?: Record<string, number> }[]) {
      if (row?.player_id && row.stats) map.set(String(row.player_id), row.stats);
    }
  }
  return map;
}

/**
 * Live / final weekly box-score stat lines for the Statistics tab.
 * Pass `week` to follow the My Team week selector.
 */
export function useWeeklyActualStats(week?: number | null) {
  const safeWeek = week != null && week > 0 ? week : null;
  const nflState = useNflState();
  const season = nflState.data?.season ?? String(new Date().getUTCFullYear());
  const pollWeek = safeWeek ?? nflState.data?.week ?? null;
  // Shares the scoreboard query, so pacing adds no extra requests.
  const { progressByNflTeam, currentWeek } = useNflGameProgress(pollWeek);

  const query = useQuery({
    queryKey: ["sleeper-weekly-actual-stats", season, safeWeek ?? "auto"],
    enabled: Boolean(nflState.data?.season || safeWeek),
    staleTime: 8 * 1000,
    refetchInterval: liveRefreshMs(pollWeek, currentWeek, progressByNflTeam),
    retry: false,
    // Reuse shared useNflState — do not re-hit state/nfl on every stats poll.
    queryFn: () => fetchWeeklyActualStats(season, pollWeek ?? 1),
  });

  const statsFor = useCallback(
    (playerId: string): Record<string, number> | null => {
      return query.data?.get(playerId) ?? null;
    },
    [query.data],
  );

  return {
    statsFor,
    loading: query.isLoading,
  };
}
