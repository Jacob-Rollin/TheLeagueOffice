import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  FantasyActivityList,
  type FantasyActivityItem,
  FantasyPosChip,
  FantasyPosChipRow,
} from "@/components/native/fantasy";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { listNativeTransactions } from "@/lib/native-league.functions";
import { loadPlayersCatalog } from "@/lib/players-catalog";

export const Route = createFileRoute("/league/$linkId/transactions")({
  ssr: false,
  component: NativeTransactionsPage,
});

type TxFilter = "all" | "adds" | "waivers" | "trades" | "ir";

const FILTER_CHIPS: { id: TxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "adds", label: "Adds" },
  { id: "waivers", label: "Waivers" },
  { id: "trades", label: "Trades" },
  { id: "ir", label: "IR" },
];

function matchesTxFilter(tx: FantasyActivityItem, filter: TxFilter): boolean {
  if (filter === "all") return true;
  const t = tx.type.toLowerCase();
  if (filter === "adds") return t === "add" || t === "add_drop" || t === "drop";
  if (filter === "waivers") return t === "waiver_won" || t === "waiver";
  if (filter === "trades") return t.startsWith("trade");
  if (filter === "ir") return t.startsWith("ir_");
  return true;
}

function NativeTransactionsPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const [filter, setFilter] = useState<TxFilter>("all");

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

  const resolveName = (playerId: string | null) =>
    playerId ? (nameById.get(playerId) ?? playerId) : null;

  const { data: rows, isLoading } = useQuery({
    queryKey: ["native-transactions", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 15_000,
    queryFn: () => listNativeTransactions({ data: { linkId, limit: 80 } }),
  });

  const filtered = useMemo(() => {
    const list = (rows ?? []) as FantasyActivityItem[];
    return list.filter((tx) => matchesTxFilter(tx, filter));
  }, [rows, filter]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="display-title text-2xl text-slate-900">
          League <span className="text-primary">Transactions</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Free-agent adds, waiver awards, trades, and IR force-resolves.
        </p>
      </div>

      <FantasyPosChipRow>
        {FILTER_CHIPS.map((chip) => (
          <FantasyPosChip
            key={chip.id}
            label={chip.label}
            active={filter === chip.id}
            onClick={() => setFilter(chip.id)}
          />
        ))}
      </FantasyPosChipRow>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading transactions…</p>
      ) : (
        <FantasyActivityList
          items={filtered}
          resolveName={resolveName}
          emptyMessage={
            filter === "all"
              ? "No transactions yet."
              : `No ${FILTER_CHIPS.find((c) => c.id === filter)?.label?.toLowerCase() ?? "matching"} transactions yet.`
          }
        />
      )}
    </section>
  );
}
