import { useMemo, useRef } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import type { Pos } from "@/lib/draft";
import type { LeagueActivityEvent, LeagueActivityMove } from "@/lib/league.functions";
import { cn } from "@/lib/utils";

/** Raw host-league transaction shape used for root-type evaluation. */
export type ActivityTransactionLike = {
  type?: string | null;
  metadata?: { to_slot?: string | null; [key: string]: unknown } | null;
  adds?: Record<string, unknown> | null;
  drops?: Record<string, unknown> | null;
};

type ActivityCatalogPlayer = {
  id: string;
  name: string;
  pos: string;
  team: string;
};

function sanitizeActivityPlayerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Remap activity moves onto catalog players so ESPN name-matched rows render
 * real headshots / names instead of "Player 4685702" ghosts.
 */
export function hydrateActivityMove(
  move: LeagueActivityMove,
  playersById: Map<string, ActivityCatalogPlayer>,
  playersByName: Map<string, ActivityCatalogPlayer>,
): LeagueActivityMove {
  const direct = playersById.get(move.playerId);
  if (direct) {
    return {
      ...move,
      playerId: direct.id,
      name: direct.name,
      pos: direct.pos || move.pos,
      team: direct.team || move.team,
    };
  }

  const ghost = /^Player\s+\d+$/i.test(move.name.trim());
  if (ghost) return move;

  const byName = playersByName.get(sanitizeActivityPlayerName(move.name));
  if (!byName) return move;

  return {
    ...move,
    playerId: byName.id,
    name: byName.name,
    pos: byName.pos || move.pos,
    team: byName.team || move.team,
  };
}

/**
 * Strict root-type evaluation for Sleeper (and compatible) payloads.
 * Never labels a waiver / free-agent add or drop as an IR move just because
 * the player carries an IR injury status tag.
 */
export function evaluateTransactionType(transaction: ActivityTransactionLike): {
  isTrade: boolean;
  isWaiver: boolean;
  isFreeAgent: boolean;
  isActualIRMove: boolean;
} {
  const type = String(transaction.type ?? "").toLowerCase();
  const isTrade = type === "trade";
  const isWaiver = type === "waiver";
  const isFreeAgent = type === "free_agent";
  const toSlot = String(transaction.metadata?.to_slot ?? "").toUpperCase();

  // Only categorize a move as an IR adjustment if the root transaction type
  // explicitly dictates it, or if it is purely a roster movement to/from the
  // IR slot with NO associated free agent adds or drops.
  const hasFaAddsOrDrops =
    Object.keys(transaction.adds ?? {}).length > 0 ||
    Object.keys(transaction.drops ?? {}).length > 0;
  const isActualIRMove =
    type === "injury" ||
    type === "ir" ||
    (!isWaiver && !isFreeAgent && toSlot === "IR" && !hasFaAddsOrDrops);

  return { isTrade, isWaiver, isFreeAgent, isActualIRMove };
}

/**
 * Normalize a stored activity event so mislabeled IR rows (legacy cache /
 * older parsers) render as waiver or free-agent ADD/DROP when appropriate.
 */
export function resolveActivityKind(
  event: LeagueActivityEvent,
): LeagueActivityEvent["kind"] {
  if (event.kind === "trade" || event.kind === "waiver" || event.kind === "free_agent") {
    return event.kind;
  }

  const text = (event.text ?? "").toLowerCase();
  const actions = new Set((event.moves ?? []).map((m) => m.action));

  // Legacy IR mislabel: events that only have add/drop actions, or copy that
  // describes a free-agency cut, must never stay under the IR heading.
  if (actions.has("add") || actions.has("drop")) {
    if (text.includes("waiver")) return "waiver";
    return "free_agent";
  }
  if (
    text.includes("dropped") &&
    !text.includes("injured reserve") &&
    !text.includes(" placed ")
  ) {
    return text.includes("waiver") ? "waiver" : "free_agent";
  }

  const evaluated = evaluateTransactionType({
    type: event.kind,
    metadata: event.kind === "ir" ? { to_slot: "IR" } : null,
  });
  if (evaluated.isActualIRMove) return "ir";
  return event.kind;
}

