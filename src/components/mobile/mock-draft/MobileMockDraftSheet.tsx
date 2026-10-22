import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  type PointerEvent as ReactPointerEvent,
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
import { cn } from "@/lib/utils";

import { POS_DOT, posCellClass } from "./posCellStyles";
import { pickLabelForOverall } from "./MobileMockDraftBoard";

type SheetTab = "players" | "queue" | "team";
type SheetSnap = "peek" | "expanded";

const POS_FILTERS: Array<"ALL" | Pos> = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

/** Peek is a short drawer; expanded fills nearly all remaining arena height. */
const SNAP_PCT: Record<SheetSnap, number> = {
  peek: 36,
  expanded: 88,
};

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
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startY: number;
    startPct: number;
    parentH: number;
    moved: boolean;
  } | null>(null);
  /** After a vertical drag on the header, ignore the synthetic click on a tab. */
  const suppressTabClickRef = useRef(false);

  const heightPct = dragPct ?? SNAP_PCT[snap];

  useEffect(() => {
    if (complete) setSnap("peek");
  }, [complete]);

  const DRAG_THRESHOLD_PX = 8;

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const parentH = sheetRef.current?.parentElement?.clientHeight ?? window.innerHeight;
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
    setDragPct(Math.min(92, Math.max(26, drag.startPct + deltaPct)));
  };

  const onHeaderPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.moved) {
      const current = dragPct ?? SNAP_PCT[snap];
      const mid = (SNAP_PCT.peek + SNAP_PCT.expanded) / 2;
      setSnap(current >= mid ? "expanded" : "peek");
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
  };

  return (
    <div
      ref={sheetRef}
      className="flex shrink-0 flex-col rounded-t-2xl border-t border-m-border bg-m-sheet shadow-[0_-8px_24px_rgba(0,0,0,0.28)] transition-[height] duration-200 ease-out"
      style={{
        height: `${heightPct}%`,
        transitionProperty: dragPct == null ? "height" : "none",
      }}
    >
      {/* Entire chrome (grabber + tabs) resizes the sheet; tabs only change on tap. */}
      <div
        role="slider"
        aria-label="Resize player sheet"
        aria-valuemin={SNAP_PCT.peek}
        aria-valuemax={SNAP_PCT.expanded}
        aria-valuenow={Math.round(heightPct)}
        tabIndex={0}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        onDoubleClick={() => setSnap((s) => (s === "peek" ? "expanded" : "peek"))}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") setSnap("expanded");
          if (e.key === "ArrowDown") setSnap("peek");
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
          prevYear={prevYear}
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

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-2 pb-3">
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
                <div className="my-1 flex items-center gap-2 px-1">
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
  prevYear,
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
  prevYear: number;
  queueAutopickOn: boolean;
  onQueueAutopickChange: (on: boolean) => void;
  onDraft: (id: string) => void;
  onToggleQueue: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const [showPrevYear, setShowPrevYear] = useState(false);
  const prevShort = `'${String(prevYear).slice(-2)}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <ToolChip active={showPrevYear} onClick={() => setShowPrevYear((v) => !v)}>
          <ChartLine className="size-3.5" strokeWidth={2.5} />
          {prevShort} Stats
        </ToolChip>
        <div className="flex items-center gap-2">
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
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-2 pb-3">
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
                showPrevYear={showPrevYear}
                prevYear={prevYear}
                onDraft={onDraft}
                onToggleQueue={onToggleQueue}
                onOpenPlayer={onOpenPlayer}
              />
            ))}
          </div>
        </div>
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

/** Compact Sleeper-style row — no sticky name column / shadow seam. */
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
  const yearLabel = String(prevYear);

  return (
    <div className="flex border-b border-m-border/60">
      {/* Compact sticky identity — star sits next to the name; no shadow seam. */}
      <div className="sticky left-0 z-10 flex shrink-0 items-stretch gap-1.5 border-r border-m-border/50 bg-m-sheet py-1.5 pl-0 pr-1.5">
        {!complete ? (
          <button
            type="button"
            disabled={!myTurn}
            onClick={() => onDraft(player.id)}
            className={cn(
              "my-0.5 shrink-0 self-stretch rounded-lg px-3 font-display text-[11px] font-extrabold uppercase tracking-wide",
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
        <div className="flex max-w-[9.5rem] items-center gap-0.5">
          <button
            type="button"
            onClick={() => onOpenPlayer(player.id)}
            className="min-w-0 shrink py-0.5 text-left"
          >
            <span className="block truncate text-[13px] font-bold text-m-card-fg">{short}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-m-muted">
              <span
                className={cn("size-1.5 shrink-0 rounded-full", POS_DOT[player.pos] ?? "bg-m-muted")}
                aria-hidden
              />
              <span className="truncate">
                {posDisplayLabel(player.pos)} - {player.team}
                {player.bye ? ` (${player.bye})` : ""}
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label={queued ? "Remove from queue" : "Add to queue"}
            onClick={() => onToggleQueue(player.id)}
            className={cn("shrink-0 self-center p-0.5", queued ? "text-m-accent" : "text-m-muted")}
          >
            <Star className={cn("size-4", queued && "fill-current")} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 self-stretch py-1.5 pr-4">
        <StatCell label="ADP" value={v.adp < 900 ? v.adp.toFixed(1) : "—"} />
        <StatPair
          label="Pts"
          current={v.proj.toFixed(1)}
          showPrev={showPrevYear}
          prevYear={yearLabel}
          prev={v.prev != null ? v.prev.toFixed(1) : "—"}
        />
        <StatCell label="Rank" value={v.rank < 900 ? String(v.rank) : "—"} />
        <StatCell
          label="Pos rk"
          value={player.posRank > 0 ? `${posDisplayLabel(player.pos)}${player.posRank}` : "—"}
        />
        <StatCell
          label="ADP lo"
          value={player.adpRange.min < 900 ? player.adpRange.min.toFixed(0) : "—"}
        />
        <StatCell
          label="ADP hi"
          value={player.adpRange.max < 900 ? player.adpRange.max.toFixed(0) : "—"}
        />
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-12 shrink-0 text-left">
      <span className="block text-[9px] font-semibold uppercase tracking-wide text-m-muted">
        {label}
      </span>
      <span className="tabnum block text-sm font-semibold text-m-card-fg">{value}</span>
    </div>
  );
}

/** Current stat with optional prior-season column beside it (image-style '25 pair). */
function StatPair({
  label,
  current,
  showPrev,
  prevYear,
  prev,
}: {
  label: string;
  current: string;
  showPrev: boolean;
  prevYear: string;
  prev: string;
}) {
  return (
    <div className="flex shrink-0 items-end gap-3">
      <StatCell label={label} value={current} />
      {showPrev ? (
        <div className="w-12 shrink-0 text-left">
          <span className="block text-[9px] font-semibold uppercase tracking-wide text-m-muted">
            {prevYear}
          </span>
          <span className="tabnum block text-sm font-semibold text-m-muted">{prev}</span>
        </div>
      ) : null}
    </div>
  );
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.toUpperCase();
  const first = parts[0]!;
  return `${first[0]}. ${parts.slice(1).join(" ")}`.toUpperCase();
}
