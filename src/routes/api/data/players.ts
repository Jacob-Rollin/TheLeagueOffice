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

const MAX_LIMIT = 50;

/**
 * Paginated player warehouse dictionary.
 * Never returns unbounded SELECT * — LIMIT 50 OFFSET n with indexed filters.
 */
export const Route = createFileRoute("/api/data/players")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!tidbConfigured()) {
          return jsonResponse(
            { ok: false, error: "DATABASE_URL not configured", players: [], total: 0 },
            { status: 503, cache: "no-store" },
          );
        }

        const url = new URL(request.url);
        const limit = Math.min(
          MAX_LIMIT,
          Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50),
        );
        const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
        const q = (url.searchParams.get("q") ?? "").trim().slice(0, 64);
        const position = (url.searchParams.get("position") ?? "").trim().toUpperCase().slice(0, 8);
        const team = (url.searchParams.get("team") ?? "").trim().toUpperCase().slice(0, 8);

        const where: string[] = [];
        const params: unknown[] = [];
        if (q) {
          where.push("player_name LIKE ?");
          params.push(`%${q}%`);
        }
        if (position) {
          where.push("position = ?");
          params.push(position);
        }
        if (team) {
          where.push("team = ?");
          params.push(team);
        }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

        try {
          const memoKey = `warehouse-players:${q}|${position}|${team}|${limit}|${offset}`;
          const payload = await processMemo(memoKey, 30_000, async () => {
            const countRows = await tidbExecute<{ c: number }>(
              `SELECT COUNT(*) AS c FROM player_warehouse ${whereSql}`,
              params,
            );
            const total = Number(countRows[0]?.c ?? 0);
            const players = await tidbExecute<WarehouseRow>(
              `SELECT sleeper_id, player_name, position, team, fantasycalc_value,
                      leaguelogs_status, injury_type, injury_notes, updated_at
               FROM player_warehouse
               ${whereSql}
               ORDER BY player_name ASC
               LIMIT ? OFFSET ?`,
              [...params, limit, offset],
            );
            return { players, total };
          });
          return jsonResponse(
            { ok: true, players: payload.players, total: payload.total, limit, offset },
            { cache: warehouseCacheControl() },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "query failed";
          console.error("[api/data/players]", message);
          return jsonResponse(
            { ok: false, error: message, players: [], total: 0 },
            { status: 500, cache: "no-store" },
          );
        }
      },
    },
  },
});
