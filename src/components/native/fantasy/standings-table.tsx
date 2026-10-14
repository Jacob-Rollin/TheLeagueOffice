import { Fragment } from "react";

import { LeagueAvatar } from "@/components/league/LeagueAvatar";
import { cn } from "@/lib/utils";

export type FantasyStandingsRow = {
  teamId: number;
  teamName: string;
  owner?: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  avatarUrl?: string | null;
  /** When omitted, rows are ranked in array order (1-based). */
  rank?: number;
};

type FantasyStandingsTableProps = {
  rows: FantasyStandingsRow[];
  playoffTeams: number;
  myTeamId?: number | null;
  className?: string;
};

function formatRecord(wins: number, losses: number, ties: number) {
  return `${wins}-${losses}${ties > 0 ? `-${ties}` : ""}`;
}

export function FantasyStandingsTable({
  rows,
  playoffTeams,
  myTeamId,
  className,
}: FantasyStandingsTableProps) {
  const cut = Math.max(0, Math.floor(playoffTeams));

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <th className="sticky left-0 z-20 bg-white px-3 py-2 font-semibold">Rk</th>
            <th className="px-3 py-2 font-semibold">Team</th>
            <th className="px-3 py-2 font-semibold">W</th>
            <th className="px-3 py-2 font-semibold">L</th>
            <th className="px-3 py-2 font-semibold">T</th>
            <th className="px-3 py-2 font-semibold">PF</th>
            <th className="px-3 py-2 font-semibold">PA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rank = row.rank ?? index + 1;
            const mine = myTeamId != null && row.teamId === myTeamId;
            const seed = cut > 0 && index < cut;
            const showCutLine = cut > 0 && index === cut;

            return (
              <Fragment key={row.teamId}>
                {showCutLine ? (
                  <tr aria-hidden>
                    <td colSpan={7} className="relative h-0 p-0">
                      <div className="absolute inset-x-0 top-0 z-10 flex -translate-y-1/2 items-center px-3">
                        <span className="flex-1 border-t-2 border-dashed border-accent" />
                        <span className="rounded-full bg-white px-2 font-display text-[10px] font-bold uppercase leading-none tracking-widest text-accent">
                          Playoff line
                        </span>
                        <span className="flex-1 border-t-2 border-dashed border-accent" />
                      </div>
                    </td>
                  </tr>
                ) : null}
                <tr
                  className={cn(
                    "border-b border-slate-50",
                    mine && "bg-primary/5",
                    showCutLine && "border-t-0",
                  )}
                >
                  <td
                    className={cn(
                      "sticky left-0 z-10 px-3 py-2",
                      mine ? "bg-primary/5" : "bg-white",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex size-7 items-center justify-center rounded-full font-display text-sm font-bold tabular-nums",
                        seed ? "bg-primary text-primary-foreground" : "text-slate-500",
                      )}
                    >
                      {rank}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      {row.avatarUrl ? (
                        <LeagueAvatar
                          platform="native"
                          src={row.avatarUrl}
                          alt=""
                          className="size-8 max-h-8 max-w-8"
                        />
                      ) : null}
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "block truncate font-medium text-slate-900",
                            mine && "text-primary",
                          )}
                        >
                          {row.teamName}
                        </span>
                        {row.owner ? (
                          <span className="block truncate text-xs text-muted-foreground">{row.owner}</span>
                        ) : null}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{row.wins}</td>
                  <td className="px-3 py-2 tabular-nums">{row.losses}</td>
                  <td className="px-3 py-2 tabular-nums">{row.ties}</td>
                  <td className="px-3 py-2 tabular-nums">{row.pointsFor.toFixed(1)}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {row.pointsAgainst.toFixed(1)}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { formatRecord as fantasyStandingsRecord };
