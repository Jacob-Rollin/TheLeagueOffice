import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { fetchLeagueTransactionLogForConnection } from "@/lib/league-activity-fetch";
import { fetchLeagueSettingsForConnection } from "@/lib/league-settings-fetch";
import type { LeagueTransactionLog } from "@/lib/league.functions";

/** Host league settings (playoffs, waivers, trades) for the active league. */
export function useMobileLeagueSettings() {
  const { activeLeague } = useActiveLeague();
  return useQuery({
    queryKey: ["mobile-league-settings", "v2", activeLeague?.id ?? null],
    enabled: Boolean(activeLeague?.leagueId),
    retry: false,
    staleTime: 60 * 60 * 1000,
    queryFn: async () =>
      fetchLeagueSettingsForConnection({
        leagueId: activeLeague?.leagueId ?? "",
        platform: activeLeague?.platform ?? "sleeper",
        teamName: activeLeague?.teamName,
        connectionId: activeLeague?.id,
        ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
        ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
      }),
  });
}

/** Standings plus the playoff field size for the active league. */
export function useMobileLeagueStandings() {
  const { activeLeague, standings, loading } = useActiveStandings();
  const settings = useMobileLeagueSettings();

  const rows = standings?.rows ?? [];
  const playoffTeams = Math.min(
    rows.length,
    settings.data?.playoffTeams ?? (rows.length >= 10 ? 6 : 4),
  );

  return {
    activeLeague,
    standings,
    rows,
    playoffTeams,
    seasonComplete: (standings?.league.status ?? "").toLowerCase() === "complete",
    loading,
  };
}

const WAIVER_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Weekly waiver clears run Tuesday morning Eastern — not mid-week FAAB/rolling claims. */
const WAIVER_CLEAR_TZ = "America/New_York";

/** True when `atMs` falls on a Tuesday in America/New_York. */
export function isEasternTuesday(atMs: number): boolean {
  if (!Number.isFinite(atMs) || atMs <= 0) return false;
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: WAIVER_CLEAR_TZ,
    weekday: "short",
  }).format(new Date(atMs));
  return day === "Tue";
}

/**
 * Most recent successful weekly waiver clear (Tuesday ET), or 0.
 * Ignores free-agent adds, trades, IR, and Wed–Mon waiver executions.
 */
export function latestTuesdayWaiverAt(
  events: { kind: string; at: number }[],
): number {
  let latest = 0;
  for (const e of events) {
    if (e.kind !== "waiver") continue;
    if (!isEasternTuesday(e.at)) continue;
    if (e.at > latest) latest = e.at;
  }
  return latest;
}

/** True for 24 hours after Tuesday's waiver clear only. */
export function useWaiverActivityWindow() {
  const { events } = useMobileLeagueActivity();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const lastTuesdayWaiverAt = latestTuesdayWaiverAt(events);
  return lastTuesdayWaiverAt > 0 && now - lastTuesdayWaiverAt < WAIVER_WINDOW_MS;
}

/** Full host transaction log for the active league. */
export function useMobileLeagueActivity() {
  const { activeLeague } = useActiveLeague();
  const query = useQuery({
    queryKey: ["league-transaction-log", activeLeague?.id ?? null],
    enabled: Boolean(activeLeague?.leagueId),
    retry: false,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<LeagueTransactionLog> =>
      fetchLeagueTransactionLogForConnection({
        leagueId: activeLeague?.leagueId ?? "",
        platform: activeLeague?.platform ?? "sleeper",
        connectionId: activeLeague?.id,
        ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
        ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
      }),
  });

  return {
    events: query.data?.events ?? [],
    teamCount: query.data?.teams.length ?? 0,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
