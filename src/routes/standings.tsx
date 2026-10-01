import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { StreakIndicator } from "@/components/league/StreakIndicator";
import { PlaybookShell } from "@/components/playbook/PlaybookShell";
import {
  playbookPanelTitleClass,
  powerRankMovementDelta,
  resolvePowerRankDisplayBaseline,
  TeamAvatarBadge,
  TruePowerRankingsPanel,
} from "@/components/playbook/panels";
import { StartingSlotRanks, type SlotRankTeamMeta } from "@/components/standings/StartingSlotRanks";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { type RowAnalytics, useLeagueAnalytics, useStartingSlotRanks } from "@/hooks/useLeagueAnalytics";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { cn } from "@/lib/utils";

type StandingsTab = "actual" | "all-play" | "power";

type StandingsSearch = {
  tab: StandingsTab;
};

const TABS: { id: StandingsTab; label: string }[] = [
  { id: "actual", label: "Actual" },
  { id: "all-play", label: "All Play" },
  { id: "power", label: "Power Rankings" },
];

function parseStandingsTab(raw: unknown): StandingsTab {
  if (raw === "all-play" || raw === "allplay" || raw === "all_play") return "all-play";
  if (raw === "power" || raw === "power-rankings" || raw === "rankings") return "power";
  return "actual";
}

export const Route = createFileRoute("/standings")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): StandingsSearch => ({
    tab: parseStandingsTab(search["tab"]),
  }),
  head: () => ({
    meta: [{ title: "Standings — The League Office" }],
  }),
  component: StandingsPage,
});

type DisplayRow = {
  rosterId: number;
  team: string;
  owner: string;
  logo: string | null;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  streak: string | null;
  pointsFor?: number | null;
  pointsAgainst?: number | null;
  isMine: boolean;
};

type Tone = "good" | "warn" | "bad" | null;

/** Lighter shades on the highlighted (dark) row so colored stats stay readable. */
function toneClass(tone: Tone, highlighted: boolean): string {
  if (tone === "good") return highlighted ? "text-emerald-300" : "text-emerald-600";
  if (tone === "warn") return highlighted ? "text-amber-300" : "text-amber-600";
  if (tone === "bad") return highlighted ? "text-rose-300" : "text-rose-600";
  return "";
}

/** Top ~30% green, bottom ~30% red. */
function rankTone(rank: number | null, teams: number): Tone {
  if (rank == null || teams < 3) return null;
  const band = Math.ceil(teams * 0.3);
  if (rank <= band) return "good";
  if (rank > teams - band) return "bad";
  return null;
}

function playoffTone(pct: number | null): Tone {
  if (pct == null) return null;
  return pct >= 60 ? "good" : pct >= 20 ? "warn" : "bad";
}

/** Relative to an even share of the title (10% in a 10-team league). */
function titleTone(pct: number | null, teams: number): Tone {
  if (pct == null || teams <= 0) return null;
  const even = 100 / teams;
  return pct >= even * 2 ? "good" : pct >= even / 2 ? "warn" : "bad";
}

function formatRecord(wins: number, losses: number, ties: number): string {
  if (ties > 0) return `${wins}-${losses}-${ties}`;
  return `${wins}-${losses}`;
}

function winPercentage(wins: number, losses: number, ties: number): number {
  const games = wins + losses + ties;
  if (games <= 0) return 0;
  return (wins / games) * 100;
}

function trendPresentation(
  delta: number | null,
  highlighted: boolean,
): { label: string; className: string } {
  if (delta == null || delta === 0) {
    return {
      label: "—",
      className: highlighted
        ? "text-xs font-semibold tabular-nums text-white/70"
        : "text-xs font-semibold tabular-nums text-slate-400",
    };
  }
  if (delta > 0) {
    return {
      label: `▲ ${delta}`,
      className: highlighted
        ? "text-xs font-semibold tabular-nums text-emerald-200"
        : "text-xs font-semibold tabular-nums text-emerald-600",
    };
  }
  return {
    label: `▼ ${Math.abs(delta)}`,
    className: highlighted
      ? "text-xs font-semibold tabular-nums text-rose-200"
      : "text-xs font-semibold tabular-nums text-rose-600",
  };
}

