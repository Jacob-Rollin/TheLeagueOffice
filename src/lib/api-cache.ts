/**
 * Shared CDN Cache-Control helpers for Nitro /api data routes.
 * Mid-week: 5 minutes. Gameday (Thu / Sun / Mon UTC): 30 seconds.
 */

export function isGamedayUtc(date = new Date()): boolean {
  const day = date.getUTCDay(); // 0 Sun, 1 Mon, 4 Thu
  return day === 0 || day === 1 || day === 4;
}

export function dataCacheControl(date = new Date()): string {
  if (isGamedayUtc(date)) {
    return "public, s-maxage=30, stale-while-revalidate=10, max-age=15";
  }
  return "public, s-maxage=300, stale-while-revalidate=60, max-age=60";
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
