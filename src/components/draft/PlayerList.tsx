import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { GripVertical, Search, Star, Undo2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "./PlayerAvatar";
import { detailQuery } from "./PlayerDetail";
import { cn } from "@/lib/utils";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import {
  POSITIONS,
  roundOf,
  value,
  type Player,
  type Pos,
  type Settings,
} from "@/lib/draft";

const SEASON = new Date().getFullYear();

type SortKey = "rank" | "adp" | "ecr" | "sd" | "trend" | "projPts" | "projAvg" | "prevPts" | "prevAvg";
/** null = default baseline order (overall rank). */
type Sort = SortKey | null;

/** Continuous vertical rule that separates stat column groups. */
const DIVIDER = "border-l border-border";
/** Muted wash applied down an actively sorted column. */
const ACTIVE_COL = "bg-muted/40";

function PlayerListImpl({
  players,
  draftedIds,
  watchIds,
  counts,
  needs,
  settings,
  currentOverall,
  customOrder,
  onDraft,
  onToggleWatch,
  onReorder,
  onUndo,
  canUndo,
  onOpenPlayer,
  canDraft = true,
  hideValueTags = false,
}: {
  players: Player[];
  draftedIds: Set<string>;
  watchIds: Set<string>;
  counts?: Record<string, number>;
  needs?: Record<Pos, number>;
  settings: Settings;
  currentOverall: number;
  customOrder: string[];
  onDraft: (id: string) => void;
  onToggleWatch: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onUndo: () => void;
  canUndo: boolean;
  onOpenPlayer?: (id: string) => void;
  /** Mock-draft only: greys out and disables the row Draft buttons off-turn. */
  canDraft?: boolean;
  /** Hide reach / value tags (used during live mock drafts). */
  hideValueTags?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<string>("ALL");
  const [sort, setSort] = useState<Sort>(null);
  const [custom, setCustom] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [showDrafted, setShowDrafted] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const queryClient = useQueryClient();
  const brain = usePlayerBrain();

  /** Analytics reads: ECR / SD / 7-day trend out of the local matrix map. */
  const ecrOf = useCallback(
    (id: string) => {
      const n = brain?.[id]?.ecr ?? 0;
      return n > 0 ? n : null;
    },
    [brain],
  );
  const sdOf = useCallback(
    (id: string) => {
      const n = brain?.[id]?.sd ?? 0;
      return n > 0 ? n : null;
    },
    [brain],
  );
  const trendOf = useCallback(
    (id: string) => {
      const n = brain?.[id]?.trend ?? 0;
      return Number.isFinite(n) && n !== 0 ? n : null;
    },
    [brain],
  );

  /**
   * True positional rank (RB1, WR12 …) — distinct from the overall board RK.
   * Ordered by the analytics ECR when present, otherwise by board value.
   */
  const posRanks = useMemo(() => {
    const groups = new Map<string, Player[]>();
    for (const p of players) {
      const g = groups.get(p.pos);
      if (g) g.push(p);
      else groups.set(p.pos, [p]);
    }
    const out = new Map<string, number>();
    for (const [, group] of groups) {
      const ordered = [...group].sort((a, b) => {
        const ae = brain?.[a.id]?.ecr ?? 0;
        const be = brain?.[b.id]?.ecr ?? 0;
        const aKey = ae > 0 ? ae : value(a, settings.scoring).rank + 10000;
        const bKey = be > 0 ? be : value(b, settings.scoring).rank + 10000;
        return aKey - bKey;
      });
      ordered.forEach((p, i) => out.set(p.id, i + 1));
    }
    return out;
  }, [players, brain, settings.scoring]);


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
    if (suggested) {
      const round = roundOf(currentOverall, settings.teams);
      // Picks *I* have left: total roster slots minus players already on my team.
      const totalSlots = Object.values(settings.roster).reduce((a, b) => a + (b ?? 0), 0);
      const myCount = counts ? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) : 0;
      const myPicksLeft = counts
        ? Math.max(0, Math.min(totalSlots, settings.rounds) - myCount)
        : settings.rounds - round + 1;
      const endgame = myPicksLeft <= 2;

      const scored = list
        .filter((p) => !draftedIds.has(p.id))
        .map((p) => {
          const v = value(p, settings.scoring);
          const rank = v.rank > 900 ? 400 : v.rank;
          const fall = v.adp < 900 ? currentOverall - v.adp : 0;
          const need = needs?.[p.pos] ?? 0;
          let score = -rank + Math.max(0, fall) * 2.5 + Math.min(need, 3) * 14;
          const isKD = p.pos === "K" || p.pos === "DEF";
          if (isKD) {
            const required = settings.roster[p.pos] ?? 0;
            const stillNeeded = required > 0 && need > 0;
            // In the final two rounds a missing K/DEF is mandatory — force them to the top.
            if (endgame && stillNeeded) score += 5000;
            else if (!endgame) score -= 1000;
          }
          return { p, score };
        })
        .sort((a, b) => b.score - a.score);
      const picked = scored.slice(0, Math.max(15, Math.min(24, scored.length))).map((s) => s.p);
      // Guarantee the best available K and DEF appear once we're in the mandatory window.
      if (endgame) {
        for (const pos of ["K", "DEF"] as const) {
          if ((settings.roster[pos] ?? 0) <= 0) continue;
          if ((needs?.[pos] ?? 0) <= 0) continue;
          if (picked.some((p) => p.pos === pos)) continue;
          const best = scored.find((s) => s.p.pos === pos)?.p;
          if (best) picked.unshift(best);
        }
      }
      return picked;
    }

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
      else if (sort === "ecr") diff = (ecrOf(a.id) ?? 9999) - (ecrOf(b.id) ?? 9999);
      else if (sort === "sd") diff = (sdOf(b.id) ?? -1) - (sdOf(a.id) ?? -1);
      else if (sort === "trend") diff = (trendOf(b.id) ?? -Infinity) - (trendOf(a.id) ?? -Infinity);
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
    suggested,
    needs,
    counts,
    currentOverall,
    ecrOf,
    sdOf,
    trendOf,
  ]);

  // Render in chunks so a full-league player pool never blocks scrolling.
  const PAGE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  useEffect(() => {
    setVisibleCount(PAGE);
  }, [query, pos, sort, custom, showDrafted, watchOnly, suggested]);
  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => Math.min(c + PAGE, rows.length));
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length, visibleCount]);

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
                    {counts?.[p] ?? 0}/{settings.roster[p as Pos]}
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
                "inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 uppercase tracking-wide transition-colors",
                watchOnly
                  ? "border-amber-400/60 bg-amber-400/15 text-amber-400"
                  : "border-border hover:text-foreground",
              )}
            >
              <Star className="size-3.5" />
              Watchlist
            </button>
            <button
              onClick={() =>
                setSuggested((v) => {
                  if (!v) {
                    setCustom(false);
                    setSort(null);
                  }
                  return !v;
                })
              }
              aria-pressed={suggested}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 uppercase tracking-wide transition-colors",
                suggested
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border hover:text-foreground",
              )}
            >
              <Zap className="size-3.5" />
              Suggested
            </button>
            <button
              onClick={() => {
                // True two-way toggle: second click closes custom mode.
                setCustom((v) => {
                  if (!v) {
                    setSort(null);
                    setSuggested(false);
                  }
                  return !v;
                });
              }}
              aria-pressed={custom}
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 rounded border px-2 py-1 uppercase tracking-wide transition-colors",
                custom
                  ? "border-accent/50 bg-accent/15 text-accent"
                  : "border-border hover:text-foreground",
              )}
            >
              <GripVertical className="size-3.5" />
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
              "flex w-8 shrink-0 items-end justify-center self-stretch pb-1 uppercase tracking-widest transition-colors hover:text-foreground",
              sort === "rank" && `${ACTIVE_COL} text-foreground`,
            )}
          >
            RK
          </button>
          <div className="flex w-[460px] shrink-0 items-end pb-1">Player</div>
          <div className="flex min-w-0 flex-1 items-stretch">
            <button
              onClick={() => toggleSort("adp")}
              className={cn(
                "flex w-14 shrink-0 items-end justify-center self-stretch px-1 pb-1 uppercase tracking-widest transition-colors hover:text-foreground",
                DIVIDER,
                sort === "adp" && `${ACTIVE_COL} text-foreground`,
              )}
            >
              ADP
            </button>
            <MetricHeader label="ECR" metricKey="ecr" width="w-14" sort={sort} onSort={toggleSort} />
            <MetricHeader label="SD" metricKey="sd" width="w-14" sort={sort} onSort={toggleSort} />
            <MetricHeader
              label="Trend"
              metricKey="trend"
              width="w-16"
              sort={sort}
              onSort={toggleSort}
            />
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
              flushRight
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
          {visibleRows.map((p) => {
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
                <div className="flex-1">
                  <div className="font-semibold whitespace-nowrap">{p.name}</div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {`${p.pos}${posRanks.get(p.id) ?? ""}`}
                    {p.team ? ` · ${p.team}` : ""}
                    {p.bye ? ` · BYE ${p.bye}` : ""}
                    {!hideValueTags && reach !== null && reach < -6 ? " · reach" : ""}
                    {p.injury ? (
                      <span className="font-semibold uppercase text-destructive">
                        {` · ${p.injury}`}
                      </span>
                    ) : null}
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
                    className={cn(
                      "h-8 w-[62px] px-0 font-display text-xs uppercase",
                      !canDraft &&
                        "pointer-events-none border border-border bg-muted text-muted-foreground opacity-60 shadow-none hover:bg-muted",
                    )}
                    disabled={drafted || !canDraft}
                    onClick={() => canDraft && onDraft(p.id)}
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

                <div className="flex w-[460px] shrink-0 items-center gap-1 py-2">
                  {onOpenPlayer ? (
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-2 rounded py-0.5 text-left hover:bg-secondary/50"
                      onPointerEnter={() => queryClient.prefetchQuery(detailQuery(p.id))}
                      onPointerDown={() => onOpenPlayer(p.id)}
                      onClick={() => onOpenPlayer(p.id)}
                    >
                      {playerBody}
                    </button>
                  ) : (
                    <Link
                      to="/player/$id"
                      params={{ id: p.id }}
                      className="flex flex-1 items-center gap-2 rounded py-0.5 text-left hover:bg-secondary/50"
                    >
                      {playerBody}
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => onToggleWatch(p.id)}
                    aria-label={watched ? `Unwatch ${p.name}` : `Watch ${p.name}`}
                    className={cn(
                      "shrink-0 rounded py-1.5 pl-1.5 pr-0 transition-colors hover:text-foreground",
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
                      "w-14 shrink-0 justify-center px-1",
                      DIVIDER,
                      sort === "adp" && ACTIVE_COL,
                    )}
                  />
                  <StatCell
                    value={ecrOf(p.id) !== null ? String(Math.round(ecrOf(p.id)!)) : "—"}
                    className={cn(
                      "w-14 shrink-0 justify-center px-1",
                      DIVIDER,
                      sort === "ecr" && ACTIVE_COL,
                    )}
                  />
                  <StatCell
                    value={sdOf(p.id) !== null ? sdOf(p.id)!.toFixed(1) : "—"}
                    className={cn(
                      "w-14 shrink-0 justify-center px-1 font-normal text-muted-foreground",
                      DIVIDER,
                      sort === "sd" && ACTIVE_COL,
                    )}
                  />
                  <StatCell
                    value={
                      trendOf(p.id) !== null
                        ? `${trendOf(p.id)! > 0 ? "+" : "-"}${Math.abs(trendOf(p.id)!).toFixed(0)}`
                        : "—"
                    }
                    className={cn(
                      "w-16 shrink-0 justify-center px-1",
                      DIVIDER,
                      sort === "trend" && ACTIVE_COL,
                    )}
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
                    flushRight
                  />
                </div>
              </li>
            );
          })}
          {visibleCount < rows.length && (
            <li
              ref={sentinelRef}
              className="p-4 text-center text-xs text-muted-foreground"
            >
              Loading more players… ({visibleCount} of {rows.length})
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

export const PlayerList = memo(PlayerListImpl);

/** Single sortable metric column header (ECR / SD / TREND). */
function MetricHeader({
  label,
  metricKey,
  width,
  sort,
  onSort,
}: {
  label: string;
  metricKey: SortKey;
  width: string;
  sort: Sort;
  onSort: (key: SortKey) => void;
}) {
  return (
    <button
      onClick={() => onSort(metricKey)}
      className={cn(
        "flex shrink-0 items-end justify-center self-stretch px-1 pb-1 uppercase tracking-widest transition-colors hover:text-foreground",
        width,
        DIVIDER,
        sort === metricKey && `${ACTIVE_COL} text-foreground`,
      )}
    >
      {label}
    </button>
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
  flushRight,
}: {
  total: string;
  avg: string;
  totalActive?: boolean;
  avgActive?: boolean;
  flushRight?: boolean;
}) {
  return (
    <div className={cn("grid flex-1 grid-cols-2 text-xs font-semibold", DIVIDER)}>
      <div
        className={cn("tabnum flex items-center justify-start pl-3", totalActive && ACTIVE_COL)}
      >
        {total}
      </div>
      <div
        className={cn(
          "tabnum flex items-center justify-end",
          flushRight ? "pr-0" : "pr-3",
          avgActive && ACTIVE_COL,
        )}
      >
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
  flushRight,
}: {
  label: string;
  totalLabel?: string;
  avgLabel?: string;
  totalKey: SortKey;
  avgKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  flushRight?: boolean;
}) {
  return (
    <div className={cn("flex-1", DIVIDER)}>
      <div className="border-b border-border pb-1 text-center">{label}</div>
      <div className="grid grid-cols-2 pt-1">
        <button
          onClick={() => onSort(totalKey)}
          className={cn(
            "pl-3 text-left uppercase tracking-widest transition-colors hover:text-foreground",
            sort === totalKey && `${ACTIVE_COL} text-foreground`,
          )}
        >
          {totalLabel}
        </button>
        <button
          onClick={() => onSort(avgKey)}
          className={cn(
            "text-right uppercase tracking-widest transition-colors hover:text-foreground",
            flushRight ? "pr-0" : "pr-3",
            sort === avgKey && `${ACTIVE_COL} text-foreground`,
          )}
        >
          {avgLabel}
        </button>
      </div>
    </div>
  );
}
