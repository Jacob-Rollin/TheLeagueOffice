import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, ChevronDown, Minus, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PlayerAvatar, teamLogo } from "@/components/draft/PlayerAvatar";
import { InjuryAvatarBadge } from "@/components/injury/InjuryAvatarBadge";
import { playerPressProps, useOpenMobilePlayer } from "@/components/mobile/MobilePlayerSheet";
import { Toaster } from "@/components/ui/sonner";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import {
  useLeagueProjections,
  useSeasonProjectionStats,
  useSleeperWeekStats,
  type WeeklyProjRow,
} from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  getNativeLeagueBoard,
  proposeNativeTrade,
  submitNativeFreeAgentDrop,
  submitNativeFreeAgentMove,
} from "@/lib/native-league.functions";
import type { Player } from "@/lib/players-build";
import { projectionPoints } from "@/lib/scoring-map";
import { fetchTrendingAddsClient } from "@/lib/sleeper-trending";
import { cn } from "@/lib/utils";

import {
  HEX_CLIP,
  REGULAR_SEASON_WEEKS,
  gameStripLabels,
  progressFor,
  scheduleOpponent,
  shortName,
  useNflSchedule,
} from "./lineupShared";
import { MobileCenteredConfirm, MobileFullScreenPicker } from "./MobileTransactionModals";

type PosFilter = "ALL" | "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DEF";
type Mode = "projections" | "stats" | "trends";
type Ownership = "all" | "available" | "rostered";
type Action = "add" | "drop" | "trade";

const POS_CHIPS: { id: PosFilter; label: string }[] = [
  { id: "QB", label: "QB" },
  { id: "RB", label: "RB" },
  { id: "WR", label: "WR" },
  { id: "TE", label: "TE" },
  { id: "FLEX", label: "R/W/T" },
  { id: "K", label: "K" },
  { id: "DEF", label: "DEF" },
];
const FLEX_POS = new Set(["RB", "WR", "TE"]);
const PAGE_SIZE = 50;

const matchesPos = (p: Player, pos: PosFilter) =>
  pos === "ALL" || (pos === "FLEX" ? FLEX_POS.has(p.pos) : p.pos === pos);

type TrendRow = { player_id: string; count: number };

function useSleeperTrending(type: "add" | "drop") {
  return useQuery({
    queryKey: ["sleeper-trending-add", "v1", 24, 50, type],
    staleTime: 15 * 60 * 1000,
    retry: false,
    refetchIntervalInBackground: false,
    queryFn: () => fetchTrendingAddsClient(24, 50, type),
  });
}

type Column = { key: string; label: string; value: (p: Player) => number | null; decimals: number };

