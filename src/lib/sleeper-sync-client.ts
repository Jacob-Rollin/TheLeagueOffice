/**
 * Browser ConnectionSync for Sleeper draft / mock-draft setup.
 * Prefer over Fluid getConnectionSync so opening the draft sheet does not
 * burn Active CPU for public Sleeper leagues.
 */

import type { ConnectionSync, RosterSlotCounts } from "@/lib/league.server";
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

function scoringFromMap(scoring: Record<string, number>): "std" | "half" | "ppr" {
  const rec = Number(scoring["rec"] ?? 0);
  if (rec >= 1) return "ppr";
  if (rec > 0) return "half";
  return "std";
}

function rosterFromSettings(roster: Record<string, number>): RosterSlotCounts {
  return {
    QB: Number(roster["QB"] ?? 0) || 0,
    RB: Number(roster["RB"] ?? 0) || 0,
    WR: Number(roster["WR"] ?? 0) || 0,
    TE: Number(roster["TE"] ?? 0) || 0,
    FLEX:
      (Number(roster["FLEX"] ?? 0) || 0) +
      (Number(roster["WRRB"] ?? 0) || 0) +
      (Number(roster["WRTE"] ?? 0) || 0) +
      (Number(roster["SFLEX"] ?? 0) || 0),
    K: Number(roster["K"] ?? 0) || 0,
    DEF: Number(roster["DEF"] ?? 0) || 0,
    BENCH: (Number(roster["BN"] ?? 0) || 0) + (Number(roster["TAXI"] ?? 0) || 0),
  };
}

export async function fetchConnectionSyncPreferred(input: {
  leagueId: string;
  platform: string;
  teamName?: string | null | undefined;
  s2?: string | null | undefined;
  swid?: string | null | undefined;
  connectionId?: string | null | undefined;
}): Promise<ConnectionSync | null> {
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

    if (canFetchSettingsClient(platform, leagueId)) {
      const settings = await fetchSleeperSettingsClient(leagueId, input.teamName).catch(() => null);
      if (settings?.hostLeagueId && settings.teams != null) {
        const roster = rosterFromSettings(settings.roster);
        const rounds =
          settings.draft.rounds ??
          Object.values(roster).reduce((a, b) => a + b, 0);
        const teamNames: Record<string, string> = {};
        for (const entry of settings.draft.order) {
          teamNames[String(entry.pick)] = entry.team;
        }
        const mine =
          settings.draft.order.find((o) => o.isMine)?.pick ??
          settings.draft.position ??
          1;
        return {
          teams: settings.teams,
          rounds,
          myTeam: Math.max(1, Number(mine) || 1),
          scoring: scoringFromMap(settings.scoring),
          snake: (settings.draft.type ?? "").toLowerCase() !== "auction",
          playoffStartWeek: settings.playoffStartWeek ?? 15,
          roster,
          teamNames,
        };
      }
      if (!allowFluidFallback()) return null;
    } else if (!allowFluidFallback()) {
      return null;
    }
  }

  const { getConnectionSync } = await import("@/lib/league.functions");
  return getConnectionSync({
    data: {
      identifier: leagueId,
      platform,
      ...(input.s2 ? { s2: input.s2 } : {}),
      ...(input.swid ? { swid: input.swid } : {}),
    },
  });
}
