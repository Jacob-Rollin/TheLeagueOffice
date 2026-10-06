import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest } from "@/lib/cron-auth.server";
import { upsertSyncedMatchups, upsertSyncedRosters } from "@/lib/tidb-sync.server";
import { tidbConfigured } from "@/lib/tidb";

type SyncBody = {
  league_id?: string;
  platform?: string;
  connection_id?: string | null;
  rosters?: {
    team_id: number;
    owner_name?: string | null;
    players?: unknown;
    starters?: unknown;
    bench?: unknown;
  }[];
  matchups?: {
    week: number;
    team_id: number;
    matchup_id?: number | null;
    roster_points?: number;
    projected_points?: number;
    opponent_team_id?: number | null;
    team_name?: string | null;
    owner_name?: string | null;
    starters?: unknown;
    player_points?: unknown;
  }[];
};

/**
 * Near-real-time roster / matchup mutations for synced platforms.
 * Invoked by GH Actions or future host webhooks — NEVER by repository_dispatch.
 */
export const Route = createFileRoute("/api/webhooks/sync")({
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

        let body: SyncBody;
        try {
          body = (await request.json()) as SyncBody;
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "invalid json" }), {
            status: 400,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }

        const leagueId = String(body.league_id ?? "").trim().slice(0, 64);
        if (!leagueId) {
          return new Response(JSON.stringify({ ok: false, error: "league_id required" }), {
            status: 400,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }

        try {
          const platform = String(body.platform ?? "sleeper").slice(0, 16);
          const connectionId = body.connection_id ?? null;
          const rosterRows = (body.rosters ?? []).slice(0, 64).map((r) => ({
            league_id: leagueId,
            team_id: Number(r.team_id) || 0,
            owner_name: r.owner_name ?? null,
            players: r.players ?? [],
            starters: r.starters ?? [],
            bench: r.bench ?? [],
          }));
          const matchupRows = (body.matchups ?? []).slice(0, 400).map((m) => ({
            league_id: leagueId,
            connection_id: connectionId,
            platform,
            week: Math.max(1, Math.min(18, Number(m.week) || 1)),
            team_id: Number(m.team_id) || 0,
            matchup_id: m.matchup_id ?? null,
            roster_points: Number(m.roster_points) || 0,
            projected_points: Number(m.projected_points) || 0,
            opponent_team_id: m.opponent_team_id ?? null,
            team_name: m.team_name ?? null,
            owner_name: m.owner_name ?? null,
            starters: m.starters ?? [],
            player_points: m.player_points ?? {},
          }));

          const [rostersWritten, matchupsWritten] = await Promise.all([
            upsertSyncedRosters(rosterRows),
            upsertSyncedMatchups(matchupRows),
          ]);

          return new Response(
            JSON.stringify({ ok: true, leagueId, rostersWritten, matchupsWritten }),
            {
              status: 200,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "sync failed";
          console.error("[webhooks/sync]", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
