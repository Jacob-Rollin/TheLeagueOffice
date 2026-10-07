/**
 * Browser-side rest-of-season / starting-slot ranks for Sleeper leagues.
 * Used when CDN + Fluid leave Recommendation / Slot Ranks / schedule projections empty.
 */

import { currentSeason, positionsQuery, SLEEPER_BASE } from "@/lib/players-build";
import { getCached } from "@/lib/sleeper-cache";
import { fetchNflStateClient } from "@/lib/sleeper-client";
import { sleeperFetchJson } from "@/lib/sleeper-http";
import { fetchSleeperLeagueRostersClient } from "@/lib/sleeper-rosters-client";
import { fetchLeagueScoringPreferred } from "@/lib/scoring-client";
import { projectionPoints, type ScoringFormat, type ScoringMap } from "@/lib/scoring-map";
import {
  assignLineup,
  offensiveSlotDefs,
  optimalLineupPoints,
  starterSlots,
} from "@/lib/standings-analytics";
import type {
  RestOfSeasonProjections,
  StartingSlotRanks,
} from "@/lib/standings-projections.server";

const WEEK_CONCURRENCY = 2;

type ProjRow = {
  stats: Record<string, number>;
  pos: string;
  name: string;
  team: string;
};

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

function parseProjRows(raw: unknown): [string, ProjRow][] {
  const out: [string, ProjRow][] = [];
  if (!Array.isArray(raw)) return out;
  for (const row of raw as {
    player_id?: string;
    team?: string | null;
    stats?: Record<string, number>;
    player?: {
      first_name?: string;
      last_name?: string;
      position?: string;
      fantasy_positions?: string[];
      team?: string | null;
    };
  }[]) {
    if (!row?.player_id || !row.stats) continue;
    const pos = String(row.player?.position || row.player?.fantasy_positions?.[0] || "").toUpperCase();
    if (!pos) continue;
    const name =
      `${row.player?.first_name ?? ""} ${row.player?.last_name ?? ""}`.trim() ||
      row.team ||
      row.player?.team ||
      row.player_id;
    out.push([
      String(row.player_id),
      {
        stats: row.stats,
        pos,
        name,
        team: row.team ?? row.player?.team ?? "FA",
      },
    ]);
  }
  return out;
}

async function weekProjectionMap(season: string, week: number): Promise<Map<string, ProjRow>> {
  const safeWeek = Math.max(1, Math.min(18, Math.floor(week)));
  const entries = await getCached(
    `slot-ranks-week-proj-v1:${season}|${safeWeek}`,
    30 * 60 * 1000,
    async () => {
      const url = `${SLEEPER_BASE}/projections/nfl/${season}/${safeWeek}?season_type=regular&${positionsQuery()}`;
      const res = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
      if (res?.status === 429) {
        await new Promise((r) => setTimeout(r, 1200));
        const retry = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
        if (!retry?.ok) return [] as [string, ProjRow][];
        return parseProjRows(await retry.json());
      }
      if (!res?.ok) return [] as [string, ProjRow][];
      return parseProjRows(await res.json());
    },
  );
  return new Map(entries);
}

