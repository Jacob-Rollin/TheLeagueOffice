import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";

/**
 * Centralized league delta-sync heartbeat.
 * Upserts current (+ prior) week matchups for each synced_leagues row so page
 * loads can read from weekly_matchups instead of waiting on Sleeper/ESPN.
 */
export const Route = createFileRoute("/api/cron/league-delta-sync")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorizeCronRequest(request)) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }

        const url = new URL(request.url);
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 40) || 40));

        try {
          const { deltaSyncAllConnections } = await import("@/lib/league-resync.server");
          const report = await deltaSyncAllConnections(limit);
          return new Response(JSON.stringify(report), {
            status: report.ok ? 200 : 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "delta sync failed";
          console.error("[cron/league-delta-sync]", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
