import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AccessGate } from "@/components/league/AccessGate";
import {
  PLAYBOOK_SUBNAV_LINKS,
  PlaybookSubNav,
  TRADE_SUBNAV_LINKS,
  WAIVER_SUBNAV_LINKS,
} from "@/components/nav/PlaybookSubNav";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const SECTION_COPY = {
  playbook: {
    links: PLAYBOOK_SUBNAV_LINKS,
    product: "Playbook",
    guestHeadline: "Instantly run your league like a front office",
    guestDescription:
      "Sign up to open matchups, standings, Press Room, and Trade Desk against your live synced league.",
    syncHeadline: "Sync a league to open your Playbook",
    syncDescription:
      "Connect Sleeper or ESPN so rankings, rosters, matchups, and activity load for your team.",
    selectDescription:
      "Choose an active league from the switcher above to load your personalized Playbook dashboard.",
  },
  trade: {
    links: TRADE_SUBNAV_LINKS,
    product: "Trade",
    guestHeadline: "Win every trade before you send it",
    guestDescription:
      "Sign up to open Trade Desk and Trade Market Values against the rosters in your synced league.",
    syncHeadline: "Sync a league to open the trade tools",
    syncDescription:
      "Connect Sleeper or ESPN so Trade Desk and Trade Market Values load with your team and your league's rosters.",
    selectDescription:
      "Choose an active league to grade trades and check market values against your rosters.",
  },
  waiver: {
    links: WAIVER_SUBNAV_LINKS,
    product: "Waiver",
    guestHeadline: "Own the waiver wire before your league does",
    guestDescription:
      "Sign up to open The Wire and Top Available against the free agents in your synced league.",
    syncHeadline: "Sync a league to open the waiver tools",
    syncDescription:
      "Connect Sleeper or ESPN so The Wire and Top Available only show players still available in your league.",
    selectDescription:
      "Choose an active league to see which players are still available in it.",
  },
} as const;

export type ShellSection = keyof typeof SECTION_COPY;

export function PlaybookShell({
  children,
  wide = false,
  section = "playbook",
}: {
  children?: ReactNode;
  /** Wider content column for tools like Trade Analyzer. */
  wide?: boolean;
  section?: ShellSection;
}) {
  const { ready, user } = useAuth();
  const { activeLeague, leagues } = useActiveLeague();
  const copy = SECTION_COPY[section];

  const mainClass = cn(
    "mx-auto w-full px-4 py-8 sm:px-6 lg:px-8",
    wide ? "max-w-[100rem]" : "max-w-shell",
  );

  if (!ready) {
    return (
      <>
        <PlaybookSubNav links={copy.links} />
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
          product={copy.product}
          headline={copy.guestHeadline}
          description={copy.guestDescription}
        />
      </main>
    );
  }

  if (!activeLeague) {
    return (
      <main className={cn(mainClass, "px-0 sm:px-0 lg:px-0")}>
        <AccessGate
          kind="sync"
          product={copy.product}
          headline={leagues.length === 0 ? copy.syncHeadline : "Select a synced league to continue"}
          description={leagues.length === 0 ? copy.syncDescription : copy.selectDescription}
          syncTo={leagues.length === 0 ? "/leaguesync" : "/account/leagues"}
          syncLabel={leagues.length === 0 ? "Sync Your League" : "Manage My Leagues"}
        />
      </main>
    );
  }

  return (
    <>
      <PlaybookSubNav links={copy.links} />
      <main className={mainClass}>{children ?? <Outlet />}</main>
    </>
  );
}
