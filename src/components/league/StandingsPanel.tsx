import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";

import { LeagueEmptyState } from "@/components/league/LeagueGate";
import { TeamAvatarBadge } from "@/components/playbook/panels";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { platformLabel } from "@/lib/league-link";
import { cn } from "@/lib/utils";

/** Active league standings sidebar shared by the homepage and article reader. */
export function StandingsPanel() {
  const { activeLeague, standings, loading: standingsLoading } = useActiveStandings();
  const { teams, myTeam } = useLeagueRosters([]);

  const leagueName = (standings?.league?.name ?? activeLeague?.name ?? "League").trim();
  const season = standings?.league?.season ?? "";
  const platform = platformLabel(activeLeague?.platform);
  const myTeamName = (activeLeague?.teamName ?? myTeam?.team ?? "").trim().toLowerCase();
  const myRosterId = myTeam?.slot ?? null;

  const logoBySlot = useMemo(() => {
    const map = new Map<number, string | null>();
    for (const team of teams) map.set(team.slot, team.logo);
    for (const row of standings?.rows ?? []) {
      if (!map.has(row.rosterId) || !map.get(row.rosterId)) {
        map.set(row.rosterId, row.avatar ?? null);
      }
    }
    return map;
  }, [teams, standings]);

  const isMine = (rosterId: number, team: string) => {
    if (myRosterId != null && Number(rosterId) === Number(myRosterId)) return true;
    if (myTeamName && team.trim().toLowerCase() === myTeamName) return true;
    return false;
  };

  return (
    <>
      {!activeLeague && (
        <LeagueEmptyState
          compact
          product="Standings"
          className="rounded-xl border border-border/80 bg-card px-4 py-10"
        />
      )}
      {activeLeague && !standings && (
        <section className="rounded-xl border border-border/80 bg-card p-4 text-sm text-muted-foreground">
          {standingsLoading ? "Loading standings…" : "Standings unavailable for this league."}
        </section>
      )}
      {activeLeague && standings && (
        <section className="rounded-xl border border-border/80 bg-card p-4 transition-colors">
          <header className="mb-3 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <TeamAvatarBadge
                name={activeLeague.teamName?.trim() || leagueName}
                logo={activeLeague.avatar}
                platform={activeLeague.platform}
                cacheKey={activeLeague.id}
              />
              <div className="min-w-0">
                <h2 className="display-title truncate text-lg uppercase tracking-wide text-zinc-950">
                  {leagueName}
                </h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {platform ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {platform}
                    </span>
                  ) : null}
                  <span className="inline-flex rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-600">
                    Synced
                  </span>
                </div>
              </div>
            </div>
            {season ? (
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {season}
              </span>
            ) : null}
          </header>

          <div className="overflow-hidden rounded-lg border border-border/70">
          <div className="grid grid-cols-[2.25rem_1fr_3.25rem_1rem] items-center gap-1 bg-slate-50/80 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <span className="text-center">RANK</span>
            <span>Team</span>
              <span className="text-right">W-L</span>
              <span />
            </div>
            {(standings?.rows ?? []).map((r, i) => {
              const mine = isMine(r.rosterId, r.team);
              const logo = logoBySlot.get(r.rosterId) ?? r.avatar ?? null;
              return (
                <Link
                  key={r.rosterId}
                  to="/team/$teamId"
                  params={{ teamId: String(r.rosterId) }}
                  className={cn(
                    "grid grid-cols-[1.75rem_1fr_3.25rem_1rem] items-center gap-1 border-t border-border/70 px-2 py-1.5 text-xs transition-colors hover:bg-blue-50/60",
                    mine && "bg-blue-50/80",
                  )}
                >
                  <span
                    className={cn(
                      "tabnum",
                      mine ? "font-bold text-blue-600" : "text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 items-center">
                    <TeamAvatarBadge
                      name={r.team}
                      logo={logo}
                      platform={activeLeague.platform}
                      cacheKey={`${activeLeague.id}-${r.rosterId}`}
                    />
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block truncate font-medium",
                          mine ? "text-blue-700" : "text-zinc-900",
                        )}
                      >
                        {r.team}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {r.owner}
                      </span>
                    </span>
                  </span>
                  <span
                    className={cn(
                      "tabnum text-right",
                      mine ? "font-semibold text-blue-700" : "text-zinc-800",
                    )}
                  >
                    {r.wins}-{r.losses}
                    {r.ties > 0 ? `-${r.ties}` : ""}
                  </span>
                  <ChevronRight
                    className="h-3.5 w-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              );
            })}
          </div>

          <Link
            to="/account/leagues"
            className={cn(
              "mt-3 inline-flex w-full items-center justify-center rounded-md border border-blue-600",
              "bg-transparent px-3.5 py-2 text-sm font-medium text-blue-600",
              "transition-colors hover:bg-blue-600 hover:text-white",
            )}
          >
            Manage My Leagues
          </Link>
        </section>
      )}
    </>
  );
}
