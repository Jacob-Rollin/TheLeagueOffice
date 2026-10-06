import {
  POSITIONS,
  adpPick,
  adpSpread,
  buildPlayersFromRows,
  byeWeeksFromSchedule,
  currentSeason,
  fetchProjections,
  fetchRows,
  fetchSeasonStats,
  num,
  positionsQuery,
  type Player,
  type PlayersPayload,
  type Pos,
  type SleeperRow,
  type Stats,
} from "./players-build";
import {
  isPracticeSquad,
  loadNflInjuryReport,
  loadNflRosterIndex,
  loadPracticeSquadIndex,
  type NflInjuryReportEntry,
} from "./nfl-roster-status.server";
import { NFL_TEAMS, teamFullName } from "./nfl-teams";
import { hasScorableProjectionStats, scoreStats } from "./scoring-map";

export type { Player, PlayersPayload, Pos };

export type SeasonLine = {
  season: string;
  games: number;
  points: { std: number; half: number; ppr: number };
  posRank: number | null;
  line: { label: string; value: string }[];
  /** Raw Sleeper stat keys for this season (projected or actual). */
  raw: Record<string, number>;
};

export type DepthEntry = {
  id: string;
  name: string;
  pos: Pos;
  proj: number;
  adp: number;
  injury: string | null;
};

export type PlayerDetail = {
  season: string;
  player: Player;
  history: SeasonLine[];
  /** Current season to date; null before the player has played a game this year. */
  seasonToDate: SeasonLine | null;
  projection: SeasonLine;
  depthChart: DepthEntry[];
  sos: {
    grade: string;
    rank: number | null;
    pointsAllowedPerGame: number | null;
    opponents: { week: number; opp: string; rank: number | null; pointsAllowed: number | null }[];
  } | null;
  injuryRisk: { score: number; label: string; factors: string[] };
};

const BASE = "https://api.sleeper.app";
const RESEARCH_BASE = "https://api.sleeper.com";

function memo<T>(ttl: number, fn: (key: string) => Promise<T>) {
  const store = new Map<string, { at: number; value: Promise<T> }>();
  return (key: string): Promise<T> => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = fn(key).catch((err) => {
      store.delete(key);
      throw err;
    });
    store.set(key, { at: Date.now(), value });
    return value;
  };
}

const HOUR = 1000 * 60 * 60;

/** Sleeper global ownership / start rates from the research endpoint. */
export type SleeperOwnership = { owned: number; started: number };

const ownershipResearch = memo<Map<string, SleeperOwnership>>(6 * HOUR, async (key) => {
  const [seasonType, season, week] = key.split("|");
  const res = await fetch(
    `${RESEARCH_BASE}/players/nfl/research/${seasonType}/${season}/${week}`,
    { headers: { accept: "application/json" } },
  );
  if (!res.ok) return new Map();
  const json = (await res.json().catch(() => null)) as Record<
    string,
    { owned?: number; started?: number }
  > | null;
  const map = new Map<string, SleeperOwnership>();
  if (!json || typeof json !== "object") return map;
  for (const [id, row] of Object.entries(json)) {
    if (!row) continue;
    const owned = Number(row.owned);
    const started = Number(row.started);
    map.set(id, {
      owned: Number.isFinite(owned) ? Math.round(owned) : 0,
      started: Number.isFinite(started) ? Math.round(started) : 0,
    });
  }
  return map;
});

/** Current-week Sleeper rostered % map keyed by player id. */
export async function loadSleeperOwnershipMap(): Promise<Map<string, SleeperOwnership>> {
  const stateRes = await fetch(`${BASE}/v1/state/nfl`, {
    headers: { accept: "application/json" },
  }).catch(() => null);
  const state = stateRes?.ok
    ? ((await stateRes.json().catch(() => null)) as {
        season?: string;
        week?: number;
        season_type?: string;
        previous_season?: string;
      } | null)
    : null;
  const season = String(state?.season ?? currentSeason());
  const week = Math.max(1, Number(state?.week) || 1);
  const seasonType =
    state?.season_type === "post" ||
    state?.season_type === "pre" ||
    state?.season_type === "off"
      ? state.season_type
      : "regular";
  let map = await ownershipResearch(`${seasonType}|${season}|${week}`);
  if (map.size === 0 && state?.previous_season) {
    map = await ownershipResearch(`regular|${state.previous_season}|18`);
  }
  return map;
}

/** Season-long stats for every player, keyed by player id. */
const seasonStats = memo<Map<string, Stats>>(6 * HOUR, (season) => fetchSeasonStats(season));

/** In-progress season totals move every week, so refresh them more often. */
const seasonToDateStats = memo<Map<string, Stats>>(HOUR, (season) => fetchSeasonStats(season));

/* ---------- in-season trade value basis ---------- */

/** Fantasy regular season + playoffs run through week 17. */
const FANTASY_LAST_WEEK = 17;

type PtsTriple = [number, number, number];

/** One week's projected points [std, half, ppr] for every player with a real line. */
const weekProjectionPoints = memo<Map<string, PtsTriple>>(30 * 60 * 1000, async (key) => {
  const [season, week] = key.split("|") as [string, string];
  const rows = await fetchRows(
    `${BASE}/projections/nfl/${season}/${week}?season_type=regular&${positionsQuery()}`,
  ).catch(() => []);
  const map = new Map<string, PtsTriple>();
  for (const row of rows) {
    const stats = row.stats;
    if (!row.player_id || !stats || !hasScorableProjectionStats(stats)) continue;
    map.set(row.player_id, [
      Math.max(0, num(stats["pts_std"], 0)),
      Math.max(0, num(stats["pts_half_ppr"], 0)),
      Math.max(0, num(stats["pts_ppr"], 0)),
    ]);
  }
  return map;
});

const nflState = memo<{ season: string; week: number; seasonType: string }>(
  10 * 60 * 1000,
  async () => {
    const res = await fetch(`${BASE}/v1/state/nfl`, { headers: { accept: "application/json" } }).catch(
      () => null,
    );
    const state = res?.ok
      ? ((await res.json().catch(() => null)) as { season?: string; week?: number; season_type?: string } | null)
      : null;
    return {
      season: String(state?.season ?? currentSeason()),
      week: Math.max(1, Number(state?.week) || 1),
      seasonType: String(state?.season_type ?? "regular"),
    };
  },
);

export type TradeValueBasisEntry = {
  /** Current season to date: games played and points [std, half, ppr]. */
  gp: number;
  pts: PtsTriple;
  /** Previous season: games played and points [std, half, ppr]. */
  prevGp: number;
  prevPts: PtsTriple;
  /** Remaining weeks with a projection, and their summed points [std, half, ppr]. */
  rosGames: number;
  rosPts: PtsTriple;
};

export type TradeValueBasis = {
  season: string;
  /** First week counted as remaining (the current NFL week). */
  week: number;
  /** Weeks left through the fantasy season, byes included. */
  remainingWeeks: number;
  /** False when remaining-week projections failed to load (callers fall back to season projections). */
  rosAvailable: boolean;
  players: Record<string, TradeValueBasisEntry>;
};

const tradeValueBasis = memo<TradeValueBasis>(30 * 60 * 1000, async () => {
  const [built, state] = await Promise.all([buildPlayers("v2"), nflState("state")]);
  const season = built.payload.season;
  const inSeason = state.seasonType === "regular" && state.season === season;
  const startWeek = inSeason ? state.week : 1;
  const weeks = Array.from(
    { length: Math.max(0, FANTASY_LAST_WEEK - startWeek + 1) },
    (_, i) => startWeek + i,
  );

  const [current, prev, weekMaps] = await Promise.all([
    inSeason ? seasonToDateStats(season).catch(() => new Map<string, Stats>()) : new Map<string, Stats>(),
    seasonStats(String(Number(season) - 1)).catch(() => new Map<string, Stats>()),
    Promise.all(weeks.map((w) => weekProjectionPoints(`${season}|${w}`).catch(() => new Map()))),
  ]);

  const triple = (stats: Stats | undefined): PtsTriple => [
    num(stats?.["pts_std"], 0),
    num(stats?.["pts_half_ppr"], 0),
    num(stats?.["pts_ppr"], 0),
  ];

  const players: Record<string, TradeValueBasisEntry> = {};
  for (const p of built.all) {
    const cur = current.get(p.id);
    const last = prev.get(p.id);
    const rosPts: PtsTriple = [0, 0, 0];
    let rosGames = 0;
    for (const map of weekMaps) {
      const hit = map.get(p.id);
      if (!hit) continue;
      rosGames += 1;
      rosPts[0] += hit[0];
      rosPts[1] += hit[1];
      rosPts[2] += hit[2];
    }
    players[p.id] = {
      gp: num(cur?.["gp"], 0),
      pts: triple(cur),
      prevGp: num(last?.["gp"], 0),
      prevPts: triple(last),
      rosGames,
      rosPts: rosPts.map((v) => Math.round(v * 100) / 100) as PtsTriple,
    };
  }

  return {
    season,
    week: startWeek,
    remainingWeeks: weeks.length,
    rosAvailable: weekMaps.some((m) => m.size > 0),
    players,
  };
});

/** Season-to-date stats, last season and rest-of-season projections for trade valuation. */
export function loadTradeValueBasis(): Promise<TradeValueBasis> {
  return tradeValueBasis("basis");
}

type ScheduleGame = {
  week: number;
  home: string;
  away: string;
  date?: string | null;
  status?: string | null;
};

