import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeftRight, Minus, Newspaper, Plus, Shirt, Swords, Trophy, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";

import { buildActivityPlayerIndex, hydrateActivityMove } from "@/components/dashboard/ActivityFeed";
import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-m-border bg-m-nav"
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
    const out: { label: string; events: LeagueActivityEvent[] }[] = [];
    for (const event of events) {
      const label = dayLabel(event.at);
      const last = out.at(-1);
      if (last?.label === label) last.events.push(event);
      else out.push({ label, events: [event] });
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
  const hydrate = (m: LeagueActivityMove) => hydrateActivityMove(m, index.playersById, index.playersByName);
  const isEspn = activeLeague?.platform === "espn";
  const headshotFor = (m: LeagueActivityMove) =>
    isEspn && /^\d+$/.test(m.playerId) && !index.playersById.has(m.playerId)
      ? `https://a.espncdn.com/i/headshots/nfl/players/full/${m.playerId}.png`
      : null;

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
            {group.events.map((event) => (
              <ActivityCard
                key={event.id}
                event={event}
                moves={event.moves.map(hydrate)}
                logoByTeam={logoByTeam}
                headshotFor={headshotFor}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** Pull-up League Activity sheet pinned above the bottom tab bar. */
export function MobileLeagueActivitySheet() {
  const { events, teamCount, loading } = useLeagueActivityGroups();
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ startY: number; moved: boolean } | null>(null);

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
          "fixed inset-x-0 z-30 mx-auto flex max-w-md flex-col rounded-t-2xl bg-m-sheet text-m-card-fg shadow-[0_-4px_16px_rgba(0,0,0,0.25)]",
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
          className="shrink-0 cursor-grab touch-none select-none px-4 pb-2 pt-2"
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

function ActivityCard({
  event,
  moves,
  logoByTeam,
  headshotFor,
}: {
  event: LeagueActivityEvent;
  moves: LeagueActivityMove[];
  logoByTeam: Map<string, string | null>;
  headshotFor: (move: LeagueActivityMove) => string | null;
}) {
  const trade = event.kind === "trade";
  const tradeTeams = trade
    ? [...new Set(moves.map((m) => m.fantasyTeam?.trim()).filter((t): t is string => Boolean(t)))]
    : [];
  const title = trade ? tradeTeams.join(" and ") || "Trade" : (event.teamName ?? "League");
  const ordered = [...moves.filter((m) => m.action === "add"), ...moves.filter((m) => m.action !== "add")];

  return (
    <article className="overflow-hidden rounded-xl border border-m-border bg-m-card">
      <header className="flex items-center gap-2.5 border-b border-m-border px-3 py-2.5">
        <MobileTeamLogo
          name={title}
          logo={trade ? null : (logoByTeam.get((event.teamName ?? "").trim()) ?? null)}
          className="size-8"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
        <span className="shrink-0 text-right text-[11px] leading-tight text-m-muted">
          <span className="block font-semibold uppercase tracking-wide">{KIND_LABEL[event.kind]}</span>
          {timeLabel(event.at)}
        </span>
      </header>
      {ordered.length ? (
        <ul>
          {ordered.map((move, i) => {
            const pos = move.pos.toUpperCase();
            const ActionIcon = move.action === "add" ? Plus : Minus;
            return (
              <li key={`${move.playerId}-${i}`} className="flex items-center gap-3 px-3 py-2.5">
                {move.action === "ir" ? (
                  <span className="w-5 text-center text-[11px] font-bold text-m-muted">IR</span>
                ) : (
                  <ActionIcon
                    className={cn("size-5 shrink-0", move.action === "add" ? "text-emerald-500" : "text-red-500")}
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
                  src={headshotFor(move)}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">{move.name}</span>
                  <span className="block truncate text-xs text-m-muted">
                    {move.team || "FA"} - {pos}
                    {trade && move.action === "add" && move.fantasyTeam ? ` · to ${move.fantasyTeam}` : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-3 py-3 text-sm text-m-muted">{event.text}</p>
      )}
    </article>
  );
}
