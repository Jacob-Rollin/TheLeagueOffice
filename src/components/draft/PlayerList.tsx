import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, GripVertical, Search, Star, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PositionBadge } from "./PositionBadge";
import { cn } from "@/lib/utils";
import { POSITIONS, value, type Player, type Pos, type Settings } from "@/lib/draft";

type SortKey = "adp" | "proj" | "prev" | "needs" | "custom";

const SORTS: [SortKey, string][] = [
  ["adp", "ADP"],
  ["proj", "Proj"],
  ["prev", "Last yr"],
  ["needs", "My needs"],
  ["custom", "Custom"],
];

export function PlayerList({
  players,
  draftedIds,
  watchIds,
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
}: {
  players: Player[];
  draftedIds: Set<string>;
  watchIds: Set<string>;
  needs: Record<Pos, number>;
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
  const [sort, setSort] = useState<SortKey>("adp");
  const [showDrafted, setShowDrafted] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

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
      if (sort === "proj") return bv.proj - av.proj;
      if (sort === "prev") return (bv.prev ?? -1) - (av.prev ?? -1);
      if (sort === "needs") {
        const an = needs[a.pos] ?? 0;
        const bn = needs[b.pos] ?? 0;
        if (an !== bn) return bn - an;
        return av.rank - bv.rank;
      }
      if (sort === "custom") {
        const ai = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bi = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return av.rank - bv.rank;
      }
      return av.rank - bv.rank;
    });
  }, [
    players,
    query,
    pos,
    sort,
    showDrafted,
    watchOnly,
    watchIds,
    draftedIds,
    settings,
    needs,
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
      <div className="sticky top-0 z-20 space-y-3 border-b border-border bg-surface/95 p-3 backdrop-blur">
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
          <Button variant="secondary" size="icon" className="h-10 w-10" disabled={!canUndo} onClick={onUndo}>
            <Undo2 className="size-4" />
            <span className="sr-only">Undo last pick</span>
          </Button>
        </div>

        <div className="-mx-1 flex flex-wrap items-center gap-y-2 px-1 pb-1">
          <div className="flex flex-1 flex-wrap gap-1.5">
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
                {p !== "ALL" && (needs[p as Pos] ?? 0) > 0 ? (
                  <span className="ml-1 text-[10px] opacity-70">{needs[p as Pos]}</span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="ml-auto flex flex-wrap justify-end gap-1.5 text-xs text-muted-foreground">
            {SORTS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={cn(
                  "shrink-0 rounded border px-2 py-1 uppercase tracking-wide transition-colors",
                  sort === key
                    ? "border-accent/50 bg-accent/15 text-accent"
                    : "border-border hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
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

        {sort === "custom" && (
          <p className="text-[11px] text-muted-foreground">
            Drag the handle to build your own board order. It saves automatically.
          </p>
        )}
      </div>

      <div className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 hidden items-center gap-2 border-b border-border bg-surface/95 px-2 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground backdrop-blur sm:flex">
          {sort === "custom" && <div className="w-6 shrink-0" />}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="w-14 shrink-0" />
            <div className="min-w-0 flex-1">Player</div>
            <div className="flex shrink-0 items-center gap-16">
              <div className="w-20 text-center">ADP</div>
              <div className="w-20 text-center">Proj</div>
              <div className="w-20 text-center">LY</div>
            </div>
            <div className="w-4 shrink-0" />
          </div>
          <div className="w-24 shrink-0" />
        </div>

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
                <div className="w-14 shrink-0">
                  <PositionBadge pos={p.pos} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{p.name}</span>
                    {p.injury && (
                      <span className="rounded bg-destructive/20 px-1 text-[10px] font-bold uppercase text-destructive">
                        {p.injury}
                      </span>
                    )}
                  </div>
                  <div className="tabnum text-xs text-muted-foreground">
                    #{v.rank} · {p.team}
                    {p.bye ? ` · BYE ${p.bye}` : ""}
                    {reach !== null && reach < -6 ? " · reach" : ""}
                  </div>
                </div>
                <div className="hidden shrink-0 items-center gap-16 sm:flex">
                  <StatCell label="ADP" value={v.adp < 900 ? v.adp.toFixed(1) : "—"} />
                  <StatCell label="Proj" value={v.proj.toFixed(1)} />
                  <StatCell label="LY" value={v.prev !== null && v.prev > 0 ? v.prev.toFixed(0) : "—"} />
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </>
            );
            return (
              <li
                key={p.id}
                data-pid={p.id}
                className={cn(
                  "flex items-center gap-2 px-2 py-2 transition-colors",
                  drafted && "opacity-40",
                  dragId === p.id && "bg-accent/10",
                )}
              >
                {sort === "custom" && (
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

                {onOpenPlayer ? (
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 rounded py-0.5 text-left hover:bg-secondary/50"
                    onClick={() => onOpenPlayer(p.id)}
                  >
                    {playerBody}
                  </button>
                ) : (
                  <Link
                    to="/player/$id"
                    params={{ id: p.id }}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded py-0.5 text-left hover:bg-secondary/50"
                  >
                    {playerBody}
                  </Link>
                )}

                <div className="flex w-24 shrink-0 items-center justify-end gap-1">
                  <Button
                    size="icon"
                    variant={watched ? "default" : "secondary"}
                    className="size-9"
                    onClick={() => onToggleWatch(p.id)}
                    aria-label={watched ? `Unwatch ${p.name}` : `Watch ${p.name}`}
                  >
                    <Star className={cn("size-4", watched && "fill-current")} />
                  </Button>
                  <Button
                    size="sm"
                    className="h-9 px-3 font-display uppercase"
                    disabled={drafted}
                    onClick={() => onDraft(p.id)}
                  >
                    Draft
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function StatCell({ value }: { label?: string; value: string }) {
  return <div className="tabnum w-20 text-center text-xs font-semibold">{value}</div>;
}

