import { cn } from "@/lib/utils";

/** Match weekly / season projection lists: slight moves stay neutral. */
const TREND_UP = 0.05;
const TREND_DOWN = -0.05;

export function valueTrendTone(trend: number): "up" | "down" | "flat" {
  if (trend > TREND_UP) return "up";
  if (trend < TREND_DOWN) return "down";
  return "flat";
}

const TONE_CLASS = {
  up: "text-emerald-600",
  down: "text-rose-600",
  flat: "text-slate-400",
} as const;

const TONE_ARROW = {
  up: "▲",
  down: "▼",
  flat: "–",
} as const;

/**
 * Market Value / Trend cell — same presentation as Weekly Projections:
 * `12.3 / ▲ 0.8` with green up / red down / muted flat.
 */
export function ValueTrendCell({
  value,
  trend,
  className,
}: {
  /** Display-scaled market value (already passed through `scaleValue`). */
  value: number;
  /** Raw FantasyCalc trend delta from the player brain. */
  trend: number;
  className?: string;
}) {
  const tone = valueTrendTone(trend);

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center gap-1.5 tabular-nums text-slate-500",
        className,
      )}
    >
      <span>{value.toFixed(1)}</span>
      <span className="text-slate-300">/</span>
      <span className={cn("inline-flex items-center gap-0.5 font-semibold", TONE_CLASS[tone])}>
        <span aria-hidden="true">{TONE_ARROW[tone]}</span>
        <span>{Math.abs(trend).toFixed(1)}</span>
      </span>
    </span>
  );
}
