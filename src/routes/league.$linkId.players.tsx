import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useRef, useState, startTransition } from "react";
import { toast } from "sonner";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { PLAYER_LIST_HEADER_ROW } from "@/components/research/SortHeader";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { getNativeLeagueBoard, submitNativeFreeAgentMove } from "@/lib/native-league.functions";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import type { Player } from "@/lib/players-build";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/league/$linkId/players")({
  ssr: false,
  component: NativeLeaguePlayersPage,
});

const POS_FILTERS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const;
type PoolFilter = "available" | "rostered" | "mine" | "all";

const outlineClass =
  "rounded-md border border-border bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-800 disabled:opacity-60";
const buttonClass =
  "rounded-md bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground disabled:opacity-60";

function NativeLeaguePlayersPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
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

  const onAddClick = (player: Player) => {
    if (!canAddFa) return;
    if (openSlots > 0) {
      void runAdd(player.id, null);
      return;
    }
    setPendingAdd(player);
    setDropId(dropCandidates[0]?.id ?? "");
  };

  if (isLoading || !board) {
    return <p className="text-sm text-muted-foreground">Loading players…</p>;
  }

  const ownedCount = Object.keys(ownership).length;

  return (
    <div className="space-y-4">
      <Toaster />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display-title text-2xl text-slate-900">
            League <span className="text-primary">Players</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ownership from your league (TiDB). Names and NFL context from the shared player catalog.
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
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["available", "Available"],
            ["rostered", "Rostered"],
            ["mine", "My Team"],
            ["all", "All"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => startTransition(() => setPool(key))}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide",
              pool === key
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-blue-700",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or team"
          className="w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary sm:w-64"
        />
        <div className="flex flex-wrap gap-1">
          {POS_FILTERS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => startTransition(() => setPos(p))}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-semibold",
                pos === p
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-blue-700",
              )}
            >
              {p === "DEF" ? "DST" : p}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead>
              <tr className={PLAYER_LIST_HEADER_ROW}>
                <th className="px-3 py-2 font-semibold text-slate-600">Player</th>
                <th className="px-3 py-2 font-semibold text-slate-600">Pos</th>
                <th className="px-3 py-2 font-semibold text-slate-600">NFL</th>
                <th className="px-3 py-2 font-semibold text-slate-600">Owner</th>
                <th className="px-3 py-2 font-semibold text-slate-600">Action</th>
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
                  return (
                    <tr key={player.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => modalRef.current?.open(player.id)}
                          className="text-left font-medium text-slate-900 hover:text-primary hover:underline"
                        >
                          {player.name}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {player.pos === "DEF" ? "DST" : player.pos}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{player.team || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {isFa
                          ? "Free agent"
                          : myTeamId != null && ownerTeamId === myTeamId
                            ? "My team"
                            : (teamNameById.get(ownerTeamId) ?? `Team ${ownerTeamId}`)}
                      </td>
                      <td className="px-3 py-2">
                        {canAddFa && isFa ? (
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={submitting}
                            onClick={() => onAddClick(player)}
                          >
                            {openSlots > 0 ? "Add" : "Add / Drop"}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pendingAdd ? (
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
                className={outlineClass}
                disabled={submitting}
                onClick={() => {
                  setPendingAdd(null);
                  setDropId("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={submitting || !dropId}
                onClick={() => void runAdd(pendingAdd.id, dropId)}
              >
                {submitting ? "Submitting…" : "Confirm Add / Drop"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}
