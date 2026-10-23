import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery } from "@tanstack/react-query";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  ArrowDown,
  ArrowUp,
  ChartLine,
  FilePlus2,
  Info,
  Search,
  Shield,
  Star,
  Trash2,
  User,
  X,
} from "lucide-react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  FLEX_POSITIONS,
  fillRoster,
  posDisplayLabel,
  roundOf,
  teamName,
  value,
  type Pick,
  type Player,
  type Pos,
  type RosterSlots,
  type Settings,
} from "@/lib/draft";
import { injuryBadgeInfo } from "@/lib/injury-badge";
import {
  EMPTY_COUNTING_STATS,
  POS_STAT_COLUMNS,
  type CountingStats,
} from "@/lib/players-build";
import { resolveInjuryStatus } from "@/lib/sandbox-rosters";
import {
  fetchSeasonProjectedBoardExtras,
  type SeasonProjBoardExtras,
} from "@/lib/sleeper-client";
import { cn } from "@/lib/utils";

import { POS_DOT, posSlotBadgeClass } from "./posCellStyles";
import { pickLabelForOverall } from "./MobileMockDraftBoard";

type SheetTab = "players" | "queue" | "team";
type SheetSnap = "collapsed" | "peek" | "expanded";
type PosFilter = "ALL" | Pos | "FLEX";