function weekRange(from: number, to: number): number[] {
  const a = Math.max(1, Math.min(18, Math.floor(from)));
  const b = Math.max(a, Math.min(18, Math.floor(to)));
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

async function loadClientContext(input: {
  identifier: string;
  platform: string;
  s2?: string;
  swid?: string;
  teamName?: string | null;
}) {
  const platform = String(input.platform ?? "sleeper").trim().toLowerCase();
  const identifier = String(input.identifier ?? "").trim();
  if (platform !== "sleeper" || !/^\d{6,}$/.test(identifier)) return null;

  const [rosters, scoring, state, league] = await Promise.all([
    fetchSleeperLeagueRostersClient(identifier, input.teamName),
    fetchLeagueScoringPreferred({
      identifier,
      platform,
      ...(input.s2 ? { s2: input.s2 } : {}),
      ...(input.swid ? { swid: input.swid } : {}),
    }),
    fetchNflStateClient().catch(() => null),
    // Keep SUPER_FLEX / raw seat tokens — roster client collapses SFLEX → FLEX.
    getCached(`sleeper-league-positions-v1:${identifier}`, 60 * 60 * 1000, async () => {
      const json = await sleeperFetchJson<{ roster_positions?: string[] }>(
        `https://api.sleeper.app/v1/league/${identifier}`,
        "warm",
      );
      return Array.isArray(json?.roster_positions) ? json.roster_positions.map(String) : [];
    }).catch(() => [] as string[]),
  ]);
  if (!rosters?.teams?.length) return null;

  const season = state?.season && /^\d{4}$/.test(state.season) ? state.season : currentSeason();
  const scoringMap: ScoringMap = scoring?.map ?? {};
  const format: ScoringFormat =
    scoring?.format === "std" || scoring?.format === "ppr" ? scoring.format : "half";
  const rosterPositions = league.length ? league : rosters.rosterPositions ?? [];
  return {
    season,
    scoringMap,
    format,
    rosterPositions,
    teams: rosters.teams.map((t) => ({
      slot: t.slot,
      playerIds: (t.playerIds ?? []).map(String).filter(Boolean),
    })),
  };
}

function pointsIn(
  stats: Map<string, ProjRow>,
  id: string,
  scoringMap: ScoringMap,
  format: ScoringFormat,
): number {
  const row = stats.get(id);
  if (!row) return 0;
  return projectionPoints(row.stats, scoringMap, format) ?? 0;
}

/** Rest-of-season best-lineup totals by week (browser Sleeper projections). */
export async function computeRestOfSeasonClient(input: {
  identifier: string;
  platform: string;
  fromWeek: number;
  toWeek: number;
  s2?: string;
  swid?: string;
  teamName?: string | null;
}): Promise<RestOfSeasonProjections | null> {
  const ctx = await loadClientContext(input);
  if (!ctx) return null;
  const weeks = weekRange(input.fromWeek, input.toWeek);
  if (!weeks.length) return { weeks: [], byWeek: [] };

  const slots = starterSlots(ctx.rosterPositions);
  const weekly = await mapPool(weeks, WEEK_CONCURRENCY, (week) =>
    weekProjectionMap(ctx.season, week).catch(() => new Map<string, ProjRow>()),
  );

  const byWeek = weekly.map((stats) => {
    const out: Record<string, number> = {};
    if (!stats.size) return out;
    for (const team of ctx.teams) {
      const candidates = team.playerIds.map((id) => {
        const row = stats.get(id);
        return {
          id,
          pos: row?.pos ?? "",
          points: pointsIn(stats, id, ctx.scoringMap, ctx.format),
        };
      });
      out[String(team.slot)] = Math.round(optimalLineupPoints(candidates, slots) * 10) / 10;
    }
    return out;
  });

  return { weeks, byWeek };
}

/** Best offensive lineup by projected ROS PPG (browser Sleeper projections). */
export async function computeStartingSlotRanksClient(input: {
  identifier: string;
  platform: string;
  fromWeek: number;
  toWeek: number;
  s2?: string;
  swid?: string;
  teamName?: string | null;
}): Promise<StartingSlotRanks | null> {
  const ctx = await loadClientContext(input);
  if (!ctx) return null;
  const weeks = weekRange(input.fromWeek, input.toWeek);
  if (!weeks.length) return { seats: [], teams: [] };

  const defs = offensiveSlotDefs(ctx.rosterPositions);
  const weekly = await mapPool(weeks, WEEK_CONCURRENCY, (week) =>
    weekProjectionMap(ctx.season, week).catch(() => new Map<string, ProjRow>()),
  );

  const metaById = new Map<string, { pos: string; name: string; team: string }>();
  for (const stats of weekly) {
    for (const [id, row] of stats) {
      if (!metaById.has(id)) metaById.set(id, { pos: row.pos, name: row.name, team: row.team });
    }
  }

  const ppgOf = (id: string) => {
    let sum = 0;
    let games = 0;
    for (const stats of weekly) {
      const pts = pointsIn(stats, id, ctx.scoringMap, ctx.format);
      if (pts <= 0) continue;
      sum += pts;
      games += 1;
    }
    return games ? sum / games : 0;
  };

  const teams = ctx.teams.map((team) => {
    const candidates = team.playerIds.map((id) => {
      const meta = metaById.get(id);
      return { id, pos: meta?.pos ?? "", points: ppgOf(id) };
    });
    const picks = assignLineup(candidates, defs);
    const seats = defs.map((def, i) => {
      const pick = picks[i];
      const meta = pick ? metaById.get(pick.id) : undefined;
      return {
        label: def.label,
        playerId: pick?.id ?? null,
        name: meta?.name ?? null,
        pos: pick?.pos ?? null,
        team: meta?.team ?? null,
        ppg: Math.round((pick?.points ?? 0) * 10) / 10,
      };
    });
    const total = Math.round(picks.reduce((s, pick) => s + (pick?.points ?? 0), 0) * 10) / 10;
    const ppgById = Object.fromEntries(
      candidates.map((c) => [c.id, Math.round(c.points * 10) / 10]),
    );
    return { rosterId: team.slot, total, seats, ppgById };
  });

  return { seats: defs.map((d) => d.label), teams };
}
