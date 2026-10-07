/**
 * Client helpers for research aggregates.
 * Prefer public Cloudflare R2 (zero Vercel/TiDB), then `/api/data/research/*`.
 *
 * Production: never fall back to createServerFn — a miss must soft-empty
 * so we do not burn Fluid CPU. Dev/local may still use Fluid when snaps are absent.
 */

import { R2_RESEARCH_KEYS, r2Url } from "@/lib/r2-public";

export type ResearchFormat = "std" | "half" | "ppr";

/** Match mid-week research CDN s-maxage (1h) so RQ does not revalidate early. */
export const RESEARCH_CLIENT_STALE_MS = 60 * 60 * 1000;

function normalizeFormat(format?: string | null): ResearchFormat {
  return format === "std" || format === "ppr" ? format : "half";
}

function allowFluidFallback(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
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

/** R2 first (free egress), then Vercel `/api/data/research/*` (TiDB). */
async function fetchResearchPreferR2<T>(
  r2Path: string | null,
  apiPath: string,
): Promise<T | null> {
  if (r2Path) {
    const r2 = r2Url(r2Path);
    if (r2) {
      const hit = await fetchJson<T>(r2);
      if (hit != null) return hit;
    }
  }
  return fetchJson<T>(apiPath);
}

export async function fetchResearchFpa(format: ResearchFormat = "half") {
  const fmt = normalizeFormat(format);
  if (typeof window !== "undefined") {
    const hit = await fetchResearchPreferR2<
      Awaited<ReturnType<typeof import("./players.functions").getFantasyPointsAllowed>>
    >(R2_RESEARCH_KEYS.fpa(fmt), `/api/data/research/fpa?format=${fmt}`);
    if (hit && Array.isArray((hit as { rows?: unknown[] }).rows)) return hit;
    if (!allowFluidFallback()) return { season: "", weeksFrom: 0, weeksTo: 0, rows: [] };
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
    const wKnown = week != null && Number.isFinite(week) ? Math.round(week) : null;
    if (wKnown != null) qs.set("week", String(wKnown));
    const hit = await fetchResearchPreferR2<
      Awaited<ReturnType<typeof import("./players.functions").getMatchupsGuide>>
    >(
      wKnown != null ? R2_RESEARCH_KEYS.matchupsGuide(wKnown, fmt) : null,
      `/api/data/research/matchups-guide?${qs}`,
    );
    if (
      hit &&
      typeof hit === "object" &&
      hit.defense &&
      typeof hit.defense === "object" &&
      hit.games &&
      typeof hit.games === "object"
    ) {
      return hit;
    }
    if (!allowFluidFallback()) {
      const w = wKnown ?? 1;
      return {
        season: "",
        week: w,
        currentWeek: w,
        priorSeason: null,
        dataThroughWeek: 0,
        updatedAt: new Date(0).toISOString(),
        games: {},
        defense: {},
      };
    }
  }
  const { getMatchupsGuide } = await import("./players.functions");
  return getMatchupsGuide({ data: { week: week ?? null, format: fmt } });
}

export async function fetchResearchSosAnalysis(format: ResearchFormat = "half") {
  const fmt = normalizeFormat(format);
  if (typeof window !== "undefined") {
    const hit = await fetchResearchPreferR2<
      Awaited<ReturnType<typeof import("./players.functions").getSosAnalysis>>
    >(R2_RESEARCH_KEYS.sosAnalysis(fmt), `/api/data/research/sos-analysis?format=${fmt}`);
    if (hit && Array.isArray((hit as { rows?: unknown[] }).rows)) return hit;
    if (!allowFluidFallback()) {
      return {
        season: "",
        fromWeek: 0,
        toWeek: 0,
        dataThroughWeek: 0,
        priorSeason: null,
        updatedAt: new Date(0).toISOString(),
        rows: [],
      };
    }
  }
  const { getSosAnalysis } = await import("./players.functions");
  return getSosAnalysis({ data: { format: fmt } });
}

export async function fetchResearchFantasyLeaders(season?: string) {
  if (typeof window !== "undefined") {
    const qs = season ? `?season=${encodeURIComponent(season)}` : "";
    const hit = await fetchResearchPreferR2<
      Awaited<ReturnType<typeof import("./players.functions").getFantasyLeaders>>
    >(R2_RESEARCH_KEYS.fantasyLeaders(), `/api/data/research/fantasy-leaders${qs}`);
    if (hit && Array.isArray((hit as { rows?: unknown[] }).rows) && (hit as { rows: unknown[] }).rows.length > 0) {
      return hit;
    }
    const { fetchFantasyLeadersClient } = await import("./fantasy-leaders-client");
    return fetchFantasyLeadersClient(season);
  }
  if (!allowFluidFallback()) {
    return { season: season ?? "", maxWeek: 0, rows: [] };
  }
  const { getFantasyLeaders } = await import("./players.functions");
  return getFantasyLeaders({ data: season ? { season } : {} });
}

export async function fetchResearchSosBoard(season?: string) {
  if (typeof window !== "undefined") {
    const qs = season ? `?season=${encodeURIComponent(season)}` : "";
    const hit = await fetchResearchPreferR2<
      Awaited<ReturnType<typeof import("./players.functions").getSosBoard>>
    >(R2_RESEARCH_KEYS.sosBoard(), `/api/data/research/sos-board${qs}`);
    if (hit && Array.isArray((hit as { schedule?: unknown[] }).schedule)) return hit;
    if (!allowFluidFallback()) return { season: season ?? "", schedule: [], ranks: {} };
  }
  const { getSosBoard } = await import("./players.functions");
  return getSosBoard({ data: season ? { season } : {} });
}

export async function fetchResearchRedZone(opts?: {
  season?: string;
  yardline?: number;
  weekFrom?: number | null;
  weekTo?: number | null;
}) {
  if (typeof window !== "undefined") {
    const qs = new URLSearchParams();
    if (opts?.season) qs.set("season", opts.season);
    const yardline = opts?.yardline ?? 20;
    qs.set("yardline", String(yardline));
    if (opts?.weekFrom != null) qs.set("weekFrom", String(opts.weekFrom));
    if (opts?.weekTo != null) qs.set("weekTo", String(opts.weekTo));
    const hit = await fetchResearchPreferR2<
      Awaited<ReturnType<typeof import("./players.functions").getRedZoneStats>>
    >(R2_RESEARCH_KEYS.redzone(yardline), `/api/data/research/redzone?${qs}`);
    if (hit && (hit as { rowsByPos?: unknown }).rowsByPos) return hit;
    if (!allowFluidFallback()) {
      return {
        season: opts?.season ?? "",
        weeksFrom: 0,
        weeksTo: 0,
        maxWeek: 0,
        yardline,
        rowsByPos: { QB: [], RB: [], WR: [], TE: [] },
      };
    }
  }
  const { getRedZoneStats } = await import("./players.functions");
  const data: {
    season?: string;
    yardline?: number;
    weekFrom?: number | null;
    weekTo?: number | null;
  } = {
    weekFrom: opts?.weekFrom ?? null,
    weekTo: opts?.weekTo ?? null,
  };
  if (opts?.season) data.season = opts.season;
  if (opts?.yardline != null) data.yardline = opts.yardline;
  return getRedZoneStats({ data });
}

export async function fetchResearchTargets(season?: string) {
  if (typeof window !== "undefined") {
    const qs = season ? `?season=${encodeURIComponent(season)}` : "";
    const hit = await fetchResearchPreferR2<
      Awaited<ReturnType<typeof import("./players.functions").getMostTargetedPlayers>>
    >(R2_RESEARCH_KEYS.targets(), `/api/data/research/targets${qs}`);
    if (hit && Array.isArray((hit as { rows?: unknown[] }).rows)) return hit;
    if (!allowFluidFallback()) return { season: season ?? "", maxWeek: 0, rows: [] };
  }
  const { getMostTargetedPlayers } = await import("./players.functions");
  return getMostTargetedPlayers({ data: season ? { season } : {} });
}

export async function fetchResearchAreTheyPlaying(week: number) {
  const safeWeek = Math.min(18, Math.max(1, Math.trunc(week) || 1));
  if (typeof window !== "undefined") {
    const hit = await fetchResearchPreferR2<
      Awaited<ReturnType<typeof import("./players.functions").getAreTheyPlaying>>
    >(
      R2_RESEARCH_KEYS.areTheyPlaying(safeWeek),
      `/api/data/research/are-they-playing?week=${safeWeek}`,
    );
    if (hit && Array.isArray((hit as { lines?: unknown[] }).lines)) return hit;
    if (!allowFluidFallback()) {
      return { week: safeWeek, lines: [], updatedAt: 0 };
    }
  }
  const { getAreTheyPlaying } = await import("./players.functions");
  return getAreTheyPlaying({ data: { week: safeWeek } });
}
