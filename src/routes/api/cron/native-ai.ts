import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";

/**
 * AI manager tick for native leagues (testing): fill on-clock AI draft picks
 * and set weekly AI lineups. Prefer Actions cron (CRON_SECRET).
 * Uses one shared memoized player catalog per invocation — no visitor Fluid fan-out.
 */
export const Route = createFileRoute("/api/cron/native-ai")({
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
        const limit = Number(url.searchParams.get("limit") ?? 12) || 12;
        try {
          const { processNativeAiCron } = await import("@/lib/native-league-ai.server");
          const report = await processNativeAiCron({
            ...(leagueId ? { leagueId } : {}),
            limit,
          });
          return new Response(JSON.stringify(report), {
            status: report.ok ? 200 : 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "native ai failed";
          console.error("[cron/native-ai]", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
