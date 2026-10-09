import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { PlayerAvatar, teamLogo } from "@/components/draft/PlayerAvatar";
import { InjuryAvatarBadge } from "@/components/injury/InjuryAvatarBadge";
import { playerPressProps, useOpenMobilePlayer } from "@/components/mobile/MobilePlayerSheet";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveMatchups } from "@/hooks/useActiveMatchups";
import { useLeagueProjections, useLeagueScoringMeta } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { useWeeklyActualStats } from "@/hooks/useWeeklyActualStats";
import type { StandingRow, WeeklyMatchupEntry } from "@/lib/league.server";
import { getNativeLeagueBoard } from "@/lib/native-league.functions";
import type { Player } from "@/lib/players-build";
import type { NflGameProgress } from "@/lib/rolling-live-projection";
import { scoreActualLine } from "@/lib/scoring-map";
import { cn } from "@/lib/utils";

import {
  HEX_CLIP,
  PossessionStripBadges,
  REGULAR_SEASON_WEEKS,
  Score,
  entryPoints,
  gameStripLabels,
  liveUnitPillLabel,
  matchupViewerResult,
  minutesLeft,
  possessionPill,
  progressFor,
  resolveEntryLineup,
  scheduleOpponent,
  shortName,
  slotLabels,
  stripShowsFootball,
  useNflSchedule,
  type LineupRow,
} from "./lineupShared";
import { MobileMatchupRecap } from "./MobileMatchupRecap";
import { MobileTeamLogo } from "./MobileStandings";
import { MobileWeekSelect } from "./MobileWeekSelect";
import { useMobileLeagueStandings } from "./useMobileLeague";

type Pair = { home: WeeklyMatchupEntry; away: WeeklyMatchupEntry; mine: boolean };

const record = (r: StandingRow | undefined) =>
  r ? `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}` : "";

