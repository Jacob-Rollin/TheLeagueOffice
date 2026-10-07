import { useQuery } from "@tanstack/react-query";

import {
  fetchPublicScoreboard,
  scoreboardHasLiveGame,
  scoreboardNextKickoffMs,
  scoreboardQueryKey,
} from "@/lib/public-scoreboard";
import { visibleRefetchInterval } from "@/lib/page-visibility";

/** In-game — ScoreTicker needs fresh scores; still ≥15s edge TTL on the proxy. */
const LIVE_MS = 20 * 1000;
/** Kickoff within ~4h — warm up without hammering CDN every visit. */
const NEAR_KICKOFF_MS = 2 * 60 * 1000;
/**
 * Mid-week / distant kickoff. ScoreTicker sits on every page via root layout, so
 * a 2‑minute idle poll was a large share of Hobby CDN Requests even with edge
 * cache hits (Vercel counts CDN hits).
 */
const QUIET_MS = 10 * 60 * 1000;
const ALL_FINAL_MS = 15 * 60 * 1000;
const NEAR_KICKOFF_WINDOW_MS = 4 * 60 * 60 * 1000;

function scoreboardPollMs(json: unknown): number {
  if (json == null) return QUIET_MS;
  if (scoreboardHasLiveGame(json)) return LIVE_MS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: any[] = Array.isArray((json as any)?.events) ? (json as any).events : [];
  if (!events.length) return QUIET_MS;

  const nextKickoff = scoreboardNextKickoffMs(json);
  if (nextKickoff == null) return ALL_FINAL_MS;

  const until = nextKickoff - Date.now();
  if (until <= 0) return LIVE_MS;
  if (until <= NEAR_KICKOFF_WINDOW_MS) {
    // Land a poll near kickoff without staying on the live cadence early.
    return Math.max(LIVE_MS, Math.min(NEAR_KICKOFF_MS, until + 5_000));
  }
  return QUIET_MS;
}

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
    refetchInterval: visibleRefetchInterval((q) => scoreboardPollMs(q.state.data)),
    refetchIntervalInBackground: false,
    retry: false,
  });
}
