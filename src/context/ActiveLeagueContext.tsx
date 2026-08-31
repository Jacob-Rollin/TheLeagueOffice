import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

/** Compact identifier tokens for a synced league — the only thing we keep in memory. */
export type ActiveLeagueToken = {
  id: string;
  platform: string;
  leagueId: string;
  name: string;
  teamName: string | null;
  avatar: string | null;
  s2?: string | null;
  swid?: string | null;
};

type ActiveLeagueValue = {
  leagues: ActiveLeagueToken[];
  activeLeague: ActiveLeagueToken | null;
  activeLeagueId: string | null;
  sandboxMode: boolean;
  setActiveLeagueId: (id: string) => void;
  toggleSandbox: () => void;
  refresh: () => Promise<void>;
};

const STORAGE_KEY = "tlo.active-league";

const ActiveLeagueContext = createContext<ActiveLeagueValue>({
  leagues: [],
  activeLeague: null,
  activeLeagueId: null,
  sandboxMode: false,
  setActiveLeagueId: () => {},
  toggleSandbox: () => {},
  refresh: async () => {},
});

export function ActiveLeagueProvider({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sandboxMode, setSandboxMode] = useState(false);
  const lastLiveIdRef = useMemo<{ current: string | null }>(() => ({ current: null }), []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setActiveId(stored);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const { data } = useQuery({
    queryKey: ["active-league-connections", userId],
    enabled: Boolean(ready && userId),
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ActiveLeagueToken[]> => {
      const { data, error } = await supabase
        .from("synced_leagues")
        .select("id, platform, league_id, espn_s2, swid, metadata")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []).map((row) => {
        const meta = (row?.metadata ?? {}) as Record<string, unknown>;
        return {
          id: String(row?.id ?? ""),
          platform: String(row?.platform ?? "sleeper"),
          leagueId: String(row?.league_id ?? ""),
          name: (meta?.["label"] as string | undefined) ?? "League",
          teamName: null as string | null,
          avatar: null as string | null,
          s2: (row?.espn_s2 as string | null) ?? null,
          swid: (row?.swid as string | null) ?? null,
        };
      });


      const { getConnectionMeta } = await import("@/lib/league.functions");
      return await Promise.all(
        rows.map(async ({ s2, swid, ...row }) => {
          const base = { ...row, s2, swid };
          if ((row.platform !== "sleeper" && row.platform !== "espn") || !row.leagueId) return base;
          try {
            const meta = await getConnectionMeta({
              data: {
                identifier: row.leagueId,
                platform: row.platform,
                ...(s2 ? { s2 } : {}),
                ...(swid ? { swid } : {}),
              },
            });
            return {
              ...base,
              name: meta?.leagueName ?? row.name,
              teamName: meta?.teamName ?? null,
              avatar: meta?.avatar ?? null,
            };
          } catch {
            return base;
          }
        }),
      );
    },

  });

  const leagues = useMemo(() => (data ?? []).filter((row) => row.id.length > 0), [data]);

  const setActiveLeagueId = useCallback((id: string) => {
    setActiveId(id);
    setSandboxMode(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const toggleSandbox = useCallback(() => {
    setSandboxMode((prev) => {
      if (!prev) {
        lastLiveIdRef.current = activeId;
        return true;
      }
      const restore = lastLiveIdRef.current ?? leagues[0]?.id ?? null;
      if (restore) {
        setActiveId(restore);
        try {
          window.localStorage.setItem(STORAGE_KEY, restore);
        } catch {
          /* storage unavailable */
        }
      }
      return false;
    });
  }, [activeId, leagues, lastLiveIdRef]);
...
  const activeLeague = useMemo(
    () =>
      sandboxMode
        ? null
        : leagues.find((l) => l.id === activeId) ?? leagues[0] ?? null,
    [leagues, activeId, sandboxMode],
  );

  const value = useMemo<ActiveLeagueValue>(
    () => ({
      leagues,
      activeLeague,
      activeLeagueId: sandboxMode ? null : (activeLeague?.id ?? null),
      sandboxMode,
      setActiveLeagueId,
      toggleSandbox,
      refresh,
    }),
    [leagues, activeLeague, sandboxMode, setActiveLeagueId, toggleSandbox, refresh],
  );

  return <ActiveLeagueContext.Provider value={value}>{children}</ActiveLeagueContext.Provider>;
}

export function useActiveLeague() {
  return useContext(ActiveLeagueContext);
}
