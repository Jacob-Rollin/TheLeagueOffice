import { createFileRoute } from "@tanstack/react-router";

import { dataCacheControl, jsonResponse, leagueHistoryCacheControl } from "@/lib/api-cache";
import { processMemo } from "@/lib/process-memo";
import { tidbConfigured, tidbExecute } from "@/lib/tidb";

const LEAGUE_MEMO_MS = 30 * 1000;

type RosterRow = {
  id: number;
  league_id: string;
  team_id: number;
  owner_name: string | null;
  players: unknown;
  starters: unknown;
  bench: unknown;
  synced_at: string | null;
};

type MatchupRow = {
  id: number;
  league_id: string;
  week: number;
  team_id: number;
  matchup_id: number | null;
  roster_points: number;
  projected_points: number;
  opponent_team_id: number | null;
  team_name: string | null;
  owner_name: string | null;
  starters: unknown;
  player_points: unknown;
  platform: string | null;
  synced_at: string | null;
};

export const Route = createFileRoute("/api/data/league/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!tidbConfigured()) {
          return jsonResponse(
            { ok: false, error: "DATABASE_URL not configured" },
            { status: 503, cache: "no-store" },
          );
        }

        const leagueId = String(params.id ?? "").slice(0, 64);
        if (!leagueId) {
          return jsonResponse(
            { ok: false, error: "missing league id" },
            { status: 400, cache: "no-store" },
          );
        }

        const url = new URL(request.url);
        const view = (url.searchParams.get("view") ?? "rosters").toLowerCase();
        const week = Math.max(1, Math.min(18, Number(url.searchParams.get("week") ?? 0) || 0));

        try {
          if (view === "matchups") {
            const memoKey = `league-matchups:${leagueId}:${week || "all"}`;
            const matchups = await processMemo(memoKey, LEAGUE_MEMO_MS, async () => {
              const paramsSql: unknown[] = [leagueId];
              let weekClause = "";
              if (week > 0) {
                weekClause = "AND week = ?";
                paramsSql.push(week);
              }
              return tidbExecute<MatchupRow>(
                `SELECT id, league_id, week, team_id, matchup_id, roster_points, projected_points,
                        opponent_team_id, team_name, owner_name, starters, player_points,
                        platform, synced_at
                 FROM synced_matchups
                 WHERE league_id = ? ${weekClause}
                 ORDER BY week ASC, team_id ASC
                 LIMIT 400`,
                paramsSql,
              );
            });
            // Live single-week boards stay short-TTL; history/all-weeks longer.
            const cache = week > 0 ? dataCacheControl() : leagueHistoryCacheControl();
            return jsonResponse({ ok: true, leagueId, matchups }, { cache });
          }

          const rosters = await processMemo(`league-rosters:${leagueId}`, LEAGUE_MEMO_MS, () =>
            tidbExecute<RosterRow>(
              `SELECT id, league_id, team_id, owner_name, players, starters, bench, synced_at
               FROM synced_rosters
               WHERE league_id = ?
               ORDER BY team_id ASC
               LIMIT 64`,
              [leagueId],
            ),
          );
          return jsonResponse(
            { ok: true, leagueId, rosters },
            { cache: leagueHistoryCacheControl() },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "query failed";
          console.error("[api/data/league]", message);
          return jsonResponse({ ok: false, error: message }, { status: 500, cache: "no-store" });
        }
      },
    },
  },
});
