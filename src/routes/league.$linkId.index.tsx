import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { getNativeLeagueBoard } from "@/lib/native-league.functions";

export const Route = createFileRoute("/league/$linkId/")({
  ssr: false,
  component: NativeLeagueDashboard,
});

const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground";
const outlineClass =
  "rounded-md border border-border bg-white px-4 py-2 font-display text-sm uppercase tracking-wide text-slate-800";

function NativeLeagueDashboard() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const { data: board } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });

  if (!board) return null;
  const { summary, canManage, teams, currentWeek, weekMatchups, rosters, ownership } = board;
  const draftDone = summary.draftStatus === "complete";
  const liveDeferred = summary.draftMode === "live" && !draftDone;
  const myTeamId = summary.teamId;
  const myRoster = myTeamId != null ? rosters.find((r) => r.teamId === myTeamId) : null;
  const myTeam = myTeamId != null ? teams.find((t) => t.id === myTeamId) : null;
  const teamName = (id: number) => teams.find((t) => t.id === id)?.teamName ?? `Team ${id}`;
  const myMatchup =
    myTeamId == null
      ? null
      : weekMatchups.find((m) => m.homeTeamId === myTeamId || m.awayTeamId === myTeamId) ?? null;
  const ownedCount = Object.keys(ownership).length;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Next Steps</h2>
        {!draftDone ? (
          <>
            <p className="mt-2 text-sm text-slate-600">
              {liveDeferred
                ? "Live snake draft UI ships next — until then, use Offline entry on the Draft tab to assign picks from an external draft."
                : "Use the Draft tab to enter picks from your offline / external draft, then complete the draft to start the season."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/league/$linkId/draft" params={{ linkId }} className={buttonClass}>
                Open Draft
              </Link>
              {canManage ? (
                <Link to="/league/$linkId/teams" params={{ linkId }} className={outlineClass}>
                  Manage Teams
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">
              Draft complete — week {currentWeek} is live. Set your lineup, claim waivers, and propose
              trades from the league tabs.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/league/$linkId/my-team" params={{ linkId }} className={buttonClass}>
                Set Lineup
              </Link>
              <Link to="/league/$linkId/waivers" params={{ linkId }} className={outlineClass}>
                Waivers
              </Link>
              <Link to="/league/$linkId/trades" params={{ linkId }} className={outlineClass}>
                Trades
              </Link>
              <Link to="/league/$linkId/players" params={{ linkId }} className={outlineClass}>
                League Players
              </Link>
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">League Snapshot</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Scoring</dt>
            <dd className="font-medium capitalize text-slate-900">{summary.scoringPreset}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Draft mode</dt>
            <dd className="font-medium capitalize text-slate-900">{summary.draftMode}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Invite code</dt>
            <dd className="font-mono font-medium tracking-wide text-slate-900">{summary.inviteCode}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Filled seats</dt>
            <dd className="font-medium text-slate-900">
              {summary.filledTeams}/{summary.teamCount}
            </dd>
          </div>
          {draftDone ? (
            <>
              <div>
                <dt className="text-muted-foreground">Current week</dt>
                <dd className="font-medium text-slate-900">Week {currentWeek}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Rostered players</dt>
                <dd className="font-medium text-slate-900">{ownedCount}</dd>
              </div>
            </>
          ) : null}
        </dl>
        <ul className="mt-4 space-y-1 text-sm text-slate-700">
          {teams.slice(0, 6).map((t) => (
            <li key={t.id} className="flex justify-between gap-2 border-t border-border py-1.5">
              <span className="truncate font-medium">{t.teamName}</span>
              <span className="shrink-0 text-muted-foreground">{t.userId ? "Claimed" : "Open"}</span>
            </li>
          ))}
          {teams.length > 6 ? (
            <li className="pt-1 text-xs text-muted-foreground">+{teams.length - 6} more teams</li>
          ) : null}
        </ul>
      </section>

      {draftDone ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">My Roster</h2>
            {myTeam && myRoster ? (
              <>
                <p className="mt-2 text-sm text-slate-600">
                  {myTeam.teamName} · {myRoster.playerIds.length} players
                </p>
                <Link
                  to="/league/$linkId/my-team"
                  params={{ linkId }}
                  className={`${outlineClass} mt-4 inline-flex`}
                >
                  Edit Lineup
                </Link>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-600">No team seat linked to your account.</p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
              Week {currentWeek} Matchup
            </h2>
            {myMatchup ? (
              <p className="mt-2 text-base font-semibold text-slate-900">
                {teamName(myMatchup.homeTeamId)}{" "}
                <span className="font-normal text-muted-foreground">vs</span>{" "}
                {teamName(myMatchup.awayTeamId)}
              </p>
            ) : weekMatchups.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {weekMatchups.slice(0, 6).map((m) => (
                  <li key={m.matchupId} className="border-t border-border py-1.5">
                    {teamName(m.homeTeamId)} vs {teamName(m.awayTeamId)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-600">
                Schedule not generated yet — complete the draft to build week pairings.
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
