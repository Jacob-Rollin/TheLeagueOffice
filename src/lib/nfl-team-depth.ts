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

import { isUnavailableInjury } from "@/lib/injury-badge";
import { SNAP_OBJECT_KEYS, snapCdnUrl, snapCdnPublicBase } from "@/lib/snap-cdn-public";
import { getCached } from "@/lib/sleeper-cache";

export { isUnavailableInjury as isDepthChartDesignated };

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
  // Prefer v3 (deeper benches); fall back until Actions republishes.
  return (
    (await fetchSnapUrl(SNAP_OBJECT_KEYS.nflTeamDepth())) ??
    (await fetchSnapUrl("snap/nfl-team-depth-v2.json")) ??
    (await fetchSnapUrl("snap/nfl-team-depth-v1.json"))
  );
}

/**
 * Keep designated Out/IR/etc. visible in a fixed-width (Starter/2nd/3rd) row.
 * Snap rows stay in order; missing designated teammates replace the last
 * healthy backup when the row is already full (never replaces the starter).
 */
export function promoteDesignatedOntoDepthRow<T extends { id: string }>(
  rows: T[],
  extras: T[],
  isDesignated: (row: T) => boolean,
  max = 3,
): T[] {
  const seen = new Set(rows.map((r) => r.id));
  const combined = [...rows];
  for (const extra of extras) {
    if (seen.has(extra.id)) continue;
    seen.add(extra.id);
    combined.push(extra);
  }
  if (combined.length <= max) return combined;
  for (let i = max; i < combined.length; i += 1) {
    const overflow = combined[i]!;
    if (!isDesignated(overflow)) continue;
    // Replace the last visible slot only — never the starter, keep 2nd string
    // stable when promoting a midweek Out/IR reshuffle into the board.
    const victim = max - 1;
    if (victim < 1) break;
    const tmp = combined[victim]!;
    combined[victim] = overflow;
    combined[i] = tmp;
  }
  return combined.slice(0, max);
}

/** Resolve shared depth board (IndexedDB + snap-cdn). */
export async function fetchNflTeamDepth(): Promise<NflTeamDepthSnap> {
  // Cache key bump with snap object path (v3 keeps more depth rows + Out/IR).
  return getCached("nfl-team-depth-snap-v3", CLIENT_TTL_MS, async () => {
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
