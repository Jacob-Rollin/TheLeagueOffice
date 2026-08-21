import { cn } from "@/lib/utils";
import type { Player } from "@/lib/draft";

const COLS = ["QB", "RB", "WR", "TE"] as const;
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

/** Vertical bye grid: weeks down the rows, position slots across the top. */
export function ByeWeekGrid({ players }: { players: Player[] }) {
  const byWeek = new Map<number, Player[]>();
  const unknown: Player[] = [];
  for (const p of players) {
    if (!p.bye) {
      unknown.push(p);
      continue;
    }
    byWeek.set(p.bye, [...(byWeek.get(p.bye) ?? []), p]);
  }

  return (
    <div className="w-full">
      <div className="grid grid-cols-[2.6rem_repeat(4,minmax(0,1fr))] gap-px bg-border text-[10px]">
        <div className="bg-surface px-1 py-1 text-center font-display uppercase tracking-widest text-muted-foreground">
          Wk
        </div>
        {COLS.map((c) => (
          <div
            key={c}
            className="bg-surface px-1 py-1 text-center font-display uppercase tracking-widest text-muted-foreground"
          >
            {c}
          </div>
        ))}

        {WEEKS.map((week) => {
          const list = byWeek.get(week) ?? [];
          const conflict = list.length >= 2;
          return (
            <Row key={week} week={week} list={list} conflict={conflict} />
          );
        })}
      </div>
      {unknown.length > 0 && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Bye unknown: {unknown.map((p) => p.name).join(", ")}
        </p>
      )}
    </div>
  );
}

function Row({ week, list, conflict }: { week: number; list: Player[]; conflict: boolean }) {
  return (
    <>
      <div
        className={cn(
          "bg-card px-1 py-1 text-center font-mono tabnum",
          conflict ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {week}
      </div>
      {COLS.map((c) => {
        const hits = list.filter((p) => p.pos === c);
        return (
          <div
            key={c}
            className={cn(
              "flex flex-wrap items-center justify-center gap-0.5 px-1 py-1 font-mono tabnum",
              hits.length === 0
                ? "bg-card/60 text-muted-foreground/40"
                : conflict
                  ? "bg-destructive/15 text-destructive"
                  : "bg-primary/10 text-primary",
            )}
            style={{ backgroundColor: undefined }}
          >
            {hits.length ? hits.map((p) => <span key={p.id}>{p.team ?? "FA"}</span>) : "·"}
          </div>
        );
      })}
    </>
  );
}
