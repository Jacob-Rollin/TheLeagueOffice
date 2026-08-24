import { createFileRoute } from "@tanstack/react-router";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

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

        try {
          const res = await fetch(target.toString(), {
            headers: { accept: "application/json" },
          });
          if (!res.ok) return new Response("Upstream error", { status: 502 });
          const body = await res.text();
          return new Response(body, {
            status: 200,
            headers: {
              "content-type": "application/json",
              "cache-control": "public, max-age=20",
            },
          });
        } catch {
          return new Response("Upstream unavailable", { status: 502 });
        }
      },
    },
  },
});
