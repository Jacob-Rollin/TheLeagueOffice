/**
 * Persist selected React Query caches to IndexedDB so research / matchup
 * boards paint last-good data on the next visit (FantasyPros-style SWR).
 *
 * Free-tier safe: no network — only restores client-side cache. Prefetch /
 * refetch still go through existing snap-cdn / soft-empty paths.
 */

import type { Query, QueryClient } from "@tanstack/react-query";
import localforage from "localforage";

const STORE_NAME = "rq_research_cache";
const BLOB_KEY = "dehydrated-v1";
const PERSIST_DEBOUNCE_MS = 1_200;
/** Research snaps — align with ~daily cron freshness. */
const RESEARCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Live boards — keep last-good scores across short navigations. */
const MATCHUP_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/** Query key[0] values we restore across visits. */
const PERSISTABLE = new Set([
  "fantasy-points-allowed",
  "sos-analysis",
  "matchups-guide",
  "fantasy-leaders",
  "red-zone-stats",
  "most-targeted-players",
  "injury-reports",
  "are-they-playing",
  "trade-market",
  "active-matchups",
]);

type PersistedEntry = {
  queryKey: readonly unknown[];
  data: unknown;
  dataUpdatedAt: number;
};

type PersistedBlob = {
  savedAt: number;
  entries: PersistedEntry[];
};

let store: LocalForage | null = null;

function db(): LocalForage | null {
  if (typeof window === "undefined") return null;
  if (!store) {
    store = localforage.createInstance({
      name: "player-brain-data-hub",
      storeName: STORE_NAME,
    });
  }
  return store;
}

function key0(queryKey: readonly unknown[]): string | null {
  const k = queryKey[0];
  return typeof k === "string" ? k : null;
}

function maxAgeFor(key: string): number {
  return key === "active-matchups" ? MATCHUP_MAX_AGE_MS : RESEARCH_MAX_AGE_MS;
}

function shouldPersistQuery(query: Query): boolean {
  const k = key0(query.queryKey);
  if (!k || !PERSISTABLE.has(k)) return false;
  if (query.state.status !== "success") return false;
  // Avoid persisting placeholderData (e.g. prior week shown under a new week key).
  if (query.state.fetchStatus !== "idle") return false;
  if (query.state.data === undefined) return false;
  // Skip empty soft-empty shells so we don't paint a blank "success" forever.
  if (isEmptyShell(k, query.state.data)) return false;
  return true;
}

function isEmptyShell(key: string, data: unknown): boolean {
  if (data == null) return true;
  if (typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  if (key === "active-matchups") {
    const entries = o["entries"];
    return !Array.isArray(entries) || entries.length === 0;
  }
  const rows = o["rows"];
  if (Array.isArray(rows) && rows.length === 0) return true;
  const items = o["items"];
  if (Array.isArray(items) && items.length === 0) return true;
  const lines = o["lines"];
  if (Array.isArray(lines) && lines.length === 0) return true;
  return false;
}

async function writeBlob(blob: PersistedBlob): Promise<void> {
  try {
    await db()?.setItem(BLOB_KEY, blob);
  } catch {
    /* quota / private mode */
  }
}

async function readBlob(): Promise<PersistedBlob | null> {
  try {
    return (await db()?.getItem<PersistedBlob>(BLOB_KEY)) ?? null;
  } catch {
    return null;
  }
}

function collectEntries(queryClient: QueryClient): PersistedEntry[] {
  const now = Date.now();
  const out: PersistedEntry[] = [];
  for (const query of queryClient.getQueryCache().getAll()) {
    if (!shouldPersistQuery(query)) continue;
    const k = key0(query.queryKey)!;
    const age = now - (query.state.dataUpdatedAt || 0);
    if (age > maxAgeFor(k)) continue;
    out.push({
      queryKey: query.queryKey,
      data: query.state.data,
      dataUpdatedAt: query.state.dataUpdatedAt,
    });
  }
  return out;
}

/**
 * Restore persisted research/matchup queries into the client before paint
 * consumers run. Safe to call once from the app shell.
 */
export async function hydrateResearchQueryCache(queryClient: QueryClient): Promise<void> {
  if (typeof window === "undefined") return;
  const blob = await readBlob();
  if (!blob?.entries?.length) return;
  const now = Date.now();
  for (const entry of blob.entries) {
    const k = key0(entry.queryKey);
    if (!k || !PERSISTABLE.has(k)) continue;
    if (now - entry.dataUpdatedAt > maxAgeFor(k)) continue;
    if (isEmptyShell(k, entry.data)) continue;
    // Don't clobber fresher in-memory data (idle prefetch may have won the race).
    const existing = queryClient.getQueryData(entry.queryKey);
    if (existing !== undefined) continue;
    queryClient.setQueryData(entry.queryKey, entry.data, {
      updatedAt: entry.dataUpdatedAt,
    });
  }
}

async function persistNow(queryClient: QueryClient): Promise<void> {
  const entries = collectEntries(queryClient);
  if (entries.length === 0) return;
  await writeBlob({ savedAt: Date.now(), entries });
}

/**
 * Debounced subscribe — writes IndexedDB after successful research/matchup updates.
 * Returns unsubscribe for effect cleanup.
 */
export function subscribeResearchQueryPersist(queryClient: QueryClient): () => void {
  if (typeof window === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void persistNow(queryClient);
    }, PERSIST_DEBOUNCE_MS);
  };

  const unsub = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" && event.type !== "added") return;
    const query = event.query;
    if (query && shouldPersistQuery(query)) schedule();
  });

  return () => {
    unsub();
    if (timer) clearTimeout(timer);
  };
}