function formatActivityTime(at: number): string {
  const diff = Date.now() - at;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function activityHeadline(event: LeagueActivityEvent): string {
  const kind = resolveActivityKind(event);
  const manager = (event.teamName ?? "").trim() || "Manager Team";
  if (kind === "trade") {
    return event.teamName ? `${manager} completed a trade` : "Trade completed";
  }
  if (kind === "ir") {
    return `${manager} made an IR move`;
  }
  return `${manager} made a move`;
}

function toAvatarPos(pos: string): Pos {
  const upper = pos.toUpperCase();
  if (upper === "QB" || upper === "RB" || upper === "WR" || upper === "TE" || upper === "K" || upper === "DEF") {
    return upper;
  }
  return "WR";
}

function resolveMoveAction(
  move: LeagueActivityMove,
  eventKind: LeagueActivityEvent["kind"],
): LeagueActivityMove["action"] {
  // Waiver / free-agent rows always render as ADD or DROP — never IR.
  if (eventKind === "waiver" || eventKind === "free_agent") {
    if (move.action === "ir") return "drop";
    return move.action === "add" ? "add" : "drop";
  }
  if (eventKind === "ir") return "ir";
  return move.action;
}

function ActivityPlayerRow({
  move,
  eventKind,
  onOpen,
}: {
  move: LeagueActivityMove;
  eventKind: LeagueActivityEvent["kind"];
  onOpen: (id: string) => void;
}) {
  const open = () => onOpen(move.playerId);
  const action = resolveMoveAction(move, eventKind);

  const badge =
    action === "add" ? (
      <span className="mr-1 w-4 shrink-0 text-center text-sm font-black text-emerald-500" aria-hidden="true">
        +
      </span>
    ) : action === "drop" ? (
      <span className="mr-1 w-4 shrink-0 text-center text-sm font-black text-rose-500" aria-hidden="true">
        -
      </span>
    ) : (
      <span className="mr-2 w-5 shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        IR
      </span>
    );

  return (
    <div className="flex min-w-0 items-center py-1">
      {badge}
      <button
        type="button"
        onClick={open}
        className="flex min-w-0 flex-1 items-center gap-2 text-left transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <PlayerAvatar
          id={move.playerId}
          pos={toAvatarPos(move.pos)}
          team={move.team}
          name={move.name}
          className="size-7"
          logoClassName="size-3"
        />
        <span className="min-w-0 truncate text-sm">
          <span className="font-bold text-slate-900">{move.name}</span>
          <span className="font-medium text-slate-500">
            {" "}
            {move.pos} - {move.team}
          </span>
        </span>
      </button>
    </div>
  );
}

/** Shared Sleeper-style +/- activity timeline for dashboard + transactions. */
export function ActivityFeed({
  events,
  loading,
  error,
  emptyMessage = "No recent transactions recorded.",
  className,
  compact = false,
  players,
}: {
  events: LeagueActivityEvent[];
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  className?: string;
  compact?: boolean;
  /** Optional Sleeper catalog used to wipe ESPN numeric ghost labels. */
  players?: ActivityCatalogPlayer[];
}) {
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

  const playersById = useMemo(() => {
    const map = new Map<string, ActivityCatalogPlayer>();
    for (const p of players ?? []) {
      if (p?.id) map.set(p.id, p);
    }
    return map;
  }, [players]);

  const playersByName = useMemo(() => {
    const map = new Map<string, ActivityCatalogPlayer>();
    for (const p of players ?? []) {
      const key = sanitizeActivityPlayerName(p.name);
      if (key && !map.has(key)) map.set(key, p);
    }
    return map;
  }, [players]);

  return (
    <>
      <div
        className={cn(
          compact
            ? undefined
            : "h-auto w-full overflow-visible rounded-lg border border-border bg-muted/20 p-3 pr-2",
          className,
        )}
      >
        {loading ? (
          <p className="px-2 py-6 text-sm text-muted-foreground">Loading league activity…</p>
        ) : error ? (
          <p className="px-2 py-6 text-sm text-destructive">{error}</p>
        ) : !events.length ? (
          <p className={cn("text-sm text-muted-foreground", compact ? "py-2" : "px-2 py-10 text-center")}>
            {emptyMessage}
          </p>
        ) : (
          <ul className="space-y-0 divide-y divide-border">
            {events.map((event) => {
              const kind = resolveActivityKind(event);
              const moves = (event.moves ?? []).map((m) =>
                hydrateActivityMove(m, playersById, playersByName),
              );
              // Waiver / free-agent: ADD rows above DROP rows (Sleeper stack).
              const orderedMoves =
                kind === "waiver" || kind === "free_agent"
                  ? [
                      ...moves.filter((m) => resolveMoveAction(m, kind) === "add"),
                      ...moves.filter((m) => resolveMoveAction(m, kind) === "drop"),
                    ]
                  : moves;

              return (
                <li key={event.id} className="flex items-start gap-3 px-1 py-3">
                  <span className="w-14 shrink-0 pt-0.5 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    {formatActivityTime(event.at)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{activityHeadline(event)}</p>
                    {orderedMoves.length ? (
                      <div className="mt-1.5 space-y-0.5">
                        {orderedMoves.map((move, idx) => (
                          <ActivityPlayerRow
                            key={`${event.id}-${move.playerId}-${move.action}-${idx}`}
                            move={move}
                            eventKind={kind}
                            onOpen={openPlayer}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-sm leading-snug text-slate-600">{event.text}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <PlayerModalHost ref={modalRef} />
    </>
  );
}

/** @deprecated Prefer ActivityFeed — kept for existing Playbook imports. */
export const LeagueActivityTimeline = ActivityFeed;
