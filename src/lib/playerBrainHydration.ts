/**
 * Client-side player matrix hydration.
 *
 * Prefers the CDN-cached TiDB export (`/api/data/players-export`). Falls back
 * to the legacy Supabase Storage `master_player_brain.json` only when TiDB is
 * not seeded yet. Stores the dictionary in IndexedDB via localforage.
 *
 * This module deliberately does NOT feed the War Room, Trade Desk, Waiver
 * Evaluator, or global search — those keep reading from their existing
 * Sleeper-backed caches.
 */

import localforage from "localforage";

import type { PlayersPayload } from "@/lib/players-build";
import { fetchResearchSosBoard } from "@/lib/research-cdn";
import type { SosBoard } from "@/lib/players.server";
import type { PlayerSos, SosMatchup } from "@/lib/sos-presentation";
import { readCache } from "@/lib/sleeper-cache";

const BUCKET = "player_brain";
const FILE = "master_player_brain.json";
// Schema-versioned heartbeat forces one refresh when synchronized fields expand.
const HEARTBEAT_KEY = "player-brain:last-sync:v7-tidb";
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
  sos_keys?: string[];
  sos?: Record<string, {
    rank: number | null;
    opponents: { week: number; opp: string; rank: number | null; pointsAllowed: number | null }[];
  }>;
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
  sos: PlayerSos | null;
}

export type BrainMatrix = Record<string, BrainEntry>;

const store = (() => {
  if (typeof window === "undefined") return null;
  try {
    // 🟢 THE FIX: Change the name namespace to prevent IndexedDB cache drop collisions
    return localforage.createInstance({ name: "player-brain-data-hub", storeName: "brain_matrix_warehouse" });
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
    const sosKey = brain.sos_keys?.[i] ?? "";
    const sos = sosKey ? brain.sos?.[sosKey] : undefined;
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
      sos: sos
        ? {
            rank: sos.rank,
            matchups: sos.opponents.map((opponent) => ({
              week: opponent.week,
              opp: opponent.opp,
              rank: opponent.rank,
              pointsAllowed: opponent.pointsAllowed,
            })),
          }
        : null,
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

/** Must match useSleeperPlayers / players-catalog (`players-v3`). */
const LOCAL_PLAYERS_CACHE_KEY = "players-v3";

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
        sos: null,
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

const SOS_REFRESH_MS = 30 * 60 * 1000;
let sosBoardCache: { at: number; value: Promise<SosBoard | null> } | null = null;

function freshSosBoard(): Promise<SosBoard | null> {
  const now = Date.now();
  if (!sosBoardCache || now - sosBoardCache.at > SOS_REFRESH_MS) {
    sosBoardCache = {
      at: now,
      value: fetchResearchSosBoard()
        .then((board) => board as SosBoard | null)
        .catch(() => null),
    };
  }
  return sosBoardCache.value;
}

function sosPosKey(position: string): string {
  const p = (position || "").trim().toUpperCase();
  return p === "DST" ? "DEF" : p;
}

/**
 * The published brain's SOS is a one-time snapshot, so rebuild every entry's SOS from the
 * live positional board and the player's current NFL team on each hydration.
 */
async function withFreshSos(matrix: BrainMatrix | null): Promise<BrainMatrix | null> {
  if (!matrix) return matrix;
  const board = await freshSosBoard();
  if (!board || board.schedule.length === 0) return matrix;

  const teamById = new Map<string, string>();
  try {
    const hit = await readCache<PlayersPayload>(LOCAL_PLAYERS_CACHE_KEY);
    for (const p of hit?.data?.players ?? []) {
      if (p?.id && p.team) teamById.set(p.id, p.team);
    }
  } catch {
    /* fall back to brain teams */
  }

  const gamesByTeam = new Map<string, { week: number; opp: string }[]>();
  for (const [week, home, away] of board.schedule) {
    gamesByTeam.set(home, [...(gamesByTeam.get(home) ?? []), { week, opp: away }]);
    gamesByTeam.set(away, [...(gamesByTeam.get(away) ?? []), { week, opp: home }]);
  }

  const built = new Map<string, PlayerSos | null>();
  const sosFor = (team: string, pos: string): PlayerSos | null => {
    const key = `${team}|${pos}`;
    if (built.has(key)) return built.get(key)!;
    const ranks = board.ranks[pos];
    const games = gamesByTeam.get(team);
    let sos: PlayerSos | null = null;
    if (ranks && games?.length) {
      const matchups: SosMatchup[] = [...games]
        .sort((a, b) => a.week - b.week)
        .map((g) => ({
          week: g.week,
          opp: g.opp,
          rank: ranks[g.opp]?.[0] ?? null,
          pointsAllowed: ranks[g.opp]?.[1] ?? null,
        }));
      const known = matchups.map((m) => m.rank).filter((r): r is number => r != null);
      sos = {
        rank: known.length ? Math.round(known.reduce((s, r) => s + r, 0) / known.length) : null,
        matchups,
      };
    }
    built.set(key, sos);
    return sos;
  };

  const out: BrainMatrix = {};
  for (const [id, entry] of Object.entries(matrix)) {
    const team = (teamById.get(id) ?? entry.team ?? "").trim().toUpperCase();
    const pos = sosPosKey(entry.position);
    if (!board.ranks[pos]) {
      out[id] = entry;
      continue;
    }
    out[id] = { ...entry, sos: team && team !== "FA" ? sosFor(team, pos) : null };
  }
  return out;
}

let inFlight: Promise<BrainMatrix | null> | null = null;

/**
 * Background hydration entry point. Resolves to the local matrix; performs a
 * network download only when the 30-minute heartbeat has cleared.
 */
export function hydratePlayerBrain(options?: { force?: boolean }): Promise<BrainMatrix | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (inFlight) return inFlight;

  inFlight = (async () => withFreshSos(await loadBrainMatrix(options)))().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Prefer CDN-cached TiDB warehouse export over Supabase brain download when seeded. */
async function loadTidbWarehouseMatrix(): Promise<BrainMatrix | null> {
  try {
    const res = await fetch("/api/data/players-export", {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const brain = (await res.json()) as MasterPlayerBrainPayload & { ok?: boolean };
    if (!brain.ok || !Array.isArray(brain.ids) || brain.ids.length < 100) return null;
    return compileMatrix(brain);
  } catch {
    return null;
  }
}

async function loadBrainMatrix(options?: { force?: boolean }): Promise<BrainMatrix | null> {
  try {
    if (!options?.force && !heartbeatCleared()) {
      // Egress guard: serve entirely from local memory.
      return await localFallbackMatrix();
    }

    // Phase 3: stream warehouse rows from TiDB-backed API when seeded.
    const tidbMatrix = await loadTidbWarehouseMatrix();
    if (tidbMatrix) {
      if (store) {
        await store.setItem(MATRIX_KEY, tidbMatrix);
        await store.setItem(META_KEY, {
          v: 7,
          count: Object.keys(tidbMatrix).length,
          generated_at: new Date().toISOString(),
          storedAt: Date.now(),
          source: "tidb",
        });
      }
      stampHeartbeat();
      return tidbMatrix;
    }

    // Legacy fallback: Supabase Storage brain (removed from request path once TiDB is seeded).
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
  }
}
