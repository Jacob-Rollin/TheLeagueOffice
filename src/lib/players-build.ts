/**
 * Client-safe Sleeper player-catalog logic.
 *
 * Pure fetch + transform helpers shared by the server loader and the browser
 * `useSleeperPlayers` cache, so both produce an identical `PlayersPayload`.
 */

import { hasScorableProjectionStats } from "./scoring-map";

export type Pos = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

/** Slim counting-stat line shared by season projections and prior-year totals. */
export type CountingStats = {
  pass_yd: number;
  pass_td: number;
  pass_int: number;
  rush_att: number;
  rush_yd: number;
  rush_td: number;
  rec_tgt: number;
  rec: number;
  rec_yd: number;
  rec_td: number;
  fgm: number;
  fga: number;
  xpm: number;
  sack: number;
  int: number;
  fum_rec: number;
  def_st_td: number;
  pts_allow: number;
};

export const EMPTY_COUNTING_STATS: CountingStats = {
  pass_yd: 0,
  pass_td: 0,
  pass_int: 0,
  rush_att: 0,
  rush_yd: 0,
  rush_td: 0,
  rec_tgt: 0,
  rec: 0,
  rec_yd: 0,
  rec_td: 0,
  fgm: 0,
  fga: 0,
  xpm: 0,
  sack: 0,
  int: 0,
  fum_rec: 0,
  def_st_td: 0,
  pts_allow: 0,
};

/** Position → draft-board columns (Sleeper key + short label + decimals). */
export const POS_STAT_COLUMNS: Record<Pos, Array<{ key: keyof CountingStats; label: string; digits: number }>> = {
  QB: [
    { key: "pass_yd", label: "Pass Yd", digits: 0 },
    { key: "pass_td", label: "Pass TD", digits: 0 },
    { key: "pass_int", label: "INT", digits: 0 },
    { key: "rush_yd", label: "Rush Yd", digits: 0 },
    { key: "rush_td", label: "Rush TD", digits: 0 },
  ],
  RB: [
    { key: "rush_att", label: "Att", digits: 0 },
    { key: "rush_yd", label: "Rush Yd", digits: 0 },
    { key: "rush_td", label: "Rush TD", digits: 0 },
    { key: "rec_tgt", label: "Tgt", digits: 0 },
    { key: "rec", label: "Rec", digits: 0 },
    { key: "rec_yd", label: "Rec Yd", digits: 0 },
    { key: "rec_td", label: "Rec TD", digits: 0 },
  ],
  // Season projections omit rec_tgt (and K fgm/fga, DEF TD/PA); mock draft
  // fills those by summing weekly projection bundles (player Projections tab).
  WR: [
    { key: "rec_tgt", label: "Tgt", digits: 0 },
    { key: "rec", label: "Rec", digits: 0 },
    { key: "rec_yd", label: "Rec Yd", digits: 0 },
    { key: "rec_td", label: "Rec TD", digits: 0 },
    { key: "rush_yd", label: "Rush Yd", digits: 0 },
  ],
  TE: [
    { key: "rec_tgt", label: "Tgt", digits: 0 },
    { key: "rec", label: "Rec", digits: 0 },
    { key: "rec_yd", label: "Rec Yd", digits: 0 },
    { key: "rec_td", label: "Rec TD", digits: 0 },
  ],
  K: [
    { key: "fgm", label: "FGM", digits: 0 },
    { key: "fga", label: "FGA", digits: 0 },
    { key: "xpm", label: "XPM", digits: 0 },
  ],
  DEF: [
    { key: "sack", label: "Sack", digits: 0 },
    { key: "int", label: "INT", digits: 0 },
    { key: "fum_rec", label: "FR", digits: 0 },
    { key: "def_st_td", label: "TD", digits: 0 },
    { key: "pts_allow", label: "PA", digits: 0 },
  ],
};

