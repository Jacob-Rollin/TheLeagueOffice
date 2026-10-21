import { Link } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";

import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import {
  nativeTxnRowsToActivityEvents,
  type NativeActivityTxnRow,
} from "@/lib/native-league-sync-adapter";
import type { NativeSettingsChangeEntry } from "@/lib/native-league-settings-changelog";
import { cn } from "@/lib/utils";

/** Matches `listNativeTransactions` / `NativeTransactionRow` from native league ops. */
export type FantasyActivityItem = NativeActivityTxnRow & {
  status: string;
  settingsChanges?: NativeSettingsChangeEntry[] | null;
  changedByName?: string | null;
};

type PlayerLike = {
  id: string;
  name: string;
  team?: string | null;
  pos?: string | null;
};

type FantasyActivityListProps = {
  items: FantasyActivityItem[];
  emptyMessage?: string;
  className?: string;
  /** Catalog lookup — fed into ActivityFeed for avatars / name hydration. */
  playersById?: Map<string, PlayerLike>;
  /** Kept for call-site compat; ActivityFeed opens players via its own modal. */
  onOpenPlayer?: (playerId: string) => void;
  /** Kept for call-site compat; ActivityFeed resolves names from `playersById`. */
  resolveName?: (playerId: string | null) => string | null;
};

/**
 * Native recent-activity list — same Sleeper-style timeline as Playbook
 * `ActivityFeed` (relative time, headlines, +/- player rows).
 */
export function FantasyActivityList({
  items,
  emptyMessage = "No transactions yet.",
  className,
  playersById,
}: FantasyActivityListProps) {
  const events = useMemo(() => nativeTxnRowsToActivityEvents(items), [items]);
  const players = useMemo(() => {
    if (!playersById?.size) return undefined;
    return [...playersById.values()].map((p) => ({
      id: p.id,
      name: p.name,
      pos: (p.pos ?? "FA").toUpperCase(),
      team: (p.team ?? "FA").toUpperCase(),
    }));
  }, [playersById]);

  return (
    <ActivityFeed
      events={events}
      compact
      emptyMessage={emptyMessage}
      {...(players ? { players } : {})}
      {...(className ? { className } : {})}
    />
  );
}

/** Playbook-matching panel chrome for League Activity on native dashboards. */
export function LeagueActivityPanel({
  linkId,
  children,
  title = "League Activity",
  actionLabel = "Open Transactions",
  className,
}: {
  linkId: string;
  children: ReactNode;
  title?: string;
  actionLabel?: string;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-4 sm:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">{title}</h2>
        <Link
          to="/league/$linkId/transactions"
          params={{ linkId }}
          className="text-xs font-semibold text-primary hover:underline"
        >
          {actionLabel}
        </Link>
      </div>
      {children}
    </section>
  );
}
