import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";

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
        "inline-flex items-center gap-0.5 uppercase tracking-widest hover:text-slate-900",
        align === "left" && "justify-start text-left",
        align === "center" && "justify-center",
        align === "right" && "justify-end text-right",
        active ? "text-slate-700" : "",
        className,
      )}
    >
      {label}
      {active ? (
        <span aria-hidden="true" className="text-[9px]">
          {dir === "asc" ? "▲" : "▼"}
        </span>
      ) : null}
    </button>
  );
}

/** Toggle sort: same key flips direction; new key uses `defaultDir`. */
export function nextSortState<K extends string>(
  currentKey: K,
  currentDir: SortDir,
  nextKey: K,
  defaultDir: SortDir = "desc",
): { key: K; dir: SortDir } {
  if (currentKey === nextKey) {
    return { key: currentKey, dir: currentDir === "asc" ? "desc" : "asc" };
  }
  return { key: nextKey, dir: defaultDir };
}