const scheduleForType = memo<ScheduleGame[]>(24 * HOUR, async (key) => {
  const [type, season] = key.split("|") as [string, string];
  const res = await fetch(`${BASE}/schedule/nfl/${type}/${season}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as ScheduleGame[];
  return Array.isArray(json) ? json : [];
});

const scheduleFor = (season: string) => scheduleForType(`regular|${season}`);

export type NextGame = {
  season: string;
  week: number;
  home: string;
  away: string;
  date: string | null;
  isHome: boolean;
  opponent: string;
  seasonType: "pre" | "regular";
};

/** Next scheduled matchup for an NFL team abbreviation, or null. */
export async function loadNextGame(team: string): Promise<NextGame | null> {
  const abbr = (team || "").toUpperCase();
  if (!abbr || abbr === "FA") return null;
  const season = currentSeason();
  const [pre, reg] = await Promise.all([
    scheduleForType(`pre|${season}`).catch(() => []),
    scheduleForType(`regular|${season}`).catch(() => []),
  ]);
  type Tagged = ScheduleGame & { seasonType: "pre" | "regular" };
  const mine: Tagged[] = [
    ...pre.map((g) => ({ ...g, seasonType: "pre" as const })),
    ...reg.map((g) => ({ ...g, seasonType: "regular" as const })),
  ]
    .filter((g) => g.home === abbr || g.away === abbr)
    .sort((a, b) => {
      if (a.seasonType !== b.seasonType) return a.seasonType === "pre" ? -1 : 1;
      return a.week - b.week;
    });
  if (mine.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  // Prefer a live/upcoming game, including in-progress preseason games today.
  const upcoming =
    mine.find((g) => (g.date ? g.date >= today : false)) ??
    mine.find((g) => g.status === "pre_game" || g.status === "in_game") ??
    mine[0]!;
  const isHome = upcoming.home === abbr;
  return {
    season,
    week: upcoming.week,
    home: upcoming.home,
    away: upcoming.away,
    date: upcoming.date ?? null,
    isHome,
    opponent: isHome ? upcoming.away : upcoming.home,
    seasonType: upcoming.seasonType,
  };
}

/** Weeks 1-18 with no scheduled game, per team. */
async function byeWeeks(season: string): Promise<Map<string, number>> {
  return byeWeeksFromSchedule(await scheduleFor(season));
}

type ProjectionsResult = { season: string; rows: SleeperRow[] };

const projectionsFor = memo<ProjectionsResult>(6 * HOUR, (season) => fetchProjections(season));

type Built = {
  payload: PlayersPayload;
  rawProj: Map<string, Stats>;
  all: Player[];
};

const buildPlayers = memo<Built>(6 * HOUR, async () => {
  const { season, rows: projRows } = await projectionsFor(currentSeason());
  const prevSeason = String(Number(season) - 1);
  const prevStats = await seasonStats(prevSeason);
  const byeByTeam = await byeWeeks(season).catch(() => new Map<string, number>());

  const { players: all, rawProj } = buildPlayersFromRows({
    season,
    projRows,
    prevStats,
    byeByTeam,
  });

  return {
    all,
    rawProj,
    payload: { season, updatedAt: Date.now(), players: all },
  };
});

export async function loadPlayers(): Promise<PlayersPayload> {
  return (await buildPlayers("v2")).payload;
}

/* ---------- player detail ---------- */

const STAT_LINES: Partial<Record<Pos, [string, string, number][]>> = {
  QB: [
    ["pass_yd", "Pass yds", 0],
    ["pass_td", "Pass TD", 0],
    ["pass_int", "INT", 0],
    ["rush_yd", "Rush yds", 0],
    ["rush_td", "Rush TD", 0],
  ],
  RB: [
    ["rush_att", "Carries", 0],
    ["rush_yd", "Rush yds", 0],
    ["rush_td", "Rush TD", 0],
    ["rec", "Rec", 0],
    ["rec_yd", "Rec yds", 0],
    ["rec_td", "Rec TD", 0],
  ],
  WR: [
    ["rec_tgt", "Targets", 0],
    ["rec", "Rec", 0],
    ["rec_yd", "Rec yds", 0],
    ["rec_td", "Rec TD", 0],
    ["rush_yd", "Rush yds", 0],
  ],
  TE: [
    ["rec_tgt", "Targets", 0],
    ["rec", "Rec", 0],
    ["rec_yd", "Rec yds", 0],
    ["rec_td", "Rec TD", 0],
  ],
  K: [
    ["fgm", "FG made", 0],
    ["fga", "FG att", 0],
    ["xpm", "XP made", 0],
  ],
  DEF: [
    ["def_st_td", "TD", 0],
    ["sack", "Sacks", 0],
    ["int", "INT", 0],
    ["pts_allow", "Pts allowed", 0],
  ],
};

function statLine(pos: Pos, stats: Stats): { label: string; value: string }[] {
  const defs = STAT_LINES[pos] ?? [];
  return defs
    .map(([key, label, digits]) => ({ label, value: num(stats[key], 0).toFixed(digits) }))
    .filter((x) => x.value !== "0" || defs.length <= 4);
}

function toSeasonLine(season: string, pos: Pos, stats: Stats): SeasonLine {
  return {
    season,
    games: num(stats["gp"], 0),
    points: {
      std: num(stats["pts_std"], 0),
      half: num(stats["pts_half_ppr"], 0),
      ppr: num(stats["pts_ppr"], 0),
    },
    posRank: stats["pos_rank_half_ppr"] ? num(stats["pos_rank_half_ppr"], 0) : null,
    line: statLine(pos, stats),
    raw: stats,
  };
}

/** Fantasy points [std, half, ppr] one team allowed to a position, total and per game played. */
type AllowedCell = {
  pts: PtsTriple;
  games: number;
  weeks: Record<number, { vs: string; pts: PtsTriple }>;
};

export type AllowedFormat = "std" | "half" | "ppr";
const FORMAT_SLOT: Record<AllowedFormat, 0 | 1 | 2> = { std: 0, half: 1, ppr: 2 };

type AllowedTable = {
  maxWeek: number;
  computedAt: string;
  /** Team -> position -> allowed. For DEF this is what defenses scored against that offense. */
  byTeam: Map<string, Map<Pos, AllowedCell>>;
};

const defenseAllowed = memo<AllowedTable>(HOUR, async (season) => {
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  const byTeam = new Map<string, Map<Pos, AllowedCell>>();
  const cellFor = (team: string, pos: Pos): AllowedCell => {
    let byPos = byTeam.get(team);
    if (!byPos) byTeam.set(team, (byPos = new Map()));
    let cell = byPos.get(pos);
    if (!cell) byPos.set(pos, (cell = { pts: [0, 0, 0], games: 0, weeks: {} }));
    return cell;
  };
  const round2 = (v: number) => Math.round(v * 100) / 100;
  let maxWeek = 0;

  for (let i = 0; i < weeks.length; i += 6) {
    const chunk = weeks.slice(i, i + 6);
    const results = await Promise.all(
      chunk.map(async (week) => ({
        week,
        rows: await fetchRows(
          `${BASE}/stats/nfl/${season}/${week}?season_type=regular&${positionsQuery()}`,
        ).catch(() => [] as SleeperRow[]),
      })),
    );
    for (const { week, rows } of results) {
      // Team -> opponent for every team that played this week.
      const played = new Map<string, string>();
      for (const row of rows) {
        const opp = (row.opponent ?? "").trim().toUpperCase();
        const team = (row.team ?? "").trim().toUpperCase();
        const pos = (row.player?.position ?? "") as Pos;
        if (!opp || !POSITIONS.includes(pos) || !(num(row.stats?.["gp"], 0) > 0)) continue;
        played.set(opp, team);
        if (team) played.set(team, opp);
        const half = num(row.stats?.["pts_half_ppr"], 0);
        const pts: PtsTriple = [
          num(row.stats?.["pts_std"], half),
          half,
          num(row.stats?.["pts_ppr"], half),
        ];
        const cell = cellFor(opp, pos);
        const wk = (cell.weeks[week] ??= { vs: team, pts: [0, 0, 0] });
        for (const i of [0, 1, 2] as const) {
          cell.pts[i] += pts[i];
          wk.pts[i] += pts[i];
        }
      }
      if (played.size) maxWeek = Math.max(maxWeek, week);
      // A game counts for every position, so holding a position scoreless lowers its average.
      for (const [team, opp] of played) {
        for (const pos of POSITIONS) {
          const cell = cellFor(team, pos);
          cell.weeks[week] ??= { vs: opp, pts: [0, 0, 0] };
        }
      }
    }
  }

  for (const byPos of byTeam.values()) {
    for (const cell of byPos.values()) {
      cell.games = Object.keys(cell.weeks).length;
      cell.pts = cell.pts.map(round2) as PtsTriple;
      for (const wk of Object.values(cell.weeks)) wk.pts = wk.pts.map(round2) as PtsTriple;
    }
  }
  return { maxWeek, computedAt: new Date().toISOString(), byTeam };
});

/** Games of current-season data before a defense's rank stops leaning on last season. */
const SOS_PRIOR_GAMES = 4;

type SosAllowed = {
  season: string;
  /** Season blended in as a prior, or used outright before any current games. */
  priorSeason: string | null;
  maxWeek: number;
  computedAt: string;
  current: AllowedTable | null;
  /** Index into each cell's [std, half, ppr] points for this format. */
  slot: 0 | 1 | 2;
  /** Position -> team -> blended points allowed per game. */
  perGame: Map<Pos, Map<string, number>>;
  /** Position -> team -> rank (1 = stingiest / toughest matchup, 32 = softest). */
  rank: Map<Pos, Map<string, number>>;
};

/**
 * Positional points allowed per game for SOS: current-season games, regressed toward last
 * season's average until a team has {@link SOS_PRIOR_GAMES} games this year.
 */
const sosAllowedMemo = memo<SosAllowed>(HOUR, async (key) => {
  const [season = currentSeason(), fmt = "half"] = key.split("|");
  const slot = FORMAT_SLOT[fmt as AllowedFormat] ?? 1;
  const prev = String(Number(season) - 1);
  const [current, previous] = await Promise.all([
    defenseAllowed(season).catch(() => null),
    defenseAllowed(prev).catch(() => null),
  ]);
  const hasCurrent = Boolean(current && current.maxWeek > 0);
  let usedPrior = false;

  const perGame = new Map<Pos, Map<string, number>>();
  const rank = new Map<Pos, Map<string, number>>();
  for (const pos of POSITIONS) {
    const scores = new Map<string, number>();
    const teams = new Set([
      ...(hasCurrent ? current!.byTeam.keys() : []),
      ...(previous?.byTeam.keys() ?? []),
    ]);
    for (const team of teams) {
      const cur = hasCurrent ? current!.byTeam.get(team)?.get(pos) : undefined;
      const prior = previous?.byTeam.get(team)?.get(pos);
      const priorAvg = prior && prior.games > 0 ? prior.pts[slot] / prior.games : null;
      const games = cur?.games ?? 0;
      let value: number | null = null;
      if (priorAvg != null && games < SOS_PRIOR_GAMES) {
        const weight = SOS_PRIOR_GAMES - games;
        value = ((cur?.pts[slot] ?? 0) + priorAvg * weight) / (games + weight);
        usedPrior = true;
      } else if (cur && games > 0) {
        value = cur.pts[slot] / games;
      }
      if (value != null) scores.set(team, Math.round(value * 100) / 100);
    }
    perGame.set(pos, scores);
    const ranked = [...scores.entries()].sort((a, b) => a[1] - b[1]);
    rank.set(pos, new Map(ranked.map(([team], i) => [team, i + 1])));
  }

  return {
    season,
    priorSeason: usedPrior ? prev : null,
    maxWeek: hasCurrent ? current!.maxWeek : 0,
    computedAt: (hasCurrent ? current : previous)?.computedAt ?? new Date().toISOString(),
    current: hasCurrent ? current : null,
    slot,
    perGame,
    rank,
  };
});

const sosAllowed = (season: string, format: AllowedFormat = "half") =>
  sosAllowedMemo(`${season}|${format}`);

export type FantasyPointsAllowedPos = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export type FantasyPointsAllowedCell = {
  rank: number | null;
  pa: number | null;
};

export type FantasyPointsAllowedRow = {
  team: string;
  teamName: string;
  cells: Record<FantasyPointsAllowedPos, FantasyPointsAllowedCell>;
};

export type FantasyPointsAllowedPayload = {
  season: string;
  weeksFrom: number;
  weeksTo: number;
  rows: FantasyPointsAllowedRow[];
};

const PA_POSITIONS: FantasyPointsAllowedPos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * League-wide Fantasy Points Allowed board:
 * For each NFL defense × fantasy position, PA = avg points allowed per game in
 * the given scoring format, ranked high→low so rank 1 is the easiest offensive matchup.
 */
export async function loadFantasyPointsAllowed(
  season = currentSeason(),
  format: AllowedFormat = "half",
  opts?: { allowCompute?: boolean },
): Promise<FantasyPointsAllowedPayload> {
  const seasonKey = String(season ?? currentSeason()).slice(0, 16);
  const fmt = format in FORMAT_SLOT ? format : "half";
  const snapKey = `${seasonKey}|${fmt}`;
  const empty: FantasyPointsAllowedPayload = {
    season: seasonKey,
    weeksFrom: 0,
    weeksTo: 0,
    rows: [],
  };
  const { withResearchSnap } = await import("./research-agg.server");
  return withResearchSnap("agg_fpa", snapKey, opts, empty, () => computeFantasyPointsAllowed(seasonKey, fmt));
}

async function computeFantasyPointsAllowed(
  season: string,
  format: AllowedFormat,
): Promise<FantasyPointsAllowedPayload> {
  const slot = FORMAT_SLOT[format] ?? 1;
  const prev = String(Number(season) - 1);
  const [active, previous] = await Promise.all([
    defenseAllowed(season).catch(() => null),
    defenseAllowed(prev).catch(() => null),
  ]);
  const table = active && active.maxWeek > 0 ? active : previous;
  const usedSeason = active && active.maxWeek > 0 ? season : prev;
  const maxWeek = table?.maxWeek ?? 0;

  const emptyCell = (): FantasyPointsAllowedCell => ({ rank: null, pa: null });
  const perPos = new Map<FantasyPointsAllowedPos, Map<string, number>>();

  for (const pos of PA_POSITIONS) {
    const scores = new Map<string, number>();
    if (table) {
      for (const [team, byPos] of table.byTeam) {
        const cell = byPos.get(pos);
        if (cell && cell.games > 0) {
          scores.set(team, Math.round((cell.pts[slot] / cell.games) * 100) / 100);
        }
      }
    }
    perPos.set(pos, scores);
  }

  // Rank 1 = highest PA (easiest matchup for that position).
  const rankOf = new Map<FantasyPointsAllowedPos, Map<string, number>>();
  for (const pos of PA_POSITIONS) {
    const ranked = [...(perPos.get(pos)?.entries() ?? [])].sort((a, b) => b[1] - a[1]);
    rankOf.set(pos, new Map(ranked.map(([team], i) => [team, i + 1])));
  }

  const rows: FantasyPointsAllowedRow[] = NFL_TEAMS.map((t) => {
    const cells = {} as Record<FantasyPointsAllowedPos, FantasyPointsAllowedCell>;
    for (const pos of PA_POSITIONS) {
      const pa = perPos.get(pos)?.get(t.id) ?? null;
      const rank = rankOf.get(pos)?.get(t.id) ?? null;
      cells[pos] = pa == null && rank == null ? emptyCell() : { pa, rank };
    }
    return {
      team: t.id,
      teamName: teamFullName(t.id),
      cells,
    };
  }).sort((a, b) => a.teamName.localeCompare(b.teamName));

  return {
    season: usedSeason,
    weeksFrom: maxWeek > 0 ? 1 : 0,
    weeksTo: maxWeek,
    rows,
  };
}

function sosGrade(avgRank: number): string {
  if (avgRank <= 10) return "Very hard";
  if (avgRank <= 14) return "Hard";
  if (avgRank <= 19) return "Neutral";
  if (avgRank <= 24) return "Easy";
  return "Very easy";
}

async function buildSosFor(team: string, pos: Pos, season: string) {
  if (team === "FA") return null;
  // DEF uses the same board: fantasy points allowed to defenses by each offense.
  const [allowed, schedule] = await Promise.all([
    sosAllowed(season).catch(() => null),
    scheduleFor(season).catch(() => []),
  ]);
  const perGame = allowed?.perGame.get(pos);
  const rankOf = allowed?.rank.get(pos);
  if (!perGame || perGame.size === 0 || !rankOf) return null;

  const opponents = schedule
    .filter((g) => g.home === team || g.away === team)
    .filter((g) => g.week >= 1 && g.week <= 18)
    .sort((a, b) => a.week - b.week)
    .map((g) => {
      const opp = g.home === team ? g.away : g.home;
      const pointsAllowed = perGame.get(opp);
      return {
        week: g.week,
        opp,
        rank: rankOf.get(opp) ?? null,
        pointsAllowed: pointsAllowed === undefined ? null : Math.round(pointsAllowed * 100) / 100,
      };
    });

  const ranks = opponents.map((o) => o.rank).filter((r): r is number => r !== null);
  const avg = ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
  const schedulePa = opponents
    .map((o) => o.pointsAllowed)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const avgPa =
    schedulePa.length > 0
      ? schedulePa.reduce((a, b) => a + b, 0) / schedulePa.length
      : null;

  return {
    grade: avg === null ? "Unknown" : sosGrade(avg),
    rank: avg === null ? null : Math.round(avg),
    pointsAllowedPerGame: avgPa === null ? null : Math.round(avgPa * 100) / 100,
    opponents,
  };
}

export type SosMatrixEntry = NonNullable<PlayerDetail["sos"]>;

async function buildSos(player: Player, season: string) {
  return buildSosFor(player.team, player.pos, season);
}

/** Public SOS builder for a team × position (positional FPA ranks). */
export async function loadTeamPosSos(
  team: string,
  pos: string,
  season = currentSeason(),
): Promise<SosMatrixEntry | null> {
  const upperTeam = (team || "").toUpperCase();
  const upperPos = (pos || "").toUpperCase() as Pos;
  if (!upperTeam || upperTeam === "FA") return null;
  if (!POSITIONS.includes(upperPos)) return null;
  return buildSosFor(upperTeam, upperPos, season);
}

/** One synchronized schedule entry per unique NFL team and fantasy position. */
export async function loadSosMatrix(
  players: readonly { team?: string | null; position?: string | null }[],
  season = currentSeason(),
): Promise<Map<string, SosMatrixEntry>> {
  const keys = new Set<string>();
  for (const player of players) {
    const team = (player.team ?? "").toUpperCase();
    const pos = (player.position ?? "").toUpperCase() as Pos;
    if (team && team !== "FA" && POSITIONS.includes(pos)) keys.add(`${team}|${pos}`);
  }

  const matrix = new Map<string, SosMatrixEntry>();
  await Promise.all(
    [...keys].map(async (matrixKey) => {
      const [team, pos] = matrixKey.split("|") as [string, Pos];
      const sos = await buildSosFor(team, pos, season);
      if (sos) matrix.set(matrixKey, sos);
    }),
  );
  return matrix;
}

export type SosBoard = {
  season: string;
  priorSeason: string | null;
  dataThroughWeek: number;
  updatedAt: string;
  /** Position -> team -> [rank (1 = toughest), points allowed per game]. */
  ranks: Record<string, Record<string, [number, number]>>;
  /** [week, home, away] for every regular-season game. */
  schedule: [number, string, string][];
};

/**
 * Compact positional SOS ranks + schedule so clients can rebuild any team × position SOS.
 * TiDB-first when configured: request path never fans out 18 Sleeper week stats.
 * Pass `{ allowCompute: true }` from cron to warm/rebuild the snapshot.
 */
export async function loadSosBoard(
  seasonInput?: string,
  opts?: { allowCompute?: boolean },
): Promise<SosBoard> {
  const state = await nflState("state");
  const season = seasonInput && /^\d{4}$/.test(seasonInput) ? seasonInput : state.season;
  const allowCompute = opts?.allowCompute === true;

  try {
    const { tidbConfigured } = await import("@/lib/tidb");
    if (tidbConfigured()) {
      const { readAggJson } = await import("./research-agg.server");
      const cached = await readAggJson<SosBoard>("agg_sos", season);
      if (cached?.ranks && Array.isArray(cached.schedule)) return cached;
      if (!allowCompute) {
        return {
          season,
          priorSeason: null,
          dataThroughWeek: 0,
          updatedAt: new Date().toISOString(),
          ranks: {},
          schedule: [],
        };
      }
    }
  } catch {
    /* compute below when allowed */
  }

  if (!allowCompute) {
    // No TiDB (or read failed) and not a cron warm — avoid request-path 18-week fan-out.
    try {
      const { tidbConfigured } = await import("@/lib/tidb");
      if (tidbConfigured()) {
        return {
          season,
          priorSeason: null,
          dataThroughWeek: 0,
          updatedAt: new Date().toISOString(),
          ranks: {},
          schedule: [],
        };
      }
    } catch {
      /* fall through to compute for local/dev without TiDB */
    }
  }

  const [allowed, schedule] = await Promise.all([
    sosAllowed(season).catch(() => null),
    scheduleFor(season).catch(() => [] as ScheduleGame[]),
  ]);
  const ranks: SosBoard["ranks"] = {};
  for (const pos of POSITIONS) {
    const byTeam: Record<string, [number, number]> = {};
    for (const [team, rank] of allowed?.rank.get(pos) ?? []) {
      byTeam[team] = [rank, allowed?.perGame.get(pos)?.get(team) ?? 0];
    }
    ranks[pos] = byTeam;
  }
  const board: SosBoard = {
    season,
    priorSeason: allowed?.priorSeason ?? null,
    dataThroughWeek: allowed?.maxWeek ?? 0,
    updatedAt: allowed?.computedAt ?? new Date().toISOString(),
    ranks,
    schedule: schedule
      .filter((g) => g.week >= 1 && g.week <= 18 && g.home && g.away)
      .map((g) => [g.week, g.home, g.away] as [number, string, string]),
  };

  void import("./research-agg.server")
    .then(({ writeAggJson }) => writeAggJson("agg_sos", season, board))
    .catch(() => undefined);

  return board;
}

export type MatchupDefenseCell = {
  /** 1 = toughest matchup for the position, 32 = softest. */
  rank: number;
  /** Blended points allowed per game used for the rank. */
  pa: number;
  /** This season only: games and points allowed per game. */
  games: number;
  seasonPa: number | null;
  weeks: { week: number; vs: string; pts: number }[];
};

export type MatchupsGuide = {
  season: string;
  week: number;
  currentWeek: number;
  priorSeason: string | null;
  dataThroughWeek: number;
  updatedAt: string;
  /** NFL team -> this week's opponent. Teams on bye are absent. */
  games: Record<string, { opp: string; home: boolean }>;
  /** Position -> defending team -> matchup cell. */
  defense: Record<string, Record<string, MatchupDefenseCell>>;
};

/** Every NFL team's opponent for a week plus positional defense grades behind each matchup. */
export async function loadMatchupsGuide(
  weekInput?: number | null,
  format: AllowedFormat = "half",
  opts?: { allowCompute?: boolean },
): Promise<MatchupsGuide> {
  const state = await nflState("state");
  const season = state.season;
  const currentWeek = state.seasonType === "regular" ? Math.min(18, state.week) : 1;
  const week =
    weekInput != null && Number.isFinite(weekInput) && weekInput >= 1 && weekInput <= 18
      ? Math.round(weekInput)
      : currentWeek;
  const fmt = format in FORMAT_SLOT ? format : "half";
  const snapKey = `${season}|${week}|${fmt}`;
  const empty: MatchupsGuide = {
    season,
    week,
    currentWeek,
    priorSeason: null,
    dataThroughWeek: 0,
    updatedAt: new Date().toISOString(),
    games: {},
    defense: {},
  };
  const { withResearchSnap } = await import("./research-agg.server");
  return withResearchSnap("agg_matchups_guide", snapKey, opts, empty, () =>
    computeMatchupsGuide(season, week, currentWeek, fmt),
  );
}

async function computeMatchupsGuide(
  season: string,
  week: number,
  currentWeek: number,
  format: AllowedFormat,
): Promise<MatchupsGuide> {
  const [allowed, schedule] = await Promise.all([
    sosAllowed(season, format).catch(() => null),
    scheduleFor(season).catch(() => [] as ScheduleGame[]),
  ]);

  const games: MatchupsGuide["games"] = {};
  for (const g of schedule) {
    if (g.week !== week || !g.home || !g.away) continue;
    games[g.home] = { opp: g.away, home: true };
    games[g.away] = { opp: g.home, home: false };
  }

  const defense: MatchupsGuide["defense"] = {};
  for (const pos of POSITIONS) {
    const byTeam: Record<string, MatchupDefenseCell> = {};
    for (const [team, rank] of allowed?.rank.get(pos) ?? []) {
      const cur = allowed?.current?.byTeam.get(team)?.get(pos);
      const slot = allowed?.slot ?? 1;
      byTeam[team] = {
        rank,
        pa: allowed?.perGame.get(pos)?.get(team) ?? 0,
        games: cur?.games ?? 0,
        seasonPa:
          cur && cur.games > 0 ? Math.round((cur.pts[slot] / cur.games) * 100) / 100 : null,
        weeks: Object.entries(cur?.weeks ?? {})
          .map(([w, v]) => ({ week: Number(w), vs: v.vs, pts: v.pts[slot] }))
          .sort((a, b) => a.week - b.week),
      };
    }
    defense[pos] = byTeam;
  }

  return {
    season,
    week,
    currentWeek,
    priorSeason: allowed?.priorSeason ?? null,
    dataThroughWeek: allowed?.maxWeek ?? 0,
    updatedAt: allowed?.computedAt ?? new Date().toISOString(),
    games,
    defense,
  };
}

export type DepthChartEntry = { id: string; name: string; injury: string | null };

/** Team -> position -> active players in Sleeper depth chart order. */
const depthCharts = memo<Map<string, Map<Pos, DepthChartEntry[]>>>(6 * HOUR, async () => {
  const res = await fetch(`${BASE}/v1/players/nfl`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Upstream ${res.status}`);
  const raw = (await res.json()) as Record<
    string,
    {
      full_name?: string;
      first_name?: string;
      last_name?: string;
      position?: string | null;
      team?: string | null;
      status?: string | null;
      injury_status?: string | null;
      depth_chart_order?: number | null;
    }
  >;
  const listed: { team: string; pos: Pos; order: number; entry: DepthChartEntry }[] = [];
  for (const [id, p] of Object.entries(raw ?? {})) {
    const pos = (p?.position ?? "") as Pos;
    const team = (p?.team ?? "").trim().toUpperCase();
    const order = p?.depth_chart_order;
    if (!team || pos === "DEF" || !POSITIONS.includes(pos)) continue;
    if (typeof order !== "number" || p?.status !== "Active") continue;
    const name = (p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`).trim();
    if (!name) continue;
    listed.push({ team, pos, order, entry: { id, name, injury: p.injury_status ?? null } });
  }
  listed.sort((a, b) => a.order - b.order);
  const byTeam = new Map<string, Map<Pos, DepthChartEntry[]>>();
  for (const { team, pos, entry } of listed) {
    let byPos = byTeam.get(team);
    if (!byPos) byTeam.set(team, (byPos = new Map()));
    const list = byPos.get(pos) ?? [];
    list.push(entry);
    byPos.set(pos, list);
  }
  return byTeam;
});

const SOS_DEPTH_SLOTS: Record<Pos, number> = { QB: 2, RB: 3, WR: 3, TE: 2, K: 1, DEF: 0 };

export type SosAnalysisCell = {
  /** 1 = toughest remaining schedule for the position, 32 = easiest. */
  rank: number;
  /** Average points per game the remaining opponents allow to the position. */
  avg: number;
  /** Relative to the league-wide average, e.g. 0.08 = 8% more than average. */
  vsAvg: number;
  games: number;
};

export type SosAnalysisRow = {
  team: string;
  teamName: string;
  cells: Partial<Record<Pos, SosAnalysisCell>>;
  depth: Partial<Record<Pos, DepthChartEntry[]>>;
};

export type SosAnalysis = {
  season: string;
  fromWeek: number;
  toWeek: number;
  dataThroughWeek: number;
  priorSeason: string | null;
  updatedAt: string;
  rows: SosAnalysisRow[];
};

/** Every NFL team's remaining-schedule difficulty by position, plus its current depth chart. */
export async function loadSosAnalysis(
  format: AllowedFormat = "half",
  opts?: { allowCompute?: boolean },
): Promise<SosAnalysis> {
  const state = await nflState("state");
  const season = state.season;
  const fromWeek =
    state.seasonType === "regular" ? Math.min(FANTASY_LAST_WEEK, Math.max(1, state.week)) : 1;
  const toWeek = FANTASY_LAST_WEEK;
  const fmt = format in FORMAT_SLOT ? format : "half";
  const snapKey = `${season}|${fmt}|${fromWeek}`;
  const empty: SosAnalysis = {
    season,
    fromWeek,
    toWeek,
    dataThroughWeek: 0,
    priorSeason: null,
    updatedAt: new Date().toISOString(),
    rows: [],
  };
  const { withResearchSnap } = await import("./research-agg.server");
  return withResearchSnap("agg_sos_analysis", snapKey, opts, empty, () =>
    computeSosAnalysis(season, fromWeek, toWeek, fmt),
  );
}

async function computeSosAnalysis(
  season: string,
  fromWeek: number,
  toWeek: number,
  format: AllowedFormat,
): Promise<SosAnalysis> {
  const [allowed, schedule, depth] = await Promise.all([
    sosAllowed(season, format).catch(() => null),
    scheduleFor(season).catch(() => [] as ScheduleGame[]),
    depthCharts("all").catch(() => new Map<string, Map<Pos, DepthChartEntry[]>>()),
  ]);

  const opponents = new Map<string, string[]>();
  for (const g of schedule) {
    if (g.week < fromWeek || g.week > toWeek || !g.home || !g.away) continue;
    opponents.set(g.home, [...(opponents.get(g.home) ?? []), g.away]);
    opponents.set(g.away, [...(opponents.get(g.away) ?? []), g.home]);
  }

  const cellsByTeam = new Map<string, Partial<Record<Pos, SosAnalysisCell>>>();
  for (const pos of POSITIONS) {
    const perGame = allowed?.perGame.get(pos);
    if (!perGame?.size) continue;
    const leagueAvg = [...perGame.values()].reduce((s, v) => s + v, 0) / perGame.size;
    const scored: { team: string; avg: number; games: number }[] = [];
    for (const t of NFL_TEAMS) {
      const pas = (opponents.get(t.id) ?? [])
        .map((opp) => perGame.get(opp))
        .filter((v): v is number => v != null);
      if (!pas.length) continue;
      scored.push({ team: t.id, avg: pas.reduce((s, v) => s + v, 0) / pas.length, games: pas.length });
    }
    scored.sort((a, b) => a.avg - b.avg);
    scored.forEach((s, i) => {
      const cells = cellsByTeam.get(s.team) ?? {};
      cells[pos] = {
        rank: i + 1,
        avg: Math.round(s.avg * 100) / 100,
        vsAvg: leagueAvg > 0 ? Math.round((s.avg / leagueAvg - 1) * 1000) / 1000 : 0,
        games: s.games,
      };
      cellsByTeam.set(s.team, cells);
    });
  }

  const rows: SosAnalysisRow[] = NFL_TEAMS.map((t) => {
    const teamDepth: SosAnalysisRow["depth"] = {};
    for (const pos of POSITIONS) {
      const slots = SOS_DEPTH_SLOTS[pos];
      if (slots > 0) teamDepth[pos] = (depth.get(t.id)?.get(pos) ?? []).slice(0, slots);
    }
    return {
      team: t.id,
      teamName: teamFullName(t.id),
      cells: cellsByTeam.get(t.id) ?? {},
      depth: teamDepth,
    };
  }).sort((a, b) => a.teamName.localeCompare(b.teamName));

  return {
    season,
    fromWeek,
    toWeek,
    dataThroughWeek: allowed?.maxWeek ?? 0,
    priorSeason: allowed?.priorSeason ?? null,
    updatedAt: allowed?.computedAt ?? new Date().toISOString(),
    rows,
  };
}

function injuryRisk(player: Player, history: SeasonLine[]) {
  const factors: string[] = [];
  let score = 20;

  const rookie = player.exp === 0 || (player.exp === null && history.length === 0);
  const missed = history.map((h) => Math.max(0, 17 - h.games)).filter((m) => Number.isFinite(m));
  const totalMissed = missed.reduce((a, b) => a + b, 0);
  if (rookie) {
    factors.push("Rookie — no NFL injury history");
  } else if (history.length) {
    score += Math.min(45, totalMissed * 5);
    if (totalMissed >= 6)
      factors.push(`${totalMissed} games missed over the last ${history.length} seasons`);
    else if (totalMissed > 0) factors.push(`${totalMissed} games missed recently`);
    else factors.push("No games missed in tracked seasons");
  }

  if (player.injury) {
    score += 20;
    factors.push(`Currently listed ${player.injury}`);
  }
  if (player.age && player.age >= 30 && (player.pos === "RB" || player.pos === "TE")) {
    score += 12;
    factors.push(`Age ${player.age} at ${player.pos}`);
  } else if (player.age && player.age >= 32) {
    score += 8;
    factors.push(`Age ${player.age}`);
  }
  if (player.pos === "RB") {
    const carries = history[0]?.line.find((l) => l.label === "Carries");
    if (carries && Number(carries.value) >= 300) {
      score += 8;
      factors.push(`${carries.value} carries last season`);
    }
  }

  score = Math.max(5, Math.min(95, score));
  const label = score >= 70 ? "High" : score >= 45 ? "Moderate" : "Low";
  return { score, label, factors };
}

export async function loadPlayerDetail(id: string): Promise<PlayerDetail | null> {
  const built = await buildPlayers("v2");
  const player = built.all.find((p) => p.id === id);
  if (!player) return null;

  const season = built.payload.season;
  const prevSeasons = [
    String(Number(season) - 1),
    String(Number(season) - 2),
    String(Number(season) - 3),
  ];
  const statMaps = await Promise.all(
    prevSeasons.map((s) => seasonStats(s).catch(() => new Map<string, Stats>())),
  );

  const history: SeasonLine[] = [];
  prevSeasons.forEach((s, i) => {
    const stats = statMaps[i]?.get(id);
    if (!stats) return;
    const line = toSeasonLine(s, player.pos, stats);
    // Skip seasons the player never actually played (rookies get empty stat rows).
    if (line.games <= 0) return;
    history.push(line);
  });

  const projection = toSeasonLine(season, player.pos, built.rawProj.get(id) ?? {});
  const currentStats = (
    await seasonToDateStats(season).catch(() => new Map<string, Stats>())
  ).get(id);
  const currentLine = currentStats ? toSeasonLine(season, player.pos, currentStats) : null;
  const seasonToDate = currentLine && currentLine.games > 0 ? currentLine : null;

  const fantasyDepthPositions: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const practiceSquad =
    player.team === "FA" ? null : await loadPracticeSquadIndex(season).catch(() => null);
  const depthChart: DepthEntry[] =
    player.team === "FA"
      ? []
      : fantasyDepthPositions.flatMap((slot) =>
          built.all
            .filter(
              (p) =>
                p.team === player.team &&
                p.pos === slot &&
                !isPracticeSquad(practiceSquad, p),
            )
            .sort((a, b) => b.proj.half - a.proj.half)
            .slice(0, 12)
            .map((p) => ({
              id: p.id,
              name: p.name,
              pos: p.pos,
              proj: p.proj.half,
              adp: p.adp.half,
              injury: p.injury,
            })),
        );

  const sos = await buildSos(player, season).catch(() => null);
  const ownershipMap = await loadSleeperOwnershipMap().catch(() => null);
  const ownership = ownershipMap?.get(id);
  const liveInjury = (await sleeperInjuryIndex("current").catch(() => null))?.get(id);
  // Sleeper omits 0% players from research — treat missing as 0 when the map loaded.
  const enrichedPlayer = {
    ...player,
    ...(liveInjury
      ? {
          injury: liveInjury.status,
          injury_status: liveInjury.status,
          injury_body_part: liveInjury.bodyPart,
          injury_notes: liveInjury.notes,
        }
      : {}),
    rostered_pct: ownershipMap ? (ownership?.owned ?? 0) : null,
    started_pct: ownershipMap ? (ownership?.started ?? 0) : null,
  } as Player & { rostered_pct: number | null; started_pct: number | null };

  return {
    season,
    player: enrichedPlayer,
    history,
    seasonToDate,
    projection,
    depthChart,
    sos,
    injuryRisk: injuryRisk(player, history),
  };
}

/* ---------- player news ---------- */

export type NewsItem = {
  id: string;
  headline: string;
  description: string;
  published: string;
  link: string | null;
  image: string | null;
  aboutPlayer: boolean;
  /** "ESPN Injury Report", "Sleeper Injury Report", "RotoWire" or "ESPN". */
  source: string;
};

export type PlayerNews = {
  player: Player;
  injury: { status: string | null; note: string | null };
  items: NewsItem[];
};

type EspnArticle = {
  id?: number | string;
  headline?: string;
  description?: string;
  published?: string;
  lastModified?: string;
  links?: { web?: { href?: string } };
  images?: { url?: string }[];
  categories?: { type?: string; athlete?: { id?: number; description?: string } }[];
};

const espnNews = memo(1000 * 60 * 15, async (query: string) => {
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50${query}`,
    { headers: { accept: "application/json" } },
  );
  if (!res.ok) return [] as EspnArticle[];
  const json = (await res.json()) as { articles?: EspnArticle[] };
  return Array.isArray(json.articles) ? json.articles : [];
});

function toItem(a: EspnArticle, aboutPlayer: boolean): NewsItem {
  return {
    id: String(a.id ?? a.headline ?? Math.random()),
    headline: a.headline ?? "Untitled",
    description: a.description ?? "",
    published: a.published ?? a.lastModified ?? "",
    link: a.links?.web?.href ?? null,
    image: a.images?.[0]?.url ?? null,
    aboutPlayer,
    source: "ESPN",
  };
}

/** Resolve a player's ESPN athlete id through ESPN's public search. */
const espnAthleteId = memo<string | null>(24 * HOUR, async (name) => {
  const res = await fetch(
    `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(name)}&limit=5&sport=football&league=nfl`,
    { headers: { accept: "application/json" } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    results?: { type?: string; contents?: { uid?: string; displayName?: string }[] }[];
  };
  const players = json.results?.find((r) => r.type === "player")?.contents ?? [];
  const hit =
    players.find((c) => (c.displayName ?? "").toLowerCase() === name.toLowerCase()) ?? players[0];
  const m = /a:(\d+)/.exec(hit?.uid ?? "");
  return m ? m[1]! : null;
});

type EspnFeedItem = {
  id?: number | string;
  /** "Rotowire" for player blurbs; "Story" for league-wide columns. */
  type?: string;
  headline?: string;
  description?: string;
  story?: string;
  published?: string;
  lastModified?: string;
  links?: { web?: { href?: string } };
};

/** Rotowire-style player news from ESPN's fantasy feed. */
const espnPlayerFeed = memo<EspnFeedItem[]>(1000 * 60 * 10, async (athleteId) => {
  const res = await fetch(
    `https://site.web.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${athleteId}&limit=15`,
    { headers: { accept: "application/json" } },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { feed?: EspnFeedItem[] };
  return Array.isArray(json.feed) ? json.feed : [];
});

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole-name match ("Josh Allen" never hits "Josh Hines-Allen"); generational suffixes optional. */
function playerNameRegex(name: string): RegExp {
  const base = name.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, "").trim();
  return new RegExp(`(^|[^a-z'-])${escapeRegExp(base)}(?![a-z'-])`, "i");
}

/**
 * RotoWire blurbs are one long sentence with no title. The title stays neutral because blurbs
 * often negate a designation ("won't be placed on IR"); the blurb itself carries the status.
 */
function blurbTitle(name: string, blurb: string): string {
  const tagged = new RegExp(`\\b${escapeRegExp(lastNameOf(name))} \\(([a-z][a-z /-]{2,24})\\)`, "i").exec(blurb);
  const who = tagged ? `${name} (${tagged[1]!.toLowerCase()})` : name;
  if (/\bpractic/i.test(blurb)) return `${who} practice update`;
  if (/\b(?:completed|carries|rushed|caught|receptions?|targets?|catches)\b/i.test(blurb)) {
    return `${name} game recap`;
  }
  if (tagged || ROSTER_INJURY_RE.test(blurb)) return `${who} injury update`;
  return `${name} news update`;
}

function newsTextKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 80);
}

