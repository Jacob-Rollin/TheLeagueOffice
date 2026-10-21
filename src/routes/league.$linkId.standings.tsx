import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  FantasyBoard,
  FantasyStandingsTable,
  type FantasyStandingsRow,
} from "@/components/native/fantasy";
import { useAuth } from "@/hooks/useAuth";
import { getNativeLeagueBoard, getNativeStandings } from "@/lib/native-league.functions";

export const Route = createFileRoute("/league/$linkId/standings")({
  ssr: false,
  component: NativeStandingsPage,
});

function NativeStandingsPage() {
  const { linkId } = Route.useParams();
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

  const playoffTeams =
    board?.commissioner.playoffTeams ??
    (board && board.summary.teamCount >= 10 ? 6 : 4);

  const myTeamId = board?.summary.teamId ?? null;

  const rows = useMemo((): FantasyStandingsRow[] => {
    const avatarById = new Map((board?.teams ?? []).map((t) => [t.id, t.avatarUrl]));
    const list = [...(data?.standings ?? [])].sort(
      (a, b) =>
        (a.rank ?? 0) - (b.rank ?? 0) ||
        b.wins - a.wins ||
        b.pointsFor - a.pointsFor ||
        a.teamId - b.teamId,
    );
    return list.map((r) => ({
      teamId: r.teamId,
      teamName: r.teamName,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      rank: r.rank,
      avatarUrl: avatarById.get(r.teamId) ?? null,
    }));
  }, [board?.teams, data?.standings]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="display-title text-2xl text-slate-900">
          League <span className="text-primary">Standings</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data
            ? `Through week ${data.week}`
            : "Standings update after scoring cron runs."}
        </p>
      </div>

      <FantasyBoard
        title="Season standings"
        bodyClassName="p-0"
        action={
          playoffTeams > 0 ? (
            <span className="text-xs text-muted-foreground">
              Top {playoffTeams} make playoffs
            </span>
          ) : null
        }
      >
        {isLoading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading standings…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No standings yet. Complete the draft to start the season.
          </p>
        ) : (
          <FantasyStandingsTable
            rows={rows}
            playoffTeams={playoffTeams}
            myTeamId={myTeamId}
            leagueKey={linkId}
          />
        )}
      </FantasyBoard>
    </div>
  );
}
