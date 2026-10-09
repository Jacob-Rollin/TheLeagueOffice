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
import { usePositionalDefenseRanks } from "@/hooks/usePositionalDefenseRanks";
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
import { getNativeLeagueBoard, getNativeLineup, saveNativeLineup } from "@/lib/native-league.functions";
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
  formatPlayerFinalBox,
  matchupDefenseParts,
  matchupDefenseToneClass,
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

  const boardQuery = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId: linkId! } }),
  });
  const boardWeek = boardQuery.data?.currentWeek ?? null;

  useEffect(() => {
    if (week != null) return;
    // Native leagues may advance ahead of the NFL calendar — prefer board week.
    const fallback = isNative ? (boardWeek ?? nflWeek) : nflWeek;
    if (fallback != null) setWeek(Math.min(fallback, REGULAR_SEASON_WEEKS));
  }, [week, isNative, boardWeek, nflWeek]);
  const activeWeek = week ?? (isNative ? (boardWeek ?? nflWeek) : nflWeek) ?? 1;

  const { matchups, loading: matchupsLoading } = useActiveMatchups(activeWeek);
  const { progressByNflTeam, currentWeek } = useNflGameProgress(activeWeek);
  const { data: schedule = [] } = useNflSchedule();
  const { scoringMap } = useLeagueScoringMeta();
  const { statsFor } = useWeeklyActualStats(activeWeek);
  const { rankFor: defenseRankFor, avgAllowedFor } = usePositionalDefenseRanks();
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

  const isPlayerLocked = (player: Player | null | undefined) =>
    playerIsLocked(player, progressByNflTeam, activeWeek, isPastWeek);

  /**
   * Hide Optimize when locked players block a full rearrange.
   * Synced: first starter lock (existing parity).
   * Native: any starter/bench/IR lock — locked bench players cannot be promoted,
   * so keep the control off once anyone on the roster is locked.
   */
  const optimizeLockedOut = useMemo(() => {
    const rows = isNative
      ? [...currentLineup.starters, ...currentLineup.bench, ...currentLineup.reserve]
      : currentLineup.starters;
    for (const row of rows) {
      if (!row.player) continue;
      if (isPlayerLocked(row.player)) return true;
    }
    return false;
  }, [
    isNative,
    currentLineup.starters,
    currentLineup.bench,
    currentLineup.reserve,
    progressByNflTeam,
    activeWeek,
    isPastWeek,
  ]);

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
    if (!myTeam || optimizeLockedOut) return null;
    if (!isNative && !isCurrentWeek) return null;
    if (isNative && !nativeWeekEditable) return null;
    const labels = slotLabels(rosterPositions);
    const irIds = new Set((myTeam.ir ?? []).map((p) => p.id));
    const pool = (myTeam.players ?? []).filter((p) => !irIds.has(p.id));
    if (!pool.length || !labels.length) return null;

    // Defense-in-depth: pin any locked players if Optimize still runs (race / clock).
    const immovableIds = new Set<string>();
    const pinnedStarters = currentLineup.starters.map((row) => {
      if (row.player && isPlayerLocked(row.player)) {
        immovableIds.add(row.player.id);
        return row.player;
      }
      return null;
    });
    for (const row of currentLineup.bench) {
      if (row.player && isPlayerLocked(row.player)) immovableIds.add(row.player.id);
    }
    for (const row of currentLineup.reserve) {
      if (row.player && isPlayerLocked(row.player)) immovableIds.add(row.player.id);
    }

    const optimal = buildProjectedOptimalLineup(labels, pool, projectPlayer, {
      pinnedStarters,
      immovableIds,
    });
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
    optimizeLockedOut,
    rosterPositions,
    currentLineup.starters,
    currentLineup.bench,
    currentLineup.reserve,
    progressByNflTeam,
    activeWeek,
    isPastWeek,
    projectFor,
    sleeperIdFor,
  ]);

  useEffect(() => {
    if (!optimizePlan || optimizeLockedOut) setShowOptimized(false);
  }, [optimizePlan, optimizeLockedOut]);

  useEffect(() => {
    if (showOptimized) setSelectedKey(null);
  }, [showOptimized]);

  const applyNativeOptimize = async () => {
    if (!isNative || !linkId || !nativeLineup || !optimizePlan || savingLineup) return;

    // Keep locked players in their exact slots; only rearrange unlocked ones.
    const views = nativeViews.map((v) => ({ ...v }));
    const lockedIdByKey = new Map<string, string>();
    for (const v of views) {
      if (!v.playerId) continue;
      const p = playersById.get(v.playerId);
      if (isPlayerLocked(p)) lockedIdByKey.set(viewKey(v), v.playerId);
    }
    for (const v of views) {
      if (lockedIdByKey.has(viewKey(v))) continue;
      v.playerId = null;
    }

    const placed = new Set(lockedIdByKey.values());
    const starterQueues = new Map<string, string[]>();
    for (const row of optimizePlan.lineup.starters) {
      if (!row.player || placed.has(row.player.id)) continue;
      const key = (row.slot === "DST" ? "DEF" : row.slot) as RosterSlotKey;
      const q = starterQueues.get(key) ?? [];
      q.push(row.player.id);
      starterQueues.set(key, q);
    }
    for (const v of views) {
      if (!v.starter || v.playerId) continue;
      const q = starterQueues.get(v.key);
      if (!q?.length) continue;
      const id = q.shift() ?? null;
      if (!id) continue;
      v.playerId = id;
      placed.add(id);
    }

    const benchIds = optimizePlan.lineup.bench
      .map((r) => r.player?.id)
      .filter((id): id is string => Boolean(id) && !placed.has(id));
    const irIds = optimizePlan.lineup.reserve
      .map((r) => r.player?.id)
      .filter((id): id is string => Boolean(id) && !placed.has(id));
    for (const v of views) {
      if (v.playerId) continue;
      if (v.key === "BN" && benchIds.length) {
        const id = benchIds.shift()!;
        v.playerId = id;
        placed.add(id);
      } else if ((v.key === "IR" || v.key === "TAXI") && irIds.length) {
        const id = irIds.shift()!;
        v.playerId = id;
        placed.add(id);
      }
    }
    for (const v of views) {
      if (v.playerId || v.key !== "BN") continue;
      if (!benchIds.length) break;
      const id = benchIds.shift()!;
      v.playerId = id;
      placed.add(id);
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
    defenseRankFor: (p) => defenseRankFor(p.pos, scheduleOpponent(schedule, activeWeek, p.team)),
    avgAllowedFor: (p) => avgAllowedFor(p.pos, scheduleOpponent(schedule, activeWeek, p.team)),
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
            ) : null}
          </>
        ) : null}

        {canEditLineup && !isNative ? (
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
  defenseRankFor: (p: Player) => number | null;
  avgAllowedFor: (p: Player) => number | null;
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
  defenseRankFor,
  avgAllowedFor,
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

  /**
   * Swap control always uses light-theme header blue so dark mode stays readable
   * (dark `--m-header` is near-black and hides the button).
   */
  const swapBtnClass = (active: boolean) =>
    cn(
      "flex size-10 shrink-0 items-center justify-center rounded-lg text-white shadow-[inset_0_-2px_0_#0e7593]",
      active ? "bg-[#0e7593]" : "bg-[#1ba3c6]",
      active && "ring-2 ring-offset-2 ring-[#1ba3c6] ring-offset-m-card",
    );

  if (!player) {
    return (
      <div
        className={cn(
          "flex items-center rounded-xl bg-m-card px-2.5 py-4 text-m-card-fg",
          eligibleTarget && "ring-2 ring-m-header",
        )}
      >
        <span className="w-9 shrink-0 text-[11px] font-semibold uppercase text-m-muted">
          {row.slot}
        </span>
        {canEdit ? (
          <div className="mr-3 shrink-0">
            {eligibleTarget ? (
              <button
                type="button"
                aria-label={`Move player into ${row.slot}`}
                onClick={() => onSwapAction?.(rowKey)}
                className={swapBtnClass(true)}
              >
                <ArrowUpDown className="size-5" strokeWidth={2.5} />
              </button>
            ) : (
              <span className="size-10 shrink-0" aria-hidden />
            )}
          </div>
        ) : null}
        <span className="text-sm font-semibold text-m-muted">{row.name ?? "Empty slot"}</span>
      </div>
    );
  }

  const points = locked ? pointsFor(player) : null;
  const projected = projectedFor(player);
  const posRank = posRankFor(player);
  const logo = teamLogo(player.team);
  const status = possessionPill(player, progress);
  const opponentLabel = opponentFor(player);
  const isBye = byeWeek(player);
  const strip = gameStripLabels(progress, {
    bye: isBye,
    opponent: opponentLabel,
    team: player.team,
  });
  // Skill/K on offense, DST on defense (not Sideline).
  const showBall = stripShowsFootball(player, progress);
  const phase = progress?.phase ?? "pre";
  const isLive = phase === "in";
  const isFinal = phase === "post" || (showActuals && phase !== "pre" && phase !== "in");
  // Pre-game matchup context only — live/final use clock/score footers instead.
  const showMatchupContext = !showActuals && !isBye && phase === "pre";
  const defenseParts = showMatchupContext
    ? matchupDefenseParts({
        opponentLabel,
        pos: player.pos,
        defenseRank: defenseRankFor(player),
      })
    : null;
  const avgAllowed = showMatchupContext ? avgAllowedFor(player) : null;
  const finalBox =
    isFinal || (showActuals && !isLive)
      ? formatPlayerFinalBox(progress?.boxScoreLabel ?? strip.game, player.team)
      : null;

  const showSwap = canEdit && !locked;
  /** Native editable: always reserve a size-10 rail (swap / lock / spacer). */
  const actionControl = !canEdit ? null : locked ? (
    <span
      className="flex size-10 shrink-0 items-center justify-center text-m-muted"
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
      className={swapBtnClass(selected || eligibleTarget)}
    >
      <ArrowUpDown className="size-5" strokeWidth={2.5} />
    </button>
  ) : (
    <span className="size-10 shrink-0" aria-hidden />
  );

  const gameFinal = Boolean(isFinal || (showActuals && !isLive && !isBye));

  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl text-m-card-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
        gameFinal ? "bg-m-bg" : "bg-m-card",
        selected && "ring-2 ring-m-header",
        eligibleTarget && "ring-2 ring-m-header bg-m-highlight",
      )}
    >
      <div className="flex items-center px-2.5 py-3">
        <span className="w-9 shrink-0 text-[11px] font-semibold uppercase text-m-muted">
          {row.slot === "DEF" ? "DST" : row.slot}
        </span>
        {actionControl ? <div className="mr-3 shrink-0">{actionControl}</div> : null}
        <div
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
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
              <span className="absolute -left-1 -top-1 z-[1] flex size-5 items-center justify-center rounded-full border border-black/15 bg-white font-display text-[10px] font-bold text-black shadow-sm">
                {posRank}
              </span>
            ) : null}
            {/* Synced leagues have no swap rail — pin lock on the avatar so rows stay aligned. */}
            {!canEdit && locked ? (
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 z-[1] flex size-5 items-center justify-center rounded-full text-m-muted shadow-sm ring-1 ring-m-border",
                  gameFinal ? "bg-m-bg" : "bg-m-card",
                )}
                aria-label="Locked — game started"
              >
                <Lock className="size-3" strokeWidth={2.5} />
              </span>
            ) : null}
            <InjuryAvatarBadge status={player.injury_status ?? player.injury} />
          </div>
          {/* Keep the logo chip for DST too so names align with skill positions. */}
          {logo ? (
            <img src={logo} alt="" className="size-8 shrink-0 rounded-full bg-m-chip object-contain p-1" />
          ) : (
            <span className="size-8 shrink-0" aria-hidden />
          )}
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
      {isFinal || (showActuals && !isLive) ? (
        <div className="flex items-center justify-center gap-3 bg-m-row-alt px-2.5 py-1.5 text-[11px] text-m-card-fg">
          <span className="min-w-0 truncate text-center font-semibold">
            {finalBox?.scoreLine || strip.game || "Final"}
          </span>
          <span className="shrink-0 font-bold uppercase tracking-wide text-black [.mobile-theme-dark_&]:text-white">
            {finalBox?.resultLabel || strip.status || "Final"}
          </span>
        </div>
      ) : isLive ? (
        <div className="flex items-center gap-2 bg-m-row-alt px-2.5 py-1.5 text-[11px] font-semibold text-m-muted">
          <span className="max-w-[40%] shrink-0 truncate text-m-card-fg">{strip.game || "Live"}</span>
          <span className="min-w-0 flex-1 truncate text-center uppercase tracking-wide text-m-card-fg">
            {strip.status}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 uppercase">
            <PossessionStripBadges hasBall={showBall} redZone={strip.redZone && showBall} />
          </span>
        </div>
      ) : showMatchupContext ? (
        <div className="flex items-center gap-2 bg-m-row-alt px-2.5 py-1.5 text-[11px] font-semibold text-m-muted">
          <span className="max-w-[28%] shrink-0 truncate text-m-card-fg">{strip.game || "—"}</span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-center uppercase tracking-wide",
              defenseParts ? matchupDefenseToneClass(defenseParts.rank) : "",
            )}
          >
            {defenseParts
              ? defenseParts.rank != null
                ? `${defenseParts.prefix} ${defenseParts.abbr} #${defenseParts.rank} vs ${defenseParts.pos}`
                : `${defenseParts.prefix} ${defenseParts.abbr}${defenseParts.pos ? ` vs ${defenseParts.pos}` : ""}`
              : ""}
          </span>
          <span className="max-w-[40%] shrink-0 text-right leading-tight">
            <span className="block text-[9px] font-medium normal-case tracking-normal text-m-muted/90">
              avg allowed to position
            </span>
            <span className="tabnum font-bold text-m-card-fg">
              {avgAllowed != null ? avgAllowed.toFixed(1) : "—"}
            </span>
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 bg-m-row-alt px-2.5 py-1.5 text-[11px] font-semibold text-m-muted">
          <span className="truncate">{strip.game}</span>
          <span className="inline-flex shrink-0 items-center gap-1 uppercase">
            <PossessionStripBadges hasBall={showBall} redZone={strip.redZone && showBall} />
            {strip.status}
          </span>
        </div>
      )}
    </article>
  );
}
