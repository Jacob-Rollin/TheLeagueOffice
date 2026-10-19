/**
 * Native-league live Matchup scoring (client-safe).
 *
 * Live overlay prefers the shared budgeted Sleeper week-stats cache (same key
 * as useWeeklyActualStats) so mobile/TLN broadcast polls stay under the soft
 * 180/min tab budget. Snap-cdn is a free warm fallback when Sleeper misses.
 *
 * Does not use Fluid / createServerFn.
 */

import { R2_SNAP_KEYS, r2Url, snapCdnPublicBase } from "@/lib/r2-public";
import { fetchWeeklyActualStatRows } from "@/lib/sleeper-week-stats";
import { scoreActualLine, type ScoringMap } from "@/lib/scoring-map";

/** Align with broadcast weekly-stats floor — coalesces with useWeeklyActualStats. */
const LIVE_STATS_TTL_MS = 12 * 1000;

export type NativeWeekStatsSnap = {
  season: number;
  week: number;
  updatedAt: string;
  /** player_id → raw Sleeper stat line */
  stats: Record<string, Record<string, number>>;
};

export type NativeLiveTeamScore = {
  teamId: number;
  points: number;
  playerPoints: Record<string, number>;
};

async function fetchSnapWeekStats(
  season: number,
  week: number,
): Promise<NativeWeekStatsSnap | null> {
  const path = R2_SNAP_KEYS.nativeWeekStats(season, week);
  const url = r2Url(path);
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as NativeWeekStatsSnap;
    if (!json?.stats || typeof json.stats !== "object") return null;
    return json;
  } catch {
    return null;
  }
}

/** Convert useWeeklyActualStats Map → overlay record (desktop strip / sync adapter). */
export function weeklyStatsMapToRecord(
  map: Map<string, Record<string, number>> | undefined | null,
): Record<string, Record<string, number>> | null {
  if (!map || map.size === 0) return null;
  const out: Record<string, Record<string, number>> = {};
  for (const [id, line] of map) {
    if (id && line) out[id] = line;
  }
  return out;
}

/**
 * Live week stats for native Matchup overlay.
 * - Budgeted Sleeper first (visitor IP + shared weekly-stats cache)
 * - snap-cdn warm fallback when Sleeper is empty/429
 * Prefer `useWeeklyActualStats` in UI; this helper remains for sync-adapter /
 * non-React callers that need the same IndexedDB-backed fetch.
 */
export async function fetchNativeLiveWeekStats(
  season: number,
  week: number,
): Promise<NativeWeekStatsSnap | null> {
  const safeSeason = Math.max(2000, Math.floor(season) || new Date().getUTCFullYear());
  const safeWeek = Math.max(1, Math.min(18, Math.floor(week) || 1));

  try {
    const stats = await fetchWeeklyActualStatRows(safeSeason, safeWeek, LIVE_STATS_TTL_MS);
    if (stats && Object.keys(stats).length > 0) {
      return {
        season: safeSeason,
        week: safeWeek,
        updatedAt: new Date().toISOString(),
        stats,
      };
    }
  } catch {
    /* fall through to snap */
  }

  if (snapCdnPublicBase()) {
    const snap = await fetchSnapWeekStats(safeSeason, safeWeek);
    if (!snap || Object.keys(snap.stats).length === 0) return null;
    return {
      season: Number(snap.season) || safeSeason,
      week: Number(snap.week) || safeWeek,
      updatedAt: String(snap.updatedAt || new Date().toISOString()),
      stats: snap.stats,
    };
  }

  return null;
}

/** Score one team's starters from a shared stats map. */
export function scoreNativeStartersLive(
  starterIds: string[],
  statsByPlayer: Record<string, Record<string, number>>,
  scoring: ScoringMap,
): { points: number; playerPoints: Record<string, number> } {
  const playerPoints: Record<string, number> = {};
  let total = 0;
  for (const id of starterIds) {
    const pts = scoreActualLine(statsByPlayer[id] ?? null, scoring) ?? 0;
    playerPoints[id] = pts;
    total += pts;
  }
  return { points: Math.round(total * 100) / 100, playerPoints };
}

export function overlayNativeLiveMatchupScores<
  T extends {
    home: { teamId: number; points: number; playerPoints: Record<string, number> };
    away: { teamId: number; points: number; playerPoints: Record<string, number> };
  },
>(
  matchups: T[],
  startersByTeamId: Record<string, string[]>,
  statsByPlayer: Record<string, Record<string, number>>,
  scoring: ScoringMap,
): T[] {
  if (!matchups.length || Object.keys(statsByPlayer).length === 0) return matchups;
  return matchups.map((m) => {
    const homeIds = startersByTeamId[String(m.home.teamId)] ?? [];
    const awayIds = startersByTeamId[String(m.away.teamId)] ?? [];
    const home =
      homeIds.length > 0
        ? scoreNativeStartersLive(homeIds, statsByPlayer, scoring)
        : { points: m.home.points, playerPoints: m.home.playerPoints };
    const away =
      awayIds.length > 0
        ? scoreNativeStartersLive(awayIds, statsByPlayer, scoring)
        : { points: m.away.points, playerPoints: m.away.playerPoints };
    return {
      ...m,
      home: { ...m.home, points: home.points, playerPoints: home.playerPoints },
      away: { ...m.away, points: away.points, playerPoints: away.playerPoints },
    };
  });
}
