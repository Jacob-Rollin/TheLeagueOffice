import { TeamAvatarBadge } from "@/components/playbook/panels";
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
  /** Cache namespace for avatar remounts (e.g. league link id). */
  leagueKey?: string;
};

function formatRecord(wins: number, losses: number, ties: number) {
  if (ties > 0) return `${wins}-${losses}-${ties}`;
  return `${wins}-${losses}`;
}

function winPercentage(wins: number, losses: number, ties: number): number {
  const games = wins + losses + ties;
  if (games <= 0) return 0;
  return (wins / games) * 100;
}

/**
 * Playbook Actual-style standings: Rank / Team / W-L / PF / PA / Win %.
 * Dark highlight for the viewer's team; dashed playoff cut under the last seed.
 * Trend / Streak / analytics columns are omitted (native has no power-rank data yet).
 */
export function FantasyStandingsTable({
  rows,
  playoffTeams,
  myTeamId,
  className,
  leagueKey = "native",
}: FantasyStandingsTableProps) {
  const cut =
    playoffTeams > 0 && playoffTeams < rows.length ? Math.floor(playoffTeams) : null;

  return (
    <div className={cn("overflow-x-auto overflow-y-hidden", className)}>
      <div className="min-w-[720px]">
        <div className="flex items-center justify-between border-b border-border bg-slate-50/50 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 select-none">
          <div className="flex min-w-0 flex-1 items-center">
            <span className="w-12 text-center">Rank</span>
            <span className="pl-6">Team</span>
          </div>
          <div className="flex shrink-0 items-center space-x-10 pr-2">
            <span className="w-20 text-center">W-L</span>
            <span className="w-16 text-right">PF</span>
            <span className="w-16 text-right">PA</span>
            <span className="w-16 text-right">Win %</span>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No standings available for this league yet.
          </p>
        ) : (
          <ul>
            {rows.map((row, index) => {
              const rank = row.rank ?? index + 1;
              const mine = myTeamId != null && row.teamId === myTeamId;
              const pctLabel = `${winPercentage(row.wins, row.losses, row.ties).toFixed(1)}%`;
              const belowCut = cut != null && rank === cut + 1;

              return (
                <li
                  key={row.teamId}
                  className={cn(
                    "relative border-t",
                    belowCut ? "border-dashed border-emerald-400" : "border-border",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center justify-between px-4 py-2.5",
                      mine
                        ? "bg-slate-700 text-white font-black rounded-none"
                        : "bg-white text-slate-800 hover:bg-slate-50/60",
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-center">
                      <span
                        className={cn(
                          "w-12 text-center text-sm font-semibold tabular-nums",
                          mine
                            ? "text-white"
                            : cut == null
                              ? "text-slate-500"
                              : rank > cut
                                ? "text-slate-400"
                                : "text-slate-900",
                        )}
                      >
                        {rank}
                      </span>
                      <div
                        className={cn(
                          "flex min-w-0 flex-1 items-center pl-6",
                          mine ? "text-white" : "text-foreground",
                        )}
                      >
                        <TeamAvatarBadge
                          key={`${leagueKey}-${row.teamId}-${row.avatarUrl ?? "fallback"}`}
                          name={row.teamName}
                          logo={row.avatarUrl}
                          platform="native"
                          cacheKey={`${leagueKey}-${row.teamId}`}
                        />
                        <span className="min-w-0">
                          <span
                            className={cn(
                              "block truncate text-sm",
                              mine ? "font-black text-white" : "font-medium text-foreground",
                            )}
                          >
                            {row.teamName}
                          </span>
                          <span
                            className={cn(
                              "block truncate text-xs",
                              mine ? "font-bold text-white/80" : "text-muted-foreground",
                            )}
                          >
                            {row.owner?.trim() || "Owner"}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "flex shrink-0 items-center space-x-10 pr-2 select-none text-sm tabular-nums",
                        mine ? "font-semibold text-white" : "font-semibold text-foreground",
                      )}
                    >
                      <span className="w-20 text-center">
                        {formatRecord(row.wins, row.losses, row.ties)}
                      </span>
                      <span className="w-16 text-right">{row.pointsFor.toFixed(1)}</span>
                      <span
                        className={cn(
                          "w-16 text-right font-normal",
                          mine ? "text-white/80" : "text-slate-500",
                        )}
                      >
                        {row.pointsAgainst.toFixed(1)}
                      </span>
                      <span className="w-16 text-right">{pctLabel}</span>
                    </div>
                  </div>
                  {belowCut ? (
                    <span
                      className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-[9px] font-black uppercase leading-none tracking-widest text-emerald-600"
                      aria-label="Playoff line"
                    >
                      Playoff Line
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export { formatRecord as fantasyStandingsRecord };
