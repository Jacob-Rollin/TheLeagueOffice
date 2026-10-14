import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  FantasyActivityList,
  type FantasyActivityItem,
  FantasyBoard,
  FantasyMatchupScoreCard,
  FantasyStandingsTable,
  type FantasyStandingsRow,
  fantasyOutlineBtn,
  fantasyPrimaryBtn,
} from "@/components/native/fantasy";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  fetchNativeLiveWeekStats,
  overlayNativeLiveMatchupScores,
} from "@/lib/native-live-scoring";
import {
  getNativeLeagueBoard,
  getNativeMatchupWeek,
  getNativeStandings,
  listNativeTransactions,
  setNativeLeagueWeek,
} from "@/lib/native-league.functions";
import { visibleRefetchInterval } from "@/lib/page-visibility";
import type { Player } from "@/lib/players-build";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import type { ScoringMap } from "@/lib/scoring-map";

export const Route = createFileRoute("/league/$linkId/")({
  ssr: false,
  component: NativeLeagueDashboard,
});

const LIVE_STATS_POLL_MS = 60_000;

type NativeBoard = NonNullable<Awaited<ReturnType<typeof getNativeLeagueBoard>>>;

function NativeLeagueDashboard() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const modalRef = useRef<PlayerModalHandle>(null);

  const { data: board } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });

  if (!board) return null;

  return <NativeLeagueDashboardBody board={board} linkId={linkId} userId={user?.id ?? null} />;
}