export function MobilePlayersView() {
  const { activeLeague } = useActiveLeague();
  const queryClient = useQueryClient();
  const isNative = (activeLeague?.platform ?? "").toLowerCase() === "native";
  const linkId = isNative ? (activeLeague?.id ?? null) : null;

  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = useMemo(() => playersPayload?.players ?? [], [playersPayload]);
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const { teams, myTeam, rosteredIds } = useLeagueRosters(players);

  const boardQuery = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId: linkId! } }),
  });
  const board = boardQuery.data ?? null;

  const [trendPos, setTrendPos] = useState<PosFilter>("QB");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<Mode>("stats");
  const [pos, setPos] = useState<PosFilter>("ALL");
  const [ownership, setOwnership] = useState<Ownership>("all");
  const [period, setPeriod] = useState<"season" | number>("season");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const [pendingAdd, setPendingAdd] = useState<Player | null>(null);
  /** Chosen drop while confirming an add on a full roster. */
  const [selectedDrop, setSelectedDrop] = useState<Player | null>(null);
  const [pendingDrop, setPendingDrop] = useState<Player | null>(null);
  const [pendingTrade, setPendingTrade] = useState<Player | null>(null);
  const [tradeGive, setTradeGive] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const projectionWeek = mode === "projections" && period !== "season" ? period : null;
  const { nflWeek, nflSeason, projectFor, rankFor, seasonStats, scoringMap, format } =
    useLeagueProjections(projectionWeek);
  const seasonProjections = useSeasonProjectionStats();
  const currentWeek = nflWeek ?? 1;
  const { progressByNflTeam } = useNflGameProgress(currentWeek);
  const { data: schedule = [] } = useNflSchedule();
  const { data: trendingAdds = [], isLoading: trendingLoading } = useSleeperTrending("add");
  const { data: trendingDrops = [] } = useSleeperTrending("drop");

  const weekStats = useSleeperWeekStats(nflSeason, mode === "stats" && period !== "season" ? period : null);

  const myIds = useMemo(() => new Set((myTeam?.players ?? []).map((p) => p.id)), [myTeam]);
  const ownerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teams) for (const p of t.players) map.set(p.id, t.team);
    return map;
  }, [teams]);
  const ownerTeamIdByPlayer = useMemo(() => {
    const map = new Map<string, number>();
    if (!board) return map;
    for (const [playerId, teamId] of Object.entries(board.ownership ?? {})) {
      map.set(playerId, Number(teamId));
    }
    return map;
  }, [board]);
  const actionFor = (p: Player): Action => (myIds.has(p.id) ? "drop" : rosteredIds.has(p.id) ? "trade" : "add");

  const myTeamId = board?.summary.teamId ?? null;
  const myRoster = board?.rosters.find((r) => r.teamId === myTeamId) ?? null;
  const capacity = board?.rosterCapacity ?? 15;
  const openSlots = myRoster
    ? Math.max(0, capacity - (myRoster.activePlayerIds?.length ?? myRoster.playerIds.length))
    : 0;
  const draftDone = board?.summary.draftStatus === "complete";
  const canMutateNative = Boolean(isNative && linkId && draftDone && myTeamId != null && myRoster);

  const dropCandidates = useMemo(() => {
    if (!myRoster) return [] as Player[];
    return myRoster.playerIds
      .map((id) => playersById.get(id))
      .filter((p): p is Player => Boolean(p));
  }, [myRoster, playersById]);

  const refreshNative = async () => {
    if (!linkId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["league-rosters", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["league-transaction-log", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["native-trades", linkId] }),
    ]);
  };

  const runAdd = async (addPlayerId: string, dropPlayerId: string | null) => {
    if (!linkId || !myRoster || busy) return;
    setBusy(true);
    try {
      const result = await submitNativeFreeAgentMove({
        data: {
          linkId,
          addPlayerId,
          dropPlayerId,
          rosterVersion: myRoster.version,
          addPlayerTeam: playersById.get(addPlayerId)?.team ?? null,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        if (result.requiresDrop) {
          const player = playersById.get(addPlayerId) ?? null;
          setPendingAdd(player);
          setSelectedDrop(null);
        }
        return;
      }
      toast.success(dropPlayerId ? "Add / drop submitted." : "Player added.");
      setPendingAdd(null);
      setSelectedDrop(null);
      await refreshNative();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not complete add.");
    } finally {
      setBusy(false);
    }
  };

  const runDrop = async (playerId: string) => {
    if (!linkId || !myRoster || busy) return;
    setBusy(true);
    try {
      const result = await submitNativeFreeAgentDrop({
        data: { linkId, dropPlayerId: playerId, rosterVersion: myRoster.version },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Player dropped.");
      setPendingDrop(null);
      await refreshNative();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not drop player.");
    } finally {
      setBusy(false);
    }
  };

  const tradePartnerId = pendingTrade ? (ownerTeamIdByPlayer.get(pendingTrade.id) ?? null) : null;
  /** Receiving 1; net active gain is max(0, 1 - giveCount). */
  const tradeSlotNeed = Math.max(0, 1 - tradeGive.length);
  const tradeNeedsSlots = tradeSlotNeed > openSlots;

  const runTrade = async () => {
    if (!linkId || !pendingTrade || tradePartnerId == null || !tradeGive.length || busy) return;
    if (tradeNeedsSlots) {
      const needGive = tradeGive.length + (tradeSlotNeed - openSlots);
      toast.error(
        `Not enough roster space (${openSlots} open of ${capacity}). Give at least ${needGive} player${needGive === 1 ? "" : "s"} for this trade.`,
      );
      return;
    }
    setBusy(true);
    try {
      const result = await proposeNativeTrade({
        data: {
          linkId,
          acceptorTeamId: tradePartnerId,
          givePlayerIds: tradeGive,
          receivePlayerIds: [pendingTrade.id],
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Trade proposed.");
      setPendingTrade(null);
      setTradeGive([]);
      await refreshNative();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not propose trade.");
    } finally {
      setBusy(false);
    }
  };

  const onNativeAction = (player: Player, action: Action) => {
    if (!canMutateNative) {
      toast.error(
        draftDone
          ? "Claim a team seat to manage your roster."
          : "Free-agent moves unlock after the draft is complete.",
      );
      return;
    }
    if (action === "add") {
      if (openSlots > 0) {
        void runAdd(player.id, null);
        return;
      }
      setPendingAdd(player);
      setSelectedDrop(null);
      return;
    }
    if (action === "drop") {
      setPendingDrop(player);
      return;
    }
    // trade
    setPendingTrade(player);
    setTradeGive([]);
  };

  const addsById = useMemo(() => new Map(trendingAdds.map((r) => [r.player_id, r.count])), [trendingAdds]);
  const dropsById = useMemo(() => new Map(trendingDrops.map((r) => [r.player_id, r.count])), [trendingDrops]);

  const scored = (rows: Map<string, WeeklyProjRow> | undefined, id: string) =>
    projectionPoints(rows?.get(id)?.stats, scoringMap, format);

  const columns: { group: string; cols: Column[] } = useMemo(() => {
    if (mode === "trends") {
      return {
        group: "Last 24 Hours",
        cols: [
          { key: "adds", label: "Adds", value: (p) => addsById.get(p.id) ?? null, decimals: 0 },
          { key: "drops", label: "Drops", value: (p) => dropsById.get(p.id) ?? null, decimals: 0 },
        ],
      };
    }
    if (mode === "projections") {
      const value =
        period === "season"
          ? (p: Player) => seasonProjections.projectFor(p.id)
          : (p: Player) => projectFor(p.id);
      return {
        group: "Projected",
        cols: [{ key: "proj", label: period === "season" ? "Season" : `Week ${period}`, value, decimals: 2 }],
      };
    }
    if (period !== "season") {
      return {
        group: "Points",
        cols: [{ key: "week", label: `Week ${period}`, value: (p) => scored(weekStats.data, p.id), decimals: 2 }],
      };
    }
    return {
      group: "Points",
      cols: [
        { key: "season", label: "Season", value: (p) => scored(seasonStats, p.id), decimals: 2 },
        {
          key: "avg",
          label: "Avg",
          value: (p) => {
            const pts = scored(seasonStats, p.id);
            const gp = Number(seasonStats?.get(p.id)?.stats["gp"] ?? 0);
            return pts != null && gp > 0 ? pts / gp : null;
          },
          decimals: 2,
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, period, addsById, dropsById, seasonStats, weekStats.data, scoringMap, format, projectFor, seasonProjections.projectFor]);

  const activeKey = columns.cols.some((c) => c.key === sortKey) ? sortKey! : columns.cols[0]!.key;
  const primary = columns.cols[0]!;

  const posRanks = useMemo(() => {
    const byPos = new Map<string, { id: string; v: number }[]>();
    for (const p of players) {
      const v = primary.value(p);
      if (v == null || v <= 0) continue;
      const list = byPos.get(p.pos) ?? [];
      list.push({ id: p.id, v });
      byPos.set(p.pos, list);
    }
    const ranks = new Map<string, number>();
    for (const list of byPos.values()) {
      list.sort((a, b) => b.v - a.v).forEach((e, i) => ranks.set(e.id, i + 1));
    }
    return ranks;
  }, [players, primary]);

  const tableCols: Column[] = [
    ...columns.cols,
    { key: "pos", label: "Pos Rank", value: (p) => posRanks.get(p.id) ?? null, decimals: 0 },
  ];
  const sortCol = tableCols.find((c) => c.key === activeKey) ?? primary;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = players
      .filter((p) => matchesPos(p, pos))
      .filter((p) =>
        ownership === "available" ? !rosteredIds.has(p.id) : ownership === "rostered" ? rosteredIds.has(p.id) : true,
      )
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .map((p) => ({ p, v: sortCol.value(p) }));
    const asc = sortCol.key === "pos";
    list.sort((a, b) => {
      if (a.v == null) return b.v == null ? 0 : 1;
      if (b.v == null) return -1;
      return asc ? a.v - b.v : b.v - a.v;
    });
    return list.map((r) => r.p);
  }, [players, pos, ownership, rosteredIds, search, sortCol]);

  const mostAdded = useMemo(
    () =>
      trendingAdds
        .map((r) => ({ player: playersById.get(r.player_id), count: r.count }))
        .filter((r): r is { player: Player; count: number } => Boolean(r.player) && matchesPos(r.player!, trendPos))
        .slice(0, 10),
    [trendingAdds, playersById, trendPos],
  );

  const weeks =
    mode === "projections"
      ? Array.from({ length: Math.max(0, REGULAR_SEASON_WEEKS - currentWeek + 1) }, (_, i) => currentWeek + i)
      : Array.from({ length: currentWeek }, (_, i) => currentWeek - i);
  const periodOptions = [
    { value: "season", label: `${nflSeason ?? ""} Season`.trim() },
    ...weeks.map((w) => ({ value: String(w), label: `Week ${w}` })),
  ];

  const helpers = {
    badge: (p: Player) => rankFor(p.id).pos,
    game: (p: Player) =>
      gameStripLabels(progressFor(p.team, progressByNflTeam), {
        bye: p.bye === currentWeek,
        opponent: scheduleOpponent(schedule, currentWeek, p.team),
      }),
  };

  return (
    <main className="pb-6">
      <Toaster />
      <h2 className="px-4 pb-3 pt-5 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">
        Most Added Players
      </h2>
      <ChipRow
        options={POS_CHIPS}
        value={trendPos}
        onChange={(v) => setTrendPos(v)}
        className="px-2.5"
      />
      <div className="mt-3 flex snap-x gap-2.5 overflow-x-auto px-2.5 pb-1 [scrollbar-width:none]">
        {trendingLoading || playersLoading ? (
          <p className="py-8 text-sm text-m-muted">Loading trending players...</p>
        ) : mostAdded.length ? (
          mostAdded.map((r, i) => (
            <TrendingCard
              key={r.player.id}
              index={i + 1}
              player={r.player}
              count={r.count}
              badge={helpers.badge(r.player)}
              owner={ownerById.get(r.player.id) ?? null}
            />
          ))
        ) : (
          <p className="py-8 text-sm text-m-muted">No trending adds at this position.</p>
        )}
      </div>

      <section className="mx-2.5 mt-5 space-y-3 rounded-xl bg-m-card p-3 text-m-card-fg">
        <label className="flex items-center gap-2 rounded-lg border border-m-border px-4 py-3">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(PAGE_SIZE);
            }}
            placeholder="Search by name"
            className="min-w-0 flex-1 bg-transparent text-base text-m-card-fg outline-none placeholder:text-m-muted"
          />
          <Search className="size-5 text-m-muted" />
        </label>

        <ChipRow
          options={[
            { id: "projections", label: "Projections" },
            { id: "stats", label: "Stats" },
            { id: "trends", label: "Trends" },
          ]}
          value={mode}
          onChange={(v) => {
            setMode(v);
            setSortKey(null);
            setPeriod("season");
          }}
        />
        <ChipRow
          options={[{ id: "ALL", label: "All" }, ...POS_CHIPS]}
          value={pos}
          onChange={(v) => {
            setPos(v);
            setLimit(PAGE_SIZE);
          }}
        />

        <div className="grid grid-cols-2 gap-2.5">
          <SelectBox
            label="Filter players by ownership"
            value={ownership}
            options={[
              { value: "all", label: "All Players" },
              { value: "available", label: "Available" },
              { value: "rostered", label: "Rostered" },
            ]}
            onChange={(v) => {
              setOwnership(v as Ownership);
              setLimit(PAGE_SIZE);
            }}
          />
          <SelectBox
            label="Select time period"
            value={String(period)}
            options={mode === "trends" ? periodOptions.slice(0, 1) : periodOptions}
            disabled={mode === "trends"}
            onChange={(v) => setPeriod(v === "season" ? "season" : Number(v))}
          />
        </div>
      </section>

      <h2 className="px-4 pb-3 pt-6 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">
        Filter Results
      </h2>
      <div className="overflow-x-auto bg-m-card text-m-card-fg [scrollbar-width:none]">
        <div className="min-w-max">
          <div className="flex border-b border-m-border text-[11px] font-semibold uppercase tracking-wide text-m-muted">
            <div className="sticky left-0 z-10 w-[230px] shrink-0 bg-m-card" />
            <div className="flex flex-col">
              <span className="px-3 pt-3 pb-1.5 text-center">{columns.group}</span>
              <div className="flex">
                {tableCols.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setSortKey(c.key)}
                    className={cn(
                      "flex w-[88px] items-center justify-end gap-1 px-3 py-2.5 uppercase",
                      c.key === sortCol.key && "bg-m-rank-col text-m-card-fg",
                    )}
                  >
                    {c.key === sortCol.key ? <ChevronDown className="size-3" /> : null}
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {playersLoading ? (
            <p className="px-5 py-10 text-center text-sm text-m-muted">Loading players...</p>
          ) : rows.length ? (
            rows.slice(0, limit).map((p) => (
              <PlayerRow
                key={p.id}
                player={p}
                action={actionFor(p)}
                badge={helpers.badge(p)}
                game={helpers.game(p).game}
                cols={tableCols}
                sortKey={sortCol.key}
                nativeMode={isNative}
                busy={busy}
                onNativeAction={onNativeAction}
              />
            ))
          ) : (
            <p className="px-5 py-10 text-center text-sm text-m-muted">No players match these filters.</p>
          )}
        </div>
      </div>
      {rows.length > limit ? (
        <button
          type="button"
          onClick={() => setLimit((n) => n + PAGE_SIZE)}
          className="mx-2.5 mt-3 w-[calc(100%-1.25rem)] rounded-lg bg-m-select-bg py-3 font-display text-base font-semibold text-m-select-fg"
        >
          Show More
        </button>
      ) : null}

      {pendingAdd && !selectedDrop ? (
        <MobileFullScreenPicker
          title="Choose a drop"
          closeDisabled={busy}
          onClose={() => {
            setPendingAdd(null);
            setSelectedDrop(null);
          }}
          subtitle={
            <>
              Roster full ({capacity}/{capacity}). Tap{" "}
              <span className="font-semibold text-[#e8551f]">−</span> to drop someone and add{" "}
              <span className="font-semibold text-m-card-fg">{pendingAdd.name}</span>.
            </>
          }
        >
          {dropCandidates.length ? (
            dropCandidates.map((p) => (
              <DropCandidateRow
                key={p.id}
                player={p}
                rank={rankFor(p.id).pos}
                disabled={busy}
                onDrop={() => setSelectedDrop(p)}
              />
            ))
          ) : (
            <p className="px-2 py-10 text-center text-sm text-m-muted">No roster players to drop.</p>
          )}
        </MobileFullScreenPicker>
      ) : null}

      {pendingAdd && selectedDrop ? (
        <MobileCenteredConfirm label="Confirm add and drop">
          <h3 className="font-display text-2xl font-bold">Confirm move</h3>
          <p className="mt-2 text-sm text-m-muted">Review the add and drop before submitting.</p>
          <div className="mt-4 space-y-2">
            <ConfirmMoveRow tone="add" player={pendingAdd} />
            <ConfirmMoveRow tone="drop" player={selectedDrop} />
          </div>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-lg border border-m-border py-3 font-display text-base font-semibold"
              disabled={busy}
              onClick={() => setSelectedDrop(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg bg-[#1fae5b] py-3 font-display text-base font-semibold text-white disabled:opacity-60"
              disabled={busy}
              onClick={() => void runAdd(pendingAdd.id, selectedDrop.id)}
            >
              {busy ? "Submitting…" : "Confirm"}
            </button>
          </div>
        </MobileCenteredConfirm>
      ) : null}

      {pendingDrop ? (
        <MobileCenteredConfirm label="Confirm drop">
          <h3 className="font-display text-2xl font-bold">Drop player</h3>
          <p className="mt-2 text-sm text-m-muted">
            Drop <span className="font-semibold text-m-card-fg">{pendingDrop.name}</span> to free
            agency? This uses your league roster settings ({openSlots} open of {capacity}).
          </p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-lg border border-m-border py-3 font-display text-base font-semibold"
              disabled={busy}
              onClick={() => setPendingDrop(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg bg-[#e8551f] py-3 font-display text-base font-semibold text-white disabled:opacity-60"
              disabled={busy}
              onClick={() => void runDrop(pendingDrop.id)}
            >
              {busy ? "Dropping…" : "Confirm drop"}
            </button>
          </div>
        </MobileCenteredConfirm>
      ) : null}

      {pendingTrade ? (
        <MobileCenteredConfirm label="Propose trade">
          <h3 className="font-display text-2xl font-bold">Propose trade</h3>
          <p className="mt-2 text-sm text-m-muted">
            Receive <span className="font-semibold text-m-card-fg">{pendingTrade.name}</span>
            {tradePartnerId != null
              ? ` from ${board?.teams.find((t) => t.id === tradePartnerId)?.teamName ?? "team"}`
              : ""}
            . Select who you give — uneven trades must fit your {capacity}-player roster (
            {openSlots} open).
          </p>
          {tradeNeedsSlots ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Giving {tradeGive.length || "0"} for 1 needs {tradeSlotNeed} open slot
              {tradeSlotNeed === 1 ? "" : "s"}; you have {openSlots}. Add more players on your give
              side.
            </p>
          ) : null}
          <ul className="mt-4 max-h-56 space-y-1 overflow-y-auto overscroll-contain rounded-lg border border-m-border">
            {(myRoster?.playerIds ?? []).map((id) => {
              const p = playersById.get(id);
              if (!p) return null;
              const checked = tradeGive.includes(id);
              return (
                <li key={id} className="border-b border-m-border last:border-0">
                  <label className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setTradeGive((prev) =>
                          checked
                            ? prev.filter((x) => x !== id)
                            : [...prev, id].slice(0, 8),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                    <span className="text-m-muted">{p.pos === "DEF" ? "DST" : p.pos}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-lg border border-m-border py-3 font-display text-base font-semibold"
              disabled={busy}
              onClick={() => {
                setPendingTrade(null);
                setTradeGive([]);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg bg-[#f08a24] py-3 font-display text-base font-semibold text-white disabled:opacity-60"
              disabled={busy || !tradeGive.length || tradePartnerId == null || tradeNeedsSlots}
              onClick={() => void runTrade()}
            >
              {busy ? "Sending…" : "Propose"}
            </button>
          </div>
        </MobileCenteredConfirm>
      ) : null}
    </main>
  );
}

function ChipRow<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-2 overflow-x-auto [scrollbar-width:none]", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "shrink-0 rounded-md border px-3.5 py-2.5 font-display text-base font-semibold uppercase tracking-wide",
            value === o.id
              ? "border-m-tab-active-border bg-m-tab-active text-m-tab-active-fg"
              : "border-transparent bg-m-select-bg text-m-select-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SelectBox({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <label
      className={cn(
        "relative flex items-center justify-between rounded-lg bg-m-select-bg px-4 py-3 font-display text-base font-semibold text-m-select-fg",
        disabled && "opacity-60",
      )}
    >
      <span className="truncate">{current?.label}</span>
      <ChevronDown className="size-5 shrink-0" />
      <select
        aria-label={label}
        value={current?.value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RankHex({ rank, className }: { rank: number | null; className?: string }) {
  if (!rank) return null;
  return (
    <span
      className={cn(
        "absolute flex items-center justify-center bg-m-pos-rank-bg font-display font-bold text-m-pos-rank-fg shadow-[0_0_0_1px_rgba(0,0,0,0.08)]",
        className,
      )}
      style={{ clipPath: HEX_CLIP }}
    >
      {rank}
    </span>
  );
}

/** Team-style roster row with a red minus to choose as the drop. */
function DropCandidateRow({
  player,
  rank,
  disabled,
  onDrop,
}: {
  player: Player;
  rank: number | null;
  disabled?: boolean;
  onDrop: () => void;
}) {
  const logo = teamLogo(player.team);
  const openPlayer = useOpenMobilePlayer();
  const posLabel = player.pos === "DEF" ? "DST" : player.pos;
  return (
    <article className="overflow-hidden rounded-xl bg-m-card text-m-card-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
      <div className="flex items-center gap-1.5 px-2.5 py-3">
        <span className="w-6 shrink-0 text-center text-[11px] font-semibold text-m-muted">
          {posLabel}
        </span>
        <button
          type="button"
          aria-label={`Drop ${shortName(player)}`}
          disabled={disabled}
          onClick={onDrop}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#e8551f] text-white shadow-[inset_0_-3px_0_#b83d10] disabled:opacity-50"
        >
          <Minus className="size-5" strokeWidth={2.5} />
        </button>
        <div
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5"
          {...playerPressProps(openPlayer, player.id)}
        >
          <div className="relative shrink-0">
            <PlayerAvatar
              id={player.id}
              pos={player.pos}
              team={player.team}
              name={player.name}
              className="size-12"
              logoClassName="hidden"
            />
            <RankHex rank={rank} className="-left-1.5 -top-1.5 size-5 text-[10px]" />
            <InjuryAvatarBadge status={player.injury_status ?? player.injury} />
          </div>
          {logo && player.pos !== "DEF" ? (
            <img src={logo} alt="" className="size-8 shrink-0 rounded-full bg-m-chip object-contain p-1" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold leading-tight">{shortName(player)}</p>
            <p className="truncate text-xs text-m-muted">
              {player.team || "FA"} - {posLabel}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

function ConfirmMoveRow({ tone, player }: { tone: "add" | "drop"; player: Player }) {
  const logo = teamLogo(player.team);
  const posLabel = player.pos === "DEF" ? "DST" : player.pos;
  const isAdd = tone === "add";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-m-border bg-m-row-alt px-3 py-3">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg text-white",
          isAdd ? "bg-[#1fae5b] shadow-[inset_0_-2px_0_#168444]" : "bg-[#e8551f] shadow-[inset_0_-2px_0_#b83d10]",
        )}
        aria-hidden
      >
        {isAdd ? <Plus className="size-5" strokeWidth={2.5} /> : <Minus className="size-5" strokeWidth={2.5} />}
      </span>
      <PlayerAvatar
        id={player.id}
        pos={player.pos}
        team={player.team}
        name={player.name}
        className="size-11 shrink-0"
        logoClassName="hidden"
      />
      {logo && player.pos !== "DEF" ? (
        <img src={logo} alt="" className="size-7 shrink-0 rounded-full bg-m-chip object-contain p-1" />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-m-muted">
          {isAdd ? "Add" : "Drop"}
        </p>
        <p className="truncate text-[15px] font-semibold leading-tight">{shortName(player)}</p>
        <p className="truncate text-xs text-m-muted">
          {player.team || "FA"} - {posLabel}
        </p>
      </div>
    </div>
  );
}

function TrendingCard({
  index,
  player,
  count,
  badge,
  owner,
}: {
  index: number;
  player: Player;
  count: number;
  badge: number | null;
  owner: string | null;
}) {
  const logo = teamLogo(player.team);
  const openPlayer = useOpenMobilePlayer();
  return (
    <article
      className="w-[140px] shrink-0 cursor-pointer snap-start overflow-hidden rounded-xl bg-m-card text-m-card-fg"
      {...playerPressProps(openPlayer, player.id)}
    >
      <div className="relative px-2.5 pb-2.5 pt-2.5">
        <span className="absolute left-2.5 top-2 font-display text-sm font-bold text-m-muted">{index}</span>
        <div className="relative mx-auto w-fit">
          <PlayerAvatar
            id={player.id}
            pos={player.pos}
            team={player.team}
            name={player.name}
            className="size-14"
            logoClassName="hidden"
          />
          <RankHex rank={badge} className="-left-3 -top-1 size-7 text-xs" />
        </div>
        <p className="mt-2 flex items-center justify-center gap-1 truncate font-display text-lg font-bold leading-tight">
          <span className="truncate">{shortName(player)}</span>
          {logo ? <img src={logo} alt="" className="size-4 shrink-0 object-contain" /> : null}
        </p>
        <p className="mt-0.5 flex items-center justify-center gap-1 truncate text-xs text-m-muted">
          {owner ? (
            <span className="truncate">{owner}</span>
          ) : (
            <>
              <span className="flex size-3.5 items-center justify-center rounded-sm bg-[#1fae5b] text-white">
                <Plus className="size-3" strokeWidth={3} />
              </span>
              Free Agent
            </>
          )}
        </p>
      </div>
      <div className="bg-m-row-alt py-2 text-center text-sm font-semibold tabnum">{count.toLocaleString()}</div>
    </article>
  );
}

const ACTION_STYLE: Record<Action, { className: string; label: string; to: "/trade" | "/waiver" }> = {
  trade: { className: "bg-[#f08a24] shadow-[inset_0_-3px_0_#c96a12]", label: "Trade for player", to: "/trade" },
  drop: { className: "bg-[#e8551f] shadow-[inset_0_-3px_0_#b83d10]", label: "Drop player", to: "/waiver" },
  add: { className: "bg-[#1fae5b] shadow-[inset_0_-3px_0_#168444]", label: "Add player", to: "/waiver" },
};

function PlayerRow({
  player,
  action,
  badge,
  game,
  cols,
  sortKey,
  nativeMode,
  busy,
  onNativeAction,
}: {
  player: Player;
  action: Action;
  badge: number | null;
  game: string;
  cols: Column[];
  sortKey: string;
  nativeMode?: boolean;
  busy?: boolean;
  onNativeAction?: (player: Player, action: Action) => void;
}) {
  const style = ACTION_STYLE[action];
  const Icon = action === "trade" ? ArrowLeftRight : action === "drop" ? Minus : Plus;
  const openPlayer = useOpenMobilePlayer();
  const btnClass = cn(
    "flex size-11 shrink-0 items-center justify-center rounded-lg text-white disabled:opacity-50",
    style.className,
  );
  return (
    <div className="flex border-b border-m-border">
      <div className="sticky left-0 z-10 flex w-[230px] shrink-0 items-center gap-2.5 bg-m-card px-2.5 py-2.5">
        {nativeMode && onNativeAction ? (
          <button
            type="button"
            aria-label={style.label}
            disabled={busy}
            className={btnClass}
            onClick={() => onNativeAction(player, action)}
          >
            <Icon className="size-5" strokeWidth={2.5} />
          </button>
        ) : (
          <Link to={style.to} aria-label={style.label} className={btnClass}>
            <Icon className="size-5" strokeWidth={2.5} />
          </Link>
        )}
        <div
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5"
          {...playerPressProps(openPlayer, player.id)}
        >
          <div className="relative shrink-0">
            <PlayerAvatar
              id={player.id}
              pos={player.pos}
              team={player.team}
              name={player.name}
              className="size-11"
              logoClassName="hidden"
            />
            <RankHex rank={badge} className="-left-1.5 -top-1.5 size-6 text-[11px]" />
            <InjuryAvatarBadge status={player.injury_status ?? player.injury} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-tight">{shortName(player)}</p>
            <p className="truncate text-xs text-m-muted">
              {player.team || "FA"} - {player.pos}
            </p>
            {game ? <p className="truncate text-[10px] font-semibold uppercase text-m-muted">{game}</p> : null}
          </div>
        </div>
      </div>
      {cols.map((c) => {
        const v = c.value(player);
        return (
          <div
            key={c.key}
            className={cn(
              "flex w-[88px] items-center justify-end px-3 text-[15px] tabnum",
              c.key === sortKey && "bg-m-rank-col",
            )}
          >
            {v == null ? "-" : v.toFixed(c.decimals)}
          </div>
        );
      })}
    </div>
  );
}
