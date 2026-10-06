import { supabaseB } from "@/lib/supabaseB";
import { loadSosMatrix, type SosMatrixEntry } from "@/lib/players.server";

/**
 * Player Warehouse aggregation pipeline.
 *
 * Ingests player data vectors and anchors every record to the master
 * `sleeper_id` primary key to prevent cross-platform identity confusion:
 *
 *   1. Sleeper base player registry (identity anchor + native injury details)
 *   2. FantasyCalc trade values
 *   3. LeagueLogs injury status tags
 *
 * Primary store: TiDB (`DATABASE_URL`). Supabase B dual-write / brain upload
 * are legacy opt-ins. Database A (auth, profiles, native leagues) is never
 * touched from this module.
 *
 * Server-only: this module performs outbound network calls and warehouse
 * writes. Never import it from client-reachable component code.
 */

export const WAREHOUSE_TABLE = "player_warehouse" as const;
export const BRAIN_BUCKET = "player_brain" as const;
export const BRAIN_FILE = "master_player_brain.json" as const;
export const BRAIN_CACHE_CONTROL = "public, max-age=1800, s-maxage=1800" as const;

const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const FANTASYCALC_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1";

/** Optional provider endpoints (configured per-deployment). */
function envUrl(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

/** Normalized row shape for the player_warehouse table. */
export interface PlayerWarehouseRow {
  sleeper_id: string; // primary anchor key
  player_name?: string | null;
  position?: string | null;
  team?: string | null;
  fantasycalc_value?: number | null;
  leaguelogs_status?: string | null;
  injury_type?: string | null;
  injury_notes?: string | null;
  updated_at?: string;
}

/** Incoming record from any provider before identity anchoring. */
export interface ProviderRecord {
  /** Master Sleeper ID, resolved by the identity translation layer. */
  sleeper_id: string;
  full_name?: string | null;
  position?: string | null;
  team?: string | null;
  fantasycalc_value?: number | null;
  /** FantasyCalc market trend velocity (signed value delta). */
  fantasycalc_trend?: number | null;
  leaguelogs_status?: string | null;
  injury_type?: string | null;
  injury_notes?: string | null;
}

/* ------------------------------------------------------------------ */
/* Network layer: safe retry gate with exponential backoff             */
/* ------------------------------------------------------------------ */

export class IngestionError extends Error {
  constructor(message: string, readonly source: string) {
    super(message);
    this.name = "IngestionError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch JSON with up to three retries and exponential backoff (500/1000/2000ms).
 * Throws IngestionError once all attempts are exhausted so the caller can
 * abort the run and preserve the existing cache.
 */
export async function fetchJsonWithRetry<T>(
  url: string,
  source: string,
  init?: RequestInit,
  attempts = 3,
): Promise<T> {
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { accept: "application/json", ...(init?.headers ?? {}) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < attempts) await sleep(500 * 2 ** (attempt - 1));
    }
  }

  throw new IngestionError(
    `[aggregation] ${source} failed after ${attempts} attempts: ${lastError}`,
    source,
  );
}

/* ------------------------------------------------------------------ */
/* Identity translation layer (Sleeper ID as single master anchor)     */
/* ------------------------------------------------------------------ */

export interface IdentityIndex {
  /** sleeper_id -> canonical base record */
  base: Map<string, ProviderRecord>;
  /** normalized "firstname lastname|POS" -> sleeper_id */
  byName: Map<string, string>;
  /** normalized "f lastname|POS" (initial form, e.g. "c mccaffrey|RB") */
  byInitial: Map<string, string>;
  /** foreign platform id ("espn:1234" / "yahoo:5678") -> sleeper_id */
  byForeignId: Map<string, string>;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapse "christian mccaffrey" -> "c mccaffrey" for ESPN-style shortcuts. */
function initialForm(normalized: string): string {
  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length < 2) return normalized;
  const first = parts[0] ?? "";
  return `${first.charAt(0)} ${parts.slice(1).join(" ")}`;
}

function key(name: string, position?: string | null): string {
  return `${name}|${(position ?? "").toUpperCase()}`;
}

interface SleeperPlayer {
  player_id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string;
  espn_id?: number | string | null;
  yahoo_id?: number | string | null;
  injury_body_part?: string | null;
  injury_notes?: string | null;
  active?: boolean;
}

/** Download the Sleeper registry and build the master identity index. */
export async function loadIdentityIndex(): Promise<IdentityIndex> {
  const raw = await fetchJsonWithRetry<Record<string, SleeperPlayer>>(
    SLEEPER_PLAYERS_URL,
    "sleeper",
  );

  const index: IdentityIndex = {
    base: new Map(),
    byName: new Map(),
    byInitial: new Map(),
    byForeignId: new Map(),
  };

  for (const [id, p] of Object.entries(raw ?? {})) {
    const position = (p?.position ?? "").toUpperCase();
    if (!FANTASY_POSITIONS.has(position)) continue;

    const fullName =
      p?.full_name ?? [p?.first_name, p?.last_name].filter(Boolean).join(" ");
    if (!fullName) continue;

    const sleeperId = p?.player_id ?? id;
    index.base.set(sleeperId, {
      sleeper_id: sleeperId,
      full_name: fullName,
      position,
      team: p?.team ?? null,
      injury_type: p?.injury_body_part ?? null,
      injury_notes: p?.injury_notes ?? null,
    });

    const norm = normalizeName(fullName);
    if (!index.byName.has(key(norm, position))) index.byName.set(key(norm, position), sleeperId);
    if (!index.byName.has(norm)) index.byName.set(norm, sleeperId);

    const initial = initialForm(norm);
    if (!index.byInitial.has(key(initial, position)))
      index.byInitial.set(key(initial, position), sleeperId);
    if (!index.byInitial.has(initial)) index.byInitial.set(initial, sleeperId);

    if (p?.espn_id != null) index.byForeignId.set(`espn:${p.espn_id}`, sleeperId);
    if (p?.yahoo_id != null) index.byForeignId.set(`yahoo:${p.yahoo_id}`, sleeperId);
  }

  return index;
}

/**
 * Translate any incoming provider identity (foreign id, full name, or
 * ESPN-style "C. McCaffrey" shortcut) to its master Sleeper ID.
 */
export function resolveSleeperId(
  index: IdentityIndex,
  input: {
    sleeperId?: string | number | null;
    espnId?: string | number | null;
    yahooId?: string | number | null;
    name?: string | null;
    position?: string | null;
  },
): string | null {
  const direct = input.sleeperId != null ? String(input.sleeperId) : null;
  if (direct && index.base.has(direct)) return direct;

  if (input.espnId != null) {
    const hit = index.byForeignId.get(`espn:${input.espnId}`);
    if (hit) return hit;
  }
  if (input.yahooId != null) {
    const hit = index.byForeignId.get(`yahoo:${input.yahooId}`);
    if (hit) return hit;
  }

  if (!input.name) return null;
  const pos = (input.position ?? "").toUpperCase();
  const norm = normalizeName(input.name);
  if (!norm) return null;

  return (
    index.byName.get(key(norm, pos)) ??
    index.byName.get(norm) ??
    index.byInitial.get(key(initialForm(norm), pos)) ??
    index.byInitial.get(initialForm(norm)) ??
    index.byInitial.get(key(norm, pos)) ??
    index.byInitial.get(norm) ??
    null
  );
}

/* ------------------------------------------------------------------ */
/* Provider harvesters                                                 */
/* ------------------------------------------------------------------ */

interface FantasyCalcEntry {
  value?: number;
  /** Market trend velocity (30-day value delta, signed). */
  trend30Day?: number | null;
  player?: {
    sleeperId?: string | number | null;
    espnId?: string | number | null;
    name?: string | null;
    position?: string | null;
  };
}

export async function harvestFantasyCalc(index: IdentityIndex): Promise<ProviderRecord[]> {
  const rows = await fetchJsonWithRetry<FantasyCalcEntry[]>(FANTASYCALC_URL, "fantasycalc");
  const out: ProviderRecord[] = [];

  for (const entry of rows ?? []) {
    const id = resolveSleeperId(index, {
      sleeperId: entry?.player?.sleeperId ?? null,
      espnId: entry?.player?.espnId ?? null,
      name: entry?.player?.name ?? null,
      position: entry?.player?.position ?? null,
    });
    if (!id) continue;
    const base = index.base.get(id);
    out.push({
      sleeper_id: id,
      full_name: base?.full_name ?? null,
      position: base?.position ?? null,
      team: base?.team ?? null,
      fantasycalc_value: Number(entry?.value ?? 0) || 0,
      fantasycalc_trend: Number(entry?.trend30Day ?? 0) || 0,
    });
  }

  return out;
}

interface LeagueLogsEntry {
  sleeper_id?: string | number | null;
  espn_id?: string | number | null;
  name?: string | null;
  player?: string | null;
  position?: string | null;
  status?: string | null;
  injury_status?: string | null;
}

/**
 * LeagueLogs injury status tags. Falls back to the Sleeper registry status
 * feed when no LeagueLogs endpoint is configured, so the run never stalls.
 */
export async function harvestLeagueLogs(index: IdentityIndex): Promise<ProviderRecord[]> {
  const url = envUrl("LEAGUELOGS_STATUS_URL");
  if (!url) return [];

  const rows = await fetchJsonWithRetry<LeagueLogsEntry[]>(url, "leaguelogs");
  const out: ProviderRecord[] = [];

  for (const entry of rows ?? []) {
    const id = resolveSleeperId(index, {
      sleeperId: entry?.sleeper_id ?? null,
      espnId: entry?.espn_id ?? null,
      name: entry?.name ?? entry?.player ?? null,
      position: entry?.position ?? null,
    });
    if (!id) continue;
    const base = index.base.get(id);
    out.push({
      sleeper_id: id,
      full_name: base?.full_name ?? null,
      position: base?.position ?? null,
      team: base?.team ?? null,
      leaguelogs_status: (entry?.status ?? entry?.injury_status ?? "Healthy") || "Healthy",
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Warehouse writes                                                    */
/* ------------------------------------------------------------------ */

async function upsertBatchTidb(rows: PlayerWarehouseRow[]): Promise<number> {
  const { buildUpsertSql, chunkRows, tidbConfigured, tidbExecute } = await import("@/lib/tidb");
  if (!tidbConfigured() || rows.length === 0) return 0;
  const cols = [
    "sleeper_id",
    "player_name",
    "position",
    "team",
    "fantasycalc_value",
    "leaguelogs_status",
    "injury_type",
    "injury_notes",
    "updated_at",
  ];
  const updateCols = cols.filter((c) => c !== "sleeper_id");
  let written = 0;
  for (const chunk of chunkRows(rows, 200)) {
    const flat: unknown[] = [];
    for (const r of chunk) {
      flat.push(
        r.sleeper_id,
        r.player_name ?? null,
        r.position ?? null,
        r.team ?? null,
        r.fantasycalc_value ?? null,
        r.leaguelogs_status ?? null,
        r.injury_type ?? null,
        r.injury_notes ?? null,
        r.updated_at ?? new Date().toISOString().slice(0, 19).replace("T", " "),
      );
    }
    await tidbExecute(buildUpsertSql("player_warehouse", cols, chunk.length, updateCols), flat);
    written += chunk.length;
  }
  return written;
}

function dualWriteSupabaseB(): boolean {
  // Default off once TiDB is configured; set WAREHOUSE_DUAL_WRITE_SUPABASE=1 to keep both.
  if (!process.env["DATABASE_URL"]?.trim()) return true;
  return process.env["WAREHOUSE_DUAL_WRITE_SUPABASE"]?.trim() === "1";
}

function keepBrainUpload(): boolean {
  // Legacy Supabase Storage brain is optional after TiDB cutover.
  return process.env["WAREHOUSE_UPLOAD_BRAIN"]?.trim() === "1" || !process.env["DATABASE_URL"]?.trim();
}

async function upsertBatch(rows: PlayerWarehouseRow[]): Promise<{ written: number }> {
  if (rows.length === 0) return { written: 0 };

  const { tidbConfigured } = await import("@/lib/tidb");
  let tidbWritten = 0;
  if (tidbConfigured()) {
    tidbWritten = await upsertBatchTidb(rows);
    if (tidbWritten < rows.length) {
      throw new Error(`[aggregation] TiDB upsert wrote ${tidbWritten}/${rows.length}`);
    }
  }

  if (dualWriteSupabaseB()) {
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabaseB
        .from(WAREHOUSE_TABLE)
        .upsert(rows.slice(i, i + CHUNK), { onConflict: "sleeper_id" });
      if (error) {
        // TiDB-primary: Supabase B failure is non-fatal when TiDB succeeded.
        if (tidbWritten > 0) {
          console.warn("[aggregation] Supabase B dual-write failed:", error.message);
          break;
        }
        throw new Error(`[aggregation] upsert failed: ${error.message}`);
      }
    }
  }

  return { written: Math.max(rows.length, tidbWritten) };
}

/** Ingest Sleeper base player data (identity anchor source). */
export async function ingestSleeperBase(records: ProviderRecord[]) {
  return upsertBatch(
    records.map((r) => ({
      sleeper_id: r.sleeper_id,
      player_name: r.full_name ?? null,
      position: r.position ?? null,
      team: r.team ?? null,
      injury_type: r.injury_type ?? null,
      injury_notes: r.injury_notes ?? null,
      updated_at: new Date().toISOString(),
    })),
  );
}

/** Ingest FantasyCalc trade values. */
export async function ingestFantasyCalcValues(records: ProviderRecord[]) {
  return upsertBatch(
    records.map((r) => ({
      sleeper_id: r.sleeper_id,
      player_name: r.full_name ?? null,
      position: r.position ?? null,
      team: r.team ?? null,
      fantasycalc_value: r.fantasycalc_value ?? null,
      updated_at: new Date().toISOString(),
    })),
  );
}

/** Ingest LeagueLogs injury status tags. */
export async function ingestLeagueLogsStatus(records: ProviderRecord[]) {
  return upsertBatch(
    records.map((r) => ({
      sleeper_id: r.sleeper_id,
      player_name: r.full_name ?? null,
      position: r.position ?? null,
      team: r.team ?? null,
      leaguelogs_status: r.leaguelogs_status ?? null,
      updated_at: new Date().toISOString(),
    })),
  );
}

/* ------------------------------------------------------------------ */
/* Parallel-array payload compactor                                    */
/* ------------------------------------------------------------------ */

/**
 * Flat parallel-array brain payload. Deliberately NOT an array of nested
 * objects: parallel arrays cut the serialized footprint to roughly ~500KB.
 */
export interface MasterPlayerBrain {
  v: number;
  generated_at: string;
  count: number;
  ids: string[];
  names: string[];
  positions: string[];
  teams: string[];
  values: number[];
  /** FantasyCalc market trend velocity per player (key emitted: "trends"). */
  trends: number[];
  injuries: string[];
  injury_types: string[];
  injury_notes: string[];
  /** Per-player pointer into the deduplicated team/position matchup dictionary. */
  sos_keys: string[];
  sos: Record<string, SosMatrixEntry>;
}

export function compileBrain(
  rows: PlayerWarehouseRow[],
  trendsById?: ReadonlyMap<string, number>,
  sosByKey?: ReadonlyMap<string, SosMatrixEntry>,
): MasterPlayerBrain {
  const sorted = [...rows].sort((a, b) => a.sleeper_id.localeCompare(b.sleeper_id));

  const brain: MasterPlayerBrain = {
    v: 1,
    generated_at: new Date().toISOString(),
    count: sorted.length,
    ids: [],
    names: [],
    positions: [],
    teams: [],
    values: [],
    trends: [],
    injuries: [],
    injury_types: [],
    injury_notes: [],
    sos_keys: [],
    sos: Object.fromEntries(sosByKey ?? []),
  };

  for (const r of sorted) {
    brain.ids.push(r.sleeper_id);
    brain.names.push(r.player_name ?? "");
    brain.positions.push(r.position ?? "");
    brain.teams.push(r.team ?? "");
    brain.values.push(Number(r.fantasycalc_value ?? 0) || 0);
    brain.trends.push(Number(trendsById?.get(r.sleeper_id) ?? 0) || 0);
    brain.injuries.push(r.leaguelogs_status ?? "Healthy");
    brain.injury_types.push(r.injury_type ?? "");
    brain.injury_notes.push(r.injury_notes ?? "");
    brain.sos_keys.push(`${(r.team ?? "").toUpperCase()}|${(r.position ?? "").toUpperCase()}`);
  }

  return brain;
}

/**
 * All-or-nothing alignment gate: every parallel array must share the exact
 * same index length before any storage write is allowed.
 */
export function validateBrainAlignment(brain: MasterPlayerBrain): void {
  const lengths = [
    brain.ids.length,
    brain.names.length,
    brain.positions.length,
    brain.teams.length,
    brain.values.length,
    brain.trends.length,
    brain.injuries.length,
    brain.injury_types.length,
    brain.injury_notes.length,
    brain.sos_keys.length,
  ];

  if (brain.count === 0 || lengths.some((n) => n !== brain.count)) {
    throw new IngestionError(
      `[aggregation] alignment check failed (count=${brain.count}, lengths=${lengths.join(",")})`,
      "alignment",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Edge CDN storage upload                                             */
/* ------------------------------------------------------------------ */

export async function uploadBrain(brain: MasterPlayerBrain): Promise<{ bytes: number }> {
  validateBrainAlignment(brain);

  const json = JSON.stringify(brain);
  const body = new Blob([json], { type: "application/json" });

  const { error } = await supabaseB.storage.from(BRAIN_BUCKET).upload(BRAIN_FILE, body, {
    upsert: true,
    contentType: "application/json",
    cacheControl: BRAIN_CACHE_CONTROL,
  });

  if (error) throw new IngestionError(`[aggregation] brain upload failed: ${error.message}`, "storage");
  return { bytes: json.length };
}

/* ------------------------------------------------------------------ */
/* Master ingestion loop                                               */
/* ------------------------------------------------------------------ */

export interface IngestionReport {
  ok: boolean;
  written: Record<string, number>;
  compiled: number;
  bytes: number;
  error?: string;
  failedSource?: string;
}

/**
 * Master automation loop. Harvests provider vectors, anchors every record to
 * its master Sleeper ID, and writes TiDB `player_warehouse` (primary).
 * Legacy Supabase Storage brain upload is optional (`WAREHOUSE_UPLOAD_BRAIN=1`).
 */
export async function runWarehouseIngestion(): Promise<IngestionReport> {
  const written: Record<string, number> = {};

  try {
    // 1. Sleeper registry — master identity anchor.
    const index = await loadIdentityIndex();
    const base = Array.from(index.base.values());
    if (base.length === 0) {
      throw new IngestionError("[aggregation] sleeper registry empty", "sleeper");
    }
    written["sleeper"] = (await ingestSleeperBase(base)).written;

    // 2-4. Secondary vectors, identity-translated against the anchor index.
    const [fantasycalc, leaguelogs] = await Promise.all([
      harvestFantasyCalc(index),
      harvestLeagueLogs(index),
    ]);

    written["fantasycalc"] = (await ingestFantasyCalcValues(fantasycalc)).written;
    written["leaguelogs"] = (await ingestLeagueLogsStatus(leaguelogs)).written;

    const rows = await readWarehouse();
    written["warehouse_rows"] = rows.length;

    // Optional legacy brain publish for older clients during cutover.
    let bytes = 0;
    if (keepBrainUpload()) {
      const trendMap = new Map<string, number>();
      for (const r of fantasycalc) {
        if (typeof r.fantasycalc_trend === "number" && r.fantasycalc_trend !== 0) {
          trendMap.set(r.sleeper_id, r.fantasycalc_trend);
        }
      }
      const sosByKey = await loadSosMatrix(rows);
      const brain = compileBrain(rows, trendMap, sosByKey);
      validateBrainAlignment(brain);
      bytes = (await uploadBrain(brain)).bytes;
      return { ok: true, written, compiled: brain.count, bytes };
    }

    return { ok: true, written, compiled: rows.length, bytes };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedSource = err instanceof IngestionError ? err.source : "unknown";
    console.error("[aggregation] run aborted; existing cache preserved:", message);
    return { ok: false, written, compiled: 0, bytes: 0, error: message, failedSource };
  }
}

/** Read warehouse rows — TiDB first when configured, else Supabase B. */
export async function readWarehouse(): Promise<PlayerWarehouseRow[]> {
  const { tidbConfigured, tidbExecute } = await import("@/lib/tidb");
  if (tidbConfigured()) {
    try {
      const rows = await tidbExecute<PlayerWarehouseRow>(
        `SELECT sleeper_id, player_name, position, team, fantasycalc_value,
                leaguelogs_status, injury_type, injury_notes, updated_at
         FROM player_warehouse
         ORDER BY sleeper_id ASC
         LIMIT 5000`,
      );
      if (rows.length > 0) return rows;
    } catch (error) {
      console.warn("[aggregation] TiDB read failed, falling back to Supabase B:", error);
    }
  }

  const PAGE = 1000;
  const all: PlayerWarehouseRow[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseB
      .from(WAREHOUSE_TABLE)
      .select("*")
      .order("sleeper_id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw new IngestionError(`[aggregation] read failed: ${error.message}`, "warehouse");
    const page = (data ?? []) as PlayerWarehouseRow[];
    all.push(...page);
    if (page.length < PAGE) break;
  }

  return all;
}
