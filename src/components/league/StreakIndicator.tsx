import { cn } from "@/lib/utils";

/** Parses "3W" / "2L" / "1T" into its parts; null when there is no active streak. */
export function parseStreak(raw: string | null | undefined): { count: number; result: "W" | "L" | "T" } | null {
  const match = /^(\d+)([WLT])$/.exec((raw ?? "").trim().toUpperCase());
  if (!match) return null;
  const count = Number(match[1]);
  return count > 0 ? { count, result: match[2] as "W" | "L" | "T" } : null;
}

/** Win/loss streak styled like the standings Trend column: ▲ 3W green, ▼ 2L red. */
export function StreakIndicator({
  streak,
  highlighted = false,
  className,
}: {
  streak: string | null | undefined;
  /** Row sits on a dark highlight (the user's team), so use the light tints. */
  highlighted?: boolean;
  className?: string;
}) {
  const parsed = parseStreak(streak);
  const base = "whitespace-nowrap text-xs font-semibold tabular-nums";
  if (!parsed) {
    return (
      <span className={cn(base, highlighted ? "text-white/70" : "text-slate-400", className)}>—</span>
    );
  }
  const { count, result } = parsed;
  const label = result === "W" ? "win" : result === "L" ? "loss" : "tie";
  const tone =
    result === "W"
      ? highlighted
        ? "text-emerald-200"
        : "text-emerald-600"
      : result === "L"
        ? highlighted
          ? "text-rose-200"
          : "text-rose-600"
        : highlighted
          ? "text-white/70"
          : "text-slate-500";
  const arrow = result === "W" ? "▲" : result === "L" ? "▼" : "–";
  return (
    <span
      className={cn(base, tone, className)}
      title={`${count} game ${label} streak`}
      aria-label={`${count} game ${label} streak`}
    >
      {arrow} {count}
      {result}
    </span>
  );
}
