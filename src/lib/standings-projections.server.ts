import { loadConnectionRosters } from "./league.server";
import { SLEEPER_BASE, positionsQuery } from "./players-build";
import { loadPlayers } from "./players.server";
import { loadLeagueScoring } from "./scoring.server";
import { projectionPoints } from "./scoring-map";
import { assignLineup, offensiveSlotDefs, optimalLineupPoints, starterSlots } from "./standings-analytics";

export type RestOfSeasonProjections = {
  weeks: number[];
  /** Aligned with `weeks`: rosterId -> projected best lineup for that week. */
  byWeek: Record<string, number>[];
};

const WEEK_TTL_MS = 30 * 60 * 1000;
const RESULT_TTL_MS = 15 * 60 * 1000;

const weekCache = new Map<string, { at: number; value: Promise<Map<string, Record<string, number>>> }>();

/** Raw Sleeper weekly projection stat lines, shared across leagues. */
function weekProjections(season: string, week: number): Promise<Map<string, Record<string, number>>> {
  const key = `${season}|${week}`;
  const hit = weekCache.get(key);
  if (hit && Date.now() - hit.at < WEEK_TTL_MS) return hit.value;
  const value = (async () => {
    const res = await fetch(
      `${SLEEPER_BASE}/projections/nfl/${season}/${week}?season_type=regular&${positionsQuery()}`,
      { headers: { accept: "application/json" } },
    ).catch(() => null);
    const rows = res && res.ok ? ((await res.json().catch(() => null)) as unknown) : null;
    const map = new Map<string, Record<string, number>>();
    if (Array.isArray(rows)) {
      for (const row of rows as { player_id?: string; stats?: Record<string, number> }[]) {
        if (row?.player_id && row.stats) map.set(String(row.player_id), row.stats);
      }
    }
    return map;
  })().catch((err) => {
    weekCache.delete(key);
    throw err;
  });
  weekCache.set(key, { at: Date.now(), value });
  return value;
}

const resultCache = new Map<string, { at: number; value: Promise<RestOfSeasonProjections | null> }>();

const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");

/**
 * Each team's projected best lineup for every remaining regular-season week, from Sleeper's
 * weekly projections in the league's scoring (byes and injury returns included). Only small
 * per-team totals leave the server.
 */
export function loadRestOfSeasonProjections(
  identifier: string,
  platform: string,
  fromWeek: number,
  toWeek: number,
  s2?: string | null,
  swid?: string | null,
): Promise<RestOfSeasonProjections | null> {
  const key = `${platform}|${identifier}|${fromWeek}|${toWeek}|${s2 ?? ""}|${swid ?? ""}`;
  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.value;
  const value = build(identifier, platform, fromWeek, toWeek, s2, swid).catch((err) => {
    resultCache.delete(key);
    throw err;
  });
  resultCache.set(key, { at: Date.now(), value });
  return value;
}

async function leagueContext(identifier: string, platform: string, s2?: string | null, swid?: string | null) {
  const [rosters, catalog, scoring] = await Promise.all([
    loadConnectionRosters(identifier, platform, s2, swid),
    loadPlayers(),
    loadLeagueScoring(identifier, platform, s2, swid),
  ]);
  if (!rosters?.teams?.length) return null;

  const byId = new Map(catalog.players.map((p) => [p.id, p]));
  const byName = new Map(catalog.players.map((p) => [normalizeName(p.name), p]));
  // IR players stay in: they project 0 while out and count again once they're due back.
  const teams = rosters.teams.map((t) => {
    const ids = new Set<string>(t.playerIds ?? []);
    for (const name of t.playerNames ?? []) {
      const hit = byName.get(normalizeName(name));
      if (hit) ids.add(hit.id);
    }
    return { slot: t.slot, players: [...ids].map((id) => ({ id, pos: byId.get(id)?.pos ?? "" })) };
  });
  const pointsIn = (stats: Map<string, Record<string, number>>, id: string) =>
    projectionPoints(stats.get(id), scoring.map, scoring.format) ?? 0;
  return { rosters, catalog, byId, teams, pointsIn };
}

const weekRange = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

