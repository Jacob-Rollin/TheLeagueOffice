import { PositionBadge } from "./PositionBadge";
import { cn } from "@/lib/utils";
import { byeMatrix, type Player } from "@/lib/draft";

export function ByeMatrix({
  players,
  layout = "row",
}: {
  players: Player[];
  layout?: "row" | "column";
}) {
  const { weeks, unknown } = byeMatrix(players);
  const conflicts = weeks.filter((w) => w.conflict).length;
  const column = layout === "column";

  return (
    <section className={cn("pb-6", column ? "px-0" : "px-3")}>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground">
          Bye week matrix
        </h3>
        <span className="tabnum text-xs text-muted-foreground">
          {conflicts ? `${conflicts} crowded week${conflicts > 1 ? "s" : ""}` : "No bye conflicts"}
        </span>
      </div>

      <div className={cn(!column && "overflow-x-auto")}>
        <div className={cn("gap-1", column ? "flex flex-col" : "flex min-w-max")}>
          {weeks.map(({ week, players: list, conflict }) => (
            <div
              key={week}
              className={cn(
                column ? "w-full rounded border p-1.5" : "w-24 shrink-0 rounded border p-1.5",
                conflict
                  ? "border-destructive/60 bg-destructive/10"
                  : list.length
                    ? "border-border bg-card"
                    : "border-dashed border-border/50 bg-surface/40",
              )}
            >
              <div
                className={cn(
                  "mb-1 text-center font-display text-xs uppercase tracking-wide",
                  conflict ? "text-destructive" : "text-muted-foreground",
                )}
              >
                Wk {week}
              </div>
              <ul className="space-y-1">
                {list.map((p) => (
                  <li key={p.id} className="flex items-center gap-1">
                    <PositionBadge pos={p.pos} className="h-4 min-w-0 px-1 text-[9px]" />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">
                      {p.name}
                    </span>
                  </li>
                ))}
                {list.length === 0 && (
                  <li className="text-center text-[10px] text-muted-foreground">—</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {unknown.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Bye unknown: {unknown.map((p) => p.name).join(", ")}
        </p>
      )}
    </section>
  );
}
