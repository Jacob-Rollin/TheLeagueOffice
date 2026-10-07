/**
 * Client helpers for edge-cached snapshots.
 * Prefer GitHub snap-cdn (`VITE_SNAP_CDN_BASE`), then `/api/data/snap/*`
 * (browse soft-empty — no Fluid compute). Dev may fall back to createServerFn.
 */

import { R2_SNAP_KEYS, r2Url } from "@/lib/r2-public";

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

async function fetchSnapPreferR2<T>(r2Path: string | null, apiPath: string): Promise<T | null> {
  if (r2Path) {
    const r2 = r2Url(r2Path);
    if (r2) {
      const hit = await fetchSnapJson<T>(r2);
      if (hit != null) return hit;
    }
  }
  return fetchSnapJson<T>(apiPath);
}

export async function fetchSnapTradeValueBasis() {
  const hit = await fetchSnapPreferR2<
    Awaited<ReturnType<typeof import("./players.server").loadTradeValueBasis>>
  >(R2_SNAP_KEYS.tradeBasis(), "/api/data/snap/trade-basis");
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
  const hit = await fetchSnapPreferR2<
    Awaited<ReturnType<typeof import("./players.server").loadInjuryReports>>
  >(R2_SNAP_KEYS.injuryReports(), "/api/data/snap/injury-reports");
  if (hit && Array.isArray(hit.items)) return hit;
  if (!allowFluidFallback()) return { updatedAt: "", items: [] };
  const { getInjuryReports } = await import("./players.functions");
  return getInjuryReports();
}

export async function fetchSnapInjuryWire(limit = 5) {
  const safeLimit = Math.max(1, Math.min(60, limit));
  const hit = await fetchSnapPreferR2<Awaited<ReturnType<typeof import("./players.server").loadInjuryWire>>>(
    R2_SNAP_KEYS.injuryWire(),
    `/api/data/snap/injury-wire?limit=${safeLimit}`,
  );
  if (Array.isArray(hit) && hit.length > 0) {
    return hit.slice(0, safeLimit);
  }

  // Until Publish Snap CDN seeds injury-wire.json, reuse injury-reports (already on snap-cdn).
  const reports = await fetchSnapInjuryReports().catch(() => null);
  if (reports?.items?.length) {
    type Wire = Awaited<ReturnType<typeof import("./players.server").loadInjuryWire>>[number];
    const mapped: Wire[] = reports.items
      .filter((item) => item.statusShort && !/^active$/i.test(item.status))
      .map((item) => {
        const source: Wire["source"] = /rotowire/i.test(item.source) ? "RotoWire" : "ESPN";
        return {
          id: item.id,
          playerName: item.playerName,
          sleeperId: item.sleeperId,
          pos: item.pos,
          team: item.team,
          headshot: item.headshot,
          status: item.status,
          statusShort: item.statusShort,
          headline: item.headline,
          body: item.news,
          published: item.published,
          returnDate: item.returnDate,
          source,
          link: item.link,
        };
      })
      .sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0))
      .slice(0, safeLimit);
    if (mapped.length > 0) return mapped;
  }

  if (!allowFluidFallback()) return [];
  const { getInjuryWire } = await import("./players.functions");
  return getInjuryWire({ data: { limit: safeLimit } });
}

export async function fetchSnapFantasyNews(limit = 40) {
  const hit = await fetchSnapPreferR2<
    Awaited<ReturnType<typeof import("./players.server").loadFantasyNewsFeed>>
  >(R2_SNAP_KEYS.fantasyNews(), `/api/data/snap/fantasy-news?limit=${limit}`);
  if (Array.isArray(hit)) return hit;
  if (!allowFluidFallback()) return [];
  const { getFantasyNewsFeed } = await import("./players.functions");
  return getFantasyNewsFeed({ data: { limit } });
}

export async function fetchSnapTradeMarket(format: "std" | "half" | "ppr" = "half") {
  const hit = await fetchSnapPreferR2<
    Awaited<ReturnType<typeof import("./trade-market.server").loadTradeMarket>>
  >(R2_SNAP_KEYS.tradeMarket(format), `/api/data/snap/trade-market?format=${format}`);
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
 * Sleeper misses prefer browser projections (visitor rate-limit pool) before Fluid
 * so Recommendation / Slot Ranks stay populated without burning Active CPU.
 * ESPN/Yahoo still use Fluid. Public research snaps above soft-empty in production.
 */
export async function fetchSnapRestOfSeason(input: {
  identifier: string;
  platform: string;
  fromWeek: number;
  toWeek: number;
  s2?: string;
  swid?: string;
  teamName?: string | null;
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

    const { computeRestOfSeasonClient } = await import("./standings-projections-client");
    const client = await computeRestOfSeasonClient({
      identifier: input.identifier,
      platform,
      fromWeek: input.fromWeek,
      toWeek: input.toWeek,
      ...(input.s2 ? { s2: input.s2 } : {}),
      ...(input.swid ? { swid: input.swid } : {}),
      ...(input.teamName ? { teamName: input.teamName } : {}),
    }).catch(() => null);
    if (client && Array.isArray(client.weeks) && client.weeks.length > 0) return client;
  }

  if (!allowFluidFallback() && platform === "sleeper") return empty;

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
  teamName?: string | null;
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

    const { computeStartingSlotRanksClient } = await import("./standings-projections-client");
    const client = await computeStartingSlotRanksClient({
      identifier: input.identifier,
      platform,
      fromWeek: input.fromWeek,
      toWeek,
      ...(input.s2 ? { s2: input.s2 } : {}),
      ...(input.swid ? { swid: input.swid } : {}),
      ...(input.teamName ? { teamName: input.teamName } : {}),
    }).catch(() => null);
    if (client && Array.isArray(client.teams) && client.teams.length > 0) return client;
  }

  if (!allowFluidFallback() && platform === "sleeper") return empty;

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
