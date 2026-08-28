import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { AuthDialog } from "@/components/auth/AuthDialog";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";

/** Centered prompt shown wherever a synced league is required. */
export function LeagueEmptyState({ className }: { className?: string }) {
  const { user, ready } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const authenticated = ready && Boolean(user);

  return (
    <div className={className ?? "mx-auto flex w-full max-w-xl flex-col items-center gap-3 px-4 py-16 text-center"}>
      <p className="text-sm font-medium text-black">
        {authenticated
          ? "Please sync or select a league to unlock analytical tracking tools."
          : "Please sign in to unlock analytical tracking tools and live league data sync."}
      </p>
      {authenticated ? (
        <Link to="/leaguesync" className="text-sm font-semibold text-black underline underline-offset-4">
          Go to League Sync
        </Link>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="text-sm font-semibold text-black underline underline-offset-4"
          >
            Sign In to Unlock Sync
          </button>
          <AuthDialog open={authOpen} mode="signin" onOpenChange={setAuthOpen} />
        </>
      )}
    </div>
  );
}

/** Renders children only when a synced league is selected. */
export function LeagueGate({ children }: { children: ReactNode }) {
  const { activeLeague } = useActiveLeague();
  if (!activeLeague) return <LeagueEmptyState />;
  return <>{children}</>;
}
