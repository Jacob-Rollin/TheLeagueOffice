import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";

/** Group header row (Passing / Rushing / Misc). Leave Rk+Player cells blank — no "Players" label. */
export const PLAYER_LIST_GROUP_HEADER_ROW =
  "border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500";

export const PLAYER_LIST_GROUP_TH =
  "border-l border-slate-200 px-2 py-2 text-center text-slate-700";

/** Column header row (Rk, Player, Proj, …) — Weekly Projections standard. */
export const PLAYER_LIST_COL_HEADER_ROW =
  "border-b border-slate-200 bg-slate-50/80 text-[10px] font-black uppercase tracking-wider text-slate-500";

/** Single-row tables without a group header (Wire, Most Targeted, My Team). */
export const PLAYER_LIST_HEADER_ROW = PLAYER_LIST_COL_HEADER_ROW;

/** Muted highlight for the active sort column (matches War Room). */
export const PLAYER_LIST_SORT_ACTIVE = "bg-muted/40 text-slate-700";

export type SortState<K extends string> = {
  key: K | null;
  dir: SortDir;
};

/**
 * Three-click cycle for a column:
 * 1) activate with `defaultDir` + arrow
 * 2) flip direction
 * 3) clear (`key: null`) → page restores default ordering
 */
export function nextSortState<K extends string>(
  currentKey: K | null,
  currentDir: SortDir,
  nextKey: K,
  defaultDir: SortDir = "desc",
): SortState<K> {
  if (currentKey !== nextKey) {
    return { key: nextKey, dir: defaultDir };
  }
  const flipped: SortDir = defaultDir === "desc" ? "asc" : "desc";
  if (currentDir === defaultDir) {
    return { key: nextKey, dir: flipped };
  }
  return { key: null, dir: defaultDir };
}

export function SortHeaderButton({
  label,
  active,
  dir,
  onClick,
  className,
  align = "center",
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
  align?: "left" | "center" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex w-full items-center gap-0.5 rounded-sm px-0.5 py-0.5 uppercase tracking-wider transition-colors hover:text-slate-900",
        align === "left" && "justify-start text-left",
        align === "center" && "justify-center",
        align === "right" && "justify-end text-right",
        active ? PLAYER_LIST_SORT_ACTIVE : "text-slate-500",
        className,
      )}
    >
      <span>{label}</span>
      {active ? (
        <span aria-hidden="true" className="text-[9px] leading-none text-slate-600">
          {dir === "asc" ? "▲" : "▼"}
        </span>
      ) : null}
    </button>
  );
}