/** The shared injury report can be cold (several upstream calls); news shouldn't wait on it. */
function injuryReportsWithin(ms: number): Promise<InjuryReports | null> {
  return Promise.race([
    loadInjuryReports().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Player-only news: the player's current injury report entry (ESPN / RotoWire / Sleeper),
 * RotoWire blurbs from ESPN's per-player fantasy feed, and ESPN stories that are tagged to
 * the player or name him in the headline. League roundups that only mention him are dropped.
 */
export async function loadPlayerNews(id: string): Promise<PlayerNews | null> {
  const built = await buildPlayers("v2");
  const player = built.all.find((p) => p.id === id);
  if (!player) return null;

  const nameRe = playerNameRegex(player.name);
  const lastNameRe = playerNameRegex(lastNameOf(player.name));
  const isDef = player.pos === "DEF";
  const hasTeam = Boolean(player.team && player.team !== "FA");
  const rosterIndex = isDef ? null : await loadNflRosterIndex(built.payload.season).catch(() => null);
  const athleteId =
    rosterIndex?.bySleeper.get(id)?.espnId ??
    (isDef ? null : await espnAthleteId(player.name).catch(() => null));

  const [feed, league, team, reports] = await Promise.all([
    athleteId ? espnPlayerFeed(athleteId).catch(() => [] as EspnFeedItem[]) : Promise.resolve([] as EspnFeedItem[]),
    espnNews("").catch(() => [] as EspnArticle[]),
    hasTeam
      ? espnNews(`&team=${player.team.toLowerCase()}`).catch(() => [] as EspnArticle[])
      : Promise.resolve([] as EspnArticle[]),
    isDef ? Promise.resolve(null) : injuryReportsWithin(4000),
  ]);

  const seenIds = new Set<string>();
  const seenText = new Set<string>();
  const items: NewsItem[] = [];
  // Generated titles repeat ("game recap"), so callers can dedupe on the source copy instead.
  const push = (item: NewsItem, dedupeText: string = item.headline) => {
    const keys = [newsTextKey(dedupeText)].filter(Boolean);
    if (seenIds.has(item.id) || keys.some((k) => seenText.has(k))) return;
    seenIds.add(item.id);
    for (const k of keys) seenText.add(k);
    items.push(item);
  };

  const report = reports?.items.find((r) => r.sleeperId === id) ?? null;
  if (report) {
    push(
      {
        id: `injury-${report.id}`,
        headline: report.headline,
        description: report.analysis ? `${report.news} ${report.analysis}` : report.news,
        published: report.published,
        link: report.link,
        image: null,
        aboutPlayer: true,
        source: report.source,
      },
      report.news.replace(/\.$/, ""),
    );
  }

  for (const f of feed) {
    const raw = stripTags(f.headline ?? "");
    if (!raw) continue;
    const story = stripTags(f.story ?? f.description ?? "");
    const isBlurb = !f.type || f.type === "Rotowire";
    if (isBlurb) {
      // The feed is per athlete; the surname check guards a wrong athlete id.
      if (!lastNameRe.test(`${raw} ${story}`)) continue;
      push(
        {
          id: String(f.id ?? raw),
          headline: blurbTitle(player.name, raw),
          description: story && story !== raw ? `${raw} ${story}` : raw,
          published: f.published ?? f.lastModified ?? "",
          link: f.links?.web?.href ?? null,
          image: null,
          aboutPlayer: true,
          source: "RotoWire",
        },
        raw.replace(/\.$/, ""),
      );
      continue;
    }
    // Columns and videos in his feed often cover other players; keep the ones titled for him.
    if (!nameRe.test(raw)) continue;
    push({
      id: String(f.id ?? raw),
      headline: raw,
      description: story,
      published: f.published ?? f.lastModified ?? "",
      link: f.links?.web?.href ?? null,
      image: null,
      aboutPlayer: true,
      source: "ESPN",
    });
  }

  // Tags alone let roundups through, so the headline has to be about him.
  for (const a of [...team, ...league]) {
    const headline = a.headline ?? "";
    const tagged =
      athleteId != null && (a.categories ?? []).some((c) => String(c.athlete?.id ?? "") === athleteId);
    if (nameRe.test(headline) || (tagged && lastNameRe.test(headline))) push(toItem(a, true));
  }

  // Current season only (preseason onward). The pinned injury entry is live, so it may be undated.
  const seasonStart = Date.UTC(Number(built.payload.season) || new Date().getUTCFullYear(), 7, 1);
  const inSeason = (item: NewsItem) => {
    const at = Date.parse(item.published);
    return Number.isFinite(at) && at >= seasonStart;
  };
  const pinned = report ? items.slice(0, 1) : [];
  const rest = (report ? items.slice(1) : items)
    .filter(inSeason)
    .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));

  return {
    player,
    injury: {
      status: player.injury,
      note: player.injury
        ? `Listed ${player.injury}${player.team && player.team !== "FA" ? ` on ${player.team}'s report` : ""}.`
        : null,
    },
    items: [...pinned, ...rest].slice(0, 12),
  };
}

export async function loadTeamNews(team: string): Promise<NewsItem[]> {
  const abbr = String(team).toLowerCase();
  const [teamArticles, league] = await Promise.all([
    espnNews(`&team=${abbr}`).catch(() => [] as EspnArticle[]),
    espnNews("").catch(() => [] as EspnArticle[]),
  ]);
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const a of [...teamArticles, ...league]) {
    const item = toItem(a, false);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  items.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
  return items.slice(0, 12);
}

/** Compact league-wide sidebar rows for My Team → News. */
export type LeagueWideNewsRow = {
  id: string;
  playerName: string;
  sleeperId: string | null;
  team: string | null;
  pos: string | null;
  snippet: string;
  link: string | null;
  /** Compact injury letter for sidebar chips. */
  injuryLabel: "Q" | "O" | "IR" | "NA" | null;
};

const espnFantasyLeagueFeed = memo<EspnFeedItem[]>(1000 * 60 * 10, async (_key: string) => {
  const res = await fetch(
    "https://site.web.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=40",
    { headers: { accept: "application/json" } },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { feed?: EspnFeedItem[] };
  return Array.isArray(json.feed) ? json.feed : [];
});

function resolveCatalogPlayer(
  name: string,
  byLower: Map<string, Player>,
  bySanitized: Map<string, Player>,
): Player | null {
  const clean = name.trim().toLowerCase();
  if (!clean) return null;
  const exact = byLower.get(clean);
  if (exact) return exact;
  const sanitized = sanitizePlayerName(name);
  if (sanitized) {
    const hit = bySanitized.get(sanitized);
    if (hit) return hit;
  }
  for (const [key, player] of byLower) {
    if (key.includes(clean) || clean.includes(key)) return player;
  }
  for (const [key, player] of bySanitized) {
    if (sanitized && (key.includes(sanitized) || sanitized.includes(key))) return player;
  }
  return null;
}

function sanitizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(jr|sr|iii|ii|iv)$/g, "")
    .trim();
}

