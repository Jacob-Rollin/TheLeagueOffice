import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";
import {
  buildUpsertSql,
  chunkRows,
  tidbConfigured,
  tidbExecute,
} from "@/lib/tidb";

type BrainPayload = {
  ids?: string[];
  names?: string[];
  positions?: string[];
  teams?: string[];
  values?: number[];
  injuries?: string[];
  injury_types?: string[];
  injury_notes?: string[];
};

function brainUrl(): string | null {
  const raw =
    process.env["VITE_SUPABASE_URL_B"] ??
    (typeof import.meta !== "undefined"
      ? (import.meta.env["VITE_SUPABASE_URL_B"] as string | undefined)
      : undefined);
  if (!raw) return null;
  const origin = raw.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
  return `${origin}/storage/v1/object/public/player_brain/master_player_brain.json`;
}

/**
 * One-time (or force) seed: master_player_brain.json → TiDB player_warehouse.
 * Auth: CRON_SECRET / Vercel cron header.
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

        const url = brainUrl();
        if (!url) {
          return new Response(
            JSON.stringify({ ok: false, error: "VITE_SUPABASE_URL_B missing" }),
            {
              status: 500,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            },
          );
        }

        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) {
            return new Response(
              JSON.stringify({ ok: false, error: `brain fetch ${res.status}` }),
              {
                status: 502,
                headers: { "content-type": "application/json", "cache-control": "no-store" },
              },
            );
          }
          const brain = (await res.json()) as BrainPayload;
          const ids = Array.isArray(brain.ids) ? brain.ids : [];
          if (ids.length === 0) {
            return new Response(JSON.stringify({ ok: false, error: "empty brain" }), {
              status: 422,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            });
          }

          const cols = [
            "sleeper_id",
            "player_name",
            "position",
            "team",
            "fantasycalc_value",
            "leaguelogs_status",
            "injury_type",
            "injury_notes",
            "updated_at",
          ];
          const updateCols = cols.filter((c) => c !== "sleeper_id");
          const now = new Date().toISOString().slice(0, 19).replace("T", " ");
          const rows: unknown[][] = [];
          for (let i = 0; i < ids.length; i++) {
            const id = String(ids[i] ?? "").slice(0, 32);
            if (!id) continue;
            rows.push([
              id,
              String(brain.names?.[i] ?? "").slice(0, 128) || null,
              String(brain.positions?.[i] ?? "").slice(0, 8) || null,
              String(brain.teams?.[i] ?? "").slice(0, 8) || null,
              Number(brain.values?.[i] ?? 0) || null,
              String(brain.injuries?.[i] ?? "").slice(0, 64) || null,
              String(brain.injury_types?.[i] ?? "").slice(0, 64) || null,
              String(brain.injury_notes?.[i] ?? "") || null,
              now,
            ]);
          }

          let written = 0;
          for (const chunk of chunkRows(rows, 200)) {
            const sql = buildUpsertSql("player_warehouse", cols, chunk.length, updateCols);
            await tidbExecute(sql, chunk.flat());
            written += chunk.length;
          }

          const countRows = await tidbExecute<{ c: number }>(
            "SELECT COUNT(*) AS c FROM player_warehouse",
          );
          return new Response(
            JSON.stringify({
              ok: true,
              written,
              total: Number(countRows[0]?.c ?? written),
            }),
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
