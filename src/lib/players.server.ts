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
};

export type PlayersPayload = {
  season: string;
  updatedAt: number;
  players: Player[];
};

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
  projection: SeasonLine;
  depthChart: DepthEntry[];
  sos: {
    grade: string;
    rank: number | null;
    pointsAllowedPerGame: number | null;
    opponents: { week: number; opp: string; rank: number | null }[];
  } | null;
  injuryRisk: { score: number; label: string; factors: string[] };
};

const POSITIONS: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const BASE = "https://api.sleeper.app";

type Stats = Record<string, number>;

type SleeperRow = {
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
  } | null;
};

function positionsQuery() {
  return POSITIONS.map((p) => `position[]=${p}`).join("&");
}

function currentSeason(): string {
  const now = new Date();
  // NFL fantasy season rolls over in the spring.
  return String(now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
}

async function fetchRows(url: string): Promise<SleeperRow[]> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Upstream ${res.status}`);
  const json = (await res.json()) as SleeperRow[];
  return Array.isArray(json) ? json : [];
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** First finite ADP below the "unranked" sentinel, else 999. */
function adpPick(...vals: unknown[]): number {
  for (const v of vals) {
    const n = num(v, 999);
    if (n > 0 && n < 999) return n;
  }
  return 999;
}

/** Low/high across the ADP markets we have; 999/999 when none are ranked. */
function adpSpread(vals: unknown[]): { min: number; max: number } {
  const nums = vals.map((v) => num(v, 999)).filter((n) => n > 0 && n < 999);
  if (!nums.length) return { min: 999, max: 999 };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

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

/** Season-long stats for every player, keyed by player id. */
const seasonStats = memo<Map<string, Stats>>(6 * HOUR, async (season) => {
  const rows = await fetchRows(
    `${BASE}/stats/nfl/${season}?season_type=regular&${positionsQuery()}&order_by=pts_half_ppr`,
  ).catch(() => []);
  const map = new Map<string, Stats>();
  for (const row of rows) if (row.stats) map.set(row.player_id, row.stats);
  return map;
});

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
  const games = await scheduleFor(season);
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

type ProjectionsResult = { season: string; rows: SleeperRow[] };

const projectionsFor = memo<ProjectionsResult>(6 * HOUR, async (season) => {
  const q = `season_type=regular&${positionsQuery()}&order_by=adp_half_ppr`;
  let rows = await fetchRows(`${BASE}/projections/nfl/${season}?${q}`).catch(() => []);
  let used = season;
  if (!rows.some((r) => num(r.stats?.["adp_half_ppr"], 999) < 999)) {
    const fallback = String(Number(season) - 1);
    const alt = await fetchRows(`${BASE}/projections/nfl/${fallback}?${q}`).catch(() => []);
    if (alt.length) {
      rows = alt;
      used = fallback;
    }
  }
  return { season: used, rows };
});

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

  const players: Player[] = [];
  const rawProj = new Map<string, Stats>();

  for (const row of projRows) {
    const s = row.stats ?? {};
    const p = row.player ?? {};
    const pos = (p.position ?? "") as Pos;
    if (!POSITIONS.includes(pos)) continue;

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

  const all = [...players].sort((a, b) => a.rank.half - b.rank.half);

  return {
    all,
    rawProj,
    payload: { season, updatedAt: Date.now(), players: all.slice(0, 500) },
  };
});

export async function loadPlayers(): Promise<PlayersPayload> {
  return (await buildPlayers("v1")).payload;
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

/** Half-PPR points allowed per game by each defense, split by position. */
const defenseAllowed = memo<Map<string, Map<Pos, { pts: number; games: number }>>>(
  12 * HOUR,
  async (season) => {
    const weeks = Array.from({ length: 17 }, (_, i) => i + 1);
    const q = `season_type=regular&${POSITIONS.filter((p) => p !== "DEF")
      .map((p) => `position[]=${p}`)
      .join("&")}`;
    const table = new Map<string, Map<Pos, { pts: number; games: number }>>();

    for (let i = 0; i < weeks.length; i += 6) {
      const chunk = weeks.slice(i, i + 6);
      const results = await Promise.all(
        chunk.map((w) => fetchRows(`${BASE}/stats/nfl/${season}/${w}?${q}`).catch(() => [])),
      );
      for (const rows of results) {
        for (const row of rows) {
          const opp = row.opponent;
          const pos = (row.player?.position ?? "") as Pos;
          if (!opp || !POSITIONS.includes(pos)) continue;
          const pts = num(row.stats?.["pts_half_ppr"], 0);
          if (pts <= 0) continue;
          let byPos = table.get(opp);
          if (!byPos) table.set(opp, (byPos = new Map()));
          const cell = byPos.get(pos) ?? { pts: 0, games: 0 };
          cell.pts += pts;
          byPos.set(pos, cell);
        }
      }
    }
    // Each defense plays ~17 games; normalise on that.
    for (const byPos of table.values()) {
      for (const cell of byPos.values()) cell.games = 17;
    }
    return table;
  },
);

function sosGrade(avgRank: number): string {
  if (avgRank <= 10) return "Very hard";
  if (avgRank <= 14) return "Hard";
  if (avgRank <= 19) return "Neutral";
  if (avgRank <= 24) return "Easy";
  return "Very easy";
}

async function buildSos(player: Player, season: string) {
  if (player.team === "FA" || player.pos === "DEF") return null;
  const prev = String(Number(season) - 1);
  const [allowed, schedule] = await Promise.all([
    defenseAllowed(prev).catch(() => null),
    scheduleFor(season).catch(() => []),
  ]);
  if (!allowed || allowed.size === 0) return null;

  const perGame = new Map<string, number>();
  for (const [team, byPos] of allowed) {
    const cell = byPos.get(player.pos);
    if (cell && cell.games > 0) perGame.set(team, cell.pts / cell.games);
  }
  if (perGame.size === 0) return null;

  // rank 1 = stingiest defense against this position (hardest matchup)
  const ranked = [...perGame.entries()].sort((a, b) => a[1] - b[1]);
  const rankOf = new Map(ranked.map(([team], i) => [team, i + 1]));

  const opponents = schedule
    .filter((g) => g.home === player.team || g.away === player.team)
    .filter((g) => g.week <= 17)
    .sort((a, b) => a.week - b.week)
    .map((g) => {
      const opp = g.home === player.team ? g.away : g.home;
      return { week: g.week, opp, rank: rankOf.get(opp) ?? null };
    });

  const ranks = opponents.map((o) => o.rank).filter((r): r is number => r !== null);
  const avg = ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;

  return {
    grade: avg === null ? "Unknown" : sosGrade(avg),
    rank: avg === null ? null : Math.round(avg),
    pointsAllowedPerGame:
      avg === null ? null : Math.round((perGame.get(player.team) ?? 0) * 10) / 10,
    opponents,
  };
}

function injuryRisk(player: Player, history: SeasonLine[]) {
  const factors: string[] = [];
  let score = 20;

  const missed = history.map((h) => Math.max(0, 17 - h.games)).filter((m) => Number.isFinite(m));
  const totalMissed = missed.reduce((a, b) => a + b, 0);
  if (history.length) {
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
  const built = await buildPlayers("v1");
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
    if (stats) history.push(toSeasonLine(s, player.pos, stats));
  });

  const projection = toSeasonLine(season, player.pos, built.rawProj.get(id) ?? {});

  const depthChart: DepthEntry[] =
    player.team === "FA"
      ? []
      : built.all
          .filter((p) => p.team === player.team && p.pos === player.pos)
          .sort((a, b) => b.proj.half - a.proj.half)
          .slice(0, 12)
          .map((p) => ({
            id: p.id,
            name: p.name,
            pos: p.pos,
            proj: p.proj.half,
            adp: p.adp.half,
            injury: p.injury,
          }));

  const sos = await buildSos(player, season).catch(() => null);

  return {
    season,
    player,
    history,
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

function mentions(a: EspnArticle, name: string): boolean {
  const hay = `${a.headline ?? ""} ${a.description ?? ""}`.toLowerCase();
  const lower = name.toLowerCase();
  if (hay.includes(lower)) return true;
  if ((a.categories ?? []).some((c) => (c.athlete?.description ?? "").toLowerCase() === lower)) {
    return true;
  }
  return false;
}

function toItem(a: EspnArticle, aboutPlayer: boolean): NewsItem {
  return {
    id: String(a.id ?? a.headline ?? Math.random()),
    headline: a.headline ?? "Untitled",
    description: a.description ?? "",
    published: a.published ?? a.lastModified ?? "",
    link: a.links?.web?.href ?? null,
    image: a.images?.[0]?.url ?? null,
    aboutPlayer,
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

export async function loadPlayerNews(id: string): Promise<PlayerNews | null> {
  const built = await buildPlayers("v1");
  const player = built.all.find((p) => p.id === id);
  if (!player) return null;

  const athleteId = await espnAthleteId(player.name).catch(() => null);
  const [personal, league, team] = await Promise.all([
    athleteId ? espnPlayerFeed(athleteId).catch(() => [] as EspnFeedItem[]) : Promise.resolve([]),
    espnNews("").catch(() => [] as EspnArticle[]),
    player.team && player.team !== "FA"
      ? espnNews(`&team=${player.team.toLowerCase()}`).catch(() => [] as EspnArticle[])
      : Promise.resolve([] as EspnArticle[]),
  ]);

  const seen = new Set<string>();
  const items: NewsItem[] = [];
  const push = (a: EspnArticle, about: boolean) => {
    const item = toItem(a, about);
    if (seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  };

  for (const f of personal) {
    const item: NewsItem = {
      id: String(f.id ?? f.headline ?? Math.random()),
      headline: f.headline ?? "Player update",
      description: stripTags(f.story ?? f.description ?? ""),
      published: f.published ?? f.lastModified ?? "",
      link: f.links?.web?.href ?? null,
      image: null,
      aboutPlayer: true,
    };
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  for (const a of [...league, ...team]) if (mentions(a, player.name)) push(a, true);
  for (const a of team) push(a, false);
  for (const a of league) push(a, false);

  items.sort((a, b) => {
    if (a.aboutPlayer !== b.aboutPlayer) return a.aboutPlayer ? -1 : 1;
    return (b.published ?? "").localeCompare(a.published ?? "");
  });

  return {
    player,
    injury: {
      status: player.injury,
      note: player.injury
        ? `Listed ${player.injury}${player.team && player.team !== "FA" ? ` on ${player.team}'s report` : ""}.`
        : null,
    },
    items: items.slice(0, 12),
  };
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
] as const;

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

export async function loadGameLogs(
  id: string,
): Promise<{ season: string; logs: GameLog[] } | null> {
  const built = await buildPlayers("v1");
  const player = built.all.find((p) => p.id === id);
  if (!player) return null;

  const seasons = [built.payload.season, String(Number(built.payload.season) - 1)];
  for (const season of seasons) {
    const raw = await weeklyRaw(id, season);
    const schedule = await scheduleFor(season).catch(() => []);
    const logs: GameLog[] = [];
    for (const [wk, entry] of Object.entries(raw)) {
      const stats = entry?.stats;
      if (!stats) continue;
      const week = Number(wk);
      if (!Number.isFinite(week)) continue;
      const game = schedule.find(
        (g) => g.week === week && (g.home === player.team || g.away === player.team),
      );
      const opp = game ? (game.home === player.team ? `vs ${game.away}` : `@ ${game.home}`) : null;
      logs.push({
        week,
        opp,
        points: {
          std: num(stats["pts_std"], 0),
          half: num(stats["pts_half_ppr"], 0),
          ppr: num(stats["pts_ppr"], 0),
        },
        line: statLine(player.pos, stats),
        raw: Object.fromEntries(LOG_KEYS.map((k) => [k, num(stats[k], 0)])),
      });
    }
    if (logs.length) {
      logs.sort((a, b) => a.week - b.week);
      return { season, logs };
    }
  }
  return { season: built.payload.season, logs: [] };
}
