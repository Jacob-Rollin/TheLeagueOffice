import { useMemo, useState } from "react";
import { Search, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PositionBadge } from "./PositionBadge";
import { cn } from "@/lib/utils";
import { POSITIONS, roundOf, value, type Player, type Settings } from "@/lib/draft";

type SortKey = "adp" | "proj" | "prev";

export function PlayerList({
  players,
  draftedIds,
  settings,
  currentOverall,
  onDraft,
  onUndo,
  canUndo,
}: {
  players: Player[];
  draftedIds: Set<string>;
  settings: Settings;
  currentOverall: number;
  onDraft: (id: string) => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<string>("ALL");
  const [sort, setSort] = useState<SortKey>("adp");
  const [showDrafted, setShowDrafted] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = players.filter((p) => {
      if ((p.pos === "K" || p.pos === "DEF") && settings.roster[p.pos] === 0) return false;
      if (pos !== "ALL" && p.pos !== pos) return false;
      if (!showDrafted && draftedIds.has(p.id)) return false;
      if (q && !`${p.name} ${p.team}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return list.sort((a, b) => {
      const av = value(a, settings.scoring);
      const bv = value(b, settings.scoring);
      if (sort === "adp") return av.adp - bv.adp;
      if (sort === "proj") return bv.proj - av.proj;
      return (bv.prev ?? -1) - (av.prev ?? -1);
    });
  }, [players, query, pos, sort, showDrafted, draftedIds, settings]);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border bg-surface/60 p-3 backdrop-blur">
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

        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
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
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex gap-1.5">
            {(
              [
                ["adp", "ADP"],
                ["proj", "Proj"],
                ["prev", "Last yr"],
              ] as [SortKey, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={cn(
                  "rounded border px-2 py-1 uppercase tracking-wide transition-colors",
                  sort === key
                    ? "border-accent/50 bg-accent/15 text-accent"
                    : "border-border hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={showDrafted}
              onChange={(e) => setShowDrafted(e.target.checked)}
              className="size-3.5 accent-[var(--primary)]"
            />
            Show drafted
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">No players match.</p>
        )}
        <ul className="divide-y divide-border">
          {rows.map((p) => {
            const v = value(p, settings.scoring);
            const drafted = draftedIds.has(p.id);
            const reach = v.adp < 900 ? Math.round(v.adp - currentOverall) : null;
            return (
              <li key={p.id}>
                <button
                  disabled={drafted}
                  onClick={() => onDraft(p.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                    drafted ? "opacity-40" : "hover:bg-secondary/60 active:bg-secondary",
                  )}
                >
                  <PositionBadge pos={p.pos} />
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
                      {p.team} · Proj {v.proj.toFixed(1)}
                      {v.prev !== null && v.prev > 0 ? ` · LY ${v.prev.toFixed(0)}` : ""}
                    </div>
                  </div>
                  <div className="tabnum shrink-0 text-right">
                    <div className="font-display text-lg leading-none font-semibold">
                      {v.adp < 900 ? v.adp.toFixed(1) : "—"}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {v.adp < 900 ? `R${roundOf(Math.max(1, Math.round(v.adp)), settings.teams)}` : "ADP"}
                      {reach !== null && reach < -6 ? " · reach" : ""}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
