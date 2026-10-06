/**
 * Client helpers for edge-cached Fluid snapshots (`/api/data/snap/*`).
 * Prefer these over createServerFn so concurrent visitors share CDN.
 */

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
  if (hit && hit.players) return hit;
  const { getTradeValueBasis } = await import("./players.functions");
  return getTradeValueBasis();
}

export async function fetchSnapInjuryReports() {
  const hit = await fetchSnapJson<Awaited<ReturnType<typeof import("./players.server").loadInjuryReports>>>(
    "/api/data/snap/injury-reports",
  );
  if (hit && Array.isArray(hit.items)) return hit;
  const { getInjuryReports } = await import("./players.functions");
  return getInjuryReports();
}

export async function fetchSnapInjuryWire(limit = 5) {
  const hit = await fetchSnapJson<Awaited<ReturnType<typeof import("./players.server").loadInjuryWire>>>(
    `/api/data/snap/injury-wire?limit=${limit}`,
  );
  if (Array.isArray(hit)) return hit;
  const { getInjuryWire } = await import("./players.functions");
  return getInjuryWire({ data: { limit } });
}

export async function fetchSnapFantasyNews(limit = 40) {
  const hit = await fetchSnapJson<Awaited<ReturnType<typeof import("./players.server").loadFantasyNewsFeed>>>(
    `/api/data/snap/fantasy-news?limit=${limit}`,
  );
  if (Array.isArray(hit)) return hit;
  const { getFantasyNewsFeed } = await import("./players.functions");
  return getFantasyNewsFeed({ data: { limit } });
}

export async function fetchSnapTradeMarket(format: "std" | "half" | "ppr" = "half") {
  const hit = await fetchSnapJson<Awaited<ReturnType<typeof import("./trade-market.server").loadTradeMarket>>>(
    `/api/data/snap/trade-market?format=${format}`,
  );
  if (hit && Array.isArray((hit as { rows?: unknown[] }).rows)) return hit;
  const { getTradeMarket } = await import("./players.functions");
  return getTradeMarket({ data: { format } });
}

/** Sleeper-only CDN path — ESPN/Yahoo keep Fluid (credentials). */
export async function fetchSnapRestOfSeason(input: {
  identifier: string;
  platform: string;
  fromWeek: number;
  toWeek: number;
  s2?: string;
  swid?: string;
}) {
  const platform = String(input.platform ?? "sleeper").trim().toLowerCase();
  if (platform === "sleeper" && input.identifier) {
    const qs = new URLSearchParams({
      league: input.identifier,
      from: String(input.fromWeek),
      to: String(input.toWeek),
    });
    const hit = await fetchSnapJson<
      Awaited<ReturnType<typeof import("./standings-projections.server").loadRestOfSeasonProjections>>
    >(`/api/data/snap/ros?${qs}`);
    if (hit && Array.isArray(hit.weeks)) return hit;
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
  if (platform === "sleeper" && input.identifier) {
    const qs = new URLSearchParams({
      league: input.identifier,
      from: String(input.fromWeek),
      to: String(toWeek),
    });
    const hit = await fetchSnapJson<
      Awaited<ReturnType<typeof import("./standings-projections.server").loadStartingSlotRanks>>
    >(`/api/data/snap/slot-ranks?${qs}`);
    if (hit && Array.isArray(hit.teams)) return hit;
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
