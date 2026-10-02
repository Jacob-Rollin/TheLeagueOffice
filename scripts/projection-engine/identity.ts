import { BULK_TIMEOUT_MS, POSITIONS } from "./config";
import { parseCsv } from "./csv";
import { cachedText } from "./http";
import { canonTeam, nameVariants, normName } from "./names";
import type { Pos } from "./types";

export interface PlayerMeta {
  id: string;
  name: string;
  pos: Pos;
  team: string;
  injury: string | null;
  /** Sleeper depth chart order at the player's position (1 = starter). */
  depth: number | null;
}

export interface Identity {
  players: Map<string, PlayerMeta>;
  byEspn: Map<string, string>;
  byGsis: Map<string, string>;
  byCbs: Map<string, string>;
  findByName(name: string, pos: Pos, team: string): string | null;
}

const SLEEPER_PLAYERS = "https://api.sleeper.app/v1/players/nfl";
const CROSSWALK = "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv";

const present = (v: unknown): v is string =>
  typeof v === "string" ? v.trim() !== "" && v !== "NA" : typeof v === "number";

/**
 * Sleeper ids are the master key. Sleeper's own database is missing ESPN and
 * nflverse ids for many established players, so the DynastyProcess crosswalk
 * fills those gaps; name + position + team is the last resort (CBS).
 */
export async function loadIdentity(): Promise<Identity> {
  const [sleeperRes, xwalkRes] = await Promise.all([
    cachedText("sleeper-players.json", SLEEPER_PLAYERS, 20, BULK_TIMEOUT_MS),
    cachedText("db_playerids.csv", CROSSWALK, 20, BULK_TIMEOUT_MS),
  ]);
  if (!sleeperRes.ok || !sleeperRes.data) {
    throw new Error(`Sleeper player database unavailable (${sleeperRes.error})`);
  }

  const raw = JSON.parse(sleeperRes.data) as Record<string, Record<string, unknown>>;
  const players = new Map<string, PlayerMeta>();
  const byEspn = new Map<string, string>();
  const byGsis = new Map<string, string>();
  const byCbs = new Map<string, string>();
  const byName = new Map<string, string[]>();

  for (const [id, p] of Object.entries(raw)) {
    if (present(p.espn_id)) byEspn.set(String(p.espn_id), id);
    if (present(p.gsis_id)) byGsis.set(String(p.gsis_id).trim(), id);
    const pos = String(p.position ?? "") as Pos;
    if (!POSITIONS.includes(pos)) continue;
    const name =
      (typeof p.full_name === "string" && p.full_name) ||
      `${String(p.first_name ?? "")} ${String(p.last_name ?? "")}`.trim();
    players.set(id, {
      id,
      name,
      pos,
      team: pos === "DEF" ? id : canonTeam(String(p.team ?? "FA")) || "FA",
      injury: typeof p.injury_status === "string" && p.injury_status ? p.injury_status : null,
      depth: typeof p.depth_chart_order === "number" ? p.depth_chart_order : null,
    });
    const key = `${normName(name)}|${pos}`;
    byName.set(key, [...(byName.get(key) ?? []), id]);
  }

  if (xwalkRes.ok && xwalkRes.data) {
    for (const row of parseCsv(xwalkRes.data)) {
      const sid = row.sleeper_id;
      if (!present(sid) || !players.has(sid)) continue;
      if (present(row.espn_id) && !byEspn.has(row.espn_id)) byEspn.set(row.espn_id, sid);
      if (present(row.gsis_id) && !byGsis.has(row.gsis_id)) byGsis.set(row.gsis_id, sid);
      if (present(row.cbs_id)) byCbs.set(row.cbs_id, sid);
    }
  } else {
    console.warn(`[identity] crosswalk unavailable (${xwalkRes.error}); using Sleeper ids and names only`);
  }

  function findByName(name: string, pos: Pos, team: string): string | null {
    const candidates = [
      ...new Set(nameVariants(name).flatMap((n) => byName.get(`${n}|${pos}`) ?? [])),
    ];
    if (candidates.length === 1) return candidates[0]!;
    const onTeam = candidates.filter((id) => players.get(id)?.team === canonTeam(team));
    return onTeam.length === 1 ? onTeam[0]! : null;
  }

  return { players, byEspn, byGsis, byCbs, findByName };
}