function NativeLeagueDashboardBody({
  board,
  linkId,
  userId,
}: {
  board: NativeBoard;
  linkId: string;
  userId: string | null;
}) {
  const queryClient = useQueryClient();
  const [weekBusy, setWeekBusy] = useState(false);
  const [jumpWeek, setJumpWeek] = useState<number | "">("");

  const { summary, canManage, teams, currentWeek, weekMatchups, ownership, commissioner } = board;
  const draftDone = summary.draftStatus === "complete";
  const liveDeferred = summary.draftMode === "live" && !draftDone;
  const myTeamId = summary.teamId;
  const ownedCount = Object.keys(ownership).length;
  const seasonStart = Math.max(1, Number(commissioner.seasonStartWeek ?? 1) || 1);
  const maxJump = 18;
  const playoffTeams =
    commissioner.playoffTeams ?? (summary.teamCount >= 10 ? 6 : 4);

  const { data: standingsPayload } = useQuery({
    queryKey: ["native-standings", linkId],
    enabled: Boolean(draftDone && userId && linkId),
    staleTime: 30_000,
    queryFn: () => getNativeStandings({ data: { linkId } }),
  });

  const { data: matchupWeek } = useQuery({
    queryKey: ["native-matchup-week", linkId, currentWeek],
    enabled: Boolean(draftDone && userId && linkId),
    staleTime: 30_000,
    queryFn: () => getNativeMatchupWeek({ data: { linkId, week: currentWeek } }),
  });

  const seasonYear =
    matchupWeek?.seasonYear ?? summary.seasonYear ?? new Date().getUTCFullYear();

  const liveStats = useQuery({
    queryKey: ["native-live-week-stats", seasonYear, currentWeek],
    enabled: Boolean(draftDone && matchupWeek),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: visibleRefetchInterval(LIVE_STATS_POLL_MS),
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: () => fetchNativeLiveWeekStats(seasonYear, currentWeek),
  });

  const scoredMatchups = useMemo(() => {
    const base = matchupWeek?.matchups ?? [];
    const stats = liveStats.data?.stats;
    const starters = matchupWeek?.startersByTeamId ?? {};
    const scoring = (matchupWeek?.scoringSettings ?? {}) as ScoringMap;
    if (!stats || Object.keys(stats).length === 0) return base;
    return overlayNativeLiveMatchupScores(base, starters, stats, scoring);
  }, [
    matchupWeek?.matchups,
    matchupWeek?.startersByTeamId,
    matchupWeek?.scoringSettings,
    liveStats.data?.stats,
  ]);

  const liveActive = Boolean(
    liveStats.data && Object.keys(liveStats.data.stats).length > 0,
  );

  const myMatchupScored = useMemo(() => {
    if (myTeamId == null) return null;
    return (
      scoredMatchups.find(
        (m) => m.home.teamId === myTeamId || m.away.teamId === myTeamId,
      ) ?? null
    );
  }, [scoredMatchups, myTeamId]);

  const recordByTeam = useMemo(() => {
    const map = new Map<number, { wins: number; losses: number; ties: number }>();
    for (const r of standingsPayload?.standings ?? []) {
      map.set(r.teamId, { wins: r.wins, losses: r.losses, ties: r.ties });
    }
    return map;
  }, [standingsPayload?.standings]);

  const standingsRows = useMemo((): FantasyStandingsRow[] => {
    const avatarById = new Map(teams.map((t) => [t.id, t.avatarUrl]));
    const list = [...(standingsPayload?.standings ?? [])].sort(
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
  }, [standingsPayload?.standings, teams]);

  const compactStandings = standingsRows.slice(0, 6);

  const cache = useSleeperPlayers();
  const catalogFallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const playersById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of cache.data?.players ?? catalogFallback.data?.players ?? []) {
      map.set(p.id, p);
    }
    return map;
  }, [cache.data?.players, catalogFallback.data?.players]);
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, p] of playersById) map.set(id, p.name);
    return map;
  }, [playersById]);

  const { data: recentTx } = useQuery({
    queryKey: ["native-transactions", linkId, "dashboard"],
    enabled: Boolean(draftDone && userId && linkId),
    staleTime: 15_000,
    queryFn: () => listNativeTransactions({ data: { linkId, limit: 12 } }),
  });

  const activityItems = (recentTx ?? []) as FantasyActivityItem[];

  const refreshBoard = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["native-draft-state", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["native-matchup-week", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["native-matchup", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["native-standings", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["native-transactions", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["active-standings"] }),
    ]);
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

  const teamName = (id: number) => teams.find((t) => t.id === id)?.teamName ?? `Team ${id}`;

  const sideWithRecord = (side: { teamId: number; teamName: string; points: number }) => {
    const rec = recordByTeam.get(side.teamId);
    return {
      teamId: side.teamId,
      teamName: side.teamName,
      points: side.points,
      ...(rec
        ? { wins: rec.wins, losses: rec.losses, ties: rec.ties }
        : {}),
    };
  };

  if (!draftDone) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Toaster />
        <FantasyBoard title="Next Steps" bodyClassName="p-5">
          <p className="text-sm text-slate-600">
            {liveDeferred
              ? "Live snake draft UI ships next — until then, use Offline entry on the Draft tab to assign picks from an external draft."
              : "Use the Draft tab to enter picks from your offline / external draft, then complete the draft to start the season. Or seed rosters manually on Teams."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/league/$linkId/draft" params={{ linkId }} className={fantasyPrimaryBtn}>
              Open Draft
            </Link>
            {canManage ? (
              <Link to="/league/$linkId/teams" params={{ linkId }} className={fantasyOutlineBtn}>
                Manage Teams
              </Link>
            ) : null}
          </div>
        </FantasyBoard>

        <FantasyBoard title="League Snapshot" bodyClassName="p-5">
          <dl className="grid grid-cols-2 gap-3 text-sm">
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
              <dd className="font-mono font-medium tracking-wide text-slate-900">
                {summary.inviteCode}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Filled seats</dt>
              <dd className="font-medium text-slate-900">
                {summary.filledTeams}/{summary.teamCount}
              </dd>
            </div>
          </dl>
          <ul className="mt-4 space-y-1 text-sm text-slate-700">
            {teams.slice(0, 6).map((t) => (
              <li key={t.id} className="flex justify-between gap-2 border-t border-border py-1.5">
                <span className="truncate font-medium">{t.teamName}</span>
                <span className="shrink-0 text-muted-foreground">
                  {t.userId ? "Claimed" : "Open"}
                </span>
              </li>
            ))}
            {teams.length > 6 ? (
              <li className="pt-1 text-xs text-muted-foreground">
                +{teams.length - 6} more teams
              </li>
            ) : null}
          </ul>
        </FantasyBoard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Toaster />
      <PlayerModalHost ref={modalRef} />

      {myMatchupScored ? (
        <FantasyMatchupScoreCard
          home={sideWithRecord(myMatchupScored.home)}
          away={sideWithRecord(myMatchupScored.away)}
          myTeamId={myTeamId}
          status={liveActive ? "live" : null}
          weekLabel={
            <span className="font-display text-xs font-bold uppercase tracking-widest text-slate-500">
              Week {currentWeek}
            </span>
          }
        />
      ) : (
        <FantasyBoard bodyClassName="px-4 py-5">
          <p className="text-sm text-slate-600">
            {weekMatchups.length > 0
              ? `No matchup linked to your team for week ${currentWeek}.`
              : "Schedule not generated yet — complete the draft to build week pairings."}
          </p>
          {weekMatchups.length > 0 && myTeamId == null ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Claim a team seat to see your weekly matchup here.
            </p>
          ) : null}
          {weekMatchups.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-slate-700">
              {weekMatchups.slice(0, 4).map((m) => (
                <li key={m.matchupId} className="border-t border-border py-1.5">
                  {teamName(m.homeTeamId)} vs {teamName(m.awayTeamId)}
                </li>
              ))}
            </ul>
          ) : null}
        </FantasyBoard>
      )}

      {liveActive && liveStats.data?.updatedAt ? (
        <p className="text-xs text-muted-foreground">
          Live scores as of {new Date(liveStats.data.updatedAt).toLocaleString()}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link to="/league/$linkId/my-team" params={{ linkId }} className={fantasyPrimaryBtn}>
          My Team
        </Link>
        <Link to="/league/$linkId/players" params={{ linkId }} className={fantasyOutlineBtn}>
          Players
        </Link>
        <Link to="/league/$linkId/waivers" params={{ linkId }} className={fantasyOutlineBtn}>
          Waivers
        </Link>
        <Link to="/league/$linkId/trades" params={{ linkId }} className={fantasyOutlineBtn}>
          Trades
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FantasyBoard
          title="Standings"
          bodyClassName="p-0"
          action={
            <Link
              to="/league/$linkId/standings"
              params={{ linkId }}
              className="text-xs font-medium text-blue-700 hover:underline"
            >
              Full table
            </Link>
          }
        >
          {compactStandings.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted-foreground">Standings not available yet.</p>
          ) : (
            <FantasyStandingsTable
              rows={compactStandings}
              playoffTeams={playoffTeams}
              myTeamId={myTeamId}
            />
          )}
        </FantasyBoard>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-900">
              Recent activity
            </h3>
            <Link
              to="/league/$linkId/transactions"
              params={{ linkId }}
              className="text-xs font-medium text-blue-700 hover:underline"
            >
              All transactions
            </Link>
          </div>
          <FantasyActivityList
            items={activityItems}
            playersById={playersById}
            resolveName={(id) => (id ? (nameById.get(id) ?? id) : null)}
            onOpenPlayer={(id) => modalRef.current?.open(id)}
            emptyMessage="No transactions yet."
          />
        </div>
      </div>

      {canManage ? (
        <FantasyBoard title="Commissioner Week Controls" bodyClassName="p-5">
          <p className="text-sm text-muted-foreground">
            Season started at week {seasonStart}. Advance to test the next week without replaying
            earlier matchups. AI lineups refresh automatically for AI seats.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Current week</dt>
              <dd className="font-medium text-slate-900">Week {currentWeek}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Rostered players</dt>
              <dd className="font-medium text-slate-900">{ownedCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Scoring</dt>
              <dd className="font-medium capitalize text-slate-900">{summary.scoringPreset}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Invite code</dt>
              <dd className="font-mono text-sm font-medium tracking-wide text-slate-900">
                {summary.inviteCode}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <button
              type="button"
              className={fantasyPrimaryBtn}
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
              className={fantasyOutlineBtn}
              disabled={weekBusy || jumpWeek === "" || jumpWeek === currentWeek}
              onClick={() => {
                if (typeof jumpWeek === "number") void advanceWeek(jumpWeek);
              }}
            >
              Set Week
            </button>
          </div>
        </FantasyBoard>
      ) : null}
    </div>
  );
}
