import { createFileRoute } from "@tanstack/react-router";

import { jsonResponse, researchCacheControl } from "@/lib/api-cache";
import { processMemo } from "@/lib/process-memo";

/**
 * Edge-cached snapshots for heavy Fluid loaders that are not yet TiDB-backed.
 * First miss after CDN TTL pays one compute; everyone else hits the edge.
 *
 * Kinds: trade-basis | injury-reports | injury-wire | fantasy-news |
 * trade-market | roster-news | ros | slot-ranks
 */
export const Route = createFileRoute("/api/data/snap/$kind")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const kind = String(params.kind ?? "").toLowerCase();
        const url = new URL(request.url);
        const format = url.searchParams.get("format");
        const limit = Math.max(1, Math.min(60, Number(url.searchParams.get("limit") ?? 40) || 40));

        try {
          if (kind === "trade-basis") {
            const payload = await processMemo("snap:trade-basis", 30 * 60 * 1000, async () => {
              const { loadTradeValueBasis } = await import("@/lib/players.server");
              return loadTradeValueBasis();
            });
            const warm = Boolean(payload?.players && Object.keys(payload.players).length > 0);
            return jsonResponse(payload, { cache: warm ? researchCacheControl() : "no-store" });
          }

          if (kind === "injury-reports") {
            const payload = await processMemo("snap:injury-reports", 10 * 60 * 1000, async () => {
              const { loadInjuryReports } = await import("@/lib/players.server");
              return loadInjuryReports();
            });
            const warm = Array.isArray(payload?.items) && payload.items.length > 0;
            return jsonResponse(payload, { cache: warm ? researchCacheControl() : "no-store" });
          }

          if (kind === "injury-wire") {
            const payload = await processMemo(`snap:injury-wire:${limit}`, 10 * 60 * 1000, async () => {
              const { loadInjuryWire } = await import("@/lib/players.server");
              return loadInjuryWire(limit);
            });
            const warm = Array.isArray(payload) ? payload.length > 0 : Array.isArray((payload as { items?: unknown[] })?.items);
            return jsonResponse(payload, { cache: warm ? researchCacheControl() : "no-store" });
          }

          if (kind === "fantasy-news") {
            const payload = await processMemo(`snap:fantasy-news:${limit}`, 15 * 60 * 1000, async () => {
              const { loadFantasyNewsFeed } = await import("@/lib/players.server");
              return loadFantasyNewsFeed(limit);
            });
            const warm = Array.isArray(payload) && payload.length > 0;
            return jsonResponse(payload, { cache: warm ? researchCacheControl() : "no-store" });
          }

          if (kind === "trade-market") {
            const fmt = format === "std" || format === "ppr" ? format : "half";
            const payload = await processMemo(`snap:trade-market:${fmt}`, 30 * 60 * 1000, async () => {
              const { loadTradeMarket } = await import("@/lib/trade-market.server");
              return loadTradeMarket(fmt);
            });
            const warm = Array.isArray((payload as { rows?: unknown[] })?.rows) && (payload as { rows: unknown[] }).rows.length > 0;
            return jsonResponse(payload, { cache: warm ? researchCacheControl() : "no-store" });
          }

          if (kind === "roster-news") {
            const ids = String(url.searchParams.get("ids") ?? "")
              .split(",")
              .map((id) => id.trim().slice(0, 32))
              .filter(Boolean)
              .slice(0, 30);
            const key = ids.slice().sort().join(",");
            const payload = await processMemo(`snap:roster-news:${key || "empty"}`, 5 * 60 * 1000, async () => {
              const { loadRosterNews } = await import("@/lib/players.server");
              return loadRosterNews(ids);
            });
            const warm = Array.isArray(payload?.players) && payload.players.length > 0;
            return jsonResponse(payload, { cache: warm ? researchCacheControl() : "no-store" });
          }

          if (kind === "ros" || kind === "slot-ranks") {
            const league = String(url.searchParams.get("league") ?? "").slice(0, 64);
            const from = Math.max(1, Math.min(18, Number(url.searchParams.get("from") ?? 1) || 1));
            const to = Math.max(from, Math.min(18, Number(url.searchParams.get("to") ?? from) || from));
            if (!/^\d{6,}$/.test(league)) {
              return jsonResponse({ ok: false, error: "invalid league" }, { status: 400, cache: "no-store" });
            }
            const memoKey = `snap:${kind}:${league}:${from}:${to}`;
            const payload = await processMemo(memoKey, 15 * 60 * 1000, async () => {
              const mod = await import("@/lib/standings-projections.server");
              if (kind === "ros") {
                return mod.loadRestOfSeasonProjections(league, "sleeper", from, to);
              }
              return mod.loadStartingSlotRanks(league, "sleeper", from, to);
            });
            const warm =
              kind === "ros"
                ? Array.isArray((payload as { weeks?: unknown[] })?.weeks) &&
                  ((payload as { weeks: unknown[] }).weeks.length > 0)
                : Array.isArray((payload as { teams?: unknown[] })?.teams) &&
                  ((payload as { teams: unknown[] }).teams.length > 0);
            return jsonResponse(payload, { cache: warm ? researchCacheControl() : "no-store" });
          }

          return jsonResponse({ ok: false, error: `unknown kind ${kind}` }, { status: 404, cache: "no-store" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "snap failed";
          console.error("[api/data/snap]", kind, message);
          return jsonResponse({ ok: false, error: message }, { status: 500, cache: "no-store" });
        }
      },
    },
  },
});
