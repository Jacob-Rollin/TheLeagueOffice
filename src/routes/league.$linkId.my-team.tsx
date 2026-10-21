import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  FantasyAddButton,
  FantasyBoard,
  FantasyDropButton,
  FantasyMatchupScoreCard,
  FantasyOptimizeButton,
  FantasyPlayerChip,
  FantasySaveLineupButton,
  FantasySectionTitle,
  FantasyWeekSelect,
  MatchupSlotBadge,
  displayPlayerPoints,
  fantasyOutlineBtn,
  fantasyPrimaryBtn,
  formatFantasyProj,
  formatFantasyPts,
  nativeMatchupViewToCard,
} from "@/components/native/fantasy";
import { PLAYER_LIST_HEADER_ROW } from "@/components/research/SortHeader";
import {
  buildProjectedOptimalLineup,
  gameStripLabels,
  progressFor as nflProgressFor,
  scheduleOpponent,
  sumLineupProjection,
  useNflSchedule,
} from "@/components/mobile/league/lineupShared";
import { Toaster } from "@/components/ui/sonner";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { usePositionalDefenseRanks } from "@/hooks/usePositionalDefenseRanks";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { useWeeklyActualStats } from "@/hooks/useWeeklyActualStats";
import type { RosterSlotKey } from "@/lib/league-settings";
import {
  buildDefaultLineupSlots,
  classifyIrStatus,
  parseRosterSlotCounts,
  playerEligibleForIr,
  slotAcceptsPos,
  slotsRecordFromViews,
  viewsFromSlotsRecord,
  type NativeLineupSlotView,
} from "@/lib/native-league-lineup";
import {
  getNativeLeagueBoard,
  getNativeLineup,
  getNativeMatchupWeek,
  getNativeStandings,
  resolveNativeIrViolation,
  saveNativeLineup,
  setNativeTeamAvatar,
} from "@/lib/native-league.functions";
import {
  overlayNativeLiveMatchupScores,
  weeklyStatsMapToRecord,
} from "@/lib/native-live-scoring";
import { NativeTeamLogoPicker } from "@/components/native/NativeTeamLogoPicker";
import { DEFAULT_IR_ALLOWED_STATUSES } from "@/lib/native-league-settings";
import { isNativeLogoKey, resolveNativeTeamAvatarSrc } from "@/lib/native-team-logos";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import type { Player } from "@/lib/players-build";
import type { NflGameProgress } from "@/lib/rolling-live-projection";
import { resolveNativeLiveScore, type ScoringMap } from "@/lib/scoring-map";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/league/$linkId/my-team")({
  ssr: false,
  component: NativeMyTeamPage,
});

const thClass =
  "px-2.5 py-2 text-left text-[10px] font-black uppercase tracking-wider text-slate-500";
const thRightClass =
  "px-2.5 py-2 text-right text-[10px] font-black uppercase tracking-wider text-slate-500";
const tdClass = "px-2.5 py-2.5 align-middle text-sm text-slate-800";
const tdRightClass = "px-2.5 py-2.5 align-middle text-right text-sm tabular-nums text-slate-800";

function viewKey(row: NativeLineupSlotView) {
  return `${row.key}:${row.index}`;
}

function ptsField(format: string): string {
  if (format === "ppr") return "pts_ppr";
  if (format === "std") return "pts_std";
  return "pts_half_ppr";
}

function NativeMyTeamPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const { setActiveLeagueId } = useActiveLeague();
  const queryClient = useQueryClient();
  const modalRef = useRef<PlayerModalHandle>(null);
  const cache = useSleeperPlayers();
  const fallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const players = cache.data?.players ?? fallback.data?.players ?? [];
  const playersById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) map.set(p.id, p);
    return map;
  }, [players]);
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
  const nameById = useMemo(() => {
    const map = new Map<string, { name: string; pos: string; team: string }>();
    for (const p of players) map.set(p.id, { name: p.name, pos: p.pos, team: p.team });
    return map;
  }, [players]);

  useEffect(() => {
    if (linkId) setActiveLeagueId(linkId);
  }, [linkId, setActiveLeagueId]);

  const { data: board } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });

  const [week, setWeek] = useState<number | null>(null);
  const boardWeek = board?.currentWeek ?? null;
  useEffect(() => {
    if (boardWeek == null) return;
    setWeek((prev) => {
      if (prev == null || boardWeek > prev) return Math.min(boardWeek, 18);
      return prev;
    });
  }, [boardWeek]);
  const activeWeek = week ?? boardWeek ?? 1;

  const { data: standings } = useQuery({
    queryKey: ["native-standings", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 30_000,
    queryFn: () => getNativeStandings({ data: { linkId } }),
  });

  const { data: lineup, isLoading } = useQuery({
    queryKey: ["native-lineup", linkId, activeWeek],
    enabled: Boolean(user?.id && linkId),
    staleTime: 15_000,
    retry: false,
    queryFn: () => getNativeLineup({ data: { linkId, week: activeWeek } }),
  });

  const { data: matchupWeek } = useQuery({
    queryKey: ["native-matchup-week", linkId, activeWeek],
    enabled: Boolean(user?.id && linkId && lineup?.draftComplete),
    staleTime: 30_000,
    queryFn: () => getNativeMatchupWeek({ data: { linkId, week: activeWeek } }),
  });

  const lastWeekNum = Math.max(1, activeWeek - 1);
  const { data: lastMatchupWeek } = useQuery({
    queryKey: ["native-matchup-week", linkId, lastWeekNum],
    enabled: Boolean(user?.id && linkId && lineup?.draftComplete && activeWeek > 1),
    staleTime: 60_000,
    queryFn: () => getNativeMatchupWeek({ data: { linkId, week: lastWeekNum } }),
  });

  const isLeagueCurrentWeek = activeWeek === (boardWeek ?? activeWeek);

  const {
    projectFor,
    rankFor,
    sleeperIdFor,
    seasonStats,
    format,
    nflWeek,
    scoringMap,
  } = useLeagueProjections(activeWeek);
  /** Same broadcast client cache as mobile Team — Actions finalize TiDB later. */
  const {
    statsFor: weekStatLine,
    statsById,
    ready: liveStatsReady,
  } = useWeeklyActualStats(activeWeek, { pace: "broadcast" });
  const { progressByNflTeam, currentWeek: nflCurrentWeek } = useNflGameProgress(activeWeek);

  const scoredMatchups = useMemo(() => {
    const base = matchupWeek?.matchups ?? [];
    if (!isLeagueCurrentWeek) return base;
    const stats = weeklyStatsMapToRecord(statsById);
    const starters = matchupWeek?.startersByTeamId ?? {};
    const scoring = (matchupWeek?.scoringSettings ?? {}) as ScoringMap;
    if (!stats) return base;
    return overlayNativeLiveMatchupScores(base, starters, stats, scoring);
  }, [
    matchupWeek?.matchups,
    matchupWeek?.startersByTeamId,
    matchupWeek?.scoringSettings,
    statsById,
    isLeagueCurrentWeek,
  ]);
  const { data: schedule = [] } = useNflSchedule();
  const { rankFor: defenseRankFor } = usePositionalDefenseRanks();

  const projectPlayer = (player: Player) => {
    const id = sleeperIdFor(player);
    const v = projectFor(id);
    return v != null && Number.isFinite(v) ? v : null;
  };

  const [views, setViews] = useState<NativeLineupSlotView[]>([]);
  const [version, setVersion] = useState(0);
  const [rosterVersion, setRosterVersion] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [activateDropFor, setActivateDropFor] = useState<string | null>(null);
  const [dropPick, setDropPick] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);

  const allowedStatuses = useMemo(
    () =>
      lineup?.irAllowedStatuses?.length
        ? lineup.irAllowedStatuses
        : DEFAULT_IR_ALLOWED_STATUSES,
    [lineup?.irAllowedStatuses],
  );

  useEffect(() => {
    if (!lineup) return;
    const counts = parseRosterSlotCounts(lineup.rosterSlots);
    if (lineup.slots) {
      setViews(viewsFromSlotsRecord(counts, lineup.slots));
      setDirty(false);
    } else if (lineup.rosterPlayerIds.length > 0 && Object.keys(posById).length > 0) {
      const defaults = buildDefaultLineupSlots(lineup.rosterPlayerIds, posById, counts, {
        injuryById,
        irAllowedStatuses: allowedStatuses,
      });
      setViews(viewsFromSlotsRecord(counts, defaults));
      setDirty(true);
    } else {
      setViews(viewsFromSlotsRecord(counts, {}));
      setDirty(false);
    }
    setVersion(lineup.version);
    setRosterVersion(lineup.rosterVersion);
    setSelectedKey(null);
    setActivateDropFor(null);
    setDropPick("");
  }, [lineup, posById, injuryById, allowedStatuses]);

  const ineligibleIr = useMemo(() => {
    const ids = lineup?.irPlayerIds ?? [];
    return ids
      .filter((id) => !playerEligibleForIr(injuryById[id], allowedStatuses))
      .map((playerId) => ({
        playerId,
        injury: injuryById[playerId] ?? null,
      }));
  }, [lineup?.irPlayerIds, injuryById, allowedStatuses]);
  const hasIrViolations = ineligibleIr.length > 0;
  const activeFull =
    (lineup?.activePlayerIds.length ?? 0) >= (lineup?.rosterCapacity ?? 0);

  const selectedIndex = views.findIndex((v) => viewKey(v) === selectedKey);
  const selectedRow = selectedIndex >= 0 ? views[selectedIndex] : null;
  const selectedPos = selectedRow?.playerId
    ? posById[selectedRow.playerId] ?? ""
    : "";

  const myTeamId = lineup?.teamId ?? board?.summary.teamId ?? null;
  const myStanding = useMemo(() => {
    if (!standings?.standings?.length || myTeamId == null) return null;
    return standings.standings.find((r) => r.teamId === myTeamId) ?? null;
  }, [standings?.standings, myTeamId]);

  const myTeamMeta = useMemo(
    () => board?.teams.find((t) => t.id === myTeamId) ?? null,
    [board?.teams, myTeamId],
  );

  const findMyMatchup = (list: typeof scoredMatchups) =>
    list.find((m) => m.home.teamId === myTeamId || m.away.teamId === myTeamId) ?? null;

  const thisMatchup = findMyMatchup(scoredMatchups);
  const lastMatchup = useMemo(() => {
    const base = lastMatchupWeek?.matchups ?? [];
    return findMyMatchup(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMatchupWeek?.matchups, myTeamId]);

  const myPlayerPoints = useMemo(() => {
    if (!thisMatchup || myTeamId == null) return {} as Record<string, number>;
    const side = thisMatchup.home.teamId === myTeamId ? thisMatchup.home : thisMatchup.away;
    return side.playerPoints ?? {};
  }, [thisMatchup, myTeamId]);

  /** Browser Sleeper week-stats first; TiDB host points are finalize-only (mobile parity). */
  const actualPointsFor = (player: Player): number => {
    const sid = sleeperIdFor(player);
    const host = myPlayerPoints[player.id] ?? myPlayerPoints[sid];
    return resolveNativeLiveScore(host, weekStatLine(sid), scoringMap);
  };

  const showActuals = nflCurrentWeek != null && activeWeek < nflCurrentWeek;

  const liveActive = Boolean(isLeagueCurrentWeek && liveStatsReady);

  const isPlayerLocked = (player: Player | null | undefined) => {
    if (!player) return false;
    if (nflCurrentWeek != null && activeWeek < nflCurrentWeek) return true;
    // Bye-week players stay movable so managers can swap them out.
    if (player.bye != null && Number(player.bye) === Number(activeWeek)) return false;
    const team = String(player.team ?? "").trim().toUpperCase();
    if (!team || team === "FA") return false;
    const progress = nflProgressFor(player.team || "", progressByNflTeam);
    return progress?.phase === "in" || progress?.phase === "post";
  };

  const slotEligible = (target: NativeLineupSlotView) => {
    if (!selectedRow?.playerId) return false;
    if (viewKey(target) === selectedKey) return true;
    if (!slotAcceptsPos(target.key, selectedPos)) return false;
    if (target.key === "IR") {
      return playerEligibleForIr(injuryById[selectedRow.playerId], allowedStatuses);
    }
    return true;
  };

  const onSlotClick = (row: NativeLineupSlotView) => {
    if (!lineup?.canEdit || hasIrViolations) return;
    const key = viewKey(row);
    if (selectedKey == null) {
      if (!row.playerId) return;
      const player = playersById.get(row.playerId);
      if (isPlayerLocked(player)) {
        toast.error("That player’s game has started.");
        return;
      }
      setSelectedKey(key);
      return;
    }
    if (selectedKey === key) {
      setSelectedKey(null);
      return;
    }
    const from = selectedIndex;
    const to = views.findIndex((v) => viewKey(v) === key);
    if (from < 0 || to < 0) {
      setSelectedKey(null);
      return;
    }
    const fromRow = views[from]!;
    const toRow = views[to]!;
    if (fromRow.playerId) {
      const moving = playersById.get(fromRow.playerId);
      if (isPlayerLocked(moving)) {
        toast.error("That player’s game has started.");
        setSelectedKey(null);
        return;
      }
    }
    if (toRow.playerId) {
      const sitting = playersById.get(toRow.playerId);
      if (isPlayerLocked(sitting)) {
        toast.error("Cannot swap with a locked player.");
        setSelectedKey(null);
        return;
      }
    }
    if (!slotEligible(toRow)) {
      toast.error("That player cannot fill this slot.");
      return;
    }
    // Also verify reverse eligibility when swapping occupied slots.
    if (toRow.playerId && fromRow.key) {
      const otherPos = posById[toRow.playerId] ?? "";
      if (!slotAcceptsPos(fromRow.key, otherPos)) {
        toast.error("Swap is not legal for these slots.");
        return;
      }
      if (fromRow.key === "IR" && !playerEligibleForIr(injuryById[toRow.playerId], allowedStatuses)) {
        toast.error("That player is not IR-eligible.");
        return;
      }
    }
    setViews((prev) => {
      const next = prev.map((v) => ({ ...v }));
      const a = next[from]!;
      const b = next[to]!;
      const tmp = a.playerId;
      a.playerId = b.playerId;
      b.playerId = tmp;
      return next;
    });
    setDirty(true);
    setSelectedKey(null);
  };

  const refreshLineup = async () => {
    await queryClient.invalidateQueries({ queryKey: ["native-lineup", linkId] });
    await queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] });
  };

  const resolveIr = async (
    playerId: string,
    action: "drop" | "activate",
    dropPlayerId?: string | null,
  ) => {
    if (!lineup?.canEdit || resolvingId) return;
    setResolvingId(playerId);
    try {
      const result = await resolveNativeIrViolation({
        data: {
          linkId,
          playerId,
          action,
          dropPlayerId: dropPlayerId ?? null,
          rosterVersion,
        },
      });
      if (!result.ok) {
        if (result.requiresDrop) {
          setActivateDropFor(playerId);
          toast.error(result.error);
        } else {
          toast.error(result.error);
        }
        return;
      }
      if (result.rosterVersion != null) setRosterVersion(result.rosterVersion);
      setActivateDropFor(null);
      setDropPick("");
      toast.success(action === "drop" ? "Player dropped from IR." : "Player moved off IR.");
      await refreshLineup();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve IR status.");
    } finally {
      setResolvingId(null);
    }
  };

  const save = async (nextViews?: NativeLineupSlotView[]) => {
    if (!lineup?.canEdit || saving || hasIrViolations) return false;
    const toSave = nextViews ?? views;
    setSaving(true);
    try {
      const result = await saveNativeLineup({
        data: {
          linkId,
          week: lineup.week ?? activeWeek,
          version,
          slots: slotsRecordFromViews(toSave),
          posById,
          injuryById,
          teamByPlayerId,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      if (result.version != null) setVersion(result.version);
      setDirty(false);
      toast.success("Lineup saved.");
      await queryClient.invalidateQueries({ queryKey: ["native-lineup", linkId] });
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save lineup.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const optimizePlan = useMemo(() => {
    if (!lineup?.canEdit || hasIrViolations || !lineup.draftComplete) return null;
    const starters = views.filter((v) => v.starter);
    const labels = starters.map((v) => (v.key === "DEF" ? "DST" : v.label));
    const pool = views
      .map((v) => (v.playerId ? playersById.get(v.playerId) : null))
      .filter((p): p is Player => Boolean(p));
    if (!pool.length || !labels.length) return null;

    const immovableIds = new Set<string>();
    const pinnedStarters = starters.map((row) => {
      if (!row.playerId) return null;
      const p = playersById.get(row.playerId);
      if (p && isPlayerLocked(p)) {
        immovableIds.add(p.id);
        return p;
      }
      return null;
    });
    for (const row of views) {
      if (!row.playerId) continue;
      const p = playersById.get(row.playerId);
      if (p && isPlayerLocked(p)) immovableIds.add(p.id);
    }

    const optimal = buildProjectedOptimalLineup(labels, pool, projectPlayer, {
      pinnedStarters,
      immovableIds,
    });
    const currentStarterRows = starters.map((row) => ({
      slot: row.label,
      player: row.playerId ? playersById.get(row.playerId) ?? null : null,
    }));
    const currentTotal = sumLineupProjection(currentStarterRows, projectPlayer);
    const gain = Math.round((optimal.total - currentTotal) * 100) / 100;
    if (gain < 0.05) return null;
    return { gain, optimal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, playersById, lineup?.canEdit, hasIrViolations, lineup?.draftComplete, activeWeek, progressByNflTeam]);

  const applyOptimize = async () => {
    if (!optimizePlan || !lineup?.canEdit || optimizing) return;
    setOptimizing(true);
    try {
      const next = views.map((v) => ({ ...v }));
      const lockedByKey = new Map<string, string>();
      for (const v of next) {
        if (!v.playerId) continue;
        const p = playersById.get(v.playerId);
        if (isPlayerLocked(p)) lockedByKey.set(viewKey(v), v.playerId);
      }
      for (const v of next) {
        if (lockedByKey.has(viewKey(v))) continue;
        v.playerId = null;
      }

      const placed = new Set(lockedByKey.values());
      const starterQueues = new Map<string, string[]>();
      for (const row of optimizePlan.optimal.starters) {
        if (!row.player || placed.has(row.player.id)) continue;
        const key = (row.slot === "DST" ? "DEF" : row.slot) as RosterSlotKey;
        const q = starterQueues.get(key) ?? [];
        q.push(row.player.id);
        starterQueues.set(key, q);
      }
      for (const v of next) {
        if (!v.starter || v.playerId) continue;
        const q = starterQueues.get(v.key);
        if (!q?.length) continue;
        const id = q.shift() ?? null;
        if (!id) continue;
        v.playerId = id;
        placed.add(id);
      }

      const leftover = views
        .map((v) => v.playerId)
        .filter((id): id is string => Boolean(id) && !placed.has(id));
      for (const v of next) {
        if (v.playerId || (v.key !== "BN" && v.key !== "IR" && v.key !== "TAXI")) continue;
        if (v.key === "IR") {
          const idx = leftover.findIndex((id) =>
            playerEligibleForIr(injuryById[id], allowedStatuses),
          );
          if (idx < 0) continue;
          v.playerId = leftover.splice(idx, 1)[0] ?? null;
          if (v.playerId) placed.add(v.playerId);
          continue;
        }
        if (!leftover.length) break;
        const id = leftover.shift()!;
        v.playerId = id;
        placed.add(id);
      }
      for (const v of next) {
        if (v.playerId || v.key !== "BN") continue;
        if (!leftover.length) break;
        const id = leftover.shift()!;
        v.playerId = id;
        placed.add(id);
      }

      setViews(next);
      setDirty(true);
      setSelectedKey(null);
      await save(next);
    } finally {
      setOptimizing(false);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading lineup…</p>;
  }

  if (!lineup) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">
          No team seat is linked to your account in this league. Claim a seat from Teams or join with
          an invite code.
        </p>
        <Link
          to="/league/$linkId/teams"
          params={{ linkId }}
          className={`${fantasyOutlineBtn} mt-4 inline-flex`}
        >
          Open Teams
        </Link>
      </div>
    );
  }

  const starters = views.filter((v) => v.starter);
  const bench = views.filter((v) => !v.starter && v.key !== "IR" && v.key !== "TAXI");
  const irRows = views.filter((v) => v.key === "IR" || v.key === "TAXI");
  const dropCandidates = views
    .filter((v) => v.key !== "IR" && v.playerId && v.playerId !== activateDropFor)
    .map((v) => v.playerId!)
    .filter((id, i, arr) => arr.indexOf(id) === i);

  const recordLabel =
    myStanding != null
      ? `${myStanding.wins}-${myStanding.losses}${myStanding.ties ? `-${myStanding.ties}` : ""}`
      : null;
  const rankLabel =
    myStanding != null && myStanding.rank > 0
      ? `${myStanding.rank}${ordinalSuffix(myStanding.rank)} of ${standings?.standings.length ?? board?.summary.teamCount ?? "—"}`
      : null;

  const seasonPtsKey = ptsField(format);
  const avatarSrc = resolveNativeTeamAvatarSrc(myTeamMeta?.avatarUrl, lineup.teamName);
  const avatarPoolKey = isNativeLogoKey(myTeamMeta?.avatarUrl) ? myTeamMeta!.avatarUrl! : null;
  const rowHelpers: RowHelpers = {
    projectPlayer,
    actualPointsFor,
    rankFor,
    sleeperIdFor,
    seasonStats,
    seasonPtsKey,
    schedule,
    activeWeek,
    progressByNflTeam,
    defenseRankFor,
    playersById,
    showActuals,
  };

  const saveTeamLogo = async (key: string) => {
    if (myTeamId == null || logoBusy) return;
    setLogoBusy(true);
    try {
      const result = await setNativeTeamAvatar({
        data: { linkId, teamId: myTeamId, avatarKey: key },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Team logo updated.");
      setLogoOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] });
      void queryClient.invalidateQueries({ queryKey: ["native-league-summary", linkId] });
      void queryClient.invalidateQueries({ queryKey: ["native-league-summaries"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update logo.");
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Toaster />

      {/* Team header */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100"
              title="Change logo"
              onClick={() => setLogoOpen(true)}
            >
              {avatarSrc ? (
                <img src={avatarSrc} alt="" className="size-full object-cover" loading="lazy" />
              ) : (
                <span className="font-display text-lg font-bold uppercase text-slate-500">
                  {(lineup.teamName ?? "TM").slice(0, 2).toUpperCase()}
                </span>
              )}
            </button>
            <div className="min-w-0">
              <h2 className="truncate font-display text-2xl font-bold uppercase tracking-wide text-slate-900 md:text-3xl">
                {lineup.teamName}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {recordLabel ? (
                  <span className="font-semibold text-slate-800">{recordLabel}</span>
                ) : (
                  "Record updates after scored weeks"
                )}
                {rankLabel ? <span className="text-slate-500"> · {rankLabel}</span> : null}
                {myStanding != null ? (
                  <span className="text-slate-500"> · {formatFantasyPts(myStanding.pointsFor)} PF</span>
                ) : null}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-blue-700">
                <button type="button" className="hover:underline" onClick={() => setLogoOpen(true)}>
                  Change logo
                </button>
                <Link to="/league/$linkId/settings" params={{ linkId }} className="hover:underline">
                  Team Settings
                </Link>
                <Link to="/league/$linkId" params={{ linkId }} className="hover:underline">
                  {board?.summary.name ?? "League"}
                </Link>
                <Link to="/league/$linkId/waivers" params={{ linkId }} className="hover:underline">
                  Waivers
                </Link>
                <Link to="/league/$linkId/trades" params={{ linkId }} className="hover:underline">
                  Trades
                </Link>
              </div>
            </div>
          </div>
          <FantasyWeekSelect
            week={activeWeek}
            onWeekChange={setWeek}
            maxWeek={18}
            label={
              nflWeek != null && activeWeek === nflWeek
                ? "This Week"
                : `Week ${activeWeek}`
            }
          />
        </div>
      </section>

      {/* Last / current matchup strip */}
      {lineup.draftComplete ? (
        <div className="grid gap-3 md:grid-cols-2">
          {activeWeek > 1 ? (
            <MatchupMiniCard
              label={`Last · Week ${lastWeekNum}`}
              matchup={lastMatchup}
              myTeamId={myTeamId}
              linkId={linkId}
            />
          ) : null}
          <MatchupMiniCard
            label={
              liveActive
                ? `Live · Week ${activeWeek}`
                : activeWeek === (boardWeek ?? activeWeek)
                  ? `This Week · Week ${activeWeek}`
                  : `Week ${activeWeek}`
            }
            matchup={thisMatchup}
            myTeamId={myTeamId}
            linkId={linkId}
            status={liveActive ? "live" : undefined}
          />
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/league/$linkId/players" params={{ linkId }}>
            <FantasyAddButton>Add</FantasyAddButton>
          </Link>
          <Link to="/league/$linkId/players" params={{ linkId }} className={fantasyOutlineBtn}>
            Drop
          </Link>
          <Link to="/league/$linkId/players" params={{ linkId }} className={fantasyOutlineBtn}>
            IR
          </Link>
          {optimizePlan ? (
            <FantasyOptimizeButton
              gain={optimizePlan.gain}
              busy={optimizing || saving}
              disabled={!lineup.canEdit || hasIrViolations}
              onClick={() => void applyOptimize()}
            />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-slate-500">
            {!lineup.draftComplete
              ? "Lineups unlock after the draft"
              : hasIrViolations
                ? "IR action required"
                : dirty
                  ? "Unsaved changes"
                  : selectedKey
                    ? "Select a slot to swap"
                    : "Click Move, then another slot to swap"}
          </p>
          <FantasySaveLineupButton
            disabled={!lineup.canEdit || saving || !dirty || hasIrViolations}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save Lineup"}
          </FantasySaveLineupButton>
        </div>
      </div>

      {!lineup.draftComplete ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          Finish the draft first, then set your weekly lineup here.
          <div className="mt-3">
            <Link to="/league/$linkId/draft" params={{ linkId }} className={fantasyOutlineBtn}>
              Open Draft
            </Link>
          </div>
        </div>
      ) : (
        <>
          {hasIrViolations ? (
            <IrViolationsPanel
              ineligibleIr={ineligibleIr}
              nameById={nameById}
              playersById={playersById}
              allowedStatuses={allowedStatuses}
              activeFull={activeFull}
              resolvingId={resolvingId}
              activateDropFor={activateDropFor}
              dropPick={dropPick}
              dropCandidates={dropCandidates}
              setActivateDropFor={setActivateDropFor}
              setDropPick={setDropPick}
              resolveIr={resolveIr}
              onOpen={(id) => modalRef.current?.open(id)}
            />
          ) : null}

          <LineupTable
            title="Starters"
            rows={starters}
            selectedKey={selectedKey}
            canEdit={lineup.canEdit && !hasIrViolations}
            slotEligible={slotEligible}
            onSlotClick={onSlotClick}
            onOpen={(id) => modalRef.current?.open(id)}
            isPlayerLocked={isPlayerLocked}
            helpers={rowHelpers}
            showTotals
          />
          <LineupTable
            title="Bench"
            rows={bench}
            selectedKey={selectedKey}
            canEdit={lineup.canEdit && !hasIrViolations}
            slotEligible={slotEligible}
            onSlotClick={onSlotClick}
            onOpen={(id) => modalRef.current?.open(id)}
            isPlayerLocked={isPlayerLocked}
            helpers={rowHelpers}
          />
          {irRows.length > 0 ? (
            <LineupTable
              title="IR / Reserve"
              rows={irRows}
              selectedKey={selectedKey}
              canEdit={lineup.canEdit && !hasIrViolations}
              slotEligible={slotEligible}
              onSlotClick={onSlotClick}
              onOpen={(id) => modalRef.current?.open(id)}
              isPlayerLocked={isPlayerLocked}
              helpers={rowHelpers}
            />
          ) : null}
        </>
      )}

      <PlayerModalHost ref={modalRef} />

      {myTeamId != null ? (
        <NativeTeamLogoPicker
          open={logoOpen}
          onOpenChange={setLogoOpen}
          teamName={lineup.teamName}
          currentKey={avatarPoolKey}
          busy={logoBusy}
          onSelect={saveTeamLogo}
        />
      ) : null}
    </div>
  );
}

function ordinalSuffix(n: number) {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

type MatchupLike = {
  matchupId: number;
  home: { teamId: number; teamName: string; points: number };
  away: { teamId: number; teamName: string; points: number };
};

function MatchupMiniCard({
  label,
  matchup,
  myTeamId,
  linkId,
  status,
}: {
  label: string;
  matchup: MatchupLike | null | undefined;
  myTeamId: number | null;
  linkId: string;
  status?: "live";
}) {
  if (!matchup) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        <p className="mt-2 text-sm text-slate-500">No matchup scheduled.</p>
      </section>
    );
  }
  const card = nativeMatchupViewToCard(matchup);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        <Link
          to="/league/$linkId/matchup"
          params={{ linkId }}
          className="text-xs font-semibold text-blue-700 hover:underline"
        >
          View Matchup
        </Link>
      </div>
      <FantasyMatchupScoreCard
        home={card.home}
        away={card.away}
        myTeamId={myTeamId}
        {...(status ? { status } : {})}
        className="p-4"
      />
    </div>
  );
}

type RowHelpers = {
  projectPlayer: (player: Player) => number | null;
  actualPointsFor: (player: Player) => number;
  rankFor: (playerId: string) => { overall: number | null; pos: number | null };
  sleeperIdFor: (player: { id: string; name: string; pos: string }) => string;
  seasonStats: Map<string, { stats: Record<string, number> }> | undefined;
  seasonPtsKey: string;
  schedule: Parameters<typeof scheduleOpponent>[0];
  activeWeek: number;
  progressByNflTeam: Map<string, NflGameProgress>;
  defenseRankFor: (pos: string | null | undefined, opp: string | null | undefined) => number | null;
  playersById: Map<string, Player>;
  showActuals: boolean;
};

function LineupTable({
  title,
  rows,
  selectedKey,
  canEdit,
  slotEligible,
  onSlotClick,
  onOpen,
  isPlayerLocked,
  helpers,
  showTotals,
}: {
  title: string;
  rows: NativeLineupSlotView[];
  selectedKey: string | null;
  canEdit: boolean;
  slotEligible: (row: NativeLineupSlotView) => boolean;
  onSlotClick: (row: NativeLineupSlotView) => void;
  onOpen: (id: string) => void;
  isPlayerLocked: (player: Player | null | undefined) => boolean;
  helpers: RowHelpers;
  showTotals?: boolean;
}) {
  if (rows.length === 0) return null;

  let projTotal = 0;
  let scoreTotal = 0;
  let fptsTotal = 0;
  let scored = 0;

  const body = rows.map((row) => {
    const key = viewKey(row);
    const player = row.playerId ? helpers.playersById.get(row.playerId) : null;
    const selected = selectedKey === key;
    const eligible = selectedKey != null && slotEligible(row);
    const locked = isPlayerLocked(player);
    const bye =
      player != null &&
      player.bye != null &&
      Number(player.bye) === helpers.activeWeek;
    const opp = bye
      ? "BYE"
      : player
        ? scheduleOpponent(helpers.schedule, helpers.activeWeek, player.team || "")
        : null;
    const progress = player
      ? nflProgressFor(player.team || "", helpers.progressByNflTeam)
      : undefined;
    const strip = gameStripLabels(progress, {
      bye: Boolean(bye),
      opponent: opp,
      team: player?.team ?? null,
    });
    const sid = player ? helpers.sleeperIdFor(player) : null;
    const proj = player ? helpers.projectPlayer(player) : null;
    const rawScore = player ? helpers.actualPointsFor(player) : null;
    const displayScore = displayPlayerPoints(rawScore, progress?.phase, {
      showActuals: helpers.showActuals,
      bye: Boolean(bye),
    });
    const oprk =
      player && opp && opp !== "BYE"
        ? helpers.defenseRankFor(player.pos, opp)
        : null;
    const ranks = sid ? helpers.rankFor(sid) : { overall: null, pos: null };
    const seasonPts =
      sid && helpers.seasonStats?.get(sid)?.stats
        ? Number(helpers.seasonStats.get(sid)!.stats[helpers.seasonPtsKey] ?? NaN)
        : NaN;

    if (proj != null && Number.isFinite(proj)) projTotal += proj;
    if (displayScore != null) {
      scoreTotal += displayScore;
      scored += 1;
    }
    if (Number.isFinite(seasonPts)) fptsTotal += seasonPts;

    return (
      <tr
        key={key}
        className={cn(
          "border-b border-slate-100 last:border-b-0",
          selected && "bg-blue-50",
          !selected && eligible && selectedKey && "bg-emerald-50/70",
          !selected && !eligible && selectedKey && canEdit && "opacity-60",
        )}
      >
        <td className={tdClass}>
          <MatchupSlotBadge slot={row.key} className="mx-0 ring-1 ring-white" />
        </td>
        <td className={cn(tdClass, "min-w-[12rem]")}>
          {row.playerId ? (
            <FantasyPlayerChip
              player={player}
              fallbackName={row.playerId}
              size="sm"
              onClick={() => onOpen(row.playerId!)}
            />
          ) : (
            <span className="text-sm text-slate-400">Empty slot</span>
          )}
        </td>
        <td className={tdClass}>
          {canEdit && row.playerId && !locked ? (
            <button
              type="button"
              onClick={() => onSlotClick(row)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold uppercase tracking-wide",
                selected
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-blue-600 bg-white text-blue-700 hover:bg-blue-50",
              )}
            >
              <ArrowUpDown className="size-3" aria-hidden />
              Move
            </button>
          ) : canEdit && selectedKey && !row.playerId && eligible ? (
            <button
              type="button"
              onClick={() => onSlotClick(row)}
              className="inline-flex items-center rounded-md border border-emerald-600 bg-emerald-50 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-800"
            >
              Here
            </button>
          ) : locked && row.playerId ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Locked
            </span>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>
        <td className={cn(tdClass, "whitespace-nowrap font-medium", bye && "text-slate-400")}>
          {opp ?? "—"}
        </td>
        <td className={cn(tdClass, "whitespace-nowrap text-xs text-slate-600")}>
          {bye ? "Bye" : strip.status || strip.game || "—"}
        </td>
        <td className={tdRightClass}>
          {bye ? "-" : formatFantasyProj(proj)}
        </td>
        <td className={tdRightClass}>
          {formatFantasyPts(displayScore)}
        </td>
        <td
          className={cn(
            tdRightClass,
            oprk != null && oprk <= 10 && "font-semibold text-red-600",
            oprk != null && oprk >= 23 && "font-semibold text-emerald-600",
          )}
        >
          {oprk != null && oprk > 0 ? oprk : "—"}
        </td>
        <td className={tdRightClass}>
          {ranks.pos != null && ranks.pos > 0 && ranks.pos < 900 ? ranks.pos : "—"}
        </td>
        <td className={tdRightClass}>
          {formatFantasyPts(Number.isFinite(seasonPts) ? seasonPts : null)}
        </td>
      </tr>
    );
  });

  return (
    <FantasyBoard title={title} bodyClassName="overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <thead>
          <tr className={PLAYER_LIST_HEADER_ROW}>
            <th className={thClass}>Slot</th>
            <th className={thClass}>Player</th>
            <th className={thClass}>Action</th>
            <th className={thClass}>Opp</th>
            <th className={thClass}>Status</th>
            <th className={thRightClass}>Proj</th>
            <th className={thRightClass}>Score</th>
            <th className={thRightClass}>Oprk</th>
            <th className={thRightClass}>Prk</th>
            <th className={thRightClass}>Fpts</th>
          </tr>
        </thead>
        <tbody>{body}</tbody>
        {showTotals ? (
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50">
              <td className={tdClass} colSpan={5}>
                <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
                  Totals
                </span>
              </td>
              <td className={cn(tdRightClass, "font-semibold")}>{formatFantasyProj(projTotal)}</td>
              <td className={cn(tdRightClass, "font-semibold")}>
                {scored > 0 ? formatFantasyPts(scoreTotal) : "-"}
              </td>
              <td className={tdRightClass} colSpan={2} />
              <td className={cn(tdRightClass, "font-semibold")}>{formatFantasyPts(fptsTotal)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </FantasyBoard>
  );
}

function IrViolationsPanel({
  ineligibleIr,
  nameById,
  playersById,
  allowedStatuses,
  activeFull,
  resolvingId,
  activateDropFor,
  dropPick,
  dropCandidates,
  setActivateDropFor,
  setDropPick,
  resolveIr,
  onOpen,
}: {
  ineligibleIr: Array<{ playerId: string; injury: string | null }>;
  nameById: Map<string, { name: string; pos: string; team: string }>;
  playersById: Map<string, Player>;
  allowedStatuses: readonly string[];
  activeFull: boolean;
  resolvingId: string | null;
  activateDropFor: string | null;
  dropPick: string;
  dropCandidates: string[];
  setActivateDropFor: (id: string | null) => void;
  setDropPick: (id: string) => void;
  resolveIr: (
    playerId: string,
    action: "drop" | "activate",
    dropPlayerId?: string | null,
  ) => Promise<void>;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
      <FantasySectionTitle className="text-red-800">IR action required</FantasySectionTitle>
      <p className="mt-1 text-sm text-red-900/80">
        These players no longer match the commissioner IR tags ({allowedStatuses.join(", ")}). Drop
        them, or move them off IR
        {activeFull ? " by dropping someone else from your active roster" : ""}.
      </p>
      <ul className="mt-3 space-y-3">
        {ineligibleIr.map((row) => {
          const meta = nameById.get(row.playerId);
          const tag = classifyIrStatus(row.injury) ?? row.injury ?? "Healthy";
          const busy = resolvingId === row.playerId;
          const pickingDrop = activateDropFor === row.playerId;
          return (
            <li
              key={row.playerId}
              className="rounded-lg border border-red-200 bg-white px-3 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <FantasyPlayerChip
                    player={playersById.get(row.playerId)}
                    fallbackName={meta?.name ?? row.playerId}
                    onClick={() => onOpen(row.playerId)}
                    trailing={
                      <span className="shrink-0 text-[10px] font-bold uppercase text-red-700">
                        {tag}
                      </span>
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <FantasyDropButton
                    disabled={busy || !!resolvingId}
                    onClick={() => void resolveIr(row.playerId, "drop")}
                  >
                    {busy ? "…" : "Drop"}
                  </FantasyDropButton>
                  <button
                    type="button"
                    className={fantasyOutlineBtn}
                    disabled={busy || !!resolvingId}
                    onClick={() => {
                      if (activeFull) {
                        setActivateDropFor(row.playerId);
                        setDropPick("");
                      } else {
                        void resolveIr(row.playerId, "activate");
                      }
                    }}
                  >
                    Move off IR
                  </button>
                </div>
              </div>
              {pickingDrop ? (
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  <p className="text-xs text-slate-600">
                    Active roster is full. Choose a player to drop so this IR player can be
                    activated.
                  </p>
                  <select
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={dropPick}
                    onChange={(e) => setDropPick(e.target.value)}
                  >
                    <option value="">Select player to drop…</option>
                    {dropCandidates.map((id) => {
                      const m = nameById.get(id);
                      return (
                        <option key={id} value={id}>
                          {m?.name ?? id}
                          {m ? ` (${m.pos === "DEF" ? "DST" : m.pos})` : ""}
                        </option>
                      );
                    })}
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={fantasyPrimaryBtn}
                      disabled={!dropPick || busy}
                      onClick={() => void resolveIr(row.playerId, "activate", dropPick)}
                    >
                      Confirm activate
                    </button>
                    <button
                      type="button"
                      className={fantasyOutlineBtn}
                      disabled={busy}
                      onClick={() => {
                        setActivateDropFor(null);
                        setDropPick("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
