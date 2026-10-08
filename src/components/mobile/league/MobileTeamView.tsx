import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, ChevronRight, Lock, Timer, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { PlayerAvatar, teamLogo } from "@/components/draft/PlayerAvatar";
import { InjuryAvatarBadge } from "@/components/injury/InjuryAvatarBadge";
import { playerPressProps, useOpenMobilePlayer } from "@/components/mobile/MobilePlayerSheet";
import { useActiveMatchups } from "@/hooks/useActiveMatchups";
import { useLeagueProjections, useLeagueScoringMeta } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { useWeeklyActualStats } from "@/hooks/useWeeklyActualStats";
import type { WeeklyMatchupEntry } from "@/lib/league.server";
import type { Player } from "@/lib/players-build";
import type { NflGameProgress } from "@/lib/rolling-live-projection";
import { scoreActualLine } from "@/lib/scoring-map";

import {
  HEX_CLIP,
  PossessionStripBadges,
  REGULAR_SEASON_WEEKS,
  Score,
  buildProjectedOptimalLineup,
  entryPoints,
  gameStripLabels,
  ordinal,
  possessionPill,
  progressFor,
  resolveEntryLineup,
  scheduleOpponent,
  shortName,
  slotLabels,
  sumLineupProjection,
  useNflSchedule,
  type LineupRow,
} from "./lineupShared";
import { MobileTeamLogo } from "./MobileStandings";
import { MobileWeekSelect } from "./MobileWeekSelect";
import { useMobileLeagueStandings } from "./useMobileLeague";

