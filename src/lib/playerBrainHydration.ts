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
// Key suffix bumped to v5: stale timestamps from the FantasyPros payload era
// is ignored, so the next boot bypasses the 30-minute blockade and refetches.
const HEARTBEAT_KEY = "player-brain:last-sync:v5";
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
  ecr?: number[];
  sd?: number[];
  trends?: number[];
  injuries: string[];
  injury_types?: string[];
  injury_notes?: string[];
}

export interface BrainEntry {
  name: string;
  position: string;
  team: string;
  value: number;
  ecr: number;
  sd: number;
  /** 30-day FantasyCalc value trend (0 when unpublished). */
  trend: number;
  injuryStatus: string;
  /** Sleeper native `injury_body_part` (e.g. "Hamstring"). */
  injuryType: string;
  /** Sleeper native `injury_notes` free text. */
  injuryNotes: string;
}

export type BrainMatrix = Record<string, BrainEntry>;

const store = (() => {
  if (typeof window === "undefined") return null;
  try {
    return localforage.createInstance({ name: "master_player_analytics_db", storeName: "analytics_keyvaluepairs" });
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
      trend: brain.trends?.[i] ?? 0,
      injuryStatus: brain.injuries?.[i] ?? "Healthy",
      injuryType: brain.injury_types?.[i] ?? "",
      injuryNotes: brain.injury_notes?.[i] ?? "",
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

const LOCAL_PLAYERS_CACHE_KEY = "players-v1";

/**
 * Offline safety guard. When the storage bucket is empty or answers 400/404,
 * compile the matrix from the pre-existing local Sleeper player template so
 * the War Room, Trade Desk, and search inputs stay fully usable.
 */
async function localTemplateMatrix(): Promise<BrainMatrix | null> {
  try {
    const hit = await readCache<PlayersPayload>(LOCAL_PLAYERS_CACHE_KEY);
    const players = hit?.data?.players;
    if (!players || players.length === 0) return null;

    const matrix: BrainMatrix = {};
    for (const p of players) {
      if (!p?.id) continue;
      matrix[p.id] = {
        name: p.name ?? "",
        position: String(p.pos ?? ""),
        team: p.team ?? "",
        value: 0,
        ecr: p.rank?.ppr ?? 0,
        sd: 0,
        trend: 0,
        injuryStatus: p.injury ?? "Healthy",
        injuryType: "",
        injuryNotes: "",
      };
    }
    return Object.keys(matrix).length > 0 ? matrix : null;
  } catch {
    return null;
  }
}

/** Local-only resolution chain: compiled matrix, then local player template. */
async function localFallbackMatrix(): Promise<BrainMatrix | null> {
  return (await readBrainMatrix()) ?? (await localTemplateMatrix());
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
        return await localFallbackMatrix();
      }

      const url = brainUrl();
      if (!url) return await localFallbackMatrix();

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return await localFallbackMatrix();

      const brain = (await res.json()) as MasterPlayerBrainPayload;
      if (!Array.isArray(brain?.ids) || brain.ids.length === 0) return await localFallbackMatrix();

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
      return await localFallbackMatrix();
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
