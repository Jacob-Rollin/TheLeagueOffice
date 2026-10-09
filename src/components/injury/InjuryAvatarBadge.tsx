import { cn } from "@/lib/utils";
import { injuryBadgeInfo } from "@/lib/injury-badge";

/**
 * Circular letter badge on the avatar, matching Sleeper-style mobile cards —
 * amber Q, rose for O/D/IR/NA/etc. Default sits centered on the bottom edge
 * (overlapping); pass `placement="bottom-left"` for the older corner sit.
 */
export function InjuryAvatarBadge({
  status,
  className,
  placement = "bottom-center",
}: {
  status?: string | null | undefined;
  className?: string | undefined;
  placement?: "bottom-center" | "bottom-left";
}) {
  const info = injuryBadgeInfo(status);
  if (!info) return null;
  return (
    <span
      title={info.text}
      aria-label={info.text}
      className={cn(
        "absolute z-[1] flex size-[1.125rem] items-center justify-center rounded-full text-[9px] font-bold leading-none ring-2 ring-m-card",
        placement === "bottom-center"
          ? "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/3"
          : "-bottom-0.5 -left-0.5",
        info.tone === "amber" ? "bg-amber-500 text-slate-950" : "bg-rose-600 text-white",
        className,
      )}
    >
      {info.letter}
    </span>
  );
}
