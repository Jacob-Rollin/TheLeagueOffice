/**
 * Free-tier-safe warm for player popups (desktop + mobile).
 *
 * Prefetches the shared `["player", id, "client-v1"]` React Query entry using
 * brain + browser catalog/Sleeper only. Never calls Fluid `getPlayerDetail`
 * (production soft-empty path stays intact when the modal opens).
 */

import type { QueryClient } from "@tanstack/react-query";

import { fetchPlayerDetailClient } from "@/lib/player-detail-client";
import { hydratePlayerBrain } from "@/lib/playerBrainHydration";

export const PLAYER_DETAIL_QUERY_KEY = (id: string) => ["player", id, "client-v1"] as const;
export const PLAYER_DETAIL_STALE_MS = 1000 * 60 * 30;

const inflight = new Set<string>();
const MAX_INFLIGHT = 2;

let boundClient: QueryClient | null = null;

/** Call once from the app shell with the root QueryClient. */
export function registerPlayerDetailQueryClient(client: QueryClient) {
  boundClient = client;
}

function canPrefetchId(id: string | null | undefined): id is string {
  return Boolean(id && !id.startsWith("espn:"));
}

/** Client-only load — used by prefetch (never Fluid). */
export async function loadPlayerDetailClientOnly(id: string) {
  const brain = await hydratePlayerBrain().catch(() => null);
  return fetchPlayerDetailClient(id, brain);
}

/**
 * Warm popup detail for `id`. No-ops if already cached, capped concurrency,
 * or QueryClient not registered yet.
 */
export function prefetchPlayerDetail(id: string | null | undefined, client?: QueryClient) {
  if (!canPrefetchId(id)) return;
  const qc = client ?? boundClient;
  if (!qc) return;
  if (qc.getQueryData(PLAYER_DETAIL_QUERY_KEY(id))) return;
  if (inflight.has(id) || inflight.size >= MAX_INFLIGHT) return;

  inflight.add(id);
  void qc
    .prefetchQuery({
      queryKey: PLAYER_DETAIL_QUERY_KEY(id),
      staleTime: PLAYER_DETAIL_STALE_MS,
      retry: false,
      queryFn: async () => {
        const hit = await loadPlayerDetailClientOnly(id);
        // Throw on miss so React Query does not cache `null` and block a later open.
        if (!hit) throw new Error("player-detail-prefetch-miss");
        return hit;
      },
    })
    .catch(() => {
      /* miss / network — open path will retry */
    })
    .finally(() => {
      inflight.delete(id);
    });
}

/** Spread onto clickable player rows (hover/focus/pointerdown warm). */
export function playerHoverPrefetchProps(id: string | null | undefined) {
  if (!canPrefetchId(id)) return {};
  const warm = () => prefetchPlayerDetail(id);
  return {
    onPointerEnter: warm,
    onFocus: warm,
    onPointerDown: warm,
  };
}
