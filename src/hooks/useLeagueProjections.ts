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
import type { Player, Pos } from "@/lib/players-build";
import { POSITIONS } from "@/lib/players-build";

const HOUR = 1000 * 60 * 60;

type WeekState = { season: string; week: number };

export type WeeklyProjRow = {
  stats: Record<string, number>;
  pos: string;
  name: string;
  team: string;
  injury: string | null;
};

/** Minimal Player stub for projected assets missing from the day-cached catalog. */
export function stubPlayerFromProjection(id: string, row: WeeklyProjRow): Player {
  const pos = (POSITIONS.includes(row.pos as Pos) ? row.pos : "QB") as Pos;
  return {
    id,
    name: row.name || "Unknown",
    team: row.team || "FA",
    pos,
    age: null,
    exp: null,
    injury_status: row.injury,
    injury: row.injury,
    bye: null,
    adp: { std: 999, half: 999, ppr: 999 },
    adpRange: { min: 999, max: 999 },
    rank: { std: 999, half: 999, ppr: 999 },
    posRank: 999,
    proj: { std: 0, half: 0, ppr: 0 },
    prev: null,
  };
}

/**
 * Catalog ∪ projection-only players (e.g. mid-week fill-ins like Drew Lock).
 * Projection rows without a fantasy position are skipped.
 *
 * Research boards should prefer the catalog alone — popup `getPlayerDetail`
 * only resolves catalog ids. Use this only when a surface can render stubs
 * without opening the shared player modal.
 */
export function mergeProjectedPlayers(
  catalog: Player[],
  projections: Map<string, WeeklyProjRow> | undefined,
): Player[] {
  if (!projections?.size) return catalog;
  const seen = new Set(catalog.map((p) => p.id));
  const extras: Player[] = [];
  for (const [id, row] of projections) {
    if (seen.has(id)) continue;
    if (!POSITIONS.includes(row.pos as Pos)) continue;
    extras.push(stubPlayerFromProjection(id, row));
    seen.add(id);
  }
  return extras.length ? [...catalog, ...extras] : catalog;
}

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

