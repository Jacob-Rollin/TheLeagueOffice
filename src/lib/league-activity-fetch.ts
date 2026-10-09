/**
 * Shared activity / transaction-log loader — Sleeper client-first;
 * ESPN/Yahoo Fluid memoized in-tab.
 */

import { espnFluidCacheKey, espnFluidMemo, ESPN_FLUID_TTL_MS } from "@/lib/espn-fluid-cache";
import {
  getConnectionTransactionLog,
  getConnectionTransactions,
  type LeagueActivityEvent,
  type LeagueTransactionLog,
} from "@/lib/league.functions";
import {
  canFetchActivityClient,
  fetchSleeperActivityClient,
  fetchSleeperTransactionLogClient,
} from "@/lib/sleeper-activity-client";
import { ensureSleeperNumericLeagueId } from "@/lib/sleeper-resolve-client";

function allowFluidFallback(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

async function sleeperLeagueId(platform: string, leagueId: string): Promise<string> {
  if (platform !== "sleeper") return leagueId;
  return (await ensureSleeperNumericLeagueId(leagueId).catch(() => null)) ?? leagueId;
}

export async function fetchLeagueActivityForConnection(input: {
  leagueId: string;
  platform: string;
  s2?: string | null | undefined;
  swid?: string | null | undefined;
  connectionId?: string | null | undefined;
}): Promise<LeagueActivityEvent[]> {
  const platform = String(input.platform ?? "sleeper").trim().toLowerCase();
  let leagueId = String(input.leagueId ?? "").trim();
  if (!leagueId) return [];

  if (platform === "native") {
    const linkId = String(input.connectionId ?? "").trim();
    if (!linkId) return [];
    const { fetchNativeTransactionLog } = await import("@/lib/native-league-sync-adapter");
    const log = await fetchNativeTransactionLog(linkId);
    return log.events;
  }

  leagueId = await sleeperLeagueId(platform, leagueId);

  if (canFetchActivityClient(platform, leagueId)) {
    const client = await fetchSleeperActivityClient(leagueId).catch(() => null);
    if (client) return client;
    if (!allowFluidFallback()) return [];
  }

  if (platform === "sleeper" && !allowFluidFallback()) return [];

  const fluidKey = espnFluidCacheKey("activity", leagueId, platform);
  return (
    (await espnFluidMemo(fluidKey, ESPN_FLUID_TTL_MS, () =>
      getConnectionTransactions({
        data: {
          identifier: leagueId,
          platform,
          ...(input.s2 ? { s2: input.s2 } : {}),
          ...(input.swid ? { swid: input.swid } : {}),
        },
      }),
    )) ?? []
  );
}

export async function fetchLeagueTransactionLogForConnection(input: {
  leagueId: string;
  platform: string;
  s2?: string | null | undefined;
  swid?: string | null | undefined;
  connectionId?: string | null | undefined;
}): Promise<LeagueTransactionLog> {
  const platform = String(input.platform ?? "sleeper").trim().toLowerCase();
  let leagueId = String(input.leagueId ?? "").trim();
  const empty: LeagueTransactionLog = { events: [], teams: [], currentWeek: 1 };
  if (!leagueId) return empty;

  if (platform === "native") {
    const linkId = String(input.connectionId ?? "").trim();
    if (!linkId) return empty;
    const { fetchNativeTransactionLog } = await import("@/lib/native-league-sync-adapter");
    return fetchNativeTransactionLog(linkId);
  }

  leagueId = await sleeperLeagueId(platform, leagueId);

  if (canFetchActivityClient(platform, leagueId)) {
    const client = await fetchSleeperTransactionLogClient(leagueId).catch(() => null);
    if (client) return client;
    if (!allowFluidFallback()) return empty;
  }

  if (platform === "sleeper" && !allowFluidFallback()) return empty;

  const fluidKey = espnFluidCacheKey("txn-log", leagueId, platform);
  return espnFluidMemo(fluidKey, ESPN_FLUID_TTL_MS, () =>
    getConnectionTransactionLog({
      data: {
        identifier: leagueId,
        platform,
        ...(input.s2 ? { s2: input.s2 } : {}),
        ...(input.swid ? { swid: input.swid } : {}),
      },
    }),
  );
}
