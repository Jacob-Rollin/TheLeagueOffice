/**
 * Browser-side memo for ESPN (and Yahoo) Fluid createServerFn pulls.
 *
 * Sleeper browse uses visitor→api.sleeper.app; ESPN still needs Fluid for
 * espn_s2/SWID cookies. Without this, swapping to an ESPN league and clicking
 * Dashboard → Matchup → My Team re-fires standings/rosters/settings Fluid on
 * every mount even when React Query keys briefly miss.
 *
 * Survives SPA navigations (module scope). Concurrent callers share one inflight.
 */

type Entry<T> = { at: number; value: Promise<T> };

const store = new Map<string, Entry<unknown>>();
const MAX = 48;

/** Default: long enough to cover a playbook click-through without going stale in-game. */
export const ESPN_FLUID_TTL_MS = 4 * 60 * 1000;
export const ESPN_FLUID_SETTINGS_TTL_MS = 30 * 60 * 1000;
export const ESPN_FLUID_STANDINGS_TTL_MS = 10 * 60 * 1000;

function prune(now: number, ttlMs: number) {
  if (store.size < MAX) return;
  for (const [k, v] of store) {
    if (now - v.at >= ttlMs) store.delete(k);
  }
  if (store.size < MAX) return;
  const oldest = store.keys().next().value;
  if (oldest !== undefined) store.delete(oldest);
}

export function espnFluidMemo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && now - hit.at < ttlMs) return hit.value;

  prune(now, ttlMs);

  const value = load().catch((err) => {
    if (store.get(key)?.value === value) store.delete(key);
    throw err;
  });
  store.set(key, { at: now, value });
  return value;
}

export function espnFluidCacheKey(
  kind: string,
  leagueId: string,
  platform: string,
  extra = "",
): string {
  return `${kind}|${platform}|${leagueId}|${extra}`;
}