function sidebarSnippet(playerName: string, headline: string, description: string): string {
  const hay = `${headline} ${description}`.trim();
  const injury = /\(([^)]+)\)/.exec(hay);
  let rest = hay
    .replace(new RegExp(playerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—:,.\s]+/, "");
  if (injury && !rest.toLowerCase().includes(`(${injury[1]!.toLowerCase()})`)) {
    rest = `(${injury[1]}) ${rest}`.trim();
  }
  if (!rest) rest = description.trim() || headline.trim();
  if (rest.length > 92) rest = `${rest.slice(0, 89).trim()}…`;
  return rest;
}

function playerNameFromHeadline(headline: string): string | null {
  const m =
    /^([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)+)\b/.exec(headline.trim()) ??
    null;
  return m?.[1]?.trim() || null;
}

const INJURY_COPY_RE =
  /injur|questionable|doubtful|\bout\b|\bir\b|hamstring|ankle|knee|concussion|groin|calf|shoulder|ribs|thumb|wrist|quad|back|foot|toe|illness|practice|limited|full participant|dnp|did not practice|pup|nfi|inactive|designation|week-to-week|day-to-day/i;

function isInjuryCopy(text: string): boolean {
  return INJURY_COPY_RE.test(text);
}

function injuryLabelFromStatus(status: string | null | undefined): "Q" | "O" | "D" | "IR" | "NA" | null {
  if (!status || status === "Healthy" || status === "Active" || status === "None") return null;
  if (status === "Questionable") return "Q";
  if (status === "Doubtful") return "D";
  if (status === "Out") return "O";
  if (status === "IR") return "IR";
  if (status === "NA") return "NA";
  return null;
}

