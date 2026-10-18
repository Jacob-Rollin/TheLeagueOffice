/**
 * Budget-aware mobile pull-to-refresh.
 *
 * Prefer visitor→Sleeper / CDN / in-tab memo busts. Never call Fluid
 * `deltaSyncLeague` from PTR (cron owns Sleeper warm; ESPN delta has a long
 * cooldown). Cap how often a tab can force network clear so spam pulls do not
 * eat the soft Sleeper ceiling or ESPN Fluid budget.
 */

import type { QueryClient } from "@tanstack/react-query";

import { clearEspnFluidForLeague } from "@/lib/espn-fluid-cache";
import { forceRosterRevalidate } from "@/lib/roster-cache";
import { clearCache } from "@/lib/sleeper-cache";
import { clearSleeperLiveMatchupMemory } from "@/lib/sleeper-matchups-client";
import { sleeperBudgetRemaining } from "@/lib/sleeper-rate-budget";

/** Minimum gap between user-forced refreshes on this tab. */
export const MOBILE_PTR_COOLDOWN_MS = 18_000;

/** Leave headroom for live scoring polls after a PTR Sleeper fan-out. */
const MIN_WARM_BUDGET_FOR_FULL_CLEAR = 24;

let lastPtrAt = 0;

export type MobilePullRefreshLeague = {
  id: string;
  leagueId: string;
  platform: string;
  week?: number | null;
};

export function mobilePtrCooldownRemainingMs(now = Date.now()): number {
  return Math.max(0, MOBILE_PTR_COOLDOWN_MS - (now - lastPtrAt));
}

async function clearSleeperLeagueCaches(leagueId: string, week: number | null | undefined) {
  const id = String(leagueId ?? "").trim();
  if (!id) return;
  const w = week != null && week > 0 ? Math.floor(week) : null;
  const keys = [
    `sleeper-rosters-v1:${id}`,
    `sleeper-standings-v1:${id}`,
    `sleeper-matchup-meta-v1:${id}`,
    `sleeper-activity-recent-v1:${id}`,
    `sleeper-activity-season-v1:${id}`,
  ];
  if (w != null) {
    keys.push(`sleeper-matchups-v1:${id}|${w}`);
    if (w > 1) keys.push(`sleeper-matchups-v1:${id}|${w - 1}`);
  }
  await Promise.all(keys.map((key) => clearCache(key).catch(() => undefined)));
  clearSleeperLiveMatchupMemory(id, w);
}

/**
 * Refresh the active mobile league surface.
 * Returns whether a network-forcing clear ran (vs cooldown / soft RQ-only).
 */