export function MobileMatchupView({ initialWeek }: { initialWeek?: number } = {}) {
  const { activeLeague } = useActiveLeague();
  const isNative = (activeLeague?.platform ?? "").toLowerCase() === "native";
  const linkId = isNative ? (activeLeague?.id ?? null) : null;

  const { data: playersPayload } = useSleeperPlayers();
  const players = useMemo(() => playersPayload?.players ?? [], [playersPayload]);
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const { myTeam, rosterPositions } = useLeagueRosters(players);
  const { rows: standingsRows } = useMobileLeagueStandings();

  const [week, setWeek] = useState<number | null>(() =>
    initialWeek != null && initialWeek >= 1
      ? Math.min(initialWeek, REGULAR_SEASON_WEEKS)
      : null,
  );
  const { nflWeek, projectFor, rankFor, sleeperIdFor } = useLeagueProjections(week);

  const boardQuery = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId: linkId! } }),
  });
  const boardWeek = boardQuery.data?.currentWeek ?? null;

  // Apply week from Team → Matchup (?week=) when the search param changes.
  useEffect(() => {
    if (initialWeek != null && initialWeek >= 1) {
      setWeek(Math.min(initialWeek, REGULAR_SEASON_WEEKS));
    }
  }, [initialWeek]);
  useEffect(() => {
    if (week != null) return;
    // Native: prefer league board week (may be advanced for testing) over NFL calendar.
    const fallback = isNative ? (boardWeek ?? nflWeek) : nflWeek;
    if (fallback != null) setWeek(Math.min(fallback, REGULAR_SEASON_WEEKS));
  }, [week, isNative, boardWeek, nflWeek]);
  const activeWeek = week ?? (isNative ? (boardWeek ?? nflWeek) : nflWeek) ?? 1;

  const { matchups, loading } = useActiveMatchups(activeWeek);
  const { progressByNflTeam, currentWeek } = useNflGameProgress(activeWeek);
  const { data: schedule = [] } = useNflSchedule();
  const { scoringMap } = useLeagueScoringMeta();
  const { statsFor } = useWeeklyActualStats(activeWeek);
  const isPastWeek = currentWeek != null && activeWeek < currentWeek;

  const [view, setView] = useState<"matchup" | "scoreboard">("matchup");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recapOpen, setRecapOpen] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<number | null>(null);

  const standingByRoster = useMemo(() => {
    const map = new Map<number, { row: StandingRow; rank: number }>();
    standingsRows.forEach((row, i) => map.set(Number(row.rosterId), { row, rank: i + 1 }));
    return map;
  }, [standingsRows]);

  const pairs = useMemo<Pair[]>(() => {
    const byId = new Map<number, WeeklyMatchupEntry[]>();
    for (const entry of matchups?.entries ?? []) {
      if (entry.matchupId == null) continue;
      byId.set(entry.matchupId, [...(byId.get(entry.matchupId) ?? []), entry]);
    }
    const mySlot = myTeam?.slot != null ? Number(myTeam.slot) : null;
    const out: Pair[] = [];
    for (const [, sides] of [...byId.entries()].sort((a, b) => a[0] - b[0])) {
      if (sides.length < 2) continue;
      const [a, b] = sides as [WeeklyMatchupEntry, WeeklyMatchupEntry];
      const bMine = Number(b.rosterId) === mySlot;
      const mine = bMine || Number(a.rosterId) === mySlot;
      out.push(bMine ? { home: b, away: a, mine } : { home: a, away: b, mine });
    }
    return out.sort((x, y) => Number(y.mine) - Number(x.mine));
  }, [matchups, myTeam?.slot]);

  const scrollTo = (index: number, smooth = true) => {
    const el = carouselRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
  };

  useEffect(() => {
    setActiveIndex(0);
    setRecapOpen(false);
    scrollTo(0, false);
  }, [activeWeek]);

  useEffect(() => {
    if (view !== "matchup" || pendingScroll.current == null) return;
    scrollTo(pendingScroll.current, false);
    pendingScroll.current = null;
  }, [view]);

  const current = pairs[Math.min(activeIndex, pairs.length - 1)] ?? null;
  const labels = useMemo(() => slotLabels(rosterPositions), [rosterPositions]);

  const slotsFor = (entry: WeeklyMatchupEntry) => resolveEntryLineup(entry, labels, playersById);

  const minutesFor = (entry: WeeklyMatchupEntry) => {
    let remaining = 0;
    let total = 0;
    for (const { player } of slotsFor(entry).starters) {
      const progress = player ? progressFor(player.team, progressByNflTeam) : undefined;
      if (!progress) continue;
      total += 60;
      remaining += minutesLeft(progress);
    }
    return { remaining: Math.round(remaining), total };
  };

  const pointsFor = (entry: WeeklyMatchupEntry, player: Player): number => {
    const host = entryPoints(entry, player.id);
    if (host !== 0) return host;
    // Host/CDN often stores 0 for remapped DEF — score the Sleeper box line
    // with league settings (same path as desktop My Team / player popup).
    const scored = scoreActualLine(statsFor(sleeperIdFor(player)), scoringMap);
    return scored ?? host;
  };

  /** Header totals follow the same live starter scores as the lineup rows. */
  const teamActualPoints = (entry: WeeklyMatchupEntry): number => {
    const { starters } = slotsFor(entry);
    let sum = 0;
    let sawStarter = false;
    for (const row of starters) {
      if (!row.player) continue;
      const pts = pointsFor(entry, row.player);
      if (!Number.isFinite(pts)) continue;
      sum += pts;
      sawStarter = true;
    }
    if (sawStarter) return Math.round(sum * 100) / 100;
    return Number(entry.points) || 0;
  };

  const teamProjected = (entry: WeeklyMatchupEntry): number => {
    if (entry.projectedPoints > 0) return entry.projectedPoints;
    const { starters } = slotsFor(entry);
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

  const cardHelpers: CardHelpers = {
    pointsFor,
    projectedFor: (p) => projectFor(sleeperIdFor(p)),
    posRankFor: (p) => rankFor(sleeperIdFor(p)).pos,
    progressOf: (p) => progressFor(p.team, progressByNflTeam),
    opponentFor: (p) => scheduleOpponent(schedule, activeWeek, p.team),
    byeWeek: (p) => p.bye === activeWeek,
    playerIdFor: (p) => sleeperIdFor(p),
    showActuals: isPastWeek,
  };

  return (
    <main className="pt-3">
      <div className="grid grid-cols-2 gap-2.5 px-2.5">
        <button
          type="button"
          onClick={() => setView((v) => (v === "scoreboard" ? "matchup" : "scoreboard"))}
          className={cn(
            "rounded-lg px-4 py-3 font-display text-lg font-semibold transition-colors",
            view === "scoreboard"
              ? "bg-m-tab-active text-m-tab-active-fg"
              : "bg-m-select-bg text-m-select-fg",
          )}
        >
          Scoreboard
        </button>
        <MobileWeekSelect week={activeWeek} onChange={setWeek} />
      </div>

      {loading ? (
        <p className="px-5 py-16 text-center text-sm text-m-muted">Loading matchups...</p>
      ) : !pairs.length ? (
        <p className="px-5 py-16 text-center text-sm text-m-muted">No matchups scheduled for Week {activeWeek}.</p>
      ) : view === "scoreboard" ? (
        <Scoreboard
          pairs={pairs}
          activeIndex={activeIndex}
          standingByRoster={standingByRoster}
          actualPointsFor={teamActualPoints}
          projectedFor={teamProjected}
          onSelect={(i) => {
            setActiveIndex(i);
            pendingScroll.current = i;
            setView("matchup");
          }}
        />
      ) : (
        <>
          <div
            ref={carouselRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              const next = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
              if (next !== activeIndex) setActiveIndex(next);
            }}
            className="no-scrollbar mt-3 flex snap-x snap-mandatory overflow-x-auto"
          >
            {pairs.map((pair, i) => (
              <div key={`${pair.home.rosterId}-${pair.away.rosterId}`} className="w-full shrink-0 snap-center px-2.5">
                <MatchupCard
                  pair={pair}
                  title={pair.mine ? "Your Matchup" : `Matchup ${i + 1}`}
                  standingByRoster={standingByRoster}
                  homeMinutes={minutesFor(pair.home)}
                  awayMinutes={minutesFor(pair.away)}
                  homePoints={teamActualPoints(pair.home)}
                  awayPoints={teamActualPoints(pair.away)}
                  homeProjected={teamProjected(pair.home)}
                  awayProjected={teamProjected(pair.away)}
                  showRecap={isPastWeek && i === activeIndex}
                  onRecap={() => setRecapOpen(true)}
                />
              </div>
            ))}
          </div>

          <div className="mt-3 flex justify-center gap-2" role="tablist" aria-label="League matchups">
            {pairs.map((pair, i) => (
              <button
                key={`dot-${pair.home.rosterId}`}
                type="button"
                role="tab"
                aria-selected={i === activeIndex}
                aria-label={`Matchup ${i + 1}`}
                onClick={() => scrollTo(i)}
                className={cn(
                  "size-2.5 rounded-full transition-colors",
                  i === activeIndex ? "bg-m-accent" : "bg-m-muted/40",
                )}
              />
            ))}
          </div>

          {current ? (
            <HeadToHead
              home={slotsFor(current.home)}
              away={slotsFor(current.away)}
              labels={labels}
              homeEntry={current.home}
              awayEntry={current.away}
              helpers={cardHelpers}
            />
          ) : null}

          {recapOpen && current ? (
            <MobileMatchupRecap
              week={activeWeek}
              home={current.home}
              away={current.away}
              homeLineup={slotsFor(current.home)}
              awayLineup={slotsFor(current.away)}
              labels={labels}
              homeProjected={teamProjected(current.home)}
              awayProjected={teamProjected(current.away)}
              homePoints={teamActualPoints(current.home)}
              awayPoints={teamActualPoints(current.away)}
              pointsFor={pointsFor}
              projectedFor={cardHelpers.projectedFor}
              viewerResult={
                current.mine
                  ? matchupViewerResult(
                      teamActualPoints(current.home),
                      teamActualPoints(current.away),
                    )
                  : null
              }
              onClose={() => setRecapOpen(false)}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

function RankedLogo({ name, logo, rank }: { name: string; logo: string | null; rank: number | null }) {
  return (
    <div className="relative shrink-0">
      <MobileTeamLogo name={name} logo={logo} className="size-[72px] text-lg" />
      {rank ? (
        <span
          className="absolute -left-1.5 -top-1.5 flex size-7 items-center justify-center bg-m-accent font-display text-sm font-bold text-m-accent-fg"
          style={{ clipPath: HEX_CLIP }}
        >
          {rank}
        </span>
      ) : null}
    </div>
  );
}

function MatchupCard({
  pair,
  title,
  standingByRoster,
  homeMinutes,
  awayMinutes,
  homePoints,
  awayPoints,
  homeProjected,
  awayProjected,
  showRecap,
  onRecap,
}: {
  pair: Pair;
  title: string;
  standingByRoster: Map<number, { row: StandingRow; rank: number }>;
  homeMinutes: { remaining: number; total: number };
  awayMinutes: { remaining: number; total: number };
  homePoints: number;
  awayPoints: number;
  homeProjected: number;
  awayProjected: number;
  showRecap?: boolean;
  onRecap?: () => void;
}) {
  const { home, away } = pair;
  const homeStanding = standingByRoster.get(Number(home.rosterId));
  const awayStanding = standingByRoster.get(Number(away.rosterId));
  const projTone = (mine: number, theirs: number) =>
    mine === theirs ? "text-m-muted" : mine > theirs ? "text-emerald-500" : "text-red-500";

  return (
    <article className="rounded-xl bg-m-card px-4 pb-4 pt-4 text-m-card-fg shadow-[0_2px_4px_rgba(0,0,0,0.12)]">
      <p className="font-display text-lg font-bold">{title}</p>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] gap-x-2">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <RankedLogo name={home.teamName} logo={home.logo} rank={homeStanding?.rank ?? null} />
            <div className="pt-2 text-right">
              <Score value={homePoints} className="font-display text-[30px] font-extrabold italic leading-none" />
              <p className={cn("mt-1 text-sm font-semibold tabnum", projTone(homeProjected, awayProjected))}>
                {homeProjected.toFixed(2)}
              </p>
            </div>
          </div>
          <p className="mt-3 truncate font-display text-lg font-bold">{home.teamName}</p>
          <p className="truncate text-xs text-m-muted">
            {[home.owner, record(homeStanding?.row)].filter(Boolean).join(" | ")}
          </p>
          {!showRecap ? <MinutesBar {...homeMinutes} /> : null}
        </div>

        <div className="flex flex-col items-center">
          <span className="w-px flex-1 bg-m-border" />
          <span className="py-2 font-display text-xs font-bold text-m-muted">VS</span>
          <span className="w-px flex-1 bg-m-border" />
        </div>

        <div className="min-w-0">
          <div className="flex flex-row-reverse items-start justify-between gap-2">
            <RankedLogo name={away.teamName} logo={away.logo} rank={awayStanding?.rank ?? null} />
            <div className="pt-2">
              <Score value={awayPoints} className="font-display text-[30px] font-extrabold italic leading-none" />
              <p className={cn("mt-1 text-sm font-semibold tabnum", projTone(awayProjected, homeProjected))}>
                {awayProjected.toFixed(2)}
              </p>
            </div>
          </div>
          <p className="mt-3 truncate text-right font-display text-lg font-bold">{away.teamName}</p>
          <p className="truncate text-right text-xs text-m-muted">
            {[record(awayStanding?.row), away.owner].filter(Boolean).join(" | ")}
          </p>
          {!showRecap ? <MinutesBar {...awayMinutes} mirror /> : null}
        </div>
      </div>

      {showRecap && onRecap ? (
        <button
          type="button"
          onClick={onRecap}
          className="mt-4 w-full rounded-lg bg-m-accent px-4 py-3.5 font-display text-base font-bold text-m-accent-fg"
        >
          View Matchup Recap
        </button>
      ) : null}
    </article>
  );
}

function MinutesBar({ remaining, total, mirror }: { remaining: number; total: number; mirror?: boolean }) {
  const pct = total ? Math.round((remaining / total) * 100) : 0;
  return (
    <div className="mt-3">
      <div className={cn("flex h-1.5 overflow-hidden rounded-full bg-m-chip", mirror ? "justify-start" : "justify-end")}>
        <div className="h-full rounded-full bg-m-accent" style={{ width: `${pct}%` }} />
      </div>
      <div className={cn("mt-1 flex justify-between text-[11px] text-m-muted", mirror && "flex-row-reverse")}>
        <span>Min. Remaining</span>
        <span className="tabnum">{remaining}</span>
      </div>
    </div>
  );
}

function Scoreboard({
  pairs,
  activeIndex,
  standingByRoster,
  actualPointsFor,
  projectedFor,
  onSelect,
}: {
  pairs: Pair[];
  activeIndex: number;
  standingByRoster: Map<number, { row: StandingRow; rank: number }>;
  actualPointsFor: (entry: WeeklyMatchupEntry) => number;
  projectedFor: (entry: WeeklyMatchupEntry) => number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="mt-3 space-y-2.5 px-2.5">
      {pairs.map((pair, i) => {
        const homePts = actualPointsFor(pair.home);
        const awayPts = actualPointsFor(pair.away);
        return (
          <button
            key={`${pair.home.rosterId}-${pair.away.rosterId}`}
            type="button"
            onClick={() => onSelect(i)}
            className={cn(
              "block w-full overflow-hidden rounded-xl border bg-m-card text-left text-m-card-fg",
              i === activeIndex ? "border-m-accent" : "border-transparent",
            )}
          >
            {[
              { side: pair.home, pts: homePts, leading: homePts > awayPts },
              { side: pair.away, pts: awayPts, leading: awayPts > homePts },
            ].map(({ side, pts, leading }, s) => {
              const standing = standingByRoster.get(Number(side.rosterId));
              return (
                <div
                  key={side.rosterId}
                  className={cn("flex items-center gap-3 px-3 py-2.5", s === 1 && "border-t border-m-border")}
                >
                  <MobileTeamLogo name={side.teamName} logo={side.logo} className="size-9" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{side.teamName}</span>
                    <span className="block truncate text-xs text-m-muted">
                      {[side.owner, record(standing?.row)].filter(Boolean).join(" | ")}
                    </span>
                  </span>
                  <span className="text-right">
                    <Score
                      value={pts}
                      className={cn(
                        "font-display text-xl font-bold italic leading-none",
                        !leading && "text-m-muted",
                      )}
                    />
                    <span className="block text-xs text-m-muted tabnum">
                      {projectedFor(side).toFixed(2)}
                    </span>
                  </span>
                </div>
              );
            })}
          </button>
        );
      })}
    </div>
  );
}

type CardHelpers = {
  pointsFor: (entry: WeeklyMatchupEntry, player: Player) => number;
  projectedFor: (p: Player) => number | null;
  posRankFor: (p: Player) => number | null;
  progressOf: (p: Player) => NflGameProgress | undefined;
  opponentFor: (p: Player) => string | null;
  byeWeek: (p: Player) => boolean;
  playerIdFor: (p: Player) => string;
  /** Past weeks always show scored actuals even if progress map is empty. */
  showActuals: boolean;
};

function HeadToHead({
  home,
  away,
  labels,
  homeEntry,
  awayEntry,
  helpers,
}: {
  home: { starters: LineupRow[]; bench: LineupRow[] };
  away: { starters: LineupRow[]; bench: LineupRow[] };
  labels: string[];
  homeEntry: WeeklyMatchupEntry;
  awayEntry: WeeklyMatchupEntry;
  helpers: CardHelpers;
}) {
  const benchRows = Math.max(home.bench.length, away.bench.length);
  return (
    <>
      <h2 className="px-4 pb-3 pt-6 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">Starters</h2>
      <div className="space-y-2.5 px-2.5">
        {labels.map((slot, i) => (
          <div key={`${slot}-${i}`} className="grid grid-cols-2 gap-2.5">
            <HalfCard slot={home.starters[i]} slotLabel={slot} entry={homeEntry} helpers={helpers} />
            <HalfCard slot={away.starters[i]} slotLabel={slot} entry={awayEntry} helpers={helpers} mirror />
          </div>
        ))}
      </div>

      {benchRows ? (
        <>
          <h2 className="px-4 pb-3 pt-6 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">Bench</h2>
          <div className="space-y-2.5 px-2.5">
            {Array.from({ length: benchRows }, (_, i) => (
              <div key={`bench-${i}`} className="grid grid-cols-2 gap-2.5">
                <HalfCard slot={home.bench[i]} slotLabel="BN" entry={homeEntry} helpers={helpers} bench />
                <HalfCard slot={away.bench[i]} slotLabel="BN" entry={awayEntry} helpers={helpers} bench mirror />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function HalfCard({
  slot,
  slotLabel,
  entry,
  helpers,
  mirror,
  bench,
}: {
  slot: LineupRow | undefined;
  slotLabel: string;
  entry: WeeklyMatchupEntry;
  helpers: CardHelpers;
  mirror?: boolean;
  bench?: boolean;
}) {
  const openPlayer = useOpenMobilePlayer();
  const player = slot?.player ?? null;
  if (!player) {
    return (
      <div
        className={cn(
          "flex min-h-[7.5rem] flex-col justify-center rounded-xl bg-m-card px-3 text-m-card-fg",
          bench && "opacity-80",
          mirror && "items-end text-right",
        )}
      >
        <span className="text-xs font-semibold text-m-muted">{slotLabel}</span>
        <span className="truncate text-sm font-semibold">{slot?.name ?? (bench ? "" : "Empty")}</span>
      </div>
    );
  }

  const progress = helpers.progressOf(player);
  const started = helpers.showActuals || progress?.phase === "in" || progress?.phase === "post";
  const points = started ? helpers.pointsFor(entry, player) : null;
  const projected = helpers.projectedFor(player);
  const posRank = helpers.posRankFor(player);
  const logo = teamLogo(player.team);
  const status = possessionPill(player, progress);
  const strip = gameStripLabels(progress, {
    bye: helpers.byeWeek(player),
    opponent: helpers.opponentFor(player),
    team: player.team,
  });
  // Skill/K on offense, DST on defense (not Sideline).
  const showBall = stripShowsFootball(player, progress);

  return (
    <article
      className={cn(
        "cursor-pointer overflow-hidden rounded-xl bg-m-card text-m-card-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
        bench && "opacity-85",
      )}
      {...playerPressProps(openPlayer, helpers.playerIdFor(player))}
    >
      <div className="px-2.5 pb-2 pt-2.5">
        <div className={cn("flex items-start gap-1.5", mirror && "flex-row-reverse")}>
          <div className="relative shrink-0">
            <PlayerAvatar
              id={player.id}
              pos={player.pos}
              team={player.team}
              name={player.name}
              className="size-11"
              logoClassName="hidden"
              {...(player.id.startsWith("espn:")
                ? { src: slot?.headshot ?? null }
                : { fallbackSrc: slot?.headshot ?? null })}
            />
            {posRank ? (
              <span
                className={cn(
                  "absolute -top-1.5 flex size-5 items-center justify-center bg-m-pos-rank-bg font-display text-[10px] font-bold text-m-pos-rank-fg",
                  mirror ? "-right-1.5" : "-left-1.5",
                )}
                style={{ clipPath: HEX_CLIP }}
              >
                {posRank}
              </span>
            ) : null}
            <InjuryAvatarBadge
              status={player.injury_status ?? player.injury}
              className={mirror ? "-right-0.5 left-auto" : undefined}
            />
          </div>
          {/* Avatar is already the team mark for DST — skip the redundant chip. */}
          {logo && player.pos !== "DEF" ? (
            <img src={logo} alt="" className="mt-1.5 size-7 shrink-0 rounded-full bg-m-chip object-contain p-1" />
          ) : null}
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col",
              mirror ? "items-start text-left" : "items-end text-right",
            )}
          >
            <Score value={points} className="font-display text-xl font-bold italic leading-none" />
            {status ? (
              <span
                className={cn(
                  "mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                  status === "sideline" ? "bg-m-chip text-m-muted" : "bg-emerald-500 text-white",
                )}
              >
                {liveUnitPillLabel(status)}
              </span>
            ) : (
              <p className="mt-1 text-xs italic text-m-muted tabnum">{projected != null ? projected.toFixed(2) : "-"}</p>
            )}
          </div>
        </div>
        <p className={cn("mt-2 truncate text-[15px] font-semibold leading-tight", mirror && "text-right")}>
          {mirror ? (
            <>
              <span className="mr-1 text-[11px] font-semibold text-m-muted">{player.pos}</span>
              {shortName(player)}
            </>
          ) : (
            <>
              {shortName(player)}
              <span className="ml-1 text-[11px] font-semibold text-m-muted">{player.pos}</span>
            </>
          )}
        </p>
      </div>
      {/* Always game left / clock+badges right — avoid mirror flipping live strips. */}
      <div className="flex items-center justify-between gap-1 bg-m-row-alt px-2.5 py-1.5 text-[10px] font-semibold text-m-muted">
        <span className="truncate">{strip.game}</span>
        <span className="inline-flex shrink-0 items-center gap-1 uppercase">
          <PossessionStripBadges hasBall={showBall} redZone={strip.redZone && showBall} />
          {strip.status}
        </span>
      </div>
    </article>
  );
}
