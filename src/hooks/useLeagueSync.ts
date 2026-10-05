import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { deltaSyncLeague } from "@/lib/league.functions";
import { touchLeagueSyncTimestamp } from "@/lib/league-sync-state";

/** Versioned key — bump to force every client through a fresh delta pass. */
const SESSION_KEY_PREFIX = "tlo.league-delta-sync.v1:";
/**
 * Skip re-syncing the same connection within this window. Background cron
 * owns frequent refreshes; page loads only top up stale sessions.
 */
const RESYNC_COOLDOWN_MS = 30 * 60 * 1000;

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
          queryClient.removeQueries({ queryKey: ["league-activity"] });
          queryClient.removeQueries({ queryKey: ["active-matchups"] });
          queryClient.removeQueries({ queryKey: ["active-standings"] });
          queryClient.removeQueries({ queryKey: ["league-rosters"] });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["league-activity"] }),
            queryClient.invalidateQueries({ queryKey: ["active-matchups"] }),
            queryClient.invalidateQueries({ queryKey: ["active-standings"] }),
            queryClient.invalidateQueries({ queryKey: ["league-rosters"] }),
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
