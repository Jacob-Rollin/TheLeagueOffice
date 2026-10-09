import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, ArrowUpDown, ChevronRight, Lock, Timer, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { PlayerAvatar, teamLogo } from "@/components/draft/PlayerAvatar";
import { InjuryAvatarBadge } from "@/components/injury/InjuryAvatarBadge";
import { playerPressProps, useOpenMobilePlayer } from "@/components/mobile/MobilePlayerSheet";
import { Toaster } from "@/components/ui/sonner";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveMatchups } from "@/hooks/useActiveMatchups";
import { useLeagueProjections, useLeagueScoringMeta } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { useWeeklyActualStats } from "@/hooks/useWeeklyActualStats";
import type { WeeklyMatchupEntry } from "@/lib/league.server";
import type { RosterSlotKey } from "@/lib/league-settings";
import {
  buildDefaultLineupSlots,
  expandLineupSlots,
  nativeSlotsHavePlayers,
  parseRosterSlotCounts,
  slotAcceptsPos,
  slotsRecordFromViews,
  viewsFromSlotsRecord,
  type NativeLineupSlotView,
} from "@/lib/native-league-lineup";
import { getNativeLineup, saveNativeLineup } from "@/lib/native-league.functions";
import type { Player } from "@/lib/players-build";
import type { NflGameProgress } from "@/lib/rolling-live-projection";
import { scoreActualLine } from "@/lib/scoring-map";
import { cn } from "@/lib/utils";

import {
  HEX_CLIP,
  PossessionStripBadges,
  REGULAR_SEASON_WEEKS,
  Score,
  buildProjectedOptimalLineup,
  entryPoints,
  gameStripLabels,
  liveUnitPillLabel,
  matchupClockStatus,
  matchupViewerResult,
  possessionPill,
  progressFor,
  resolveEntryLineup,
  scheduleOpponent,
  shortName,
  slotLabels,
  stripShowsFootball,
  sumLineupProjection,
  useNflSchedule,
  type LineupRow,
} from "./lineupShared";
import { MobileTeamLogo } from "./MobileStandings";
import { MobileWeekSelect } from "./MobileWeekSelect";
import { useMobileLeagueStandings } from "./useMobileLeague";

function viewKey(row: NativeLineupSlotView): string {
  return `${row.key}:${row.index}`;
}

function playerIsLocked(
  player: Player | null | undefined,
  progressByNflTeam: Map<string, NflGameProgress> | null | undefined,
  activeWeek: number,
  showActuals: boolean,
): boolean {
  if (!player) return false;
  if (showActuals) return true;
  if (player.bye != null && Number(player.bye) === Number(activeWeek)) return false;
  if (!progressByNflTeam) return false;
  const phase = progressFor(player.team, progressByNflTeam)?.phase ?? "pre";
  return phase === "in" || phase === "post";
}

