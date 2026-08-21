import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { GripVertical, Search, Star, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "./PlayerAvatar";
import { cn } from "@/lib/utils";
import { POSITIONS, value, type Player, type Pos, type Settings } from "@/lib/draft";

const SEASON = new Date().getFullYear();

type SortKey = "rank" | "adp" | "adpMin" | "adpMax" | "projPts" | "projAvg" | "prevPts" | "prevAvg";
/** null = default baseline order (overall rank). */
type Sort = SortKey | null;

/** Continuous vertical rule that separates stat column groups. */
const DIVIDER = "border-l border-border";
/** Muted wash applied down an actively sorted column. */
const ACTIVE_COL = "bg-muted/60";

export function PlayerList({
  players,
  draftedIds,
  watchIds,
  counts,
  settings,
  currentOverall,
  customOrder,
  onDraft,
  onToggleWatch,
  onReorder,
  onUndo,
  canUndo,
  onOpenPlayer,
}: {
  players: Player[];
  draftedIds: Set<string>;
  watchIds: Set<string>;
  counts?: Record<string, number>;
  settings: Settings;
  currentOverall: number;
  customOrder: string[];
  onDraft: (id: string) => void;
  onToggleWatch: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onUndo: () => void;
  canUndo: boolean;
  onOpenPlayer?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<string>("ALL");
  const [sort, setSort] = useState<Sort>(null);
  const [custom, setCustom] = useState(false);
  const [showDrafted, setShowDrafted] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /** Click once to sort high-to-low, click again to clear back to baseline. */
  const toggleSort = useCallback((key: SortKey) => {
    setCustom(false);
    setSort((prev) => (prev === key ? null : key));
  }, []);

  const orderIndex = useMemo(() => {
    const m = new Map<string, number>();
    customOrder.forEach((id, i) => m.set(id, i));
    return m;
  }, [customOrder]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = players.filter((p) => {
      if ((p.pos === "K" || p.pos === "DEF") && settings.roster[p.pos] === 0) return false;
      if (pos !== "ALL" && p.pos !== pos) return false;
      if (watchOnly && !watchIds.has(p.id)) return false;
      if (!showDrafted && draftedIds.has(p.id)) return false;
      if (q && !`${p.name} ${p.team}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return list.sort((a, b) => {
      const av = value(a, settings.scoring);
      const bv = value(b, settings.scoring);
      if (custom) {
        const ai = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bi = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return av.rank - bv.rank;
      }
      if (!sort) return av.rank - bv.rank;
      // Every metric column sorts strictly high-to-low.
      let diff = 0;
      if (sort === "rank") diff = bv.rank - av.rank;
      else if (sort === "adp") diff = bv.adp - av.adp;
      else if (sort === "adpMin") diff = b.adpRange.min - a.adpRange.min;
      else if (sort === "adpMax") diff = b.adpRange.max - a.adpRange.max;
      else if (sort === "projPts" || sort === "projAvg") diff = bv.proj - av.proj;
      else if (sort === "prevPts" || sort === "prevAvg") diff = (bv.prev ?? -1) - (av.prev ?? -1);
      if (diff !== 0) return diff;
      return av.rank - bv.rank;
    });
  }, [
    players,
    query,
    pos,
    sort,
    custom,
    showDrafted,
    watchOnly,
    watchIds,
    draftedIds,
    settings,
    orderIndex,
  ]);

  const moveBefore = useCallback(
    (fromId: string, targetId: string) => {
      const ids = rows.map((r) => r.id);
      const from = ids.indexOf(fromId);
      const to = ids.indexOf(targetId);
      if (from === -1 || to === -1 || from === to) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]!);
      // Keep every other already-ranked player behind this visible slice.
      const rest = customOrder.filter((id) => !ids.includes(id));
      onReorder([...ids, ...rest]);
    },
    [rows, customOrder, onReorder],
  );

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragId) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el?.closest<HTMLElement>("[data-pid]");
    const pid = row?.dataset["pid"];
    if (pid && pid !== dragId) moveBefore(dragId, pid);
  };

  return (
    <div className="flex flex-col">
      <div className="sticky top-[var(--wr-header-h,0px)] z-20 space-y-3 border-b border-border bg-surface/95 p-3 backdrop-blur">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search players"
              className="h-10 pl-9"
            />
          </div>
          <Button
            variant="secondary"
            size="icon"
            className="h-10 w-10"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Undo2 className="size-4" />
            <span className="sr-only">Undo last pick</span>
          </Button>
        </div>

        <div className="-mx-1 flex flex-wrap items-center gap-y-2 px-1 pb-1">
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            {["ALL", ...POSITIONS].map((p) => (
              <button
                key={p}
                onClick={() => setPos(p)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 font-display text-sm font-semibold uppercase tracking-wide transition-colors",
                  pos === p
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {p}
                {p !== "ALL" && (settings.roster[p as Pos] ?? 0) > 0 ? (
                  <span className="tabnum ml-1 text-[10px] opacity-70">
                    {Math.min(counts?.[p] ?? 0, settings.roster[p as Pos])}/
                    {settings.roster[p as Pos]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="ml-auto flex flex-wrap justify-end gap-1.5 text-xs text-muted-foreground">
            <button
              onClick={() => setWatchOnly((v) => !v)}
              aria-pressed={watchOnly}
              className={cn(
                "shrink-0 rounded border px-2 py-1 uppercase tracking-wide transition-colors",
                watchOnly
                  ? "border-amber-400/60 bg-amber-400/15 text-amber-400"
                  : "border-border hover:text-foreground",
              )}
            >
              Watchlist
            </button>
            <button
              onClick={() => {
                // True two-way toggle: second click closes custom mode.
                setCustom((v) => {
                  if (!v) setSort(null);
                  return !v;
                });
              }}
              aria-pressed={custom}
              className={cn(
                "shrink-0 rounded border px-2 py-1 uppercase tracking-wide transition-colors",
                custom
                  ? "border-accent/50 bg-accent/15 text-accent"
                  : "border-border hover:text-foreground",
              )}
            >
              Custom
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={showDrafted}
              onChange={(e) => setShowDrafted(e.target.checked)}
              className="size-3.5 accent-[var(--primary)]"
            />
            Show drafted
          </label>
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={watchOnly}
              onChange={(e) => setWatchOnly(e.target.checked)}
              className="size-3.5 accent-[var(--primary)]"
            />
            Watchlist only
          </label>
        </div>

        {custom && (
          <p className="text-[11px] text-muted-foreground">
            Drag the handle to build your own board order. It saves automatically.
          </p>
        )}
        <div className="-mx-3 -mb-3 hidden items-stretch gap-2 border-t border-border px-2 pt-1.5 text-[10px] uppercase tracking-widest text-muted-foreground sm:flex">
          {custom && <div className="w-6 shrink-0" />}
          <div className="w-[62px] shrink-0" />
          <button
            onClick={() => toggleSort("rank")}
            className={cn(
              "w-8 shrink-0 self-stretch text-center uppercase tracking-widest transition-colors hover:text-foreground",
              sort === "rank" && `${ACTIVE_COL} text-foreground`,
            )}
          >
            RK
          </button>
          <div className="w-[300px] shrink-0">Player</div>
          <div className="flex min-w-0 flex-1 items-stretch">
            <button
              onClick={() => toggleSort("adp")}
              className={cn(
                "flex-1 self-stretch px-2 text-center uppercase tracking-widest transition-colors hover:text-foreground",
                DIVIDER,
                sort === "adp" && `${ACTIVE_COL} text-foreground`,
              )}
            >
              ADP
            </button>
            <StatGroupHeader
              label="ADP Range"
              totalLabel="MIN"
              avgLabel="MAX"
              totalKey="adpMin"
              avgKey="adpMax"
              sort={sort}
              onSort={toggleSort}
            />
            <div className={cn("flex flex-1 items-end justify-center pb-1", DIVIDER)}>
              <span className="uppercase tracking-widest">Pos RK</span>
            </div>
            <StatGroupHeader
              label={`${SEASON} PROJ`}
              totalKey="projPts"
              avgKey="projAvg"
              sort={sort}
              onSort={toggleSort}
            />
            <StatGroupHeader
              label={`${SEASON - 1} ACTUAL`}
              totalKey="prevPts"
              avgKey="prevAvg"
              sort={sort}
              onSort={toggleSort}
            />
          </div>
        </div>
      </div>

      <div className="relative">
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">No players match.</p>
        )}
        <ul
          ref={listRef}
          className="divide-y divide-border"
          onPointerMove={onPointerMove}
          onPointerUp={() => setDragId(null)}
          onPointerCancel={() => setDragId(null)}
        >
          {rows.map((p) => {
            const v = value(p, settings.scoring);
            const drafted = draftedIds.has(p.id);
            const watched = watchIds.has(p.id);
            const reach = v.adp < 900 ? Math.round(v.adp - currentOverall) : null;
            const playerBody = (
              <>
                <PlayerAvatar
                  id={p.id}
                  pos={p.pos}
                  team={p.team}
                  name={p.name}
                  className="size-10"
                  logoClassName="size-4"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{p.name}</span>
                    {p.injury && (
                      <span className="rounded bg-destructive/20 px-1 text-[10px] font-bold uppercase text-destructive">
                        {p.injury}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.pos}
                    {p.team ? ` · ${p.team}` : ""}
                    {p.bye ? ` · BYE ${p.bye}` : ""}
                    {reach !== null && reach < -6 ? " · reach" : ""}
                  </div>
                </div>
              </>
            );
            return (
              <li
                key={p.id}
                data-pid={p.id}
                className={cn(
                  "flex items-stretch gap-2 px-2 transition-colors",
                  drafted && "opacity-40",
                  dragId === p.id && "bg-accent/10",
                )}
              >
                {custom && (
                  <button
                    aria-label={`Reorder ${p.name}`}
                    className="w-6 shrink-0 cursor-grab touch-none p-1 text-muted-foreground active:cursor-grabbing"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setDragId(p.id);
                    }}
                  >
                    <GripVertical className="size-4" />
                  </button>
                )}

                <div className="flex shrink-0 items-center py-2">
                  <Button
                    size="sm"
                    className="h-8 w-[62px] px-0 font-display text-xs uppercase"
                    disabled={drafted}
                    onClick={() => onDraft(p.id)}
                  >
                    Draft
                  </Button>
                </div>

                <div
                  className={cn(
                    "tabnum flex w-8 shrink-0 items-center justify-center text-xs font-semibold text-muted-foreground",
                    sort === "rank" && ACTIVE_COL,
                  )}
                >
                  {v.rank}
                </div>

                <div className="flex w-[300px] shrink-0 items-center gap-1 py-2">
                  {onOpenPlayer ? (
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 rounded py-0.5 text-left hover:bg-secondary/50"
                      onClick={() => onOpenPlayer(p.id)}
                    >
                      {playerBody}
                    </button>
                  ) : (
                    <Link
                      to="/player/$id"
                      params={{ id: p.id }}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded py-0.5 text-left hover:bg-secondary/50"
                    >
                      {playerBody}
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => onToggleWatch(p.id)}
                    aria-label={watched ? `Unwatch ${p.name}` : `Watch ${p.name}`}
                    className={cn(
                      "shrink-0 rounded p-1.5 transition-colors hover:text-foreground",
                      watched ? "text-amber-400" : "text-muted-foreground",
                    )}
                  >
                    <Star className={cn("size-4", watched && "fill-current")} />
                  </button>
                </div>

                <div className="hidden min-w-0 flex-1 items-stretch sm:flex">
                  <StatCell
                    value={v.adp < 900 ? v.adp.toFixed(1) : "—"}
                    className={cn(
                      "flex-1 justify-center px-2",
                      DIVIDER,
                      sort === "adp" && ACTIVE_COL,
                    )}
                  />
                  <StatGroup
                    total={p.adpRange.min < 900 ? p.adpRange.min.toFixed(1) : "—"}
                    avg={p.adpRange.max < 900 ? p.adpRange.max.toFixed(1) : "—"}
                    totalActive={sort === "adpMin"}
                    avgActive={sort === "adpMax"}
                  />
                  <StatCell
                    value={p.posRank && p.posRank < 999 ? `${p.pos}${p.posRank}` : "—"}
                    className={cn("flex-1 justify-center px-2", DIVIDER)}
                  />
                  <StatGroup
                    total={v.proj.toFixed(0)}
                    avg={(v.proj / 18).toFixed(1)}
                    totalActive={sort === "projPts"}
                    avgActive={sort === "projAvg"}
                  />
                  <StatGroup
                    total={v.prev !== null && v.prev > 0 ? v.prev.toFixed(0) : "—"}
                    avg={v.prev !== null && v.prev > 0 ? (v.prev / 18).toFixed(1) : "—"}
                    totalActive={sort === "prevPts"}
                    avgActive={sort === "prevAvg"}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function StatCell({ value, className }: { value: string; className?: string }) {
  return (
    <div className={cn("tabnum flex items-center justify-end text-xs font-semibold", className)}>
      {value}
    </div>
  );
}

function StatGroup({
  total,
  avg,
  totalActive,
  avgActive,
}: {
  total: string;
  avg: string;
  totalActive?: boolean;
  avgActive?: boolean;
}) {
  return (
    <div className={cn("grid w-28 grid-cols-2 text-xs font-semibold", DIVIDER)}>
      <div
        className={cn("tabnum flex items-center justify-end pr-2 pl-2", totalActive && ACTIVE_COL)}
      >
        {total}
      </div>
      <div className={cn("tabnum flex items-center justify-end pr-2", avgActive && ACTIVE_COL)}>
        {avg}
      </div>
    </div>
  );
}

function StatGroupHeader({
  label,
  totalLabel = "PTS",
  avgLabel = "AVG",
  totalKey,
  avgKey,
  sort,
  onSort,
}: {
  label: string;
  totalLabel?: string;
  avgLabel?: string;
  totalKey: SortKey;
  avgKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
}) {
  return (
    <div className={cn("w-28", DIVIDER)}>
      <div className="border-b border-border pb-1 text-center">{label}</div>
      <div className="grid grid-cols-2 pt-1">
        <button
          onClick={() => onSort(totalKey)}
          className={cn(
            "px-2 text-right uppercase tracking-widest transition-colors hover:text-foreground",
            sort === totalKey && `${ACTIVE_COL} text-foreground`,
          )}
        >
          {totalLabel}
        </button>
        <button
          onClick={() => onSort(avgKey)}
          className={cn(
            "pr-2 text-right uppercase tracking-widest transition-colors hover:text-foreground",
            sort === avgKey && `${ACTIVE_COL} text-foreground`,
          )}
        >
          {avgLabel}
        </button>
      </div>
    </div>
  );
}
