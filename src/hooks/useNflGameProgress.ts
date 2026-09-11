import { useQuery } from "@tanstack/react-query";

import {
  buildNflGameProgressMap,
  type NflGameProgress,
} from "@/lib/rolling-live-projection";

/** Client-cached NFL game progress for 3-tier live matchup projections. */
export function useNflGameProgress(week: number | null | undefined) {
  const safeWeek = week != null && week > 0 ? week : null;

  const query = useQuery({
    queryKey: ["nfl-scoreboard-progress", safeWeek],
    enabled: Boolean(safeWeek),
    retry: false,
    staleTime: 20 * 1000,
    refetchInterval: 30 * 1000,
    queryFn: async (): Promise<Map<string, NflGameProgress>> => {
      const url = `/api/public/scoreboard?week=${safeWeek}&seasontype=2`;
      const res = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
      if (!res || !res.ok) return new Map();
      const json = (await res.json()) as unknown;
      return buildNflGameProgressMap(json);
    },
  });

  return {
    progressByNflTeam: query.data ?? new Map<string, NflGameProgress>(),
    loading: query.isLoading,
  };
}
