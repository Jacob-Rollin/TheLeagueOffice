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
          const players = await import("@/lib/players.server");

          if (kind === "fpa") {
            const payload = await players.loadFantasyPointsAllowed(season, format);
            return jsonResponse(payload, {
              cache: payload.rows.length ? undefined : "no-store",
            });
          }

          if (kind === "matchups-guide") {
            const payload = await players.loadMatchupsGuide(week, format);
            const warm =
              Object.keys(payload.games).length > 0 || Object.keys(payload.defense).length > 0;
            return jsonResponse(payload, { cache: warm ? undefined : "no-store" });
          }

          if (kind === "sos-analysis") {
            const payload = await players.loadSosAnalysis(format);
            return jsonResponse(payload, {
              cache: payload.rows.length ? undefined : "no-store",
            });
          }

          if (kind === "fantasy-leaders") {
            const payload = await players.loadFantasyLeaders(season);
            return jsonResponse(payload, {
              cache: payload.rows.length ? undefined : "no-store",
            });
          }

          if (kind === "sos-board") {
            const payload = await players.loadSosBoard(season);
            return jsonResponse(payload, {
              cache: payload.schedule.length ? undefined : "no-store",
            });
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
