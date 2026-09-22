import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { getLeagueScoring } from "@/lib/scoring.functions";
import { SLEEPER_BASE, positionsQuery } from "@/lib/players-build";
import {
  defaultScoringMap,
  hasScorableProjectionStats,
  projectionPoints,
  type ScoringFormat,
  type ScoringMap,
} from "@/lib/scoring-map";

const HOUR = 1000 * 60 * 60;

type WeekState = { season: string; week: number };

type WeeklyProjRow = {
  stats: Record<string, number>;
  pos: string;
};

export type SleeperWeeklyRanks = {
  overall: number | null;
  pos: number | null;
};

async function fetchState(): Promise<WeekState> {
  const res = await fetch("https://api.sleeper.app/v1/state/nfl", {
    headers: { accept: "application/json" },
  }).catch(() => null);
  const json = res && res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  return {
    season: String(json?.["season"] ?? new Date().getUTCFullYear()),
    week: Math.max(1, Number(json?.["week"] ?? 1) || 1),
  };
}

/** Shared NFL calendar state — one network hit across Weekly Projections + scoring. */
export function useNflState() {
  return useQuery({
    queryKey: ["nfl-state", "v3-week"],
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: fetchState,
  });
}

async function fetchWeeklyProjectionsFor(
  season: string,
  week: number,
): Promise<Map<string, WeeklyProjRow>> {
  const url = `${SLEEPER_BASE}/projections/nfl/${season}/${week}?season_type=regular&${positionsQuery()}`;
  const res = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
  const rows = res && res.ok ? ((await res.json()) as unknown) : null;
  const map = new Map<string, WeeklyProjRow>();
  if (Array.isArray(rows)) {
    for (const row of rows as {
      player_id?: string;
      stats?: Record<string, number>;
      player?: { position?: string; fantasy_positions?: string[] };
    }[]) {
      // Skip ADP-only / empty rows — Sleeper's "—" (no weekly projection).
      if (!row?.player_id || !hasScorableProjectionStats(row.stats)) continue;
      const pos = String(
        row.player?.position ||
          row.player?.fantasy_positions?.[0] ||
          "",
      ).toUpperCase();
      map.set(String(row.player_id), { stats: row.stats!, pos });
    }
  }
  return map;
}

async function fetchSeasonStatRows(
  season: string,
): Promise<Map<string, WeeklyProjRow>> {
  const q = `season_type=regular&${positionsQuery()}&order_by=pts_half_ppr`;
  const trySeason = async (yr: string) => {
    const url = `${SLEEPER_BASE}/stats/nfl/${yr}?${q}`;
    const res = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
    const rows = res && res.ok ? ((await res.json()) as unknown) : null;
    return Array.isArray(rows) ? rows : [];
  };

  let rows = await trySeason(season);
  if (rows.length === 0) {
    rows = await trySeason(String(Number(season) - 1));
  }

  const map = new Map<string, WeeklyProjRow>();
  for (const row of rows as {
    player_id?: string;
    stats?: Record<string, number>;
    player?: {
      position?: string;
      fantasy_positions?: string[];
      active?: boolean;
    };
  }[]) {
    if (!row?.player_id || !row.stats) continue;
    const pos = String(
      row.player?.position || row.player?.fantasy_positions?.[0] || "",
    ).toUpperCase();
    if (pos !== "DEF" && row.player?.active === false) continue;
    if (!pos) continue;
    map.set(String(row.player_id), { stats: row.stats, pos });
  }
  return map;
}

function ptsKey(format: ScoringFormat): string {
  if (format === "ppr") return "pts_ppr";
  if (format === "std") return "pts_std";
  return "pts_half_ppr";
}

function publishedOverallRankKey(format: ScoringFormat): string {
  if (format === "ppr") return "rank_ppr";
  if (format === "std") return "rank_std";
  return "rank_half_ppr";
}

function publishedPosRankKey(format: ScoringFormat): string {
  if (format === "ppr") return "pos_rank_ppr";
  if (format === "std") return "pos_rank_std";
  return "pos_rank_half_ppr";
}

/**
 * Sleeper player-page ranks: season fantasy points scored so far for the
 * selected scoring format. Prefer Sleeper's published rank_* / pos_rank_*
 * fields; fall back to sorting by pts_* when those are missing.
 */
