import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

import { REGULAR_SEASON_WEEKS } from "./lineupShared";

export function MobileWeekSelect({
  week,
  onChange,
  className,
  centered = false,
}: {
  week: number;
  onChange: (week: number) => void;
  className?: string;
  /** Center Week label + chevron (My Team matchup card). */
  centered?: boolean;
}) {
  return (
    <label
      className={cn(
        "relative flex items-center rounded-lg bg-m-select-bg px-4 py-3 font-display text-lg font-semibold text-m-select-fg",
        centered ? "justify-center gap-1.5" : "justify-between",
        className,
      )}
    >
      <span className={centered ? "uppercase tracking-wide" : undefined}>Week {week}</span>
      <ChevronDown className="size-5 shrink-0 opacity-70" aria-hidden />
      <select
        aria-label="Select week"
        value={week}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) => i + 1).map((w) => (
          <option key={w} value={w}>
            Week {w}
          </option>
        ))}
      </select>
    </label>
  );
}
