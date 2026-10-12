/**
 * NFL team offense ranks for the mobile player Team tab.
 *
 * Prefer snap-cdn (Actions → Sleeper TEAM_* season stats, ranked to match the
 * Sleeper app chips). Soft-empty on miss — never Fluid, never per-visitor
 * ESPN/Sleeper fan-out.
 */

import { R2_SNAP_KEYS, r2Url, snapCdnPublicBase } from "@/lib/r2-public";
import { getCached } from "@/lib/sleeper-cache";

export type TeamOffenseRankKey =
  | "offense"
  | "passAtt"
  | "passYd"
  | "passTd"
  | "td"
  | "rz"
  | "rzPct";

export type TeamOffenseRanks = Partial<Record<TeamOffenseRankKey, number>>;

export type NflTeamOffenseRanksSnap = {
  season: number | string;
  updatedAt: string;
  source?: string;
  teams: Record<string, TeamOffenseRanks>;
};

const CLIENT_TTL_MS = 30 * 60 * 1000;

const EMPTY: NflTeamOffenseRanksSnap = {
  season: "",
  updatedAt: new Date(0).toISOString(),
  teams: {},
};

async function fetchSnap(season: string): Promise<NflTeamOffenseRanksSnap | null> {
  const path = R2_SNAP_KEYS.nflTeamOffenseRanks(season);
  const url = r2Url(path);
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as NflTeamOffenseRanksSnap;
    if (!json?.teams || typeof json.teams !== "object") return null;
    return json;
  } catch {
    return null;
  }
}

/** Resolve season ranks board (shared IndexedDB + snap-cdn). */
export async function fetchNflTeamOffenseRanks(
  season: string | number,
): Promise<NflTeamOffenseRanksSnap> {
  const safeSeason = String(season || new Date().getUTCFullYear());
  // v3: Sleeper TEAM_* ranks (replaces ESPN vendor ordinals).
  return getCached(`nfl-team-offense-ranks-v3:${safeSeason}`, CLIENT_TTL_MS, async () => {
    if (!snapCdnPublicBase()) return EMPTY;
    const snap = await fetchSnap(safeSeason);
    if (!snap || Object.keys(snap.teams).length === 0) return EMPTY;
    return {
      season: snap.season || safeSeason,
      updatedAt: String(snap.updatedAt || new Date().toISOString()),
      source: snap.source,
      teams: snap.teams,
    };
  });
}

export function teamOffenseRanksFor(
  board: NflTeamOffenseRanksSnap | null | undefined,
  team: string | null | undefined,
): TeamOffenseRanks | null {
  const abbr = String(team ?? "")
    .trim()
    .toUpperCase();
  if (!abbr || abbr === "FA") return null;
  const hit = board?.teams?.[abbr] ?? board?.teams?.[abbr === "WAS" ? "WSH" : abbr];
  return hit && Object.keys(hit).length > 0 ? hit : null;
}
