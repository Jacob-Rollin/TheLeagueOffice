import { cn } from "@/lib/utils";
import { injuryBadgeInfo } from "@/lib/injury-badge";

/**
 * Circular letter badge on the avatar (bottom-left), matching Sleeper-style
 * mobile cards — amber Q, rose for O/D/IR/NA/etc.
 */
export function InjuryAvatarBadge({
  status,
  className,
}: {
  status?: string | null | undefined;
  className?: string | undefined;
}) {
  const info = injuryBadgeInfo(status);
  if (!info) return null;
  return (
    <span
      title={info.text}
      aria-label={info.text}
      className={cn(
        "absolute -bottom-0.5 -left-0.5 z-[1] flex size-[1.125rem] items-center justify-center rounded-full text-[9px] font-bold leading-none ring-2 ring-m-card",
        info.tone === "amber" ? "bg-amber-500 text-slate-950" : "bg-rose-600 text-white",
        className,
      )}
    >
      {info.letter}
    </span>
  );
}
