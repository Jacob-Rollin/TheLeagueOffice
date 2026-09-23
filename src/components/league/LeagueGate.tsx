import type { ReactNode } from "react";

import { AccessGate } from "@/components/league/AccessGate";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";

/** Compact / full unlock prompt wherever a synced league is required. */
export function LeagueEmptyState({
  className,
  compact = false,
  product = "League Tools",
}: {
  className?: string;
  compact?: boolean;
  product?: string;
}) {
  const { user, ready } = useAuth();
  const authenticated = ready && Boolean(user);

  if (!authenticated) {
    return (
      <AccessGate
        kind="guest"
        compact={compact}
        className={className}
        product={product}
        headline="Unlock your front office tools"
        description="Sign up to sync your league, grade trades, track matchups, and run waivers from one command center."
      />
    );
  }

  return (
    <AccessGate
      kind="sync"
      compact={compact}
      className={className}
      product={product}
      headline="Sync a league to continue"
      description="Connect your Sleeper or ESPN league so standings, rosters, and weekly tools load with live data."
    />
  );
}

/** Renders children only when a synced league is selected. */
export function LeagueGate({ children }: { children: ReactNode }) {
  const { activeLeague } = useActiveLeague();
  if (!activeLeague) return <LeagueEmptyState />;
  return <>{children}</>;
}
