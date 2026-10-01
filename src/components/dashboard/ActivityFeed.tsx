import { useMemo, useRef, type ReactNode } from "react";

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

/** Same defense reduction used by roster name → Sleeper cache matching. */
function activityDefenseKey(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/d\s*\/?\s*st|dst|defense|special teams/g, " ")
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.length ? sanitizeActivityPlayerName(parts[parts.length - 1]!) : "";
}

/**
 * Remap activity moves onto the Sleeper player cache so ESPN ids/names
 * render real headshots instead of "Player 4685702" ghosts.
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

  // Team abbr DEF ids ("TB") travel through as playerId on resolved rows.
  if (move.pos === "DEF" || move.pos === "DST") {
    const byTeam = playersById.get(move.team) ?? playersById.get(move.playerId);
    if (byTeam && (byTeam.pos === "DEF" || byTeam.pos === "DST")) {
      return {
        ...move,
        playerId: byTeam.id,
        name: byTeam.name,
        pos: byTeam.pos,
        team: byTeam.team || move.team,
      };
    }
  }

  const ghost = /^Player\s+\d+$/i.test(move.name.trim());
  const nameKey = sanitizeActivityPlayerName(move.name);
  const defKey = activityDefenseKey(move.name);
  const byName =
    (!ghost && nameKey ? playersByName.get(nameKey) : undefined) ??
    (defKey ? playersByName.get(defKey) : undefined);
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

/** Fantasy teams involved in a trade, in the order they first appear. */
function tradeTeams(moves: LeagueActivityMove[]): string[] {
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

function activityHeadline(event: LeagueActivityEvent): string {
  const kind = resolveActivityKind(event);
  const manager = (event.teamName ?? "").trim() || "Manager Team";
  if (kind === "trade") {
    const teams = tradeTeams(event.moves ?? []);
    if (teams.length === 2) return `${teams[0]} and ${teams[1]} completed a trade`;
    return event.teamName ? `${manager} completed a trade` : "Trade completed";
  }
  if (kind === "ir") {
    return `${manager} made an IR move`;
  }
  const adds = (event.moves ?? []).filter((m) => resolveMoveAction(m, kind) === "add").length;
  if (kind === "waiver") {
    return `${manager} won ${adds > 1 ? `${adds} waiver claims` : "a waiver claim"}`;
  }
  return `${manager} made a free agent move.`;
}

/** Sleeper processes a league's claims in one batch; anything this close together is the same run. */
const WAIVER_RUN_GAP_MS = 10 * 60 * 1000;

type FeedEntry =
  | { type: "event"; event: LeagueActivityEvent }
  | { type: "waiverRun"; id: string; at: number; events: LeagueActivityEvent[] };

function groupWaiverRuns(events: LeagueActivityEvent[]): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const event of events) {
    if (resolveActivityKind(event) !== "waiver") {
      out.push({ type: "event", event });
      continue;
    }
    const last = out[out.length - 1];
    const prev = last?.type === "waiverRun" ? last.events[last.events.length - 1] : undefined;
    if (last?.type === "waiverRun" && prev && Math.abs(prev.at - event.at) <= WAIVER_RUN_GAP_MS) {
      last.events.push(event);
    } else {
      out.push({ type: "waiverRun", id: `run-${event.id}`, at: event.at, events: [event] });
    }
  }
  return out;
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
  actionOverride,
  note,
  trailing,
}: {
  move: LeagueActivityMove;
  eventKind: LeagueActivityEvent["kind"];
  onOpen: (id: string) => void;
  actionOverride?: LeagueActivityMove["action"];
  note?: string;
  trailing?: ReactNode;
}) {
  const open = () => onOpen(move.playerId);
  const action = actionOverride ?? resolveMoveAction(move, eventKind);

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
          {note ? <span className="ml-1.5 text-xs font-medium text-slate-400">{note}</span> : null}
        </span>
      </button>
      {trailing ? <span className="ml-2 shrink-0">{trailing}</span> : null}
    </div>
  );
}

export type TradeGradeChip = { letter: string; tone: "good" | "even" | "bad" };

const GRADE_TONE: Record<TradeGradeChip["tone"], string> = {
  good: "bg-emerald-50 text-emerald-700 border-emerald-200",
  even: "bg-slate-50 text-slate-600 border-slate-200",
  bad: "bg-rose-50 text-rose-600 border-rose-200",
};

