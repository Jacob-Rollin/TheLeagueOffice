import { cn } from "@/lib/utils";
import type { Pos } from "@/lib/draft";

const map: Record<string, string> = {
  QB: "bg-qb/15 text-qb border-qb/40",
  RB: "bg-rb/15 text-rb border-rb/40",
  WR: "bg-wr/15 text-wr border-wr/40",
  TE: "bg-te/15 text-te border-te/40",
  K: "bg-k/15 text-k border-k/40",
  DEF: "bg-def/15 text-def border-def/40",
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
