import { createFileRoute } from "@tanstack/react-router";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

/** In-process dedupe for concurrent visitors on the same instance. */
const LIVE_TTL_MS = 15 * 1000;
const IDLE_TTL_MS = 60 * 1000;
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
  // CDN (s-maxage) is what collapses Fluid CPU: browsers may revalidate sooner,
  // but Vercel Edge serves the shared copy without reopening a serverless wait.
  if (live) {
    return "public, s-maxage=15, stale-while-revalidate=60, max-age=10";
  }
  return "public, s-maxage=60, stale-while-revalidate=300, max-age=30";
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

/** Same-origin proxy for the ESPN scoreboard (ESPN sends no CORS headers). */
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
