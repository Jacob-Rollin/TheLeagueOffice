import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import { ChartLine, FilePlus2, Search, Star } from "lucide-react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import {
  fillRoster,
  posDisplayLabel,
  roundOf,
  teamName,
  value,
  type Pick,
  type Player,
  type Pos,
  type Settings,
} from "@/lib/draft";
import { injuryBadgeInfo } from "@/lib/injury-badge";
import {
  EMPTY_COUNTING_STATS,
  POS_STAT_COLUMNS,
  type CountingStats,
} from "@/lib/players-build";
import { resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { cn } from "@/lib/utils";

import { POS_DOT, posCellClass } from "./posCellStyles";
import { pickLabelForOverall } from "./MobileMockDraftBoard";

type SheetTab = "players" | "queue" | "team";
type SheetSnap = "collapsed" | "peek" | "expanded";

const POS_FILTERS: Array<"ALL" | Pos> = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * Sheet height snaps (% of arena). Collapsed is overwritten at runtime to fit
 * the grabber + tabs only (Sleeper-style board-max view).
 */
const SNAP_PCT: Record<SheetSnap, number> = {
  collapsed: 9,
  peek: 36,
  expanded: 88,
};

function nearestSheetSnap(pct: number, collapsedPct: number): SheetSnap {
  const targets: Array<[SheetSnap, number]> = [
    ["collapsed", collapsedPct],
    ["peek", SNAP_PCT.peek],
    ["expanded", SNAP_PCT.expanded],
  ];
  let best: SheetSnap = "peek";
  let bestDist = Infinity;
  for (const [key, val] of targets) {
    const d = Math.abs(val - pct);
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  }
  return best;
}

/**
 * Nested vertical + horizontal scrollers with strict gesture axis lock.
 * First 8px decides the axis; after that we preventDefault and drive only that
 * scroller so diagonal pans cannot move both. Never toggles overflow (that
 * resets scrollLeft and pops the list left).
 */
function DualAxisScroll({
  className,
  onHorizScroll,
  children,
}: {
  className?: string;
  onHorizScroll?: (e: UIEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const vertRef = useRef<HTMLDivElement | null>(null);
  const horizRef = useRef<HTMLDivElement | null>(null);
  const axisRef = useRef<"x" | "y" | null>(null);
  const startRef = useRef({ x: 0, y: 0, scrollTop: 0, scrollLeft: 0 });

  useEffect(() => {
    const vert = vertRef.current;
    const horiz = horizRef.current;
    if (!vert || !horiz) return;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      axisRef.current = null;
      startRef.current = {
        x: t.clientX,
        y: t.clientY,
        scrollTop: vert.scrollTop,
        scrollLeft: horiz.scrollLeft,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startRef.current.x;
      const dy = t.clientY - startRef.current.y;
      if (axisRef.current == null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axisRef.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        // Undo any diagonal drift from the decision window.
        vert.scrollTop = startRef.current.scrollTop;
        horiz.scrollLeft = startRef.current.scrollLeft;
      }
      // Own the gesture so the browser cannot pan the off-axis scroller.
      e.preventDefault();
      if (axisRef.current === "x") {
        horiz.scrollLeft = startRef.current.scrollLeft - dx;
        vert.scrollTop = startRef.current.scrollTop;
      } else {
        vert.scrollTop = startRef.current.scrollTop - dy;
        horiz.scrollLeft = startRef.current.scrollLeft;
      }
    };

    const onTouchEnd = () => {
      axisRef.current = null;
    };

    vert.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    // Non-passive so preventDefault can stop diagonal browser scrolling.
    vert.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    vert.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    vert.addEventListener("touchcancel", onTouchEnd, { passive: true, capture: true });

    return () => {
      vert.removeEventListener("touchstart", onTouchStart, true);
      vert.removeEventListener("touchmove", onTouchMove, true);
      vert.removeEventListener("touchend", onTouchEnd, true);
      vert.removeEventListener("touchcancel", onTouchEnd, true);
    };
  }, []);

  return (
    <div
      ref={vertRef}
      className={cn(
        // touch-none: browser must not pan either axis; JS owns the gesture after axis lock.
        "min-h-0 flex-1 touch-none overflow-y-auto overflow-x-hidden overscroll-contain",
        className,
      )}
    >
      <div
        ref={horizRef}
        className="overflow-x-auto overflow-y-hidden overscroll-x-contain touch-none [-webkit-overflow-scrolling:touch]"
        onScroll={onHorizScroll}
      >
        {children}
      </div>
    </div>
  );
}

/** Approx. Draft + rank + name width — past this, Sleeper-style mini name sticks. */
const NAME_SCROLL_THRESHOLD_PX = 168;
const NAME_COL_CLASS = "w-[7.25rem]";
const STAR_COL_CLASS = "w-8";

export function MobileMockDraftSheet({
  tab,
  onTabChange,
  settings,
  season,
  available,
  queuedPlayers,
  watchIds,
  draftedIds,
  picks,
  byId,
  myTurn,
  complete,
  myCounts,
  currentOverall,
  nextUserOverall,
  queueAutopickOn,
  onQueueAutopickChange,
  rosterTeam,
  onRosterTeamChange,
  onDraft,
  onToggleQueue,
  onOpenPlayer,
}: {
  tab: SheetTab;
  onTabChange: (t: SheetTab) => void;
  settings: Settings;
  /** Catalog season (e.g. "2026"); previous-year toggle uses season - 1. */
  season: string;
  available: Player[];
  queuedPlayers: Player[];
  watchIds: Set<string>;
  draftedIds: Set<string>;
  picks: Pick[];
  byId: Map<string, Player>;
  myTurn: boolean;
  complete: boolean;
  myCounts: Record<string, number>;
  currentOverall: number;
  nextUserOverall: number | null;
  queueAutopickOn: boolean;
  onQueueAutopickChange: (on: boolean) => void;
  rosterTeam: number;
  onRosterTeamChange: (t: number) => void;
  onDraft: (id: string) => void;
  onToggleQueue: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const prevYear = Math.max(2000, (Number(season) || new Date().getFullYear()) - 1);
  const draftedPlayers = useMemo(() => {
    return picks
      .slice()
      .sort((a, b) => a.overall - b.overall)
      .map((p) => byId.get(p.playerId))
      .filter((p): p is Player => p != null);
  }, [picks, byId]);
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const [dragPct, setDragPct] = useState<number | null>(null);
  const [collapsedPct, setCollapsedPct] = useState(SNAP_PCT.collapsed);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startY: number;
    startPct: number;
    parentH: number;
    moved: boolean;
  } | null>(null);
  /** After a vertical drag on the header, ignore the synthetic click on a tab. */
  const suppressTabClickRef = useRef(false);

  const snapPct = (s: SheetSnap) => (s === "collapsed" ? collapsedPct : SNAP_PCT[s]);
  const heightPct = dragPct ?? snapPct(snap);

  const measureCollapsedPct = () => {
    const parentH = sheetRef.current?.parentElement?.clientHeight ?? window.innerHeight;
    const chromeH = chromeRef.current?.offsetHeight ?? 52;
    if (parentH <= 0) return SNAP_PCT.collapsed;
    // Fit grabber + tabs only; pad 1px so the border doesn't clip.
    return Math.max(6, Math.min(18, ((chromeH + 1) / parentH) * 100));
  };

  useEffect(() => {
    const next = measureCollapsedPct();
    setCollapsedPct(next);
  }, [queuedPlayers.length]);

  useEffect(() => {
    if (complete) setSnap("peek");
  }, [complete]);

  const DRAG_THRESHOLD_PX = 8;

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const parentH = sheetRef.current?.parentElement?.clientHeight ?? window.innerHeight;
    const nextCollapsed = measureCollapsedPct();
    setCollapsedPct(nextCollapsed);
    dragRef.current = {
      startY: e.clientY,
      startPct: heightPct,
      parentH,
      moved: false,
    };
  };

  const onHeaderPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.parentH <= 0) return;
    const deltaY = drag.startY - e.clientY;
    if (!drag.moved) {
      if (Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
    }
    const deltaPct = (deltaY / drag.parentH) * 100;
    const floor = measureCollapsedPct();
    setDragPct(Math.min(92, Math.max(floor, drag.startPct + deltaPct)));
  };

  const onHeaderPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.moved) {
      const floor = measureCollapsedPct();
      setCollapsedPct(floor);
      const current = dragPct ?? snapPct(snap);
      setSnap(nearestSheetSnap(current, floor));
      // Swallow the click that follows a drag; clear if no click arrives.
      suppressTabClickRef.current = true;
      window.setTimeout(() => {
        suppressTabClickRef.current = false;
      }, 50);
    }
    setDragPct(null);
    dragRef.current = null;
  };

  const onTabPress = (key: SheetTab) => {
    if (suppressTabClickRef.current) {
      suppressTabClickRef.current = false;
      return;
    }
    onTabChange(key);
    // Opening a tab from fully collapsed pulls the sheet to peek.
    if (snap === "collapsed") setSnap("peek");
  };

  return (
    <div
      ref={sheetRef}
      className="flex shrink-0 flex-col overflow-hidden rounded-t-2xl border-t border-m-border bg-m-sheet shadow-[0_-8px_24px_rgba(0,0,0,0.28)] transition-[height] duration-200 ease-out"
      style={{
        height: `${heightPct}%`,
        transitionProperty: dragPct == null ? "height" : "none",
      }}
    >
      {/* Entire chrome (grabber + tabs) resizes the sheet; tabs only change on tap. */}
      <div
        ref={chromeRef}
        role="slider"
        aria-label="Resize player sheet"
        aria-valuemin={Math.round(collapsedPct)}
        aria-valuemax={SNAP_PCT.expanded}
        aria-valuenow={Math.round(heightPct)}
        tabIndex={0}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        onDoubleClick={() =>
          setSnap((s) =>
            s === "collapsed" ? "peek" : s === "peek" ? "expanded" : "collapsed",
          )
        }
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            setSnap((s) => (s === "collapsed" ? "peek" : "expanded"));
          }
          if (e.key === "ArrowDown") {
            setSnap((s) => (s === "expanded" ? "peek" : "collapsed"));
          }
        }}
        className="cursor-grab touch-none select-none active:cursor-grabbing"
      >
        <div className="flex items-center justify-center pt-1.5 pb-0.5">
          <span className="h-1 w-9 rounded-full bg-m-border" aria-hidden />
        </div>
        <div className="flex items-end gap-1 border-b border-m-border px-2" role="tablist">
          {(
            [
              ["players", "Players"],
              ["queue", queuedPlayers.length ? `Queue (${queuedPlayers.length})` : "Queue"],
              ["team", "Team"],
            ] as [SheetTab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => onTabPress(key)}
              className={cn(
                "flex-1 border-b-2 px-2 py-2 font-display text-xs font-bold uppercase tracking-widest transition-colors",
                tab === key
                  ? "border-m-accent text-m-accent"
                  : "border-transparent text-m-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "players" ? (
        <PlayersPane
          settings={settings}
          available={available}
          draftedPlayers={draftedPlayers}
          watchIds={watchIds}
          myTurn={myTurn}
          complete={complete}
          myCounts={myCounts}
          nextUserOverall={nextUserOverall}
          prevYear={prevYear}
          onDraft={onDraft}
          onToggleQueue={onToggleQueue}
          onOpenPlayer={onOpenPlayer}
        />
      ) : null}
      {tab === "queue" ? (
        <QueuePane
          queuedPlayers={queuedPlayers}
          settings={settings}
          myTurn={myTurn}
          complete={complete}
          queueAutopickOn={queueAutopickOn}
          onQueueAutopickChange={onQueueAutopickChange}
          onDraft={onDraft}
          onToggleQueue={onToggleQueue}
          onOpenPlayer={onOpenPlayer}
        />
      ) : null}
      {tab === "team" ? (
        <TeamPane
          settings={settings}
          picks={picks}
          byId={byId}
          draftedIds={draftedIds}
          rosterTeam={rosterTeam}
          onRosterTeamChange={onRosterTeamChange}
          onOpenPlayer={onOpenPlayer}
          currentOverall={currentOverall}
        />
      ) : null}
    </div>
  );
}