async function build(
  identifier: string,
  platform: string,
  fromWeek: number,
  toWeek: number,
  s2?: string | null,
  swid?: string | null,
): Promise<RestOfSeasonProjections | null> {
  if (toWeek < fromWeek) return { weeks: [], byWeek: [] };
  const ctx = await leagueContext(identifier, platform, s2, swid);
  if (!ctx) return null;
  const slots = starterSlots(ctx.rosters.rosterPositions ?? []);

  const weeks = weekRange(fromWeek, toWeek);
  const byWeek = await Promise.all(
    weeks.map(async (week) => {
      const stats = await weekProjections(ctx.catalog.season, week).catch(() => new Map<string, Record<string, number>>());
      const out: Record<string, number> = {};
      if (!stats.size) return out;
      for (const team of ctx.teams) {
        const candidates = team.players.map((p) => ({ id: p.id, pos: p.pos, points: ctx.pointsIn(stats, p.id) }));
        out[String(team.slot)] = Math.round(optimalLineupPoints(candidates, slots) * 10) / 10;
      }
      return out;
    }),
  );
  return { weeks, byWeek };
}

export type SlotRankSeat = {
  label: string;
  playerId: string | null;
  name: string | null;
  pos: string | null;
  team: string | null;
  /** Projected rest-of-season points per game. */
  ppg: number;
};

export type StartingSlotRanks = {
  seats: string[];
  teams: {
    rosterId: number;
    total: number;
    seats: SlotRankSeat[];
    /** Every rostered player's projected rest-of-season points per game. */
    ppgById: Record<string, number>;
  }[];
};

const slotRanksCache = new Map<string, { at: number; value: Promise<StartingSlotRanks | null> }>();

/**
 * Each team's best offensive lineup by projected rest-of-season points per game in the league's
 * scoring. A player's average only counts weeks he's projected to play, so byes and missed
 * games don't drag it down (matches StatChaser's Starting Slot Ranks).
 */
export function loadStartingSlotRanks(
  identifier: string,
  platform: string,
  fromWeek: number,
  toWeek: number,
  s2?: string | null,
  swid?: string | null,
): Promise<StartingSlotRanks | null> {
  const key = `${platform}|${identifier}|${fromWeek}|${toWeek}|${s2 ?? ""}|${swid ?? ""}`;
  const hit = slotRanksCache.get(key);
  if (hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.value;
  const value = buildSlotRanks(identifier, platform, fromWeek, toWeek, s2, swid).catch((err) => {
    slotRanksCache.delete(key);
    throw err;
  });
  slotRanksCache.set(key, { at: Date.now(), value });
  return value;
}

async function buildSlotRanks(
  identifier: string,
  platform: string,
  fromWeek: number,
  toWeek: number,
  s2?: string | null,
  swid?: string | null,
): Promise<StartingSlotRanks | null> {
  const ctx = await leagueContext(identifier, platform, s2, swid);
  if (!ctx) return null;
  const defs = offensiveSlotDefs(ctx.rosters.rosterPositions ?? []);
  const weeks = weekRange(fromWeek, toWeek);
  const weekly = await Promise.all(
    weeks.map((week) =>
      weekProjections(ctx.catalog.season, week).catch(() => new Map<string, Record<string, number>>()),
    ),
  );

  const ppgOf = (id: string) => {
    let sum = 0;
    let games = 0;
    for (const stats of weekly) {
      const pts = ctx.pointsIn(stats, id);
      if (pts <= 0) continue;
      sum += pts;
      games += 1;
    }
    return games ? sum / games : 0;
  };

  const teams = ctx.teams.map((team) => {
    const candidates = team.players.map((p) => ({ id: p.id, pos: p.pos, points: ppgOf(p.id) }));
    const picks = assignLineup(candidates, defs);
    const seats: SlotRankSeat[] = defs.map((def, i) => {
      const pick = picks[i];
      const player = pick ? ctx.byId.get(pick.id) : undefined;
      return {
        label: def.label,
        playerId: pick?.id ?? null,
        name: player?.name ?? null,
        pos: pick?.pos ?? null,
        team: player?.team ?? null,
        ppg: Math.round((pick?.points ?? 0) * 10) / 10,
      };
    });
    const total = Math.round(picks.reduce((s, pick) => s + (pick?.points ?? 0), 0) * 10) / 10;
    const ppgById = Object.fromEntries(candidates.map((c) => [c.id, Math.round(c.points * 10) / 10]));
    return { rosterId: team.slot, total, seats, ppgById };
  });
  return { seats: defs.map((d) => d.label), teams };
}
