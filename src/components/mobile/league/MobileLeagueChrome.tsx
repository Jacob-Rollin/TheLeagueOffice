import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeftRight, Minus, Newspaper, Plus, Shirt, Swords, Trophy, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";

import {
  buildActivityPlayerIndex,
  groupWaiverRuns,
  hydrateActivityMove,
  resolveActivityKind,
  resolveMoveAction,
  tradeTeams,
} from "@/components/dashboard/ActivityFeed";
import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { playerPressProps, useOpenMobilePlayer } from "@/components/mobile/MobilePlayerSheet";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Pos } from "@/lib/draft";
import type { LeagueActivityEvent, LeagueActivityMove } from "@/lib/league.functions";
import { cn } from "@/lib/utils";

import { MobileTeamLogo } from "./MobileStandings";
import { useMobileLeagueActivity } from "./useMobileLeague";

/** Bottom tab bar height, excluding the device safe area. */
const NAV_HEIGHT = "4rem";
/** Visible height of the collapsed League Activity sheet. */
const PEEK_HEIGHT = "3.75rem";
const SHEET_TOP_GAP = "4.75rem";

export const mobileLeagueContentPad = (withSheet: boolean) =>
  `calc(${NAV_HEIGHT}${withSheet ? ` + ${PEEK_HEIGHT}` : ""} + env(safe-area-inset-bottom) + 1rem)`;

type TabPath =
  | "/m/league/$leagueId/feed"
  | "/m/league/$leagueId/team"
  | "/m/league/$leagueId/matchup"
  | "/m/league/$leagueId/players"
  | "/m/league/$leagueId";

const TABS: { to: TabPath; label: string; icon: typeof Trophy; segment: string | null }[] = [
  { to: "/m/league/$leagueId/feed", label: "Feed", icon: Newspaper, segment: "feed" },
  { to: "/m/league/$leagueId/team", label: "Team", icon: Shirt, segment: "team" },
  { to: "/m/league/$leagueId/matchup", label: "Matchup", icon: Swords, segment: "matchup" },
  { to: "/m/league/$leagueId/players", label: "Players", icon: Users, segment: "players" },
  { to: "/m/league/$leagueId", label: "League", icon: Trophy, segment: null },
];