/**
 * Top active injury timelines across the NFL (not limited to a synced roster).
 * Filters out general recaps / draft chatter; dedupes by player.
 */
export async function loadLeagueWidePlayerNews(limit = 10): Promise<LeagueWideNewsRow[]> {
  const built = await buildPlayers("v2");
  const byLower = new Map(built.all.map((p) => [p.name.toLowerCase(), p]));
  const bySanitized = new Map(
    built.all.map((p) => [sanitizePlayerName(p.name), p] as const).filter(([k]) => Boolean(k)),
  );

  const [fantasy, articles] = await Promise.all([
    espnFantasyLeagueFeed("league").catch(() => [] as EspnFeedItem[]),
    espnNews("").catch(() => [] as EspnArticle[]),
  ]);

  const rows: LeagueWideNewsRow[] = [];
  const seenPlayers = new Set<string>();
  const seenIds = new Set<string>();

  const pushRow = (row: LeagueWideNewsRow) => {
    if (rows.length >= limit) return;
    const hay = `${row.playerName} ${row.snippet}`.toLowerCase();
    if (
      /\bnfl week\b/.test(hay) ||
      /\buniforms?\b/.test(hay) ||
      /\buniform combo\b/.test(hay) ||
      !row.playerName?.trim()
    ) {
      return;
    }
    const playerKey = (row.sleeperId || row.playerName).toLowerCase();
    if (seenPlayers.has(playerKey) || seenIds.has(row.id)) return;
    seenPlayers.add(playerKey);
    seenIds.add(row.id);
    rows.push(row);
  };

  for (const f of fantasy) {
    if (rows.length >= limit) break;
    const headline = (f.headline ?? "").trim();
    if (!headline) continue;
    const desc = stripTags(f.story ?? f.description ?? "");
    if (!isInjuryCopy(`${headline} ${desc}`)) continue;
    const name = playerNameFromHeadline(headline);
    if (!name) continue;
    const hit = resolveCatalogPlayer(name, byLower, bySanitized);
    pushRow({
      id: String(f.id ?? headline),
      playerName: hit?.name ?? name,
      sleeperId: hit?.id ?? null,
      team: hit?.team ?? null,
      pos: hit?.pos ?? null,
      snippet: sidebarSnippet(hit?.name ?? name, headline, desc),
      link: f.links?.web?.href ?? null,
      injuryLabel: injuryLabelFromStatus(hit?.injury ?? null),
    });
  }

  for (const a of articles) {
    if (rows.length >= limit) break;
    const athleteName =
      (a.categories ?? []).find((c) => (c.athlete?.description ?? "").trim())?.athlete
        ?.description ??
      playerNameFromHeadline(a.headline ?? "") ??
      null;
    if (!athleteName) continue;
    const hit = resolveCatalogPlayer(athleteName, byLower, bySanitized);
    const headline = (a.headline ?? "").trim();
    const desc = (a.description ?? "").trim();
    if (!isInjuryCopy(`${headline} ${desc}`) && !injuryLabelFromStatus(hit?.injury ?? null)) {
      continue;
    }
    pushRow({
      id: String(a.id ?? headline),
      playerName: hit?.name ?? athleteName,
      sleeperId: hit?.id ?? null,
      team: hit?.team ?? null,
      pos: hit?.pos ?? null,
      snippet: sidebarSnippet(hit?.name ?? athleteName, headline, desc),
      link: a.links?.web?.href ?? null,
      injuryLabel: injuryLabelFromStatus(hit?.injury ?? null),
    });
  }

  // Backfill from catalog players currently carrying injury designations.
  if (rows.length < limit) {
    const injured = built.all
      .filter((p) => Boolean(injuryLabelFromStatus(p.injury)))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const p of injured) {
      if (rows.length >= limit) break;
      const label = injuryLabelFromStatus(p.injury);
      pushRow({
        id: `catalog-injury-${p.id}`,
        playerName: p.name,
        sleeperId: p.id,
        team: p.team || null,
        pos: p.pos,
        snippet: `Listed ${p.injury}${p.team && p.team !== "FA" ? ` on ${p.team}'s report` : ""}`,
        link: null,
        injuryLabel: label,
      });
    }
  }

  return rows.slice(0, limit);
}

export type FantasyNewsItem = {
  id: string;
  headline: string;
  body: string;
  published: string | null;
  link: string | null;
  image: string | null;
  source: "RotoWire" | "ESPN";
  player: { id: string; name: string; team: string | null; pos: string } | null;
};

/** Latest fantasy news across the league: RotoWire player blurbs plus ESPN fantasy stories, newest first. */
export async function loadFantasyNewsFeed(limit = 40): Promise<FantasyNewsItem[]> {
  const built = await buildPlayers("v2");
  const byLower = new Map(built.all.map((p) => [p.name.toLowerCase(), p]));
  const bySanitized = new Map(
    built.all.map((p) => [sanitizePlayerName(p.name), p] as const).filter(([k]) => Boolean(k)),
  );

  const [fantasy, articles] = await Promise.all([
    espnFantasyLeagueFeed("league").catch(() => [] as EspnFeedItem[]),
    espnNews("").catch(() => [] as EspnArticle[]),
  ]);

  const items: FantasyNewsItem[] = [];
  const seen = new Set<string>();
  const push = (item: FantasyNewsItem) => {
    const key = newsTextKey(item.headline);
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  for (const f of fantasy) {
    const headline = (f.headline ?? "").trim();
    if (!headline) continue;
    const name = playerNameFromHeadline(headline);
    const hit = name ? resolveCatalogPlayer(name, byLower, bySanitized) : undefined;
    push({
      id: `rw-${f.id ?? headline}`,
      headline,
      body: stripTags(f.story ?? f.description ?? ""),
      published: f.published ?? f.lastModified ?? null,
      link: f.links?.web?.href ?? null,
      image: null,
      source: "RotoWire",
      player: hit ? { id: hit.id, name: hit.name, team: hit.team || null, pos: hit.pos } : null,
    });
  }

  for (const a of articles) {
    const headline = (a.headline ?? "").trim();
    if (!headline) continue;
    const athleteName =
      (a.categories ?? []).find((c) => (c.athlete?.description ?? "").trim())?.athlete?.description ?? null;
    const hit = athleteName ? resolveCatalogPlayer(athleteName, byLower, bySanitized) : undefined;
    if (!hit && !/fantasy/i.test(`${headline} ${a.description ?? ""}`)) continue;
    push({
      id: `espn-${a.id ?? headline}`,
      headline,
      body: (a.description ?? "").trim(),
      published: a.published ?? a.lastModified ?? null,
      link: a.links?.web?.href ?? null,
      image: a.images?.[0]?.url ?? null,
      source: "ESPN",
      player: hit ? { id: hit.id, name: hit.name, team: hit.team || null, pos: hit.pos } : null,
    });
  }

  const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);
  return items.sort((a, b) => time(b.published) - time(a.published)).slice(0, limit);
}

/* ---------- synced roster news (dashboard Team Insights) ---------- */

export type RosterNewsItem = {
  id: string;
  /** Sleeper designation (Questionable, Out, IR, …). */
  status: string | null;
  bodyPart: string | null;
  /** On an NFL reserve list (IR, PUP, NFI, suspended) per the nflverse roster. */
  reserve: boolean;
  /** Official injury report row from this week or last week only. */
  report: NflInjuryReportEntry | null;
  /** Most recent fantasy news blurb from the last two weeks. */
  news: {
    headline: string;
    analysis: string;
    published: string;
    link: string | null;
    injury: boolean;
  } | null;
};

export type RosterNews = { season: string; week: number; players: RosterNewsItem[] };

const ROSTER_NEWS_WINDOW_MS = 14 * 24 * HOUR;
/** Whole-roster response coalesce — My Team lineup/news share one Fluid burst per isolate. */
const ROSTER_NEWS_TTL_MS = 5 * 60 * 1000;
/** Cap concurrent ESPN player-feed fetches (memo still dedupes per athleteId). */
const ROSTER_NEWS_FEED_CONCURRENCY = 5;

/** Injury-specific wording (stricter than INJURY_COPY_RE, which also matches recaps). */
const ROSTER_INJURY_RE =
  /\binjur(?:y|ed|ies)\b|\bquestionable\b|\bdoubtful\b|\bruled out\b|\bwon't play\b|\bwill not play\b|\binactive\b|\binjured reserve\b|\bIR\b|\bsurgery\b|\bfracture|\bsprain|\bstrain|\btorn\b|\btear\b|\bconcussion|\bhamstring|\bankle\b|\bknee\b|\bgroin\b|\bcalf\b|\bshoulder\b|\bthumb\b|\bwrist\b|\bfoot\b|\btoe\b|\bhip\b|\bribs?\b|\billness\b|did not practice|\bDNP\b|limited (?:in )?practice|full practice|week-to-week|day-to-day|\bPUP\b|\bNFI\b|\bsuspen/i;

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

async function loadRosterNewsUncached(ids: string[]): Promise<RosterNews> {
  const [built, state] = await Promise.all([buildPlayers("v2"), nflState("state")]);
  const season = built.payload.season;
  const [rosterIndex, report] = await Promise.all([
    loadNflRosterIndex(season).catch(() => null),
    loadNflInjuryReport(season).catch(() => null),
  ]);
  const byId = new Map(built.all.map((p) => [p.id, p]));
  const minReportWeek = state.season === season ? state.week - 1 : Number.POSITIVE_INFINITY;
  const now = Date.now();

  // Only nflverse→ESPN ids (exact). Skip espnAthleteId name-search — wrong athlete + extra Fluid wait.
  const players = await mapPool(ids, ROSTER_NEWS_FEED_CONCURRENCY, async (id): Promise<RosterNewsItem> => {
    const player = byId.get(id);
    const nfl = rosterIndex?.bySleeper.get(id) ?? null;
    const reportRow = nfl?.gsisId ? (report?.get(nfl.gsisId) ?? null) : null;

    let news: RosterNewsItem["news"] = null;
    if (player && player.pos !== "DEF") {
      const athleteId = nfl?.espnId ?? null;
      const feed = athleteId
        ? await espnPlayerFeed(athleteId).catch(() => [] as EspnFeedItem[])
        : [];
      let bestAt = 0;
      for (const f of feed) {
        const headline = (f.headline ?? "").trim();
        if (!headline || (f.type && f.type !== "Rotowire")) continue;
        const published = f.published ?? f.lastModified ?? "";
        const at = Date.parse(published);
        if (!Number.isFinite(at) || now - at > ROSTER_NEWS_WINDOW_MS || at <= bestAt) continue;
        const analysis = stripTags(f.story ?? f.description ?? "");
        bestAt = at;
        news = {
          headline,
          analysis,
          published,
          link: f.links?.web?.href ?? null,
          injury: ROSTER_INJURY_RE.test(headline),
        };
      }
    }

    return {
      id,
      status: player?.injury ?? null,
      bodyPart: player?.injury_body_part ?? null,
      reserve: nfl?.status === "RES",
      report: reportRow && reportRow.week >= minReportWeek ? reportRow : null,
      news,
    };
  });

  return { season, week: state.week, players };
}

const rosterNewsMemo = memo<RosterNews>(ROSTER_NEWS_TTL_MS, (key) =>
  loadRosterNewsUncached(key.split(",").filter(Boolean)),
);

/** Latest injury designations, official report lines and news for a synced roster. */
export async function loadRosterNews(ids: string[]): Promise<RosterNews> {
  const clean = Array.from(new Set(ids.map((id) => String(id).slice(0, 32)).filter(Boolean)))
    .sort()
    .slice(0, 30);
  if (clean.length === 0) {
    const state = await nflState("state");
    return { season: state.season, week: state.week, players: [] };
  }
  return rosterNewsMemo(clean.join(","));
}

/* ---------- homepage injury wire ---------- */

export type InjuryWireItem = {
  id: string;
  playerName: string;
  sleeperId: string | null;
  pos: string;
  team: string | null;
  headshot: string | null;
  /** ESPN designation, e.g. "Injured Reserve", "Out", "Questionable". */
  status: string;
  /** Compact chip label: IR, OUT, D, Q, PUP, SUSP. */
  statusShort: string;
  headline: string;
  body: string;
  published: string;
  returnDate: string | null;
  source: "ESPN" | "RotoWire";
  link: string | null;
};

type EspnInjuryRow = {
  id?: string;
  status?: string;
  date?: string;
  shortComment?: string;
  longComment?: string;
  athlete?: {
    displayName?: string;
    lastName?: string;
    headshot?: { href?: string };
    position?: { abbreviation?: string };
    team?: { abbreviation?: string };
    links?: { rel?: string[]; href?: string }[];
  };
  details?: { type?: string; detail?: string; side?: string; returnDate?: string };
};

