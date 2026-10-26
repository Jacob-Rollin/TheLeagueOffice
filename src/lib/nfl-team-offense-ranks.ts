/**
 * NFL team offense ranks for the mobile player Team tab.
 *
 * Prefer snap-cdn (Actions → Sleeper TEAM_* season stats, ranked to match the
 * Sleeper app chips). Soft-empty on miss — never Fluid, never per-visitor
 * ESPN/Sleeper fan-out.
 *
 * Chip sets are position-scoped: QB pass / RB rush / WR-TE receiving.
 */

import { SNAP_OBJECT_KEYS, snapCdnUrl, snapCdnPublicBase } from "@/lib/snap-cdn-public";
import { getCached } from "@/lib/sleeper-cache";

export type TeamOffenseRankKey =
  | "offense"
  | "passAtt"
  | "passYd"
  | "passTd"
  | "rushAtt"
  | "rushYd"
  | "rushTd"
  | "recTgt"
  | "recYd"
  | "recTd"
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

export type TeamRankChipMeta = { key: TeamOffenseRankKey; label: string };

/** Sleeper-style Team Rank chips for the position being viewed. */
export function teamRankChipsForPos(pos: string | null | undefined): TeamRankChipMeta[] {
  const p = String(pos ?? "")
    .trim()
    .toUpperCase();
  if (p === "QB") {
    return [
      { key: "offense", label: "Offense" },
      { key: "passAtt", label: "Pass Att" },
      { key: "passYd", label: "Pass Yd" },
      { key: "passTd", label: "Pass TD" },
      { key: "td", label: "TD" },
      { key: "rz", label: "RZ" },
    ];
  }
  if (p === "RB") {
    return [
      { key: "offense", label: "Offense" },
      { key: "rushYd", label: "Rush Yd" },
      { key: "rushAtt", label: "Rush Att" },
      { key: "rushTd", label: "Rush TD" },
      { key: "td", label: "TD" },
      { key: "rz", label: "RZ" },
    ];
  }
  if (p === "WR" || p === "TE") {
    return [
      { key: "offense", label: "Offense" },
      { key: "recYd", label: "Rec Yd" },
      { key: "recTgt", label: "Tgt" },
      { key: "recTd", label: "Rec TD" },
      { key: "td", label: "TD" },
      { key: "rz", label: "RZ" },
    ];
  }
  // K / DEF / unknown — overall offense context only.
  return [
    { key: "offense", label: "Offense" },
    { key: "td", label: "TD" },
    { key: "rz", label: "RZ" },
  ];
}

const CLIENT_TTL_MS = 30 * 60 * 1000;

const EMPTY: NflTeamOffenseRanksSnap = {
  season: "",
  updatedAt: new Date(0).toISOString(),
  teams: {},
};

async function fetchSnap(season: string): Promise<NflTeamOffenseRanksSnap | null> {
  const path = SNAP_OBJECT_KEYS.nflTeamOffenseRanks(season);
  const url = snapCdnUrl(path);
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
  // v5: pass + rush + rec TEAM_* chips for position-scoped Team Rank UI.
  return getCached(`nfl-team-offense-ranks-v5:${safeSeason}`, CLIENT_TTL_MS, async () => {
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
