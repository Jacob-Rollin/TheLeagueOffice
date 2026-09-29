import { createFileRoute } from "@tanstack/react-router";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const CACHE_TTL_MS = 8 * 1000;

/** Shared across visitors so live polling costs one ESPN call per week per TTL. */
const cache = new Map<string, { expires: number; body: Promise<string | null> }>();

function loadScoreboard(target: string): Promise<string | null> {
  const now = Date.now();
  const hit = cache.get(target);
  if (hit && hit.expires > now) return hit.body;

  const body = fetch(target, { headers: { accept: "application/json" } })
    .then((res) => (res.ok ? res.text() : null))
    .catch(() => null);
  cache.set(target, { expires: now + CACHE_TTL_MS, body });
  void body.then((text) => {
    if (text == null && cache.get(target)?.body === body) cache.delete(target);
  });
  return body;
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

        const body = await loadScoreboard(target.toString());
        if (body == null) return new Response("Upstream unavailable", { status: 502 });
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "public, max-age=8",
          },
        });
      },
    },
  },
});
