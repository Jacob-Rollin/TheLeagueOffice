/**
 * Short-lived in-process memo for CDN data routes.
 * Coalesces concurrent isolate hits onto one upstream load (TiDB / Sleeper / ESPN).
 */

type Entry<T> = { at: number; value: Promise<T> };

const store = new Map<string, Entry<unknown>>();
const MAX = 80;

export function processMemo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && now - hit.at < ttlMs) return hit.value;

  if (store.size >= MAX) {
    for (const [k, v] of store) {
      if (now - v.at >= ttlMs) store.delete(k);
    }
    if (store.size >= MAX) {
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
  }

  const value = load().catch((err) => {
    if (store.get(key)?.value === value) store.delete(key);
    throw err;
  });
  store.set(key, { at: now, value });
  return value;
}