export function MobileTeamView({ leagueId }: { leagueId: string }) {
  const { activeLeague } = useActiveLeague();
  const queryClient = useQueryClient();
  const isNative = (activeLeague?.platform ?? "").toLowerCase() === "native";
  const linkId = isNative ? (activeLeague?.id ?? null) : null;

  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = useMemo(() => playersPayload?.players ?? [], [playersPayload]);
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const { myTeam, rosterPositions, loading: rostersLoading } = useLeagueRosters(players);
  const { rows: standingsRows } = useMobileLeagueStandings();
  const [week, setWeek] = useState<number | null>(null);
  const [showOptimized, setShowOptimized] = useState(false);
  const [nativeViews, setNativeViews] = useState<NativeLineupSlotView[]>([]);
  const [nativeVersion, setNativeVersion] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [savingLineup, setSavingLineup] = useState(false);
  const seededLineupKey = useRef<string | null>(null);
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

  const nativeLineupQuery = useQuery({
    queryKey: ["native-lineup", linkId, activeWeek],
    enabled: Boolean(linkId),
    staleTime: 15_000,
    retry: false,
    queryFn: () => getNativeLineup({ data: { linkId: linkId!, week: activeWeek } }),
  });
  const nativeLineup = nativeLineupQuery.data ?? null;

  const posById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of players) map[p.id] = p.pos;
    return map;
  }, [players]);
  const injuryById = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const p of players) map[p.id] = p.injury_status ?? p.injury ?? null;
    return map;
  }, [players]);
  const teamByPlayerId = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const p of players) map[p.id] = p.team || null;
    return map;
  }, [players]);

  useEffect(() => {
    if (!nativeLineup) return;
    const counts = parseRosterSlotCounts(nativeLineup.rosterSlots);
    const hasSaved = nativeSlotsHavePlayers(nativeLineup.slots);
    if (hasSaved) {
      setNativeViews(viewsFromSlotsRecord(counts, nativeLineup.slots));
      setNativeVersion(nativeLineup.version);
      setSelectedKey(null);
      return;
    }

    // No saved week lineup yet — seed from roster by position so Team/Matchup aren't empty.
    if (nativeLineup.rosterPlayerIds.length > 0 && Object.keys(posById).length > 0) {
      const seeded = buildDefaultLineupSlots(nativeLineup.rosterPlayerIds, posById, counts, {
        injuryById,
        irAllowedStatuses: nativeLineup.irAllowedStatuses,
      });
      const views = viewsFromSlotsRecord(counts, seeded);
      setNativeViews(views);
      setNativeVersion(nativeLineup.version);
      setSelectedKey(null);
      const seedKey = `${linkId}:${nativeLineup.week}:${nativeLineup.version}:${nativeLineup.rosterPlayerIds.join(",")}`;
      if (
        linkId &&
        nativeLineup.canEdit &&
        nativeLineup.draftComplete &&
        seededLineupKey.current !== seedKey
      ) {
        seededLineupKey.current = seedKey;
        void (async () => {
          try {
            const result = await saveNativeLineup({
              data: {
                linkId,
                week: nativeLineup.week,
                version: nativeLineup.version,
                slots: slotsRecordFromViews(views),
                posById,
                injuryById,
                teamByPlayerId,
              },
            });
            if (result.ok) {
              if (result.version != null) setNativeVersion(result.version);
              await queryClient.invalidateQueries({ queryKey: ["native-lineup", linkId] });
              await queryClient.invalidateQueries({ queryKey: ["active-matchups", linkId] });
              await queryClient.invalidateQueries({ queryKey: ["league-rosters", linkId] });
            }
          } catch {
            /* best-effort seed */
          }
        })();
      }
      return;
    }

    setNativeViews(viewsFromSlotsRecord(counts, {}));
    setNativeVersion(nativeLineup.version);
    setSelectedKey(null);
  }, [nativeLineup, posById, injuryById, teamByPlayerId, linkId, queryClient]);

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

  const hostLineup = useMemo(() => {
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

  const nativeDisplayLineup = useMemo(() => {
    if (!isNative || !nativeViews.length) return null;
    const toRow = (v: NativeLineupSlotView): LineupRow => ({
      slot: v.key === "DEF" ? "DEF" : v.key,
      player: v.playerId ? (playersById.get(v.playerId) ?? null) : null,
    });
    return {
      starters: nativeViews.filter((v) => v.starter).map(toRow),
      bench: nativeViews.filter((v) => v.key === "BN").map(toRow),
      reserve: nativeViews.filter((v) => v.key === "IR" || v.key === "TAXI").map(toRow),
      views: nativeViews,
    };
  }, [isNative, nativeViews, playersById]);

  const currentLineup = nativeDisplayLineup ?? hostLineup;

  // Native testing may advance league week ahead of the NFL calendar — allow edits
  // for the lineup week being viewed when the server says canEdit.
  const nativeWeekEditable = Boolean(
    isNative && nativeLineup?.canEdit && Number(nativeLineup.week) === Number(activeWeek),
  );
  const canEditLineup = Boolean(
    nativeWeekEditable && linkId && !showOptimized && !(isPastWeek && !isNative),
  );

  const projectPlayer = (p: Player) => projectFor(sleeperIdFor(p));

  /** Hide optimize once any current starter's NFL game has started (or finished). */
  const startersLocked = useMemo(() => {
    for (const row of currentLineup.starters) {
      if (!row.player) continue;
      if (playerIsLocked(row.player, progressByNflTeam, activeWeek, isPastWeek)) return true;
    }
    return false;
  }, [currentLineup.starters, progressByNflTeam, activeWeek, isPastWeek]);

  const persistNativeLineup = async (nextViews: NativeLineupSlotView[]) => {
    if (!linkId || !nativeLineup || savingLineup) return;
    setSavingLineup(true);
    try {
      const result = await saveNativeLineup({
        data: {
          linkId,
          week: nativeLineup.week,
          version: nativeVersion,
          slots: slotsRecordFromViews(nextViews),
          posById,
          injuryById,
          teamByPlayerId,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        await queryClient.invalidateQueries({ queryKey: ["native-lineup", linkId, activeWeek] });
        return;
      }
      if (result.version != null) setNativeVersion(result.version);
      toast.success("Lineup saved.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["native-lineup", linkId] }),
        queryClient.invalidateQueries({ queryKey: ["active-matchups", linkId] }),
        queryClient.invalidateQueries({ queryKey: ["league-rosters", linkId] }),
        queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save lineup.");
    } finally {
      setSavingLineup(false);
    }
  };

  const onSwapAction = (rowKey: string) => {
    if (!canEditLineup || savingLineup) return;
    const views = nativeViews;
    const idx = views.findIndex((v) => viewKey(v) === rowKey);
    if (idx < 0) return;
    const row = views[idx]!;
    const player = row.playerId ? playersById.get(row.playerId) : null;
    if (playerIsLocked(player, progressByNflTeam, activeWeek, isPastWeek)) {
      toast.error("That player is locked — their game has started.");
      return;
    }

    if (selectedKey == null) {
      if (!row.playerId) return;
      setSelectedKey(rowKey);
      return;
    }
    if (selectedKey === rowKey) {
      setSelectedKey(null);
      return;
    }

    const from = views.findIndex((v) => viewKey(v) === selectedKey);
    const to = idx;
    if (from < 0) {
      setSelectedKey(null);
      return;
    }
    const fromRow = views[from]!;
    const toRow = views[to]!;
    const fromPlayer = fromRow.playerId ? playersById.get(fromRow.playerId) : null;
    const toPlayer = toRow.playerId ? playersById.get(toRow.playerId) : null;
    if (playerIsLocked(fromPlayer, progressByNflTeam, activeWeek, isPastWeek)) {
      toast.error("Selected player is locked.");
      setSelectedKey(null);
      return;
    }
    if (playerIsLocked(toPlayer, progressByNflTeam, activeWeek, isPastWeek)) {
      toast.error("That slot is locked — their game has started.");
      return;
    }

    // Starter slots must accept the incoming player (bench/IR accept anyone).
    if (toRow.starter && fromPlayer && !slotAcceptsPos(toRow.key, fromPlayer.pos)) {
      toast.error(`${fromPlayer.pos} cannot start in ${toRow.key === "DEF" ? "DST" : toRow.key}.`);
      return;
    }
    if (fromRow.starter && toPlayer && !slotAcceptsPos(fromRow.key, toPlayer.pos)) {
      toast.error(`${toPlayer.pos} cannot start in ${fromRow.key === "DEF" ? "DST" : fromRow.key}.`);
      return;
    }

    const next = views.map((v) => ({ ...v }));
    const a = next[from]!;
    const b = next[to]!;
    const tmp = a.playerId;
    a.playerId = b.playerId;
    b.playerId = tmp;
    setNativeViews(next);
    setSelectedKey(null);
    void persistNativeLineup(next);
  };

  const isEligibleTarget = (rowKey: string): boolean => {
    if (!selectedKey || selectedKey === rowKey) return false;
    const from = nativeViews.find((v) => viewKey(v) === selectedKey);
    const to = nativeViews.find((v) => viewKey(v) === rowKey);
    if (!from || !to) return false;
    const fromPlayer = from.playerId ? playersById.get(from.playerId) : null;
    const toPlayer = to.playerId ? playersById.get(to.playerId) : null;
    if (playerIsLocked(toPlayer, progressByNflTeam, activeWeek, isPastWeek)) return false;
    if (to.starter && fromPlayer && !slotAcceptsPos(to.key, fromPlayer.pos)) return false;
    if (from.starter && toPlayer && !slotAcceptsPos(from.key, toPlayer.pos)) return false;
    return true;
  };

  const optimizePlan = useMemo(() => {
    if (!myTeam || startersLocked) return null;
    if (!isNative && !isCurrentWeek) return null;
    if (isNative && !nativeWeekEditable) return null;
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
    isNative,
    isCurrentWeek,
    nativeWeekEditable,
    startersLocked,
    rosterPositions,
    currentLineup.starters,
    projectFor,
    sleeperIdFor,
  ]);

  useEffect(() => {
    if (!optimizePlan || startersLocked) setShowOptimized(false);
  }, [optimizePlan, startersLocked]);

  useEffect(() => {
    if (showOptimized) setSelectedKey(null);
  }, [showOptimized]);

  const applyNativeOptimize = async () => {
    if (!isNative || !linkId || !nativeLineup || !optimizePlan || savingLineup) return;
    const counts = parseRosterSlotCounts(nativeLineup.rosterSlots);
    const views = expandLineupSlots(counts);
    const starterQueues = new Map<string, string[]>();
    for (const row of optimizePlan.lineup.starters) {
      if (!row.player) continue;
      const key = (row.slot === "DST" ? "DEF" : row.slot) as RosterSlotKey;
      const q = starterQueues.get(key) ?? [];
      q.push(row.player.id);
      starterQueues.set(key, q);
    }
    for (const v of views) {
      if (!v.starter) continue;
      const q = starterQueues.get(v.key);
      if (q?.length) v.playerId = q.shift() ?? null;
    }
    const benchIds = optimizePlan.lineup.bench
      .map((r) => r.player?.id)
      .filter((id): id is string => Boolean(id));
    const irIds = optimizePlan.lineup.reserve
      .map((r) => r.player?.id)
      .filter((id): id is string => Boolean(id));
    for (const v of views) {
      if (v.playerId) continue;
      if (v.key === "BN" && benchIds.length) v.playerId = benchIds.shift() ?? null;
      else if ((v.key === "IR" || v.key === "TAXI") && irIds.length) {
        v.playerId = irIds.shift() ?? null;
      }
    }
    // Spill any leftover bench ids into empty BN slots.
    for (const v of views) {
      if (v.playerId || v.key !== "BN") continue;
      if (!benchIds.length) break;
      v.playerId = benchIds.shift() ?? null;
    }
    setNativeViews(views);
    setShowOptimized(false);
    await persistNativeLineup(views);
  };

  const onOptimizeClick = () => {
    if (isNative) {
      void applyNativeOptimize();
      return;
    }
    setShowOptimized((v) => !v);
  };

  const lineup =
    !isNative && showOptimized && optimizePlan ? optimizePlan.lineup : currentLineup;

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
    !isNative && showOptimized && optimizePlan
      ? optimizePlan.optimalTotal
      : myProjectedBase;
  const oppProjected = sumStarterProj(opponent);

  const scorePlayerOnEntry = (entry: WeeklyMatchupEntry | null, p: Player): number => {
    if (!entry) return 0;
    const host = entryPoints(entry, p.id);
    if (host !== 0) return host;
    const scored = scoreActualLine(statsFor(sleeperIdFor(p)), scoringMap);
    return scored ?? host;
  };

  const sumStarterActuals = (
    entry: WeeklyMatchupEntry | null,
    starters: LineupRow[],
  ): number | null => {
    if (!entry) return null;
    let sum = 0;
    let saw = false;
    for (const row of starters) {
      if (!row.player) continue;
      sum += scorePlayerOnEntry(entry, row.player);
      saw = true;
    }
    if (saw) return Math.round(sum * 100) / 100;
    return Number(entry.points) || 0;
  };

  /** Header totals follow the same live starter scores as the lineup rows. */
  const myLivePoints = sumStarterActuals(mine, currentLineup.starters);
  const oppLivePoints = opponent
    ? sumStarterActuals(
        opponent,
        resolveEntryLineup(opponent, slotLabels(rosterPositions), playersById).starters,
      )
    : null;

  let matchupStatus: { label: string; className: string } | null = null;
  if (mine && opponent) {
    if (isPastWeek) {
      const result = matchupViewerResult(
        myLivePoints ?? mine.points,
        oppLivePoints ?? opponent.points,
      );
      matchupStatus =
        result === "won"
          ? { label: "Won", className: "text-emerald-500" }
          : result === "lost"
            ? { label: "Lost", className: "text-red-500" }
            : { label: "Tie", className: "text-m-muted" };
    } else {
      const oppStarters = resolveEntryLineup(
        opponent,
        slotLabels(rosterPositions),
        playersById,
      ).starters;
      const clock = matchupClockStatus(
        [
          ...currentLineup.starters.map((r) => r.player),
          ...oppStarters.map((r) => r.player),
        ],
        progressByNflTeam,
        activeWeek,
      );
      matchupStatus =
        clock === "live"
          ? { label: "Live", className: "text-m-accent" }
          : clock === "final"
            ? { label: "Final", className: "text-m-card-fg" }
            : { label: "Pre-Game", className: "text-m-muted" };
    }
  }

  const rowProps: RowHelpers = {
    pointsFor: (p) => {
      if (!mine) return null;
      return scorePlayerOnEntry(mine, p);
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
      <Toaster />
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
                      <Score
                        value={myLivePoints ?? mine?.points ?? null}
                        className="font-display text-[34px] font-extrabold italic leading-none"
                      />
                      <p
                        className={
                          "mt-1 text-sm tabnum " +
                          (!isNative && showOptimized && optimizePlan
                            ? "font-semibold text-emerald-600"
                            : "text-m-muted")
                        }
                      >
                        {myProjected != null ? myProjected.toFixed(2) : "-"}
                      </p>
                    </div>
                    <span className="font-display text-sm font-bold text-m-muted">vs</span>
                    <div>
                      <Score
                        value={oppLivePoints ?? opponent?.points ?? null}
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
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1",
                  matchupStatus?.className ?? "text-m-muted",
                )}
              >
                {matchupStatus?.label ?? ""}
                <ChevronRight className="size-5 text-m-muted" />
              </span>
            </Link>
          </div>

          {optimizePlan ? (
            <div className="pointer-events-none absolute left-1/2 top-full z-20 -translate-x-1/2 -translate-y-[14px]">
              <button
                type="button"
                onClick={onOptimizeClick}
                disabled={isNative && savingLineup}
                aria-pressed={!isNative && showOptimized}
                aria-label={
                  isNative
                    ? `Optimize and save lineup, plus ${optimizePlan.gain.toFixed(2)} projected points`
                    : showOptimized
                      ? "Show your current set lineup"
                      : `Preview optimized lineup, plus ${optimizePlan.gain.toFixed(2)} projected points`
                }
                className={
                  "pointer-events-auto relative inline-flex h-[44px] max-w-[min(100vw-2rem,22rem)] items-stretch overflow-hidden rounded-[14px] " +
                  "shadow-[0_3px_0_0_#1a3d2e,0_6px_12px_rgba(0,0,0,0.18)] disabled:opacity-60"
                }
              >
                {/* Invisible +gain keeps full two-tone width when Optimized (synced preview only). */}
                <span
                  className={
                    "flex h-full shrink-0 items-center whitespace-nowrap px-3.5 font-display text-[20px] font-extrabold italic leading-none tabular-nums " +
                    (!isNative && showOptimized ? "invisible" : "bg-[#76c78c] text-white")
                  }
                  aria-hidden={!isNative && showOptimized}
                >
                  +{optimizePlan.gain.toFixed(2)}
                </span>
                <span
                  className={
                    "flex h-full items-center whitespace-nowrap bg-[#2d5a47] font-display text-[15px] font-extrabold italic uppercase tracking-wide text-white " +
                    (!isNative && showOptimized ? "absolute inset-0 justify-center px-5" : "px-4")
                  }
                >
                  {isNative
                    ? savingLineup
                      ? "Saving…"
                      : "Optimize"
                    : showOptimized
                      ? "Optimized"
                      : "Optimize"}
                </span>
              </button>
            </div>
          ) : null}
        </div>

        {optimizePlan ? (
          <>
            {/* Room for the ~22px of badge below the card; fixed so toggle doesn't jump. */}
            <div className="h-8" aria-hidden="true" />
            {!isNative && showOptimized ? (
              <p className="mb-1 text-center text-xs text-m-muted">
                Preview only — tap again for your set lineup
              </p>
            ) : isNative ? (
              <p className="mb-1 text-center text-xs text-m-muted">
                Tap Optimize to set and save the best projected lineup
              </p>
            ) : null}
          </>
        ) : null}

        {canEditLineup ? (
          <p className="mb-2 text-center text-xs text-m-muted">
            {selectedKey
              ? "Tap a highlighted slot to swap or place this player."
              : savingLineup
                ? "Saving lineup…"
                : "Tap the blue arrows to move a player into a starter slot."}
          </p>
        ) : null}
      </div>

      <LineupSection
        title="Starters"
        rows={lineup.starters}
        views={nativeDisplayLineup?.views.filter((v) => v.starter)}
        canEdit={canEditLineup}
        selectedKey={selectedKey}
        isEligibleTarget={isEligibleTarget}
        onSwapAction={onSwapAction}
        {...rowProps}
      />
      <LineupSection
        title="Bench"
        rows={lineup.bench}
        views={nativeDisplayLineup?.views.filter((v) => v.key === "BN")}
        canEdit={canEditLineup}
        selectedKey={selectedKey}
        isEligibleTarget={isEligibleTarget}
        onSwapAction={onSwapAction}
        {...rowProps}
      />
      {lineup.reserve.length ? (
        <LineupSection
          title="Reserve"
          rows={lineup.reserve}
          views={nativeDisplayLineup?.views.filter((v) => v.key === "IR" || v.key === "TAXI")}
          canEdit={canEditLineup}
          selectedKey={selectedKey}
          isEligibleTarget={isEligibleTarget}
          onSwapAction={onSwapAction}
          {...rowProps}
        />
      ) : null}
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

type EditHelpers = {
  views: NativeLineupSlotView[] | undefined;
  canEdit: boolean;
  selectedKey: string | null;
  isEligibleTarget: (rowKey: string) => boolean;
  onSwapAction: (rowKey: string) => void;
};

function LineupSection({
  title,
  rows,
  views,
  canEdit,
  selectedKey,
  isEligibleTarget,
  onSwapAction,
  ...helpers
}: { title: string; rows: LineupRow[] } & RowHelpers & EditHelpers) {
  return (
    <section>
      <h2 className="px-4 pb-3 pt-6 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">
        {title}
      </h2>
      {rows.length ? (
        <div className="space-y-2.5 px-2.5">
          {rows.map((row, i) => {
            const view = views?.[i];
            const rowKey = view ? viewKey(view) : `${row.slot}-${row.player?.id ?? i}`;
            return (
              <LineupCard
                key={rowKey}
                row={row}
                rowKey={rowKey}
                canEdit={Boolean(canEdit && view)}
                selected={selectedKey === rowKey}
                eligibleTarget={Boolean(selectedKey && isEligibleTarget(rowKey))}
                onSwapAction={onSwapAction}
                {...helpers}
              />
            );
          })}
        </div>
      ) : (
        <p className="px-4 text-sm text-m-muted">No players.</p>
      )}
    </section>
  );
}

function LineupCard({
  row,
  rowKey,
  canEdit,
  selected,
  eligibleTarget,
  onSwapAction,
  pointsFor,
  projectedFor,
  posRankFor,
  progressFor: progressOf,
  opponentFor,
  byeWeek,
  playerIdFor,
  showActuals,
}: {
  row: LineupRow;
  rowKey: string;
  canEdit: boolean;
  selected: boolean;
  eligibleTarget: boolean;
  onSwapAction: ((rowKey: string) => void) | undefined;
} & RowHelpers) {
  const openPlayer = useOpenMobilePlayer();
  const player = row.player;
  const progress = player ? progressOf(player) : undefined;
  const locked = player
    ? showActuals || progress?.phase === "in" || progress?.phase === "post"
    : false;

  if (!player) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl bg-m-card px-3 py-4 text-m-card-fg",
          eligibleTarget && "ring-2 ring-[#1a8cff]",
        )}
      >
        <span className="w-8 text-xs font-semibold text-m-muted">{row.slot}</span>
        {canEdit && eligibleTarget ? (
          <button
            type="button"
            aria-label={`Move player into ${row.slot}`}
            onClick={() => onSwapAction?.(rowKey)}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#1a8cff] text-white shadow-[inset_0_-2px_0_#0d6ec9]"
          >
            <ArrowUpDown className="size-5" strokeWidth={2.5} />
          </button>
        ) : (
          <span className="size-11 shrink-0" aria-hidden />
        )}
        <span className="text-sm font-semibold text-m-muted">{row.name ?? "Empty slot"}</span>
      </div>
    );
  }

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
  // DST Sideline (own offense has the ball) → football beside the quarter.
  const showBall = stripShowsFootball(player, progress);

  const showSwap = canEdit && !locked;
  const actionControl = locked ? (
    <span
      className="flex size-11 shrink-0 items-center justify-center text-m-muted"
      aria-label="Locked — game started"
    >
      <Lock className="size-5" strokeWidth={2.25} />
    </span>
  ) : showSwap ? (
    <button
      type="button"
      aria-label={selected ? "Cancel move" : `Move ${shortName(player)}`}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation();
        onSwapAction?.(rowKey);
      }}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-lg text-white shadow-[inset_0_-2px_0_#0d6ec9]",
        selected || eligibleTarget ? "bg-[#0d6ec9]" : "bg-[#1a8cff]",
        selected && "ring-2 ring-offset-2 ring-[#1a8cff]",
      )}
    >
      <ArrowUpDown className="size-5" strokeWidth={2.5} />
    </button>
  ) : (
    <span className="size-11 shrink-0" aria-hidden />
  );

  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl bg-m-card text-m-card-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
        selected && "ring-2 ring-[#1a8cff]",
        eligibleTarget && "ring-2 ring-[#1a8cff]/bg-sky-50/40",
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-3">
        <span className="w-8 shrink-0 text-xs font-semibold text-m-muted">{row.slot}</span>
        {actionControl}
        <div
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5"
          {...(eligibleTarget
            ? {
                role: "button",
                tabIndex: 0,
                onClick: () => onSwapAction?.(rowKey),
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSwapAction?.(rowKey);
                  }
                },
              }
            : playerPressProps(openPlayer, playerIdFor(player)))}
        >
          <div className="relative shrink-0">
            <PlayerAvatar
              id={player.id}
              pos={player.pos}
              team={player.team}
              name={player.name}
              className="size-12"
              logoClassName="hidden"
              {...(player.id.startsWith("espn:")
                ? { src: row.headshot ?? null }
                : { fallbackSrc: row.headshot ?? null })}
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
                  status === "sideline"
                    ? "mt-1 inline-block rounded-full bg-m-chip px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-m-muted"
                    : "mt-1 inline-block rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
                }
              >
                {liveUnitPillLabel(status)}
              </span>
            ) : (
              <p className="mt-1 text-xs italic text-m-muted tabnum">
                {projected != null ? projected.toFixed(2) : "-"}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 bg-m-row-alt px-3 py-1.5 text-[11px] font-semibold text-m-muted">
        <span className="truncate">{strip.game}</span>
        <span className="inline-flex shrink-0 items-center gap-1 uppercase">
          <PossessionStripBadges hasBall={showBall} redZone={strip.redZone && showBall} />
          {strip.status}
        </span>
      </div>
    </article>
  );
}
