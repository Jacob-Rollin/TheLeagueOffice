import { createFileRoute } from "@tanstack/react-router";

import { jsonResponse } from "@/lib/api-cache";
import { tidbConfigured } from "@/lib/tidb";

type Format = "std" | "half" | "ppr";

function parseFormat(raw: string | null): Format {
  return raw === "std" || raw === "ppr" ? raw : "half";
}

/**
 * CDN-cached research aggregates. Read-only TiDB SELECTs — never compute/seed.
 * Kinds: fpa | matchups-guide | sos-analysis | fantasy-leaders | sos-board
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
          const players = await import("@/lib/players.server");

          if (kind === "fpa") {
            const payload = await players.loadFantasyPointsAllowed(season, format);
            if (!payload.rows.length) {
              return jsonResponse(
                { ok: false, error: "fpa snap not warm", format },
                { status: 503, cache: "no-store" },
              );
            }
            return jsonResponse(payload);
          }

          if (kind === "matchups-guide") {
            const payload = await players.loadMatchupsGuide(week, format);
            if (!Object.keys(payload.games).length && !Object.keys(payload.defense).length) {
              return jsonResponse(
                { ok: false, error: "matchups-guide snap not warm", week, format },
                { status: 503, cache: "no-store" },
              );
            }
            return jsonResponse(payload);
          }

          if (kind === "sos-analysis") {
            const payload = await players.loadSosAnalysis(format);
            if (!payload.rows.length) {
              return jsonResponse(
                { ok: false, error: "sos-analysis snap not warm", format },
                { status: 503, cache: "no-store" },
              );
            }
            return jsonResponse(payload);
          }

          if (kind === "fantasy-leaders") {
            const payload = await players.loadFantasyLeaders(season);
            if (!payload.rows.length) {
              return jsonResponse(
                { ok: false, error: "fantasy-leaders snap not warm", season: payload.season },
                { status: 503, cache: "no-store" },
              );
            }
            return jsonResponse(payload);
          }

          if (kind === "sos-board") {
            const payload = await players.loadSosBoard(season);
            if (!payload.schedule.length) {
              return jsonResponse(
                { ok: false, error: "sos-board snap not warm", season: payload.season },
                { status: 503, cache: "no-store" },
              );
            }
            return jsonResponse(payload);
          }

          return jsonResponse(
            {
              ok: false,
              error: "unknown research kind",
              kind,
              known: ["fpa", "matchups-guide", "sos-analysis", "fantasy-leaders", "sos-board"],
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