/** League scoring format + map only (no weekly projection download). */
export function useLeagueScoringMeta() {
  const { activeLeague } = useActiveLeague();
  const identifier = activeLeague?.leagueId ?? "";
  const platform = activeLeague?.platform ?? "sleeper";

  const scoring = useQuery({
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

  const map: ScoringMap = useMemo(
    () => scoring.data?.map ?? defaultScoringMap("half"),
    [scoring.data],
  );
  const format = scoring.data?.format ?? "half";

  return {
    format: format as ScoringFormat,
    scoringMap: map,
    loading: scoring.isLoading,
  };
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
      team?: string | null;
      stats?: Record<string, number>;
      player?: {
        first_name?: string;
        last_name?: string;
        position?: string;
        fantasy_positions?: string[];
        team?: string | null;
        injury_status?: string | null;
      };
    }[]) {
      // Skip ADP-only / empty rows — Sleeper's "—" (no weekly projection).
      if (!row?.player_id || !hasScorableProjectionStats(row.stats)) continue;
      const pos = String(
        row.player?.position ||
          row.player?.fantasy_positions?.[0] ||
          "",
      ).toUpperCase();
      const name =
        `${row.player?.first_name ?? ""} ${row.player?.last_name ?? ""}`.trim() ||
        row.team ||
        row.player?.team ||
        row.player_id;
      map.set(String(row.player_id), {
        stats: row.stats!,
        pos,
        name,
        team: row.team ?? row.player?.team ?? "FA",
        injury: row.player?.injury_status ?? null,
      });
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
    team?: string | null;
    stats?: Record<string, number>;
    player?: {
      position?: string;
      fantasy_positions?: string[];
      active?: boolean;
      first_name?: string;
      last_name?: string;
      team?: string | null;
      injury_status?: string | null;
    };
  }[]) {
    if (!row?.player_id || !row.stats) continue;
    const pos = String(
      row.player?.position || row.player?.fantasy_positions?.[0] || "",
    ).toUpperCase();
    if (pos !== "DEF" && row.player?.active === false) continue;
    if (!pos) continue;
    const name =
      `${row.player?.first_name ?? ""} ${row.player?.last_name ?? ""}`.trim() ||
      row.team ||
      row.player?.team ||
      row.player_id;
    map.set(String(row.player_id), {
      stats: row.stats,
      pos,
      name,
      team: row.team ?? row.player?.team ?? "FA",
      injury: row.player?.injury_status ?? null,
    });
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
    // v5: drop all-zero / ADP-only Sleeper rows (hasScorableProjectionStats).
    queryKey: ["sleeper-weekly-projections", "v5", season, resolvedWeek ?? "auto"],
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
    projections: projections.data,
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

/**
 * Full-season Sleeper projected counting stats (page-scoped).
 * Same endpoint the catalog already uses — fetched only when a research
 * surface needs raw season lines, cached in React Query (not Supabase).
 */
async function fetchSeasonProjectionsFor(
  season: string,
): Promise<Map<string, WeeklyProjRow>> {
  const q = `season_type=regular&${positionsQuery()}&order_by=adp_half_ppr`;
  const trySeason = async (yr: string) => {
    const url = `${SLEEPER_BASE}/projections/nfl/${yr}?${q}`;
    const res = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
    const rows = res && res.ok ? ((await res.json()) as unknown) : null;
    return Array.isArray(rows) ? rows : [];
  };

  let rows = await trySeason(season);
  if (!rows.some((r) => hasScorableProjectionStats((r as { stats?: Record<string, number> }).stats))) {
    rows = await trySeason(String(Number(season) - 1));
  }

  const map = new Map<string, WeeklyProjRow>();
  for (const row of rows as {
    player_id?: string;
    team?: string | null;
    stats?: Record<string, number>;
    player?: {
      position?: string;
      fantasy_positions?: string[];
      first_name?: string;
      last_name?: string;
      team?: string | null;
      injury_status?: string | null;
    };
  }[]) {
    if (!row?.player_id || !hasScorableProjectionStats(row.stats)) continue;
    const pos = String(
      row.player?.position || row.player?.fantasy_positions?.[0] || "",
    ).toUpperCase();
    const name =
      `${row.player?.first_name ?? ""} ${row.player?.last_name ?? ""}`.trim() ||
      row.team ||
      row.player?.team ||
      row.player_id;
    map.set(String(row.player_id), {
      stats: row.stats!,
      pos,
      name,
      team: row.team ?? row.player?.team ?? "FA",
      injury: row.player?.injury_status ?? null,
    });
  }
  return map;
}

/** Season projected counting stats + league-scored fantasy points. */
export function useSeasonProjectionStats() {
  const { activeLeague } = useActiveLeague();
  const identifier = activeLeague?.leagueId ?? "";
  const platform = activeLeague?.platform ?? "sleeper";
  const nflState = useNflState();
  const season = nflState.data?.season ?? null;

  const scoring = useQuery({
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

  const projections = useQuery({
    // v3: drop all-zero / ADP-only Sleeper rows (hasScorableProjectionStats).
    queryKey: ["sleeper-season-projections", "v3", season],
    enabled: Boolean(season),
    // Mid-season role changes land on Sleeper season lines — keep fresher than a day.
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: () => fetchSeasonProjectionsFor(season!),
  });

  const map: ScoringMap = useMemo(
    () => scoring.data?.map ?? defaultScoringMap("half"),
    [scoring.data],
  );
  const format = scoring.data?.format ?? "half";

  const statsFor = useCallback(
    (playerId: string): Record<string, number> | null => {
      return projections.data?.get(playerId)?.stats ?? null;
    },
    [projections.data],
  );

  const projectFor = useCallback(
    (playerId: string): number | null => {
      const stats = projections.data?.get(playerId)?.stats;
      return projectionPoints(stats, map, format);
    },
    [projections.data, map, format],
  );

  return {
    statsFor,
    projectFor,
    projections: projections.data,
    format,
    season,
    scoringMap: map,
    loading: projections.isLoading || scoring.isLoading || nflState.isLoading,
  };
}
