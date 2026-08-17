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
  /** 1-based overall ADP rank for each scoring format (999 when unranked). */
  rank: { std: number; half: number; ppr: number };
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

const scheduleFor = memo<{ week: number; home: string; away: string }[]>(
  24 * HOUR,
  async (season) => {
    const res = await fetch(`${BASE}/schedule/nfl/regular/${season}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { week: number; home: string; away: string }[];
    return Array.isArray(json) ? json : [];
  },
);

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
      adp: { std, half, ppr },
      rank: { std: 999, half: 999, ppr: 999 },
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
    pointsAllowedPerGame: avg === null ? null : Math.round((perGame.get(player.team) ?? 0) * 10) / 10,
    opponents,
  };
}

function injuryRisk(player: Player, history: SeasonLine[]) {
  const factors: string[] = [];
  let score = 20;

  const missed = history
    .map((h) => Math.max(0, 17 - h.games))
    .filter((m) => Number.isFinite(m));
  const totalMissed = missed.reduce((a, b) => a + b, 0);
  if (history.length) {
    score += Math.min(45, totalMissed * 5);
    if (totalMissed >= 6) factors.push(`${totalMissed} games missed over the last ${history.length} seasons`);
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
  const prevSeasons = [String(Number(season) - 1), String(Number(season) - 2), String(Number(season) - 3)];
  const statMaps = await Promise.all(prevSeasons.map((s) => seasonStats(s).catch(() => new Map<string, Stats>())));

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
          .filter((p) => p.team === player.team)
          .sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || b.proj.half - a.proj.half)
          .slice(0, 24)
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