function buildSleeperYtdRankMaps(
  rows: Map<string, WeeklyProjRow> | undefined,
  format: ScoringFormat,
): { overall: Map<string, number>; pos: Map<string, number> } {
  const overall = new Map<string, number>();
  const pos = new Map<string, number>();
  if (!rows?.size) return { overall, pos };

  const pts = ptsKey(format);
  const overallKey = publishedOverallRankKey(format);
  const posKey = publishedPosRankKey(format);
  const scored: { id: string; pos: string; pts: number; overallHint: number; posHint: number }[] =
    [];

  for (const [id, row] of rows) {
    const points = Number(row.stats[pts]);
    if (!Number.isFinite(points) || points <= 0) continue;
    const overallHint = Number(row.stats[overallKey]);
    const posHint = Number(row.stats[posKey]);
    scored.push({
      id,
      pos: row.pos || "?",
      pts: points,
      overallHint: Number.isFinite(overallHint) && overallHint > 0 ? overallHint : NaN,
      posHint: Number.isFinite(posHint) && posHint > 0 ? posHint : NaN,
    });
  }

  const byPts = [...scored].sort((a, b) => b.pts - a.pts || a.id.localeCompare(b.id));
  byPts.forEach((entry, i) => {
    overall.set(
      entry.id,
      Number.isFinite(entry.overallHint) ? Math.round(entry.overallHint) : i + 1,
    );
  });

  const byPosition = new Map<string, typeof scored>();
  for (const entry of scored) {
    const list = byPosition.get(entry.pos) ?? [];
    list.push(entry);
    byPosition.set(entry.pos, list);
  }
  for (const list of byPosition.values()) {
    list.sort((a, b) => b.pts - a.pts || a.id.localeCompare(b.id));
    list.forEach((entry, i) => {
      pos.set(
        entry.id,
        Number.isFinite(entry.posHint) ? Math.round(entry.posHint) : i + 1,
      );
    });
  }

  return { overall, pos };
}

/**
 * Weekly projections rendered in the host league's own scoring system:
 * Sleeper's raw projected stat line multiplied by the active league's
 * customized scoring rule map (Sleeper / ESPN / Yahoo).
 *
 * Pass `week` to lock projections to a selected NFL week (My Team week picker).
 */
export function useLeagueProjections(week?: number | null) {
  const { activeLeague } = useActiveLeague();
  const identifier = activeLeague?.leagueId ?? "";
  const platform = activeLeague?.platform ?? "sleeper";
  const safeWeek = week != null && week > 0 ? week : null;

  const nflState = useNflState();

  const scoring = useQuery({
    // v5: resolve username→league; fill omitted Sleeper defaults (pass_2pt etc).
    queryKey: ["league-scoring", "v5", platform, identifier],
    enabled: Boolean(identifier),
    staleTime: 12 * HOUR,
    retry: false,
    queryFn: () =>
      getLeagueScoring({
        data: {
          identifier,
          platform,
          ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
          ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
        },
      }),
  });

  const resolvedWeek = safeWeek ?? nflState.data?.week ?? null;
  const season = nflState.data?.season ?? null;

  const projections = useQuery({
    queryKey: ["sleeper-weekly-projections", "v3", season, resolvedWeek ?? "auto"],
    enabled: Boolean(season && resolvedWeek),
    // Sleeper updates Out → projected mid-week; refresh often enough to track them.
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: () => fetchWeeklyProjectionsFor(season!, resolvedWeek!),
  });

  const seasonStats = useQuery({
    queryKey: ["sleeper-season-stats-ranks", "v1-ytd", season],
    enabled: Boolean(season),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: () => fetchSeasonStatRows(season!),
  });

  const map: ScoringMap = useMemo(
    () => scoring.data?.map ?? defaultScoringMap("half"),
    [scoring.data],
  );
  const format = scoring.data?.format ?? "half";

  const rankMaps = useMemo(() => {
    const rows = seasonStats.data;
    return {
      std: buildSleeperYtdRankMaps(rows, "std"),
      half: buildSleeperYtdRankMaps(rows, "half"),
      ppr: buildSleeperYtdRankMaps(rows, "ppr"),
    };
  }, [seasonStats.data]);

  /** League-scored weekly projection for a player id, or null when unknown. */
  const projectFor = useCallback(
    (playerId: string): number | null => {
      const stats = projections.data?.get(playerId)?.stats;
      return projectionPoints(stats, map, format);
    },
    [projections.data, map, format],
  );

  /** Raw Sleeper projected stat line for a player id (pass_yd, rush_att, …). */
  const statsFor = useCallback(
    (playerId: string): Record<string, number> | null => {
      return projections.data?.get(playerId)?.stats ?? null;
    },
    [projections.data],
  );

  /**
   * Sleeper player-page ranks (pos + overall) for the selected scoring format —
   * fantasy points scored so far this season (rank_* / pos_rank_*).
   */
  const rankFor = useCallback(
    (playerId: string, scoringFormat: ScoringFormat = format): SleeperWeeklyRanks => {
      const maps = rankMaps[scoringFormat] ?? rankMaps.half;
      return {
        overall: maps.overall.get(playerId) ?? null,
        pos: maps.pos.get(playerId) ?? null,
      };
    },
    [rankMaps, format],
  );

  return {
    projectFor,
    statsFor,
    rankFor,
    scoringMap: map,
    loading:
      projections.isLoading ||
      scoring.isLoading ||
      nflState.isLoading ||
      seasonStats.isLoading,
    format,
    nflWeek: nflState.data?.week ?? null,
    nflSeason: nflState.data?.season ?? null,
  };
}
