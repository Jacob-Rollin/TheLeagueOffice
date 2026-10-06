/**
 * Shared roster loader for hooks that share the `["league-rosters", id]` RQ key.
 * Sleeper → browser; ESPN/Yahoo → Fluid credentials.
 */

import { getConnectionRosters } from "@/lib/league.functions";
import type { LeagueRosters } from "@/lib/league.server";
import {
  canFetchRostersClient,
  fetchSleeperLeagueRostersClient,
} from "@/lib/sleeper-rosters-client";

export async function fetchLeagueRostersForConnection(input: {
  leagueId: string;
  platform: string;
  teamName?: string | null | undefined;
  s2?: string | null | undefined;
  swid?: string | null | undefined;
}): Promise<LeagueRosters | null> {
  const platform = String(input.platform ?? "sleeper").trim().toLowerCase();
  const leagueId = String(input.leagueId ?? "").trim();
  if (!leagueId) return null;

  if (canFetchRostersClient(platform)) {
    const client = await fetchSleeperLeagueRostersClient(leagueId, input.teamName).catch(() => null);
    if (client?.teams?.length) {
      // If we expected a "mine" team and none matched, fall through to Fluid
      // (authoritative owner_id resolution) instead of leaving every team as opponent.
      const mineOk = !input.teamName?.trim() || client.teams.some((t) => t.isMine);
      if (mineOk) return client;
    }
  }

  return getConnectionRosters({
    data: {
      identifier: leagueId,
      platform,
      ...(input.s2 ? { s2: input.s2 } : {}),
      ...(input.swid ? { swid: input.swid } : {}),
    },
  });
}
