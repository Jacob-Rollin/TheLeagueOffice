import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  scheduleOpponent,
  useNflSchedule,
} from "@/components/mobile/league/lineupShared";
import {
  FantasyBoard,
  FantasyMatchupWeekList,
  FantasyPlayerChip,
  FantasyWeekSelect,
  nativeMatchupViewToCard,
  type FantasyMatchupCard,
} from "@/components/native/fantasy";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  getNativeLeagueBoard,
  getNativeMatchupWeek,
  getNativeStandings,
} from "@/lib/native-league.functions";
import {
  expandLineupSlots,
  parseRosterSlotCounts,
} from "@/lib/native-league-lineup";
import {
  fetchNativeLiveWeekStats,
  overlayNativeLiveMatchupScores,
} from "@/lib/native-live-scoring";
import { visibleRefetchInterval } from "@/lib/page-visibility";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import type { Player } from "@/lib/players-build";
import {
  computeDynamicWinProbability,
  computeTeamDisplayProjection,
  formatNflKickoffLabel,
  formatNflGameStatusLabel,
  progressForNflTeam,
  type NflGameProgress,
} from "@/lib/rolling-live-projection";
import type { ScoringMap } from "@/lib/scoring-map";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/league/$linkId/matchup")({
  ssr: false,
  component: NativeMatchupPage,
});

const LIVE_STATS_POLL_MS = 60_000;

function badgeLabel(slot: string): string {
  if (slot === "FLEX" || slot === "WRRB" || slot === "WRTE") return "FLX";
  if (slot === "SFLEX") return "SF";
  if (slot === "BENCH" || slot === "BN") return "BN";
  if (slot === "DEF" || slot === "DST") return "DEF";
  return slot;
}

const SLOT_PILL_TONE: Record<string, string> = {
  QB: "border-qb bg-qb text-white",
  RB: "border-rb bg-rb text-white",
  WR: "border-wr bg-wr text-white",
  TE: "border-te bg-te text-white",
  K: "border-k bg-k text-white",
  DEF: "border-def bg-def text-white",
  BN: "border-slate-300 bg-slate-100 text-slate-600",
  IR: "border-slate-300 bg-slate-100 text-slate-600",
};

function MatchupSlotBadge({ slot }: { slot: string }) {
  const label = badgeLabel(slot);
  const display = slot === "IR" ? "IR" : label;
  const isFlx = display === "FLX" || slot === "FLEX" || slot === "FLX";
  const pillBase =
    "mx-auto z-10 flex h-9 w-11 items-center justify-center rounded-md border text-xs font-bold uppercase shadow-md ring-2 ring-white";

  if (isFlx) {
    return (
      <span className={cn(pillBase, "relative isolate overflow-hidden border-slate-300 text-white")}>
        <span className="pointer-events-none absolute inset-0 flex" aria-hidden="true">
          <span className="h-full w-1/3 bg-rb" />
          <span className="h-full w-1/3 bg-wr" />
          <span className="h-full w-1/3 bg-te" />
        </span>
        <span className="relative z-10">FLX</span>
      </span>
    );
  }

  return (
    <span className={cn(pillBase, SLOT_PILL_TONE[display] ?? SLOT_PILL_TONE["BN"])}>
      {display === "DEF" ? "DST" : display}
    </span>
  );
}

function padPairRows(
  left: Array<string | null>,
  right: Array<string | null>,
  slot: string,
): Array<{ slot: string; leftId: string | null; rightId: string | null }> {
  const len = Math.max(left.length, right.length, 1);
  const rows = [];
  for (let i = 0; i < len; i++) {
    rows.push({
      slot,
      leftId: left[i] ?? null,
      rightId: right[i] ?? null,
    });
  }
  return rows;
}

function NativeMatchupPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const { setActiveLeagueId } = useActiveLeague();
  const modalRef = useRef<PlayerModalHandle>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [selectedMatchupId, setSelectedMatchupId] = useState<number | null>(null);

  useEffect(() => {
    if (linkId) setActiveLeagueId(linkId);
  }, [linkId, setActiveLeagueId]);

  const { data: board } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });
  const activeWeek = week ?? board?.currentWeek ?? 1;

  const { data, isLoading } = useQuery({
    queryKey: ["native-matchup-week", linkId, activeWeek],
    enabled: Boolean(user?.id && linkId),
    staleTime: 30_000,
    queryFn: () => getNativeMatchupWeek({ data: { linkId, week: activeWeek } }),
  });

  const { data: standingsPayload } = useQuery({
    queryKey: ["native-standings", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 30_000,
    queryFn: () => getNativeStandings({ data: { linkId } }),
  });

  const seasonYear = data?.seasonYear ?? board?.summary.seasonYear ?? new Date().getUTCFullYear();
  const isCurrentWeek = activeWeek === (board?.currentWeek ?? activeWeek);

  const liveStats = useQuery({
    queryKey: ["native-live-week-stats", seasonYear, activeWeek],
    enabled: Boolean(data && isCurrentWeek),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: visibleRefetchInterval(LIVE_STATS_POLL_MS),
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: () => fetchNativeLiveWeekStats(seasonYear, activeWeek),
  });

  const scoredMatchups = useMemo(() => {
    const base = data?.matchups ?? [];
    const stats = liveStats.data?.stats;
    const starters = data?.startersByTeamId ?? {};
    const scoring = (data?.scoringSettings ?? {}) as ScoringMap;
    if (!stats || Object.keys(stats).length === 0) return base;
    return overlayNativeLiveMatchupScores(base, starters, stats, scoring);
  }, [data?.matchups, data?.startersByTeamId, data?.scoringSettings, liveStats.data?.stats]);

  const liveActive = Boolean(
    isCurrentWeek && liveStats.data && Object.keys(liveStats.data.stats).length > 0,
  );

  const cache = useSleeperPlayers();
  const fallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const playersById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of cache.data?.players ?? fallback.data?.players ?? []) map.set(p.id, p);
    return map;
  }, [cache.data?.players, fallback.data?.players]);

  const { projectFor, sleeperIdFor } = useLeagueProjections(activeWeek);
  const { progressByNflTeam } = useNflGameProgress(activeWeek);
  const { data: schedule = [] } = useNflSchedule();

  const myTeamId = data?.myTeamId ?? board?.summary.teamId ?? null;

  const recordByTeam = useMemo(() => {
    const map = new Map<number, { wins: number; losses: number; ties: number }>();
    for (const r of standingsPayload?.standings ?? []) {
      map.set(r.teamId, { wins: r.wins, losses: r.losses, ties: r.ties });
    }
    return map;
  }, [standingsPayload?.standings]);

  const avatarByTeam = useMemo(() => {
    const map = new Map<number, string | null>();
    for (const t of board?.teams ?? []) map.set(t.id, t.avatarUrl);
    return map;
  }, [board?.teams]);

  const matchupCards = useMemo((): FantasyMatchupCard[] => {
    return scoredMatchups.map((m) => {
      const card = nativeMatchupViewToCard(m);
      const homeRec = recordByTeam.get(m.home.teamId);
      const awayRec = recordByTeam.get(m.away.teamId);
      return {
        matchupId: card.matchupId,
        home: {
          ...card.home,
          ...(homeRec ?? {}),
        },
        away: {
          ...card.away,
          ...(awayRec ?? {}),
        },
      };
    });
  }, [scoredMatchups, recordByTeam]);

  const defaultMatchupId = useMemo(() => {
    const mine = scoredMatchups.find(
      (m) => m.home.teamId === myTeamId || m.away.teamId === myTeamId,
    );
    return mine?.matchupId ?? scoredMatchups[0]?.matchupId ?? null;
  }, [scoredMatchups, myTeamId]);

  useEffect(() => {
    setSelectedMatchupId(null);
  }, [activeWeek]);

  const focusMatchupId = selectedMatchupId ?? defaultMatchupId;
  const focus =
    scoredMatchups.find((m) => m.matchupId === focusMatchupId) ?? scoredMatchups[0] ?? null;

  /** Put the signed-in manager on the left when they are in the focused matchup. */
  const oriented = useMemo(() => {
    if (!focus) return null;
    const mineIsAway = myTeamId != null && focus.away.teamId === myTeamId;
    if (mineIsAway) {
      return {
        left: focus.away,
        right: focus.home,
        leftStarterIds: data?.startersByTeamId?.[String(focus.away.teamId)] ?? [],
        rightStarterIds: data?.startersByTeamId?.[String(focus.home.teamId)] ?? [],
      };
    }
    return {
      left: focus.home,
      right: focus.away,
      leftStarterIds: data?.startersByTeamId?.[String(focus.home.teamId)] ?? [],
      rightStarterIds: data?.startersByTeamId?.[String(focus.away.teamId)] ?? [],
    };
  }, [focus, myTeamId, data?.startersByTeamId]);

  const starterSlotLabels = useMemo(() => {
    const counts = parseRosterSlotCounts(board?.rosterSlots);
    return expandLineupSlots(counts)
      .filter((row) => row.starter)
      .map((row) => row.label);
  }, [board?.rosterSlots]);

  const starterRows = useMemo(() => {
    if (!oriented) return [];
    const len = Math.max(
      oriented.leftStarterIds.length,
      oriented.rightStarterIds.length,
      starterSlotLabels.length,
    );
    const rows = [];
    for (let i = 0; i < len; i++) {
      rows.push({
        slot: starterSlotLabels[i] ?? `S${i + 1}`,
        leftId: oriented.leftStarterIds[i] ?? null,
        rightId: oriented.rightStarterIds[i] ?? null,
      });
    }
    return rows;
  }, [oriented, starterSlotLabels]);

  const benchRows = useMemo(() => {
    if (!oriented || !board?.rosters) return [];
    const leftRoster = board.rosters.find((r) => r.teamId === oriented.left.teamId);
    const rightRoster = board.rosters.find((r) => r.teamId === oriented.right.teamId);
    const leftStarters = new Set(oriented.leftStarterIds.filter(Boolean));
    const rightStarters = new Set(oriented.rightStarterIds.filter(Boolean));
    const leftBench = (leftRoster?.activePlayerIds ?? leftRoster?.playerIds ?? []).filter(
      (id) => !leftStarters.has(id),
    );
    const rightBench = (rightRoster?.activePlayerIds ?? rightRoster?.playerIds ?? []).filter(
      (id) => !rightStarters.has(id),
    );
    return padPairRows(leftBench, rightBench, "BN");
  }, [oriented, board?.rosters]);

  const irRows = useMemo(() => {
    if (!oriented || !board?.rosters) return [];
    const leftRoster = board.rosters.find((r) => r.teamId === oriented.left.teamId);
    const rightRoster = board.rosters.find((r) => r.teamId === oriented.right.teamId);
    return padPairRows(leftRoster?.irPlayerIds ?? [], rightRoster?.irPlayerIds ?? [], "IR");
  }, [oriented, board?.rosters]);

  const playersFromIds = (ids: string[]) =>
    ids
      .map((id) => playersById.get(id))
      .filter((p): p is Player => Boolean(p));

  const weeklyFallback = (player: Player) => projectFor(sleeperIdFor(player)) ?? 0;

  const leftPlayers = oriented ? playersFromIds(oriented.leftStarterIds) : [];
  const rightPlayers = oriented ? playersFromIds(oriented.rightStarterIds) : [];

  const leftProjBase = useMemo(() => {
    let sum = 0;
    for (const p of leftPlayers) {
      const v = projectFor(sleeperIdFor(p));
      if (v != null && Number.isFinite(v)) sum += v;
    }
    return Math.round(sum * 100) / 100;
  }, [leftPlayers, projectFor, sleeperIdFor]);

  const rightProjBase = useMemo(() => {
    let sum = 0;
    for (const p of rightPlayers) {
      const v = projectFor(sleeperIdFor(p));
      if (v != null && Number.isFinite(v)) sum += v;
    }
    return Math.round(sum * 100) / 100;
  }, [rightPlayers, projectFor, sleeperIdFor]);

  const leftPointsMap = oriented?.left.playerPoints ?? {};
  const rightPointsMap = oriented?.right.playerPoints ?? {};

  const leftDisplayProj = oriented
    ? computeTeamDisplayProjection({
        starters: leftPlayers,
        playerPoints: leftPointsMap,
        projectFor: (id) => {
          const p = playersById.get(id);
          return p ? projectFor(sleeperIdFor(p)) : projectFor(id);
        },
        weeklyFallback,
        progressByNflTeam,
        teamLivePoints: oriented.left.points,
        teamBaselineProj: leftProjBase,
      })
    : 0;

  const rightDisplayProj = oriented
    ? computeTeamDisplayProjection({
        starters: rightPlayers,
        playerPoints: rightPointsMap,
        projectFor: (id) => {
          const p = playersById.get(id);
          return p ? projectFor(sleeperIdFor(p)) : projectFor(id);
        },
        weeklyFallback,
        progressByNflTeam,
        teamLivePoints: oriented.right.points,
        teamBaselineProj: rightProjBase,
      })
    : 0;

  const winPct = oriented
    ? computeDynamicWinProbability({
        scoreA: oriented.left.points,
        scoreB: oriented.right.points,
        startersA: leftPlayers,
        startersB: rightPlayers,
        pointsMapA: leftPointsMap,
        pointsMapB: rightPointsMap,
        projectFor: (id) => {
          const p = playersById.get(id);
          return p ? projectFor(sleeperIdFor(p)) : projectFor(id);
        },
        weeklyFallback,
        progressByNflTeam,
        activeWeek,
      })
    : { pctA: 50, pctB: 50 };

  const matchupFinal = useMemo(() => {
    if (!leftPlayers.length && !rightPlayers.length) return false;
    const all = [...leftPlayers, ...rightPlayers];
    if (!all.length) return false;
    return all.every((p) => {
      const progress = progressForNflTeam(p.team, progressByNflTeam);
      return progress?.phase === "post" || (p.bye != null && p.bye === activeWeek);
    });
  }, [leftPlayers, rightPlayers, progressByNflTeam, activeWeek]);

  const leftRec = oriented ? recordByTeam.get(oriented.left.teamId) : null;
  const rightRec = oriented ? recordByTeam.get(oriented.right.teamId) : null;
  const formatRec = (r: { wins: number; losses: number; ties: number } | null | undefined) => {
    if (!r) return null;
    return `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`;
  };

  const leftLeadsWin = winPct.pctA >= winPct.pctB;
  const leftWon = matchupFinal && (oriented?.left.points ?? 0) > (oriented?.right.points ?? 0);
  const rightWon = matchupFinal && (oriented?.right.points ?? 0) > (oriented?.left.points ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="display-title text-3xl text-slate-900">
            Week <span className="text-primary">Matchup</span>
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {liveActive
              ? "Live scores refresh about every minute while this tab is open."
              : "Scores update when the week snap is published; live overlay appears once week stats are warm."}
          </p>
        </div>
        <FantasyWeekSelect week={activeWeek} onWeekChange={(w) => setWeek(w)} />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading matchups…</p>
      ) : !focus || !oriented ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          No schedule for this week yet. Complete the draft to generate matchups.
        </p>
      ) : (
        <>
          {/* League scoreboard strip */}
          <MatchupStrip
            matchups={matchupCards}
            myTeamId={myTeamId}
            selectedMatchupId={focusMatchupId}
            onSelect={setSelectedMatchupId}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="min-w-0 space-y-4 lg:col-span-2">
              {/* H2H header — Playbook-style */}
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
                    <TeamAvatar
                      name={oriented.left.teamName}
                      avatarUrl={avatarByTeam.get(oriented.left.teamId) ?? null}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-base font-bold leading-tight sm:text-lg",
                          oriented.left.teamId === myTeamId ? "text-primary" : "text-slate-900",
                        )}
                      >
                        {oriented.left.teamName}
                      </p>
                      {formatRec(leftRec) ? (
                        <p className="mt-0.5 text-xs font-medium tabular-nums text-slate-400">
                          {formatRec(leftRec)}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-display text-2xl font-semibold italic tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                        {oriented.left.points.toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs font-medium tabular-nums text-slate-500">
                        Proj {leftDisplayProj.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-center justify-center px-0.5 sm:px-1">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-extrabold uppercase text-white">
                      vs
                    </span>
                    {liveActive ? (
                      <span className="mt-1 text-[10px] font-bold uppercase tracking-wide text-accent">
                        Live
                      </span>
                    ) : matchupFinal ? (
                      <span className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Final
                      </span>
                    ) : null}
                  </div>

                  <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
                    <div className="shrink-0 text-left">
                      <p className="font-display text-2xl font-semibold italic tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                        {oriented.right.points.toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs font-medium tabular-nums text-slate-500">
                        Proj {rightDisplayProj.toFixed(2)}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1 text-right">
                      <p
                        className={cn(
                          "truncate text-base font-bold leading-tight sm:text-lg",
                          oriented.right.teamId === myTeamId ? "text-primary" : "text-slate-900",
                        )}
                      >
                        {oriented.right.teamName}
                      </p>
                      {formatRec(rightRec) ? (
                        <p className="mt-0.5 text-xs font-medium tabular-nums text-slate-400">
                          {formatRec(rightRec)}
                        </p>
                      ) : null}
                    </div>
                    <TeamAvatar
                      name={oriented.right.teamName}
                      avatarUrl={avatarByTeam.get(oriented.right.teamId) ?? null}
                    />
                  </div>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="mb-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {matchupFinal ? "Result" : "Chance to Win"}
                  </p>
                  <div className="flex w-full items-center gap-3 text-sm font-bold">
                    <span
                      className={cn(
                        "w-14 shrink-0 uppercase tracking-wide tabular-nums",
                        matchupFinal
                          ? leftWon
                            ? "text-emerald-600"
                            : rightWon
                              ? "text-rose-600"
                              : "text-slate-500"
                          : leftLeadsWin
                            ? "text-emerald-600"
                            : "text-rose-600",
                      )}
                    >
                      {matchupFinal
                        ? leftWon
                          ? "Won"
                          : rightWon
                            ? "Lost"
                            : "Tie"
                        : `${winPct.pctA}%`}
                    </span>
                    <div className="flex h-1.5 min-w-0 flex-1 items-center gap-1.5">
                      <div className="flex h-full min-w-0 flex-1 justify-end overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width] duration-500",
                            matchupFinal
                              ? leftWon
                                ? "bg-emerald-500"
                                : "bg-transparent"
                              : leftLeadsWin
                                ? "bg-emerald-500"
                                : "bg-rose-500",
                          )}
                          style={{ width: `${Math.max(2, winPct.pctA)}%` }}
                        />
                      </div>
                      <div className="flex h-full min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width] duration-500",
                            matchupFinal
                              ? rightWon
                                ? "bg-emerald-500"
                                : "bg-transparent"
                              : !leftLeadsWin
                                ? "bg-emerald-500"
                                : "bg-rose-500",
                          )}
                          style={{ width: `${Math.max(2, winPct.pctB)}%` }}
                        />
                      </div>
                    </div>
                    <span
                      className={cn(
                        "w-14 shrink-0 text-right uppercase tracking-wide tabular-nums",
                        matchupFinal
                          ? rightWon
                            ? "text-emerald-600"
                            : leftWon
                              ? "text-rose-600"
                              : "text-slate-500"
                          : !leftLeadsWin
                            ? "text-emerald-600"
                            : "text-rose-600",
                      )}
                    >
                      {matchupFinal
                        ? rightWon
                          ? "Won"
                          : leftWon
                            ? "Lost"
                            : "Tie"
                        : `${winPct.pctB}%`}
                    </span>
                  </div>
                </div>
              </section>

              <MirroredLineupBoard
                title="Starters"
                rows={starterRows}
                leftPoints={leftPointsMap}
                rightPoints={rightPointsMap}
                playersById={playersById}
                projectFor={(id) => {
                  const p = playersById.get(id);
                  return p ? projectFor(sleeperIdFor(p)) : null;
                }}
                schedule={schedule}
                activeWeek={activeWeek}
                progressByNflTeam={progressByNflTeam}
                onOpen={(id) => modalRef.current?.open(id)}
                showTotals
              />

              {benchRows.some((r) => r.leftId || r.rightId) ? (
                <MirroredLineupBoard
                  title="Bench"
                  rows={benchRows}
                  leftPoints={leftPointsMap}
                  rightPoints={rightPointsMap}
                  playersById={playersById}
                  projectFor={(id) => {
                    const p = playersById.get(id);
                    return p ? projectFor(sleeperIdFor(p)) : null;
                  }}
                  schedule={schedule}
                  activeWeek={activeWeek}
                  progressByNflTeam={progressByNflTeam}
                  onOpen={(id) => modalRef.current?.open(id)}
                />
              ) : null}

              {irRows.some((r) => r.leftId || r.rightId) ? (
                <MirroredLineupBoard
                  title="IR / Reserve"
                  rows={irRows}
                  leftPoints={leftPointsMap}
                  rightPoints={rightPointsMap}
                  playersById={playersById}
                  projectFor={(id) => {
                    const p = playersById.get(id);
                    return p ? projectFor(sleeperIdFor(p)) : null;
                  }}
                  schedule={schedule}
                  activeWeek={activeWeek}
                  progressByNflTeam={progressByNflTeam}
                  onOpen={(id) => modalRef.current?.open(id)}
                />
              ) : null}
            </div>

            <aside className="min-w-0 lg:col-span-1">
              <FantasyMatchupWeekList
                title="Around the League"
                matchups={matchupCards}
                myTeamId={myTeamId}
                selectedMatchupId={focusMatchupId}
                onSelectMatchup={setSelectedMatchupId}
              />
            </aside>
          </div>
        </>
      )}

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}

function TeamAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  return (
    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 sm:size-14">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <span className="font-display text-sm font-bold uppercase text-slate-500">
          {(name.trim().slice(0, 2) || "TM").toUpperCase()}
        </span>
      )}
    </div>
  );
}

function MatchupStrip({
  matchups,
  myTeamId,
  selectedMatchupId,
  onSelect,
}: {
  matchups: FantasyMatchupCard[];
  myTeamId: number | null;
  selectedMatchupId: number | null;
  onSelect: (id: number) => void;
}) {
  if (matchups.length <= 1) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm [scrollbar-width:thin]">
      <div className="flex min-w-max divide-x divide-slate-100">
        {matchups.map((m) => {
          const mine =
            myTeamId != null && (m.home.teamId === myTeamId || m.away.teamId === myTeamId);
          const selected = selectedMatchupId === m.matchupId;
          return (
            <button
              key={m.matchupId}
              type="button"
              onClick={() => onSelect(m.matchupId)}
              className={cn(
                "flex min-w-[11rem] flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-slate-50",
                selected && "bg-blue-50 ring-1 ring-inset ring-blue-600/30",
                mine && !selected && "bg-primary/5",
              )}
            >
              <span className="truncate text-[11px] font-semibold text-slate-700">
                <span className={cn(m.home.teamId === myTeamId && "text-primary")}>
                  {m.home.teamName}
                </span>
                <span className="mx-1 font-display italic tabular-nums text-slate-900">
                  {m.home.points.toFixed(1)}
                </span>
              </span>
              <span className="truncate text-[11px] font-semibold text-slate-700">
                <span className={cn(m.away.teamId === myTeamId && "text-primary")}>
                  {m.away.teamName}
                </span>
                <span className="mx-1 font-display italic tabular-nums text-slate-900">
                  {m.away.points.toFixed(1)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MirroredLineupBoard({
  title,
  rows,
  leftPoints,
  rightPoints,
  playersById,
  projectFor,
  schedule,
  activeWeek,
  progressByNflTeam,
  onOpen,
  showTotals,
}: {
  title: string;
  rows: Array<{ slot: string; leftId: string | null; rightId: string | null }>;
  leftPoints: Record<string, number>;
  rightPoints: Record<string, number>;
  playersById: Map<string, Player>;
  projectFor: (id: string) => number | null;
  schedule: Parameters<typeof scheduleOpponent>[0];
  activeWeek: number;
  progressByNflTeam: Map<string, NflGameProgress>;
  onOpen: (id: string) => void;
  showTotals?: boolean;
}) {
  if (!rows.length) return null;

  let leftScore = 0;
  let rightScore = 0;
  let leftProj = 0;
  let rightProj = 0;

  return (
    <FantasyBoard title={title} bodyClassName="divide-y divide-slate-100">
      {rows.map((row, idx) => {
        const leftPlayer = row.leftId ? playersById.get(row.leftId) ?? null : null;
        const rightPlayer = row.rightId ? playersById.get(row.rightId) ?? null : null;
        const leftPts = row.leftId != null ? leftPoints[row.leftId] ?? null : null;
        const rightPts = row.rightId != null ? rightPoints[row.rightId] ?? null : null;
        const leftP =
          leftPlayer != null ? projectFor(leftPlayer.id) : null;
        const rightP =
          rightPlayer != null ? projectFor(rightPlayer.id) : null;
        if (leftPts != null && Number.isFinite(leftPts)) leftScore += leftPts;
        if (rightPts != null && Number.isFinite(rightPts)) rightScore += rightPts;
        if (leftP != null && Number.isFinite(leftP)) leftProj += leftP;
        if (rightP != null && Number.isFinite(rightP)) rightProj += rightP;

        return (
          <div
            key={`${row.slot}-${idx}`}
            className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-1 px-2 py-2 sm:gap-2 sm:px-3"
          >
            <SidePlayerCell
              player={leftPlayer}
              playerId={row.leftId}
              points={leftPts}
              proj={leftP}
              align="left"
              schedule={schedule}
              activeWeek={activeWeek}
              progressByNflTeam={progressByNflTeam}
              onOpen={onOpen}
            />
            <div className="flex items-center justify-center self-center px-0.5">
              <MatchupSlotBadge slot={row.slot} />
            </div>
            <SidePlayerCell
              player={rightPlayer}
              playerId={row.rightId}
              points={rightPts}
              proj={rightP}
              align="right"
              schedule={schedule}
              activeWeek={activeWeek}
              progressByNflTeam={progressByNflTeam}
              onOpen={onOpen}
            />
          </div>
        );
      })}
      {showTotals ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 bg-slate-50 px-3 py-2.5 text-sm font-semibold tabular-nums text-slate-800">
          <div className="text-left">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Total{" "}
            </span>
            {leftScore.toFixed(2)}
            <span className="ml-2 text-xs font-medium text-slate-500">
              Proj {leftProj.toFixed(2)}
            </span>
          </div>
          <div className="w-11" />
          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Total{" "}
            </span>
            {rightScore.toFixed(2)}
            <span className="ml-2 text-xs font-medium text-slate-500">
              Proj {rightProj.toFixed(2)}
            </span>
          </div>
        </div>
      ) : null}
    </FantasyBoard>
  );
}

function SidePlayerCell({
  player,
  playerId,
  points,
  proj,
  align,
  schedule,
  activeWeek,
  progressByNflTeam,
  onOpen,
}: {
  player: Player | null;
  playerId: string | null;
  points: number | null;
  proj: number | null;
  align: "left" | "right";
  schedule: Parameters<typeof scheduleOpponent>[0];
  activeWeek: number;
  progressByNflTeam: Map<string, NflGameProgress>;
  onOpen: (id: string) => void;
}) {
  if (!playerId) {
    return (
      <div
        className={cn(
          "flex min-h-[3.25rem] items-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-2 text-sm text-slate-400",
          align === "right" && "justify-end text-right",
        )}
      >
        Empty
      </div>
    );
  }

  const bye = player?.bye != null && Number(player.bye) === activeWeek;
  const opp = bye
    ? "BYE"
    : player
      ? scheduleOpponent(schedule, activeWeek, player.team || "")
      : null;
  const progress = player ? progressForNflTeam(player.team, progressByNflTeam) : undefined;
  const status =
    bye
      ? "Bye"
      : progress
        ? formatNflGameStatusLabel(progress) ||
          formatNflKickoffLabel(progress.kickoffIso) ||
          ""
        : "";

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border border-slate-100 bg-white px-2 py-1.5",
        align === "right" && "flex-row-reverse text-right",
      )}
    >
      <div className="min-w-0 flex-1">
        <FantasyPlayerChip
          player={player}
          fallbackName={playerId}
          size="sm"
          showMeta={false}
          onClick={() => onOpen(playerId)}
          className={cn(align === "right" && "flex-row-reverse text-right")}
        />
        <p
          className={cn(
            "mt-0.5 truncate text-[10px] font-medium uppercase tracking-wide text-slate-500",
            align === "right" && "text-right",
          )}
        >
          {opp ?? "—"}
          {status ? ` · ${status}` : ""}
        </p>
      </div>
      <div className={cn("shrink-0", align === "right" && "text-left")}>
        <p className="font-display text-sm font-semibold italic tabular-nums text-slate-900">
          {points != null && Number.isFinite(points) ? points.toFixed(2) : "—"}
        </p>
        <p className="text-[10px] font-medium tabular-nums text-slate-500">
          {bye ? "—" : proj != null ? proj.toFixed(1) : "—"}
        </p>
      </div>
    </div>
  );
}
