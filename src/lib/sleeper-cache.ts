/**
 * Browser-side cache for Sleeper data.
 *
 * Every request originates from the visitor's own browser, so each user gets
 * their own Sleeper rate-limit pool instead of sharing one server IP. Records
 * live in IndexedDB when available and fall back to localStorage.
 */

const DB_NAME = "sleeper_player_catalog";
const STORE = "catalog_records";

type Record_<T> = { data: T; fetchedAt: number };

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function idbGet<T>(key: string): Promise<Record_<T> | null> {
  const db = await idb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Record_<T>) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet<T>(key: string, value: Record_<T>): Promise<boolean> {
  const db = await idb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await idb();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
  } catch {
    /* ignore */
  }
}

const lsKey = (key: string) => `sleeper-cache:${key}`;

function lsGet<T>(key: string): Record_<T> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(lsKey(key));
    return raw ? (JSON.parse(raw) as Record_<T>) : null;
  } catch {
    return null;
  }
}

function lsSet<T>(key: string, value: Record_<T>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(lsKey(key), JSON.stringify(value));
  } catch {
    /* quota exceeded — cache is best-effort */
  }
}

export async function readCache<T>(key: string): Promise<Record_<T> | null> {
  return (await idbGet<T>(key)) ?? lsGet<T>(key);
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  const record: Record_<T> = { data, fetchedAt: Date.now() };
  const ok = await idbSet(key, record);
  if (!ok) lsSet(key, record);
}

export async function clearCache(key: string): Promise<void> {
  await idbDelete(key);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(lsKey(key));
    } catch {
      /* ignore */
    }
  }
}

/** Cached fetch: fresh record wins, otherwise refetch, falling back to stale. */
export async function getCached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = await readCache<T>(key);
  if (hit && Date.now() - hit.fetchedAt < ttlMs) return hit.data;
  try {
    const fresh = await fetcher();
    await writeCache(key, fresh);
    return fresh;
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}
