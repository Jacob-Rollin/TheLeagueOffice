import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared 1–5 amber matchup stars — same Lucide treatment on Matchup cards,
 * My Team, Waiver Wire, and player SOS / Outlook tabs.
 */
export function SosStars({
  stars,
  size = "sm",
  className,
}: {
  stars: number | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  const filled =
    stars != null && Number.isFinite(stars)
      ? Math.max(0, Math.min(5, Math.round(Number(stars))))
      : 0;
  const dim = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";

  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-0.5", className)}
      aria-label={`${filled} of 5 matchup stars`}
    >
      {Array.from({ length: 5 }, (_, i) => {
        const isFilled = i < filled;
        return (
          <Star
            key={`sos-star-${i}`}
            className={cn(dim, "shrink-0", isFilled ? "text-amber-500" : "text-slate-200")}
            fill={isFilled ? "currentColor" : "none"}
            strokeWidth={2}
            aria-hidden="true"
          />
        );
      })}
    </span>
  );
}
