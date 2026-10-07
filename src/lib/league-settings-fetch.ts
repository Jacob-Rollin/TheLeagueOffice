/**
 * Shared settings loader — Sleeper client-first; ESPN/Yahoo Fluid credentials.
 */

import { getConnectionSettings } from "@/lib/league.functions";
import type { LeagueSettingsDetail } from "@/lib/league-settings";
import {
  canFetchSettingsClient,
  fetchSleeperSettingsClient,
} from "@/lib/sleeper-settings-client";

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
}): Promise<LeagueSettingsDetail | null> {
  const platform = String(input.platform ?? "sleeper").trim().toLowerCase();
  const leagueId = String(input.leagueId ?? "").trim();
  if (!leagueId) return null;

  if (canFetchSettingsClient(platform, leagueId)) {
    const client = await fetchSleeperSettingsClient(leagueId, input.teamName).catch(() => null);
    if (client?.hostLeagueId || client?.playoffTeams != null || client?.teams != null) {
      return client;
    }
    if (!allowFluidFallback()) return client;
  }

  return getConnectionSettings({
    data: {
      identifier: leagueId,
      platform,
      ...(input.s2 ? { s2: input.s2 } : {}),
      ...(input.swid ? { swid: input.swid } : {}),
    },
  });
}
