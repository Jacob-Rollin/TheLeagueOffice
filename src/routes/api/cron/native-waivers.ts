import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";

/**
 * Process pending native waiver claims (rolling / reverse / FAAB).
 * Also completes trade veto windows whose veto_until has passed.
 * Triggered by GitHub Actions — not per-visitor.
 */
export const Route = createFileRoute("/api/cron/native-waivers")({
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
        const limit = Number(url.searchParams.get("limit") ?? 20) || 20;
        try {
          const {
            processNativeWaiversCron,
            processNativeTradeVetoWindowsCron,
          } = await import("@/lib/native-league-gameplay.server");
          const [waivers, trades] = await Promise.all([
            processNativeWaiversCron({ ...(leagueId ? { leagueId } : {}), limit }),
            processNativeTradeVetoWindowsCron({ limit: 40 }),
          ]);
          return new Response(JSON.stringify({ ok: true, waivers, trades }), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "native waivers failed";
          console.error("[cron/native-waivers]", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
