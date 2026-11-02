import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";

/**
 * Research board card chrome.
 * Intentionally omits overflow-* — overflow-x-auto / overflow-hidden on an
 * ancestor create a scrollport and stop `position: sticky` thead from pinning
 * to the window while the player list scrolls.
 */
export const PLAYER_LIST_BOARD =
  "rounded-xl border border-slate-200 bg-white shadow-sm";

/**
 * Stick Rk / Player / stat headers under SiteNav (`--site-sticky-top`).
 * Filters + search stay in normal flow above the board and scroll away.
 *
 * Two-row boards: border-collapse leaves a sub-pixel seam between the group
 * and column header rows where scrolled stats flash through. `tr` margins are
 * ignored in tables, so seal with an opaque thead::before fill behind the rows
 * (plus solid th backgrounds).
 */
export const PLAYER_LIST_STICKY_THEAD =
  "sticky top-[var(--site-sticky-top,3.25rem)] z-30 bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)] before:pointer-events-none before:absolute before:inset-0 before:z-0 before:bg-slate-50 before:content-[''] [&_tr]:relative [&_tr]:z-[1] [&_tr]:bg-slate-50 [&_th]:relative [&_th]:z-[1] [&_th]:bg-slate-50";

/**
 * Group header row (Passing / Rushing / Misc). Leave Rk+Player cells blank —
 * no "Players" label. Separator is drawn on the th (box-shadow), not border-b:
 * collapsed borders between sticky header rows open a hairline hole.
 */
export const PLAYER_LIST_GROUP_HEADER_ROW =
  "bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500 [&_th]:shadow-[inset_0_-1px_0_0_rgb(226_232_240)]";

export const PLAYER_LIST_GROUP_TH =
  "border-l border-slate-200 px-2 py-2 text-center text-slate-700";

/** Column header row (Rk, Player, Proj, …) — Weekly Projections standard. */
export const PLAYER_LIST_COL_HEADER_ROW =
  "border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500";

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
