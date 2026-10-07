/**
 * Shared roster loader for hooks that share the `["league-rosters", id]` RQ key.
 * Sleeper → browser; ESPN/Yahoo → Fluid credentials.
 * Production never falls through to Fluid for Sleeper (cron + client own it).
 */

import { getConnectionRosters } from "@/lib/league.functions";
import type { LeagueRosters } from "@/lib/league.server";
import {
  canFetchRostersClient,
  fetchSleeperLeagueRostersClient,
} from "@/lib/sleeper-rosters-client";

function allowSleeperFluidFallback(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

export async function fetchLeagueRostersForConnection(input: {
  leagueId: string;
  platform: string;
  teamName?: string | null | undefined;
  s2?: string | null | undefined;
  swid?: string | null | undefined;
  connectionId?: string | null | undefined;
}): Promise<LeagueRosters | null> {
  const platform = String(input.platform ?? "sleeper").trim().toLowerCase();
  let leagueId = String(input.leagueId ?? "").trim();
  if (!leagueId) return null;

  if (platform === "sleeper") {
    const { ensureSleeperNumericLeagueId, persistResolvedSleeperLeagueId } = await import(
      "@/lib/sleeper-resolve-client"
    );
    const resolved = await ensureSleeperNumericLeagueId(leagueId).catch(() => null);
    if (resolved) {
      if (resolved !== leagueId && input.connectionId) {
        void persistResolvedSleeperLeagueId(input.connectionId, resolved);
      }
      leagueId = resolved;
    } else if (!allowSleeperFluidFallback()) {
      return null;
    }
  }

  if (canFetchRostersClient(platform)) {
    const client = await fetchSleeperLeagueRostersClient(leagueId, input.teamName).catch(() => null);
    if (client?.teams?.length) {
      // Prefer client even when mine-matching is fuzzy — production must not
      // pay Fluid to re-resolve owner_id for every visitor.
      const mineOk = !input.teamName?.trim() || client.teams.some((t) => t.isMine);
      if (mineOk || !allowSleeperFluidFallback()) return client;
    } else if (!allowSleeperFluidFallback()) {
      return client;
    }
  }

  if (platform === "sleeper" && !allowSleeperFluidFallback()) return null;

  return getConnectionRosters({
    data: {
      identifier: leagueId,
      platform,
      ...(input.s2 ? { s2: input.s2 } : {}),
      ...(input.swid ? { swid: input.swid } : {}),
    },
  });
}
