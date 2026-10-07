/**
 * Browser → Sleeper research ownership / start rates (api.sleeper.com).
 * Shared IndexedDB map so mobile + desktop player sheets do not re-download
 * the full research payload per open.
 */

import { getCached } from "@/lib/sleeper-cache";
import { sleeperFetchJson } from "@/lib/sleeper-http";
import { fetchNflStateClient } from "@/lib/sleeper-client";

const RESEARCH = "https://api.sleeper.com";
const OWNERSHIP_TTL_MS = 6 * 60 * 60 * 1000;

export type SleeperOwnership = { owned: number; started: number };

type OwnershipRecord = Record<string, SleeperOwnership>;

async function loadOwnershipRecord(
  seasonType: string,
  season: string,
  week: number,
): Promise<OwnershipRecord> {
  const json = await sleeperFetchJson<Record<string, { owned?: number; started?: number }>>(
    `${RESEARCH}/players/nfl/research/${seasonType}/${season}/${week}`,
    "warm",
  );
  const out: OwnershipRecord = {};
  if (!json || typeof json !== "object") return out;
  for (const [id, row] of Object.entries(json)) {
    if (!row) continue;
    const owned = Number(row.owned);
    const started = Number(row.started);
    out[id] = {
      owned: Number.isFinite(owned) ? Math.round(owned) : 0,
      started: Number.isFinite(started) ? Math.round(started) : 0,
    };
  }
  return out;
}

/** Current-week Sleeper owned/started % map (shared across player popups). */
export async function fetchSleeperOwnershipMapClient(): Promise<Map<string, SleeperOwnership>> {
  const record = await getCached<OwnershipRecord>("sleeper-ownership-research-v1", OWNERSHIP_TTL_MS, async () => {
    const state = await fetchNflStateClient().catch(() => null);
    const season = state?.season ?? String(new Date().getUTCFullYear());
    const week = Math.max(1, Number(state?.week) || 1);
    let map = await loadOwnershipRecord("regular", season, week);
    if (Object.keys(map).length === 0 && week > 1) {
      map = await loadOwnershipRecord("regular", season, week - 1);
    }
    return map;
  });
  return new Map(Object.entries(record ?? {}));
}

export async function ownershipForPlayerClient(
  playerId: string,
): Promise<SleeperOwnership | null> {
  const clean = String(playerId ?? "").trim();
  if (!clean) return null;
  const map = await fetchSleeperOwnershipMapClient().catch(() => null);
  if (!map) return null;
  return map.get(clean) ?? { owned: 0, started: 0 };
}
