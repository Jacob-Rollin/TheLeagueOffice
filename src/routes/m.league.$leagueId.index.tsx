import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { MobilePlayoffPicture, MobileStandingsTable } from "@/components/mobile/league/MobileStandings";
import { useMobileLeagueStandings } from "@/components/mobile/league/useMobileLeague";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import type { StandingRow } from "@/lib/league.server";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/m/league/$leagueId/")({
  component: MobileLeagueHome,
});

type LeagueTab = "final" | "standings" | "playoffs";

const heroButtonClass =
  "flex-1 rounded-lg bg-m-chip px-3 py-3 text-center font-display text-[15px] font-bold uppercase tracking-wider text-m-chip-fg";

function MobileLeagueHome() {
  const { activeLeague, standings, rows, playoffTeams, seasonComplete, loading } = useMobileLeagueStandings();
  const { myTeam } = useLeagueRosters([]);
  const [tab, setTab] = useState<LeagueTab>("standings");

  useEffect(() => {
    if (seasonComplete) setTab("final");
  }, [seasonComplete]);

  const myTeamName = (activeLeague?.teamName ?? myTeam?.team ?? "").trim().toLowerCase();
  const isMine = (row: StandingRow) =>
    (myTeam?.slot != null && Number(row.rosterId) === Number(myTeam.slot)) ||
    (Boolean(myTeamName) && row.team.trim().toLowerCase() === myTeamName);

  const leagueName = standings?.league.name ?? activeLeague?.name ?? "League";
  const season = standings?.league.season ?? "";
  const tabs: { id: LeagueTab; label: string }[] = [
    ...(seasonComplete ? [{ id: "final" as const, label: "Final" }] : []),
    { id: "standings", label: "Standings" },
    { id: "playoffs", label: "Playoffs" },
  ];

  return (
    <main>
      <section className="px-4 pb-5 pt-6 text-center">
        <h1 className="font-display text-[34px] font-extrabold uppercase italic leading-[1.05] tracking-wide">
          {leagueName}
        </h1>
        {season ? (
          <p className="mt-1 font-display text-sm font-semibold uppercase tracking-[0.2em] text-m-muted">
            {season} {seasonComplete ? "Off-Season" : "Season"}
          </p>
        ) : null}
        <div className="mt-4 flex gap-3">
          <Link
            to="/account/leagues/$connectionId"
            params={{ connectionId: activeLeague?.id ?? "" }}
            className={heroButtonClass}
          >
            Manage League
          </Link>
          <Link to="/hof" className={heroButtonClass}>
            Hall of Fame
          </Link>
        </div>
      </section>

      <section className="rounded-t-2xl bg-m-card pb-4 pt-4 text-m-card-fg">
        <div className="flex gap-3 px-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2.5 font-display text-base font-semibold tracking-wide transition-colors",
                tab === t.id
                  ? "border-m-tab-active-border bg-m-tab-active text-m-tab-active-fg"
                  : "border-m-border bg-m-tab text-m-tab-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {loading ? (
            <p className="px-4 py-10 text-center text-sm text-m-muted">Loading standings...</p>
          ) : !rows.length ? (
            <p className="px-4 py-10 text-center text-sm text-m-muted">Standings are unavailable for this league.</p>
          ) : tab === "playoffs" ? (
            <MobilePlayoffPicture rows={rows} playoffTeams={playoffTeams} isMine={isMine} />
          ) : (
            <MobileStandingsTable
              rows={rows}
              rankLabel={tab === "final" ? "Final" : "Rank"}
              playoffTeams={tab === "final" ? 0 : playoffTeams}
              isMine={isMine}
            />
          )}
        </div>
      </section>
    </main>
  );
}
