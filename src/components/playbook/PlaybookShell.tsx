import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AccessGate } from "@/components/league/AccessGate";
import { PlaybookSubNav } from "@/components/nav/PlaybookSubNav";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export function PlaybookShell({
  children,
  wide = false,
}: {
  children?: ReactNode;
  /** Wider content column for tools like Trade Analyzer. */
  wide?: boolean;
}) {
  const { ready, user } = useAuth();
  const { activeLeague, leagues } = useActiveLeague();

  const mainClass = cn(
    "mx-auto w-full px-4 py-8 sm:px-6 lg:px-8",
    wide ? "max-w-[100rem]" : "max-w-shell",
  );

  if (!ready) {
    return (
      <>
        <PlaybookSubNav />
        <main className={mainClass}>
          <p className="text-sm text-muted-foreground">Loading league context…</p>
        </main>
      </>
    );
  }

  if (!user) {
    return (
      <main className={cn(mainClass, "px-0 sm:px-0 lg:px-0")}>
        <AccessGate
          kind="guest"
          product="Playbook"
          headline="Instantly run your league like a front office"
          description="Sign up to open matchups, standings, Press Room, Trade Desk, and The Wire against your live synced league."
        />
      </main>
    );
  }

  if (!activeLeague) {
    return (
      <main className={cn(mainClass, "px-0 sm:px-0 lg:px-0")}>
        <AccessGate
          kind="sync"
          product="Playbook"
          headline={
            leagues.length === 0
              ? "Sync a league to open your Playbook"
              : "Select a synced league to continue"
          }
          description={
            leagues.length === 0
              ? "Connect Sleeper or ESPN so rankings, rosters, matchups, and activity load for your team."
              : "Choose an active league from the switcher above to load your personalized Playbook dashboard."
          }
          syncTo={leagues.length === 0 ? "/leaguesync" : "/account/leagues"}
          syncLabel={leagues.length === 0 ? "Sync Your League" : "Manage My Leagues"}
        />
      </main>
    );
  }

  return (
    <>
      <PlaybookSubNav />
      <main className={mainClass}>{children ?? <Outlet />}</main>
    </>
  );
}
