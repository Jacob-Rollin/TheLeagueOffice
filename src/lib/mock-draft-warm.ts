/**
 * Prefetch mock-draft client caches (Sleeper catalog + season board extras).
 *
 * Mirrors the desktop mock-draft data path: browser → IndexedDB day-cache via
 * `getCached` / `loadPlayersCatalog` — no Fluid, shared in-flight dedupe, and
 * the soft Sleeper rate budget already applied inside players-build fetches.
 */
import { loadPlayersCatalog } from "@/lib/players-catalog";
import { fetchSeasonProjectedBoardExtras } from "@/lib/sleeper-client";

let warmPromise: Promise<{ season: string }> | null = null;

/**
 * Warm the players-v4 day-cache and season projection board extras.
 * Safe to call from home, splash, or setup — concurrent callers share one run.
 */
export function warmMockDraftClientCaches(options?: {
  /** When known (e.g. from a prior catalog hit); otherwise taken from catalog. */
  season?: string;
}): Promise<{ season: string }> {
  if (!warmPromise) {
    warmPromise = (async () => {
      const catalog = await loadPlayersCatalog();
      const season = (options?.season || catalog.season || "").trim();
      if (/^\d{4}$/.test(season)) {
        // Soft-empty on failure — board still works without weekly overlays.
        await fetchSeasonProjectedBoardExtras(season).catch(() => ({}));
      }
      return { season: catalog.season || season };
    })().catch((err) => {
      warmPromise = null;
      throw err;
    });
  }
  return warmPromise;
}

/** Fire-and-forget warm for idle / hover prefetch (never throws to callers). */
export function prefetchMockDraftClientCaches(options?: { season?: string }): void {
  void warmMockDraftClientCaches(options).catch(() => {
    /* splash / session hooks own retry */
  });
}
