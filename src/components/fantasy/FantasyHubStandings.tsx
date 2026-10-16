import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";

import { TeamAvatarBadge } from "@/components/playbook/panels";
import { useAuth } from "@/hooks/useAuth";
import { getNativeLeagueBoard, getNativeStandings } from "@/lib/native-league.functions";
import { cn } from "@/lib/utils";

function formatRecord(wins: number, losses: number, ties: number) {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

/** Slim Rank / Team / W-L standings for the Fantasy Home right rail. */
export function FantasyHubStandings({ linkId }: { linkId: string }) {
  const { user } = useAuth();

  const { data: board } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["native-standings", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 30_000,
    queryFn: () => getNativeStandings({ data: { linkId } }),
  });

  const myTeamId = board?.summary.teamId ?? null;
  const avatarById = useMemo(
    () => new Map((board?.teams ?? []).map((t) => [t.id, t.avatarUrl])),
    [board?.teams],
  );

  const rows = useMemo(() => {
    const list = [...(data?.standings ?? [])].sort(
      (a, b) =>
        (a.rank ?? 0) - (b.rank ?? 0) ||
        b.wins - a.wins ||
        b.pointsFor - a.pointsFor ||
        a.teamId - b.teamId,
    );
    return list.slice(0, 8);
  }, [data?.standings]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-slate-900">
          Standings
        </h2>
        <Link
          to="/league/$linkId/standings"
          params={{ linkId }}
          className="text-[11px] font-medium text-blue-700 hover:underline"
        >
          Full table
        </Link>
      </div>

      {isLoading ? (
        <p className="px-3 py-5 text-sm text-slate-500">Loading standings…</p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-5 text-sm text-slate-600">Standings not available yet.</p>
      ) : (
        <div>
          <div className="grid grid-cols-[2.25rem_1fr_3.25rem_1rem] items-center gap-1 bg-slate-50/80 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <span className="text-center">Rank</span>
            <span>Team</span>
            <span className="text-right">W-L</span>
            <span />
          </div>
          {rows.map((row, index) => {
            const rank = row.rank ?? index + 1;
            const mine = myTeamId != null && row.teamId === myTeamId;
            return (
              <Link
                key={row.teamId}
                to="/league/$linkId/standings"
                params={{ linkId }}
                className={cn(
                  "grid grid-cols-[2.25rem_1fr_3.25rem_1rem] items-center gap-1 border-t border-border/70 px-2 py-1.5 text-xs transition-colors hover:bg-blue-50/60",
                  mine && "bg-blue-50/80",
                )}
              >
                <span
                  className={cn(
                    "text-center tabular-nums",
                    mine ? "font-bold text-blue-600" : "text-muted-foreground",
                  )}
                >
                  {rank}
                </span>
                <span className="flex min-w-0 items-center">
                  <TeamAvatarBadge
                    name={row.teamName}
                    logo={avatarById.get(row.teamId) ?? null}
                    platform="native"
                    cacheKey={`${linkId}-${row.teamId}`}
                  />
                  <span
                    className={cn(
                      "min-w-0 truncate font-medium",
                      mine ? "text-blue-700" : "text-zinc-900",
                    )}
                  >
                    {row.teamName}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-right tabular-nums",
                    mine ? "font-semibold text-blue-700" : "text-zinc-800",
                  )}
                >
                  {formatRecord(row.wins, row.losses, row.ties)}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
