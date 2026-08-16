export type Pos = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export type Player = {
  id: string;
  name: string;
  team: string;
  pos: Pos;
  age: number | null;
  exp: number | null;
  injury: string | null;
  adp: { std: number; half: number; ppr: number };
  proj: { std: number; half: number; ppr: number };
  prev: { std: number; half: number; ppr: number } | null;
};

export type PlayersPayload = {
  season: string;
  updatedAt: number;
  players: Player[];
};

const POSITIONS: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

type SleeperRow = {
  player_id: string;
  team: string | null;
  stats: Record<string, number> | null;
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

let cache: { at: number; data: PlayersPayload } | null = null;
const TTL = 1000 * 60 * 60 * 6;

export async function loadPlayers(): Promise<PlayersPayload> {
  if (cache && Date.now() - cache.at < TTL) return cache.data;

  const season = currentSeason();
  const prevSeason = String(Number(season) - 1);
  const base = "https://api.sleeper.app";
  const q = `season_type=regular&${positionsQuery()}`;

  const [projRows, prevRows] = await Promise.all([
    fetchRows(`${base}/projections/nfl/${season}?${q}&order_by=adp_half_ppr`),
    fetchRows(`${base}/stats/nfl/${prevSeason}?${q}&order_by=pts_half_ppr`).catch(() => []),
  ]);

  const prevById = new Map<string, Record<string, number>>();
  for (const row of prevRows) {
    if (row.stats) prevById.set(row.player_id, row.stats);
  }

  const players: Player[] = [];
  for (const row of projRows) {
    const s = row.stats ?? {};
    const p = row.player ?? {};
    const pos = (p.position ?? "") as Pos;
    if (!POSITIONS.includes(pos)) continue;

    const adpHalf = num(s["adp_half_ppr"], 999);
    const projHalf = num(s["pts_half_ppr"], 0);
    if (adpHalf >= 999 && projHalf <= 0) continue;

    const name =
      pos === "DEF"
        ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || (row.team ?? "Defense")
        : `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    if (!name) continue;

    const prevStats = prevById.get(row.player_id);
    players.push({
      id: row.player_id,
      name,
      team: row.team ?? p.team ?? "FA",
      pos,
      age: p.age ?? null,
      exp: p.years_exp ?? null,
      injury: p.injury_status ?? null,
      adp: {
        std: num(s["adp_std"], 999),
        half: adpHalf,
        ppr: num(s["adp_ppr"], 999),
      },
      proj: {
        std: num(s["pts_std"], 0),
        half: projHalf,
        ppr: num(s["pts_ppr"], 0),
      },
      prev: prevStats
        ? {
            std: num(prevStats["pts_std"], 0),
            half: num(prevStats["pts_half_ppr"], 0),
            ppr: num(prevStats["pts_ppr"], 0),
          }
        : null,
    });
  }

  players.sort((a, b) => {
    const d = a.adp.half - b.adp.half;
    return d !== 0 ? d : b.proj.half - a.proj.half;
  });

  const data: PlayersPayload = {
    season,
    updatedAt: Date.now(),
    players: players.slice(0, 500),
  };
  cache = { at: Date.now(), data };
  return data;
}
