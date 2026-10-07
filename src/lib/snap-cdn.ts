/**
 * Client helpers for edge-cached snapshots.
 * Prefer GitHub snap-cdn (`VITE_SNAP_CDN_BASE`), then `/api/data/snap/*`
 * (browse soft-empty — no Fluid compute). Dev may fall back to createServerFn.
 */

import {
  espnFluidCacheKey,
  espnFluidMemo,
  ESPN_FLUID_TTL_MS,
} from "@/lib/espn-fluid-cache";
import { R2_SNAP_KEYS, r2Url, snapCdnPublicBase } from "@/lib/r2-public";

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
      // snap-cdn / R2 base is configured — skip Vercel empty `no-store` probes.
      if (snapCdnPublicBase()) return null;
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

/**
 * Roster news for dashboard / My Team.
 *
 * Browse must NOT hit `/api/data/snap/roster-news` — that route soft-empties with
 * `no-store` for anonymous traffic (cron-only compute), so every playbook load
 * was a Vercel CDN miss. Compose from GitHub snap-cdn injury + fantasy feeds
 * instead (zero Vercel). DEV may still Fluid-backfill.
 */
export async function fetchSnapRosterNews(ids: string[]) {
  type RosterNews = Awaited<ReturnType<typeof import("./players.server").loadRosterNews>>;
  const empty: RosterNews = { season: "", week: 0, players: [] };
  const clean = Array.from(new Set(ids.map((id) => String(id).slice(0, 32)).filter(Boolean)))
    .sort()
    .slice(0, 30);
  if (!clean.length) return empty;

  const [reports, feed] = await Promise.all([
    fetchSnapInjuryReports().catch(() => null),
    fetchSnapFantasyNews(80).catch(() => null),
  ]);
  const want = new Set(clean);
  const reportById = new Map(
    (reports?.items ?? [])
      .filter((r) => r.sleeperId && want.has(r.sleeperId))
      .map((r) => [r.sleeperId as string, r]),
  );
  const newsById = new Map<string, NonNullable<RosterNews["players"][number]["news"]>>();
  const injuryCopy =
    /\binjur|\bquestionable\b|\bdoubtful\b|\bruled out\b|\binactive\b|\bIR\b|\bsurgery\b/i;
  for (const row of feed ?? []) {
    const pid = row.player?.id;
    if (!pid || !want.has(pid) || newsById.has(pid)) continue;
    const headline = row.headline ?? "";
    const body = row.body || "";
    newsById.set(pid, {
      headline,
      analysis: body,
      published: row.published ?? "",
      link: row.link,
      injury: injuryCopy.test(`${headline} ${body}`),
    });
  }

  const players: RosterNews["players"] = clean.map((id) => {
    const report = reportById.get(id);
    const status = report?.status?.trim() || null;
    const statusShort = report?.statusShort?.trim() || null;
    const onIr = statusShort === "IR" || /^injured reserve$/i.test(status ?? "");
    return {
      id,
      status,
      bodyPart: report?.injury?.trim() || null,
      reserve: onIr,
      // Official practice-report rows aren't on the public snap — map what we have
      // so designation/injury labels still populate from the injury-reports feed.
      report: report
        ? {
            week: 0,
            status: statusShort || status,
            injury: report.injury?.trim() || null,
            practice: null,
          }
        : null,
      news: newsById.get(id) ?? null,
    };
  });

  if (players.some((p) => p.news || p.report || p.status)) {
    return { season: "", week: 0, players };
  }

  if (!allowFluidFallback()) return { season: "", week: 0, players };

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
    // Browse `/api/data/snap/ros` is cron-compute-only and returns empty
    // `no-store` for visitors — skip that Vercel CDN miss and compute in-browser.
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
    if (!allowFluidFallback()) return empty;
  }

  const fluidKey = espnFluidCacheKey(
    "ros",
    input.identifier,
    platform,
    `${input.fromWeek}-${input.toWeek}`,
  );
  const { getRestOfSeasonProjections } = await import("./league.functions");
  return espnFluidMemo(fluidKey, ESPN_FLUID_TTL_MS, () =>
    getRestOfSeasonProjections({
      data: {
        identifier: input.identifier,
        platform,
        fromWeek: input.fromWeek,
        toWeek: input.toWeek,
        ...(input.s2 ? { s2: input.s2 } : {}),
        ...(input.swid ? { swid: input.swid } : {}),
      },
    }),
  );
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
    // Same as ROS: anonymous snap route is empty no-store — browser compute only.
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
    if (!allowFluidFallback()) return empty;
  }

  const fluidKey = espnFluidCacheKey(
    "slots",
    input.identifier,
    platform,
    `${input.fromWeek}-${toWeek}`,
  );
  const { getStartingSlotRanks } = await import("./league.functions");
  return espnFluidMemo(fluidKey, ESPN_FLUID_TTL_MS, () =>
    getStartingSlotRanks({
      data: {
        identifier: input.identifier,
        platform,
        fromWeek: input.fromWeek,
        toWeek,
        ...(input.s2 ? { s2: input.s2 } : {}),
        ...(input.swid ? { swid: input.swid } : {}),
      },
    }),
  );
}