const espnInjuryFeed = memo<EspnInjuryRow[]>(1000 * 60 * 10, async () => {
  const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries", {
    headers: { accept: "application/json" },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { injuries?: { injuries?: EspnInjuryRow[] }[] };
  return (json.injuries ?? []).flatMap((t) => t.injuries ?? []);
});

const WIRE_POSITIONS: Record<string, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", PK: "K", K: "K" };
const ESPN_TEAM_FIX: Record<string, string> = { WSH: "WAS" };
const WIRE_BLURB_WINDOW_MS = 7 * 24 * HOUR;

type SleeperInjury = {
  /** Sleeper `injury_status` (IR, Out, Doubtful, Questionable, PUP, Sus, NA, DNR, COV); null when healthy. */
  status: string | null;
  bodyPart: string | null;
  notes: string | null;
  newsUpdated: number | null;
  pos: string;
  team: string | null;
};

/**
 * Sleeper's live injury designations. Everything else on the site (popup, projections,
 * lineups) reads Sleeper, so injury pages take the designation from here and only the
 * news copy from ESPN / RotoWire.
 */
const sleeperInjuryIndex = memo<Map<string, SleeperInjury>>(10 * 60 * 1000, async () => {
  const state = await nflState("state");
  const week = Math.min(Math.max(state.week, 1), 18);
  const rows = await fetchRows(
    `${BASE}/projections/nfl/${state.season}/${week}?season_type=regular&${positionsQuery()}`,
  );
  const map = new Map<string, SleeperInjury>();
  for (const row of rows) {
    const p = row.player as
      | (NonNullable<SleeperRow["player"]> & { news_updated?: number | null })
      | null;
    if (!row.player_id || !p) continue;
    map.set(String(row.player_id), {
      status: p.injury_status?.trim() || null,
      bodyPart: p.injury_body_part?.trim() || null,
      notes: p.injury_notes?.trim() || null,
      newsUpdated: typeof p.news_updated === "number" ? p.news_updated : null,
      pos: p.position ?? "",
      team: p.team ?? null,
    });
  }
  return map;
});

/** Live Sleeper injury fields by player id — the same overlay the player popup applies. */
export async function loadLiveInjuryStatuses(): Promise<
  Record<string, { status: string | null; bodyPart: string | null }>
> {
  const index = await sleeperInjuryIndex("current");
  const out: Record<string, { status: string | null; bodyPart: string | null }> = {};
  for (const [id, entry] of index) out[id] = { status: entry.status, bodyPart: entry.bodyPart };
  return out;
}

const SLEEPER_STATUS_SHORT: Record<string, string> = {
  ir: "IR",
  out: "OUT",
  doubtful: "D",
  questionable: "Q",
  pup: "PUP",
  sus: "SUSP",
  na: "NA",
  dnr: "DNR",
  cov: "COV",
};

const STATUS_LONG: Record<string, string> = {
  IR: "Injured Reserve",
  OUT: "Out",
  D: "Doubtful",
  Q: "Questionable",
  PUP: "Physically Unable to Perform",
  SUSP: "Suspended",
  NA: "Not Active",
  DNR: "Did Not Report",
  COV: "COVID-19",
};

/** Sleeper designation as {short, long}; null when Sleeper lists the player as healthy. */
function sleeperDesignation(entry: SleeperInjury): { short: string; status: string } | null {
  if (!entry.status) return null;
  const short = SLEEPER_STATUS_SHORT[entry.status.toLowerCase()] ?? entry.status.toUpperCase().slice(0, 4);
  return { short, status: STATUS_LONG[short] ?? entry.status };
}

/** Plain-language designation for generated copy, e.g. "on injured reserve", "listed as out". */
function designationPhrase(short: string): string {
  switch (short) {
    case "IR":
      return "on injured reserve";
    case "PUP":
      return "on the PUP list";
    case "SUSP":
      return "suspended";
    case "NA":
      return "listed as not active";
    case "DNR":
      return "on the reserve/did not report list";
    default:
      return `listed as ${(STATUS_LONG[short] ?? short).toLowerCase()}`;
  }
}

function wireStatusShort(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("reserve")) return "IR";
  if (s === "out") return "OUT";
  if (s === "doubtful") return "D";
  if (s === "questionable") return "Q";
  if (s.includes("physically unable") || s.includes("pup")) return "PUP";
  if (s.includes("suspen")) return "SUSP";
  return status.toUpperCase().slice(0, 4);
}

/** "Knee - MCL" -> "MCL", "Hamstring" -> "hamstring" (short acronyms keep their case). */
function wireInjuryType(raw: string): string {
  return (raw.split(" - ").pop() ?? raw)
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 4 && w === w.toUpperCase() && /[A-Z]/.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

function wireInjuryPhrase(details: EspnInjuryRow["details"]): { text: string; surgery: boolean } | null {
  const type = details?.type?.trim();
  if (!type || /undisclosed|not specified|^other$/i.test(type)) return null;
  const side = /^(left|right)$/i.test(details?.side ?? "") ? `${details!.side!.toLowerCase()} ` : "";
  const detail = details?.detail && !/not specified/i.test(details.detail) ? details.detail.toLowerCase() : null;
  if (/personal/i.test(type)) return { text: "personal matter", surgery: false };
  return { text: `${side}${wireInjuryType(type)} ${detail ?? "injury"}`, surgery: detail === "surgery" };
}

function wireHeadline(tag: string, short: string, status: string, details: EspnInjuryRow["details"]): string {
  const type = details?.type?.trim();
  const detail = details?.detail && !/not specified/i.test(details.detail) ? details.detail.toLowerCase() : null;
  const injury =
    type && !/undisclosed|not specified|^other$/i.test(type)
      ? /personal/i.test(type)
        ? " for personal reasons"
        : detail === "surgery"
          ? ` after ${wireInjuryType(type)} surgery`
          : ` with ${wireInjuryType(type)} ${detail ?? "injury"}`
      : "";
  switch (short) {
    case "IR":
      return `${tag} placed on IR${injury}`;
    case "OUT":
      return `${tag} ruled out${injury}`;
    case "D":
      return `${tag} doubtful${injury}`;
    case "Q":
      return `${tag} questionable${injury}`;
    case "PUP":
      return `${tag} placed on PUP list${injury}`;
    case "SUSP":
      return `${tag} suspended`;
    default:
      return `${tag} listed as ${status.toLowerCase()}${injury}`;
  }
}

/** Most recent fantasy-relevant NFL injury designations, enriched with RotoWire blurbs. */
export async function loadInjuryWire(limit = 5): Promise<InjuryWireItem[]> {
  const [rows, built, sleeperInjuries] = await Promise.all([
    espnInjuryFeed("all"),
    buildPlayers("v2"),
    sleeperInjuryIndex("current").catch(() => new Map<string, SleeperInjury>()),
  ]);
  const rosterIndex = await loadNflRosterIndex(built.payload.season).catch(() => null);
  const sleeperByEspn = new Map<string, string>();
  for (const [sleeperId, entry] of rosterIndex?.bySleeper ?? []) {
    if (entry.espnId) sleeperByEspn.set(entry.espnId, sleeperId);
  }
  const byId = new Map(built.all.map((p) => [p.id, p]));

  const candidates = rows
    .map((r) => {
      const pos = WIRE_POSITIONS[r.athlete?.position?.abbreviation ?? ""];
      const at = Date.parse(r.date ?? "");
      const espnId = /\/(\d+)\.png/.exec(r.athlete?.headshot?.href ?? "")?.[1] ?? null;
      const sleeperId = espnId ? (sleeperByEspn.get(espnId) ?? null) : null;
      const player = sleeperId ? byId.get(sleeperId) : undefined;
      const sleeper = sleeperId ? sleeperInjuries.get(sleeperId) : undefined;
      const status = sleeper ? (sleeperDesignation(sleeper)?.status ?? "Active") : (r.status ?? "").trim();
      return { r, pos, at, status, espnId, sleeperId, player };
    })
    .filter((c) => c.pos && Number.isFinite(c.at) && c.status && !/^active$/i.test(c.status) && c.r.athlete?.displayName)
    // ESPN refreshes many designations in one batch, so ties go to the more fantasy-relevant player.
    .sort((a, b) => b.at - a.at || (a.player?.rank.half ?? 999) - (b.player?.rank.half ?? 999));

  const picked: typeof candidates = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = c.espnId ?? c.r.athlete!.displayName!;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(c);
    if (picked.length >= limit) break;
  }

  const now = Date.now();
  return Promise.all(
    picked.map(async (c): Promise<InjuryWireItem> => {
      const name = c.player?.name ?? c.r.athlete!.displayName!;
      const lastName = c.r.athlete?.lastName ?? name.split(" ").slice(-1)[0] ?? name;
      const espnTeam = c.r.athlete?.team?.abbreviation ?? null;
      const team = c.player?.team || (espnTeam ? (ESPN_TEAM_FIX[espnTeam] ?? espnTeam) : null);
      const short =
        Object.entries(STATUS_LONG).find(([, long]) => long === c.status)?.[0] ?? wireStatusShort(c.status);
      const tag = `${name} (${c.pos}-${team ?? "FA"})`;
      const espnNewsLink =
        c.r.athlete?.links?.find((l) => l.rel?.includes("news") && l.href?.startsWith("http"))?.href ?? null;

      let body = stripTags(c.r.longComment ?? "");
      let source: InjuryWireItem["source"] = "ESPN";
      let link = espnNewsLink;

      if (body.length < 40) {
        body = "";
        const feed = c.espnId ? await espnPlayerFeed(c.espnId).catch(() => [] as EspnFeedItem[]) : [];
        for (const f of feed) {
          const headline = (f.headline ?? "").trim();
          if (!headline || (f.type && f.type !== "Rotowire")) continue;
          const at = Date.parse(f.published ?? f.lastModified ?? "");
          if (!Number.isFinite(at) || now - at > WIRE_BLURB_WINDOW_MS) continue;
          const story = stripTags(f.story ?? f.description ?? "");
          if (!ROSTER_INJURY_RE.test(`${headline} ${story}`)) continue;
          body = story ? `${headline} ${story}` : headline;
          source = "RotoWire";
          link = f.links?.web?.href ?? link;
          break;
        }
      }

      const returnDate = c.r.details?.returnDate ?? null;
      if (!body) {
        const phrase = wireInjuryPhrase(c.r.details);
        const parts: string[] = [];
        if (phrase) {
          parts.push(
            phrase.surgery
              ? `${lastName} is recovering from ${phrase.text}.`
              : `${lastName} is dealing with a ${phrase.text}.`,
          );
        } else {
          parts.push(`${lastName} carries a ${c.status.toLowerCase()} designation.`);
        }
        const ret = returnDate ? Date.parse(returnDate) : NaN;
        if ((short === "IR" || short === "OUT" || short === "PUP") && Number.isFinite(ret) && ret > now) {
          const label = new Date(ret).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
          parts.push(`ESPN lists an estimated return of ${label}.`);
        }
        body = parts.join(" ");
      }

      return {
        id: String(c.r.id ?? `${name}-${c.at}`),
        playerName: name,
        sleeperId: c.sleeperId,
        pos: c.pos!,
        team,
        headshot: c.r.athlete?.headshot?.href ?? null,
        status: c.status,
        statusShort: short,
        headline: wireHeadline(tag, short, c.status, c.r.details),
        body,
        published: new Date(c.at).toISOString(),
        returnDate,
        source,
        link,
      };
    }),
  );
}

/* ---------- injury reports page ---------- */

export type InjuryReportItem = {
  id: string;
  sleeperId: string | null;
  playerName: string;
  pos: string;
  team: string | null;
  headshot: string | null;
  /** Sleeper designation, e.g. "Injured Reserve", "Questionable", or "Active" for recovery updates. */
  status: string;
  /** IR, OUT, D, Q, PUP, SUSP, NA, DNR, COV; empty for Active players. */
  statusShort: string;
  /** Short injury label, e.g. "biceps". */
  injury: string | null;
  headline: string;
  news: string;
  analysis: string | null;
  /** ISO time of the latest update; empty when unknown. */
  published: string;
  returnDate: string | null;
  link: string | null;
  /** Where the news copy came from: "ESPN Injury Report", "RotoWire" or "Sleeper Injury Report". */
  source: string;
  /** That source's own designation, which can differ from Sleeper's `statusShort`. "" = Active, null = none stated. */
  sourceStatusShort: string | null;
  sourceStatus: string | null;
};

export type InjuryReports = { updatedAt: string; items: InjuryReportItem[] };

const INJURY_UPDATE_WINDOW_MS = 14 * 24 * HOUR;

function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function injuryReportHeadline(name: string, injury: string | null, short: string, text: string): string {
  const who = injury ? `${name} (${injury})` : name;
  switch (short) {
    case "IR":
      if (/\bactivated\b|designated .*to return|return(?:ed|s)? to practice/i.test(text)) {
        return `${who} nearing return from IR`;
      }
      return /\bplaced\b|\bmoved?\b.*\b(?:injured reserve|IR)\b|lands? on IR|to injured reserve/i.test(text)
        ? `${who} placed on IR`
        : `${who} remains on IR`;
    case "OUT":
      return /ruled out|won't play|will not play|out for/i.test(text) ? `${who} ruled out` : `${who} listed as out`;
    case "D":
      return `${who} listed as doubtful`;
    case "Q":
      return `${who} listed as questionable`;
    case "PUP":
      return `${who} on PUP list`;
    case "SUSP":
      return `${who} suspended`;
    case "NA":
      return `${who} listed as not active`;
    case "DNR":
      return `${who} has not reported`;
    case "COV":
      return `${who} on COVID-19 list`;
    default:
      if (/\bactivated\b/i.test(text)) return `${who} activated`;
      if (/\bpractice\b|\bpracticing\b|full participant/i.test(text)) return `${who} practice update`;
      return `${who} injury update`;
  }
}

/** Sleeper designations that count as an injury report; Coach's Decision benchings don't. */
function reportableSleeperInjury(entry: SleeperInjury): boolean {
  return Boolean(entry.status) && !/coach/i.test(entry.bodyPart ?? "");
}

/** Sleeper body part -> short label ("Knee - ACL" -> "ACL"); null when it says nothing useful. */
function sleeperInjuryLabel(bodyPart: string | null): string | null {
  if (!bodyPart || /undisclosed|not injury|coach|^other$/i.test(bodyPart)) return null;
  if (/personal/i.test(bodyPart)) return "personal";
  return wireInjuryType(bodyPart);
}