export function countingStatsFrom(stats: Stats | null | undefined): CountingStats {
  const s = stats ?? {};
  return {
    pass_yd: num(s["pass_yd"], 0),
    pass_td: num(s["pass_td"], 0),
    pass_int: num(s["pass_int"], 0),
    rush_att: num(s["rush_att"], 0),
    rush_yd: num(s["rush_yd"], 0),
    rush_td: num(s["rush_td"], 0),
    rec_tgt: num(s["rec_tgt"], 0),
    rec: num(s["rec"], 0),
    rec_yd: num(s["rec_yd"], 0),
    rec_td: num(s["rec_td"], 0),
    fgm: num(s["fgm"], 0),
    fga: num(s["fga"], 0),
    xpm: num(s["xpm"], 0),
    sack: num(s["sack"], 0),
    int: num(s["int"], 0),
    fum_rec: num(s["fum_rec"], 0),
    def_st_td: num(s["def_st_td"], 0),
    pts_allow: num(s["pts_allow"], 0),
  };
}

export type Player = {
  id: string;
  name: string;
  team: string;
  pos: Pos;
  age: number | null;
  exp: number | null;
  /** Sleeper high-level injury token (`injury_status`), e.g. Out / Questionable / IR. */
  injury_status: string | null;
  /** Alias of `injury_status` kept for PlayerDetail / legacy readers. */
  injury: string | null;
  /** Bye week for the player's team this season (null when unknown). */
  bye: number | null;
  adp: { std: number; half: number; ppr: number };
  /** Low/high ADP across Sleeper's scoring-format markets (999 when unranked). */
  adpRange: { min: number; max: number };
  /** 1-based overall ADP rank for each scoring format (999 when unranked). */
  rank: { std: number; half: number; ppr: number };
  /** 1-based rank within the player's position (e.g. 3 => "RB3"). */
  posRank: number;
  proj: { std: number; half: number; ppr: number };
  prev: { std: number; half: number; ppr: number } | null;
  /** Season projection counting stats (pass/rush/rec/…). Absent on legacy stubs. */
  projLine?: CountingStats;
  /** Prior-season actual counting stats when available. */
  prevLine?: CountingStats | null;
  /** Prior-season ADP by scoring format (999 when unknown). */
  prevAdp?: { std: number; half: number; ppr: number } | null;
  /** Sandbox/demo override for injury badge rendering. */
  injuryStatus?: string;
  /** Sleeper native affected body region (e.g. Hamstring). */
  injury_body_part?: string | null;
  /** Sleeper free-text recovery / practice notes. */
  injury_notes?: string | null;
};

export type PlayersPayload = {
  season: string;
  updatedAt: number;
  players: Player[];
};

export type Stats = Record<string, number>;

export type SleeperRow = {
  player_id: string;
  team: string | null;
  opponent?: string | null;
  week?: number | null;
  stats: Stats | null;
  player: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string | null;
    age?: number | null;
    years_exp?: number | null;
    injury_status?: string | null;
    injury_body_part?: string | null;
    injury_notes?: string | null;
    active?: boolean | null;
    status?: string | null;
  } | null;
};

export type ScheduleGame = {
  week: number;
  home: string;
  away: string;
  date?: string | null;
  status?: string | null;
};

export const POSITIONS: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
export const SLEEPER_BASE = "https://api.sleeper.app";
export const HOUR = 1000 * 60 * 60;

export function positionsQuery() {
  return POSITIONS.map((p) => `position[]=${p}`).join("&");
}

