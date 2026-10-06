import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";
import {
  applyTidbSchema,
  loadSeedRowsFromSupabase,
  seedPlayerWarehouse,
  tidbWarehouseStatus,
} from "@/lib/tidb-migrate.server";
import { tidbConfigured } from "@/lib/tidb";

/**
 * TiDB cutover control plane.
 * GET  → status
 * POST → { action: "schema" | "seed" | "migrate" }  (migrate = schema + seed)
 */
export const Route = createFileRoute("/api/admin/tidb-migrate")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorizeCronRequest(request)) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
        try {
          const status = await tidbWarehouseStatus();
          return new Response(JSON.stringify({ ok: true, ...status }), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "status failed";
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },

      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
        if (!tidbConfigured()) {
          return new Response(
            JSON.stringify({ ok: false, error: "DATABASE_URL not configured" }),
            {
              status: 503,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            },
          );
        }

        let action = "migrate";
        try {
          const body = (await request.json().catch(() => ({}))) as { action?: string };
          action = String(body.action ?? "migrate").toLowerCase();
        } catch {
          action = "migrate";
        }

        try {
          const report: Record<string, unknown> = { ok: true, action };

          if (action === "schema" || action === "migrate") {
            report["schema"] = await applyTidbSchema();
          }

          if (action === "seed" || action === "migrate") {
            const loaded = await loadSeedRowsFromSupabase();
            if (loaded.rows.length < 100) {
              return new Response(
                JSON.stringify({
                  ok: false,
                  error: `seed source too small (${loaded.rows.length})`,
                  source: loaded.source,
                }),
                {
                  status: 422,
                  headers: { "content-type": "application/json", "cache-control": "no-store" },
                },
              );
            }
            const seeded = await seedPlayerWarehouse(loaded.rows);
            report["seed"] = { source: loaded.source, ...seeded };
          }

          report["status"] = await tidbWarehouseStatus();
          return new Response(JSON.stringify(report), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "migrate failed";
          console.error("[admin/tidb-migrate]", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
