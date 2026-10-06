/**
 * Client helpers for CDN-cached research aggregate routes.
 * Prefer `/api/data/research/*` (edge cache → TiDB SELECT). Fall back to
 * createServerFn loaders for local/dev when TiDB snaps are unavailable.
 */

export type ResearchFormat = "std" | "half" | "ppr";

function normalizeFormat(format?: string | null): ResearchFormat {
  return format === "std" || format === "ppr" ? format : "half";
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchResearchFpa(format: ResearchFormat = "half") {
  const fmt = normalizeFormat(format);
  if (typeof window !== "undefined") {
    const hit = await fetchJson<Awaited<ReturnType<typeof import("./players.functions").getFantasyPointsAllowed>>>(
      `/api/data/research/fpa?format=${fmt}`,
    );
    if (hit && Array.isArray((hit as { rows?: unknown[] }).rows)) return hit;
  }
  const { getFantasyPointsAllowed } = await import("./players.functions");
  return getFantasyPointsAllowed({ data: { format: fmt } });
}

export async function fetchResearchMatchupsGuide(
  week: number | null | undefined,
  format: ResearchFormat = "half",
) {
  const fmt = normalizeFormat(format);
  if (typeof window !== "undefined") {
    const qs = new URLSearchParams({ format: fmt });
    if (week != null && Number.isFinite(week)) qs.set("week", String(week));
    const hit = await fetchJson<Awaited<ReturnType<typeof import("./players.functions").getMatchupsGuide>>>(
      `/api/data/research/matchups-guide?${qs}`,
    );
    if (hit && typeof hit === "object") return hit;
  }
  const { getMatchupsGuide } = await import("./players.functions");
  return getMatchupsGuide({ data: { week: week ?? null, format: fmt } });
}

export async function fetchResearchSosAnalysis(format: ResearchFormat = "half") {
  const fmt = normalizeFormat(format);
  if (typeof window !== "undefined") {
    const hit = await fetchJson<Awaited<ReturnType<typeof import("./players.functions").getSosAnalysis>>>(
      `/api/data/research/sos-analysis?format=${fmt}`,
    );
    if (hit && Array.isArray((hit as { rows?: unknown[] }).rows)) return hit;
  }
  const { getSosAnalysis } = await import("./players.functions");
  return getSosAnalysis({ data: { format: fmt } });
}

export async function fetchResearchFantasyLeaders(season?: string) {
  if (typeof window !== "undefined") {
    const qs = season ? `?season=${encodeURIComponent(season)}` : "";
    const hit = await fetchJson<Awaited<ReturnType<typeof import("./players.functions").getFantasyLeaders>>>(
      `/api/data/research/fantasy-leaders${qs}`,
    );
    if (hit && Array.isArray((hit as { rows?: unknown[] }).rows)) return hit;
  }
  const { getFantasyLeaders } = await import("./players.functions");
  return getFantasyLeaders({ data: season ? { season } : {} });
}

export async function fetchResearchSosBoard(season?: string) {
  if (typeof window !== "undefined") {
    const qs = season ? `?season=${encodeURIComponent(season)}` : "";
    const hit = await fetchJson<Awaited<ReturnType<typeof import("./players.functions").getSosBoard>>>(
      `/api/data/research/sos-board${qs}`,
    );
    if (hit && Array.isArray((hit as { schedule?: unknown[] }).schedule)) return hit;
  }
  const { getSosBoard } = await import("./players.functions");
  return getSosBoard({ data: season ? { season } : {} });
}
