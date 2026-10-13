import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Minus, Plus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PlayerAvatar, teamLogo } from "@/components/draft/PlayerAvatar";
import { InjuryAvatarBadge } from "@/components/injury/InjuryAvatarBadge";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  getNativeLeagueBoard,
  proposeNativeTrade,
  submitNativeFreeAgentDrop,
  submitNativeFreeAgentMove,
} from "@/lib/native-league.functions";
import type { Player } from "@/lib/players-build";
import { cn } from "@/lib/utils";

import { HEX_CLIP, shortName } from "./lineupShared";
import { MobileCenteredConfirm, MobileFullScreenPicker } from "./MobileTransactionModals";

export type NativePlayerOwnership = "mine" | "fa" | "other";

type ConfirmTone = "add" | "drop" | "receive" | "give";

const CONFIRM_TONE: Record<
  ConfirmTone,
  { label: string; boxClass: string; Icon: typeof Plus }
> = {
  add: {
    label: "Add",
    boxClass: "bg-[#1fae5b] shadow-[inset_0_-2px_0_#168444]",
    Icon: Plus,
  },
  drop: {
    label: "Drop",
    boxClass: "bg-[#e8551f] shadow-[inset_0_-2px_0_#b83d10]",
    Icon: Minus,
  },
  receive: {
    label: "Receive",
    boxClass: "bg-[#f08a24] shadow-[inset_0_-2px_0_#c96a12]",
    Icon: ArrowLeftRight,
  },
  give: {
    label: "Give",
    boxClass: "bg-[#f08a24] shadow-[inset_0_-2px_0_#c96a12]",
    Icon: ArrowLeftRight,
  },
};

function RankHex({ rank, className }: { rank: number | null; className?: string }) {
  if (!rank) return null;
  const circular = className?.includes("rounded-full");
  return (
    <span
      className={cn(
        "absolute flex items-center justify-center font-display font-bold",
        !circular && "bg-m-pos-rank-bg text-m-pos-rank-fg shadow-[0_0_0_1px_rgba(0,0,0,0.08)]",
        className,
      )}
      style={circular ? undefined : { clipPath: HEX_CLIP }}
    >
      {rank}
    </span>
  );
}

