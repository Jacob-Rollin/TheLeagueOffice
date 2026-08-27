import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { cn } from "@/lib/utils";

/** Subscribes to the globally selected league and shows which config the tool is filtered by. */
export function ActiveLeagueLabel({ className }: { className?: string }) {
  const { activeLeague } = useActiveLeague();
  if (!activeLeague) return null;
  return (
    <span
      className={cn(
        "rounded-md border border-border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {activeLeague.name}
    </span>
  );
}
