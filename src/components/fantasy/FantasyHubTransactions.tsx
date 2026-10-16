import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  FantasyActivityList,
  type FantasyActivityItem,
} from "@/components/native/fantasy";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { listNativeTransactions } from "@/lib/native-league.functions";
import { loadPlayersCatalog } from "@/lib/players-catalog";

/** Compact recent transactions for the Fantasy Home right rail. */
export function FantasyHubTransactions({ linkId }: { linkId: string }) {
  const { user } = useAuth();
  const modalRef = useRef<PlayerModalHandle>(null);

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
    () => ((rows ?? []) as FantasyActivityItem[]).slice(0, 6),
    [rows],
  );

  return (
    <section className="space-y-2">
      <PlayerModalHost ref={modalRef} />
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-slate-900">
          Transactions
        </h2>
        <Link
          to="/league/$linkId/transactions"
          params={{ linkId }}
          className="text-[11px] font-medium text-blue-700 hover:underline"
        >
          All transactions
        </Link>
      </div>
      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 shadow-sm">
          <p className="text-sm text-slate-500">Loading transactions…</p>
        </div>
      ) : (
        <FantasyActivityList
          items={items}
          playersById={playersById}
          resolveName={(id) => (id ? (playersById.get(id)?.name ?? id) : null)}
          onOpenPlayer={(id) => modalRef.current?.open(id)}
          emptyMessage="No transactions yet."
        />
      )}
    </section>
  );
}
