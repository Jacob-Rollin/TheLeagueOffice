import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { PlaybookShell } from "@/components/playbook/PlaybookShell";
import {
  playbookCardClass,
  powerRankMovementDelta,
  resolvePowerRankDisplayBaseline,
  TeamAvatarBadge,
  TruePowerRankingsPanel,
} from "@/components/playbook/panels";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { getConnectionMatchups } from "@/lib/league.functions";
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
  isMine: boolean;
};

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
}: {
  rows: DisplayRow[];
  loading: boolean;
  winPctDigits: 1 | 2;
  highlightClass: string;
  baseline: Record<string, number> | null;
  leagueKey: string;
  platform: string | null;
}) {
  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-border">
      <div className="min-w-[640px]">
        <div className="flex items-center justify-between border-b border-border bg-slate-50/50 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 select-none">
          <div className="flex min-w-0 flex-1 items-center">
            <span className="w-8 text-left">RANK</span>
            <span className="w-12 pl-2 text-center">TREND</span>
            <span className="pl-6">TEAM</span>
          </div>
          <div className="flex shrink-0 items-center space-x-16 pr-2">
            <span className="w-20 text-left">RECORD</span>
            <span className="w-16 text-right">WIN %</span>
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

              return (
                <li key={row.rosterId} className="border-t border-border">
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
                          "w-8 text-left text-sm tabular-nums",
                          row.isMine ? "font-black text-white" : "font-semibold text-slate-500",
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
                      <div className="flex min-w-0 flex-1 items-center pl-6">
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
                                : "font-semibold text-slate-900",
                            )}
                          >
                            {row.team}
                          </span>
                          <span
                            className={cn(
                              "block truncate text-xs",
                              row.isMine ? "font-bold text-white/80" : "text-slate-500",
                            )}
                          >
                            {row.owner || "Owner"}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "flex shrink-0 items-center space-x-16 pr-2 select-none font-mono text-sm",
                        row.isMine ? "font-black text-white" : "font-black text-slate-700",
                      )}
                    >
                      <span className="w-20 text-left tabular-nums">
                        {formatRecord(row.wins, row.losses, row.ties)}
                      </span>
                      <span
                        className={cn(
                          "w-16 text-right tabular-nums",
                          row.isMine ? "text-white" : "text-slate-900",
                        )}
                      >
                        {pctLabel}
                      </span>
                    </div>
                  </div>
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
  const { teams, myTeam, loading: rostersLoading } = useLeagueRosters([]);
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

  const nflWeek = useQuery({
    queryKey: ["nfl-state-week"],
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await fetch("https://api.sleeper.app/v1/state/nfl", {
        headers: { accept: "application/json" },
      }).catch(() => null);
      const json = res && res.ok ? ((await res.json()) as Record<string, unknown>) : null;
      return Math.max(1, Number(json?.["week"] ?? 1) || 1);
    },
  });

  const currentWeek = nflWeek.data ?? null;
  /** Completed NFL weeks only (1 … current−1). Live / in-progress week is excluded. */
  const completedWeekNumbers = useMemo(() => {
    if (currentWeek == null || currentWeek <= 1) return [] as number[];
    return Array.from({ length: currentWeek - 1 }, (_, i) => i + 1);
  }, [currentWeek]);

  const historyMatchupQueries = useQueries({
    queries: completedWeekNumbers.map((week) => ({
      queryKey: ["active-matchups", activeLeague?.id ?? null, week],
      enabled: Boolean(activeLeague?.leagueId && week && tab === "all-play"),
      retry: false,
      staleTime: 10 * 60 * 1000,
      queryFn: async () =>
        await getConnectionMatchups({
          data: {
            identifier: activeLeague?.leagueId ?? "",
            platform: (activeLeague?.platform ?? "sleeper").trim().toLowerCase(),
            week,
            ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
            ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
            ...(activeLeague?.id ? { connectionId: activeLeague.id } : {}),
          },
        }),
    })),
  });

  const historyStamp = historyMatchupQueries
    .map((q) => `${q.dataUpdatedAt}:${q.data?.week ?? "x"}:${q.data?.entries?.length ?? 0}`)
    .join("|");

  const allPlayLoading =
    tab === "all-play" &&
    (nflWeek.isLoading ||
      historyMatchupQueries.some((q) => q.isLoading) ||
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
      <h1 className="display-title text-lg font-bold uppercase tracking-wide text-slate-900">
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
        <section className={playbookCardClass}>
          <div className="mb-4">
            <h2 className="display-title text-lg font-bold uppercase tracking-wide text-slate-900">
              {panelTitle}
            </h2>
          </div>

          {tab === "actual" ? (
            <StandingsTable
              rows={actualRows}
              loading={standingsLoading || rostersLoading}
              winPctDigits={2}
              highlightClass="bg-[#ef4444] text-white font-black"
              baseline={actualBaseline}
              leagueKey={leagueKey}
              platform={platform}
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