/** Sleeper order: FLEX sits between TE and K. */
const POS_FILTERS: PosFilter[] = ["ALL", "QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];

/**
 * Drafted / slot totals for pos chips. Denominator is always the league roster
 * setting (never grows with over-drafts). FLEX numerator only counts RB/WR/TE
 * drafted after their dedicated starter slots are filled.
 */
function posFilterSlotCount(
  filter: PosFilter,
  myCounts: Record<string, number>,
  roster: RosterSlots,
): { drafted: number; total: number } | null {
  if (filter === "ALL") {
    return {
      drafted: Object.values(myCounts).reduce((a, b) => a + b, 0),
      total: Object.values(roster).reduce((a, b) => a + b, 0),
    };
  }
  if (filter === "FLEX") {
    const total = Math.max(0, roster.FLEX ?? 0);
    if (total <= 0) return null;
    let flexLeft = total;
    let filled = 0;
    for (const pos of FLEX_POSITIONS) {
      const spare = Math.max(0, (myCounts[pos] ?? 0) - Math.max(0, roster[pos] ?? 0));
      const take = Math.min(spare, flexLeft);
      filled += take;
      flexLeft -= take;
    }
    return { drafted: filled, total };
  }
  const total = Math.max(0, Number(roster[filter] ?? 0));
  if (total <= 0) return null;
  return { drafted: myCounts[filter] ?? 0, total };
}

/**
 * Sheet height snaps (% of arena). Collapsed / expanded are overwritten at
 * runtime — collapsed fits grabber+tabs; expanded stops under the draft
 * header so last pick / timer / settings stay fully visible.
 */
const SNAP_PCT: Record<SheetSnap, number> = {
  collapsed: 9,
  peek: 36,
  // Fallback until the arena header is measured.
  expanded: 82,
};

function nearestSheetSnap(
  pct: number,
  collapsedPct: number,
  expandedPct: number,
): SheetSnap {
  const targets: Array<[SheetSnap, number]> = [
    ["collapsed", collapsedPct],
    ["peek", SNAP_PCT.peek],
    ["expanded", expandedPct],
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

/** Next snap in the flick direction (up = taller sheet). */
function sheetSnapInDirection(
  from: SheetSnap,
  dir: "up" | "down",
): SheetSnap {
  const order: SheetSnap[] = ["collapsed", "peek", "expanded"];
  const i = order.indexOf(from);
  if (dir === "up") return order[Math.min(order.length - 1, i + 1)]!;
  return order[Math.max(0, i - 1)]!;
}

/** Fallback name-column end if the sentinel isn't in the DOM yet. */
const NAME_SCROLL_END_FALLBACK_PX = 168;
/** Fallback name-column width (matches NAME_COL_CLASS) for fade-start math. */
const NAME_COL_WIDTH_FALLBACK_PX = 116;
const NAME_COL_CLASS = "w-[7.25rem]";
const STAR_COL_CLASS = "w-8";
/**
 * Sleeper draft rows: two-line identity + per-column label/value stats on every
 * row (ADP, PTS, and all pos stats). Compact-name band always reserves its
 * slot so the fade-in never changes row height — only opacity. Gap under the
 * band stays tight (~Sleeper) so labels sit just below the name.
 */
const PLAYER_ROW_ESTIMATE_PX = 70;

/**
 * Nested vertical + horizontal scrollers with directional lock.
 * Native scrolling (and momentum) stay on the winning axis; the other axis is
 * pinned. Avoids touch-none/preventDefault ownership, which felt laggy.
 * Never toggles overflow (that resets scrollLeft).
 */
function useDualAxisLock(
  vertRef: RefObject<HTMLElement | null>,
  horizRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const vert = vertRef.current;
    const horiz = horizRef.current;
    if (!vert || !horiz) return;

    const axisRef = { current: null as "x" | "y" | null };
    const startRef = { x: 0, y: 0, scrollTop: 0, scrollLeft: 0 };

    const pinOffAxis = () => {
      if (axisRef.current === "x") {
        if (vert.scrollTop !== startRef.scrollTop) {
          vert.scrollTop = startRef.scrollTop;
        }
      } else if (axisRef.current === "y") {
        if (horiz.scrollLeft !== startRef.scrollLeft) {
          horiz.scrollLeft = startRef.scrollLeft;
        }
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      axisRef.current = null;
      startRef.x = t.clientX;
      startRef.y = t.clientY;
      startRef.scrollTop = vert.scrollTop;
      startRef.scrollLeft = horiz.scrollLeft;
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startRef.x;
      const dy = t.clientY - startRef.y;
      if (axisRef.current == null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        axisRef.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        vert.scrollTop = startRef.scrollTop;
        horiz.scrollLeft = startRef.scrollLeft;
      }
      pinOffAxis();
    };

    const onTouchEnd = () => {
      const axis = axisRef.current;
      if (axis == null) return;
      window.setTimeout(() => {
        if (axisRef.current === axis) axisRef.current = null;
      }, 120);
    };

    vert.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    vert.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
    vert.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    vert.addEventListener("touchcancel", onTouchEnd, { passive: true, capture: true });
    vert.addEventListener("scroll", pinOffAxis, { passive: true });
    horiz.addEventListener("scroll", pinOffAxis, { passive: true });

    return () => {
      vert.removeEventListener("touchstart", onTouchStart, true);
      vert.removeEventListener("touchmove", onTouchMove, true);
      vert.removeEventListener("touchend", onTouchEnd, true);
      vert.removeEventListener("touchcancel", onTouchEnd, true);
      vert.removeEventListener("scroll", pinOffAxis);
      horiz.removeEventListener("scroll", pinOffAxis);
    };
  }, [vertRef, horizRef]);
}

/** Cached name-column geometry (content coords). Remeasured on resize / layout. */
const nameColCache = new WeakMap<HTMLElement, { end: number; width: number }>();

function measureNameColumnPx(scrollEl: HTMLElement): { end: number; width: number } {
  const endEl = scrollEl.querySelector<HTMLElement>("[data-name-scroll-end]");
  const colEl = scrollEl.querySelector<HTMLElement>("[data-name-scroll-col]");
  if (!endEl) {
    return { end: NAME_SCROLL_END_FALLBACK_PX, width: NAME_COL_WIDTH_FALLBACK_PX };
  }
  const sRect = scrollEl.getBoundingClientRect();
  const eRect = endEl.getBoundingClientRect();
  const end = Math.max(1, eRect.left - sRect.left + scrollEl.scrollLeft);
  const width = colEl
    ? Math.max(1, colEl.getBoundingClientRect().width)
    : NAME_COL_WIDTH_FALLBACK_PX;
  return { end, width };
}

/**
 * Fraction of the name column that must scroll off before compact-name fade
 * begins (a bit before ~⅓ so the header eases in earlier).
 */
const COMPACT_FADE_START_SCROLLED = 0.28;

/**
 * Scroll-linked compact-name opacity. Geometry is cached so scroll frames only
 * write a quantized CSS var (virtualized rows keep the fan-out tiny).
 * Fade stays at 0 until ~28% of the player-name column has scrolled past, then
 * ramps to 1 by the time the column has fully left the scrollport.
 * Row height is constant — only opacity / pointer-events change.
 */
function updateCompactNameFade(scrollEl: HTMLElement, remeasure = false) {
  // Hidden keep-alive panes report 0 width — skip so we don't clobber opacity.
  if (scrollEl.clientWidth <= 0) return;
  const w = scrollEl.clientWidth;
  if (scrollEl.dataset["draftScrollportW"] !== String(w)) {
    scrollEl.dataset["draftScrollportW"] = String(w);
    scrollEl.style.setProperty("--m-draft-scrollport-w", `${w}px`);
  }
  let geo = nameColCache.get(scrollEl);
  if (geo == null || remeasure) {
    geo = measureNameColumnPx(scrollEl);
    nameColCache.set(scrollEl, geo);
  }
  // Start a bit before the column midpoint; full once the column is gone.
  const fadeStart = Math.max(0, geo.end - geo.width * (1 - COMPACT_FADE_START_SCROLLED));
  const fadeRange = Math.max(1, geo.end - fadeStart);
  const opacity = Math.min(1, Math.max(0, (scrollEl.scrollLeft - fadeStart) / fadeRange));
  // 5% steps: progressive enough, far fewer style invalidations on fling.
  const q = Math.round(opacity * 20) / 20;
  if (scrollEl.dataset["draftCompactOpacity"] !== String(q)) {
    scrollEl.dataset["draftCompactOpacity"] = String(q);
    scrollEl.style.setProperty("--m-draft-compact-opacity", q.toFixed(2));
  }
  const on = q > 0.04;
  if (scrollEl.classList.contains("is-scrolled-x") !== on) {
    scrollEl.classList.toggle("is-scrolled-x", on);
  }
}

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
  onMoveQueued,
  onRemoveQueued,
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
  onMoveQueued: (id: string, dir: -1 | 1) => void;
  onRemoveQueued: (ids: string[]) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const prevYear = Math.max(2000, (Number(season) || new Date().getFullYear()) - 1);
  // Season projections omit some counting stats — sum weekly bundles (popup source).
  const { data: projExtrasRaw } = useQuery({
    queryKey: ["season-proj-board-extras", season],
    queryFn: () => fetchSeasonProjectedBoardExtras(season),
    enabled: Boolean(season) && /^\d{4}$/.test(season),
    staleTime: 1000 * 60 * 60 * 12,
    placeholderData: (prev) => prev,
  });
  // Defer painting overlays so a late fetch doesn't hitch an active fling.
  const [projExtrasById, setProjExtrasById] = useState<
    Record<string, SeasonProjBoardExtras>
  >({});
  useEffect(() => {
    if (!projExtrasRaw) return;
    startTransition(() => setProjExtrasById(projExtrasRaw));
  }, [projExtrasRaw]);
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
  const [expandedPct, setExpandedPct] = useState(SNAP_PCT.expanded);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startY: number;
    startPct: number;
    parentH: number;
    moved: boolean;
    lastY: number;
    lastT: number;
    /** px/ms, positive = finger moving up (sheet expanding). */
    velocityY: number;
  } | null>(null);
  /** After a vertical drag on the header, ignore the synthetic click on a tab. */
  const suppressTabClickRef = useRef(false);

  const snapPct = (s: SheetSnap) => {
    if (s === "collapsed") return collapsedPct;
    if (s === "expanded") return expandedPct;
    return SNAP_PCT.peek;
  };
  const heightPct = dragPct ?? snapPct(snap);

  // Publish sheet height so the board can pad its scroll content — last round
  // scrolls flush above the pull-up (no dead gap, no rows trapped under it).
  useEffect(() => {
    const sheet = sheetRef.current;
    const parent = sheet?.parentElement;
    if (!sheet || !parent) return;
    const publish = () => {
      parent.style.setProperty("--m-draft-sheet-h", `${sheet.offsetHeight}px`);
    };
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(publish);
    ro.observe(sheet);
    return () => {
      ro.disconnect();
      parent.style.removeProperty("--m-draft-sheet-h");
    };
  }, [heightPct]);

  const measureCollapsedPct = () => {
    const parentH = sheetRef.current?.parentElement?.clientHeight ?? window.innerHeight;
    const chromeH = chromeRef.current?.offsetHeight ?? 52;
    if (parentH <= 0) return SNAP_PCT.collapsed;
    // Fit grabber + tabs only; pad 1px so the border doesn't clip.
    return Math.max(6, Math.min(18, ((chromeH + 1) / parentH) * 100));
  };

  /** Full pull-up stops flush under the draft header (timer / last pick / gear). */
  const measureExpandedPct = () => {
    const parent = sheetRef.current?.parentElement;
    const parentH = parent?.clientHeight ?? window.innerHeight;
    if (parentH <= 0) return SNAP_PCT.expanded;
    const header =
      parent?.querySelector<HTMLElement>("[data-mock-draft-header]") ?? null;
    const headerH = header?.offsetHeight ?? 96;
    // 2px gap so the sheet radius doesn't kiss the header border.
    const maxH = Math.max(120, parentH - headerH - 2);
    const pct = (maxH / parentH) * 100;
    return Math.max(SNAP_PCT.peek + 8, Math.min(92, pct));
  };

  const remeasureSheetSnaps = () => {
    setCollapsedPct(measureCollapsedPct());
    setExpandedPct(measureExpandedPct());
  };

  useEffect(() => {
    remeasureSheetSnaps();
    const parent = sheetRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => remeasureSheetSnaps());
    ro.observe(parent);
    const header = parent.querySelector("[data-mock-draft-header]");
    if (header) ro.observe(header);
    return () => ro.disconnect();
  }, [queuedPlayers.length, complete]);

  useEffect(() => {
    if (complete) setSnap("peek");
  }, [complete]);

  const DRAG_THRESHOLD_PX = 8;
  /** ~0.45 px/ms ≈ quick flick; prefer directional snap over nearest. */
  const FLICK_VELOCITY_PX_MS = 0.45;

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const parentH = sheetRef.current?.parentElement?.clientHeight ?? window.innerHeight;
    const nextCollapsed = measureCollapsedPct();
    const nextExpanded = measureExpandedPct();
    setCollapsedPct(nextCollapsed);
    setExpandedPct(nextExpanded);
    const now = performance.now();
    dragRef.current = {
      startY: e.clientY,
      startPct: heightPct,
      parentH,
      moved: false,
      lastY: e.clientY,
      lastT: now,
      velocityY: 0,
    };
  };

  const onHeaderPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.parentH <= 0) return;
    const now = performance.now();
    const dt = now - drag.lastT;
    if (dt > 0 && dt < 64) {
      // Finger up (smaller Y) expands the sheet → positive velocity.
      drag.velocityY = (drag.lastY - e.clientY) / dt;
    }
    drag.lastY = e.clientY;
    drag.lastT = now;
    const deltaY = drag.startY - e.clientY;
    if (!drag.moved) {
      if (Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
    }
    const deltaPct = (deltaY / drag.parentH) * 100;
    const floor = measureCollapsedPct();
    const ceiling = measureExpandedPct();
    setDragPct(Math.min(ceiling, Math.max(floor, drag.startPct + deltaPct)));
  };

  const onHeaderPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.moved) {
      const floor = measureCollapsedPct();
      const ceiling = measureExpandedPct();
      setCollapsedPct(floor);
      setExpandedPct(ceiling);
      const current = dragPct ?? snapPct(snap);
      const vy = drag.velocityY;
      // Project ~180ms of coast so a quick flick lands on the intended snap.
      const projected =
        current + ((vy * 180) / Math.max(1, drag.parentH)) * 100;
      let next: SheetSnap;
      if (vy >= FLICK_VELOCITY_PX_MS) {
        next = sheetSnapInDirection(snap, "up");
        // If already past the next stop, prefer projected nearest.
        const dirTarget = snapPct(next);
        if (projected > dirTarget + 4) {
          next = nearestSheetSnap(projected, floor, ceiling);
        }
      } else if (vy <= -FLICK_VELOCITY_PX_MS) {
        next = sheetSnapInDirection(snap, "down");
        const dirTarget = next === "collapsed" ? floor : snapPct(next);
        if (projected < dirTarget - 4) {
          next = nearestSheetSnap(projected, floor, ceiling);
        }
      } else {
        next = nearestSheetSnap(projected, floor, ceiling);
      }
      setSnap(next);
      // Swallow the click that follows a drag; clear if no click arrives.
      suppressTabClickRef.current = true;
      window.setTimeout(() => {
        suppressTabClickRef.current = false;
      }, 50);
    }
    setDragPct(null);
    dragRef.current = null;
  };

  // Optimistic tab chrome — underline / pane visibility update sync; session
  // tab (persistence) follows in a transition so the arena doesn't hitch.
  const [localTab, setLocalTab] = useState<SheetTab>(tab);
  useEffect(() => {
    setLocalTab(tab);
  }, [tab]);

  // Keep panes mounted after first visit so tab swaps don't remount the
  // heavy players list (that was the main tab-switch hitch).
  const [mountedTabs, setMountedTabs] = useState<Record<SheetTab, boolean>>({
    players: true,
    queue: false,
    team: false,
  });
  useEffect(() => {
    setMountedTabs((prev) =>
      prev[localTab] ? prev : { ...prev, [localTab]: true },
    );
  }, [localTab]);

  const onTabPress = (key: SheetTab) => {
    if (suppressTabClickRef.current) {
      suppressTabClickRef.current = false;
      return;
    }
    setLocalTab(key);
    startTransition(() => onTabChange(key));
    // Opening a tab from fully collapsed pulls the sheet to peek.
    if (snap === "collapsed") setSnap("peek");
  };

  return (
    <div
      ref={sheetRef}
      // Absolute bottom overlay — height % is of the arena, not shared with the
      // header in a flex column (that clipped the queue action bar at 97%).
      className="absolute inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-2xl border-t border-m-border bg-m-sheet shadow-[0_-8px_24px_rgba(0,0,0,0.28)] transition-[height] duration-300 ease-out"
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
        aria-valuemax={Math.round(expandedPct)}
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
              aria-selected={localTab === key}
              onClick={() => onTabPress(key)}
              className={cn(
                "flex-1 border-b-2 px-2 py-2 font-display text-xs font-bold uppercase tracking-widest transition-colors",
                localTab === key
                  ? "border-m-accent text-m-accent"
                  : "border-transparent text-m-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mountedTabs.players ? (
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            localTab !== "players" && "hidden",
          )}
          aria-hidden={localTab !== "players"}
        >
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
            projExtrasById={projExtrasById}
            sheetSnap={snap}
            paneActive={localTab === "players"}
            onRequestExpand={() => setSnap("expanded")}
            onDraft={onDraft}
            onToggleQueue={onToggleQueue}
            onOpenPlayer={onOpenPlayer}
          />
        </div>
      ) : null}
      {mountedTabs.queue ? (
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            localTab !== "queue" && "hidden",
          )}
          aria-hidden={localTab !== "queue"}
        >
          <QueuePane
            queuedPlayers={queuedPlayers}
            settings={settings}
            myTurn={myTurn}
            complete={complete}
            queueAutopickOn={queueAutopickOn}
            onQueueAutopickChange={onQueueAutopickChange}
            onDraft={onDraft}
            onMoveQueued={onMoveQueued}
            onRemoveQueued={onRemoveQueued}
            onOpenPlayer={onOpenPlayer}
          />
        </div>
      ) : null}
      {mountedTabs.team ? (
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            localTab !== "team" && "hidden",
          )}
          aria-hidden={localTab !== "team"}
        >
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
        </div>
      ) : null}
    </div>
  );
}

