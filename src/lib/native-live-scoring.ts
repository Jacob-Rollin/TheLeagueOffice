/**
 * Native-league live Matchup scoring (client-safe).
 *
 * Prefer snap-cdn week stats (Actions publish). Soft-fallback to budgeted
 * Sleeper via getCached — separate cache key so existing 30m pickup/research
 * week-stats TTLs stay untouched.
 *
 * Does not use Fluid / createServerFn.
 */

import { R2_SNAP_KEYS, r2Url, snapCdnPublicBase } from "@/lib/r2-public";
import { getCached } from "@/lib/sleeper-cache";
import { sleeperFetchJson } from "@/lib/sleeper-http";
import { scoreActualLine, type ScoringMap } from "@/lib/scoring-map";

const LIVE_STATS_TTL_MS = 3 * 60 * 1000;

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

function parseStatRows(
  rows: unknown,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  if (!rows) return out;
  if (Array.isArray(rows)) {
    for (const row of rows as { player_id?: string; stats?: Record<string, number> }[]) {
      const id = String(row.player_id ?? "").trim();
      if (!id || !row.stats) continue;
      const stats: Record<string, number> = {};
      for (const [k, v] of Object.entries(row.stats)) {
        const n = Number(v);
        if (Number.isFinite(n)) stats[k] = n;
      }
      out[id] = stats;
    }
    return out;
  }
  if (typeof rows === "object") {
    for (const [id, row] of Object.entries(
      rows as Record<string, { stats?: Record<string, number> }>,
    )) {
      if (!row?.stats) continue;
      const stats: Record<string, number> = {};
      for (const [k, v] of Object.entries(row.stats)) {
        const n = Number(v);
        if (Number.isFinite(n)) stats[k] = n;
      }
      out[String(id)] = stats;
    }
  }
  return out;
}

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

async function fetchSleeperWeekStatsBudgeted(
  season: number,
  week: number,
): Promise<Record<string, Record<string, number>>> {
  const positions = ["QB", "RB", "WR", "TE", "K", "DEF"]
    .map((p) => `position[]=${encodeURIComponent(p)}`)
    .join("&");
  const url = `https://api.sleeper.app/v1/stats/nfl/${season}/${week}?season_type=regular&${positions}`;
  const rows = await sleeperFetchJson<unknown>(url, "live");
  return parseStatRows(rows);
}

/**
 * Live week stats for native Matchup overlay.
 * - snap-cdn when `VITE_SNAP_CDN_BASE` is set (miss → soft-empty, no Sleeper storm)
 * - budgeted Sleeper + short IndexedDB TTL only when snap base is unset (local/dev)
 */
export async function fetchNativeLiveWeekStats(
  season: number,
  week: number,
): Promise<NativeWeekStatsSnap | null> {
  const safeSeason = Math.max(2000, Math.floor(season) || new Date().getUTCFullYear());
  const safeWeek = Math.max(1, Math.min(18, Math.floor(week) || 1));

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

  return getCached(
    `native-live-week-stats-v1:${safeSeason}:${safeWeek}`,
    LIVE_STATS_TTL_MS,
    async () => {
      const stats = await fetchSleeperWeekStatsBudgeted(safeSeason, safeWeek);
      return {
        season: safeSeason,
        week: safeWeek,
        updatedAt: new Date().toISOString(),
        stats,
      } satisfies NativeWeekStatsSnap;
    },
  );
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
