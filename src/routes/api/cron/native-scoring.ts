import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";

/**
 * Apply Sleeper week stats → native_lineups / native_matchup_results / standings snap.
 * Prefer Actions cron (CRON_SECRET). Soft-empty browse paths read the snaps.
 */
export const Route = createFileRoute("/api/cron/native-scoring")({
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
        const leagueId = url.searchParams.get("leagueId")?.trim() || undefined;
        const weekRaw = url.searchParams.get("week");
        const week = weekRaw != null && weekRaw !== "" ? Number(weekRaw) : undefined;
        const limit = Number(url.searchParams.get("limit") ?? 15) || 15;
        try {
          const { processNativeScoringCron } = await import("@/lib/native-league-gameplay.server");
          const report = await processNativeScoringCron({
            ...(leagueId ? { leagueId } : {}),
            ...(week != null && Number.isFinite(week) ? { week } : {}),
            limit,
          });
          return new Response(JSON.stringify(report), {
            status: report.ok ? 200 : 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "native scoring failed";
          console.error("[cron/native-scoring]", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
