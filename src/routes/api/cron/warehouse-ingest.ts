import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";

/**
 * Scheduled player_warehouse / master_player_brain harvest.
 * Replaces the previous every-SSR-request bootstrap trigger so Fluid CPU is
 * not spent on warehouse HEAD/GET checks during normal page traffic.
 */
export const Route = createFileRoute("/api/cron/warehouse-ingest")({
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
        const force = url.searchParams.get("force") === "1";

        try {
          const { runScheduledWarehouseIngest } = await import("@/lib/warehouse-bootstrap.server");
          const report = await runScheduledWarehouseIngest({ force });
          return new Response(JSON.stringify(report), {
            status: report.ok ? 200 : 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "warehouse ingest failed";
          console.error("[cron/warehouse-ingest]", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
