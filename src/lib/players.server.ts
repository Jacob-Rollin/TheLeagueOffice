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
const seasonStats = memo<Map<string, Stats>>(6 * HOUR, (season) => fetchSeasonStats(season));

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
        chunk.map(async (week) => ({
          week,
          rows: await fetchRows(`${BASE}/stats/nfl/${season}/${week}?${q}`).catch(() => []),
        })),
      );
      for (const { week, rows } of results) {
        const gamesSeen = new Set<string>();
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
          const gameKey = `${opp}|${pos}|${week}`;
          if (!gamesSeen.has(gameKey)) {
            cell.games += 1;
            gamesSeen.add(gameKey);
          }
          byPos.set(pos, cell);
        }
      }
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

async function buildSosFor(team: string, pos: Pos, season: string) {
  if (team === "FA" || pos === "DEF") return null;
  const prev = String(Number(season) - 1);
  const [activeAllowed, previousAllowed, schedule] = await Promise.all([
    defenseAllowed(season).catch(() => null),
    defenseAllowed(prev).catch(() => null),
    scheduleFor(season).catch(() => []),
  ]);
  const allowed = activeAllowed && activeAllowed.size > 0 ? activeAllowed : previousAllowed;
  if (!allowed || allowed.size === 0) return null;

  const perGame = new Map<string, number>();
  for (const [team, byPos] of allowed) {
    const cell = byPos.get(pos);
    if (cell && cell.games > 0) perGame.set(team, cell.pts / cell.games);
  }
  if (perGame.size === 0) return null;

  // rank 1 = stingiest defense against this position (hardest matchup)
  const ranked = [...perGame.entries()].sort((a, b) => a[1] - b[1]);
  const rankOf = new Map(ranked.map(([team], i) => [team, i + 1]));

  const opponents = schedule
    .filter((g) => g.home === team || g.away === team)
    .filter((g) => g.week <= 17)
    .sort((a, b) => a.week - b.week)
    .map((g) => {
      const opp = g.home === team ? g.away : g.home;
      const pointsAllowed = perGame.get(opp);
      return {
        week: g.week,
        opp,
        rank: rankOf.get(opp) ?? null,
        pointsAllowed: pointsAllowed === undefined ? null : Math.round(pointsAllowed * 10) / 10,
      };
    });

  const ranks = opponents.map((o) => o.rank).filter((r): r is number => r !== null);
  const avg = ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;

  return {
    grade: avg === null ? "Unknown" : sosGrade(avg),
    rank: avg === null ? null : Math.round(avg),
    pointsAllowedPerGame:
      avg === null ? null : Math.round((perGame.get(team) ?? 0) * 10) / 10,
    opponents,
  };
}

async function buildSos(player: Player, season: string) {
  return buildSosFor(player.team, player.pos, season);
}

export type SosMatrixEntry = NonNullable<PlayerDetail["sos"]>;

