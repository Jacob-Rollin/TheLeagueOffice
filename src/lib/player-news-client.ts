/**
 * Player news from shared CDN snaps (fantasy-news + injury-reports).
 * Avoids per-player Fluid `getPlayerNews` (ESPN athlete fan-out) on every popup.
 */

import { fetchSnapFantasyNews, fetchSnapInjuryReports } from "@/lib/snap-cdn";
import type { NewsItem } from "@/lib/players.server";

export type PlayerNewsClient = {
  injury: { status: string | null; note: string | null };
  items: NewsItem[];
};

function allowFluidFallback(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

/** CDN-first player news; Fluid only in DEV when snaps are empty. */
export async function fetchPlayerNewsClient(id: string): Promise<PlayerNewsClient> {
  const playerId = String(id ?? "").slice(0, 32);
  if (!playerId) return { injury: { status: null, note: null }, items: [] };

  if (typeof window !== "undefined") {
    const [feed, reports] = await Promise.all([
      fetchSnapFantasyNews(60),
      fetchSnapInjuryReports(),
    ]);

    const report = (reports?.items ?? []).find((r) => r.sleeperId === playerId) ?? null;
    const items: NewsItem[] = [];
    const seen = new Set<string>();

    if (report) {
      items.push({
        id: `injury-${report.id}`,
        headline: report.headline,
        description: report.news || report.analysis || "",
        published: report.published,
        link: report.link,
        image: report.headshot,
        aboutPlayer: true,
        source: report.source,
      });
      seen.add(`injury-${report.id}`);
    }

    for (const row of feed ?? []) {
      if (row.player?.id !== playerId) continue;
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      items.push({
        id: row.id,
        headline: row.headline,
        description: row.body || "",
        published: row.published ?? "",
        link: row.link,
        image: row.image,
        aboutPlayer: true,
        source: row.source,
      });
    }

    if (items.length || report || !allowFluidFallback()) {
      return {
        injury: {
          status: report?.status ?? null,
          note: report?.news ?? null,
        },
        items,
      };
    }
  }

  const { getPlayerNews } = await import("./players.functions");
  const full = await getPlayerNews({ data: { id: playerId } });
  return {
    injury: full?.injury ?? { status: null, note: null },
    items: full?.items ?? [],
  };
}
