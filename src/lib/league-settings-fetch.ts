/**
 * Shared settings loader — Sleeper client-first; ESPN/Yahoo Fluid credentials.
 */

import { getConnectionSettings } from "@/lib/league.functions";
import type { LeagueSettingsDetail } from "@/lib/league-settings";
import {
  canFetchSettingsClient,
  fetchSleeperSettingsClient,
} from "@/lib/sleeper-settings-client";
import { ensureSleeperNumericLeagueId } from "@/lib/sleeper-resolve-client";

function allowFluidFallback(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

export async function fetchLeagueSettingsForConnection(input: {
  leagueId: string;
  platform: string;
  teamName?: string | null | undefined;
  s2?: string | null | undefined;
  swid?: string | null | undefined;
  connectionId?: string | null | undefined;
}): Promise<LeagueSettingsDetail | null> {
  const platform = String(input.platform ?? "sleeper").trim().toLowerCase();
  let leagueId = String(input.leagueId ?? "").trim();
  if (!leagueId) return null;

  if (platform === "sleeper") {
    const resolved = await ensureSleeperNumericLeagueId(leagueId).catch(() => null);
    if (resolved) {
      if (resolved !== leagueId && input.connectionId) {
        const { persistResolvedSleeperLeagueId } = await import("@/lib/sleeper-resolve-client");
        void persistResolvedSleeperLeagueId(input.connectionId, resolved);
      }
      leagueId = resolved;
    } else if (!allowFluidFallback()) {
      return null;
    }
  }

  if (canFetchSettingsClient(platform, leagueId)) {
    const client = await fetchSleeperSettingsClient(leagueId, input.teamName).catch(() => null);
    if (client?.hostLeagueId || client?.playoffTeams != null || client?.teams != null) {
      return client;
    }
    if (!allowFluidFallback()) return client;
  }

  // Production Sleeper: never Fluid-fallthrough (username rows soft-empty above).
  if (platform === "sleeper" && !allowFluidFallback()) return null;

  return getConnectionSettings({
    data: {
      identifier: leagueId,
      platform,
      ...(input.s2 ? { s2: input.s2 } : {}),
      ...(input.swid ? { swid: input.swid } : {}),
    },
  });
}