/** One synchronized schedule entry per unique NFL team and fantasy position. */
export async function loadSosMatrix(
  players: readonly { team?: string | null; position?: string | null }[],
  season = currentSeason(),
): Promise<Map<string, SosMatrixEntry>> {
  const keys = new Set<string>();
  for (const player of players) {
    const team = (player.team ?? "").toUpperCase();
    const pos = (player.position ?? "").toUpperCase() as Pos;
    if (team && team !== "FA" && POSITIONS.includes(pos) && pos !== "DEF") keys.add(`${team}|${pos}`);
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
    if (!stats) return;
    const line = toSeasonLine(s, player.pos, stats);
    // Skip seasons the player never actually played (rookies get empty stat rows).
    if (line.games <= 0) return;
    history.push(line);
  });

  const projection = toSeasonLine(season, player.pos, built.rawProj.get(id) ?? {});

  const fantasyDepthPositions: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const depthChart: DepthEntry[] =
    player.team === "FA"
      ? []
      : fantasyDepthPositions.flatMap((slot) =>
          built.all
            .filter((p) => p.team === player.team && p.pos === slot)
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
    const headline = f.headline ?? "Player update";
    const description = stripTags(f.story ?? f.description ?? "");
    // Guard against wrong ESPN athlete ID resolution — copy must mention this player.
    if (!mentions({ headline, description } as EspnArticle, player.name)) continue;
    const item: NewsItem = {
      id: String(f.id ?? f.headline ?? Math.random()),
      headline,
      description,
      published: f.published ?? f.lastModified ?? "",
      link: f.links?.web?.href ?? null,
      image: null,
      aboutPlayer: true,
    };
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  // Only articles that explicitly mention this player — never bleed team/league recaps.
  for (const a of [...league, ...team]) if (mentions(a, player.name)) push(a, true);

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

function injuryLabelFromStatus(status: string | null | undefined): "Q" | "O" | "IR" | "NA" | null {
  if (!status || status === "Healthy" || status === "Active" || status === "None") return null;
  if (status === "Questionable") return "Q";
  if (status === "Out" || status === "Doubtful") return "O";
  if (status === "IR") return "IR";
  if (status === "NA") return "NA";
  return null;
}

/**
 * Top active injury timelines across the NFL (not limited to a synced roster).
 * Filters out general recaps / draft chatter; dedupes by player.
 */
export async function loadLeagueWidePlayerNews(limit = 10): Promise<LeagueWideNewsRow[]> {
  const built = await buildPlayers("v1");
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
  "xpm",
  "sack",
  "int",
  "ff",
  "fum_rec",
  "def_st_td",
  "pts_allow",
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

type WeekProjectionBundle = {
  std: number | null;
  half: number | null;
  ppr: number | null;
  raw: Record<string, number>;
};

/** Weekly projected points + raw stats for one player across weeks 1–18. */
const playerWeekProjections = memo<Map<number, WeekProjectionBundle>>(6 * HOUR, async (key) => {
  const [id, season] = key.split("|") as [string, string];
  const out = new Map<number, WeekProjectionBundle>();
  await Promise.all(
    Array.from({ length: 18 }, (_, i) => i + 1).map(async (week) => {
      try {
        const res = await fetch(
          `${BASE}/projections/nfl/${season}/${week}?season_type=regular&${positionsQuery()}`,
          { headers: { accept: "application/json" } },
        );
        if (!res.ok) return;
        const rows = (await res.json().catch(() => null)) as
          | { player_id?: string; stats?: Stats | null }[]
          | null;
        if (!Array.isArray(rows)) return;
        const hit = rows.find((r) => String(r.player_id) === id);
        const stats = hit?.stats;
        if (!stats) return;
        const std = stats["pts_std"];
        const half = stats["pts_half_ppr"];
        const ppr = stats["pts_ppr"];
        const raw: Record<string, number> = {};
        for (const k of LOG_KEYS) {
          if (stats[k] != null && Number.isFinite(Number(stats[k]))) {
            raw[k] = num(stats[k], 0);
          }
        }
        out.set(week, {
          std: std != null && Number.isFinite(Number(std)) ? Number(std) : null,
          half: half != null && Number.isFinite(Number(half)) ? Number(half) : null,
          ppr: ppr != null && Number.isFinite(Number(ppr)) ? Number(ppr) : null,
          raw,
        });
      } catch {
        /* ignore week miss */
      }
    }),
  );
  return out;
});

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
): Promise<GameLog[]> {
  const [raw, schedule, projByWeek, byeByTeam] = await Promise.all([
    weeklyRaw(id, season),
    scheduleFor(season).catch(() => [] as ScheduleGame[]),
    playerWeekProjections(`${id}|${season}`).catch(() => new Map<number, WeekProjectionBundle>()),
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
      raw: rawStats,
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
  const built = await buildPlayers("v1");
  const player = built.all.find((p) => p.id === id);
  if (!player) return null;

  const current = built.payload.season;
  const requested = (seasonRequest ?? "").trim().toLowerCase();
  const season =
    requested && /^\d{4}$/.test(requested) ? requested : current;

  const careerYears = ["2026", "2025", "2024", "2023", "2022"];
  const [logs, careerBundles] = await Promise.all([
    buildSeasonLogsForPlayer(id, player, season),
    Promise.all(
      careerYears.map(async (year) => {
        const seasonLogs = await buildSeasonLogsForPlayer(id, player, year);
        return careerRowFromLogs(id, year, player.team, seasonLogs);
      }),
    ),
  ]);

  const career = careerBundles.filter((row): row is CareerSeasonRow => Boolean(row));
  return { season, logs, career };
}
