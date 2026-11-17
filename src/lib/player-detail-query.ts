/**
 * Shared React Query options for desktop PlayerModal + mobile player sheet.
 * Prefetch uses the same key via `prefetch-player-detail.ts` (client-only, no Fluid).
 */

import { queryOptions } from "@tanstack/react-query";

import { getPlayerDetail } from "@/lib/players.functions";
import {
  loadPlayerDetailClientOnly,
  PLAYER_DETAIL_QUERY_KEY,
  PLAYER_DETAIL_STALE_MS,
} from "@/lib/prefetch-player-detail";

export const detailQuery = (id: string) =>
  queryOptions({
    queryKey: PLAYER_DETAIL_QUERY_KEY(id),
    queryFn: async () => {
      const client = await loadPlayerDetailClientOnly(id);
      if (client) return client;
      // Catalog miss: Fluid only in dev. Never return `null` as success data —
      // React Query would cache it for staleTime and freeze "Player not found"
      // (empty game logs) even after the catalog finishes warming.
      if (import.meta.env.PROD) {
        throw new Error("player-detail-miss");
      }
      return getPlayerDetail({ data: { id } });
    },
    staleTime: PLAYER_DETAIL_STALE_MS,
    // One retry covers a cold catalog race; true unknowns stay empty after.
    retry: 1,
  });
