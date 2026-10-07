import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { isPageVisible, visibleRefetchInterval } from "@/lib/page-visibility";
import type { Player } from "@/lib/players-build";
import { fetchLiveInjuryStatusesClient } from "@/lib/sleeper-client";

export type LiveInjuryStatus = { status: string | null; bodyPart: string | null };

export const LIVE_INJURY_QUERY_KEY = ["live-injury-statuses"] as const;

/**
 * Shared browser → Sleeper live injury overlay.
 * Reuses `weekProjectionBundle` (IndexedDB + rate budget) — same download as
 * ATP / game-log projs. One RQ key site-wide; 10m soft refresh while visible.
 */
export function useLiveInjuryStatuses() {
  return useQuery({
    queryKey: LIVE_INJURY_QUERY_KEY,
    staleTime: 10 * 60 * 1000,
    refetchInterval: visibleRefetchInterval(10 * 60 * 1000),
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async (): Promise<Record<string, LiveInjuryStatus>> => {
      if (!isPageVisible()) return {};
      return fetchLiveInjuryStatusesClient();
    },
  });
}

/** Patch catalog players with the live Sleeper injury overlay when available. */
export function applyLiveInjuryOverlay<T extends Player>(
  players: T[],
  live: Record<string, LiveInjuryStatus> | null | undefined,
): T[] {
  if (!live || !Object.keys(live).length) return players;
  let changed = false;
  const out = players.map((p) => {
    const hit = live[p.id];
    if (hit === undefined) return p;
    const status = hit.status?.trim() || null;
    const body = hit.bodyPart?.trim() || null;
    const nextBody = body || (status ? p.injury_body_part : null);
    if (p.injury_status === status && p.injury === status && (p.injury_body_part ?? null) === (nextBody ?? null)) {
      return p;
    }
    changed = true;
    return {
      ...p,
      injury_status: status,
      injury: status,
      injury_body_part: nextBody,
    };
  });
  return changed ? out : players;
}

/** Convenience: catalog players with live injury overlay applied. */
export function usePlayersWithLiveInjuries<T extends Player>(players: T[]): T[] {
  const { data: live } = useLiveInjuryStatuses();
  return useMemo(() => applyLiveInjuryOverlay(players, live), [players, live]);
}