function PlayersPane({
  settings,
  available,
  draftedPlayers,
  watchIds,
  myTurn,
  complete,
  myCounts,
  nextUserOverall,
  prevYear,
  onDraft,
  onToggleQueue,
  onOpenPlayer,
}: {
  settings: Settings;
  available: Player[];
  draftedPlayers: Player[];
  watchIds: Set<string>;
  myTurn: boolean;
  complete: boolean;
  myCounts: Record<string, number>;
  nextUserOverall: number | null;
  prevYear: number;
  onDraft: (id: string) => void;
  onToggleQueue: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const [pos, setPos] = useState<"ALL" | Pos>("ALL");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [draftedOnly, setDraftedOnly] = useState(false);
  const [showPrevYear, setShowPrevYear] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const pool = draftedOnly ? draftedPlayers : available;
    return pool.filter((p) => {
      if (watchOnly && !watchIds.has(p.id)) return false;
      if (pos !== "ALL" && p.pos !== pos) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q);
    });
  }, [available, draftedPlayers, draftedOnly, watchOnly, watchIds, pos, deferredQuery]);

  const projIndex =
    draftedOnly || nextUserOverall == null
      ? -1
      : filtered.findIndex((p) => value(p, settings.scoring).adp >= nextUserOverall);

  const prevShort = `'${String(prevYear).slice(-2)}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          aria-label="Search players"
          onClick={() => setSearchOpen((o) => !o)}
          className="shrink-0 rounded-lg bg-m-icon-bg p-2 text-m-icon-fg"
        >
          <Search className="size-4" strokeWidth={2.5} />
        </button>
        {POS_FILTERS.map((p) => {
          const drafted =
            p === "ALL"
              ? Object.values(myCounts).reduce((a, b) => a + b, 0)
              : (myCounts[p] ?? 0);
          const totalSlots =
            p === "ALL"
              ? Object.values(settings.roster).reduce((a, b) => a + b, 0)
              : p === "DEF"
                ? settings.roster.DEF
                : Number(settings.roster[p as keyof typeof settings.roster] ?? 0);
          return (
            <button
              key={p}
              type="button"
              onClick={() => startTransition(() => setPos(p))}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide",
                pos === p ? "bg-m-card-fg text-m-bg" : "bg-m-chip text-m-chip-fg",
              )}
            >
              {p === "DEF" ? "DST" : p}
              {p === "ALL" || totalSlots > 0
                ? ` ${drafted}/${p === "ALL" ? totalSlots : Math.max(totalSlots, drafted)}`
                : ""}
            </button>
          );
        })}
        <span className="mx-0.5 h-5 w-px shrink-0 bg-m-border" aria-hidden />
        <ToolChip
          active={watchOnly}
          onClick={() => {
            setWatchOnly((v) => !v);
            if (!watchOnly) setDraftedOnly(false);
          }}
        >
          <Star className={cn("size-3.5", watchOnly && "fill-current")} strokeWidth={2.5} />
          Watchlist
        </ToolChip>
        <ToolChip
          active={draftedOnly}
          onClick={() => {
            setDraftedOnly((v) => !v);
            if (!draftedOnly) setWatchOnly(false);
          }}
        >
          Drafted
        </ToolChip>
        <ToolChip active={showPrevYear} onClick={() => setShowPrevYear((v) => !v)}>
          <ChartLine className="size-3.5" strokeWidth={2.5} />
          {prevShort} Stats
        </ToolChip>
      </div>

      {searchOpen ? (
        <div className="px-3 pb-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players"
            className="w-full rounded-lg border border-m-border bg-m-card px-3 py-2 text-sm text-m-card-fg outline-none placeholder:text-m-muted"
          />
        </div>
      ) : null}

      <DualAxisScroll
        className="px-2 pb-3"
        onHorizScroll={(e) => {
          const el = e.currentTarget;
          const on = el.scrollLeft > NAME_SCROLL_THRESHOLD_PX;
          if (el.classList.contains("is-scrolled-x") !== on) {
            el.classList.toggle("is-scrolled-x", on);
          }
        }}
      >
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-m-muted">
            {draftedOnly
              ? "No drafted players match these filters."
              : watchOnly
                ? "No watchlist players match these filters."
                : "No players match these filters."}
          </p>
        ) : null}
        <div className="min-w-max">
          {filtered.map((p, i) => (
            <div key={p.id}>
              {projIndex === i && nextUserOverall != null ? (
                <div className="my-1 flex w-[100vw] max-w-md items-center gap-2 px-1">
                  <span className="h-px flex-1 bg-m-accent/70" />
                  <span className="font-display text-[10px] font-bold uppercase tracking-wider text-m-accent">
                    Proj pick: Round {roundOf(nextUserOverall, settings.teams)} Overall #
                    {nextUserOverall}
                  </span>
                  <span className="h-px flex-1 bg-m-accent/70" />
                </div>
              ) : null}
              <PlayerStatsRow
                player={p}
                settings={settings}
                rank={i + 1}
                queued={watchIds.has(p.id)}
                myTurn={myTurn}
                complete={complete || draftedOnly}
                showPrevYear={showPrevYear}
                prevYear={prevYear}
                onDraft={onDraft}
                onToggleQueue={onToggleQueue}
                onOpenPlayer={onOpenPlayer}
              />
            </div>
          ))}
        </div>
      </DualAxisScroll>
    </div>
  );
}

function ToolChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide transition-colors",
        active
          ? "border-m-accent bg-m-accent/15 text-m-accent"
          : "border-m-border bg-m-chip text-m-chip-fg",
      )}
    >
      {children}
    </button>
  );
}

function QueuePane({
  queuedPlayers,
  settings,
  myTurn,
  complete,
  queueAutopickOn,
  onQueueAutopickChange,
  onDraft,
  onToggleQueue,
  onOpenPlayer,
}: {
  queuedPlayers: Player[];
  settings: Settings;
  myTurn: boolean;
  complete: boolean;
  queueAutopickOn: boolean;
  onQueueAutopickChange: (on: boolean) => void;
  onDraft: (id: string) => void;
  onToggleQueue: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-2 px-3 py-2">
        <span className="text-xs text-m-muted">Auto-pick</span>
        <button
          type="button"
          role="switch"
          aria-checked={queueAutopickOn}
          onClick={() => onQueueAutopickChange(!queueAutopickOn)}
          className={cn(
            "relative h-6 w-11 rounded-full transition-colors",
            queueAutopickOn ? "bg-m-accent" : "bg-m-border",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-white transition-transform",
              queueAutopickOn ? "left-5" : "left-0.5",
            )}
          />
        </button>
      </div>
      {queuedPlayers.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-8 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full bg-m-accent/20 text-m-accent">
            <FilePlus2 className="size-7" strokeWidth={2} />
          </span>
          <p className="font-display text-base font-bold text-m-card-fg">Draft queue is empty</p>
          <p className="text-sm text-m-muted">
            Speed up the draft by adding players to your queue from the players tab.
          </p>
        </div>
      ) : (
        <DualAxisScroll
          className="px-2 pb-3"
          onHorizScroll={(e) => {
            const el = e.currentTarget;
            const on = el.scrollLeft > NAME_SCROLL_THRESHOLD_PX;
            if (el.classList.contains("is-scrolled-x") !== on) {
              el.classList.toggle("is-scrolled-x", on);
            }
          }}
        >
          <div className="min-w-max">
            {queuedPlayers.map((p, i) => (
              <PlayerStatsRow
                key={p.id}
                player={p}
                settings={settings}
                rank={i + 1}
                queued
                myTurn={myTurn}
                complete={complete}
                showPrevYear={false}
                prevYear={0}
                onDraft={onDraft}
                onToggleQueue={onToggleQueue}
                onOpenPlayer={onOpenPlayer}
              />
            ))}
          </div>
        </DualAxisScroll>
      )}
    </div>
  );
}

function TeamPane({
  settings,
  picks,
  byId,
  rosterTeam,
  onRosterTeamChange,
  onOpenPlayer,
}: {
  settings: Settings;
  picks: Pick[];
  byId: Map<string, Player>;
  draftedIds: Set<string>;
  rosterTeam: number;
  onRosterTeamChange: (t: number) => void;
  onOpenPlayer: (id: string) => void;
  currentOverall: number;
}) {
  const roster = picks
    .filter((p) => p.team === rosterTeam)
    .map((p) => ({ pick: p, player: byId.get(p.playerId) }))
    .filter((x): x is { pick: Pick; player: Player } => Boolean(x.player));
  const players = roster.map((r) => r.player);
  const slots = fillRoster(players, settings.roster);
  const pickByPlayer = new Map(roster.map((r) => [r.player.id, r.pick]));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1.5 overflow-x-auto px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {Array.from({ length: settings.teams }, (_, i) => i + 1).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onRosterTeamChange(t)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide",
              rosterTeam === t ? "bg-m-card-fg text-m-bg" : "bg-m-chip text-m-chip-fg",
            )}
          >
            {t === settings.myTeam ? teamName(settings, t) : `Slot ${t}`}
          </button>
        ))}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {slots.map((s, i) => {
          const pick = s.player ? pickByPlayer.get(s.player.id) : undefined;
          return (
            <li
              key={`${s.slot}-${i}`}
              className="flex items-center gap-3 border-b border-m-border py-2.5"
            >
              <span
                className={cn(
                  "inline-flex h-8 min-w-[2.6rem] items-center justify-center rounded-md px-1.5 font-display text-[11px] font-bold uppercase",
                  s.player ? posCellClass(s.player.pos) : "bg-m-chip text-m-chip-fg",
                  !s.player && (POS_DOT[s.slot] ? "" : ""),
                )}
              >
                {s.slot === "DEF"
                  ? "DST"
                  : s.slot === "BN"
                    ? "BN"
                    : s.slot === "SUPER_FLEX"
                      ? "SF"
                      : s.slot === "FLEX"
                        ? "WRT"
                        : s.slot}
              </span>
              {s.player ? (
                <button
                  type="button"
                  onClick={() => onOpenPlayer(s.player!.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <PlayerAvatar
                    id={s.player.id}
                    pos={s.player.pos}
                    team={s.player.team}
                    name={s.player.name}
                    className="size-9"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-m-card-fg">
                      {s.player.name}
                    </span>
                    <span className="block text-[11px] text-m-muted">
                      {posDisplayLabel(s.player.pos)} · {s.player.team}
                      {s.player.bye ? ` (${s.player.bye})` : ""}
                    </span>
                  </span>
                </button>
              ) : (
                <span className="flex-1 text-sm text-m-muted">Empty</span>
              )}
              {pick ? (
                <span className="text-right">
                  <span className="tabnum block rounded-full bg-m-chip px-2 py-0.5 text-xs font-semibold text-m-chip-fg">
                    {pickLabelForOverall(pick.overall, settings.teams)}
                  </span>
                  <span className="mt-0.5 block text-[9px] uppercase text-m-muted">pick</span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Full row scrolls (Draft + name + star + stats). Mini name sticks via CSS when
 * the scroll parent has `.is-scrolled-x` (no React re-render on pan).
 */
function PlayerStatsRow({
  player,
  settings,
  rank,
  queued,
  myTurn,
  complete,
  showPrevYear,
  prevYear,
  onDraft,
  onToggleQueue,
  onOpenPlayer,
}: {
  player: Player;
  settings: Settings;
  rank: number;
  queued: boolean;
  myTurn: boolean;
  complete: boolean;
  showPrevYear: boolean;
  prevYear: number;
  onDraft: (id: string) => void;
  onToggleQueue: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const v = value(player, settings.scoring);
  const short = shortName(player.name);
  const yearShort = `'${String(prevYear).slice(-2)}`;
  const meta = `${posDisplayLabel(player.pos)} - ${player.team}${player.bye ? ` (${player.bye})` : ""}`;
  const injury = injuryBadgeInfo(
    resolveInjuryStatus(player) ?? player.injury_status ?? player.injury,
  );
  const projLine: CountingStats = player.projLine ?? EMPTY_COUNTING_STATS;
  const prevLine = player.prevLine;
  const prevAdp = player.prevAdp?.[settings.scoring];
  const posCols = POS_STAT_COLUMNS[player.pos] ?? [];

  const showPrevTgt =
    showPrevYear &&
    (player.pos === "WR" || player.pos === "TE") &&
    (prevLine?.rec_tgt ?? 0) > 0;

  return (
    <div className="relative border-b border-m-border/60">
      {/* Overlay mini-name — no display/height toggle (avoids layout thrash while panning). */}
      <div className="pointer-events-none sticky left-0 z-20 h-0 w-0 overflow-visible">
        <div className="absolute left-0 top-0 max-w-[75vw] whitespace-nowrap bg-m-sheet/95 px-1 py-0.5 opacity-0 backdrop-blur-sm transition-opacity duration-100 [.is-scrolled-x_&]:pointer-events-auto [.is-scrolled-x_&]:opacity-100">
          <button
            type="button"
            onClick={() => onOpenPlayer(player.id)}
            className="flex items-center gap-1.5 text-left font-display text-[10px] font-bold uppercase tracking-wide text-m-muted"
          >
            <span className="truncate text-m-card-fg">{short}</span>
            <span
              className={cn("size-1 shrink-0 rounded-full", POS_DOT[player.pos] ?? "bg-m-muted")}
              aria-hidden
            />
            <span className="truncate">{meta}</span>
            {injury ? (
              <span
                title={injury.text}
                className={cn(
                  "inline-flex h-3.5 min-w-[0.9rem] shrink-0 items-center justify-center rounded px-0.5 text-[8px] font-black leading-none",
                  injury.className,
                )}
              >
                {injury.letter}
              </span>
            ) : null}
          </button>
          <div className="mt-0.5 h-px w-full bg-m-border/70" aria-hidden />
        </div>
      </div>

      <div className="flex items-stretch gap-1.5 py-1.5">
        {!complete ? (
          <button
            type="button"
            disabled={!myTurn}
            onClick={() => onDraft(player.id)}
            className={cn(
              "my-0.5 w-[3.25rem] shrink-0 self-stretch rounded-lg font-display text-[11px] font-extrabold uppercase tracking-wide",
              myTurn
                ? "bg-m-accent text-m-accent-fg"
                : "bg-m-chip text-m-muted opacity-70",
            )}
          >
            Draft
          </button>
        ) : null}
        <span className="tabnum flex w-5 shrink-0 items-center justify-center text-xs text-m-muted">
          {rank}
        </span>
        <button
          type="button"
          onClick={() => onOpenPlayer(player.id)}
          className={cn(NAME_COL_CLASS, "shrink-0 py-0.5 text-left")}
        >
          <span className="block truncate text-[13px] font-bold text-m-card-fg">{short}</span>
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-m-muted">
            <span
              className={cn("size-1.5 shrink-0 rounded-full", POS_DOT[player.pos] ?? "bg-m-muted")}
              aria-hidden
            />
            <span className="min-w-0 truncate">{meta}</span>
            {injury ? (
              <span
                title={injury.text}
                className={cn(
                  "inline-flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded px-0.5 text-[9px] font-black leading-none",
                  injury.className,
                )}
              >
                {injury.letter}
              </span>
            ) : null}
          </span>
        </button>
        <button
          type="button"
          aria-label={queued ? "Remove from queue" : "Add to queue"}
          onClick={() => onToggleQueue(player.id)}
          className={cn(
            STAR_COL_CLASS,
            "flex shrink-0 items-center justify-center self-center",
            queued ? "text-m-accent" : "text-m-muted",
          )}
        >
          <Star className={cn("size-4", queued && "fill-current")} strokeWidth={2.5} />
        </button>
        <div className="flex shrink-0 items-center gap-3 self-center pr-4">
          <StatCell label="ADP" value={v.adp < 900 ? v.adp.toFixed(1) : "—"} />
          {showPrevYear ? (
            <StatCell
              label={`${yearShort} ADP`}
              value={prevAdp != null && prevAdp < 900 ? prevAdp.toFixed(1) : "—"}
              muted
            />
          ) : null}
          <StatCell label="Pts" value={v.proj > 0 ? v.proj.toFixed(1) : "—"} />
          {showPrevYear ? (
            <StatCell
              label={`${yearShort} Pts`}
              value={v.prev != null && v.prev > 0 ? v.prev.toFixed(1) : "—"}
              muted
            />
          ) : null}
          {showPrevTgt ? (
            <StatCell
              label={`${yearShort} Tgt`}
              value={(prevLine?.rec_tgt ?? 0).toFixed(0)}
              muted
            />
          ) : null}
          {posCols.map((col) => {
            const cur = projLine[col.key];
            const prior = prevLine?.[col.key];
            return (
              <div key={col.key} className="flex shrink-0 items-center gap-3">
                <StatCell
                  label={col.label}
                  value={cur > 0 ? cur.toFixed(col.digits) : "—"}
                />
                {showPrevYear ? (
                  <StatCell
                    label={yearShort}
                    value={prior != null && prior > 0 ? prior.toFixed(col.digits) : "—"}
                    muted
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="w-12 shrink-0 text-left">
      <span className="block text-[9px] font-semibold uppercase tracking-wide text-m-muted">
        {label}
      </span>
      <span
        className={cn(
          "tabnum block text-sm font-semibold",
          muted ? "text-m-muted" : "text-m-card-fg",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.toUpperCase();
  const first = parts[0]!;
  return `${first[0]}. ${parts.slice(1).join(" ")}`.toUpperCase();
}
