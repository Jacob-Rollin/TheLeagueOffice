import { cn } from "@/lib/utils";
import type { Pos } from "@/lib/draft";

const map: Record<string, string> = {
  QB: "bg-qb/70 text-white border-qb/70",
  RB: "bg-rb/70 text-white border-rb/70",
  WR: "bg-wr/70 text-white border-wr/70",
  TE: "bg-te/70 text-white border-te/70",
  K: "bg-k/70 text-white border-k/70",
  DEF: "bg-def/70 text-white border-def/70",
  FLEX: "bg-muted text-muted-foreground border-border",
  BN: "bg-muted text-muted-foreground border-border",
};

export function PositionBadge({
  pos,
  className,
}: {
  pos: Pos | string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-[2.4rem] items-center justify-center rounded border px-1.5 font-display text-xs font-semibold uppercase tracking-wider",
        map[pos] ?? map["BN"],
        className,
      )}
    >
      {pos}
    </span>
  );
}
