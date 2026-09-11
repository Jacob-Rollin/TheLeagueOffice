import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import { SLEEPER_BASE, positionsQuery } from "@/lib/players-build";

/** Raw Sleeper live / final weekly box-score stats keyed by player id. */
async function fetchWeeklyActualStats(
  weekOverride?: number | null,
): Promise<Map<string, Record<string, number>>> {
  const resState = await fetch("https://api.sleeper.app/v1/state/nfl", {
    headers: { accept: "application/json" },
  }).catch(() => null);
  const state = resState && resState.ok ? ((await resState.json()) as Record<string, unknown>) : null;
  const season = String(state?.["season"] ?? new Date().getUTCFullYear());
  const stateWeek = Math.max(1, Number(state?.["week"] ?? 1) || 1);
  const week =
    weekOverride != null && weekOverride > 0 ? Math.max(1, Math.floor(weekOverride)) : stateWeek;

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

  const query = useQuery({
    queryKey: ["sleeper-weekly-actual-stats", safeWeek ?? "auto"],
    staleTime: 45 * 1000,
    refetchInterval: 60 * 1000,
    retry: false,
    queryFn: () => fetchWeeklyActualStats(safeWeek),
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
