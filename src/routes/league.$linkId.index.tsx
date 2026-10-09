import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { getNativeLeagueBoard, setNativeLeagueWeek } from "@/lib/native-league.functions";

export const Route = createFileRoute("/league/$linkId/")({
  ssr: false,
  component: NativeLeagueDashboard,
});

const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";
const outlineClass =
  "rounded-md border border-border bg-white px-4 py-2 font-display text-sm uppercase tracking-wide text-slate-800 disabled:opacity-60";

function NativeLeagueDashboard() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [weekBusy, setWeekBusy] = useState(false);
  const [jumpWeek, setJumpWeek] = useState<number | "">("");

  const { data: board } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });

  if (!board) return null;
  const { summary, canManage, teams, currentWeek, weekMatchups, rosters, ownership, commissioner } =
    board;
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
  const seasonStart = Math.max(1, Number(commissioner.seasonStartWeek ?? 1) || 1);
  const maxJump = 18;

  const refreshBoard = async () => {
    await queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] });
    await queryClient.invalidateQueries({ queryKey: ["native-draft-state", linkId] });
    await queryClient.invalidateQueries({ queryKey: ["native-matchup", linkId] });
  };

  const advanceWeek = async (toWeek?: number) => {
    if (!canManage || weekBusy) return;
    setWeekBusy(true);
    try {
      const result = await setNativeLeagueWeek({
        data: {
          linkId,
          ...(toWeek != null ? { toWeek } : {}),
          runAiLineups: true,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const ai = result.aiLineups ?? 0;
      toast.success(
        ai > 0
          ? `Moved to week ${result.week}. AI lineups updated for ${ai} team(s).`
          : `Moved to week ${result.week}.`,
      );
      setJumpWeek("");
      await refreshBoard();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change week.");
    } finally {
      setWeekBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Toaster />
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Next Steps</h2>
        {!draftDone ? (
          <>
            <p className="mt-2 text-sm text-slate-600">
              {liveDeferred
                ? "Live snake draft UI ships next — until then, use Offline entry on the Draft tab to assign picks from an external draft."
                : "Use the Draft tab to enter picks from your offline / external draft, then complete the draft to start the season. Or seed rosters manually on Teams."}
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

      {draftDone && canManage ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
            Commissioner Week Controls
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Season started at week {seasonStart}. Advance to test the next week without replaying
            earlier matchups. AI lineups refresh automatically for AI seats.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <button
              type="button"
              className={buttonClass}
              disabled={weekBusy || currentWeek >= maxJump}
              onClick={() => void advanceWeek()}
            >
              {weekBusy ? "Updating…" : `Advance to Week ${Math.min(maxJump, currentWeek + 1)}`}
            </button>
            <label className="block text-sm font-medium text-slate-800">
              Jump to week
              <select
                className="mt-1 block min-w-[8rem] rounded-md border border-border px-3 py-2 text-sm"
                value={jumpWeek === "" ? "" : String(jumpWeek)}
                disabled={weekBusy}
                onChange={(e) =>
                  setJumpWeek(e.target.value === "" ? "" : Number(e.target.value))
                }
              >
                <option value="">Select…</option>
                {Array.from({ length: maxJump - seasonStart + 1 }, (_, i) => seasonStart + i).map(
                  (w) => (
                    <option key={w} value={w} disabled={w === currentWeek}>
                      Week {w}
                    </option>
                  ),
                )}
              </select>
            </label>
            <button
              type="button"
              className={outlineClass}
              disabled={weekBusy || jumpWeek === "" || jumpWeek === currentWeek}
              onClick={() => {
                if (typeof jumpWeek === "number") void advanceWeek(jumpWeek);
              }}
            >
              Set Week
            </button>
          </div>
        </section>
      ) : null}

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
