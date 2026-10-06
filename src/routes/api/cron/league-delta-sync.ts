import { createFileRoute } from "@tanstack/react-router";

import { isWeekRollWindowUtc } from "@/lib/api-cache";
import { authorizeCronRequest } from "@/lib/cron-auth.server";

/**
 * Centralized league delta-sync heartbeat.
 * Upserts current (+ prior) week matchups for each synced_leagues row so page
 * loads can read from weekly_matchups instead of waiting on Sleeper/ESPN.
 *
 * Early Tuesday (~1am ET / 05:00 UTC week-roll window) processes a larger
 * batch so coaching/standings/avg-PF history sees finalized prior-week scores.
 * Live matchup cadence is unchanged — this only warms completed-week boards.
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
        const weekRoll = isWeekRollWindowUtc();
        const defaultLimit = weekRoll ? 100 : 40;
        const limit = Math.max(
          1,
          Math.min(200, Number(url.searchParams.get("limit") ?? defaultLimit) || defaultLimit),
        );

        try {
          const { deltaSyncAllConnections } = await import("@/lib/league-resync.server");
          const report = await deltaSyncAllConnections(limit);
          return new Response(JSON.stringify({ ...report, weekRoll, limit }), {
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
