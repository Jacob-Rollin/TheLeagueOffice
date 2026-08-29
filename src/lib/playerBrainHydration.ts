/**
 * Client-side master player brain hydration.
 *
 * Silent, background-only parallel track: downloads the compiled
 * `master_player_brain.json` payload from the Database B public storage
 * bucket at most once every 30 minutes, compiles the parallel arrays into a
 * key-value lookup dictionary, and stores that dictionary in IndexedDB via
 * localforage.
 *
 * This module deliberately does NOT feed the War Room, Trade Desk, Waiver
 * Evaluator, or global search — those keep reading from their existing
 * Sleeper-backed caches.
 */

import localforage from "localforage";

import type { PlayersPayload } from "@/lib/players-build";
import { readCache } from "@/lib/sleeper-cache";

const BUCKET = "player_brain";
const FILE = "master_player_brain.json";
const HEARTBEAT_KEY = "player-brain:last-sync";
const MATRIX_KEY = "player-brain:matrix";
const META_KEY = "player-brain:meta";
const HEARTBEAT_MS = 30 * 60 * 1000;

export interface MasterPlayerBrainPayload {
  v: number;
  generated_at: string;
  count: number;
  ids: string[];
  names: string[];
  positions: string[];
  teams: string[];
  values: number[];
  ecr: number[];
  sd: number[];
  injuries: string[];
}

export interface BrainEntry {
  name: string;
  position: string;
  team: string;
  value: number;
  ecr: number;
  sd: number;
  injuryStatus: string;
}

export type BrainMatrix = Record<string, BrainEntry>;

const store = (() => {
  if (typeof window === "undefined") return null;
  try {
    return localforage.createInstance({ name: "league-office", storeName: "player_brain" });
  } catch {
    return null;
  }
})();

function brainUrl(): string | null {
  const raw = import.meta.env["VITE_SUPABASE_URL_B"] as string | undefined;
  if (!raw) return null;
  const origin = raw.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
  return `${origin}/storage/v1/object/public/${BUCKET}/${FILE}`;
}

/** True when the 30-minute heartbeat has expired (i.e. a download is allowed). */
export function heartbeatCleared(now = Date.now()): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    const raw = localStorage.getItem(HEARTBEAT_KEY);
    if (!raw) return true;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return now - last >= HEARTBEAT_MS;
  } catch {
    return true;
  }
}

function stampHeartbeat(now = Date.now()): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(HEARTBEAT_KEY, String(now));
  } catch {
    /* best-effort */
  }
}

/** Single-pass parallel-array -> dictionary map compiler. */
export function compileMatrix(brain: MasterPlayerBrainPayload): BrainMatrix {
  const matrix: BrainMatrix = {};
  const n = brain.ids?.length ?? 0;
  for (let i = 0; i < n; i += 1) {
    const id = brain.ids[i];
    if (!id) continue;
    matrix[id] = {
      name: brain.names?.[i] ?? "",
      position: brain.positions?.[i] ?? "",
      team: brain.teams?.[i] ?? "",
      value: brain.values?.[i] ?? 0,
      ecr: brain.ecr?.[i] ?? 0,
      sd: brain.sd?.[i] ?? 0,
      injuryStatus: brain.injuries?.[i] ?? "Healthy",
    };
  }
  return matrix;
}

/** Read the locally compiled dictionary without touching the network. */
export async function readBrainMatrix(): Promise<BrainMatrix | null> {
  if (!store) return null;
  try {
    return (await store.getItem<BrainMatrix>(MATRIX_KEY)) ?? null;
  } catch {
    return null;
  }
}

let inFlight: Promise<BrainMatrix | null> | null = null;

/**
 * Background hydration entry point. Resolves to the local matrix; performs a
 * network download only when the 30-minute heartbeat has cleared.
 */
export function hydratePlayerBrain(options?: { force?: boolean }): Promise<BrainMatrix | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      if (!options?.force && !heartbeatCleared()) {
        // Egress guard: serve entirely from local memory.
        return await readBrainMatrix();
      }

      const url = brainUrl();
      if (!url) return await readBrainMatrix();

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return await readBrainMatrix();

      const brain = (await res.json()) as MasterPlayerBrainPayload;
      if (!Array.isArray(brain?.ids) || brain.ids.length === 0) return await readBrainMatrix();

      const matrix = compileMatrix(brain);
      if (store) {
        await store.setItem(MATRIX_KEY, matrix);
        await store.setItem(META_KEY, {
          v: brain.v,
          count: brain.count,
          generated_at: brain.generated_at,
          storedAt: Date.now(),
        });
      }
      stampHeartbeat();
      return matrix;
    } catch {
      // Silent by design — never surfaces to the UI.
      return await readBrainMatrix();
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
