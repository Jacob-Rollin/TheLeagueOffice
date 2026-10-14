import { useMemo } from "react";

import { FantasyBoard, FantasySectionTitle } from "@/components/native/fantasy/chrome";
import { cn } from "@/lib/utils";

/** Matches `listNativeTransactions` / `NativeTransactionRow` from native league ops. */
export type FantasyActivityItem = {
  id: number;
  teamId: number | null;
  teamName: string | null;
  type: string;
  status: string;
  addPlayerId: string | null;
  dropPlayerId: string | null;
  createdAt: string;
};

type FantasyActivityListProps = {
  items: FantasyActivityItem[];
  emptyMessage?: string;
  className?: string;
  resolveName?: (playerId: string | null) => string | null;
};

function dayKey(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function activityKind(type: string): "add" | "drop" | "waiver" | "trade" | "ir" | "other" {
  const t = type.toLowerCase();
  if (t === "waiver_won" || t === "waiver") return "waiver";
  if (t.startsWith("trade")) return "trade";
  if (t.startsWith("ir_")) return "ir";
  if (t === "add_drop" || t === "add") return "add";
  if (t === "drop") return "drop";
  return "other";
}

function kindLabel(kind: ReturnType<typeof activityKind>) {
  switch (kind) {
    case "add":
      return "Add / drop";
    case "drop":
      return "Drop";
    case "waiver":
      return "Waiver";
    case "trade":
      return "Trade";
    case "ir":
      return "IR";
    default:
      return "Transaction";
  }
}

function kindBadgeClass(kind: ReturnType<typeof activityKind>) {
  switch (kind) {
    case "waiver":
      return "border-accent/30 bg-accent/10 text-accent";
    case "trade":
      return "border-primary/25 bg-primary/10 text-primary";
    case "ir":
      return "border-slate-300 bg-slate-100 text-slate-700";
    case "add":
    case "drop":
      return "border-blue-200 bg-blue-50 text-blue-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function describeTransaction(
  tx: FantasyActivityItem,
  resolveName: (playerId: string | null) => string | null,
): { headline: string; detail?: string | undefined } {
  const addName = tx.addPlayerId ? resolveName(tx.addPlayerId) ?? tx.addPlayerId : null;
  const dropName = tx.dropPlayerId ? resolveName(tx.dropPlayerId) ?? tx.dropPlayerId : null;
  const t = tx.type.toLowerCase();

  if (t === "add_drop") {
    return {
      headline: `Added ${addName ?? "player"} · Dropped ${dropName ?? "player"}`,
    };
  }
  if (t === "add") {
    return { headline: `Added ${addName ?? "player"}` };
  }
  if (t === "drop") {
    return { headline: `Dropped ${dropName ?? "player"}` };
  }
  if (t === "waiver_won" || t === "waiver") {
    return {
      headline: `Waiver claim: ${addName ?? "player"}`,
      detail: dropName ? `Dropped ${dropName}` : undefined,
    };
  }
  if (t === "trade") {
    return { headline: "Trade completed" };
  }
  if (t === "trade_vetoed") {
    return { headline: "Trade vetoed" };
  }
  if (t === "ir_force_drop") {
    return { headline: `IR forced drop: ${dropName ?? addName ?? "player"}` };
  }
  if (t === "ir_force_activate") {
    return { headline: `IR activation: ${addName ?? "player"}` };
  }
  return { headline: tx.type.replace(/_/g, " ") };
}

export function FantasyActivityList({
  items,
  emptyMessage = "No transactions yet.",
  className,
  resolveName = (id) => (id ? id : null),
}: FantasyActivityListProps) {
  const groups = useMemo(() => {
    const map = new Map<string, FantasyActivityItem[]>();
    for (const item of items) {
      const key = dayKey(item.createdAt);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [items]);

  if (!items.length) {
    return (
      <FantasyBoard className={className} bodyClassName="px-4 py-6">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </FantasyBoard>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {groups.map(([day, dayItems]) => (
        <section key={day} className="space-y-2">
          <FantasySectionTitle>{day}</FantasySectionTitle>
          <ul className="space-y-2">
            {dayItems.map((tx) => {
              const kind = activityKind(tx.type);
              const { headline, detail } = describeTransaction(tx, resolveName);
              const time = new Date(tx.createdAt).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              });

              return (
                <li
                  key={tx.id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                            kindBadgeClass(kind),
                          )}
                        >
                          {kindLabel(kind)}
                        </span>
                        <span className="text-xs text-muted-foreground capitalize">{tx.status}</span>
                      </div>
                      <p className="text-sm font-medium text-slate-900">{headline}</p>
                      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
                      <p className="text-xs text-muted-foreground">
                        {tx.teamName ?? (tx.teamId != null ? `Team ${tx.teamId}` : "League")}
                      </p>
                    </div>
                    <time className="shrink-0 text-xs text-muted-foreground">{time}</time>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
