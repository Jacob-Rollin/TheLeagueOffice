import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import { toast } from "sonner";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  gameStripLabels,
  progressFor as nflProgressFor,
  scheduleOpponent,
  useNflSchedule,
} from "@/components/mobile/league/lineupShared";
import { useNativeRosterActions } from "@/components/mobile/league/nativeRosterActions";
import {
  FantasyAddButton,
  FantasyBoard,
  FantasyDropButton,
  FantasyPlayerChip,
  FantasyPosChip,
  FantasyPosChipRow,
  FantasyTradeButton,
  displayPlayerPoints,
  fantasyOutlineBtn,
  formatFantasyProj,
  formatFantasyPts,
} from "@/components/native/fantasy";
import {
  PLAYER_LIST_COL_HEADER_ROW,
  PLAYER_LIST_GROUP_HEADER_ROW,
  PLAYER_LIST_GROUP_TH,
} from "@/components/research/SortHeader";
import { Toaster } from "@/components/ui/sonner";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { usePositionalDefenseRanks } from "@/hooks/usePositionalDefenseRanks";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { useWeeklyActualStats } from "@/hooks/useWeeklyActualStats";
import {
  getNativeLeagueBoard,
  submitNativeFreeAgentDrop,
  submitNativeFreeAgentMove,
} from "@/lib/native-league.functions";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import type { Player } from "@/lib/players-build";
import { resolveNativeLiveScore } from "@/lib/scoring-map";
import { resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/league/$linkId/players")({
  ssr: false,
  component: NativeLeaguePlayersPage,
});

const POS_FILTERS = ["ALL", "QB", "RB", "WR", "TE", "FLEX", "DEF", "K"] as const;
type PosFilter = (typeof POS_FILTERS)[number];
type PoolFilter = "available" | "rostered" | "mine" | "all";
type HealthFilter = "all" | "healthy" | "injured";

const FLEX_POS = new Set(["RB", "WR", "TE"]);

function ptsField(format: string): string {
  if (format === "ppr") return "pts_ppr";
  if (format === "std") return "pts_std";
  return "pts_half_ppr";
}

function matchesPos(player: Player, pos: PosFilter): boolean {
  if (pos === "ALL") return true;
  if (pos === "FLEX") return FLEX_POS.has(player.pos);
  if (pos === "DEF") return player.pos === "DEF";
  return player.pos === pos;
}

function NativeLeaguePlayersPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const { activeLeague, setActiveLeagueId } = useActiveLeague();
  const queryClient = useQueryClient();
  const modalRef = useRef<PlayerModalHandle>(null);
  const cache = useSleeperPlayers();
  const rosterActions = useNativeRosterActions();
  const hookLinked =
    (activeLeague?.platform ?? "").toLowerCase() === "native" && activeLeague?.id === linkId;

  useEffect(() => {
    if (linkId) setActiveLeagueId(linkId);
  }, [linkId, setActiveLeagueId]);

  const fallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const players = cache.data?.players ?? fallback.data?.players ?? [];

  const { data: board, isLoading } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });

  const activeWeek = board?.currentWeek ?? 1;
  const {
    projectFor,
    rankFor,
    sleeperIdFor,
    seasonStats,
    format,
    scoringMap,
  } = useLeagueProjections(activeWeek);
  const { statsFor: weekStatLine } = useWeeklyActualStats(activeWeek, { pace: "broadcast" });
  const { progressByNflTeam, currentWeek: nflCurrentWeek } = useNflGameProgress(activeWeek);
  const showActuals = nflCurrentWeek != null && activeWeek < nflCurrentWeek;
  const { data: schedule = [] } = useNflSchedule();
  const { rankFor: defenseRankFor } = usePositionalDefenseRanks();

  const [pool, setPool] = useState<PoolFilter>("available");
  const [pos, setPos] = useState<PosFilter>("ALL");
  const [proTeam, setProTeam] = useState("ALL");
  const [health, setHealth] = useState<HealthFilter>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [pendingAdd, setPendingAdd] = useState<Player | null>(null);
  const [pendingDrop, setPendingDrop] = useState<Player | null>(null);
  const [dropId, setDropId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const myTeamId = board?.summary.teamId ?? null;
  const ownership = board?.ownership ?? {};
  const draftDone = board?.summary.draftStatus === "complete";
  const myRoster = board?.rosters.find((r) => r.teamId === myTeamId) ?? null;
  const capacity = board?.rosterCapacity ?? 15;
  const openSlots = myRoster
    ? Math.max(0, capacity - (myRoster.activePlayerIds?.length ?? myRoster.playerIds.length))
    : 0;
  const canAddFa = Boolean(draftDone && myTeamId != null && myRoster);
  const canMutate = canAddFa;
  const seasonPtsKey = ptsField(format);

  const nameById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) map.set(p.id, p);
    return map;
  }, [players]);

  const teamNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of board?.teams ?? []) map.set(t.id, t.teamName);
    return map;
  }, [board?.teams]);

  const nflTeams = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) {
      const t = (p.team || "").toUpperCase();
      if (t && t !== "FA") set.add(t);
    }
    return [...set].sort();
  }, [players]);

  const dropCandidates = useMemo(() => {
    if (!myRoster) return [];
    return myRoster.playerIds
      .map((id) => nameById.get(id))
      .filter((p): p is Player => Boolean(p));
  }, [myRoster, nameById]);

  const rows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const list = players
      .filter((p) => {
        const owner = ownership[p.id];
        if (pool === "available") return owner == null;
        if (pool === "rostered") return owner != null;
        if (pool === "mine") return myTeamId != null && owner === myTeamId;
        return true;
      })
      .filter((p) => matchesPos(p, pos))
      .filter((p) => (proTeam === "ALL" ? true : (p.team || "").toUpperCase() === proTeam))
      .filter((p) => {
        if (health === "all") return true;
        const status = resolveInjuryStatus(p) ?? p.injury_status ?? p.injury ?? null;
        const injured = Boolean(status && String(status).trim());
        return health === "injured" ? injured : !injured;
      })
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .map((p) => {
        const sid = sleeperIdFor(p);
        const proj = projectFor(sid);
        return {
          player: p,
          ownerTeamId: ownership[p.id] ?? null,
          sid,
          proj: proj != null && Number.isFinite(proj) ? proj : null,
        };
      })
      .sort((a, b) => {
        const ap = a.proj ?? -1;
        const bp = b.proj ?? -1;
        if (bp !== ap) return bp - ap;
        return a.player.name.localeCompare(b.player.name);
      })
      .slice(0, draftDone || pool !== "available" ? 250 : 150);

    return list;
  }, [
    players,
    ownership,
    pool,
    pos,
    proTeam,
    health,
    deferredQuery,
    myTeamId,
    draftDone,
    projectFor,
    sleeperIdFor,
  ]);

  const resetFilters = () => {
    startTransition(() => {
      setPool("available");
      setPos("ALL");
      setProTeam("ALL");
      setHealth("all");
      setQuery("");
    });
  };

  const refreshBoard = async () => {
    await queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] });
    await queryClient.invalidateQueries({ queryKey: ["native-lineup", linkId] });
    await queryClient.invalidateQueries({ queryKey: ["native-transactions", linkId] });
  };

  const runAdd = async (addPlayerId: string, dropPlayerId: string | null) => {
    if (!myRoster || submitting) return;
    setSubmitting(true);
    try {
      const addMeta = nameById.get(addPlayerId);
      const result = await submitNativeFreeAgentMove({
        data: {
          linkId,
          addPlayerId,
          dropPlayerId,
          rosterVersion: myRoster.version,
          addPlayerTeam: addMeta?.team ?? null,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        if (result.requiresDrop) {
          const player = nameById.get(addPlayerId) ?? null;
          setPendingAdd(player);
        }
        return;
      }
      toast.success(dropPlayerId ? "Add / drop submitted." : "Player added.");
      setPendingAdd(null);
      setDropId("");
      await refreshBoard();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not complete add.");
    } finally {
      setSubmitting(false);
    }
  };

  const runDrop = async (playerId: string) => {
    if (!myRoster || submitting) return;
    setSubmitting(true);
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
      await refreshBoard();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not drop player.");
    } finally {
      setSubmitting(false);
    }
  };

  const onAddClick = (player: Player) => {
    if (!canAddFa) return;
    if (hookLinked && rosterActions.canMutateNative) {
      rosterActions.requestAdd(player);
      return;
    }
    if (openSlots > 0) {
      void runAdd(player.id, null);
      return;
    }
    setPendingAdd(player);
    setDropId(dropCandidates[0]?.id ?? "");
  };

  const onDropClick = (player: Player) => {
    if (!canMutate) return;
    if (hookLinked && rosterActions.canMutateNative) {
      rosterActions.requestDrop(player);
      return;
    }
    setPendingDrop(player);
  };

  const onTradeClick = (player: Player) => {
    if (!hookLinked || !rosterActions.canMutateNative) return;
    rosterActions.requestTradeFor(player);
  };

  if (isLoading || !board) {
    return <p className="text-sm text-muted-foreground">Loading players…</p>;
  }

  const busy = submitting || rosterActions.busy;
  const leagueName = board.summary.name;

  return (
    <div className="space-y-4">
      <Toaster />

      {/* Filter header */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="display-title text-3xl text-slate-900">
              Free <span className="text-primary">Agents</span>
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {leagueName}
              {!draftDone
                ? " · Draft is not complete — available list mirrors undrafted players."
                : canAddFa
                  ? openSlots > 0
                    ? ` · ${openSlots} open roster slot${openSlots === 1 ? "" : "s"}`
                    : " · Roster full — adds require a drop"
                  : ""}
            </p>
          </div>
          <label className="relative w-full max-w-xs sm:w-64">
            <span className="sr-only">Player name</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Player Name"
              className="w-full rounded-md border border-slate-200 bg-white py-2 pl-3 pr-3 text-sm text-slate-900 outline-none focus:border-primary"
            />
          </label>
        </div>

        <div className="mt-4">
          <FantasyPosChipRow>
            {POS_FILTERS.map((p) => (
              <FantasyPosChip
                key={p}
                label={p === "ALL" ? "All" : p === "DEF" ? "DST" : p}
                active={pos === p}
                onClick={() => startTransition(() => setPos(p))}
              />
            ))}
          </FantasyPosChipRow>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <FilterSelect
            label="Filter"
            value={pool}
            onChange={(v) => startTransition(() => setPool(v as PoolFilter))}
            options={[
              { value: "available", label: "Available" },
              { value: "rostered", label: "On Rosters" },
              { value: "mine", label: "My Team" },
              { value: "all", label: "All Players" },
            ]}
          />
          <FilterSelect
            label="Pro Team"
            value={proTeam}
            onChange={(v) => startTransition(() => setProTeam(v))}
            options={[
              { value: "ALL", label: "All" },
              ...nflTeams.map((t) => ({ value: t, label: t })),
            ]}
          />
          <FilterSelect
            label="Health"
            value={health}
            onChange={(v) => startTransition(() => setHealth(v as HealthFilter))}
            options={[
              { value: "all", label: "All" },
              { value: "healthy", label: "Healthy" },
              { value: "injured", label: "Injured" },
            ]}
          />
          <button
            type="button"
            onClick={resetFilters}
            className={cn(fantasyOutlineBtn, "ml-auto")}
          >
            Reset All
          </button>
        </div>
      </section>

      {/* Board */}
      <FantasyBoard
        title={
          <span className="font-display text-sm font-bold uppercase tracking-wide text-slate-900">
            Overview · Week {activeWeek}
          </span>
        }
        bodyClassName="overflow-x-auto"
      >
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead>
            <tr className={PLAYER_LIST_GROUP_HEADER_ROW}>
              <th className="px-3 py-2" aria-hidden="true" />
              <th colSpan={2} className={PLAYER_LIST_GROUP_TH}>
                Status
              </th>
              <th colSpan={5} className={PLAYER_LIST_GROUP_TH}>
                NFL Week {activeWeek}
              </th>
              <th colSpan={2} className={PLAYER_LIST_GROUP_TH}>
                Season
              </th>
            </tr>
            <tr className={PLAYER_LIST_COL_HEADER_ROW}>
              <th className="sticky left-0 z-20 bg-slate-50/80 px-3 py-1.5 text-left">Player</th>
              <th className="px-2 py-1.5 text-center">Type</th>
              <th className="px-2 py-1.5 text-center">Action</th>
              <th className="px-2 py-1.5 text-center">Opp</th>
              <th className="px-2 py-1.5 text-center">Status</th>
              <th className="px-2 py-1.5 text-right">Proj</th>
              <th className="px-2 py-1.5 text-right">Score</th>
              <th className="px-2 py-1.5 text-right">Oprk</th>
              <th className="px-2 py-1.5 text-right">Prk</th>
              <th className="px-2 py-1.5 text-right">Fpts</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No players match these filters.
                </td>
              </tr>
            ) : (
              rows.map(({ player, ownerTeamId, sid, proj }) => {
                const isFa = ownerTeamId == null;
                const isMine = myTeamId != null && ownerTeamId === myTeamId;
                const isOther = ownerTeamId != null && !isMine;
                const typeLabel = isFa
                  ? "FA"
                  : isMine
                    ? "Mine"
                    : (teamNameById.get(ownerTeamId!) ?? `T${ownerTeamId}`);
                const bye =
                  player.bye != null && Number(player.bye) === activeWeek;
                const opp = bye
                  ? "BYE"
                  : scheduleOpponent(schedule, activeWeek, player.team || "");
                const progress = nflProgressFor(player.team || "", progressByNflTeam);
                const strip = gameStripLabels(progress, {
                  bye,
                  opponent: opp,
                  team: player.team || null,
                });
                const rawScore = resolveNativeLiveScore(
                  null,
                  weekStatLine(sid),
                  scoringMap,
                );
                const displayScore = displayPlayerPoints(rawScore, progress?.phase, {
                  showActuals,
                  bye,
                });
                const oprk =
                  !bye && opp
                    ? defenseRankFor(player.pos, opp)
                    : null;
                const ranks = rankFor(sid);
                const seasonPtsRaw = Number(
                  seasonStats?.get(sid)?.stats?.[seasonPtsKey] ?? NaN,
                );
                const seasonPts = Number.isFinite(seasonPtsRaw) ? seasonPtsRaw : null;

                return (
                  <tr
                    key={player.id}
                    className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70"
                  >
                    <td className="sticky left-0 z-10 bg-white px-3 py-2.5">
                      <FantasyPlayerChip
                        player={player}
                        size="sm"
                        onClick={() => modalRef.current?.open(player.id)}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <span
                        className={cn(
                          "inline-flex min-w-8 justify-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          isFa
                            ? "bg-emerald-50 text-emerald-700"
                            : isMine
                              ? "bg-blue-50 text-blue-700"
                              : "bg-slate-100 text-slate-600",
                        )}
                        title={
                          isFa
                            ? "Free agent"
                            : isMine
                              ? "On your roster"
                              : teamNameById.get(ownerTeamId!) ?? undefined
                        }
                      >
                        {isFa ? "FA" : isMine ? "MY" : typeLabel.slice(0, 6)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        {canAddFa && isFa ? (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`Add ${player.name}`}
                            onClick={() => onAddClick(player)}
                            className="inline-flex size-8 items-center justify-center rounded-full border border-[#1fae5b] bg-[#1fae5b] text-white shadow-[inset_0_-1px_0_#168444] transition-colors hover:bg-[#1a9a50] disabled:opacity-50"
                          >
                            <Plus className="size-4" strokeWidth={2.5} aria-hidden />
                          </button>
                        ) : null}
                        {canMutate && isMine ? (
                          <FantasyDropButton
                            disabled={busy}
                            onClick={() => onDropClick(player)}
                            className="px-2 py-1"
                          />
                        ) : null}
                        {hookLinked && rosterActions.canMutateNative && isOther ? (
                          <FantasyTradeButton
                            disabled={busy}
                            onClick={() => onTradeClick(player)}
                            className="px-2 py-1"
                          />
                        ) : null}
                        {!(
                          (canAddFa && isFa) ||
                          (canMutate && isMine) ||
                          (hookLinked && rosterActions.canMutateNative && isOther)
                        ) ? (
                          <span className="text-xs text-slate-300">—</span>
                        ) : null}
                      </div>
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2.5 text-center text-xs font-semibold uppercase tracking-wide",
                        bye ? "text-slate-400" : "text-slate-800",
                      )}
                    >
                      {opp ?? "—"}
                    </td>
                    <td className="px-2 py-2.5 text-center text-xs text-slate-600">
                      {bye ? "Bye" : strip.status || strip.game || "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                      {bye ? "-" : formatFantasyProj(proj)}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-800">
                      {formatFantasyPts(displayScore)}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2.5 text-right tabular-nums",
                        oprk != null && oprk <= 10 && "font-semibold text-red-600",
                        oprk != null && oprk >= 23 && "font-semibold text-emerald-600",
                      )}
                    >
                      {oprk != null && oprk > 0 ? oprk : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700">
                      {ranks.pos != null && ranks.pos > 0 && ranks.pos < 900
                        ? ranks.pos
                        : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-800">
                      {formatFantasyPts(seasonPts)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </FantasyBoard>

      {pendingAdd && !hookLinked ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose player to drop"
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <h3 className="display-title text-xl text-slate-900">
              Choose a <span className="text-primary">Drop</span>
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              Your roster is full ({capacity}/{capacity}). Drop someone to add{" "}
              <span className="font-medium text-slate-900">{pendingAdd.name}</span>.
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-800">
              Drop player
              <select
                className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary"
                value={dropId}
                onChange={(e) => setDropId(e.target.value)}
              >
                {dropCandidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.pos === "DEF" ? "DST" : p.pos})
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={fantasyOutlineBtn}
                disabled={busy}
                onClick={() => {
                  setPendingAdd(null);
                  setDropId("");
                }}
              >
                Cancel
              </button>
              <FantasyAddButton
                disabled={busy || !dropId}
                onClick={() => void runAdd(pendingAdd.id, dropId)}
              >
                {busy ? "Submitting…" : "Confirm Add / Drop"}
              </FantasyAddButton>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDrop && !hookLinked ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm drop"
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <h3 className="display-title text-xl text-slate-900">
              Confirm <span className="text-primary">Drop</span>
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              Send <span className="font-medium text-slate-900">{pendingDrop.name}</span> to free
              agency? You have {openSlots} open slot{openSlots === 1 ? "" : "s"} of {capacity}.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={fantasyOutlineBtn}
                disabled={busy}
                onClick={() => setPendingDrop(null)}
              >
                Cancel
              </button>
              <FantasyDropButton
                disabled={busy}
                onClick={() => void runDrop(pendingDrop.id)}
              >
                {busy ? "Dropping…" : "Confirm Drop"}
              </FantasyDropButton>
            </div>
          </div>
        </div>
      ) : null}

      {hookLinked ? rosterActions.modals : null}

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const id = `fa-filter-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <label className="flex min-w-[8.5rem] flex-col gap-1 text-sm text-slate-700">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <select
        id={id}
        className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-primary"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