function injuryNote(lastName: string, short: string, injury: string | null, surgery: boolean): string {
  if (!short) return injury ? `${lastName} is back from a ${injury} injury.` : `${lastName} is off the injury report.`;
  const where = designationPhrase(short);
  if (!injury) return `${lastName} is ${where}.`;
  if (injury === "personal") return `${lastName} is ${where} for personal reasons.`;
  if (surgery) return `${lastName} is ${where} while recovering from ${injury} surgery.`;
  const article = /^([aeiou]|[AEFHILMNORSX][A-Z])/.test(injury) ? "an" : "a";
  return `${lastName} is ${where} with ${article} ${injury} injury.`;
}

/** Designation a news blurb states, e.g. "ruled out" -> OUT; null when it doesn't say. */
function statusFromText(text: string): string | null {
  if (/\b(?:placed|moved|lands?|landed|reverted|remains?)\b[^.]*\b(?:injured reserve|IR)\b|\bon (?:injured reserve|IR)\b/i.test(text)) {
    return "IR";
  }
  if (/\bPUP\b|physically unable to perform/i.test(text)) return "PUP";
  if (/\bruled out\b|\bwon't play\b|\bwill not play\b|\bwill miss\b|\binactive\b/i.test(text)) return "OUT";
  if (/\bdoubtful\b/i.test(text)) return "D";
  if (/\bquestionable\b/i.test(text)) return "Q";
  return null;
}

function lastNameOf(name: string): string {
  const parts = name.split(" ").filter((w) => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w));
  return parts[parts.length - 1] ?? name;
}

/** Every current injury designation (per Sleeper) with the latest ESPN / RotoWire news, newest first. */
export async function loadInjuryReports(): Promise<InjuryReports> {
  return injuryReportsMemo("all");
}

