/**
 * Shared CDN Cache-Control helpers for Nitro /api data routes.
 *
 * Live/league data: short TTLs (scores move).
 * Research/warehouse: long TTLs (cron-warmed, changes hourly at most) so
 * scale does not burn TiDB free-tier RUs on every browser refresh.
 */

export function isGamedayUtc(date = new Date()): boolean {
  const day = date.getUTCDay(); // 0 Sun, 1 Mon, 4 Thu
  return day === 0 || day === 1 || day === 4;
}

/** Default for live-ish /api/data routes (league boards, etc.). */
export function dataCacheControl(date = new Date()): string {
  if (isGamedayUtc(date)) {
    return "public, s-maxage=30, stale-while-revalidate=10, max-age=15";
  }
  return "public, s-maxage=300, stale-while-revalidate=60, max-age=60";
}

/**
 * Research aggregates (FPA, SOS, leaders, redzone, …). Cron warms a few times
 * a day — edge can hold for an hour mid-week without stale product risk.
 */
export function researchCacheControl(date = new Date()): string {
  if (isGamedayUtc(date)) {
    return "public, s-maxage=300, stale-while-revalidate=120, max-age=60";
  }
  return "public, s-maxage=3600, stale-while-revalidate=600, max-age=300";
}

/**
 * Player warehouse export. Ingest is daily — long CDN TTL is the main RU shield
 * as session count grows (every client hydrates this).
 */
export function warehouseCacheControl(date = new Date()): string {
  if (isGamedayUtc(date)) {
    return "public, s-maxage=600, stale-while-revalidate=300, max-age=120";
  }
  return "public, s-maxage=3600, stale-while-revalidate=600, max-age=300";
}

export function jsonResponse(data: unknown, init?: { status?: number; cache?: string }): Response {
  const status = init?.status ?? 200;
  const cache = init?.cache ?? (status === 200 ? dataCacheControl() : "no-store");
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": cache,
      vary: "Accept-Encoding",
    },
  });
}
