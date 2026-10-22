import { PositionBadge } from "./PositionBadge";
import { cn } from "@/lib/utils";
import { byeMatrix, posDisplayLabel, type Player } from "@/lib/draft";

export function ByeMatrix({
  players,
  layout = "row",
  hideTitle = false,
}: {
  players: Player[];
  layout?: "row" | "column";
  /** Parent already shows a Bye weeks heading (War Room analysis sheet). */
  hideTitle?: boolean;
}) {
  const { weeks, unknown } = byeMatrix(players);
  const conflicts = weeks.filter((w) => w.conflict).length;
  const column = layout === "column";

  return (
    <section className={cn(column ? "px-0" : "px-3", !hideTitle && "pb-2")}>
      {!hideTitle ? (
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground">
            Bye week matrix
          </h3>
          <span className="tabnum text-xs text-muted-foreground">
            {conflicts ? `${conflicts} crowded week${conflicts > 1 ? "s" : ""}` : "No bye conflicts"}
          </span>
        </div>
      ) : null}

      <div className={cn(!column && "overflow-x-auto")}>
        <div
          className={cn(
            "gap-1",
            column ? "grid grid-cols-2 sm:grid-cols-3" : "flex min-w-max",
          )}
        >
          {weeks.map(({ week, players: list, conflict }) => (
            <div
              key={week}
              className={cn(
                column ? "min-w-0 rounded-md border p-1.5" : "w-24 shrink-0 rounded border p-1.5",
                conflict
                  ? "border-red-300 bg-red-50"
                  : list.length
                    ? "border-slate-200 bg-white"
                    : "border-dashed border-slate-200 bg-slate-50/60",
              )}
            >
              <div
                className={cn(
                  "mb-1 text-center font-display text-xs uppercase tracking-wide",
                  conflict ? "text-red-700" : "text-slate-500",
                )}
              >
                Wk {week}
              </div>
              <ul className="space-y-1">
                {list.map((p) => (
                  <li key={p.id} className="flex items-center gap-1">
                    <PositionBadge
                      pos={posDisplayLabel(p.pos)}
                      className="h-4 min-w-0 px-1 text-[9px]"
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-800">
                      {p.name}
                    </span>
                  </li>
                ))}
                {list.length === 0 && (
                  <li className="text-center text-[10px] text-slate-400">—</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {unknown.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">
          Bye unknown: {unknown.map((p) => p.name).join(", ")}
        </p>
      )}
    </section>
  );
}