const injuryReportsMemo = memo<InjuryReports>(5 * 60 * 1000, async () => {
  const [rows, built, sleeperInjuries] = await Promise.all([
    espnInjuryFeed("all"),
    buildPlayers("v2"),
    sleeperInjuryIndex("current").catch(() => new Map<string, SleeperInjury>()),
  ]);
  const rosterIndex = await loadNflRosterIndex(built.payload.season).catch(() => null);
  const sleeperByEspn = new Map<string, string>();
  const espnBySleeper = new Map<string, string>();
  for (const [sleeperId, entry] of rosterIndex?.bySleeper ?? []) {
    if (!entry.espnId) continue;
    sleeperByEspn.set(entry.espnId, sleeperId);
    espnBySleeper.set(sleeperId, entry.espnId);
  }
  const byId = new Map(built.all.map((p) => [p.id, p]));
  const byName = new Map<string, Player[]>();
  for (const p of built.all) {
    const key = normalizePersonName(p.name);
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  const now = Date.now();

  type Draft = InjuryReportItem & { at: number; rank: number; espnId: string | null; weak: boolean };
  const items: Draft[] = [];
  const seen = new Set<string>();
  const covered = new Set<string>();
  for (const r of rows) {
    const pos = WIRE_POSITIONS[r.athlete?.position?.abbreviation ?? ""];
    const at = Date.parse(r.date ?? "");
    const displayName = r.athlete?.displayName?.trim();
    const espnStatus = (r.status ?? "").trim();
    if (!pos || !Number.isFinite(at) || !displayName || !espnStatus) continue;

    const espnId = /\/(\d+)\.png/.exec(r.athlete?.headshot?.href ?? "")?.[1] ?? null;
    const key = espnId ?? displayName;
    if (seen.has(key)) continue;
    seen.add(key);

    const espnTeam = r.athlete?.team?.abbreviation ?? null;
    const espnTeamFixed = espnTeam ? (ESPN_TEAM_FIX[espnTeam] ?? espnTeam) : null;
    let sleeperId = espnId ? (sleeperByEspn.get(espnId) ?? null) : null;
    if (!sleeperId) {
      const matches = (byName.get(normalizePersonName(displayName)) ?? []).filter((p) => p.pos === pos);
      const match = matches.find((p) => p.team === espnTeamFixed) ?? (matches.length === 1 ? matches[0] : undefined);
      sleeperId = match?.id ?? null;
    }
    const player = sleeperId ? byId.get(sleeperId) : undefined;
    const sleeper = sleeperId ? sleeperInjuries.get(sleeperId) : undefined;
    const designation = sleeper
      ? reportableSleeperInjury(sleeper)
        ? sleeperDesignation(sleeper)
        : null
      : /^active$/i.test(espnStatus)
        ? null
        : { short: wireStatusShort(espnStatus), status: espnStatus };

    const news = stripTags(r.shortComment ?? "");
    const longText = stripTags(r.longComment ?? "");
    const lastName = r.athlete?.lastName?.trim() || lastNameOf(displayName);
    const tagged = new RegExp(`\\b${escapeRegExp(lastName)} \\(([a-z][a-z /-]{2,24})\\)`, "i").exec(news);
    const active = !designation;
    if (active && (!tagged || now - at > INJURY_UPDATE_WINDOW_MS)) continue;
    if (sleeperId) covered.add(sleeperId);

    const name = player?.name ?? displayName;
    const team = player?.team && player.team !== "FA" ? player.team : espnTeamFixed;
    const type = r.details?.type?.trim();
    const injury =
      tagged?.[1]?.toLowerCase() ??
      sleeperInjuryLabel(sleeper?.bodyPart ?? null) ??
      (type && !/undisclosed|not specified|^other$/i.test(type) ? wireInjuryType(type) : null);
    const short = designation?.short ?? "";
    const surgery = /surgery/i.test(`${r.details?.detail ?? ""} ${sleeper?.notes ?? ""}`);

    // ESPN sometimes posts a bare designation ("questionable") instead of a note.
    const weak = news.length < 25;
    // Generated copy follows Sleeper; ESPN's own note keeps ESPN's designation in the title and chip.
    const sourceShort = weak ? short : /^active$/i.test(espnStatus) ? "" : wireStatusShort(espnStatus);

    items.push({
      id: String(r.id ?? `${key}-${at}`),
      sleeperId,
      playerName: name,
      pos,
      team,
      headshot: r.athlete?.headshot?.href ?? null,
      status: designation?.status ?? "Active",
      statusShort: short,
      injury,
      headline: injuryReportHeadline(name, injury, sourceShort, sourceShort ? `${news} ${longText}` : news),
      news: weak ? injuryNote(lastName, short, injury, surgery) : news,
      analysis: longText.length > 40 && longText !== news ? longText : null,
      published: new Date(at).toISOString(),
      returnDate: active ? null : (r.details?.returnDate ?? null),
      link:
        r.athlete?.links?.find((l) => l.rel?.includes("news") && l.href?.startsWith("http"))?.href ?? null,
      source: weak ? "Sleeper Injury Report" : "ESPN Injury Report",
      sourceStatusShort: sourceShort,
      sourceStatus: weak ? (designation?.status ?? "Active") : espnStatus,
      at,
      rank: player?.rank.half ?? 999,
      espnId,
      weak,
    });
  }

  // Sleeper designations ESPN's report doesn't carry (long-term IR, late changes).
  for (const [sleeperId, entry] of sleeperInjuries) {
    if (covered.has(sleeperId) || !reportableSleeperInjury(entry)) continue;
    const player = byId.get(sleeperId);
    if (!player || player.pos === "DEF" || !player.team || player.team === "FA") continue;
    const designation = sleeperDesignation(entry);
    if (!designation) continue;
    const injury = sleeperInjuryLabel(entry.bodyPart);
    const espnId = espnBySleeper.get(sleeperId) ?? null;
    const at = entry.newsUpdated ?? 0;
    items.push({
      id: `sleeper-${sleeperId}`,
      sleeperId,
      playerName: player.name,
      pos: player.pos,
      team: player.team,
      headshot: null,
      status: designation.status,
      statusShort: designation.short,
      injury,
      headline: injuryReportHeadline(player.name, injury, designation.short, ""),
      news: injuryNote(lastNameOf(player.name), designation.short, injury, /surgery/i.test(entry.notes ?? "")),
      analysis: null,
      published: at ? new Date(at).toISOString() : "",
      returnDate: null,
      link: espnId ? `https://www.espn.com/nfl/player/_/id/${espnId}` : null,
      source: "Sleeper Injury Report",
      sourceStatusShort: designation.short,
      sourceStatus: designation.status,
      at,
      rank: player.rank.half,
      espnId,
      weak: true,
    });
  }

  const toEnrich = items.filter((item) => item.weak && item.espnId && now - item.at <= WIRE_BLURB_WINDOW_MS);
  for (let i = 0; i < toEnrich.length; i += 12) {
    await Promise.all(
      toEnrich.slice(i, i + 12).map(async (item) => {
        const feed = await espnPlayerFeed(item.espnId!).catch(() => [] as EspnFeedItem[]);
        for (const f of feed) {
          const headline = stripTags(f.headline ?? "");
          if (!headline || (f.type && f.type !== "Rotowire")) continue;
          const at = Date.parse(f.published ?? f.lastModified ?? "");
          if (!Number.isFinite(at) || now - at > WIRE_BLURB_WINDOW_MS) continue;
          const story = stripTags(f.story ?? f.description ?? "");
          if (!ROSTER_INJURY_RE.test(`${headline} ${story}`)) continue;
          item.news = headline.endsWith(".") ? headline : `${headline}.`;
          item.analysis = story.length > 40 ? story : item.analysis;
          item.link = f.links?.web?.href ?? item.link;
          const stated = statusFromText(`${headline} ${story}`);
          item.headline = injuryReportHeadline(
            item.playerName,
            item.injury,
            stated ?? "",
            stated ? `${headline} ${story}` : headline,
          );
          item.source = "RotoWire";
          item.sourceStatusShort = stated;
          item.sourceStatus = stated ? (STATUS_LONG[stated] ?? stated) : null;
          break;
        }
      }),
    );
  }

  // ESPN refreshes many notes in one batch, so ties go to the more fantasy-relevant player.
  items.sort((a, b) => b.at - a.at || a.rank - b.rank);
  return {
    updatedAt: new Date().toISOString(),
    items: items.map(({ at: _at, rank: _rank, espnId: _espnId, weak: _weak, ...item }) => item),
  };
});

/* ---------- transaction pickup results ---------- */

export type PickupRequest = { key: string; playerId: string; fromWeek: number; toWeek: number };
export type PickupResult = { pts: number; games: number };

const weeklyStatLines = memo<Map<string, Stats>>(10 * 60 * 1000, async (key) => {
  const [season, week] = key.split("|");
  const rows = await fetchRows(`${BASE}/stats/nfl/${season}/${week}?season_type=regular&${positionsQuery()}`).catch(
    () => [] as SleeperRow[],
  );
  const map = new Map<string, Stats>();
  for (const row of rows) {
    if (row.player_id && row.stats) map.set(String(row.player_id), row.stats);
  }
  return map;
});

/** League-scored fantasy points each picked-up player has produced over a week range. */
export async function loadPickupResults(
  requests: PickupRequest[],
  identifier: string,
  platform: string,
  s2?: string | null,
  swid?: string | null,
): Promise<Record<string, PickupResult>> {
  const { loadLeagueScoring } = await import("./scoring.server");
  const [state, scoring] = await Promise.all([nflState("state"), loadLeagueScoring(identifier, platform, s2, swid)]);
  const lastWeek = Math.min(18, state.week);
  const weeks = new Set<number>();
  for (const r of requests) {
    for (let w = Math.max(1, r.fromWeek); w <= Math.min(lastWeek, r.toWeek); w++) weeks.add(w);
  }
  const lines = new Map<number, Map<string, Stats>>();
  await Promise.all(
    [...weeks].map(async (w) => {
      lines.set(w, await weeklyStatLines(`${state.season}|${w}`).catch(() => new Map<string, Stats>()));
    }),
  );

  const out: Record<string, PickupResult> = {};
  for (const r of requests) {
    let pts = 0;
    let games = 0;
    for (let w = Math.max(1, r.fromWeek); w <= Math.min(lastWeek, r.toWeek); w++) {
      const stats = lines.get(w)?.get(r.playerId);
      if (!stats) continue;
      const scored = scoreStats(stats, scoring.map);
      if (scored == null) continue;
      pts += scored;
      games += 1;
    }
    out[r.key] = { pts: Math.round(pts * 10) / 10, games };
  }
  return out;
}

/* ---------- weekly fantasy leaders ---------- */

export type FantasyLeaderRow = {
  id: string;
  name: string;
  pos: Pos;
  team: string;
  /** Index = week - 1. [std, half, ppr] for weeks the player appeared in; null otherwise. */
  weeks: (PtsTriple | null)[];
};

export type FantasyLeaders = {
  season: string;
  maxWeek: number;
  rows: FantasyLeaderRow[];
};

const leaderWeekRows = memo<SleeperRow[]>(10 * 60 * 1000, async (key) => {
  const [season, week] = key.split("|");
  return await fetchRows(`${BASE}/stats/nfl/${season}/${week}?season_type=regular&${positionsQuery()}`);
});

/** Every player's week-by-week fantasy points for a regular season (all three presets). */
export async function loadFantasyLeaders(seasonInput?: string): Promise<FantasyLeaders> {
  const state = await nflState("state");
  const season = seasonInput && /^\d{4}$/.test(seasonInput) ? seasonInput : state.season;
  const lastWeek =
    season === state.season ? (state.seasonType === "regular" ? Math.min(18, state.week) : 0) : 18;
  if (Number(season) > Number(state.season) || lastWeek < 1) {
    return { season, maxWeek: 0, rows: [] };
  }

  const weekRows = await Promise.all(
    Array.from({ length: lastWeek }, (_, i) =>
      leaderWeekRows(`${season}|${i + 1}`).catch(() => [] as SleeperRow[]),
    ),
  );

  let maxWeek = 0;
  const byId = new Map<string, FantasyLeaderRow>();
  weekRows.forEach((rows, index) => {
    for (const row of rows) {
      const stats = row.stats;
      const pos = (row.player?.position ?? "") as Pos;
      if (!row.player_id || !stats || !POSITIONS.includes(pos)) continue;
      if (!(Number(stats["gp"]) > 0)) continue;
      maxWeek = Math.max(maxWeek, index + 1);
      const id = String(row.player_id);
      let entry = byId.get(id);
      if (!entry) {
        const first = row.player?.first_name?.trim() ?? "";
        const last = row.player?.last_name?.trim() ?? "";
        entry = {
          id,
          name: `${first} ${last}`.trim() || id,
          pos,
          team: (row.team ?? row.player?.team ?? "").trim() || "FA",
          weeks: [],
        };
        byId.set(id, entry);
      } else if (row.team) {
        entry.team = row.team.trim();
      }
      const round = (v: unknown) => Math.round(num(v, 0) * 100) / 100;
      entry.weeks[index] = [
        round(stats["pts_std"]),
        round(stats["pts_half_ppr"]),
        round(stats["pts_ppr"]),
      ];
    }
  });

  const rows = [...byId.values()].map((row) => ({
    ...row,
    weeks: Array.from({ length: maxWeek }, (_, i) => row.weeks[i] ?? null),
  }));
  return { season, maxWeek, rows };
}

/* ---------- player bio + game logs (ESPN-style profile page) ---------- */

export type PlayerBio = {
  height: string | null;
  weight: string | null;
  college: string | null;
  status: string | null;
  number: number | null;
  birthDate: string | null;
  draft: string | null;
};

export type GameLog = {
  week: number;
  opp: string | null;
  points: { std: number; half: number; ppr: number };
  line: { label: string; value: string }[];
  raw: Record<string, number>;
  /** False when the week is a placeholder for an unplayed / unavailable game. */
  played?: boolean;
  /** True when this week is the team's bye. */
  isBye?: boolean;
  /** Season year label used for CAREER concatenations. */
  seasonYear?: string;
  /** Weekly projected points by scoring format. */
  proj?: { std: number | null; half: number | null; ppr: number | null } | null;
  /** Weekly projected raw stats (Sleeper projection keys). */
  projRaw?: Record<string, number>;
};

/** Year-by-year career rollup for the Game Logs footer table. */
export type CareerSeasonRow = {
  year: string;
  team: string;
  games: number;
  pts: { std: number | null; half: number | null; ppr: number | null };
  posRank: { std: number | null; half: number | null; ppr: number | null };
  raw: Record<string, number>;
};

const LOG_KEYS = [
  "rush_att",
  "rush_yd",
  "rush_td",
  "rush_lng",
  "rec",
  "rec_tgt",
  "rec_yd",
  "rec_td",
  "rec_lng",
  "pass_att",
  "pass_cmp",
  "pass_yd",
  "pass_td",
  "pass_int",
  "fum",
  "fum_lost",
  "fgm",
  "fga",
  "fgmiss",
  "fgm_0_19",
  "fgm_20_29",
  "fgm_30_39",
  "fgm_40_49",
  "fgm_50p",
  "fgm_50_59",
  "fgm_60p",
  "xpa",
  "xpm",
  "xpmiss",
  "sack",
  "int",
  "ff",
  "fum_rec",
  "def_st_td",
  "pts_allow",
] as const;

/** Fill derived kicker fields so UI columns match Sleeper (0 vs dash, distance buckets). */
function normalizeKickerRaw(raw: Record<string, number>): Record<string, number> {
  const out = { ...raw };
  const fga = out.fga;
  const fgmiss = out.fgmiss;
  if (out.fgm == null && fga != null && Number.isFinite(fga)) {
    const miss = fgmiss != null && Number.isFinite(fgmiss) ? fgmiss : 0;
    out.fgm = Math.max(0, fga - miss);
  }
  if (out.fgmiss == null && fga != null && out.fgm != null) {
    out.fgmiss = Math.max(0, fga - out.fgm);
  }
  // Collapse 50+ aliases for the display column.
  if (out.fgm_50p == null) {
    const from59 = out.fgm_50_59;
    const from60 = out.fgm_60p;
    if (from59 != null || from60 != null) {
      out.fgm_50p = (from59 ?? 0) + (from60 ?? 0);
    }
  }
  return out;
}


const bioFor = memo<PlayerBio | null>(24 * HOUR, async (id) => {
  const res = await fetch(`${BASE}/players/nfl/${encodeURIComponent(id)}`, {
    headers: { accept: "application/json" },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!j) return null;
  const h = typeof j["height"] === "string" ? j["height"] : null;
  const inches = h && /^\d+$/.test(h) ? Number(h) : null;
  const draftYear =
    j["metadata"] && typeof j["metadata"] === "object"
      ? (j["metadata"] as Record<string, unknown>)["rookie_year"]
      : null;
  return {
    height: inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : h,
    weight: j["weight"] ? `${j["weight"]} lbs` : null,
    college: typeof j["college"] === "string" ? j["college"] : null,
    status: typeof j["status"] === "string" ? j["status"] : null,
    number: typeof j["number"] === "number" ? j["number"] : null,
    birthDate: typeof j["birth_date"] === "string" ? j["birth_date"] : null,
    draft:
      typeof draftYear === "string" || typeof draftYear === "number"
        ? `Rookie year ${draftYear}`
        : null,
  };
});

export async function loadPlayerBio(id: string): Promise<PlayerBio | null> {
  return await bioFor(id).catch(() => null);
}

async function weeklyRaw(
  id: string,
  season: string,
): Promise<Record<string, { stats?: Stats | null }>> {
  const res = await fetch(
    `${BASE}/stats/nfl/player/${encodeURIComponent(id)}?season_type=regular&season=${season}&grouping=week`,
    { headers: { accept: "application/json" } },
  ).catch(() => null);
  if (!res || !res.ok) return {};
  const j = (await res.json().catch(() => null)) as Record<string, { stats?: Stats | null }> | null;
  return j && typeof j === "object" ? j : {};
}

type WeekProjectionBundle = {
  std: number | null;
  half: number | null;
  ppr: number | null;
  raw: Record<string, number>;
};

/** One week's full projection bundles keyed by player id (shared across all popups). */
const weekProjectionBundles = memo<Map<string, WeekProjectionBundle>>(
  15 * 60 * 1000,
  async (key) => {
    const [season, week] = key.split("|") as [string, string];
    const rows = await fetchRows(
      `${BASE}/projections/nfl/${season}/${week}?season_type=regular&${positionsQuery()}`,
    ).catch(() => []);
    const map = new Map<string, WeekProjectionBundle>();
    for (const row of rows) {
      const stats = row.stats;
      if (!row.player_id || !stats || !hasScorableProjectionStats(stats)) continue;
      const raw: Record<string, number> = {};
      for (const [k, v] of Object.entries(stats)) {
        if (v != null && Number.isFinite(Number(v))) raw[k] = Number(v);
      }
      const std = stats["pts_std"];
      const half = stats["pts_half_ppr"];
      const ppr = stats["pts_ppr"];
      map.set(String(row.player_id), {
        std: std != null && Number.isFinite(Number(std)) && Number(std) > 0 ? Number(std) : null,
        half: half != null && Number.isFinite(Number(half)) && Number(half) > 0 ? Number(half) : null,
        ppr: ppr != null && Number.isFinite(Number(ppr)) && Number(ppr) > 0 ? Number(ppr) : null,
        raw,
      });
    }
    return map;
  },
);

/**
 * Weekly projected points + raw stats for one player across weeks 1–18.
 * Fetches each week once (shared Map memo) instead of re-downloading all 18
 * league projection files per player card open.
 */
async function playerWeekProjections(
  id: string,
  season: string,
): Promise<Map<number, WeekProjectionBundle>> {
  const out = new Map<number, WeekProjectionBundle>();
  const weeks = await Promise.all(
    Array.from({ length: 18 }, (_, i) => i + 1).map(async (week) => {
      const byPlayer = await weekProjectionBundles(`${season}|${week}`).catch(
        () => new Map<string, WeekProjectionBundle>(),
      );
      return [week, byPlayer.get(id) ?? null] as const;
    }),
  );
  for (const [week, bundle] of weeks) {
    if (bundle) out.set(week, bundle);
  }
  return out;
}

function sumRaw(logs: GameLog[], key: string): number | null {
  let total = 0;
  let any = false;
  for (const log of logs) {
    if (!log.played) continue;
    const v = log.raw[key];
    if (v == null || !Number.isFinite(v)) continue;
    total += v;
    any = true;
  }
  return any ? total : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

async function buildSeasonLogsForPlayer(
  id: string,
  player: { team: string; pos: Pos },
  season: string,
  opts: { includeProjections?: boolean } = {},
): Promise<GameLog[]> {
  const includeProjections = opts.includeProjections !== false;
  const [raw, schedule, projByWeek, byeByTeam] = await Promise.all([
    weeklyRaw(id, season),
    scheduleFor(season).catch(() => [] as ScheduleGame[]),
    includeProjections
      ? playerWeekProjections(id, season).catch(() => new Map<number, WeekProjectionBundle>())
      : Promise.resolve(new Map<number, WeekProjectionBundle>()),
    byeWeeks(season).catch(() => new Map<string, number>()),
  ]);
  const byeWeek = byeByTeam.get(player.team.toUpperCase()) ?? null;
  const byWeek = new Map<number, GameLog>();
  for (const [wk, entry] of Object.entries(raw)) {
    const stats = entry?.stats;
    if (!stats) continue;
    const week = Number(wk);
    if (!Number.isFinite(week)) continue;
    const game = schedule.find(
      (g) => g.week === week && (g.home === player.team || g.away === player.team),
    );
    const opp = game ? (game.home === player.team ? `vs ${game.away}` : `@ ${game.home}`) : null;
    const rawStats: Record<string, number> = {};
    for (const k of LOG_KEYS) {
      if (stats[k] != null && Number.isFinite(Number(stats[k]))) {
        rawStats[k] = num(stats[k], 0);
      }
    }
    const normalizedRaw =
      player.pos === "K" ? normalizeKickerRaw(rawStats) : rawStats;
    const bundle = projByWeek.get(week) ?? null;
    const proj = bundle
      ? { std: bundle.std, half: bundle.half, ppr: bundle.ppr }
      : null;
    byWeek.set(week, {
      week,
      opp,
      points: {
        std: num(stats["pts_std"], 0),
        half: num(stats["pts_half_ppr"], 0),
        ppr: num(stats["pts_ppr"], 0),
      },
      line: statLine(player.pos, stats),
      raw: normalizedRaw,
      played: true,
      isBye: false,
      seasonYear: season,
      proj,
      projRaw: bundle?.raw ?? {},
    });
  }

  const logs: GameLog[] = [];
  for (let week = 1; week <= 18; week++) {
    const hit = byWeek.get(week);
    if (hit) {
      logs.push(hit);
      continue;
    }
    const isBye = byeWeek != null && week === byeWeek;
    const game = schedule.find(
      (g) => g.week === week && (g.home === player.team || g.away === player.team),
    );
    const opp = isBye
      ? "BYE"
      : game
        ? game.home === player.team
          ? `vs ${game.away}`
          : `@ ${game.home}`
        : null;
    const bundle = projByWeek.get(week) ?? null;
    const proj = bundle
      ? { std: bundle.std, half: bundle.half, ppr: bundle.ppr }
      : null;
    logs.push({
      week,
      opp,
      points: { std: 0, half: 0, ppr: 0 },
      line: [],
      raw: {},
      played: false,
      isBye,
      seasonYear: season,
      proj,
      projRaw: bundle?.raw ?? {},
    });
  }
  return logs;
}

async function careerRowFromLogs(
  id: string,
  year: string,
  team: string,
  logs: GameLog[],
): Promise<CareerSeasonRow | null> {
  const played = logs.filter((l) => l.played);
  if (!played.length) return null;

  const raw: Record<string, number> = {};
  for (const k of LOG_KEYS) {
    const sum = sumRaw(played, k);
    if (sum != null) raw[k] = sum;
  }

  const pts = { std: 0, half: 0, ppr: 0 };
  let anyPts = false;
  for (const log of played) {
    if (Number.isFinite(log.points.std)) {
      pts.std += log.points.std;
      anyPts = true;
    }
    if (Number.isFinite(log.points.half)) {
      pts.half += log.points.half;
      anyPts = true;
    }
    if (Number.isFinite(log.points.ppr)) {
      pts.ppr += log.points.ppr;
      anyPts = true;
    }
  }

  let posRank: CareerSeasonRow["posRank"] = { std: null, half: null, ppr: null };
  try {
    const seasonMap = await seasonStats(year);
    const stats = seasonMap.get(id);
    if (stats) {
      posRank = {
        std:
          stats["pos_rank_std"] != null ? num(stats["pos_rank_std"], 0) : null,
        half:
          stats["pos_rank_half_ppr"] != null
            ? num(stats["pos_rank_half_ppr"], 0)
            : null,
        ppr:
          stats["pos_rank_ppr"] != null ? num(stats["pos_rank_ppr"], 0) : null,
      };
    }
  } catch {
    /* ignore */
  }

  return {
    year,
    team: team || "FA",
    games: played.length,
    pts: {
      std: anyPts ? round1(pts.std) : null,
      half: anyPts ? round1(pts.half) : null,
      ppr: anyPts ? round1(pts.ppr) : null,
    },
    posRank,
    raw,
  };
}

export async function loadGameLogs(
  id: string,
  seasonRequest?: string | null,
): Promise<{ season: string; logs: GameLog[]; career: CareerSeasonRow[] } | null> {
  const built = await buildPlayers("v2");
  const player = built.all.find((p) => p.id === id);
  if (!player) return null;

  const current = built.payload.season;
  const requested = (seasonRequest ?? "").trim().toLowerCase();
  const season =
    requested && /^\d{4}$/.test(requested) ? requested : current;

  // Career totals only need weekly actuals — skip the 18-week projection fan-out.
  const careerYears = [current, String(Number(current) - 1), String(Number(current) - 2)].filter(
    (y, i, arr) => /^\d{4}$/.test(y) && arr.indexOf(y) === i,
  );
  const [logs, careerBundles] = await Promise.all([
    buildSeasonLogsForPlayer(id, player, season, { includeProjections: true }),
    Promise.all(
      careerYears.map(async (year) => {
        const seasonLogs = await buildSeasonLogsForPlayer(id, player, year, {
          includeProjections: false,
        });
        return careerRowFromLogs(id, year, player.team, seasonLogs);
      }),
    ),
  ]);

  const career = careerBundles.filter((row): row is CareerSeasonRow => Boolean(row));
  return { season, logs, career };
}
