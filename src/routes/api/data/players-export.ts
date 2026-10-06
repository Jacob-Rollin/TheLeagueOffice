import { createFileRoute } from "@tanstack/react-router";

import { jsonResponse } from "@/lib/api-cache";
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
};

/**
 * Compact warehouse dump for client brain hydration (replaces master_player_brain.json).
 * CDN-cached; single response instead of paginated fan-out.
 */
export const Route = createFileRoute("/api/data/players-export")({
  server: {
    handlers: {
      GET: async () => {
        if (!tidbConfigured()) {
          return jsonResponse(
            { ok: false, error: "DATABASE_URL not configured" },
            { status: 503, cache: "no-store" },
          );
        }

        try {
          const rows = await tidbExecute<WarehouseRow>(
            `SELECT sleeper_id, player_name, position, team, fantasycalc_value,
                    leaguelogs_status, injury_type, injury_notes
             FROM player_warehouse
             ORDER BY player_name ASC
             LIMIT 5000`,
          );
          if (rows.length < 100) {
            return jsonResponse(
              { ok: false, error: "warehouse not seeded", count: rows.length },
              { status: 503, cache: "no-store" },
            );
          }

          const ids: string[] = [];
          const names: string[] = [];
          const positions: string[] = [];
          const teams: string[] = [];
          const values: number[] = [];
          const injuries: string[] = [];
          const injury_types: string[] = [];
          const injury_notes: string[] = [];

          for (const r of rows) {
            ids.push(r.sleeper_id);
            names.push(r.player_name ?? "");
            positions.push(r.position ?? "");
            teams.push(r.team ?? "");
            values.push(Number(r.fantasycalc_value ?? 0) || 0);
            injuries.push(r.leaguelogs_status ?? "Healthy");
            injury_types.push(r.injury_type ?? "");
            injury_notes.push(r.injury_notes ?? "");
          }

          return jsonResponse({
            ok: true,
            v: 7,
            generated_at: new Date().toISOString(),
            count: ids.length,
            ids,
            names,
            positions,
            teams,
            values,
            injuries,
            injury_types,
            injury_notes,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "export failed";
          console.error("[api/data/players-export]", message);
          return jsonResponse({ ok: false, error: message }, { status: 500, cache: "no-store" });
        }
      },
    },
  },
});
