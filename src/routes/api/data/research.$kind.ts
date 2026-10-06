import { createFileRoute } from "@tanstack/react-router";

import { jsonResponse, researchCacheControl } from "@/lib/api-cache";
import { tidbConfigured } from "@/lib/tidb";

function researchOk(payload: unknown, warm: boolean): Response {
  return jsonResponse(payload, {
    cache: warm ? researchCacheControl() : "no-store",
  });
}

type Format = "std" | "half" | "ppr";

function parseFormat(raw: string | null): Format {
  return raw === "std" || raw === "ppr" ? raw : "half";
}

function parseWeekBound(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 22 ? n : null;
}

/**
 * CDN-cached research aggregates. Read-only TiDB SELECTs — never compute/seed.
 * Kinds: fpa | matchups-guide | sos-analysis | fantasy-leaders | sos-board
 *        | redzone | targets | are-they-playing
 *
 * Cold / empty snaps return **200 + no-store** (not 503) so Vercel Observability
 * does not count expected warm-gaps as function errors.
 */
export const Route = createFileRoute("/api/data/research/$kind")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!tidbConfigured()) {
          return jsonResponse(
            { ok: false, error: "DATABASE_URL not configured" },
            { status: 503, cache: "no-store" },
          );
        }

        const kind = String(params.kind ?? "").toLowerCase();
        const url = new URL(request.url);
        const format = parseFormat(url.searchParams.get("format"));
        const season = url.searchParams.get("season")?.slice(0, 16) || undefined;
        const weekRaw = url.searchParams.get("week");
        const weekN = weekRaw != null ? Math.round(Number(weekRaw)) : null;
        const week =
          weekN != null && Number.isFinite(weekN) && weekN >= 1 && weekN <= 18 ? weekN : null;

        try {
          if (
            kind === "fpa" ||
            kind === "matchups-guide" ||
            kind === "sos-analysis" ||
            kind === "fantasy-leaders" ||
            kind === "sos-board"
          ) {
            const players = await import("@/lib/players.server");

            if (kind === "fpa") {
              const payload = await players.loadFantasyPointsAllowed(season, format);
              return researchOk(payload, payload.rows.length > 0);
            }

            if (kind === "matchups-guide") {
              const payload = await players.loadMatchupsGuide(week, format);
              const warm =
                Object.keys(payload.games).length > 0 || Object.keys(payload.defense).length > 0;
              return researchOk(payload, warm);
            }

            if (kind === "sos-analysis") {
              const payload = await players.loadSosAnalysis(format);
              return researchOk(payload, payload.rows.length > 0);
            }

            if (kind === "fantasy-leaders") {
              // Self-heal a cold/empty TiDB snap once (cron also rebuilds). Empty snaps
              // used to pin forever because withResearchSnap treated them as hits.
              let payload = await players.loadFantasyLeaders(season);
              if (!payload.rows.length) {
                payload = await players.loadFantasyLeaders(season, { allowCompute: true });
              }
              return researchOk(payload, payload.rows.length > 0);
            }

            const payload = await players.loadSosBoard(season);
            return researchOk(payload, payload.schedule.length > 0);
          }

          if (kind === "redzone") {
            const { loadRedZoneStats } = await import("@/lib/redzone.server");
            const yardlineRaw = Number(url.searchParams.get("yardline") ?? 20);
            const yardline =
              yardlineRaw === 5 || yardlineRaw === 10 || yardlineRaw === 15 || yardlineRaw === 20
                ? yardlineRaw
                : 20;
            const payload = await loadRedZoneStats(
              season,
              yardline,
              parseWeekBound(url.searchParams.get("weekFrom")),
              parseWeekBound(url.searchParams.get("weekTo")),
            );
            const warm = Object.values(payload.rowsByPos).some((rows) => rows.length > 0);
            return researchOk(payload, warm);
          }

          if (kind === "targets") {
            const { loadMostTargetedPlayers } = await import("@/lib/targets.server");
            const payload = await loadMostTargetedPlayers(season);
            return researchOk(payload, payload.rows.length > 0);
          }

          if (kind === "are-they-playing") {
            const { loadAreTheyPlaying } = await import("@/lib/are-they-playing.server");
            const payload = await loadAreTheyPlaying(week ?? 1);
            return researchOk(payload, payload.lines.length > 0);
          }

          return jsonResponse(
            {
              ok: false,
              error: "unknown research kind",
              kind,
              known: [
                "fpa",
                "matchups-guide",
                "sos-analysis",
                "fantasy-leaders",
                "sos-board",
                "redzone",
                "targets",
                "are-they-playing",
              ],
            },
            { status: 404, cache: "no-store" },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "research data failed";
          console.error(`[api/data/research/${kind}]`, message);
          return jsonResponse({ ok: false, error: message }, { status: 500, cache: "no-store" });
        }
      },
    },
  },
});