const PlayersPane = memo(function PlayersPane({
  settings,
  available,
  draftedPlayers,
  watchIds,
  myTurn,
  complete,
  myCounts,
  nextUserOverall,
  prevYear,
  projExtrasById,
  sheetSnap,
  paneActive,
  onRequestExpand,
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
  projExtrasById: Record<string, SeasonProjBoardExtras>;
  sheetSnap: SheetSnap;
  paneActive: boolean;
  onRequestExpand: () => void;
  onDraft: (id: string) => void;
  onToggleQueue: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const [pos, setPos] = useState<PosFilter>("ALL");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [draftedOnly, setDraftedOnly] = useState(false);
  const [showPrevYear, setShowPrevYear] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    searchInputRef.current?.blur();
  };

  const openSearch = () => {
    onRequestExpand();
    setSearchOpen(true);
  };

  // Pulling the sheet down from full height dismisses search (Sleeper-style).
  useEffect(() => {
    if (searchOpen && sheetSnap !== "expanded") closeSearch();
  }, [sheetSnap, searchOpen]);

  // Leaving the Players tab dismisses search.
  useEffect(() => {
    if (!paneActive && searchOpen) closeSearch();
  }, [paneActive, searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const id = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [searchOpen]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const pool = draftedOnly ? draftedPlayers : available;
    return pool.filter((p) => {
      if (watchOnly && !watchIds.has(p.id)) return false;
      if (pos === "FLEX") {
        if (!(FLEX_POSITIONS as readonly string[]).includes(p.pos)) return false;
      } else if (pos !== "ALL" && p.pos !== pos) {
        return false;
      }
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
      {searchOpen ? (
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-m-muted"
              strokeWidth={2.5}
              aria-hidden
            />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search players"
              enterKeyHint="search"
              // text-base (16px) — iOS won't zoom the page on focus.
              className="h-12 w-full rounded-xl border border-m-border bg-m-card py-2 pl-10 pr-3 text-base text-m-card-fg outline-none placeholder:text-m-muted"
            />
          </div>
          <button
            type="button"
            onClick={closeSearch}
            className="shrink-0 px-1 font-display text-sm font-bold uppercase tracking-wide text-m-accent"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 overflow-x-auto px-2 py-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            aria-label="Search players"
            onClick={openSearch}
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-m-icon-bg text-m-icon-fg"
          >
            <Search className="size-5" strokeWidth={2.5} />
          </button>
          {POS_FILTERS.map((p) => {
            const slots = posFilterSlotCount(p, myCounts, settings.roster);
            // Hide FLEX when the league has no flex slot; other zero-slot pos
            // chips stay (filter-only) without a count.
            if (p === "FLEX" && slots == null) return null;
            const showCount = slots != null;
            const countLabel =
              slots != null ? `${slots.drafted}/${slots.total}` : "";
            return (
              <button
                key={p}
                type="button"
                onClick={() => startTransition(() => setPos(p))}
                className={cn(
                  "inline-flex size-12 shrink-0 flex-col items-center justify-center rounded-full font-display leading-none",
                  pos === p ? "bg-m-card-fg text-m-bg" : "bg-m-chip text-m-chip-fg",
                )}
              >
                <span className="text-[11px] font-extrabold uppercase tracking-wide">
                  {p === "DEF" ? "DST" : p}
                </span>
                {showCount ? (
                  <span
                    className={cn(
                      "mt-0.5 text-[9px] font-semibold tabular-nums",
                      pos === p ? "text-m-bg/75" : "text-m-muted",
                    )}
                  >
                    {countLabel}
                  </span>
                ) : null}
              </button>
            );
          })}
          <span className="mx-0.5 h-12 w-px shrink-0 bg-m-border" aria-hidden />
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
            <User className="size-3.5" strokeWidth={2.5} />
            Drafted
          </ToolChip>
          <ToolChip active={showPrevYear} onClick={() => setShowPrevYear((v) => !v)}>
            <ChartLine className="size-3.5" strokeWidth={2.5} />
            {prevShort} Stats
          </ToolChip>
        </div>
      )}

      <VirtualPlayersScroller
        filtered={filtered}
        settings={settings}
        watchIds={watchIds}
        myTurn={myTurn}
        complete={complete || draftedOnly}
        showPrevYear={showPrevYear}
        prevYear={prevYear}
        projExtrasById={projExtrasById}
        projIndex={projIndex}
        nextUserOverall={nextUserOverall}
        emptyLabel={
          draftedOnly
            ? "No drafted players match these filters."
            : watchOnly
              ? "No watchlist players match these filters."
              : "No players match these filters."
        }
        onDraft={onDraft}
        onToggleQueue={onToggleQueue}
        onOpenPlayer={onOpenPlayer}
      />
    </div>
  );
});

/** Virtualized dual-axis player board — only ~viewport rows stay mounted. */
function VirtualPlayersScroller({
  filtered,
  settings,
  watchIds,
  myTurn,
  complete,
  showPrevYear,
  prevYear,
  projExtrasById,
  projIndex,
  nextUserOverall,
  emptyLabel,
  onDraft,
  onToggleQueue,
  onOpenPlayer,
}: {
  filtered: Player[];
  settings: Settings;
  watchIds: Set<string>;
  myTurn: boolean;
  complete: boolean;
  showPrevYear: boolean;
  prevYear: number;
  projExtrasById: Record<string, SeasonProjBoardExtras>;
  projIndex: number;
  nextUserOverall: number | null;
  emptyLabel: string;
  onDraft: (id: string) => void;
  onToggleQueue: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const vertRef = useRef<HTMLDivElement | null>(null);
  const horizRef = useRef<HTMLDivElement | null>(null);
  const rafFadeRef = useRef(0);

  useDualAxisLock(vertRef, horizRef);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => vertRef.current,
    estimateSize: () => PLAYER_ROW_ESTIMATE_PX,
    overscan: 8,
    getItemKey: (i) => filtered[i]?.id ?? i,
  });

  // Remeasure name-end when Draft column appears/disappears or list mounts.
  useEffect(() => {
    const horiz = horizRef.current;
    if (!horiz) return;
    const sync = () => updateCompactNameFade(horiz, true);
    sync();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(horiz);
    return () => {
      ro?.disconnect();
      if (rafFadeRef.current) {
        cancelAnimationFrame(rafFadeRef.current);
        rafFadeRef.current = 0;
      }
    };
  }, [complete, filtered.length]);

  const onHorizScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (rafFadeRef.current) return;
    rafFadeRef.current = requestAnimationFrame(() => {
      rafFadeRef.current = 0;
      updateCompactNameFade(el, false);
    });
  };

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const padTop = items[0]?.start ?? 0;
  const padBottom = Math.max(0, totalSize - (items[items.length - 1]?.end ?? 0));

  return (
    <div
      ref={vertRef}
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-2 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div
        ref={horizRef}
        className="overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [-webkit-overflow-scrolling:touch] [--m-draft-compact-opacity:0]"
        onScroll={onHorizScroll}
      >
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-m-muted">{emptyLabel}</p>
        ) : null}
        {/* Always-mounted probe so name-end stays measurable under virtualization. */}
        <div className="pointer-events-none h-0 overflow-hidden" aria-hidden>
          <div className="flex items-stretch gap-1.5 py-2">
            {!complete ? <span className="w-[3.25rem] shrink-0" /> : null}
            <span className="w-5 shrink-0" />
            <span data-name-scroll-col className={cn(NAME_COL_CLASS, "shrink-0")} />
            <span data-name-scroll-end className="w-0 shrink-0" />
          </div>
        </div>
        {/*
          Padding spacers keep rows in flow so min-w-max still drives horizontal
          scroll width (absolute rows would collapse that).
        */}
        <div
          className="min-w-max"
          style={{ paddingTop: padTop, paddingBottom: padBottom }}
        >
          {items.map((item) => {
            const p = filtered[item.index]!;
            return (
              <div
                key={p.id}
                data-index={item.index}
                ref={virtualizer.measureElement}
              >
                {projIndex === item.index && nextUserOverall != null ? (
                  <div className="my-1 flex w-[100vw] max-w-md items-center gap-2 px-1">
                    <span className="h-px flex-1 bg-m-accent/70" />
                    <span className="font-display text-[10px] font-bold uppercase tracking-wider text-m-accent">
                      Proj pick: Round {roundOf(nextUserOverall, settings.teams)}{" "}
                      Overall #{nextUserOverall}
                    </span>
                    <span className="h-px flex-1 bg-m-accent/70" />
                  </div>
                ) : null}
                <PlayerStatsRow
                  player={p}
                  settings={settings}
                  rank={item.index + 1}
                  queued={watchIds.has(p.id)}
                  myTurn={myTurn}
                  complete={complete}
                  showPrevYear={showPrevYear}
                  prevYear={prevYear}
                  projExtras={projExtrasById[p.id]}
                  onDraft={onDraft}
                  onToggleQueue={onToggleQueue}
                  onOpenPlayer={onOpenPlayer}
                />
              </div>
            );
          })}
        </div>
      </div>
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
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // h-12 matches circular pos filters (size-12) in the same toolbar row.
        "inline-flex h-12 shrink-0 items-center gap-1.5 rounded-full border px-3.5 font-display text-[11px] font-bold uppercase tracking-wide transition-colors",
        active
          ? "border-m-accent bg-m-accent/15 text-m-accent"
          : "border-m-border bg-m-chip text-m-chip-fg",
      )}
    >
      {children}
    </button>
  );
}

