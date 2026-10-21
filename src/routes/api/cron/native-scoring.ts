import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";

/**
 * Native scoring cron (TiDB official snaps only).
 * Live Matchup display uses snap-cdn week stats + client overlay — not this route.
 *
 * Query: mode=points|standings|both (default points)
 * - points: week fantasy totals → native_matchup_results; also unsticks leagues behind Sleeper week
 * - standings: finalize completed weeks → W–L/PF/PA snap, then roll current_week to Sleeper week
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
          // Kickoff IR force-resolve for human managers (and AI) across in-season leagues.
          let irEnforcement: {
            ok: boolean;
            leagues: number;
            teams: number;
            actions: number;
            errors: string[];
          } | null = null;
          if (mode === "points" || mode === "both") {
            const { processNativeIrEnforcementCron } = await import(
              "@/lib/native-league-ops.server"
            );
            irEnforcement = await processNativeIrEnforcementCron({
              ...(leagueId ? { leagueId } : {}),
              limit,
            });
          }
          const payload = {
            ...report,
            ...(irEnforcement
              ? {
                  irLeagues: irEnforcement.leagues,
                  irTeams: irEnforcement.teams,
                  irActions: irEnforcement.actions,
                  irErrors: irEnforcement.errors,
                }
              : {}),
          };
          const ok = report.ok && (irEnforcement?.ok !== false);
          return new Response(JSON.stringify(payload), {
            status: ok ? 200 : 500,
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
