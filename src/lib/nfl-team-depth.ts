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

import { SNAP_OBJECT_KEYS, snapCdnUrl, snapCdnPublicBase } from "@/lib/snap-cdn-public";
import { getCached } from "@/lib/sleeper-cache";

export type TeamDepthSlot = "QB" | "RB" | "WR1" | "WR2" | "WR3" | "TE" | "K";

export type TeamDepthEntry = {
  id: string;
  name: string;
  order: number;
  injury: string | null;
  /** Sleeper age when the snap includes it (v2+). */
  age?: number | null;
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

async function fetchSnapUrl(path: string): Promise<NflTeamDepthSnap | null> {
  const url = snapCdnUrl(path);
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

async function fetchSnap(): Promise<NflTeamDepthSnap | null> {
  // Prefer v2 (includes age); fall back to v1 until Actions republishes.
  return (
    (await fetchSnapUrl(SNAP_OBJECT_KEYS.nflTeamDepth())) ??
    (await fetchSnapUrl("snap/nfl-team-depth-v1.json"))
  );
}

/** Resolve shared depth board (IndexedDB + snap-cdn). */
export async function fetchNflTeamDepth(): Promise<NflTeamDepthSnap> {
  // Cache key aligns with snap object key (path bump for raw CDN).
  // Cache key bump when snap inclusion rules change (e.g. Inactive/IR on chart).
  return getCached("nfl-team-depth-snap-v2c", CLIENT_TTL_MS, async () => {
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