const QueuePane = memo(function QueuePane({
  queuedPlayers,
  settings,
  myTurn,
  complete,
  queueAutopickOn,
  onQueueAutopickChange,
  onDraft,
  onMoveQueued,
  onRemoveQueued,
  onOpenPlayer,
}: {
  queuedPlayers: Player[];
  settings: Settings;
  myTurn: boolean;
  complete: boolean;
  queueAutopickOn: boolean;
  onQueueAutopickChange: (on: boolean) => void;
  onDraft: (id: string) => void;
  onMoveQueued: (id: string, dir: -1 | 1) => void;
  onRemoveQueued: (ids: string[]) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autopickInfoOpen, setAutopickInfoOpen] = useState(false);
  const selectedIndex = selectedId
    ? queuedPlayers.findIndex((p) => p.id === selectedId)
    : -1;

  useEffect(() => {
    if (selectedId && !queuedPlayers.some((p) => p.id === selectedId)) {
      setSelectedId(null);
    }
  }, [queuedPlayers, selectedId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-2 px-3 py-2">
        <Popover open={autopickInfoOpen} onOpenChange={setAutopickInfoOpen}>
          <div className="inline-flex items-center gap-1 text-xs text-m-muted">
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="About auto-pick"
                className="inline-flex size-5 items-center justify-center rounded-full text-m-muted"
              >
                <Info className="size-3.5" strokeWidth={2.25} aria-hidden />
              </button>
            </PopoverTrigger>
            <span>Auto-pick</span>
          </div>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side="top"
              align="center"
              sideOffset={8}
              // Opaque card — skip shared PopoverContent fade/zoom (opacity
              // animations) and theme tokens so the board never shows through.
              style={{ backgroundColor: "#ffffff", opacity: 1 }}
              className="z-[90] w-[min(18.5rem,calc(100vw-2rem))] rounded-xl border border-[#d9d5cc] p-3.5 text-[#1f2328] shadow-lg outline-none"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-display text-sm font-bold text-[#1f2328]">
                  Auto-pick
                </p>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setAutopickInfoOpen(false)}
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[#f3f3f3] text-[#50565c]"
                >
                  <X className="size-3" strokeWidth={2.5} aria-hidden />
                </button>
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-[#1f2328]">
                On your turn, drafts the next available player from the top of
                your queue. If the queue is empty, picks the best available
                player for your roster.
              </p>
              <PopoverPrimitive.Arrow
                width={14}
                height={7}
                style={{ fill: "#ffffff" }}
              />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </Popover>
        <button
          type="button"
          role="switch"
          aria-checked={queueAutopickOn}
          aria-label="Queue auto-pick"
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
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
          {queuedPlayers.map((p, i) => {
            const adp = value(p, settings.scoring).adp;
            const short = shortName(p.name);
            const meta = `${posDisplayLabel(p.pos)} - ${p.team}${p.bye ? ` (${p.bye})` : ""}`;
            const selected = selectedId === p.id;
            return (
              <li
                key={p.id}
                className="flex items-center gap-2 border-b border-m-border/60 py-2"
              >
                {!complete ? (
                  <button
                    type="button"
                    disabled={!myTurn}
                    onClick={() => onDraft(p.id)}
                    className={cn(
                      "h-9 w-[3.25rem] shrink-0 rounded-lg font-display text-[11px] font-extrabold uppercase tracking-wide",
                      myTurn
                        ? "bg-m-accent text-m-accent-fg"
                        : "border border-m-border bg-m-border/70 text-m-chip-fg",
                    )}
                  >
                    Draft
                  </button>
                ) : null}
                <span className="tabnum w-5 shrink-0 text-center text-sm font-semibold text-m-card-fg">
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenPlayer(p.id)}
                  className="min-w-0 flex-1 py-0.5 text-left"
                >
                  <span className="block truncate text-[13px] font-bold text-m-card-fg">
                    {short}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] text-m-muted">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        POS_DOT[p.pos] ?? "bg-m-muted",
                      )}
                      aria-hidden
                    />
                    <span className="truncate">{meta}</span>
                  </span>
                </button>
                <div className="w-12 shrink-0 text-right">
                  <span className="block text-[9px] font-semibold uppercase tracking-wide text-m-muted">
                    ADP
                  </span>
                  <span className="tabnum block text-sm font-semibold text-m-card-fg">
                    {adp < 900 ? adp.toFixed(1) : "—"}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={selected ? "Deselect queue player" : "Select queue player"}
                  aria-pressed={selected}
                  onClick={() => setSelectedId(selected ? null : p.id)}
                  className="flex size-9 shrink-0 items-center justify-center"
                >
                  {/* Sleeper-style radio: ring + ~50% inner fill when selected. */}
                  <span
                    className={cn(
                      "relative flex size-5 items-center justify-center rounded-full border-2",
                      selected ? "border-m-accent" : "border-m-muted",
                    )}
                    aria-hidden
                  >
                    {selected ? (
                      <span className="size-[11px] rounded-full bg-m-accent" />
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selectedId && selectedIndex >= 0 ? (
        <div
          className="relative z-10 flex shrink-0 items-center gap-4 border-t border-m-border bg-m-sheet px-4 pt-3"
          style={{ paddingBottom: "max(0.85rem, env(safe-area-inset-bottom, 0px))" }}
        >
          <button
            type="button"
            aria-label="Remove from queue"
            onClick={() => {
              onRemoveQueued([selectedId]);
              setSelectedId(null);
            }}
            className="inline-flex size-12 items-center justify-center rounded-full border border-m-border bg-m-card text-m-card-fg"
          >
            <Trash2 className="size-6" strokeWidth={2.25} />
          </button>
          <div className="flex flex-1 items-center justify-center gap-4">
            <button
              type="button"
              aria-label="Move up in queue"
              disabled={selectedIndex <= 0}
              onClick={() => onMoveQueued(selectedId, -1)}
              className="inline-flex size-12 items-center justify-center rounded-full border border-m-border bg-m-card text-m-card-fg disabled:opacity-40"
            >
              <ArrowUp className="size-6" strokeWidth={2.25} />
            </button>
            <button
              type="button"
              aria-label="Move down in queue"
              disabled={selectedIndex >= queuedPlayers.length - 1}
              onClick={() => onMoveQueued(selectedId, 1)}
              className="inline-flex size-12 items-center justify-center rounded-full border border-m-border bg-m-card text-m-card-fg disabled:opacity-40"
            >
              <ArrowDown className="size-6" strokeWidth={2.25} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="min-h-12 px-1 font-display text-base font-bold uppercase tracking-wide text-m-accent"
          >
            Done
          </button>
        </div>
      ) : null}
    </div>
  );
});

const TeamPane = memo(function TeamPane({
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

  // User's slot first (far left), then remaining slots in draft order — Sleeper.
  const teamOrder = useMemo(() => {
    const mine = settings.myTeam;
    const all = Array.from({ length: settings.teams }, (_, i) => i + 1);
    if (mine < 1 || mine > settings.teams) return all;
    return [mine, ...all.filter((t) => t !== mine)];
  }, [settings.teams, settings.myTeam]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-2 overflow-x-auto px-3 py-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {teamOrder.map((t) => {
          const mine = t === settings.myTeam;
          const selected = rosterTeam === t;
          const label = mine ? teamName(settings, t) : `Slot ${t}`;
          return (
            <button
              key={t}
              type="button"
              onClick={() => onRosterTeamChange(t)}
              className={cn(
                "inline-flex h-12 shrink-0 items-center gap-2.5 rounded-full px-4 font-display text-sm font-bold tracking-wide",
                selected
                  ? "bg-m-card-fg text-m-bg"
                  : "border border-m-border bg-m-chip text-m-chip-fg",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full",
                  selected ? "bg-m-bg/15 text-m-bg" : "bg-m-bg/40 text-m-accent",
                )}
                aria-hidden
              >
                <Shield className="size-4" strokeWidth={2.25} />
              </span>
              <span className="max-w-[7.5rem] truncate">{label}</span>
            </button>
          );
        })}
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
                  "inline-flex h-8 min-w-[2.6rem] items-center justify-center rounded-md px-1.5 font-display text-[11px] font-bold uppercase tracking-wide",
                  posSlotBadgeClass(s.slot),
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
});

/**
 * Full row scrolls (Draft + name + star + stats). Sleeper puts a tiny label
 * above every stat value on each player row (ADP, PTS, and all pos cols) —
 * not a sticky column header. Compact-name band always reserves its slot;
 * scroll only fades opacity (no row-height jump).
 */
const PlayerStatsRow = memo(function PlayerStatsRow({
  player,
  settings,
  rank,
  queued,
  myTurn,
  complete,
  showPrevYear,
  prevYear,
  projExtras,
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
  /** Weekly-sum overlays for stats omitted from season projection rows. */
  projExtras?: SeasonProjBoardExtras | undefined;
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
  const baseLine: CountingStats = player.projLine ?? EMPTY_COUNTING_STATS;
  const projLine: CountingStats = projExtras
    ? {
        ...baseLine,
        ...(projExtras.rec_tgt != null && projExtras.rec_tgt > 0
          ? { rec_tgt: projExtras.rec_tgt }
          : null),
        ...(projExtras.fgm != null && projExtras.fgm > 0 ? { fgm: projExtras.fgm } : null),
        ...(projExtras.fga != null && projExtras.fga > 0 ? { fga: projExtras.fga } : null),
        ...(projExtras.def_st_td != null && projExtras.def_st_td > 0
          ? { def_st_td: projExtras.def_st_td }
          : null),
        ...(projExtras.pts_allow != null && projExtras.pts_allow > 0
          ? { pts_allow: projExtras.pts_allow }
          : null),
      }
    : baseLine;
  const prevLine = player.prevLine;
  const prevAdp = player.prevAdp?.[settings.scoring];
  const posCols = POS_STAT_COLUMNS[player.pos] ?? [];

  return (
    <div className="relative">
      {/*
        Compact band always keeps its layout slot (no -mb collapse / no
        scrolled-X padding toggle) so fade-in is opacity-only — no row jump.
        mb-px + pt-0.5 ≈ Sleeper’s tight gap above ADP/PTS labels.
      */}
      <div
        className="pointer-events-none relative sticky left-0 z-20 mb-px h-4 overflow-hidden bg-m-sheet px-2 [.is-scrolled-x_&]:pointer-events-auto"
        style={{
          width: "var(--m-draft-scrollport-w, 100%)",
          opacity: "var(--m-draft-compact-opacity, 0)",
        }}
      >
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onOpenPlayer(player.id)}
          className="flex h-full max-w-full items-center gap-1.5 text-left font-display text-[10px] font-bold uppercase leading-none tracking-wide text-m-muted"
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
        {/* Hairline under compact name only (fades with the band). */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-m-border/70"
          aria-hidden
        />
      </div>

      <div className="flex items-stretch gap-1.5 pt-0.5 pb-2">
        {!complete ? (
          <button
            type="button"
            disabled={!myTurn}
            onClick={() => onDraft(player.id)}
            className={cn(
              "my-0.5 w-[3.25rem] shrink-0 self-stretch rounded-lg font-display text-[11px] font-extrabold uppercase tracking-wide",
              myTurn
                ? "bg-m-accent text-m-accent-fg"
                : "border border-m-border bg-m-border/70 text-m-chip-fg",
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
          <span className="block truncate text-[13px] font-bold leading-tight text-m-card-fg">
            {short}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[11px] leading-tight text-m-muted">
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
          <StatCell label="PTS" value={v.proj > 0 ? v.proj.toFixed(1) : "—"} />
          {showPrevYear ? (
            <StatCell
              label={`${yearShort} PTS`}
              value={v.prev != null && v.prev > 0 ? v.prev.toFixed(1) : "—"}
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
});

/** Tiny uppercase label above each value — same pattern on every player row. */
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
      <span className="block text-[9px] font-semibold uppercase leading-none tracking-wide text-m-muted">
        {label}
      </span>
      <span
        className={cn(
          "tabnum mt-0.5 block text-sm font-semibold leading-none",
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