export function MobileTeamView({ leagueId }: { leagueId: string }) {
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = useMemo(() => playersPayload?.players ?? [], [playersPayload]);
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const { myTeam, rosterPositions, loading: rostersLoading } = useLeagueRosters(players);
  const { rows: standingsRows } = useMobileLeagueStandings();
  const [week, setWeek] = useState<number | null>(null);
  const [showOptimized, setShowOptimized] = useState(false);
  const { nflWeek, projectFor, rankFor, sleeperIdFor } = useLeagueProjections(week);
  useEffect(() => {
    if (week == null && nflWeek != null) setWeek(Math.min(nflWeek, REGULAR_SEASON_WEEKS));
  }, [nflWeek, week]);
  const activeWeek = week ?? nflWeek ?? 1;

  const { matchups, loading: matchupsLoading } = useActiveMatchups(activeWeek);
  const { progressByNflTeam, currentWeek } = useNflGameProgress(activeWeek);
  const { data: schedule = [] } = useNflSchedule();
  const { scoringMap } = useLeagueScoringMeta();
  const { statsFor } = useWeeklyActualStats(activeWeek);
  const isPastWeek = currentWeek != null && activeWeek < currentWeek;
  const isCurrentWeek = currentWeek != null && Number(activeWeek) === Number(currentWeek);

  const standingIndex = standingsRows.findIndex(
    (r) => myTeam != null && Number(r.rosterId) === Number(myTeam.slot),
  );
  const standing = standingIndex >= 0 ? standingsRows[standingIndex] : null;

  const entries = matchups?.entries ?? [];
  const mine: WeeklyMatchupEntry | null =
    entries.find((e) => myTeam != null && Number(e.rosterId) === Number(myTeam.slot)) ?? null;
  const opponent =
    mine?.matchupId != null
      ? (entries.find((e) => e.matchupId === mine.matchupId && e.rosterId !== mine.rosterId) ?? null)
      : null;

  const currentLineup = useMemo(() => {
    const labels = slotLabels(rosterPositions);
    if (mine?.starters.length) return resolveEntryLineup(mine, labels, playersById);

    const starters: LineupRow[] = labels.map((slot, i) => ({ slot, player: myTeam?.starters[i] ?? null }));
    const starterIds = new Set(starters.map((r) => r.player?.id).filter(Boolean));
    const irIds = new Set((myTeam?.ir ?? []).map((p) => p.id));
    const bench = (myTeam?.bench ?? [])
      .filter((p) => !starterIds.has(p.id) && !irIds.has(p.id))
      .map((p) => ({ slot: "BN", player: p }));
    const reserve = (myTeam?.ir ?? []).map((p) => ({ slot: "IR", player: p }));
    return { starters, bench, reserve };
  }, [rosterPositions, myTeam, mine, playersById]);

  const projectPlayer = (p: Player) => projectFor(sleeperIdFor(p));

  /** Hide optimize once any current starter's NFL game has started (or finished). */
  const startersLocked = useMemo(() => {
    for (const row of currentLineup.starters) {
      if (!row.player) continue;
      if (row.player.bye != null && Number(row.player.bye) === Number(activeWeek)) continue;
      const phase = progressFor(row.player.team, progressByNflTeam)?.phase ?? "pre";
      if (phase === "in" || phase === "post") return true;
    }
    return false;
  }, [currentLineup.starters, progressByNflTeam, activeWeek]);

  const optimizePlan = useMemo(() => {
    if (!myTeam || !isCurrentWeek || startersLocked) return null;
    const labels = slotLabels(rosterPositions);
    const irIds = new Set((myTeam.ir ?? []).map((p) => p.id));
    const pool = (myTeam.players ?? []).filter((p) => !irIds.has(p.id));
    if (!pool.length || !labels.length) return null;

    const optimal = buildProjectedOptimalLineup(labels, pool, projectPlayer);
    const currentTotal = sumLineupProjection(currentLineup.starters, projectPlayer);
    const gain = Math.round((optimal.total - currentTotal) * 100) / 100;
    if (gain < 0.05) return null;

    const bench = pool
      .filter((p) => !optimal.starterIds.has(p.id))
      .map((p) => ({ slot: "BN", player: p }));
    const reserve = (myTeam.ir ?? []).map((p) => ({ slot: "IR", player: p }));
    return {
      gain,
      optimalTotal: optimal.total,
      currentTotal,
      lineup: { starters: optimal.starters, bench, reserve },
    };
    // projectFor / sleeperIdFor are stable enough via projectPlayer closure on week hooks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    myTeam,
    isCurrentWeek,
    startersLocked,
    rosterPositions,
    currentLineup.starters,
    projectFor,
    sleeperIdFor,
  ]);

  useEffect(() => {
    if (!optimizePlan || startersLocked) setShowOptimized(false);
  }, [optimizePlan, startersLocked]);

  const lineup = showOptimized && optimizePlan ? optimizePlan.lineup : currentLineup;

  const loading = playersLoading || rostersLoading;
  if (loading && !myTeam) {
    return <p className="px-5 py-16 text-center text-sm text-m-muted">Loading your team...</p>;
  }
  if (!myTeam) {
    return <p className="px-5 py-16 text-center text-sm text-m-muted">We could not find your team in this league.</p>;
  }

  const sumStarterProj = (entry: WeeklyMatchupEntry | null): number | null => {
    if (!entry) return null;
    if (entry.projectedPoints > 0) return entry.projectedPoints;
    const { starters } = resolveEntryLineup(entry, slotLabels(rosterPositions), playersById);
    let sum = 0;
    let any = false;
    for (const row of starters) {
      if (!row.player) continue;
      const p = projectFor(sleeperIdFor(row.player));
      if (p == null || !Number.isFinite(p)) continue;
      sum += p;
      any = true;
    }
    return any ? Math.round(sum * 100) / 100 : entry.projectedPoints;
  };
  const myProjectedBase = sumStarterProj(mine);
  const myProjected =
    showOptimized && optimizePlan ? optimizePlan.optimalTotal : myProjectedBase;
  const oppProjected = sumStarterProj(opponent);
  const rowProps: RowHelpers = {
    pointsFor: (p) => {
      if (!mine) return null;
      const host = entryPoints(mine, p.id);
      if (host !== 0) return host;
      const scored = scoreActualLine(statsFor(sleeperIdFor(p)), scoringMap);
      return scored ?? host;
    },
    projectedFor: (p) => projectFor(sleeperIdFor(p)),
    posRankFor: (p) => rankFor(sleeperIdFor(p)).pos,
    progressFor: (p) => progressFor(p.team, progressByNflTeam),
    opponentFor: (p) => scheduleOpponent(schedule, activeWeek, p.team),
    byeWeek: (p) => p.bye === activeWeek,
    playerIdFor: (p) => sleeperIdFor(p),
    showActuals: isPastWeek,
  };

  return (
    <main className="bg-m-bg">
      <section
        className="px-4 pb-0 pt-5 text-white"
        style={{ backgroundImage: "linear-gradient(180deg, var(--m-team-hero-from) 0%, var(--m-team-hero-to) 100%)" }}
      >
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <MobileTeamLogo
              name={myTeam.team}
              logo={myTeam.logo ?? standing?.avatar ?? null}
              className="size-24 border-2 border-white/30 text-xl"
            />
            {standingIndex >= 0 ? (
              <span
                className="absolute -left-2 -top-1 flex size-9 items-center justify-center bg-m-team-rank-bg font-display text-lg font-bold text-m-team-rank-fg"
                style={{ clipPath: HEX_CLIP }}
              >
                {standingIndex + 1}
              </span>
            ) : null}
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-[28px] font-bold leading-[1.1]">{myTeam.team}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm font-semibold text-white/90">
              {myTeam.owner ? <span>{myTeam.owner}</span> : null}
              {standing ? (
                <>
                  <span className="h-3 w-px bg-white/40" />
                  <span>
                    {standing.wins}-{standing.losses}
                    {standing.ties ? `-${standing.ties}` : ""}
                  </span>
                </>
              ) : null}
              {standing?.streak ? (
                <>
                  <span className="h-3 w-px bg-white/40" />
                  <span>Streak: {standing.streak.replace(/^(\d+)([WLT])$/, "$2$1")}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2.5">
          <HeroAction
            to="/m/league/$leagueId/trades"
            leagueId={leagueId}
            label="Trades"
            icon={<ArrowLeftRight className="size-6" />}
          />
          <HeroAction
            to="/m/league/$leagueId/waivers"
            leagueId={leagueId}
            label="Waivers"
            icon={<Timer className="size-6" />}
          />
          <Link
            to="/m/league/$leagueId/players"
            params={{ leagueId }}
            className="flex flex-col items-center gap-2 rounded-lg bg-white/12 px-2 py-3.5 font-display text-sm font-bold uppercase tracking-wide"
          >
            <UserPlus className="size-6" />
            Add Players
          </Link>
        </div>

        {/* Blue shelf so the matchup card can sit flush under actions and straddle grey. */}
        <div className="mt-3 h-[8.5rem]" aria-hidden="true" />
      </section>

      <div className="relative z-10 -mt-[8.5rem] px-4 mb-2">
        {/*
          Card-scoped relative: badge `top-full` must anchor to the card bottom,
          not a spacer sibling (that sat the button entirely below the card).
        */}
        <div className="relative">
          <div className="overflow-hidden rounded-xl bg-m-card text-m-card-fg shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
            <MobileWeekSelect
              week={activeWeek}
              onChange={setWeek}
              centered
              // Must set bg-m-select-bg explicitly — bg-transparent (from earlier polish)
              // overrides the component default via twMerge and blends into the card.
              className="rounded-none bg-m-select-bg text-m-select-fg"
            />

            <div className="px-4 pb-4 pt-3">
              <p className="text-center font-display text-lg font-bold">
                {opponent ? `vs. ${opponent.teamName}` : mine ? "Bye Week" : "Matchup"}
              </p>
              {matchupsLoading ? (
                <p className="py-4 text-center text-sm text-m-muted">Loading matchup...</p>
              ) : (
                <div className="mt-2 flex items-center gap-3">
                  <MobileTeamLogo name={myTeam.team} logo={myTeam.logo} className="size-14" />
                  <div className="flex flex-1 items-center justify-center gap-3">
                    <div className="text-right">
                      <Score value={mine?.points ?? null} className="font-display text-[34px] font-extrabold italic leading-none" />
                      <p
                        className={
                          "mt-1 text-sm tabnum " +
                          (showOptimized && optimizePlan ? "font-semibold text-emerald-600" : "text-m-muted")
                        }
                      >
                        {myProjected != null ? myProjected.toFixed(2) : "-"}
                      </p>
                    </div>
                    <span className="font-display text-sm font-bold text-m-muted">vs</span>
                    <div>
                      <Score
                        value={opponent?.points ?? null}
                        className="font-display text-[34px] font-extrabold italic leading-none text-m-muted"
                      />
                      <p className="mt-1 text-sm text-m-muted tabnum">{oppProjected != null ? oppProjected.toFixed(2) : "-"}</p>
                    </div>
                  </div>
                  <MobileTeamLogo name={opponent?.teamName ?? "?"} logo={opponent?.logo ?? null} className="size-14" />
                </div>
              )}
            </div>

            <Link
              to="/m/league/$leagueId/matchup"
              params={{ leagueId }}
              search={{ week: activeWeek }}
              className="relative z-0 flex items-center justify-between border-t border-m-border px-4 pb-4 pt-3.5 font-display text-base font-semibold"
            >
              <span className="min-w-0 truncate pr-2">View Matchup</span>
              <span className="flex shrink-0 items-center gap-1 text-m-muted">
                {standingIndex >= 0 ? `${ordinal(standingIndex + 1)} in league` : ""}
                <ChevronRight className="size-5" />
              </span>
            </Link>
          </div>

          {optimizePlan ? (
            <div className="pointer-events-none absolute left-1/2 top-full z-20 -translate-x-1/2 -translate-y-[14px]">
              <button
                type="button"
                onClick={() => setShowOptimized((v) => !v)}
                aria-pressed={showOptimized}
                aria-label={
                  showOptimized
                    ? "Show your current set lineup"
                    : `Preview optimized lineup, plus ${optimizePlan.gain.toFixed(2)} projected points`
                }
                className={
                  "pointer-events-auto relative inline-flex h-[44px] items-stretch overflow-hidden rounded-[14px] " +
                  "shadow-[0_3px_0_0_#1a3d2e,0_6px_12px_rgba(0,0,0,0.18)]"
                }
              >
                {/* Invisible +gain keeps full two-tone width when Optimized. */}
                <span
                  className={
                    "flex h-full items-center px-4 font-display text-[22px] font-extrabold italic leading-none tabular-nums " +
                    (showOptimized ? "invisible" : "bg-[#76c78c] text-white")
                  }
                  aria-hidden={showOptimized}
                >
                  + {optimizePlan.gain.toFixed(2)}
                </span>
                <span
                  className={
                    "flex h-full items-center bg-[#2d5a47] font-display text-[15px] font-extrabold italic uppercase tracking-wide text-white " +
                    (showOptimized ? "absolute inset-0 justify-center px-5" : "px-5")
                  }
                >
                  {showOptimized ? "Optimized" : "Optimize"}
                </span>
              </button>
            </div>
          ) : null}
        </div>

        {optimizePlan ? (
          <>
            {/* Room for the ~22px of badge below the card; fixed so toggle doesn't jump. */}
            <div className="h-8" aria-hidden="true" />
            {showOptimized ? (
              <p className="mb-1 text-center text-xs text-m-muted">
                Preview only — tap again for your set lineup
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <LineupSection title="Starters" rows={lineup.starters} {...rowProps} />
      <LineupSection title="Bench" rows={lineup.bench} {...rowProps} />
      {lineup.reserve.length ? <LineupSection title="Reserve" rows={lineup.reserve} {...rowProps} /> : null}
    </main>
  );
}

function HeroAction({
  to,
  leagueId,
  label,
  icon,
}: {
  to: "/m/league/$leagueId/trades" | "/m/league/$leagueId/waivers";
  leagueId: string;
  label: string;
  icon: ReactNode;
}) {
  return (
    <Link
      to={to}
      params={{ leagueId }}
      className="flex flex-col items-center gap-2 rounded-lg bg-white/12 px-2 py-3.5 font-display text-sm font-bold uppercase tracking-wide"
    >
      {icon}
      {label}
    </Link>
  );
}

type RowHelpers = {
  pointsFor: (p: Player) => number | null;
  projectedFor: (p: Player) => number | null;
  posRankFor: (p: Player) => number | null;
  progressFor: (p: Player) => NflGameProgress | undefined;
  opponentFor: (p: Player) => string | null;
  byeWeek: (p: Player) => boolean;
  playerIdFor: (p: Player) => string;
  showActuals: boolean;
};

function LineupSection({ title, rows, ...helpers }: { title: string; rows: LineupRow[] } & RowHelpers) {
  return (
    <section>
      <h2 className="px-4 pb-3 pt-6 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">{title}</h2>
      {rows.length ? (
        <div className="space-y-2.5 px-2.5">
          {rows.map((row, i) => (
            <LineupCard key={`${row.slot}-${row.player?.id ?? i}`} row={row} {...helpers} />
          ))}
        </div>
      ) : (
        <p className="px-4 text-sm text-m-muted">No players.</p>
      )}
    </section>
  );
}

function LineupCard({
  row,
  pointsFor,
  projectedFor,
  posRankFor,
  progressFor: progressOf,
  opponentFor,
  byeWeek,
  playerIdFor,
  showActuals,
}: { row: LineupRow } & RowHelpers) {
  const openPlayer = useOpenMobilePlayer();
  const player = row.player;
  if (!player) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-m-card px-3 py-4 text-m-card-fg">
        <span className="w-8 text-xs font-semibold text-m-muted">{row.slot}</span>
        <span className="text-sm font-semibold text-m-muted">{row.name ?? "Empty slot"}</span>
      </div>
    );
  }

  const progress = progressOf(player);
  const locked = showActuals || progress?.phase === "in" || progress?.phase === "post";
  const points = locked ? pointsFor(player) : null;
  const projected = projectedFor(player);
  const posRank = posRankFor(player);
  const logo = teamLogo(player.team);
  const status = possessionPill(player, progress);
  const strip = gameStripLabels(progress, {
    bye: byeWeek(player),
    opponent: opponentFor(player),
    team: player.team,
  });

  return (
    <article className="overflow-hidden rounded-xl bg-m-card text-m-card-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
      <div className="flex cursor-pointer items-center gap-3 px-3 py-3" {...playerPressProps(openPlayer, playerIdFor(player))}>
        <span className="w-8 shrink-0 text-xs font-semibold text-m-muted">{row.slot}</span>
        <span className="flex w-5 shrink-0 justify-center text-m-muted">
          {locked ? <Lock className="size-4" aria-label="Locked" /> : null}
        </span>
        <div className="relative shrink-0">
          <PlayerAvatar
            id={player.id}
            pos={player.pos}
            team={player.team}
            name={player.name}
            className="size-12"
            logoClassName="hidden"
            {...(player.id.startsWith("espn:") ? { src: row.headshot ?? null } : { fallbackSrc: row.headshot ?? null })}
          />
          {posRank ? (
            <span
              className="absolute -left-2 -top-2 flex size-6 items-center justify-center bg-m-pos-rank-bg font-display text-[11px] font-bold text-m-pos-rank-fg"
              style={{ clipPath: HEX_CLIP }}
            >
              {posRank}
            </span>
          ) : null}
          <InjuryAvatarBadge status={player.injury_status ?? player.injury} />
        </div>
        {logo ? (
          <img src={logo} alt="" className="size-8 shrink-0 rounded-full bg-m-chip object-contain p-1" />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold leading-tight">{shortName(player)}</p>
          <p className="truncate text-xs text-m-muted">
            {player.team || "FA"} - {player.pos}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end text-right">
          <Score value={points} className="font-display text-xl font-bold italic leading-none" />
          {status ? (
            <span
              className={
                status === "possession"
                  ? "mt-1 inline-block rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
                  : "mt-1 inline-block rounded-full bg-m-chip px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-m-muted"
              }
            >
              {status === "possession" ? "Possession" : "Sideline"}
            </span>
          ) : (
            <p className="mt-1 text-xs italic text-m-muted tabnum">{projected != null ? projected.toFixed(2) : "-"}</p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 bg-m-row-alt px-3 py-1.5 text-[11px] font-semibold text-m-muted">
        <span className="truncate">{strip.game}</span>
        <span className="inline-flex shrink-0 items-center gap-1 uppercase">
          <PossessionStripBadges hasBall={strip.hasBall} redZone={strip.redZone} />
          {strip.status}
        </span>
      </div>
    </article>
  );
}
