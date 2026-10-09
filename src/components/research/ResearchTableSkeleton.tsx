import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Layout-matching table body skeleton for research boards.
 * Keeps thead chrome visible while the first snap loads.
 */
export function ResearchTableSkeleton({
  rows = 10,
  cols = 6,
  colSpan,
}: {
  rows?: number;
  cols?: number;
  /** When set, renders a single cell per row (for colspan layouts). */
  colSpan?: number;
}) {
  if (colSpan != null) {
    return (
      <>
        {Array.from({ length: rows }, (_, i) => (
          <tr key={i} className="border-b border-slate-100">
            <td colSpan={colSpan} className="px-4 py-3">
              <Skeleton className="h-4 w-full max-w-md" />
            </td>
          </tr>
        ))}
      </>
    );
  }

  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr
          key={i}
          className={cn("border-b border-slate-100", i % 2 === 1 ? "bg-slate-50/40" : "bg-white")}
        >
          {Array.from({ length: cols }, (_, j) => (
            <td key={j} className="px-3 py-2.5">
              <Skeleton
                className={cn("h-4", j === 0 ? "w-28 max-w-full" : "mx-auto w-12")}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Card-list skeleton for injury report / news-style pages. */
export function ResearchCardListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <ul className="space-y-4" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40 max-w-full" />
              <Skeleton className="h-3 w-full max-w-lg" />
              <Skeleton className="h-3 w-48 max-w-full" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Matchup board placeholder — scores + lineup chrome without blanking the page. */
export function MatchupBoardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading matchup board">
      <div className="flex items-center gap-3 border-b border-border pb-5">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-36 max-w-full" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-8 w-16 shrink-0" />
        <span className="text-xs font-bold uppercase text-slate-300">vs</span>
        <Skeleton className="h-8 w-16 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2 text-right">
          <Skeleton className="ml-auto h-5 w-36 max-w-full" />
          <Skeleton className="ml-auto h-3 w-20" />
        </div>
        <Skeleton className="size-12 shrink-0 rounded-full" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 flex-1 max-w-[12rem]" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
