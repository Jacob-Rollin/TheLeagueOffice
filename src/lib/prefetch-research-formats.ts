/**
 * After the first research hit for a scoring format, idle-prefetch the other
 * two (std / half / ppr) so format toggles are cache hits.
 *
 * Free-tier safe: only when snap-cdn base is set; serializes with a small gap;
 * skips when the tab is hidden; uses existing soft-empty fetch helpers (no Fluid).
 */

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { snapCdnPublicBase } from "@/lib/r2-public";
import {
  RESEARCH_CLIENT_STALE_MS,
  fetchResearchFpa,
  fetchResearchMatchupsGuide,
  fetchResearchSosAnalysis,
  type ResearchFormat,
} from "@/lib/research-cdn";
import { fetchSnapTradeMarket } from "@/lib/snap-cdn";

const FORMATS: ResearchFormat[] = ["std", "half", "ppr"];
const GAP_MS = 250;

export type FormatPrefetchKind = "fpa" | "sos" | "matchups-guide" | "trade-market";

function whenIdle(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as Window & {
    requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(cb, { timeout: 3500 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(cb, 900);
  return () => window.clearTimeout(id);
}

async function prefetchFormat(
  queryClient: QueryClient,
  kind: FormatPrefetchKind,
  format: ResearchFormat,
  week: number | null | undefined,
): Promise<void> {
  switch (kind) {
    case "fpa":
      await queryClient.prefetchQuery({
        queryKey: ["fantasy-points-allowed", format],
        staleTime: RESEARCH_CLIENT_STALE_MS,
        queryFn: () => fetchResearchFpa(format),
      });
      return;
    case "sos":
      await queryClient.prefetchQuery({
        queryKey: ["sos-analysis", format],
        staleTime: RESEARCH_CLIENT_STALE_MS,
        queryFn: () => fetchResearchSosAnalysis(format),
      });
      return;
    case "matchups-guide":
      await queryClient.prefetchQuery({
        queryKey: ["matchups-guide", week, format],
        staleTime: RESEARCH_CLIENT_STALE_MS,
        queryFn: () => fetchResearchMatchupsGuide(week, format),
      });
      return;
    case "trade-market":
      await queryClient.prefetchQuery({
        queryKey: ["trade-market", format],
        staleTime: 60 * 60 * 1000,
        queryFn: () => fetchSnapTradeMarket(format),
      });
      return;
  }
}

/**
 * Prefetch sibling scoring formats after the current format has data.
 * No-op without snap-cdn (avoids idle /api/data hits).
 */
export function usePrefetchSiblingFormats(
  kind: FormatPrefetchKind,
  currentFormat: ResearchFormat,
  options?: { week?: number | null; enabled?: boolean },
): void {
  const queryClient = useQueryClient();
  const week = options?.week;
  const enabled = options?.enabled !== false;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    if (!snapCdnPublicBase()) return;

    let cancelled = false;
    const cancelIdle = whenIdle(() => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

      void (async () => {
        const siblings = FORMATS.filter((f) => f !== currentFormat);
        for (const format of siblings) {
          if (cancelled) return;
          if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
          try {
            await prefetchFormat(queryClient, kind, format, week);
          } catch {
            /* soft-fail */
          }
          await new Promise((r) => setTimeout(r, GAP_MS));
        }
      })();
    });

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [queryClient, kind, currentFormat, week, enabled]);
}