export function MobileLeagueBottomNav({ leagueId }: { leagueId: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const segment = pathname.replace(/\/+$/, "").split("/")[4] ?? null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-m-border bg-m-nav"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-md grid-cols-5" style={{ height: NAV_HEIGHT }}>
        {TABS.map((tab) => {
          const active =
            tab.segment === segment ||
            (tab.segment === "team" && (segment === "waivers" || segment === "trades"));
          const Icon = tab.icon;
          return (
            <Link
              key={tab.label}
              to={tab.to}
              params={{ leagueId }}
              className={cn(
                "flex flex-col items-center justify-center gap-1 font-display text-[13px] font-bold uppercase tracking-wide",
                active ? "text-m-nav-active" : "text-m-nav-fg",
              )}
            >
              <Icon className="size-6" strokeWidth={active ? 2.5 : 2} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

const AVATAR_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

const KIND_LABEL: Record<LeagueActivityEvent["kind"], string> = {
  waiver: "Waiver",
  free_agent: "Free Agent",
  trade: "Trade",
  ir: "IR",
};

function dayLabel(at: number) {
  const date = new Date(at);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const timeLabel = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function eventSummary(event: LeagueActivityEvent) {
  const add = event.moves.find((m) => m.action === "add");
  const drop = event.moves.find((m) => m.action === "drop");
  if (event.kind === "trade") return "Trade completed";
  const team = event.teamName ?? "A team";
  if (add) return `${team} added ${add.name}`;
  if (drop) return `${team} dropped ${drop.name}`;
  return event.text;
}

const isRejectedTrade = (e: LeagueActivityEvent) => e.kind === "trade" && /^TRADE REJECTED/i.test(e.text);

/** League transactions newest first, grouped by day. */
function useLeagueActivityGroups(kinds?: LeagueActivityEvent["kind"][]) {
  const { events: rawEvents, teamCount, loading, error } = useMobileLeagueActivity();
  const kindKey = kinds?.join(",") ?? "";
  const events = useMemo(
    () =>
      rawEvents
        .filter((e) => !isRejectedTrade(e) && (!kindKey || kindKey.split(",").includes(e.kind)))
        .sort((a, b) => b.at - a.at),
    [rawEvents, kindKey],
  );
  const groups = useMemo(() => {
    const out: { label: string; entries: ReturnType<typeof groupWaiverRuns> }[] = [];
    for (const entry of groupWaiverRuns(events)) {
      const label = dayLabel(entry.type === "event" ? entry.event.at : entry.at);
      const last = out.at(-1);
      if (last?.label === label) last.entries.push(entry);
      else out.push({ label, entries: [entry] });
    }
    return out;
  }, [events]);
  return { events, groups, teamCount, loading, error };
}

/** Day-grouped transaction cards shared by the Feed tab and the League Activity sheet. */
export function MobileActivityList({
  empty,
  kinds,
}: {
  empty?: ReactNode;
  kinds?: LeagueActivityEvent["kind"][];
}) {
  const { groups, loading, error } = useLeagueActivityGroups(kinds);
  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players;
  const { teams } = useLeagueRosters([]);
  const { activeLeague } = useActiveLeague();

  const index = useMemo(() => buildActivityPlayerIndex(players), [players]);
  const logoByTeam = useMemo(() => new Map(teams.map((t) => [t.team.trim(), t.logo])), [teams]);
  const isEspn = activeLeague?.platform === "espn";
  const rows: MoveRowHelpers = {
    hydrate: (m) => hydrateActivityMove(m, index.playersById, index.playersByName),
    headshotFor: (m) =>
      isEspn && /^\d+$/.test(m.playerId) && !index.playersById.has(m.playerId)
        ? `https://a.espncdn.com/i/headshots/nfl/players/full/${m.playerId}.png`
        : null,
    openableId: (m) => (index.playersById.has(m.playerId) ? m.playerId : null),
  };

  if (loading) return <p className="py-10 text-center text-sm text-m-muted">Loading league activity...</p>;
  if (error) return <p className="py-10 text-center text-sm text-m-muted">League activity is unavailable right now.</p>;
  if (!groups.length) return empty ?? <p className="py-10 text-center text-sm text-m-muted">No transactions this season.</p>;

  return (
    <>
      {groups.map((group) => (
        <div key={group.label}>
          <div className="my-4 flex items-center gap-3 text-sm font-semibold text-m-muted">
            <span className="h-px flex-1 bg-m-border" />
            {group.label}
            <span className="h-px flex-1 bg-m-border" />
          </div>
          <div className="space-y-3">
            {group.entries.map((entry) =>
              entry.type === "waiverRun" ? (
                <WaiverRunCard key={entry.id} at={entry.at} events={entry.events} rows={rows} />
              ) : resolveActivityKind(entry.event) === "trade" ? (
                <TradeCard key={entry.event.id} event={entry.event} rows={rows} />
              ) : (
                <ActivityCard key={entry.event.id} event={entry.event} logoByTeam={logoByTeam} rows={rows} />
              ),
            )}
          </div>
        </div>
      ))}
    </>
  );
}

/** Pull-up League Activity sheet pinned above the bottom tab bar. */
export function MobileLeagueActivitySheet() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { events, teamCount, loading } = useLeagueActivityGroups();
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ startY: number; moved: boolean } | null>(null);

  // Tab changes must dismiss the sheet; otherwise iOS keeps it expanded across navigations.
  useEffect(() => {
    setOpen(false);
    setDragY(0);
    drag.current = null;
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.startY;
    if (Math.abs(dy) > 4) drag.current.moved = true;
    setDragY(dy);
  };
  const onPointerUp = () => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    if (!state.moved) setOpen((v) => !v);
    else if (dragY < -40) setOpen(true);
    else if (dragY > 40) setOpen(false);
    setDragY(0);
  };

  const offset = open ? Math.max(0, dragY) : Math.min(0, dragY);
  const transform = open
    ? `translateY(${offset}px)`
    : `translateY(calc(100% - ${PEEK_HEIGHT} + ${offset}px))`;
  const latest = events[0];

  return (
    <>
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={cn(
          "fixed inset-0 z-30 bg-black/40 transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <section
        aria-label="League Activity"
        className={cn(
          // Collapsed: only the peek handle receives taps. The translated sheet body
          // would otherwise sit over the bottom tabs on iOS and steal Link presses.
          "fixed inset-x-0 z-30 mx-auto flex max-w-md flex-col rounded-t-2xl bg-m-sheet text-m-card-fg shadow-[0_-4px_16px_rgba(0,0,0,0.25)]",
          open ? "pointer-events-auto" : "pointer-events-none",
          !drag.current && "transition-transform duration-300 ease-out",
        )}
        style={{
          top: SHEET_TOP_GAP,
          bottom: `calc(${NAV_HEIGHT} + env(safe-area-inset-bottom))`,
          transform,
        }}
      >
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((v) => !v);
            }
          }}
          className="pointer-events-auto shrink-0 cursor-grab touch-none select-none px-4 pb-2 pt-2"
          style={{ minHeight: PEEK_HEIGHT }}
        >
          <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-m-muted/50" />
          {open ? (
            <div className="text-center">
              <p className="font-display text-lg font-bold">League Activity</p>
              {teamCount ? <p className="text-xs text-m-muted">{teamCount} members</p> : null}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-m-accent text-m-accent-fg">
                <ArrowLeftRight className="size-4" strokeWidth={2.5} />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-base font-bold leading-tight">League Activity</span>
                <span className="block truncate text-sm text-m-muted">
                  {loading ? "Loading moves..." : latest ? eventSummary(latest) : "No transactions yet"}
                </span>
              </span>
            </div>
          )}
        </div>

        <div className={cn("min-h-0 flex-1 px-4 pb-6", open ? "overflow-y-auto" : "overflow-hidden")}>
          <MobileActivityList />
        </div>
      </section>
    </>
  );
}

type MoveRowHelpers = {
  hydrate: (move: LeagueActivityMove) => LeagueActivityMove;
  headshotFor: (move: LeagueActivityMove) => string | null;
  openableId: (move: LeagueActivityMove) => string | null;
};

function MoveRow({
  move,
  action,
  note,
  rows,
}: {
  move: LeagueActivityMove;
  action: LeagueActivityMove["action"];
  note?: string;
  rows: MoveRowHelpers;
}) {
  const openPlayer = useOpenMobilePlayer();
  const pos = move.pos.toUpperCase();
  const ActionIcon = action === "add" ? Plus : Minus;
  const openId = rows.openableId(move);
  return (
    <li
      className={cn("flex items-center gap-3 px-3 py-2", openId && "cursor-pointer")}
      {...playerPressProps(openPlayer, openId)}
    >
      {action === "ir" ? (
        <span className="w-5 text-center text-[11px] font-bold text-m-muted">IR</span>
      ) : (
        <ActionIcon
          className={cn("size-5 shrink-0", action === "add" ? "text-emerald-500" : "text-red-500")}
          strokeWidth={2.5}
        />
      )}
      <PlayerAvatar
        id={move.playerId}
        pos={(AVATAR_POS.has(pos) ? pos : "WR") as Pos}
        team={move.team}
        name={move.name}
        className="size-10"
        logoClassName="size-4"
        src={rows.headshotFor(move)}
      />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold">{move.name}</span>
        <span className="block truncate text-xs text-m-muted">
          {pos} - {move.team || "FA"}
          {note ? ` · ${note}` : ""}
        </span>
      </span>
    </li>
  );
}

function CardHeader({ title, kind, at, logo }: { title: string; kind: string; at: number; logo?: ReactNode }) {
  return (
    <header className="flex items-center gap-2.5 border-b border-m-border px-3 py-2.5">
      {logo}
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
      <span className="shrink-0 text-right text-[11px] leading-tight text-m-muted">
        <span className="block font-semibold uppercase tracking-wide">{kind}</span>
        {timeLabel(at)}
      </span>
    </header>
  );
}

function TeamLabel({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-0.5 pt-2.5 text-xs font-semibold text-m-muted">{children}</p>;
}

/** One waiver run: every claim the host processed together, grouped by team. */
function WaiverRunCard({ at, events, rows }: { at: number; events: LeagueActivityEvent[]; rows: MoveRowHelpers }) {
  const claims = events.reduce(
    (n, e) => n + Math.max(1, e.moves.filter((m) => resolveMoveAction(m, "waiver") === "add").length),
    0,
  );
  return (
    <article className="overflow-hidden rounded-xl border border-m-border bg-m-card">
      <CardHeader title={`${claims} Waiver Claim${claims === 1 ? "" : "s"} Processed`} kind="Waivers" at={at} />
      <div className="divide-y divide-m-border pb-1">
        {events.map((event) => {
          const moves = event.moves.map(rows.hydrate);
          const ordered = [
            ...moves.filter((m) => resolveMoveAction(m, "waiver") === "add"),
            ...moves.filter((m) => resolveMoveAction(m, "waiver") !== "add"),
          ];
          return (
            <div key={event.id}>
              <TeamLabel>{event.teamName ?? "League"}</TeamLabel>
              <ul>
                {ordered.map((move, i) => (
                  <MoveRow
                    key={`${move.playerId}-${i}`}
                    move={move}
                    action={resolveMoveAction(move, "waiver")}
                    rows={rows}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </article>
  );
}

/** Trade split by team: what each side received (+) and sent (-). */
function TradeCard({ event, rows }: { event: LeagueActivityEvent; rows: MoveRowHelpers }) {
  const moves = event.moves.map(rows.hydrate);
  const teams = tradeTeams(moves);
  const adds = moves.filter((m) => m.action === "add");
  const releases = moves.filter((m) => m.action === "drop");

  return (
    <article className="overflow-hidden rounded-xl border border-m-border bg-m-card">
      <CardHeader title={teams.length === 2 ? `${teams[0]} and ${teams[1]}` : "Trade"} kind="Trade" at={event.at} />
      <div className="divide-y divide-m-border pb-1">
        {teams.map((team) => {
          const received = adds.filter((m) => m.fantasyTeam?.trim() === team);
          const sent = adds.filter((m) => m.fromFantasyTeam?.trim() === team);
          const released = releases.filter((m) => m.fantasyTeam?.trim() === team);
          if (!received.length && !sent.length && !released.length) return null;
          return (
            <div key={team}>
              <TeamLabel>{team}</TeamLabel>
              <ul>
                {received.map((move, i) => (
                  <MoveRow
                    key={`in-${move.playerId}-${i}`}
                    move={move}
                    action="add"
                    rows={rows}
                    {...(move.fromFantasyTeam ? { note: `from ${move.fromFantasyTeam}` } : {})}
                  />
                ))}
                {sent.map((move, i) => (
                  <MoveRow
                    key={`out-${move.playerId}-${i}`}
                    move={move}
                    action="drop"
                    rows={rows}
                    {...(move.fantasyTeam ? { note: `to ${move.fantasyTeam}` } : {})}
                  />
                ))}
                {released.map((move, i) => (
                  <MoveRow key={`drop-${move.playerId}-${i}`} move={move} action="drop" note="dropped" rows={rows} />
                ))}
              </ul>
            </div>
          );
        })}
        {!teams.length ? <p className="px-3 py-3 text-sm text-m-muted">{event.text}</p> : null}
      </div>
    </article>
  );
}

/** Free-agent and IR moves for a single team. */
function ActivityCard({
  event,
  logoByTeam,
  rows,
}: {
  event: LeagueActivityEvent;
  logoByTeam: Map<string, string | null>;
  rows: MoveRowHelpers;
}) {
  const kind = resolveActivityKind(event);
  const moves = event.moves.map(rows.hydrate);
  const ordered = [
    ...moves.filter((m) => resolveMoveAction(m, kind) === "add"),
    ...moves.filter((m) => resolveMoveAction(m, kind) !== "add"),
  ];
  const title = event.teamName ?? "League";

  return (
    <article className="overflow-hidden rounded-xl border border-m-border bg-m-card">
      <CardHeader
        title={title}
        kind={KIND_LABEL[kind]}
        at={event.at}
        logo={<MobileTeamLogo name={title} logo={logoByTeam.get(title.trim()) ?? null} className="size-8" />}
      />
      {ordered.length ? (
        <ul className="py-1">
          {ordered.map((move, i) => (
            <MoveRow key={`${move.playerId}-${i}`} move={move} action={resolveMoveAction(move, kind)} rows={rows} />
          ))}
        </ul>
      ) : (
        <p className="px-3 py-3 text-sm text-m-muted">{event.text}</p>
      )}
    </article>
  );
}
