import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { deltaSyncLeague } from "@/lib/league.functions";
import { touchLeagueSyncTimestamp } from "@/lib/league-sync-state";

/** Versioned key — bump to force every client through a fresh delta pass. */
const SESSION_KEY_PREFIX = "tlo.league-delta-sync.v2:";
/**
 * Skip re-syncing the same connection within this window. Background cron
 * (GitHub Actions → /api/cron/league-delta-sync) owns frequent refreshes for
 * Sleeper; page loads must not burn Fluid for every visitor.
 */
/** ESPN/Yahoo credential leagues only — Sleeper is cron + browser. */
const RESYNC_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export function useLeagueSync() {
  const { activeLeague, sandboxMode } = useActiveLeague();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const inFlightRef = useRef<string | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (sandboxMode) return;
    const connectionId = activeLeague?.id?.trim() || "";
    const leagueId = activeLeague?.leagueId?.trim() || "";
    const platform = (activeLeague?.platform ?? "sleeper").trim().toLowerCase();
    if (!connectionId || !leagueId) return;

    // Sleeper: Actions warm TiDB + browser reads host APIs. Skip Fluid delta
    // on browse so ~20 concurrent free users do not each spend Active CPU.
    if (platform === "sleeper") return;

    try {
      const last = Number(sessionStorage.getItem(`${SESSION_KEY_PREFIX}${connectionId}`) ?? 0);
      if (last && Date.now() - last < RESYNC_COOLDOWN_MS) return;
    } catch {
      /* sessionStorage unavailable */
    }

    if (inFlightRef.current === connectionId) return;
    inFlightRef.current = connectionId;
    let cancelled = false;

    void (async () => {
      try {
        const result = await deltaSyncLeague({
          data: {
            connectionId,
            leagueId,
            platform,
            ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
            ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
          },
        });
        if (cancelled) return;

        try {
          sessionStorage.setItem(`${SESSION_KEY_PREFIX}${connectionId}`, String(Date.now()));
        } catch {
          /* ignore */
        }

        if (result.ok) {
          await touchLeagueSyncTimestamp(connectionId, queryClient, userId);
          // Delta already paid Fluid for ESPN matchups + transactions → TiDB.
          // Do NOT wipe standings/rosters/activity — that forced a second Fluid
          // storm on every league switch. Soft-refresh matchups so CDN/TiDB is
          // re-read; leave in-flight espnFluidMemo / RQ caches intact.
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["active-matchups"] }),
            queryClient.invalidateQueries({ queryKey: ["league-matchups-history"] }),
            queryClient.invalidateQueries({ queryKey: ["league-connections"] }),
          ]);
        }
      } catch (err) {
        console.warn("[useLeagueSync] delta sync failed:", err);
      } finally {
        if (inFlightRef.current === connectionId) inFlightRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeLeague?.id,
    activeLeague?.leagueId,
    activeLeague?.platform,
    activeLeague?.s2,
    activeLeague?.swid,
    sandboxMode,
    queryClient,
    userId,
  ]);
}

export function LeagueSyncBootstrap() {
  useLeagueSync();
  return null;
}
