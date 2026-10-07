/**
 * Client helpers for edge-cached Fluid snapshots (`/api/data/snap/*`).
 * Prefer these over createServerFn so concurrent visitors share CDN.
 *
 * Production: never fall back to createServerFn — a CDN miss must soft-empty
 * so we do not burn Fluid CPU. Dev/local may still use Fluid when snaps are absent.
 */

function allowFluidFallback(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

async function fetchSnapJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchSnapTradeValueBasis() {
  const hit = await fetchSnapJson<Awaited<ReturnType<typeof import("./players.server").loadTradeValueBasis>>>(
    "/api/data/snap/trade-basis",
  );
  if (hit?.players && Object.keys(hit.players).length > 0) return hit;
  if (!allowFluidFallback()) {
    return (
      hit ?? {
        season: "",
        week: 0,
        remainingWeeks: 0,
        rosAvailable: false,
        players: {},
      }
    );
  }
  const { getTradeValueBasis } = await import("./players.functions");
  return getTradeValueBasis();
}

export async function fetchSnapInjuryReports() {
  const hit = await fetchSnapJson<Awaited<ReturnType<typeof import("./players.server").loadInjuryReports>>>(
    "/api/data/snap/injury-reports",
  );
  if (hit && Array.isArray(hit.items)) return hit;
  if (!allowFluidFallback()) return { updatedAt: "", items: [] };
  const { getInjuryReports } = await import("./players.functions");
  return getInjuryReports();
}

export async function fetchSnapInjuryWire(limit = 5) {
  const hit = await fetchSnapJson<Awaited<ReturnType<typeof import("./players.server").loadInjuryWire>>>(
    `/api/data/snap/injury-wire?limit=${limit}`,
  );
  if (Array.isArray(hit)) return hit;
  if (!allowFluidFallback()) return [];
  const { getInjuryWire } = await import("./players.functions");
  return getInjuryWire({ data: { limit } });
}

export async function fetchSnapFantasyNews(limit = 40) {
  const hit = await fetchSnapJson<Awaited<ReturnType<typeof import("./players.server").loadFantasyNewsFeed>>>(
    `/api/data/snap/fantasy-news?limit=${limit}`,
  );
  if (Array.isArray(hit)) return hit;
  if (!allowFluidFallback()) return [];
  const { getFantasyNewsFeed } = await import("./players.functions");
  return getFantasyNewsFeed({ data: { limit } });
}

export async function fetchSnapTradeMarket(format: "std" | "half" | "ppr" = "half") {
  const hit = await fetchSnapJson<Awaited<ReturnType<typeof import("./trade-market.server").loadTradeMarket>>>(
    `/api/data/snap/trade-market?format=${format}`,
  );
  if (hit && Array.isArray((hit as { rows?: unknown[] }).rows)) return hit;
  if (!allowFluidFallback()) return { format, season: "", rows: [], opportunity: [] };
  const { getTradeMarket } = await import("./players.functions");
  return getTradeMarket({ data: { format } });
}

export async function fetchSnapRosterNews(ids: string[]) {
  const clean = Array.from(new Set(ids.map((id) => String(id).slice(0, 32)).filter(Boolean)))
    .sort()
    .slice(0, 30);
  if (!clean.length) {
    return {
      season: "",
      week: 0,
      players: [] as Awaited<ReturnType<typeof import("./players.server").loadRosterNews>>["players"],
    };
  }
  const qs = new URLSearchParams({ ids: clean.join(",") });
  const hit = await fetchSnapJson<Awaited<ReturnType<typeof import("./players.server").loadRosterNews>>>(
    `/api/data/snap/roster-news?${qs}`,
  );
  if (hit && Array.isArray(hit.players) && hit.players.length > 0) return hit;
  if (!allowFluidFallback()) {
    return (
      hit ?? {
        season: "",
        week: 0,
        players: [] as Awaited<ReturnType<typeof import("./players.server").loadRosterNews>>["players"],
      }
    );
  }
  const { getRosterNews } = await import("./players.functions");
  return getRosterNews({ data: { ids: clean } });
}

/**
 * League-scoped snaps: CDN first when the identifier is a numeric host league id.
 * Production soft-empties on miss (same free-tier policy as research-cdn).
 */
export async function fetchSnapRestOfSeason(input: {
  identifier: string;
  platform: string;
  fromWeek: number;
  toWeek: number;
  s2?: string;
  swid?: string;
}) {
  const platform = String(input.platform ?? "sleeper").trim().toLowerCase();
  const empty = { weeks: [] as number[], byWeek: [] as Record<string, number>[] };
  if (platform === "sleeper" && /^\d{6,}$/.test(input.identifier)) {
    const qs = new URLSearchParams({
      league: input.identifier,
      from: String(input.fromWeek),
      to: String(input.toWeek),
    });
    const hit = await fetchSnapJson<
      Awaited<ReturnType<typeof import("./standings-projections.server").loadRestOfSeasonProjections>>
    >(`/api/data/snap/ros?${qs}`);
    if (hit && Array.isArray(hit.weeks) && hit.weeks.length > 0) return hit;
    if (!allowFluidFallback()) return hit ?? empty;
  } else if (!allowFluidFallback()) {
    return empty;
  }
  const { getRestOfSeasonProjections } = await import("./league.functions");
  return getRestOfSeasonProjections({
    data: {
      identifier: input.identifier,
      platform,
      fromWeek: input.fromWeek,
      toWeek: input.toWeek,
      ...(input.s2 ? { s2: input.s2 } : {}),
      ...(input.swid ? { swid: input.swid } : {}),
    },
  });
}

export async function fetchSnapStartingSlotRanks(input: {
  identifier: string;
  platform: string;
  fromWeek: number;
  toWeek?: number;
  s2?: string;
  swid?: string;
}) {
  const platform = String(input.platform ?? "sleeper").trim().toLowerCase();
  const toWeek = input.toWeek ?? input.fromWeek;
  const empty = { seats: [] as string[], teams: [] };
  if (platform === "sleeper" && /^\d{6,}$/.test(input.identifier)) {
    const qs = new URLSearchParams({
      league: input.identifier,
      from: String(input.fromWeek),
      to: String(toWeek),
    });
    const hit = await fetchSnapJson<
      Awaited<ReturnType<typeof import("./standings-projections.server").loadStartingSlotRanks>>
    >(`/api/data/snap/slot-ranks?${qs}`);
    if (hit && Array.isArray(hit.teams) && hit.teams.length > 0) return hit;
    if (!allowFluidFallback()) return hit ?? empty;
  } else if (!allowFluidFallback()) {
    return empty;
  }
  const { getStartingSlotRanks } = await import("./league.functions");
  return getStartingSlotRanks({
    data: {
      identifier: input.identifier,
      platform,
      fromWeek: input.fromWeek,
      toWeek,
      ...(input.s2 ? { s2: input.s2 } : {}),
      ...(input.swid ? { swid: input.swid } : {}),
    },
  });
}
