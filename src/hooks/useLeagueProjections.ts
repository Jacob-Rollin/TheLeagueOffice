import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { getLeagueScoring } from "@/lib/scoring.functions";
import { SLEEPER_BASE, positionsQuery } from "@/lib/players-build";
import { defaultScoringMap, scoreStats, type ScoringMap } from "@/lib/scoring-map";

const HOUR = 1000 * 60 * 60;

type WeekState = { season: string; week: number };

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

/** Raw Sleeper projected stat lines for the current week, keyed by player id. */
async function fetchWeeklyProjections(): Promise<Map<string, Record<string, number>>> {
  const { season, week } = await fetchState();
  const url = `${SLEEPER_BASE}/projections/nfl/${season}/${week}?season_type=regular&${positionsQuery()}`;
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
 * Weekly projections rendered in the host league's own scoring system:
 * Sleeper's raw projected stat line multiplied by the active league's
 * customized scoring rule map (Sleeper / ESPN / Yahoo).
 */
export function useLeagueProjections() {
  const { activeLeague } = useActiveLeague();
  const identifier = activeLeague?.leagueId ?? "";
  const platform = activeLeague?.platform ?? "sleeper";

  const scoring = useQuery({
    queryKey: ["league-scoring", platform, identifier],
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
    queryKey: ["sleeper-weekly-projections"],
    staleTime: 6 * HOUR,
    retry: false,
    queryFn: fetchWeeklyProjections,
  });

  const map: ScoringMap = useMemo(
    () => scoring.data?.map ?? defaultScoringMap("half"),
    [scoring.data],
  );

  /** League-scored weekly projection for a player id, or null when unknown. */
  const projectFor = useCallback(
    (playerId: string): number | null => {
      const stats = projections.data?.get(playerId);
      return scoreStats(stats, map);
    },
    [projections.data, map],
  );

  return {
    projectFor,
    loading: projections.isLoading || scoring.isLoading,
    format: scoring.data?.format ?? "half",
  };
}