function StandingsTable({
  rows,
  loading,
  winPctDigits,
  highlightClass,
  baseline,
  leagueKey,
  platform,
  showPoints = false,
  analytics,
  analyticsLoading = false,
  playoffCut = null,
}: {
  rows: DisplayRow[];
  loading: boolean;
  winPctDigits: 1 | 2;
  highlightClass: string;
  baseline: Record<string, number> | null;
  leagueKey: string;
  platform: string | null;
  showPoints?: boolean;
  /** Actual tab: PF / Max PF ranks, coaching efficiency and playoff / title odds. */
  analytics?: Map<number, RowAnalytics> | null;
  analyticsLoading?: boolean;
  /** Last playoff seed; a dashed line is drawn under it, like the dashboard standings. */
  playoffCut?: number | null;
}) {
  const full = analytics !== undefined;
  const statGap = full ? "space-x-5" : showPoints ? "space-x-10" : "space-x-16";
  const teamCount = rows.length;
  const pending = analyticsLoading ? "…" : "—";
  const cut = playoffCut != null && playoffCut > 0 && playoffCut < rows.length ? playoffCut : null;
  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-border">
      <div className={full ? "min-w-[1240px]" : showPoints ? "min-w-[860px]" : "min-w-[720px]"}>
        <div className="flex items-center justify-between border-b border-border bg-slate-50/50 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 select-none">
          <div className="flex min-w-0 flex-1 items-center">
            <span className="w-12 text-center">Rank</span>
            <span className="w-12 pl-2 text-center">Trend</span>
            <span className="pl-6">Team</span>
          </div>
          <div className={cn("flex shrink-0 items-center pr-2", statGap)}>
            <span className="w-14 text-center">Streak</span>
            <span className={cn("text-center", full ? "w-14" : "w-20")}>W-L</span>
            {full ? (
              <>
                <span className="w-16 text-center">PF Rank</span>
                <span className="w-20 text-center">Max PF Rank</span>
              </>
            ) : null}
            {showPoints ? (
              <>
                <span className="w-16 text-right">PF</span>
                <span className="w-16 text-right">PA</span>
              </>
            ) : null}
            {full ? (
              <>
                <span className="w-20 text-center">Coaching Eff</span>
                <span className="w-16 text-center">Playoff %</span>
                <span className="w-16 text-center">Title %</span>
              </>
            ) : null}
            <span className="w-16 text-right">Win %</span>
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading standings…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No standings available for this league yet.
          </p>
        ) : (
          <ul>
            {rows.map((row, index) => {
              const rank = index + 1;
              const pctLabel = `${row.winPct.toFixed(winPctDigits)}%`;
              const delta = powerRankMovementDelta(baseline, row.rosterId, rank);
              const trend = trendPresentation(delta, row.isMine);
              const stats = analytics?.get(row.rosterId) ?? null;

              return (
                <li
                  key={row.rosterId}
                  className={cn(
                    "relative border-t",
                    cut != null && rank === cut + 1 ? "border-dashed border-emerald-400" : "border-border",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center justify-between px-4 py-2.5",
                      row.isMine
                        ? cn(highlightClass, "rounded-none")
                        : "bg-white text-slate-800 hover:bg-slate-50/60",
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-center">
                      <span
                        className={cn(
                          "w-12 text-center text-sm font-semibold tabular-nums",
                          row.isMine
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
                      <span
                        className={cn(
                          "w-12 pl-2 text-center tabular-nums",
                          trend.className,
                        )}
                      >
                        {trend.label}
                      </span>
                      <Link
                        to="/playbook/rosters"
                        search={{ scout: String(row.rosterId) }}
                        className={cn(
                          "flex min-w-0 flex-1 items-center pl-6 transition-opacity hover:opacity-85",
                          row.isMine ? "text-white" : "text-foreground",
                        )}
                      >
                        <TeamAvatarBadge
                          key={`${leagueKey}-${row.rosterId}-${row.logo ?? "fallback"}`}
                          name={row.team}
                          logo={row.logo}
                          platform={platform}
                          cacheKey={`${leagueKey}-${row.rosterId}`}
                        />
                        <span className="min-w-0">
                          <span
                            className={cn(
                              "block truncate text-sm",
                              row.isMine
                                ? "font-black text-white"
                                : "font-medium text-foreground",
                            )}
                          >
                            {row.team}
                          </span>
                          <span
                            className={cn(
                              "block truncate text-xs",
                              row.isMine ? "font-bold text-white/80" : "text-muted-foreground",
                            )}
                          >
                            {row.owner || "Owner"}
                          </span>
                        </span>
                      </Link>
                    </div>
                    <div
                      className={cn(
                        "flex shrink-0 items-center pr-2 select-none text-sm tabular-nums",
                        statGap,
                        row.isMine ? "font-semibold text-white" : "font-semibold text-foreground",
                      )}
                    >
                      <span className="w-14 text-center">
                        <StreakIndicator streak={row.streak} highlighted={row.isMine} />
                      </span>
                      <span className={cn("text-center", full ? "w-14" : "w-20")}>
                        {formatRecord(row.wins, row.losses, row.ties)}
                      </span>
                      {full ? (
                        <>
                          <span className={cn("w-16 text-center", toneClass(rankTone(stats?.pfRank ?? null, teamCount), row.isMine))}>
                            {stats?.pfRank != null ? `#${stats.pfRank}` : pending}
                          </span>
                          <span className={cn("w-20 text-center", toneClass(rankTone(stats?.maxPfRank ?? null, teamCount), row.isMine))}>
                            {stats?.maxPfRank != null ? `#${stats.maxPfRank}` : pending}
                          </span>
                        </>
                      ) : null}
                      {showPoints ? (
                        <>
                          <span className="w-16 text-right">
                            {row.pointsFor != null ? row.pointsFor.toFixed(1) : "—"}
                          </span>
                          <span
                            className={cn(
                              "w-16 text-right font-normal",
                              row.isMine ? "text-white/80" : "text-slate-500",
                            )}
                          >
                            {row.pointsAgainst != null ? row.pointsAgainst.toFixed(1) : "—"}
                          </span>
                        </>
                      ) : null}
                      {full ? (
                        <>
                          <span className={cn("w-20 text-center", toneClass(rankTone(stats?.effRank ?? null, teamCount), row.isMine))}>
                            {stats?.efficiency != null ? `${stats.efficiency.toFixed(1)}%` : pending}
                          </span>
                          <span className={cn("w-16 text-center", toneClass(playoffTone(stats?.playoffPct ?? null), row.isMine))}>
                            {stats?.playoffPct != null ? `${Math.round(stats.playoffPct)}%` : pending}
                          </span>
                          <span className={cn("w-16 text-center", toneClass(titleTone(stats?.titlePct ?? null, teamCount), row.isMine))}>
                            {stats?.titlePct != null ? `${stats.titlePct.toFixed(1)}%` : pending}
                          </span>
                        </>
                      ) : null}
                      <span className="w-16 text-right">{pctLabel}</span>
                    </div>
                  </div>
                  {cut != null && rank === cut + 1 ? (
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

function StandingsHub() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { activeLeague, activeLeagueId } = useActiveLeague();
  const { standings, loading: standingsLoading } = useActiveStandings();
  const { teams, myTeam, rosterPositions, loading: rostersLoading } = useLeagueRosters([]);
  const leagueKey = activeLeagueId ?? activeLeague?.id ?? "none";
  const platform = activeLeague?.platform ?? null;

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

  const myRosterId = myTeam?.slot ?? null;
  const myTeamName = (activeLeague?.teamName ?? myTeam?.team ?? "").trim().toLowerCase();

  const isMineRow = (rosterId: number, team: string) => {
    if (myRosterId != null && Number(rosterId) === Number(myRosterId)) return true;
    if (myTeamName && team.trim().toLowerCase() === myTeamName) return true;
    return false;
  };

  const league = useLeagueAnalytics({ history: tab !== "power", forecast: tab === "actual" });
  const {
    currentWeek,
    completedWeekNumbers,
    historyQueries: historyMatchupQueries,
    historyStamp,
    analytics: actualAnalytics,
  } = league;

  const allPlayLoading =
    tab === "all-play" &&
    (league.nflWeekLoading ||
      league.historyLoading ||
      standingsLoading ||
      rostersLoading);

  const actualRows = useMemo((): DisplayRow[] => {
    const rows = standings?.rows ?? [];
    return rows.map((row) => ({
      rosterId: row.rosterId,
      team: row.team,
      owner: row.owner,
      logo: logoBySlot.get(row.rosterId) ?? row.avatar ?? null,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      winPct: winPercentage(row.wins, row.losses, row.ties),
      streak: row.streak ?? null,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
      isMine: isMineRow(row.rosterId, row.team),
    }));
    // isMineRow closes over myRosterId / myTeamName
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standings, myRosterId, myTeamName, logoBySlot]);

  const allPlayRows = useMemo((): DisplayRow[] => {
    type Tally = {
      wins: number;
      losses: number;
      ties: number;
      pointsFor: number;
      team: string;
      owner: string;
    };

    const tallies = new Map<number, Tally>();
    for (const row of standings?.rows ?? []) {
      tallies.set(row.rosterId, {
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        team: row.team,
        owner: row.owner,
      });
    }

    const ensure = (rosterId: number, teamName?: string, ownerName?: string): Tally => {
      const hit = tallies.get(rosterId);
      if (hit) {
        if (teamName && !hit.team) hit.team = teamName;
        if (ownerName && !hit.owner) hit.owner = ownerName;
        return hit;
      }
      const fresh: Tally = {
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        team: teamName || `Team ${rosterId}`,
        owner: ownerName || "Owner",
      };
      tallies.set(rosterId, fresh);
      return fresh;
    };

    // Group finalized weeks only — never include the live / current week.
    const weeksMap = new Map<number, Map<number, { points: number; teamName: string; owner: string }>>();

    for (let index = 0; index < historyMatchupQueries.length; index += 1) {
      const week = completedWeekNumbers[index] ?? index + 1;

      // CRITICAL GUARD RAIL: skip uncompleted, live, or future weeks entirely.
      const isCompleted = currentWeek != null && week < currentWeek;
      if (!isCompleted) continue;

      const entries = historyMatchupQueries[index]?.data?.entries ?? [];
      if (entries.length < 2) continue;

      const byRoster = weeksMap.get(week) ?? new Map();
      for (const entry of entries) {
        const rosterId = Number(entry.rosterId);
        if (!Number.isFinite(rosterId)) continue;
        const points = Number(entry.points);
        if (!Number.isFinite(points)) continue;
        // One row per roster per week — prevents duplicate matchup inflation.
        byRoster.set(rosterId, {
          points,
          teamName: entry.teamName,
          owner: entry.owner,
        });
      }
      if (byRoster.size >= 2) weeksMap.set(week, byRoster);
    }

    for (const scoresByRoster of weeksMap.values()) {
      const scoresList = [...scoresByRoster.entries()].map(([rosterId, row]) => ({
        rosterId,
        points: row.points,
        teamName: row.teamName,
        owner: row.owner,
      }));

      const totalPts = scoresList.reduce((sum, row) => sum + row.points, 0);
      if (totalPts <= 0) continue;

      // Sort by points scored this week: highest → 9-0, lowest → 0-9 in a 10-team field.
      const sortedScores = [...scoresList].sort((a, b) => b.points - a.points);
      const decisionsPerWeek = Math.max(0, sortedScores.length - 1);

      sortedScores.forEach((teamScore, place) => {
        const tally = ensure(teamScore.rosterId, teamScore.teamName, teamScore.owner);
        tally.pointsFor += teamScore.points;
        // Exactly (N-1) decisions: place 0 → N-1 wins / 0 losses; place N-1 → 0 wins / N-1 losses.
        tally.wins += decisionsPerWeek - place;
        tally.losses += place;
      });
    }

    const streakBySlot = new Map(
      (standings?.rows ?? []).map((row) => [row.rosterId, row.streak ?? null]),
    );

    return [...tallies.entries()]
      .map(([rosterId, t]) => ({
        rosterId,
        team: t.team,
        owner: t.owner,
        logo: logoBySlot.get(rosterId) ?? null,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        winPct: winPercentage(t.wins, t.losses, t.ties),
        streak: streakBySlot.get(rosterId) ?? null,
        pointsFor: t.pointsFor,
        isMine: isMineRow(rosterId, t.team),
      }))
      .sort(
        (a, b) =>
          b.winPct - a.winPct ||
          b.wins - a.wins ||
          a.losses - b.losses ||
          b.pointsFor - a.pointsFor,
      )
      .map(({ pointsFor: _pf, ...row }) => row);
    // historyStamp tracks fetch completion; query array identity is unstable each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- historyStamp
  }, [historyStamp, completedWeekNumbers, currentWeek, standings, myRosterId, myTeamName, logoBySlot]);

  const slotRanksQuery = useStartingSlotRanks(currentWeek);
  const slotRankTeams = useMemo(
    (): SlotRankTeamMeta[] =>
      actualRows.map((row) => ({
        rosterId: row.rosterId,
        team: row.team,
        owner: row.owner,
        logo: row.logo,
        isMine: row.isMine,
      })),
    [actualRows],
  );

  const [actualBaseline, setActualBaseline] = useState<Record<string, number> | null>(null);
  const [allPlayBaseline, setAllPlayBaseline] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    const ranked = actualRows.map((row, index) => ({
      slot: row.rosterId,
      rank: index + 1,
    }));
    setActualBaseline(resolvePowerRankDisplayBaseline(`${leagueKey}.actual`, ranked));
  }, [leagueKey, actualRows]);

  useEffect(() => {
    const ranked = allPlayRows.map((row, index) => ({
      slot: row.rosterId,
      rank: index + 1,
    }));
    setAllPlayBaseline(resolvePowerRankDisplayBaseline(`${leagueKey}.all-play`, ranked));
  }, [leagueKey, allPlayRows]);

  const setTab = (next: StandingsTab) => {
    void navigate({
      search: (prev) => ({ ...prev, tab: next }),
      replace: true,
    });
  };

  const tabBar = (
    <div className="mb-6 flex w-full flex-row flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-2 select-none">
      <h1 className="display-title text-3xl">
        Standings
      </h1>
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={
                active
                  ? "cursor-pointer select-none rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white shadow-sm"
                  : "cursor-pointer select-none rounded-lg border border-slate-200/70 bg-slate-100 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 shadow-xs transition-colors hover:bg-slate-200/80 hover:text-slate-700"
              }
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const panelTitle =
    tab === "actual" ? "Actual" : tab === "all-play" ? "All Play" : "True Power Rankings";

  return (
    <div className="space-y-0">
      {tabBar}

      {tab === "power" ? (
        <TruePowerRankingsPanel />
      ) : (
        <section>
          <div className="mb-3">
            <h2 className={playbookPanelTitleClass}>
              {panelTitle}
            </h2>
          </div>

          {tab === "actual" ? (
            <StandingsTable
              rows={actualRows}
              loading={standingsLoading || rostersLoading}
              winPctDigits={2}
              highlightClass="bg-slate-700 text-white font-black"
              baseline={actualBaseline}
              leagueKey={leagueKey}
              platform={platform}
              showPoints
              analytics={actualAnalytics}
              playoffCut={league.playoffTeamsSetting}
              analyticsLoading={league.analyticsLoading}
            />
          ) : (
            <StandingsTable
              rows={allPlayRows}
              loading={allPlayLoading}
              winPctDigits={1}
              highlightClass="bg-slate-700 text-white font-black"
              baseline={allPlayBaseline}
              leagueKey={leagueKey}
              platform={platform}
            />
          )}

          {!activeLeague ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Sync a league to load standings.{" "}
              <Link to="/account/leagues" className="font-semibold text-primary hover:underline">
                Manage leagues
              </Link>
            </p>
          ) : null}
        </section>
      )}

      {activeLeague ? (
        <StartingSlotRanks
          data={slotRanksQuery.data}
          loading={slotRanksQuery.isLoading || league.nflWeekLoading}
          teams={slotRankTeams}
          platform={platform}
          leagueKey={leagueKey}
        />
      ) : null}
    </div>
  );
}

function StandingsPage() {
  return (
    <PlaybookShell>
      <StandingsHub />
    </PlaybookShell>
  );
}
