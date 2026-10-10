import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";

/**
 * Tiny Supabase Postgres touch so Free-plan projects are not auto-paused
 * after ~7 days of low database activity.
 *
 * Auth/health pings do NOT count — this must hit PostgREST → Postgres
 * (see https://supabase.com/docs/guides/platform/free-project-pausing).
 * Triggered by GitHub Actions daily; not registered in vercel.json crons
 * (keeps Hobby Fluid off the hot path).
 */
export const Route = createFileRoute("/api/cron/supabase-keepalive")({
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
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          // Service role SELECT — real DB activity even with zero site visitors.
          const { error, count } = await supabaseAdmin
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .limit(1);

          if (error) {
            console.error("[cron/supabase-keepalive]", error.message);
            return new Response(JSON.stringify({ ok: false, error: error.message }), {
              status: 500,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            });
          }

          return new Response(
            JSON.stringify({
              ok: true,
              touched: "profiles",
              count: count ?? null,
              at: new Date().toISOString(),
            }),
            {
              status: 200,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "supabase keepalive failed";
          console.error("[cron/supabase-keepalive]", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
