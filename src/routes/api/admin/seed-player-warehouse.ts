import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";
import { loadSeedRowsFromSupabase, seedPlayerWarehouse } from "@/lib/tidb-migrate.server";
import { tidbConfigured } from "@/lib/tidb";

/**
 * One-time seed: Supabase brain (or warehouse table) → TiDB player_warehouse.
 * Prefer POST /api/admin/tidb-migrate with action "migrate" (schema + seed).
 */
export const Route = createFileRoute("/api/admin/seed-player-warehouse")({
  server: {
    handlers: {
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

        try {
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
          const result = await seedPlayerWarehouse(loaded.rows);
          return new Response(
            JSON.stringify({ ok: true, source: loaded.source, ...result }),
            {
              status: 200,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "seed failed";
          console.error("[admin/seed-player-warehouse]", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
