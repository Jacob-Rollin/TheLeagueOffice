import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  FantasyActivityList,
  type FantasyActivityItem,
  LeagueActivityPanel,
} from "@/components/native/fantasy";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { listNativeTransactions } from "@/lib/native-league.functions";
import { loadPlayersCatalog } from "@/lib/players-catalog";

/** Compact recent transactions for the Fantasy Home right rail — Playbook ActivityFeed style. */
export function FantasyHubTransactions({ linkId }: { linkId: string }) {
  const { user } = useAuth();

  const cache = useSleeperPlayers();
  const fallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const players = cache.data?.players ?? fallback.data?.players ?? [];
  const playersById = useMemo(() => {
    const map = new Map<string, (typeof players)[number]>();
    for (const p of players) map.set(p.id, p);
    return map;
  }, [players]);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["native-transactions", linkId, "hub"],
    enabled: Boolean(user?.id && linkId),
    staleTime: 15_000,
    queryFn: () => listNativeTransactions({ data: { linkId, limit: 12 } }),
  });

  const items = useMemo(
    () => ((rows ?? []) as FantasyActivityItem[]).slice(0, 5),
    [rows],
  );

  return (
    <LeagueActivityPanel linkId={linkId}>
      {isLoading ? (
        <p className="py-2 text-sm text-muted-foreground">Loading league activity…</p>
      ) : (
        <FantasyActivityList
          items={items}
          playersById={playersById}
          emptyMessage="No recent transactions recorded. Summaries will appear here after the next league moves."
        />
      )}
    </LeagueActivityPanel>
  );
}
