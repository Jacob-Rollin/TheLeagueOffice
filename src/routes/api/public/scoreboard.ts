import { createFileRoute } from "@tanstack/react-router";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

/** In-process dedupe for concurrent visitors on the same instance. */
const LIVE_TTL_MS = 15 * 1000;
const IDLE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expires: number; body: Promise<string | null>; live: boolean }>();

/* eslint-disable @typescript-eslint/no-explicit-any */
function responseHasLiveGame(text: string): boolean {
  try {
    const json = JSON.parse(text) as any;
    const events: any[] = Array.isArray(json?.events) ? json.events : [];
    return events.some((ev) => {
      const state = String(
        ev?.competitions?.[0]?.status?.type?.state ?? ev?.status?.type?.state ?? "",
      );
      return state.toLowerCase() === "in";
    });
  } catch {
    return false;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function cacheControlFor(live: boolean): string {
  // CDN (s-maxage) collapses Fluid CPU across visitors. Browser poll cadence
  // (usePublicScoreboard) still counts each hit toward Hobby CDN Requests —
  // idle boards stay longer so mid-week tabs do not revalidate every minute.
  if (live) {
    return "public, s-maxage=15, stale-while-revalidate=60, max-age=10";
  }
  // max-age must cover quiet browser polls or every tab revalidates through CDN
  // even when React Query waits 10m (Hobby counts CDN HITs).
  return "public, s-maxage=600, stale-while-revalidate=600, max-age=300";
}

function loadScoreboard(target: string): Promise<{ body: string | null; live: boolean }> {
  const now = Date.now();
  const hit = cache.get(target);
  if (hit && hit.expires > now) {
    return hit.body.then((body) => ({ body, live: hit.live }));
  }

  const body = fetch(target, { headers: { accept: "application/json" } })
    .then((res) => (res.ok ? res.text() : null))
    .catch(() => null);

  // Optimistic live TTL until the body resolves and we know the real cadence.
  cache.set(target, { expires: now + LIVE_TTL_MS, body, live: true });

  return body.then((text) => {
    const live = text != null ? responseHasLiveGame(text) : false;
    if (text == null) {
      if (cache.get(target)?.body === body) cache.delete(target);
      return { body: null, live: false };
    }
    const ttl = live ? LIVE_TTL_MS : IDLE_TTL_MS;
    cache.set(target, { expires: Date.now() + ttl, body: Promise.resolve(text), live });
    return { body: text, live };
  });
}

/**
 * Same-origin scoreboard proxy — fallback only.
 * Browse prefers visitor→site.api.espn.com (CORS *). Keep this warm for
 * environments that block the direct host.
 */
export const Route = createFileRoute("/api/public/scoreboard")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const incoming = new URL(request.url);
        const week = incoming.searchParams.get("week");
        const seasontype = incoming.searchParams.get("seasontype");
        const target = new URL(ESPN);
        if (week) target.searchParams.set("week", week);
        if (seasontype) target.searchParams.set("seasontype", seasontype);

        const { body, live } = await loadScoreboard(target.toString());
        if (body == null) return new Response("Upstream unavailable", { status: 502 });
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": cacheControlFor(live),
            vary: "Accept-Encoding",
          },
        });
      },
    },
  },
});
