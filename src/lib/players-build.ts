/**
 * Client-safe Sleeper player-catalog logic.
 *
 * Pure fetch + transform helpers shared by the server loader and the browser
 * `useSleeperPlayers` cache, so both produce an identical `PlayersPayload`.
 */

export type Pos = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export type Player = {
  id: string;
  name: string;
  team: string;
  pos: Pos;
  age: number | null;
  exp: number | null;
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
  /** Sandbox/demo override for injury badge rendering. */
  injuryStatus?: string;
  /** Sandbox/demo override carrying the affected body part. */
  injury_body_part?: string;
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
  byeByTeam: Map<string, number>;
}): { players: Player[]; rawProj: Map<string, Stats> } {
  const { season: _season, projRows, prevStats, byeByTeam } = input;
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
    if (half >= 999 && projHalf <= 0) continue;

    const name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || row.team || "";
    if (!name) continue;

    const prev = prevStats.get(row.player_id);
    rawProj.set(row.player_id, s);
    players.push({
      id: row.player_id,
      name,
      team: row.team ?? p.team ?? "FA",
      pos,
      age: p.age ?? null,
      exp: p.years_exp ?? null,
      injury: p.injury_status ?? null,
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
  const res = await fetch(`${SLEEPER_BASE}/schedule/nfl/${type}/${season}`, {
    headers: { accept: "application/json" },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  const json = (await res.json()) as ScheduleGame[];
  return Array.isArray(json) ? json : [];
}

/** Full client-side build: three Sleeper calls, one ranked payload. */
export async function buildPlayersPayload(): Promise<PlayersPayload> {
  const { season, rows } = await fetchProjections(currentSeason());
  const [prevStats, schedule] = await Promise.all([
    fetchSeasonStats(String(Number(season) - 1)),
    fetchSchedule(season),
  ]);
  const { players } = buildPlayersFromRows({
    season,
    projRows: rows,
    prevStats,
    byeByTeam: byeWeeksFromSchedule(schedule),
  });
  return { season, updatedAt: Date.now(), players };
}
