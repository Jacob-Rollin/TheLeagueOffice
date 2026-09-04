import { Link } from "@tanstack/react-router";
import { ChevronRight, LayoutGrid } from "lucide-react";

import { LeagueEmptyState } from "@/components/league/LeagueGate";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { platformLabel } from "@/lib/league-link";
import { cn } from "@/lib/utils";

/** Active league standings sidebar shared by the homepage and article reader. */
export function StandingsPanel() {
  const { activeLeague, standings, loading: standingsLoading } = useActiveStandings();

  return (
    <>
      {!activeLeague && (
        <LeagueEmptyState className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center" />
      )}
      {activeLeague && !standings && (
        <section className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {standingsLoading ? "Loading standings…" : "Standings unavailable for this league."}
        </section>
      )}
      {activeLeague && standings && (
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="display-title min-w-0 truncate text-lg text-black">
              {(standings?.league?.name ?? activeLeague?.name ?? "").toUpperCase()}{" "}
              <span className="text-muted-foreground">
                [{platformLabel(activeLeague?.platform).toUpperCase()}]
              </span>
            </h2>
            <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
              {standings?.league?.season ?? ""}
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-[2rem_1fr_4rem_1rem] items-center gap-1 bg-surface px-1 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>#</span>
              <span>Team</span>
              <span className="text-right">W-L</span>
              <span />
            </div>
            {(standings?.rows ?? []).map((r, i) => (
              <Link
                key={r.rosterId}
                to="/team/$teamId"
                params={{ teamId: String(r.rosterId) }}
                className={cn(
                  "grid grid-cols-[2rem_1fr_4rem_1rem] items-center gap-1 border-t border-border px-1 py-1.5 text-xs transition-colors hover:bg-muted/60",
                  i < 4 && "bg-primary/5",
                )}
              >
                <span className="tabnum text-muted-foreground">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.team}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{r.owner}</span>
                </span>
                <span className="tabnum text-right">
                  {r.wins}-{r.losses}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </Link>
            ))}
          </div>
          <Link
            to="/account/leagues"
            className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 py-2 text-xs font-bold uppercase tracking-wider text-foreground transition-all hover:bg-muted/70"
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            Manage My Leagues
          </Link>
        </section>
      )}
    </>
  );
}
