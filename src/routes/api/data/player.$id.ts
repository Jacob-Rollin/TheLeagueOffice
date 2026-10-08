import { createFileRoute } from "@tanstack/react-router";

import { jsonResponse, warehouseCacheControl } from "@/lib/api-cache";
import { processMemo } from "@/lib/process-memo";
import { tidbConfigured, tidbExecute } from "@/lib/tidb";

type WarehouseRow = {
  sleeper_id: string;
  player_name: string | null;
  position: string | null;
  team: string | null;
  fantasycalc_value: number | null;
  leaguelogs_status: string | null;
  injury_type: string | null;
  injury_notes: string | null;
  updated_at: string | null;
};

export const Route = createFileRoute("/api/data/player/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!tidbConfigured()) {
          return jsonResponse(
            { ok: false, error: "DATABASE_URL not configured", player: null },
            { status: 503, cache: "no-store" },
          );
        }

        const id = String(params.id ?? "").slice(0, 32);
        if (!id) {
          return jsonResponse(
            { ok: false, error: "missing id", player: null },
            { status: 400, cache: "no-store" },
          );
        }

        try {
          const player = await processMemo(`warehouse-player:${id}`, 60_000, async () => {
            const rows = await tidbExecute<WarehouseRow>(
              `SELECT sleeper_id, player_name, position, team, fantasycalc_value,
                      leaguelogs_status, injury_type, injury_notes, updated_at
               FROM player_warehouse
               WHERE sleeper_id = ?
               LIMIT 1`,
              [id],
            );
            return rows[0] ?? null;
          });
          if (!player) {
            return jsonResponse(
              { ok: false, error: "not found", player: null },
              { status: 404, cache: "no-store" },
            );
          }
          return jsonResponse({ ok: true, player }, { cache: warehouseCacheControl() });
        } catch (error) {
          const message = error instanceof Error ? error.message : "query failed";
          console.error("[api/data/player]", message);
          return jsonResponse(
            { ok: false, error: message, player: null },
            { status: 500, cache: "no-store" },
          );
        }
      },
    },
  },
});