export async function refreshMobileLeagueSurface(
  queryClient: QueryClient,
  league: MobilePullRefreshLeague,
): Promise<{ ok: boolean; forcedNetwork: boolean; reason?: string }> {
  const connectionId = String(league.id ?? "").trim();
  const leagueId = String(league.leagueId ?? "").trim();
  const platform = String(league.platform ?? "sleeper").trim().toLowerCase();
  if (!connectionId || !leagueId) {
    return { ok: false, forcedNetwork: false, reason: "no-league" };
  }

  const now = Date.now();
  if (mobilePtrCooldownRemainingMs(now) > 0) {
    // Soft: re-read React Query only (no cache bust) so the gesture still settles.
    await queryClient.refetchQueries({
      predicate: (q) => {
        const key = q.queryKey;
        if (!Array.isArray(key) || key.length === 0) return false;
        const head = String(key[0] ?? "");
        return (
          head === "active-matchups" ||
          head === "active-standings" ||
          head === "league-rosters" ||
          head === "league-transaction-log" ||
          head === "mobile-league-settings" ||
          head === "league-matchups-cdn-all" ||
          head === "league-matchups-history"
        );
      },
      type: "active",
    });
    return { ok: true, forcedNetwork: false, reason: "cooldown" };
  }
  lastPtrAt = now;

  const sleeper = platform === "sleeper";
  const budgetOk = !sleeper || sleeperBudgetRemaining("warm") >= MIN_WARM_BUDGET_FOR_FULL_CLEAR;
  let forcedNetwork = false;

  if (sleeper && budgetOk) {
    await clearSleeperLeagueCaches(leagueId, league.week ?? null);
    forcedNetwork = true;
  } else if (!sleeper) {
    // ESPN/Yahoo: drop in-tab Fluid memos so the next loaders may re-fetch once.
    clearEspnFluidForLeague(leagueId, platform);
    forcedNetwork = true;
  }

  // Always open the roster 5-minute barrier for this connection on a real PTR.
  forceRosterRevalidate(`${connectionId}:all`);
  forceRosterRevalidate(connectionId);

  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["league-rosters", connectionId] }),
    queryClient.invalidateQueries({ queryKey: ["active-standings", connectionId] }),
    queryClient.invalidateQueries({ queryKey: ["league-transaction-log", connectionId] }),
    queryClient.invalidateQueries({ queryKey: ["mobile-league-settings"] }),
    queryClient.invalidateQueries({ queryKey: ["active-matchups", connectionId] }),
    queryClient.invalidateQueries({ queryKey: ["league-matchups-cdn-all"] }),
    queryClient.invalidateQueries({ queryKey: ["league-matchups-history"] }),
    queryClient.invalidateQueries({ queryKey: ["league-scoring"] }),
    queryClient.invalidateQueries({ queryKey: ["sleeper-trending-add"] }),
    // Native League Office boards (Fluid GET, already memoized server-side).
    queryClient.invalidateQueries({ queryKey: ["native-league-board", connectionId] }),
    queryClient.invalidateQueries({ queryKey: ["native-lineup", connectionId] }),
    queryClient.invalidateQueries({ queryKey: ["native-matchup", connectionId] }),
    queryClient.invalidateQueries({ queryKey: ["native-matchup-week", connectionId] }),
    queryClient.invalidateQueries({ queryKey: ["native-standings", connectionId] }),
    queryClient.invalidateQueries({ queryKey: ["native-transactions", connectionId] }),
  ]);

  await queryClient.refetchQueries({
    predicate: (q) => {
      const key = q.queryKey;
      if (!Array.isArray(key) || key.length === 0) return false;
      const head = String(key[0] ?? "");
      if (
        head === "active-matchups" ||
        head === "league-rosters" ||
        head === "active-standings" ||
        head === "league-transaction-log" ||
        head === "native-league-board" ||
        head === "native-lineup" ||
        head === "native-matchup" ||
        head === "native-matchup-week" ||
        head === "native-standings" ||
        head === "native-transactions"
      ) {
        return key[1] === connectionId;
      }
      return head === "mobile-league-settings" || head === "sleeper-trending-add";
    },
    type: "active",
  });

  return { ok: true, forcedNetwork };
}

/** Lighter home refresh: headlines + league list (no Sleeper roster fan-out). */
export async function refreshMobileHomeSurface(queryClient: QueryClient): Promise<{ ok: boolean }> {
  const now = Date.now();
  if (mobilePtrCooldownRemainingMs(now) > 0) {
    await queryClient.refetchQueries({
      predicate: (q) => {
        const head = String(q.queryKey[0] ?? "");
        return head === "mobile-trending" || head === "active-league-connections";
      },
      type: "active",
    });
    return { ok: true };
  }
  lastPtrAt = now;

  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["mobile-trending"] }),
    queryClient.invalidateQueries({ queryKey: ["active-league-connections"] }),
  ]);
  await queryClient.refetchQueries({
    predicate: (q) => {
      const head = String(q.queryKey[0] ?? "");
      return head === "mobile-trending" || head === "active-league-connections";
    },
    type: "active",
  });
  return { ok: true };
}
