import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { listNativeTransactions } from "@/lib/native-league.functions";
import { loadPlayersCatalog } from "@/lib/players-catalog";

export const Route = createFileRoute("/league/$linkId/transactions")({
  ssr: false,
  component: NativeTransactionsPage,
});

function NativeTransactionsPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const cache = useSleeperPlayers();
  const fallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const players = cache.data?.players ?? fallback.data?.players ?? [];
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of players) map.set(p.id, p.name);
    return map;
  }, [players]);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["native-transactions", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 15_000,
    queryFn: () => listNativeTransactions({ data: { linkId, limit: 50 } }),
  });

  return (
    <section className="space-y-4">
      <div>
        <h2 className="display-title text-2xl text-slate-900">
          League <span className="text-primary">Transactions</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Free-agent adds and add/drops. Waivers and trades will appear here as those ships.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading transactions…</p>
        ) : !rows?.length ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((tx) => {
              const addName = tx.addPlayerId
                ? (nameById.get(tx.addPlayerId) ?? tx.addPlayerId)
                : null;
              const dropName = tx.dropPlayerId
                ? (nameById.get(tx.dropPlayerId) ?? tx.dropPlayerId)
                : null;
              const label =
                tx.type === "add_drop"
                  ? `Add ${addName ?? "player"} / Drop ${dropName ?? "player"}`
                  : tx.type === "add"
                    ? `Add ${addName ?? "player"}`
                    : tx.type;
              return (
                <li key={tx.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{label}</p>
                    <p className="text-xs text-muted-foreground">
                      {tx.teamName ?? "Team"} · {tx.status}
                    </p>
                  </div>
                  <time className="text-xs text-muted-foreground">
                    {new Date(tx.createdAt).toLocaleString()}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
