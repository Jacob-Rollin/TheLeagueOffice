import { Minus, Plus } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { FantasyBoard, FantasySectionTitle } from "@/components/native/fantasy/chrome";
import { FantasyPlayerChip } from "@/components/native/fantasy/player-chip";
import { tradeMovesFromNativeLegs } from "@/lib/native-league-sync-adapter";
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
  tradeId?: number | null;
  tradeLegs?: { teamId: number; playerIds: string[] }[];
  proposerTeamId?: number | null;
  acceptorTeamId?: number | null;
  proposerName?: string | null;
  acceptorName?: string | null;
  createdAt: string;
};

type PlayerLike = {
  id: string;
  name: string;
  team?: string | null;
  pos?: string | null;
  injury_status?: string | null;
  injury?: string | null;
};

type FantasyActivityListProps = {
  items: FantasyActivityItem[];
  emptyMessage?: string;
  className?: string;
  /** Catalog lookup for avatars / injury badges. */
  playersById?: Map<string, PlayerLike>;
  onOpenPlayer?: (playerId: string) => void;
  /** Fallback name resolver when `playersById` misses. */
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

function kindLabel(kind: ReturnType<typeof activityKind>, vetoed = false) {
  if (kind === "trade" && vetoed) return "Trade Vetoed";
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

function kindBadgeClass(kind: ReturnType<typeof activityKind>, vetoed = false) {
  if (kind === "trade" && vetoed) return "border-slate-300 bg-slate-100 text-slate-700";
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

function tradeTeamsFromMoves(
  moves: { fantasyTeam?: string; fromFantasyTeam?: string }[],
): string[] {
  const teams: string[] = [];
  const push = (name: string | undefined) => {
    const clean = name?.trim();
    if (clean && !teams.includes(clean)) teams.push(clean);
  };
  for (const move of moves) {
    push(move.fantasyTeam);
    push(move.fromFantasyTeam);
  }
  return teams;
}

function PlayerMoveRow({
  playerId,
  action,
  note,
  playersById,
  resolveName,
  onOpenPlayer,
}: {
  playerId: string;
  action: "add" | "drop" | "ir";
  note?: string;
  playersById?: Map<string, PlayerLike>;
  resolveName: (playerId: string | null) => string | null;
  onOpenPlayer?: (playerId: string) => void;
}) {
  const player = playersById?.get(playerId) ?? null;
  const ActionIcon = action === "add" ? Plus : Minus;
  return (
    <li className="flex items-center gap-2 px-1 py-1.5">
      {action === "ir" ? (
        <span className="w-5 shrink-0 text-center text-[10px] font-bold uppercase text-slate-400">
          IR
        </span>
      ) : (
        <ActionIcon
          className={cn(
            "size-4 shrink-0",
            action === "add" ? "text-emerald-500" : "text-rose-500",
          )}
          strokeWidth={2.5}
          aria-hidden
        />
      )}
      <FantasyPlayerChip
        player={player}
        fallbackName={resolveName(playerId) ?? playerId}
        size="sm"
        {...(onOpenPlayer ? { onClick: () => onOpenPlayer(playerId) } : {})}
        {...(note
          ? {
              trailing: (
                <span className="shrink-0 text-[11px] text-muted-foreground">{note}</span>
              ),
            }
          : {})}
      />
    </li>
  );
}

function TradeActivityCard({
  tx,
  playersById,
  resolveName,
  onOpenPlayer,
  time,
}: {
  tx: FantasyActivityItem;
  playersById?: Map<string, PlayerLike>;
  resolveName: (playerId: string | null) => string | null;
  onOpenPlayer?: (playerId: string) => void;
  time: string;
}) {
  const vetoed = tx.type.toLowerCase().includes("veto");
  const nameByTeamId = new Map<number, string>();
  if (tx.proposerTeamId != null) {
    nameByTeamId.set(
      tx.proposerTeamId,
      tx.proposerName?.trim() || `Team ${tx.proposerTeamId}`,
    );
  }
  if (tx.acceptorTeamId != null) {
    nameByTeamId.set(
      tx.acceptorTeamId,
      tx.acceptorName?.trim() || `Team ${tx.acceptorTeamId}`,
    );
  }
  for (const leg of tx.tradeLegs ?? []) {
    if (!nameByTeamId.has(leg.teamId)) {
      nameByTeamId.set(leg.teamId, `Team ${leg.teamId}`);
    }
  }

  const moves = tradeMovesFromNativeLegs(tx.tradeLegs ?? [], nameByTeamId);
  const teams = tradeTeamsFromMoves(moves);
  const adds = moves.filter((m) => m.action === "add");
  const title =
    teams.length === 2
      ? `${teams[0]} and ${teams[1]}`
      : vetoed
        ? "Trade Vetoed"
        : "Trade";

  return (
    <li className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              kindBadgeClass("trade", vetoed),
            )}
          >
            {kindLabel("trade", vetoed)}
          </span>
          <span className="truncate text-sm font-semibold text-slate-900">{title}</span>
        </div>
        <time className="shrink-0 text-xs text-muted-foreground">{time}</time>
      </header>
      {teams.length ? (
        <div className="divide-y divide-slate-100">
          {teams.map((team) => {
            const received = adds.filter((m) => m.fantasyTeam?.trim() === team);
            const sent = adds.filter((m) => m.fromFantasyTeam?.trim() === team);
            if (!received.length && !sent.length) return null;
            return (
              <div key={team} className="px-3 py-2">
                <p className="px-1 pb-0.5 text-xs font-semibold text-muted-foreground">{team}</p>
                <ul>
                  {received.map((move, i) => (
                    <PlayerMoveRow
                      key={`in-${move.playerId}-${i}`}
                      playerId={move.playerId}
                      action="add"
                      {...(move.fromFantasyTeam ? { note: `from ${move.fromFantasyTeam}` } : {})}
                      {...(playersById ? { playersById } : {})}
                      resolveName={resolveName}
                      {...(onOpenPlayer ? { onOpenPlayer } : {})}
                    />
                  ))}
                  {sent.map((move, i) => (
                    <PlayerMoveRow
                      key={`out-${move.playerId}-${i}`}
                      playerId={move.playerId}
                      action="drop"
                      {...(move.fantasyTeam ? { note: `to ${move.fantasyTeam}` } : {})}
                      {...(playersById ? { playersById } : {})}
                      resolveName={resolveName}
                      {...(onOpenPlayer ? { onOpenPlayer } : {})}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {vetoed ? "Trade vetoed." : "Trade completed."}
        </p>
      )}
    </li>
  );
}

function SimpleActivityCard({
  tx,
  kind,
  playersById,
  resolveName,
  onOpenPlayer,
  time,
}: {
  tx: FantasyActivityItem;
  kind: ReturnType<typeof activityKind>;
  playersById?: Map<string, PlayerLike>;
  resolveName: (playerId: string | null) => string | null;
  onOpenPlayer?: (playerId: string) => void;
  time: string;
}) {
  const rows: ReactNode[] = [];
  const rowExtras = {
    ...(playersById ? { playersById } : {}),
    ...(onOpenPlayer ? { onOpenPlayer } : {}),
  };
  if (tx.addPlayerId) {
    rows.push(
      <PlayerMoveRow
        key={`add-${tx.addPlayerId}`}
        playerId={tx.addPlayerId}
        action={kind === "ir" && !tx.dropPlayerId ? "ir" : "add"}
        resolveName={resolveName}
        {...rowExtras}
      />,
    );
  }
  if (tx.dropPlayerId) {
    rows.push(
      <PlayerMoveRow
        key={`drop-${tx.dropPlayerId}`}
        playerId={tx.dropPlayerId}
        action={kind === "ir" ? "ir" : "drop"}
        resolveName={resolveName}
        {...rowExtras}
      />,
    );
  }

  const teamLabel = tx.teamName ?? (tx.teamId != null ? `Team ${tx.teamId}` : "League");

  return (
    <li className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              kindBadgeClass(kind),
            )}
          >
            {kindLabel(kind)}
          </span>
          <span className="truncate text-sm font-semibold text-slate-900">{teamLabel}</span>
          <span className="text-xs capitalize text-muted-foreground">{tx.status}</span>
        </div>
        <time className="shrink-0 text-xs text-muted-foreground">{time}</time>
      </header>
      {rows.length ? (
        <ul className="px-3 py-1.5">{rows}</ul>
      ) : (
        <p className="px-4 py-3 text-sm capitalize text-muted-foreground">
          {tx.type.replace(/_/g, " ")}
        </p>
      )}
    </li>
  );
}

export function FantasyActivityList({
  items,
  emptyMessage = "No transactions yet.",
  className,
  playersById,
  onOpenPlayer,
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
              const time = new Date(tx.createdAt).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              });

              const cardExtras = {
                ...(playersById ? { playersById } : {}),
                ...(onOpenPlayer ? { onOpenPlayer } : {}),
              };

              if (kind === "trade") {
                return (
                  <TradeActivityCard
                    key={tx.id}
                    tx={tx}
                    resolveName={resolveName}
                    time={time}
                    {...cardExtras}
                  />
                );
              }

              return (
                <SimpleActivityCard
                  key={tx.id}
                  tx={tx}
                  kind={kind}
                  resolveName={resolveName}
                  time={time}
                  {...cardExtras}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
