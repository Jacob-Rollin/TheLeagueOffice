import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  FantasyActivityList,
  type FantasyActivityItem,
  FantasyPosChip,
  FantasyPosChipRow,
} from "@/components/native/fantasy";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { listNativeTransactions } from "@/lib/native-league.functions";
import {
  isNativeSettingsChangeType,
  type NativeSettingsChangeEntry,
} from "@/lib/native-league-settings-changelog";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import type { Player } from "@/lib/players-build";
import { formatRelativeTimeAgo, parseServerDateMs } from "@/lib/relative-time";

export const Route = createFileRoute("/league/$linkId/transactions")({
  ssr: false,
  component: NativeTransactionsPage,
});

type TxFilter = "all" | "adds" | "waivers" | "trades" | "ir" | "settings";

const FILTER_CHIPS: { id: TxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "adds", label: "Adds" },
  { id: "waivers", label: "Waivers" },
  { id: "trades", label: "Trades" },
  { id: "ir", label: "IR" },
  { id: "settings", label: "Settings" },
];

function matchesTxFilter(tx: FantasyActivityItem, filter: TxFilter): boolean {
  if (filter === "all") return !isNativeSettingsChangeType(tx.type);
  if (filter === "settings") return isNativeSettingsChangeType(tx.type);
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
  const modalRef = useRef<PlayerModalHandle>(null);
  const [nowMs] = useState(() => Date.now());

  const cache = useSleeperPlayers();
  const fallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const players = cache.data?.players ?? fallback.data?.players ?? [];
  const playersById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) map.set(p.id, p);
    return map;
  }, [players]);

  const resolveName = (playerId: string | null) =>
    playerId ? (playersById.get(playerId)?.name ?? playerId) : null;

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
      <PlayerModalHost ref={modalRef} />
      <div>
        <h2 className="display-title text-2xl text-slate-900">
          League <span className="text-primary">Transactions</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Free-agent adds, waiver awards, trades, IR force-resolves, and settings changes.
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
      ) : filter === "settings" ? (
        filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No settings changes yet.</p>
        ) : (
          <ul className="space-y-3">
            {filtered.map((notice) => {
              const who =
                notice.changedByName?.trim() ||
                notice.teamName?.trim() ||
                "Commissioner";
              const changes = (notice.settingsChanges ?? []) as NativeSettingsChangeEntry[];
              const at = parseServerDateMs(notice.createdAt);
              return (
                <li
                  key={notice.id}
                  className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 shadow-sm"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
                      Settings change
                    </p>
                    <time className="text-[11px] text-amber-800/80">
                      {formatRelativeTimeAgo(at, nowMs)}
                    </time>
                  </div>
                  <p className="mt-0.5 text-sm font-medium text-amber-950">{who}</p>
                  {changes.length ? (
                    <ul className="mt-2 space-y-1">
                      {changes.map((c) => (
                        <li key={`${notice.id}-${c.key}`} className="text-sm text-amber-950/90">
                          <span className="font-semibold">{c.label}</span>
                          {": "}
                          <span className="text-amber-900/70">{c.from}</span>
                          <span className="mx-1 text-amber-800/50">→</span>
                          <span className="font-medium">{c.to}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-amber-950/80">League settings were updated.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <FantasyActivityList
          items={filtered}
          playersById={playersById}
          resolveName={resolveName}
          onOpenPlayer={(id) => modalRef.current?.open(id)}
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
