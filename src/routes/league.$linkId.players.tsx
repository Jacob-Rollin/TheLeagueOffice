import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useRef, useState, startTransition } from "react";
import { toast } from "sonner";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { useNativeRosterActions } from "@/components/mobile/league/nativeRosterActions";
import {
  FantasyBoard,
  FantasyPosChip,
  FantasyPosChipRow,
  fantasyOutlineBtn,
} from "@/components/native/fantasy";
import { Toaster } from "@/components/ui/sonner";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  getNativeLeagueBoard,
  submitNativeFreeAgentDrop,
  submitNativeFreeAgentMove,
} from "@/lib/native-league.functions";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import type { Player } from "@/lib/players-build";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/league/$linkId/players")({
  ssr: false,
  component: NativeLeaguePlayersPage,
});

const POS_FILTERS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const;
type PoolFilter = "available" | "rostered" | "mine" | "all";

const addBtnClass =
  "rounded-md border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-emerald-700 disabled:opacity-60";
const dropBtnClass =
  "rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-red-700 transition-colors hover:border-red-200 hover:bg-red-50 disabled:opacity-60";
const tradeBtnClass =
  "rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-blue-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60";

function NativeLeaguePlayersPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const { activeLeague } = useActiveLeague();
  const queryClient = useQueryClient();
  const modalRef = useRef<PlayerModalHandle>(null);
  const cache = useSleeperPlayers();
  const rosterActions = useNativeRosterActions();
  const hookLinked =
    (activeLeague?.platform ?? "").toLowerCase() === "native" && activeLeague?.id === linkId;

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

  const [pool, setPool] = useState<PoolFilter>("available");
  const [pos, setPos] = useState<(typeof POS_FILTERS)[number]>("ALL");
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

  const dropCandidates = useMemo(() => {
    if (!myRoster) return [];
    return myRoster.playerIds
      .map((id) => nameById.get(id))
      .filter((p): p is Player => Boolean(p));
  }, [myRoster, nameById]);

  const rows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return players
      .filter((p) => {
        const owner = ownership[p.id];
        if (pool === "available") return owner == null;
        if (pool === "rostered") return owner != null;
        if (pool === "mine") return myTeamId != null && owner === myTeamId;
        return true;
      })
      .filter((p) => (pos === "ALL" ? true : p.pos === pos || (pos === "DEF" && p.pos === "DEF")))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .slice(0, draftDone || pool !== "available" ? 200 : 120)
      .map((p) => ({
        player: p,
        ownerTeamId: ownership[p.id] ?? null,
      }));
  }, [players, ownership, pool, pos, deferredQuery, myTeamId, draftDone]);

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

  const ownedCount = Object.keys(ownership).length;
  const busy = submitting || rosterActions.busy;

  return (
    <div className="space-y-4">
      <Toaster />
      <div>
        <h2 className="display-title text-3xl text-slate-900">League Players</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ownership from your league roster. Names and NFL context from the shared player catalog.
          {!draftDone
            ? " Draft is not complete — available list mirrors undrafted players."
            : ` ${ownedCount} rostered.`}
          {canAddFa
            ? openSlots > 0
              ? ` You have ${openSlots} open roster slot${openSlots === 1 ? "" : "s"}.`
              : " Roster full — adds require a drop."
            : ""}
        </p>
      </div>

      <FantasyPosChipRow>
        {(
          [
            ["available", "Available"],
            ["rostered", "Rostered"],
            ["mine", "My Team"],
            ["all", "All"],
          ] as const
        ).map(([key, label]) => (
          <FantasyPosChip
            key={key}
            label={label}
            active={pool === key}
            onClick={() => startTransition(() => setPool(key))}
          />
        ))}
      </FantasyPosChipRow>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or team"
          className="w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary sm:w-64"
        />
        <FantasyPosChipRow>
          {POS_FILTERS.map((p) => (
            <FantasyPosChip
              key={p}
              label={p === "DEF" ? "DST" : p}
              active={pos === p}
              onClick={() => startTransition(() => setPos(p))}
            />
          ))}
        </FantasyPosChipRow>
      </div>

      <FantasyBoard bodyClassName="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 z-20 bg-white px-3 py-2 font-semibold">Player</th>
              <th className="px-3 py-2 font-semibold">Team</th>
              <th className="px-3 py-2 font-semibold">Pos</th>
              <th className="px-3 py-2 font-semibold">Owner</th>
              <th className="px-3 py-2 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No players match these filters.
                </td>
              </tr>
            ) : (
              rows.map(({ player, ownerTeamId }) => {
                const isFa = ownerTeamId == null;
                const isMine = myTeamId != null && ownerTeamId === myTeamId;
                const isOther = ownerTeamId != null && !isMine;
                const ownerLabel = isFa
                  ? "Free agent"
                  : isMine
                    ? "My team"
                    : (teamNameById.get(ownerTeamId) ?? `Team ${ownerTeamId}`);

                return (
                  <tr key={player.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td
                      className={cn(
                        "sticky left-0 z-10 bg-white px-3 py-2",
                        "hover:bg-slate-50/80",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => modalRef.current?.open(player.id)}
                        className="text-left font-medium text-slate-900 hover:text-primary hover:underline"
                      >
                        {player.name}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{player.team || "—"}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {player.pos === "DEF" ? "DST" : player.pos}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{ownerLabel}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {canAddFa && isFa ? (
                          <button
                            type="button"
                            className={addBtnClass}
                            disabled={busy}
                            onClick={() => onAddClick(player)}
                          >
                            {openSlots > 0 ? "Add" : "Add / Drop"}
                          </button>
                        ) : null}
                        {canMutate && isMine ? (
                          <button
                            type="button"
                            className={dropBtnClass}
                            disabled={busy}
                            onClick={() => onDropClick(player)}
                          >
                            Drop
                          </button>
                        ) : null}
                        {hookLinked && rosterActions.canMutateNative && isOther ? (
                          <button
                            type="button"
                            className={tradeBtnClass}
                            disabled={busy}
                            onClick={() => onTradeClick(player)}
                          >
                            Trade
                          </button>
                        ) : null}
                        {!((canAddFa && isFa) || (canMutate && isMine) || (hookLinked && rosterActions.canMutateNative && isOther)) ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : null}
                      </div>
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
              <button
                type="button"
                className={addBtnClass}
                disabled={busy || !dropId}
                onClick={() => void runAdd(pendingAdd.id, dropId)}
              >
                {busy ? "Submitting…" : "Confirm Add / Drop"}
              </button>
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
              <button
                type="button"
                className={dropBtnClass}
                disabled={busy}
                onClick={() => void runDrop(pendingDrop.id)}
              >
                {busy ? "Dropping…" : "Confirm Drop"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {hookLinked ? rosterActions.modals : null}

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}
