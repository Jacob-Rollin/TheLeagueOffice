import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

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
  setActiveLeagueId: (id: string) => void;
};

const STORAGE_KEY = "tlo.active-league";

const ActiveLeagueContext = createContext<ActiveLeagueValue>({
  leagues: [],
  activeLeague: null,
  activeLeagueId: null,
  setActiveLeagueId: () => {},
});

export function ActiveLeagueProvider({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const userId = user?.id ?? null;
  const [activeId, setActiveId] = useState<string | null>(null);

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
        .from("league_connections")
        .select("id, platform, label, sleeper_user_id, espn_league_id, yahoo_league_key, espn_s2, espn_swid")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []).map((row) => ({
        id: String(row?.id ?? ""),
        platform: String(row?.platform ?? "sleeper"),
        leagueId: String(
          row?.sleeper_user_id ?? row?.espn_league_id ?? row?.yahoo_league_key ?? row?.label ?? "",
        ),
        name: row?.label ?? "League",
        teamName: null as string | null,
        avatar: null as string | null,
        s2: (row?.espn_s2 as string | null) ?? null,
        swid: (row?.espn_swid as string | null) ?? null,
      }));

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
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const activeLeague = useMemo(
    () => leagues.find((l) => l.id === activeId) ?? leagues[0] ?? null,
    [leagues, activeId],
  );

  const value = useMemo<ActiveLeagueValue>(
    () => ({
      leagues,
      activeLeague,
      activeLeagueId: activeLeague?.id ?? null,
      setActiveLeagueId,
    }),
    [leagues, activeLeague, setActiveLeagueId],
  );

  return <ActiveLeagueContext.Provider value={value}>{children}</ActiveLeagueContext.Provider>;
}

export function useActiveLeague() {
  return useContext(ActiveLeagueContext);
}
