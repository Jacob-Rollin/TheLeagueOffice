import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";

const FORMATS = ["std", "half", "ppr"] as const;
const REDZONE_YARDLINES = [5, 10, 15, 20] as const;

/**
 * Warm research aggregates into TiDB so page loads never gunzip nflverse PBP,
 * scrape 32 club sites, or fan out 18-week Sleeper stats.
 *
 * Covers all scoring formats (std/half/ppr), matchup weeks 1…current,
 * red-zone yardlines, and Fantasy Leaders.
 */
export const Route = createFileRoute("/api/cron/research-aggregates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorizeCronRequest(request)) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }

        const report: Record<string, unknown> = { ok: true };
        try {
          const { currentSeason } = await import("@/lib/players-build");
          const season = currentSeason();

          // allowCompute: cron is the only path that may gunzip PBP / scrape clubs / fan out SOS.
          const { applyTidbSchema } = await import("@/lib/tidb-migrate.server");
          await applyTidbSchema().catch(() => undefined);

          const stateRes = await fetch("https://api.sleeper.app/v1/state/nfl", {
            headers: { accept: "application/json" },
          }).catch(() => null);
          const state = stateRes?.ok
            ? ((await stateRes.json()) as { week?: number })
            : { week: 1 };
          const week = Math.max(1, Number(state.week) || 1);

          const { loadRedZoneStats } = await import("@/lib/redzone.server");
          const redzoneByYl: Record<string, unknown> = {};
          for (const yl of REDZONE_YARDLINES) {
            const redzone = await loadRedZoneStats(season, yl, null, null, { allowCompute: true });
            redzoneByYl[String(yl)] = {
              season: redzone.season,
              maxWeek: redzone.maxWeek,
              players: Object.values(redzone.rowsByPos).reduce((n, rows) => n + rows.length, 0),
            };
          }
          report["redzone"] = redzoneByYl;

          const { loadMostTargetedPlayers } = await import("@/lib/targets.server");
          const targets = await loadMostTargetedPlayers(season, { allowCompute: true });
          report["targets"] = {
            season: targets.season,
            maxWeek: targets.maxWeek,
            players: targets.rows.length,
          };

          const { loadAreTheyPlaying } = await import("@/lib/are-they-playing.server");
          const atp = await loadAreTheyPlaying(week, { allowCompute: true });
          report["areTheyPlaying"] = { week: atp.week, lines: atp.lines.length };

          const {
            loadSosBoard,
            loadFantasyPointsAllowed,
            loadMatchupsGuide,
            loadSosAnalysis,
            loadFantasyLeaders,
          } = await import("@/lib/players.server");

          const sos = await loadSosBoard(season, { allowCompute: true });
          report["sos"] = {
            season: sos.season,
            dataThroughWeek: sos.dataThroughWeek,
            scheduleGames: sos.schedule.length,
          };

          const fpaByFmt: Record<string, unknown> = {};
          for (const fmt of FORMATS) {
            const fpa = await loadFantasyPointsAllowed(season, fmt, { allowCompute: true });
            fpaByFmt[fmt] = { season: fpa.season, weeksTo: fpa.weeksTo, rows: fpa.rows.length };
          }
          report["fpa"] = fpaByFmt;

          const guideByKey: Record<string, unknown> = {};
          for (let w = 1; w <= week; w += 1) {
            for (const fmt of FORMATS) {
              const guide = await loadMatchupsGuide(w, fmt, { allowCompute: true });
              guideByKey[`${w}|${fmt}`] = {
                week: guide.week,
                games: Object.keys(guide.games).length,
                dataThroughWeek: guide.dataThroughWeek,
              };
            }
          }
          report["matchupsGuide"] = { weeks: week, formats: FORMATS.length, keys: Object.keys(guideByKey).length };

          const analysisByFmt: Record<string, unknown> = {};
          for (const fmt of FORMATS) {
            const analysis = await loadSosAnalysis(fmt, { allowCompute: true });
            analysisByFmt[fmt] = {
              season: analysis.season,
              rows: analysis.rows.length,
              fromWeek: analysis.fromWeek,
            };
          }
          report["sosAnalysis"] = analysisByFmt;

          const leaders = await loadFantasyLeaders(season, { allowCompute: true });
          report["fantasyLeaders"] = {
            season: leaders.season,
            maxWeek: leaders.maxWeek,
            rows: leaders.rows.length,
          };

          // Warm Matchup Replay PBP snaps for completed weeks (and current).
          const { warmWeekPlaysSnapshots } = await import("@/lib/matchup-replay.server");
          const plays = await warmWeekPlaysSnapshots(season, week);
          report["weekPlays"] = plays;

          return new Response(JSON.stringify(report), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "research aggregates failed";
          console.error("[cron/research-aggregates]", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
