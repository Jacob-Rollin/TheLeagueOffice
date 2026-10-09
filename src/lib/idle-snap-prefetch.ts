/**
 * Idle warm of public snap-cdn JSON into React Query.
 *
 * Free-tier safe:
 * - Runs only when `VITE_SNAP_CDN_BASE` / R2 public base is set (never idle-hits Vercel/TiDB)
 * - Uses existing fetch helpers that prefer snap-cdn and soft-empty (no Fluid)
 * - Serializes jobs (one at a time) after requestIdleCallback
 * - Skips when the tab is hidden
 */

import type { QueryClient } from "@tanstack/react-query";

import { snapCdnPublicBase } from "@/lib/r2-public";
import {
  RESEARCH_CLIENT_STALE_MS,
  fetchResearchFantasyLeaders,
  fetchResearchFpa,
  fetchResearchSosAnalysis,
} from "@/lib/research-cdn";
import { fetchSnapInjuryReports } from "@/lib/snap-cdn";

const GAP_MS = 200;

function whenIdle(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as Window & {
    requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(cb, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(cb, 1800);
  return () => window.clearTimeout(id);
}

/**
 * Schedule a one-shot idle prefetch of the hottest research/injury snaps.
 * Returns a cancel function for React effect cleanup.
 */
export function scheduleIdleSnapPrefetch(queryClient: QueryClient): () => void {
  if (typeof window === "undefined") return () => {};
  // Without a public snap base, fetch helpers fall through to /api/data/* —
  // do not idle-warm that path (would burn Fluid/TiDB for every visitor).
  if (!snapCdnPublicBase()) return () => {};

  let cancelled = false;

  const cancelIdle = whenIdle(() => {
    if (cancelled) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    void (async () => {
      const jobs: Array<() => Promise<unknown>> = [
        () =>
          queryClient.prefetchQuery({
            queryKey: ["fantasy-points-allowed", "half"],
            staleTime: RESEARCH_CLIENT_STALE_MS,
            queryFn: () => fetchResearchFpa("half"),
          }),
        () =>
          queryClient.prefetchQuery({
            queryKey: ["sos-analysis", "half"],
            staleTime: RESEARCH_CLIENT_STALE_MS,
            queryFn: () => fetchResearchSosAnalysis("half"),
          }),
        () => {
          const season = String(new Date().getFullYear());
          return queryClient.prefetchQuery({
            queryKey: ["fantasy-leaders", season],
            staleTime: RESEARCH_CLIENT_STALE_MS,
            queryFn: () => fetchResearchFantasyLeaders(season),
          });
        },
        () =>
          queryClient.prefetchQuery({
            queryKey: ["injury-reports"],
            staleTime: 5 * 60 * 1000,
            queryFn: () => fetchSnapInjuryReports(),
          }),
      ];

      for (const job of jobs) {
        if (cancelled) return;
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        try {
          await job();
        } catch {
          /* soft-fail — never block the app */
        }
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
    })();
  });

  return () => {
    cancelled = true;
    cancelIdle();
  };
}
