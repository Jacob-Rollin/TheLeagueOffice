import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";

/**
 * Native scoring cron (TiDB official snaps only).
 * Live Matchup display uses snap-cdn week stats + client overlay — not this route.
 *
 * Query: mode=points|standings|both (default points)
 * - points: week fantasy totals → native_matchup_results (infrequent)
 * - standings: finalize W–L snap after the week’s games (weekly)
 * - both: points then standings
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
        const modeRaw = String(url.searchParams.get("mode") ?? "points").toLowerCase();
        const mode =
          modeRaw === "standings" || modeRaw === "both" ? (modeRaw as "standings" | "both") : "points";
        try {
          const { processNativeScoringCron } = await import("@/lib/native-league-gameplay.server");
          const report = await processNativeScoringCron({
            ...(leagueId ? { leagueId } : {}),
            ...(week != null && Number.isFinite(week) ? { week } : {}),
            limit,
            mode,
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
