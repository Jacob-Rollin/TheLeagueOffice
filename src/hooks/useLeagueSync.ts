import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { forceClearAndReSyncLeague } from "@/lib/league.functions";

/** Versioned key — bump to force every client through a fresh wipe pass. */
const SESSION_KEY_PREFIX = "tlo.league-auto-resync.v3:";
/** Skip re-purging the same connection within this window (ms). */
const RESYNC_COOLDOWN_MS = 90 * 1000;

/**
 * Automatically purge stale league_transactions / weekly_matchups and re-ingest
 * live host data whenever the active synced league loads or changes.
 * No UI button — runs on mount / league switch only.
 */
export function useLeagueSync() {
  const { activeLeague, sandboxMode } = useActiveLeague();
  const queryClient = useQueryClient();
  const inFlightRef = useRef<string | null>(null);

  useEffect(() => {
    if (sandboxMode) return;
    const connectionId = activeLeague?.id?.trim() || "";
    const leagueId = activeLeague?.leagueId?.trim() || "";
    const platform = (activeLeague?.platform ?? "sleeper").trim().toLowerCase();
    if (!connectionId || !leagueId) return;

    // Cooldown so rapid remounts / route hops do not thrash the host API.
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
        const result = await forceClearAndReSyncLeague({
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
          // Hard-drop stale React Query payloads so the next read hits rewritten rows.
          queryClient.removeQueries({ queryKey: ["league-activity"] });
          queryClient.removeQueries({ queryKey: ["active-matchups"] });
          queryClient.removeQueries({ queryKey: ["active-standings"] });
          queryClient.removeQueries({ queryKey: ["league-rosters"] });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["league-activity"] }),
            queryClient.invalidateQueries({ queryKey: ["active-matchups"] }),
            queryClient.invalidateQueries({ queryKey: ["active-standings"] }),
            queryClient.invalidateQueries({ queryKey: ["league-rosters"] }),
          ]);
        }
      } catch (err) {
        console.warn("[useLeagueSync] auto re-sync failed:", err);
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
  ]);
}

/** Drop-in bridge for the root provider tree. */
export function LeagueSyncBootstrap() {
  useLeagueSync();
  return null;
}