export function ConfirmMoveRow({ tone, player }: { tone: ConfirmTone; player: Player }) {
  const logo = teamLogo(player.team);
  const posLabel = player.pos === "DEF" ? "DST" : player.pos;
  const { label, boxClass, Icon } = CONFIRM_TONE[tone];
  return (
    <div className="flex items-center gap-3 rounded-xl border border-m-border bg-m-row-alt px-3 py-3">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg text-white",
          boxClass,
        )}
        aria-hidden
      >
        <Icon className="size-5" strokeWidth={2.5} />
      </span>
      <PlayerAvatar
        id={player.id}
        pos={player.pos}
        team={player.team}
        name={player.name}
        className="size-11 shrink-0"
        logoClassName="hidden"
      />
      {logo ? (
        <img src={logo} alt="" className="size-7 shrink-0 rounded-full bg-m-chip object-contain p-1" />
      ) : (
        <span className="size-7 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-m-muted">{label}</p>
        <p className="truncate text-[15px] font-semibold leading-tight">{shortName(player)}</p>
        <p className="truncate text-xs text-m-muted">
          {player.team || "FA"} - {posLabel}
        </p>
      </div>
    </div>
  );
}

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
  const posLabel = player.pos === "DEF" ? "DST" : player.pos;
  return (
    <article className="overflow-hidden rounded-xl bg-m-card text-m-card-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
      <div className="flex items-center px-2.5 py-3">
        <span className="w-9 shrink-0 text-[11px] font-semibold uppercase text-m-muted">
          {posLabel}
        </span>
        <button
          type="button"
          aria-label={`Drop ${shortName(player)}`}
          disabled={disabled}
          onClick={onDrop}
          className="mr-3 flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#e8551f] text-white shadow-[inset_0_-3px_0_#b83d10] disabled:opacity-50"
        >
          <Minus className="size-5" strokeWidth={2.5} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="relative shrink-0">
            <PlayerAvatar
              id={player.id}
              pos={player.pos}
              team={player.team}
              name={player.name}
              className="size-12"
              logoClassName="hidden"
            />
            <RankHex
              rank={rank}
              className="-left-1 -top-1 size-5 rounded-full border border-black/15 bg-white text-[10px] text-black shadow-sm"
            />
            <InjuryAvatarBadge status={player.injury_status ?? player.injury} />
          </div>
          {logo ? (
            <img src={logo} alt="" className="size-8 shrink-0 rounded-full bg-m-chip object-contain p-1" />
          ) : (
            <span className="size-8 shrink-0" aria-hidden />
          )}
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

/**
 * Native free-agent + trade mutations shared by Players list and player sheet.
 * No-ops / toast when the active league is not native or draft is incomplete.
 */
export function useNativeRosterActions() {
  const { activeLeague } = useActiveLeague();
  const queryClient = useQueryClient();
  const isNative = (activeLeague?.platform ?? "").toLowerCase() === "native";
  const linkId = isNative ? (activeLeague?.id ?? null) : null;

  const { data: playersPayload } = useSleeperPlayers();
  const players = useMemo(() => playersPayload?.players ?? [], [playersPayload]);
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const { myTeam, rosteredIds } = useLeagueRosters(players);
  const myIds = useMemo(() => new Set((myTeam?.players ?? []).map((p) => p.id)), [myTeam]);
  const { rankFor } = useLeagueProjections();

  const boardQuery = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId: linkId! } }),
  });
  const board = boardQuery.data ?? null;

  const ownerTeamIdByPlayer = useMemo(() => {
    const map = new Map<string, number>();
    if (!board) return map;
    for (const [playerId, teamId] of Object.entries(board.ownership ?? {})) {
      map.set(playerId, Number(teamId));
    }
    return map;
  }, [board]);

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

  /** Other teams' rostered players — targets when trading one of yours away. */
  const tradeReceiveCandidates = useMemo(() => {
    if (!board || myTeamId == null) return [] as Player[];
    const out: Player[] = [];
    for (const roster of board.rosters) {
      if (roster.teamId === myTeamId) continue;
      for (const pid of roster.playerIds) {
        const p = playersById.get(pid);
        if (p) out.push(p);
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [board, myTeamId, playersById]);

  const [pendingAdd, setPendingAdd] = useState<Player | null>(null);
  const [selectedDrop, setSelectedDrop] = useState<Player | null>(null);
  const [pendingDrop, setPendingDrop] = useState<Player | null>(null);
  /** Trade for a player on another roster (receive them). */
  const [pendingTradeFor, setPendingTradeFor] = useState<Player | null>(null);
  const [tradeGive, setTradeGive] = useState<string[]>([]);
  /** Trade away one of yours — pick who to receive. */
  const [pendingTradeAway, setPendingTradeAway] = useState<Player | null>(null);
  const [tradeAwayReceive, setTradeAwayReceive] = useState<Player | null>(null);
  const [busy, setBusy] = useState(false);

  const ownershipFor = (playerId: string): NativePlayerOwnership => {
    if (myIds.has(playerId)) return "mine";
    if (rosteredIds.has(playerId)) return "other";
    return "fa";
  };

  const refreshNative = async () => {
    if (!linkId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["league-rosters", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["league-transaction-log", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["native-trades", linkId] }),
    ]);
  };

  const guardMutate = () => {
    if (canMutateNative) return true;
    toast.error(
      draftDone
        ? "Claim a team seat to manage your roster."
        : "Free-agent moves unlock after the draft is complete.",
    );
    return false;
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

  const tradePartnerId = pendingTradeFor
    ? (ownerTeamIdByPlayer.get(pendingTradeFor.id) ?? null)
    : tradeAwayReceive
      ? (ownerTeamIdByPlayer.get(tradeAwayReceive.id) ?? null)
      : null;
  const tradeSlotNeed = Math.max(0, 1 - tradeGive.length);
  const tradeNeedsSlots = tradeSlotNeed > openSlots;

  const runTradeFor = async () => {
    if (!linkId || !pendingTradeFor || tradePartnerId == null || !tradeGive.length || busy) return;
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
          receivePlayerIds: [pendingTradeFor.id],
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Trade proposed.");
      setPendingTradeFor(null);
      setTradeGive([]);
      await refreshNative();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not propose trade.");
    } finally {
      setBusy(false);
    }
  };

  const runTradeAway = async () => {
    if (!linkId || !pendingTradeAway || !tradeAwayReceive || tradePartnerId == null || busy) return;
    setBusy(true);
    try {
      const result = await proposeNativeTrade({
        data: {
          linkId,
          acceptorTeamId: tradePartnerId,
          givePlayerIds: [pendingTradeAway.id],
          receivePlayerIds: [tradeAwayReceive.id],
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Trade proposed.");
      setPendingTradeAway(null);
      setTradeAwayReceive(null);
      await refreshNative();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not propose trade.");
    } finally {
      setBusy(false);
    }
  };

  const requestAdd = (player: Player) => {
    if (!guardMutate()) return;
    if (openSlots > 0) {
      void runAdd(player.id, null);
      return;
    }
    setPendingAdd(player);
    setSelectedDrop(null);
  };

  const requestDrop = (player: Player) => {
    if (!guardMutate()) return;
    setPendingDrop(player);
  };

  /** Propose a trade to acquire `player` (on another roster). */
  const requestTradeFor = (player: Player) => {
    if (!guardMutate()) return;
    setPendingTradeFor(player);
    setTradeGive([]);
  };

  /** Propose a trade offering one of your players; pick who to get back. */
  const requestTradeAway = (player: Player) => {
    if (!guardMutate()) return;
    setPendingTradeAway(player);
    setTradeAwayReceive(null);
  };

  const modals: ReactNode = (
    <>
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
                rank={rankFor(p.id).pos ?? null}
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
            Send this player to free agency? Uses your league roster settings ({openSlots} open of{" "}
            {capacity}).
          </p>
          <div className="mt-4">
            <ConfirmMoveRow tone="drop" player={pendingDrop} />
          </div>
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

      {pendingTradeFor ? (
        <MobileCenteredConfirm label="Propose trade">
          <h3 className="font-display text-2xl font-bold">Propose trade</h3>
          <p className="mt-2 text-sm text-m-muted">
            {tradePartnerId != null
              ? `From ${board?.teams.find((t) => t.id === tradePartnerId)?.teamName ?? "team"}. `
              : ""}
            Select who you give — uneven trades must fit your {capacity}-player roster ({openSlots}{" "}
            open).
          </p>
          <div className="mt-4">
            <ConfirmMoveRow tone="receive" player={pendingTradeFor} />
          </div>
          {tradeNeedsSlots ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 [.mobile-theme-dark_&]:bg-amber-950/40 [.mobile-theme-dark_&]:text-amber-100">
              Giving {tradeGive.length || "0"} for 1 needs {tradeSlotNeed} open slot
              {tradeSlotNeed === 1 ? "" : "s"}; you have {openSlots}. Add more players on your give
              side.
            </p>
          ) : null}
          <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-m-muted">You give</p>
          <ul className="mt-1.5 max-h-48 space-y-2 overflow-y-auto overscroll-contain pr-0.5">
            {(myRoster?.playerIds ?? []).map((id) => {
              const p = playersById.get(id);
              if (!p) return null;
              const checked = tradeGive.includes(id);
              return (
                <li key={id}>
                  <label className="block cursor-pointer">
                    <span className="sr-only">
                      {checked ? "Remove from give side" : "Add to give side"} {p.name}
                    </span>
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={checked}
                      onChange={() =>
                        setTradeGive((prev) =>
                          checked ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 8),
                        )
                      }
                    />
                    <span
                      className={cn(
                        "block rounded-xl ring-offset-2 ring-offset-m-card peer-focus-visible:ring-2 peer-focus-visible:ring-[#f08a24]",
                        checked && "ring-2 ring-[#f08a24]",
                      )}
                    >
                      <ConfirmMoveRow tone="give" player={p} />
                    </span>
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
                setPendingTradeFor(null);
                setTradeGive([]);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg bg-[#f08a24] py-3 font-display text-base font-semibold text-white disabled:opacity-60"
              disabled={busy || !tradeGive.length || tradePartnerId == null || tradeNeedsSlots}
              onClick={() => void runTradeFor()}
            >
              {busy ? "Sending…" : "Propose"}
            </button>
          </div>
        </MobileCenteredConfirm>
      ) : null}

      {pendingTradeAway && !tradeAwayReceive ? (
        <MobileFullScreenPicker
          title="Who do you want?"
          closeDisabled={busy}
          onClose={() => setPendingTradeAway(null)}
          subtitle={
            <>
              Offering{" "}
              <span className="font-semibold text-m-card-fg">{shortName(pendingTradeAway)}</span>.
              Tap a player to request in return.
            </>
          }
        >
          {tradeReceiveCandidates.length ? (
            tradeReceiveCandidates.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => setTradeAwayReceive(p)}
                className="flex w-full items-center gap-2.5 rounded-xl border border-m-border bg-m-card px-3 py-3 text-left disabled:opacity-50"
              >
                <PlayerAvatar
                  id={p.id}
                  pos={p.pos}
                  team={p.team}
                  name={p.name}
                  className="size-11 shrink-0"
                  logoClassName="hidden"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{shortName(p)}</p>
                  <p className="truncate text-xs text-m-muted">
                    {p.team || "FA"} - {p.pos === "DEF" ? "DST" : p.pos}
                    {ownerTeamIdByPlayer.has(p.id)
                      ? ` · ${board?.teams.find((t) => t.id === ownerTeamIdByPlayer.get(p.id))?.teamName ?? "Rostered"}`
                      : ""}
                  </p>
                </div>
              </button>
            ))
          ) : (
            <p className="px-2 py-10 text-center text-sm text-m-muted">
              No rostered players available to request.
            </p>
          )}
        </MobileFullScreenPicker>
      ) : null}

      {pendingTradeAway && tradeAwayReceive ? (
        <MobileCenteredConfirm label="Confirm trade offer">
          <h3 className="font-display text-2xl font-bold">Propose trade</h3>
          <p className="mt-2 text-sm text-m-muted">Review both sides before sending.</p>
          <div className="mt-4 space-y-2">
            <ConfirmMoveRow tone="give" player={pendingTradeAway} />
            <ConfirmMoveRow tone="receive" player={tradeAwayReceive} />
          </div>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-lg border border-m-border py-3 font-display text-base font-semibold"
              disabled={busy}
              onClick={() => setTradeAwayReceive(null)}
            >
              Back
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg bg-[#f08a24] py-3 font-display text-base font-semibold text-white disabled:opacity-60"
              disabled={busy || tradePartnerId == null}
              onClick={() => void runTradeAway()}
            >
              {busy ? "Sending…" : "Propose"}
            </button>
          </div>
        </MobileCenteredConfirm>
      ) : null}
    </>
  );

  return {
    isNative,
    busy,
    canMutateNative,
    ownershipFor,
    requestAdd,
    requestDrop,
    requestTradeFor,
    requestTradeAway,
    modals,
  };
}
