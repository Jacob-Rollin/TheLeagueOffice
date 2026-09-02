/**
 * Bandwidth guard for synced roster hydration.
 *
 * Rosters are cached in IndexedDB (localforage) so the team page paints
 * instantly on mount, and every background revalidation must clear a hard
 * 5-minute barrier before a network request is allowed. This keeps host API
 * limits, Supabase bandwidth and database connections from being exhausted
 * by rapid navigation between rival team pages.
 */
import localforage from "localforage";

export const REVALIDATE_MS = 300_000;

let store: LocalForage | null = null;

function db(): LocalForage | null {
  if (typeof window === "undefined") return null;
  if (!store) {
    store = localforage.createInstance({
      name: "player-brain-data-hub",
      storeName: "league_roster_cache",
    });
  }
  return store;
}

const stampKey = (key: string) => `league:team-sync:last-checked:${key}`;

/** True when the 5-minute barrier has elapsed for this cache key. */
export function shouldRevalidate(key: string): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    const raw = localStorage.getItem(stampKey(key));
    if (!raw) return true;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= REVALIDATE_MS;
  } catch {
    return true;
  }
}

/** Record a successful background sync for this cache key. */
export function markRevalidated(key: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(stampKey(key), String(Date.now()));
  } catch {
    /* best-effort */
  }
}

export async function readRosterCache<T>(key: string): Promise<T | null> {
  try {
    return (await db()?.getItem<T>(key)) ?? null;
  } catch {
    return null;
  }
}

export async function writeRosterCache<T>(key: string, value: T): Promise<void> {
  try {
    await db()?.setItem(key, value);
  } catch {
    /* quota / private mode — cache is best-effort */
  }
}
