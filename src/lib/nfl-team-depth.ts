/**
 * NFL team depth charts for the mobile player Team tab (Sleeper layout).
 *
 * Prefer snap-cdn (Actions → Sleeper `/v1/players/nfl`). Soft-empty on miss —
 * never Fluid, never per-visitor full players dump.
 *
 * WR rows map Sleeper `depth_chart_position`: LWR→WR1, RWR→WR2, SWR→WR3.
 * Columns are `depth_chart_order` within that slot (Starter / 2nd / 3rd).
 * Fullbacks slotted on the RB chart (position FB + depth RB) are included as RB.
 * Defense depth is intentionally omitted (fantasy offense only).
 */

import { R2_SNAP_KEYS, r2Url, snapCdnPublicBase } from "@/lib/r2-public";
import { getCached } from "@/lib/sleeper-cache";

export type TeamDepthSlot = "QB" | "RB" | "WR1" | "WR2" | "WR3" | "TE" | "K";

export type TeamDepthEntry = {
  id: string;
  name: string;
  order: number;
  injury: string | null;
};

export type TeamDepthChart = Partial<Record<TeamDepthSlot, TeamDepthEntry[]>>;

export type NflTeamDepthSnap = {
  updatedAt: string;
  source?: string;
  teams: Record<string, TeamDepthChart>;
};

const CLIENT_TTL_MS = 30 * 60 * 1000;

const EMPTY: NflTeamDepthSnap = {
  updatedAt: new Date(0).toISOString(),
  teams: {},
};

/** Sleeper depth_chart_position → Team tab row label. */
export const SLEEPER_WR_SLOT: Record<string, TeamDepthSlot> = {
  LWR: "WR1",
  RWR: "WR2",
  SWR: "WR3",
};

async function fetchSnap(): Promise<NflTeamDepthSnap | null> {
  const url = r2Url(R2_SNAP_KEYS.nflTeamDepth());
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as NflTeamDepthSnap;
    if (!json?.teams || typeof json.teams !== "object") return null;
    return json;
  } catch {
    return null;
  }
}

/** Resolve shared depth board (IndexedDB + snap-cdn). */
export async function fetchNflTeamDepth(): Promise<NflTeamDepthSnap> {
  // Cache key aligns with snap object key (path bump for raw CDN).
  return getCached("nfl-team-depth-snap-v1", CLIENT_TTL_MS, async () => {
    if (!snapCdnPublicBase()) return EMPTY;
    const snap = await fetchSnap();
    if (!snap || Object.keys(snap.teams).length === 0) return EMPTY;
    return {
      updatedAt: String(snap.updatedAt || new Date().toISOString()),
      source: snap.source,
      teams: snap.teams,
    };
  });
}

export function teamDepthFor(
  board: NflTeamDepthSnap | null | undefined,
  team: string | null | undefined,
): TeamDepthChart | null {
  const abbr = String(team ?? "")
    .trim()
    .toUpperCase();
  if (!abbr || abbr === "FA") return null;
  const hit = board?.teams?.[abbr] ?? board?.teams?.[abbr === "WAS" ? "WSH" : abbr];
  return hit && Object.keys(hit).length > 0 ? hit : null;
}
