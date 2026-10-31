import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";
import type { WeeklyDeskKindFilter } from "@/lib/weekly-desk.server";

function parseKind(request: Request): WeeklyDeskKindFilter {
  try {
    const kind = new URL(request.url).searchParams.get("kind")?.trim().toLowerCase();
    if (kind === "start-sit") return "start-sit";
    if (kind === "waiver" || kind === "all") return "waiver";
  } catch {
    /* ignore */
  }
  return "waiver";
}

/**
 * Auto-publish Front Office Waiver Wire into CMS articles.
 * Prefer Actions cron (CRON_SECRET). Reuses GROQ_API_KEY when set.
 *
 * Query: `?kind=waiver` (default). `?kind=start-sit` is a retired no-op.
 */
export const Route = createFileRoute("/api/cron/weekly-desk")({
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
          const kind = parseKind(request);
          const { processWeeklyDeskCron } = await import("@/lib/weekly-desk.server");
          const report = await processWeeklyDeskCron(kind);
          return new Response(JSON.stringify(report), {
            status: report.ok ? 200 : 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "weekly desk failed";
          console.error("[cron/weekly-desk]", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
