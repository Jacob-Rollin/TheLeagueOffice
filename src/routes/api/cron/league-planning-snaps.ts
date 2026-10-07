import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";

/**
 * Warm ROS + Starting Slot Ranks for active Sleeper leagues so My Team
 * Recommendation / Bye Planner / Standings slot ranks hit CDN instead of
 * computing on browse (Fluid).
 *
 * GitHub Actions should call this, then optionally re-hit /api/data/snap/*
 * URLs to seed the edge cache.
 */
export const Route = createFileRoute("/api/cron/league-planning-snaps")({
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
        // Free-tier default: small batch. Browse uses client ROS when CDN/API is cold.
        const limit = Math.max(1, Math.min(60, Number(url.searchParams.get("limit") ?? 12) || 12));

        try {
          const stateRes = await fetch("https://api.sleeper.app/v1/state/nfl", {
            headers: { accept: "application/json" },
          }).catch(() => null);
          const state = stateRes?.ok
            ? ((await stateRes.json()) as { week?: number })
            : { week: 1 };
          const fromWeek = Math.max(1, Math.min(17, Number(state.week) || 1));
          const toWeek = 17;

          const { listActiveSleeperLeagueIds } = await import("@/lib/league-resync.server");
          const leagues = await listActiveSleeperLeagueIds(limit);
          const {
            loadRestOfSeasonProjections,
            loadStartingSlotRanks,
          } = await import("@/lib/standings-projections.server");

          const results: {
            leagueId: string;
            rosWeeks: number;
            slotTeams: number;
            error?: string;
          }[] = [];

          for (const { leagueId } of leagues) {
            try {
              // Compute once in this isolate — do not re-hit /api/data/snap/* (doubled Fluid).
              const [ros, slots] = await Promise.all([
                loadRestOfSeasonProjections(leagueId, "sleeper", fromWeek, toWeek),
                loadStartingSlotRanks(leagueId, "sleeper", fromWeek, toWeek),
              ]);
              results.push({
                leagueId,
                rosWeeks: Array.isArray(ros?.weeks) ? ros.weeks.length : 0,
                slotTeams: Array.isArray(slots?.teams) ? slots.teams.length : 0,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : "warm failed";
              results.push({ leagueId, rosWeeks: 0, slotTeams: 0, error: message });
            }
          }

          const ok = results.some((r) => r.rosWeeks > 0 || r.slotTeams > 0) || results.length === 0;
          return new Response(
            JSON.stringify({
              ok,
              fromWeek,
              toWeek,
              processed: results.length,
              results,
            }),
            {
              status: ok ? 200 : 500,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "planning snaps failed";
          console.error("[cron/league-planning-snaps]", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
