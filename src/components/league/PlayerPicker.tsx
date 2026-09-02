import { useMemo, useState, type ReactNode } from "react";

import { PositionBadge } from "@/components/draft/PositionBadge";
import type { Player } from "@/lib/draft";
import { playerValue } from "@/lib/evaluate";
import { cn } from "@/lib/utils";

export function PlayerPicker({
  players,
  selected,
  onAdd,
  onRemove,
  label,
  placeholder = "Search players…",
  single,
  accent,
  renderMeta,
  renderRow,
  renderOption,
  footer,
  bare,
}: {
  players: Player[];
  selected: Player[];
  onAdd: (p: Player) => void;
  onRemove: (id: string) => void;
  label: string;
  placeholder?: string;
  single?: boolean;
  accent?: "give" | "get";
  /** Optional replacement for the default value chip on a selected row. */
  renderMeta?: (p: Player) => ReactNode;
  /** Full replacement for the selected row body (badge + meta). */
  renderRow?: (p: Player) => ReactNode;
  /** Full replacement for a drop-down search result body. */
  renderOption?: (p: Player) => ReactNode;
  /** Extra content appended below the selected list. */
  footer?: ReactNode;
  /** Render without the outer card chrome (used inside a fused card block). */
  bare?: boolean;
}) {
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    return players
      .filter(
        (p) =>
          p.name.toLowerCase().includes(term) && !selected.some((s) => s.id === p.id),
      )
      .slice(0, 8);
  }, [q, players, selected]);

  return (
    <div
      className={cn(
        bare ? "p-0" : "rounded-lg border border-border bg-card p-3",
      )}
    >

      <div className="flex items-baseline justify-between">
        <h3
          className={cn(
            "font-display text-sm uppercase tracking-widest",
            accent === "get" ? "text-primary" : "text-foreground",
          )}
        >
          {label}
        </h3>
        <span className="tabnum text-xs text-muted-foreground">
          {selected.length} {single ? "" : "selected"}
        </span>
      </div>

      <div className="relative mt-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        {results.length > 0 && (
          <ul className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-md border border-border bg-surface shadow-lg">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onAdd(p);
                    setQ("");
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  {renderOption ? (
                    <span className="min-w-0 flex-1">{renderOption(p)}</span>
                  ) : (
                    <>
                      <PositionBadge pos={p.pos} />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{p.team}</span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ul className="mt-2 space-y-1">
        {selected.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          >
            {renderRow ? (
              <span className="min-w-0 flex-1">{renderRow(p)}</span>
            ) : (
              <>
                <PositionBadge pos={p.pos} />
                {renderMeta ? (
                  <span className="min-w-0 flex-1">{renderMeta(p)}</span>
                ) : (
                  <>
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="tabnum text-xs text-muted-foreground">
                      {playerValue(p)} pts val
                    </span>
                  </>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => onRemove(p.id)}
              className="rounded px-1.5 text-xs text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${p.name}`}
            >
              ✕
            </button>
          </li>
        ))}
        {!selected.length && (
          <li className="px-1 py-2 text-xs text-muted-foreground">No players yet.</li>
        )}
        {footer}
      </ul>
    </div>

  );
}
