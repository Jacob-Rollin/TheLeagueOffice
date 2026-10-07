import { createFileRoute } from "@tanstack/react-router";

import { isWeekRollWindowUtc } from "@/lib/api-cache";
import { authorizeCronRequest } from "@/lib/cron-auth.server";

/**
 * Centralized league delta-sync heartbeat (triggered by GitHub Actions).
 * Upserts current (+ prior) week matchups so page loads read CDN/TiDB instead
 * of Fluid. Optional fillSeason backfills missing weeks 1–17 for schedule
 * surfaces (My Team / Matchup week picker).
 *
 * Observability note: outbound `api.sleeper.app` from this route shows up on
 * Vercel as Sleeper traffic — it is cron warm, not playbook browse (browse is
 * browser→Sleeper + CDN). Empty-cache detection must include TiDB or mid-week
 * runs accidentally full-backfill weeks 1–17 every pass.
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
        const fillSeason =
          url.searchParams.get("fillSeason") === "1" ||
          url.searchParams.get("fillSeason") === "true";
        // Bare Vercel cron hits (no query string) must stay lean — week-roll
        // used to default limit=80 and pull every platform, burning Sleeper + TiDB overnight.
        const recentFirst =
          url.searchParams.get("recentFirst") === "1" ||
          url.searchParams.get("recentFirst") === "true" ||
          (weekRoll && url.searchParams.get("recentFirst") !== "0");
        const sleeperOnly =
          url.searchParams.get("sleeperOnly") !== "0" &&
          url.searchParams.get("sleeperOnly") !== "false";
        const defaultLimit = fillSeason ? 20 : weekRoll ? 15 : 12;
        const limit = Math.max(
          1,
          Math.min(200, Number(url.searchParams.get("limit") ?? defaultLimit) || defaultLimit),
        );

        try {
          const { deltaSyncAllConnections } = await import("@/lib/league-resync.server");
          const report = await deltaSyncAllConnections({
            limit,
            fillSeason,
            recentFirst,
            sleeperOnly,
          });
          return new Response(
            JSON.stringify({ ...report, weekRoll, limit, fillSeason, recentFirst, sleeperOnly }),
            {
              status: report.ok ? 200 : 500,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            },
          );
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
