import { Link, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { LeagueSwitcher, PlaybookSubNav } from "@/components/nav/PlaybookSubNav";
import { playbookCardClass } from "@/components/playbook/panels";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const blueButton =
  "rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60";

export function PlaybookShell({ children }: { children?: ReactNode }) {
  const { ready, user } = useAuth();
  const { activeLeague, leagues } = useActiveLeague();

  if (!ready) {
    return (
      <>
        <PlaybookSubNav />
        <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <p className="text-sm text-muted-foreground">Loading league context…</p>
        </main>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <PlaybookSubNav />
        <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <section className={playbookCardClass}>
            <h1 className="display-title text-3xl uppercase tracking-wide">Playbook</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in and sync a league to open your personalized Playbook dashboard.
            </p>
          </section>
        </main>
      </>
    );
  }

  if (!activeLeague) {
    return (
      <>
        <PlaybookSubNav />
        <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <section className={playbookCardClass}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <h1 className="display-title text-3xl uppercase tracking-wide">Playbook</h1>
              <LeagueSwitcher />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {leagues.length === 0
                ? "No synced leagues yet. Sync a league to load rankings, rosters, and activity."
                : "Select a synced league to load this dashboard."}
            </p>
            {leagues.length === 0 ? (
              <Link to="/account/leagues" className={cn(blueButton, "mt-5 inline-flex")}>
                + Sync New League
              </Link>
            ) : null}
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <PlaybookSubNav />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children ?? <Outlet />}
      </main>
    </>
  );
}
