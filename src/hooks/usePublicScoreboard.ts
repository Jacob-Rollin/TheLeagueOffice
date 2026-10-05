import { useQuery } from "@tanstack/react-query";

import {
  fetchPublicScoreboard,
  scoreboardHasLiveGame,
  scoreboardQueryKey,
} from "@/lib/public-scoreboard";

const LIVE_MS = 20 * 1000;
const IDLE_MS = 2 * 60 * 1000;
const ALL_FINAL_MS = 10 * 60 * 1000;

/**
 * Shared CDN-backed ESPN scoreboard query. ScoreTicker and live-matchup
 * progress both use this key so one browser tab only pays for one poll.
 */
export function usePublicScoreboard(week?: number | null, seasontype?: number | null) {
  const safeWeek = week != null && week > 0 ? week : null;
  const safeSeasonType = seasontype != null && seasontype > 0 ? seasontype : null;

  return useQuery({
    queryKey: scoreboardQueryKey(safeWeek, safeSeasonType),
    queryFn: async () => {
      const json = await fetchPublicScoreboard(safeWeek, safeSeasonType);
      return json;
    },
    staleTime: LIVE_MS,
    refetchInterval: (q) => {
      const json = q.state.data;
      if (json == null) return IDLE_MS;
      if (scoreboardHasLiveGame(json)) return LIVE_MS;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events: any[] = Array.isArray((json as any)?.events) ? (json as any).events : [];
      if (!events.length) return IDLE_MS;
      const anyUpcoming = events.some((ev) => {
        const state = String(
          ev?.competitions?.[0]?.status?.type?.state ?? ev?.status?.type?.state ?? "",
        );
        return state.toLowerCase() === "pre";
      });
      return anyUpcoming ? IDLE_MS : ALL_FINAL_MS;
    },
    refetchIntervalInBackground: false,
    retry: false,
  });
}
