import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useActiveLeague } from "@/context/ActiveLeagueContext";

/** Centered prompt shown wherever a synced league is required. */
export function LeagueEmptyState({ className }: { className?: string }) {
  return (
    <div className={className ?? "mx-auto flex w-full max-w-xl flex-col items-center gap-3 px-4 py-16 text-center"}>
      <p className="text-sm font-medium text-black">
        Please sync or select a league to unlock analytical tracking tools
      </p>
      <Link
        to="/leaguesync"
        className="text-sm font-semibold text-black underline underline-offset-4"
      >
        Go to League Sync
      </Link>
    </div>
  );
}

/** Renders children only when a synced league is selected. */
export function LeagueGate({ children }: { children: ReactNode }) {
  const { activeLeague } = useActiveLeague();
  if (!activeLeague) return <LeagueEmptyState />;
  return <>{children}</>;
}