/** Per-team trade breakdown: what each side received (+) and sent (-). */
function TradeBreakdown({
  eventId,
  moves,
  onOpen,
  grades,
}: {
  eventId: string;
  moves: LeagueActivityMove[];
  onOpen: (id: string) => void;
  grades?: Record<string, TradeGradeChip> | undefined;
}) {
  const teams = tradeTeams(moves);
  const adds = moves.filter((m) => m.action === "add");
  const releases = moves.filter((m) => m.action === "drop");

  return (
    <div className="mt-1.5 space-y-2.5">
      {teams.map((team) => {
        const received = adds.filter((m) => m.fantasyTeam?.trim() === team);
        const sent = adds.filter((m) => m.fromFantasyTeam?.trim() === team);
        const released = releases.filter((m) => m.fantasyTeam?.trim() === team);
        if (!received.length && !sent.length && !released.length) return null;
        return (
          <div key={team}>
            <p className="flex items-center gap-2 text-xs font-bold text-slate-700">
              {team}
              {grades?.[team] ? (
                <span
                  className={cn(
                    "rounded border px-1.5 py-px text-[10px] font-bold tracking-wide",
                    GRADE_TONE[grades[team]!.tone],
                  )}
                  title="Trade grade from current Value/Trend"
                >
                  {grades[team]!.letter}
                </span>
              ) : null}
            </p>
            <div className="mt-0.5 space-y-0.5">
              {received.map((move, idx) => (
                <ActivityPlayerRow
                  key={`${eventId}-${team}-in-${move.playerId}-${idx}`}
                  move={move}
                  eventKind="trade"
                  onOpen={onOpen}
                  actionOverride="add"
                  {...(move.fromFantasyTeam ? { note: `from ${move.fromFantasyTeam}` } : {})}
                />
              ))}
              {sent.map((move, idx) => (
                <ActivityPlayerRow
                  key={`${eventId}-${team}-out-${move.playerId}-${idx}`}
                  move={move}
                  eventKind="trade"
                  onOpen={onOpen}
                  actionOverride="drop"
                  {...(move.fantasyTeam ? { note: `to ${move.fantasyTeam}` } : {})}
                />
              ))}
              {released.map((move, idx) => (
                <ActivityPlayerRow
                  key={`${eventId}-${team}-drop-${move.playerId}-${idx}`}
                  move={move}
                  eventKind="trade"
                  onOpen={onOpen}
                  actionOverride="drop"
                  note="dropped"
                />
              ))}
            </div>
          </div>
        );
      })}
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
  addNote,
  tradeGrades,
}: {
  events: LeagueActivityEvent[];
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  className?: string;
  compact?: boolean;
  /** Optional Sleeper catalog used to wipe ESPN numeric ghost labels. */
  players?: ActivityCatalogPlayer[];
  /** Right-aligned note on waiver / free-agent adds (e.g. points since pickup). */
  addNote?: (event: LeagueActivityEvent, move: LeagueActivityMove) => ReactNode;
  /** Trade grade chips keyed by event id, then fantasy team name. */
  tradeGrades?: Record<string, Record<string, TradeGradeChip>>;
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
      if (p.pos === "DEF" || p.pos === "DST") {
        const defKey = activityDefenseKey(p.name);
        if (defKey && !map.has(defKey)) map.set(defKey, p);
        const teamKey = sanitizeActivityPlayerName(p.team);
        if (teamKey && !map.has(teamKey)) map.set(teamKey, p);
      }
    }
    return map;
  }, [players]);

  /** Hydrated moves with ADD rows above DROP rows (Sleeper stack). */
  const orderedMovesFor = (event: LeagueActivityEvent, kind: LeagueActivityEvent["kind"]) => {
    const moves = (event.moves ?? []).map((m) => hydrateActivityMove(m, playersById, playersByName));
    return [
      ...moves.filter((m) => resolveMoveAction(m, kind) === "add"),
      ...moves.filter((m) => resolveMoveAction(m, kind) === "drop"),
    ];
  };

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
            {groupWaiverRuns(events).map((entry) => {
              if (entry.type === "waiverRun") {
                const count = entry.events.length;
                return (
                  <li key={entry.id} className="flex items-start gap-3 px-1 py-3">
                    <span className="w-14 shrink-0 pt-0.5 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      {formatActivityTime(entry.at)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {count === 1
                          ? "1 new waiver claim has been processed."
                          : `${count} new waiver claims have been processed.`}
                      </p>
                      <div className="mt-2 space-y-2.5">
                        {entry.events.map((event) => {
                          const moves = orderedMovesFor(event, "waiver");
                          return (
                            <div key={event.id} className="border-l-2 border-slate-200 pl-3">
                              <p className="text-xs font-bold text-slate-700">
                                {(event.teamName ?? "").trim() || "Manager Team"}
                              </p>
                              <div className="mt-0.5 space-y-0.5">
                                {moves.map((move, idx) => (
                                  <ActivityPlayerRow
                                    key={`${event.id}-${move.playerId}-${move.action}-${idx}`}
                                    move={move}
                                    eventKind="waiver"
                                    onOpen={openPlayer}
                                    trailing={
                                      addNote && resolveMoveAction(move, "waiver") === "add"
                                        ? addNote(event, move)
                                        : null
                                    }
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </li>
                );
              }

              const event = entry.event;
              const kind = resolveActivityKind(event);
              const moves = (event.moves ?? []).map((m) =>
                hydrateActivityMove(m, playersById, playersByName),
              );
              const orderedMoves = kind === "free_agent" ? orderedMovesFor(event, kind) : moves;

              return (
                <li key={event.id} className="flex items-start gap-3 px-1 py-3">
                  <span className="w-14 shrink-0 pt-0.5 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    {formatActivityTime(event.at)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{activityHeadline(event)}</p>
                    {kind === "trade" && tradeTeams(moves).length > 0 ? (
                      <TradeBreakdown
                        eventId={event.id}
                        moves={moves}
                        onOpen={openPlayer}
                        grades={tradeGrades?.[event.id]}
                      />
                    ) : orderedMoves.length ? (
                      <div className="mt-1.5 space-y-0.5">
                        {orderedMoves.map((move, idx) => (
                          <ActivityPlayerRow
                            key={`${event.id}-${move.playerId}-${move.action}-${idx}`}
                            move={move}
                            eventKind={kind}
                            onOpen={openPlayer}
                            trailing={
                              addNote && resolveMoveAction(move, kind) === "add" && (kind === "waiver" || kind === "free_agent")
                                ? addNote(event, move)
                                : null
                            }
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
