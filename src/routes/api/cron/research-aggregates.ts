import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";

const FORMATS = ["std", "half", "ppr"] as const;
const REDZONE_YARDLINES = [5, 10, 15, 20] as const;

async function section<T>(
  report: Record<string, unknown>,
  key: string,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    const value = await run();
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cron/research-aggregates] ${key}`, message);
    report[key] = { ok: false, error: message };
    report["partialErrors"] = [...((report["partialErrors"] as string[]) ?? []), key];
    return null;
  }
}

/**
 * Warm research aggregates into TiDB so page loads never gunzip nflverse PBP,
 * scrape 32 club sites, or fan out 18-week Sleeper stats.
 *
 * Covers all scoring formats (std/half/ppr), matchup weeks 1…current,
 * red-zone yardlines, and Fantasy Leaders. Sections are isolated so one
 * failure does not 500 the whole cron (keeps Vercel error rate honest).
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

        const report: Record<string, unknown> = { ok: true, partialErrors: [] as string[] };
        try {
          const { currentSeason } = await import("@/lib/players-build");
          const season = currentSeason();

          // Schema migrate only on explicit ?migrate=1 — daily apply was burning TiDB RUs.
          const url = new URL(request.url);
          if (url.searchParams.get("migrate") === "1") {
            const { applyTidbSchema } = await import("@/lib/tidb-migrate.server");
            await applyTidbSchema().catch(() => undefined);
          }

          const stateRes = await fetch("https://api.sleeper.app/v1/state/nfl", {
            headers: { accept: "application/json" },
          }).catch(() => null);
          const state = stateRes?.ok
            ? ((await stateRes.json()) as { week?: number })
            : { week: 1 };
          const week = Math.max(1, Number(state.week) || 1);

          // Lightweight Mon–Fri practice refresh: scrape ATP only (no redzone /
          // nflverse / SOS). Keeps Fluid Active CPU bounded while practice marks
          // still update after afternoon club reports.
          const only = (url.searchParams.get("only") ?? "").toLowerCase();
          const onlyAtp = only === "are-they-playing" || only === "atp";

          const { loadAreTheyPlaying } = await import("@/lib/are-they-playing.server");
          const atp = await section(report, "areTheyPlaying", () =>
            loadAreTheyPlaying(week, { allowCompute: true }),
          );
          if (atp) {
            report["areTheyPlaying"] = { week: atp.week, lines: atp.lines.length };
          }
          if (onlyAtp) {
            const partial = (report["partialErrors"] as string[]) ?? [];
            report["ok"] = partial.length === 0;
            report["only"] = "are-they-playing";
            return new Response(JSON.stringify(report), {
              status: 200,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            });
          }

          const { loadRedZoneStats } = await import("@/lib/redzone.server");
          const redzoneByYl: Record<string, unknown> = {};
          for (const yl of REDZONE_YARDLINES) {
            const redzone = await section(report, `redzone:${yl}`, () =>
              loadRedZoneStats(season, yl, null, null, { allowCompute: true }),
            );
            if (redzone) {
              redzoneByYl[String(yl)] = {
                season: redzone.season,
                maxWeek: redzone.maxWeek,
                players: Object.values(redzone.rowsByPos).reduce((n, rows) => n + rows.length, 0),
              };
            }
          }
          report["redzone"] = redzoneByYl;

          const { loadMostTargetedPlayers } = await import("@/lib/targets.server");
          const targets = await section(report, "targets", () =>
            loadMostTargetedPlayers(season, { allowCompute: true }),
          );
          if (targets) {
            report["targets"] = {
              season: targets.season,
              maxWeek: targets.maxWeek,
              players: targets.rows.length,
            };
          }

          const {
            loadSosBoard,
            loadFantasyPointsAllowed,
            loadMatchupsGuide,
            loadSosAnalysis,
            loadFantasyLeaders,
          } = await import("@/lib/players.server");

          const sos = await section(report, "sos", () =>
            loadSosBoard(season, { allowCompute: true }),
          );
          if (sos) {
            report["sos"] = {
              season: sos.season,
              dataThroughWeek: sos.dataThroughWeek,
              scheduleGames: sos.schedule.length,
            };
          }

          const fpaByFmt: Record<string, unknown> = {};
          for (const fmt of FORMATS) {
            const fpa = await section(report, `fpa:${fmt}`, () =>
              loadFantasyPointsAllowed(season, fmt, { allowCompute: true }),
            );
            if (fpa) {
              fpaByFmt[fmt] = { season: fpa.season, weeksTo: fpa.weeksTo, rows: fpa.rows.length };
            }
          }
          report["fpa"] = fpaByFmt;

          let guideKeys = 0;
          for (let w = 1; w <= week; w += 1) {
            for (const fmt of FORMATS) {
              const guide = await section(report, `matchupsGuide:${w}|${fmt}`, () =>
                loadMatchupsGuide(w, fmt, { allowCompute: true }),
              );
              if (guide) guideKeys += 1;
            }
          }
          report["matchupsGuide"] = { weeks: week, formats: FORMATS.length, keys: guideKeys };

          const analysisByFmt: Record<string, unknown> = {};
          for (const fmt of FORMATS) {
            const analysis = await section(report, `sosAnalysis:${fmt}`, () =>
              loadSosAnalysis(fmt, { allowCompute: true }),
            );
            if (analysis) {
              analysisByFmt[fmt] = {
                season: analysis.season,
                rows: analysis.rows.length,
                fromWeek: analysis.fromWeek,
              };
            }
          }
          report["sosAnalysis"] = analysisByFmt;

          const leaders = await section(report, "fantasyLeaders", () =>
            loadFantasyLeaders(season, { allowCompute: true }),
          );
          if (leaders) {
            report["fantasyLeaders"] = {
              season: leaders.season,
              maxWeek: leaders.maxWeek,
              rows: leaders.rows.length,
            };
          }

          // Warm Matchup Replay PBP snaps for completed weeks (and current).
          const { warmWeekPlaysSnapshots } = await import("@/lib/matchup-replay.server");
          const plays = await section(report, "weekPlays", () =>
            warmWeekPlaysSnapshots(season, week),
          );
          if (plays) report["weekPlays"] = plays;

          const partial = (report["partialErrors"] as string[]) ?? [];
          report["ok"] = partial.length === 0;
          // Always 200 when auth succeeded — partial section failures are in the body.
          // A top-level 500 here was inflating Vercel function error rate on warm runs.
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