export function currentSeason(): string {
  const now = new Date();
  // NFL fantasy season rolls over in the spring.
  return String(now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
}

export async function fetchRows(url: string): Promise<SleeperRow[]> {
  // Browser catalog builds share the soft Sleeper budget; server keep raw fetch.
  if (typeof window !== "undefined") {
    const { sleeperFetchJson } = await import("./sleeper-http");
    const json = await sleeperFetchJson<SleeperRow[]>(url, "warm");
    if (!json) throw new Error("Upstream budget/empty");
    return Array.isArray(json) ? json : [];
  }
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Upstream ${res.status}`);
  const json = (await res.json()) as SleeperRow[];
  return Array.isArray(json) ? json : [];
}

export function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** First finite ADP below the "unranked" sentinel, else 999. */
export function adpPick(...vals: unknown[]): number {
  for (const v of vals) {
    const n = num(v, 999);
    if (n > 0 && n < 999) return n;
  }
  return 999;
}

/** Low/high across the ADP markets we have; 999/999 when none are ranked. */
export function adpSpread(vals: unknown[]): { min: number; max: number } {
  const nums = vals.map((v) => num(v, 999)).filter((n) => n > 0 && n < 999);
  if (!nums.length) return { min: 999, max: 999 };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/** Weeks 4-18 with no scheduled game, per team. */
export function byeWeeksFromSchedule(games: ScheduleGame[]): Map<string, number> {
  const played = new Map<string, Set<number>>();
  const teams = new Set<string>();
  for (const g of games) {
    for (const t of [g.home, g.away]) {
      if (!t) continue;
      teams.add(t);
      if (!played.has(t)) played.set(t, new Set());
      played.get(t)!.add(g.week);
    }
  }
  const byes = new Map<string, number>();
  for (const t of teams) {
    const weeks = played.get(t)!;
    for (let w = 4; w <= 18; w++) {
      if (!weeks.has(w)) {
        byes.set(t, w);
        break;
      }
    }
  }
  return byes;
}

/**
 * Turn raw Sleeper projection rows into the ranked, fantasy-only player list.
 * Retired / inactive entries and non-fantasy positions are discarded here, so
 * the cached payload stays small.
 */
export function buildPlayersFromRows(input: {
  season: string;
  projRows: SleeperRow[];
  prevStats: Map<string, Stats>;
  /** Optional prior-season projection rows — used only for historical ADP. */
  prevProjById?: Map<string, Stats>;
  byeByTeam: Map<string, number>;
}): { players: Player[]; rawProj: Map<string, Stats> } {
  const { season: _season, projRows, prevStats, prevProjById, byeByTeam } = input;
  const players: Player[] = [];
  const rawProj = new Map<string, Stats>();

  for (const row of projRows) {
    const s = row.stats ?? {};
    const p = row.player ?? {};
    const pos = (p.position ?? "") as Pos;
    if (!POSITIONS.includes(pos)) continue;
    // Drop retired / inactive assets (Sleeper omits the flag for team defenses).
    if (pos !== "DEF" && p.active === false) continue;

    const half = adpPick(s["adp_half_ppr"], s["adp_ppr"], s["adp_std"]);
    const ppr = adpPick(s["adp_ppr"], s["adp_half_ppr"], s["adp_std"]);
    const std = adpPick(s["adp_std"], s["adp_half_ppr"], s["adp_ppr"]);
    const projHalf = num(s["pts_half_ppr"], 0);
    // Keep ADP-ranked players, anyone with published fantasy pts, and mid-season
    // fill-ins that only have a counting-stat projection line (e.g. Drew Lock).
    if (half >= 999 && projHalf <= 0 && !hasScorableProjectionStats(s)) continue;

    const name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || row.team || "";
    if (!name) continue;

    const prev = prevStats.get(row.player_id);
    const prevProj = prevProjById?.get(row.player_id);
    rawProj.set(row.player_id, s);
    const injuryStatus = p.injury_status ?? null;
    const prevAdpHalf = prevProj
      ? adpPick(prevProj["adp_half_ppr"], prevProj["adp_ppr"], prevProj["adp_std"])
      : 999;
    players.push({
      id: row.player_id,
      name,
      team: row.team ?? p.team ?? "FA",
      pos,
      age: p.age ?? null,
      exp: p.years_exp ?? null,
      injury_status: injuryStatus,
      injury: injuryStatus,
      injury_body_part: p.injury_body_part?.trim() || null,
      injury_notes: p.injury_notes?.trim() || null,
      bye: byeByTeam.get(row.team ?? p.team ?? "") ?? null,
      adp: { std, half, ppr },
      adpRange: adpSpread([
        s["adp_std"],
        s["adp_half_ppr"],
        s["adp_ppr"],
        s["adp_2qb"],
        s["adp_dynasty"],
      ]),
      rank: { std: 999, half: 999, ppr: 999 },
      posRank: 999,
      proj: {
        std: num(s["pts_std"], 0),
        half: projHalf,
        ppr: num(s["pts_ppr"], 0),
      },
      prev: prev
        ? {
            std: num(prev["pts_std"], 0),
            half: num(prev["pts_half_ppr"], 0),
            ppr: num(prev["pts_ppr"], 0),
          }
        : null,
      projLine: countingStatsFrom(s),
      prevLine: prev ? countingStatsFrom(prev) : null,
      prevAdp:
        prevProj && prevAdpHalf < 999
          ? {
              std: adpPick(prevProj["adp_std"], prevProj["adp_half_ppr"], prevProj["adp_ppr"]),
              half: prevAdpHalf,
              ppr: adpPick(prevProj["adp_ppr"], prevProj["adp_half_ppr"], prevProj["adp_std"]),
            }
          : null,
    });
  }

  // Overall ADP rank per scoring format: ADP order first, then projection order
  // for anyone without a market ADP so every player gets a sane ranking.
  for (const fmt of ["std", "half", "ppr"] as const) {
    const ordered = [...players].sort((a, b) => {
      const ad = a.adp[fmt];
      const bd = b.adp[fmt];
      if (ad !== bd) return ad - bd;
      return b.proj[fmt] - a.proj[fmt];
    });
    ordered.forEach((p, i) => {
      p.rank[fmt] = i + 1;
    });
  }

  // Positional rank (RB1, WR12, ...) off the half-PPR ordering.
  const posSeen: Record<string, number> = {};
  for (const p of [...players].sort((a, b) => a.rank.half - b.rank.half)) {
    posSeen[p.pos] = (posSeen[p.pos] ?? 0) + 1;
    p.posRank = posSeen[p.pos]!;
  }

  return { players: [...players].sort((a, b) => a.rank.half - b.rank.half), rawProj };
}

/** Sleeper projection rows for a season, falling back to the prior season. */
export async function fetchProjections(
  season: string,
): Promise<{ season: string; rows: SleeperRow[] }> {
  const q = `season_type=regular&${positionsQuery()}&order_by=adp_half_ppr`;
  let rows = await fetchRows(`${SLEEPER_BASE}/projections/nfl/${season}?${q}`).catch(() => []);
  let used = season;
  if (!rows.some((r) => num(r.stats?.["adp_half_ppr"], 999) < 999)) {
    const fallback = String(Number(season) - 1);
    const alt = await fetchRows(`${SLEEPER_BASE}/projections/nfl/${fallback}?${q}`).catch(() => []);
    if (alt.length) {
      rows = alt;
      used = fallback;
    }
  }
  return { season: used, rows };
}

/** Season-long actual stats keyed by player id. */
export async function fetchSeasonStats(season: string): Promise<Map<string, Stats>> {
  const rows = await fetchRows(
    `${SLEEPER_BASE}/stats/nfl/${season}?season_type=regular&${positionsQuery()}&order_by=pts_half_ppr`,
  ).catch(() => []);
  const map = new Map<string, Stats>();
  for (const row of rows) if (row.stats) map.set(row.player_id, row.stats);
  return map;
}

export async function fetchSchedule(season: string, type = "regular"): Promise<ScheduleGame[]> {
  const url = `${SLEEPER_BASE}/schedule/nfl/${type}/${season}`;
  if (typeof window !== "undefined") {
    const { sleeperFetchJson } = await import("./sleeper-http");
    const json = await sleeperFetchJson<ScheduleGame[]>(url, "warm");
    return Array.isArray(json) ? json : [];
  }
  const res = await fetch(url, {
    headers: { accept: "application/json" },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  const json = (await res.json()) as ScheduleGame[];
  return Array.isArray(json) ? json : [];
}

/** Full client-side build: current projections + prior stats/ADP, one ranked payload. */
export async function buildPlayersPayload(): Promise<PlayersPayload> {
  const { season, rows } = await fetchProjections(currentSeason());
  const prevSeason = String(Number(season) - 1);
  const [prevStats, schedule, prevProj] = await Promise.all([
    fetchSeasonStats(prevSeason),
    fetchSchedule(season),
    // Prior-season projections are ADP-only context for the year-stats toggle.
    fetchRows(
      `${SLEEPER_BASE}/projections/nfl/${prevSeason}?season_type=regular&${positionsQuery()}&order_by=adp_half_ppr`,
    ).catch(() => [] as SleeperRow[]),
  ]);
  const prevProjById = new Map<string, Stats>();
  for (const row of prevProj) {
    if (row.stats) prevProjById.set(row.player_id, row.stats);
  }
  const { players } = buildPlayersFromRows({
    season,
    projRows: rows,
    prevStats,
    prevProjById,
    byeByTeam: byeWeeksFromSchedule(schedule),
  });
  return { season, updatedAt: Date.now(), players };
}
