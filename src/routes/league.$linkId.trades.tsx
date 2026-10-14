import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  FantasyBoard,
  fantasyOutlineBtn,
  fantasyPrimaryBtn,
} from "@/components/native/fantasy";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  getNativeLeagueBoard,
  listNativeTrades,
  proposeNativeTrade,
  respondNativeTrade,
} from "@/lib/native-league.functions";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/league/$linkId/trades")({
  ssr: false,
  component: NativeTradesPage,
});

function NativeTradesPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const cache = useSleeperPlayers();
  const fallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const players = cache.data?.players ?? fallback.data?.players ?? [];
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of players) map.set(p.id, p.name);
    return map;
  }, [players]);

  const { data: board } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["native-trades", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 15_000,
    queryFn: () => listNativeTrades({ data: { linkId } }),
  });

  const commissioner = board?.commissioner;
  const tradeReviewHours = commissioner?.tradeReviewHours ?? data?.tradeReviewHours ?? 24;
  const tradeVetoMode = commissioner?.tradeVetoMode ?? data?.tradeVetoMode ?? "none";
  const tradeDeadlineWeek = commissioner?.tradeDeadlineWeek ?? data?.tradeDeadlineWeek ?? null;

  const myTeamId = data?.myTeamId ?? null;
  const myRoster = board?.rosters.find((r) => r.teamId === myTeamId);
  const [partnerId, setPartnerId] = useState<number | "">("");
  const [give, setGive] = useState<string[]>([]);
  const [receive, setReceive] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const partnerRoster = board?.rosters.find((r) => r.teamId === partnerId);
  const capacity = board?.rosterCapacity ?? 15;
  const myActive = myRoster?.activePlayerIds?.length ?? myRoster?.playerIds.length ?? 0;
  const theirActive =
    partnerRoster?.activePlayerIds?.length ?? partnerRoster?.playerIds.length ?? 0;
  const myAfter = myActive - give.length + receive.length;
  const theirAfter = theirActive - receive.length + give.length;
  const myOver = myAfter > capacity;
  const theirOver = theirAfter > capacity;

  const toggle = (list: string[], id: string, set: (v: string[]) => void) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(0, 8));
  };

  const propose = async () => {
    if (!partnerId || busy) return;
    setBusy(true);
    try {
      const result = await proposeNativeTrade({
        data: {
          linkId,
          acceptorTeamId: Number(partnerId),
          givePlayerIds: give,
          receivePlayerIds: receive,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Trade proposed.");
      setGive([]);
      setReceive([]);
      await queryClient.invalidateQueries({ queryKey: ["native-trades", linkId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not propose trade.");
    } finally {
      setBusy(false);
    }
  };

  const respond = async (tradeId: number, action: "accept" | "reject" | "cancel" | "veto") => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await respondNativeTrade({ data: { linkId, tradeId, action } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        action === "accept"
          ? "Trade accepted."
          : action === "veto"
            ? "Trade vetoed."
            : action === "cancel"
              ? "Trade cancelled."
              : "Trade rejected.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["native-trades", linkId] }),
        queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] }),
        queryClient.invalidateQueries({ queryKey: ["league-transaction-log", linkId] }),
        queryClient.invalidateQueries({ queryKey: ["native-transactions", linkId] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update trade.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading trades…</p>;

  const trades = data?.trades ?? [];

  return (
    <div className="space-y-4">
      <Toaster />
      <div>
        <h2 className="display-title text-3xl text-slate-900">Trades</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Propose multi-player deals with league mates. Accepted trades may enter a review window
          before processing.
        </p>
      </div>

      <FantasyBoard bodyClassName="px-4 py-3">
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Review window
            </dt>
            <dd className="font-medium text-slate-900">{tradeReviewHours} hours</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Veto mode
            </dt>
            <dd className="font-medium text-slate-900 capitalize">
              {tradeVetoMode === "commissioner" ? "Commissioner veto" : "No league veto"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Deadline
            </dt>
            <dd className="font-medium text-slate-900">
              {tradeDeadlineWeek != null ? `Week ${tradeDeadlineWeek}` : "No deadline"}
            </dd>
          </div>
        </dl>
      </FantasyBoard>

      {data?.canPropose ? (
        <FantasyBoard title="Propose trade" bodyClassName="p-4">
          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Trade with
            </span>
            <select
              className="mt-1 w-full max-w-md rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary"
              value={partnerId === "" ? "" : String(partnerId)}
              onChange={(e) => {
                setPartnerId(e.target.value ? Number(e.target.value) : "");
                setReceive([]);
              }}
            >
              <option value="">Select team…</option>
              {(board?.teams ?? [])
                .filter((t) => t.id !== myTeamId && t.userId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.teamName}
                  </option>
                ))}
            </select>
          </label>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-700">You give</p>
              <ul className="mt-2 max-h-52 space-y-1.5 overflow-y-auto">
                {(myRoster?.playerIds ?? []).map((id) => (
                  <li key={id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-white">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300"
                        checked={give.includes(id)}
                        onChange={() => toggle(give, id, setGive)}
                      />
                      <span className="text-slate-900">{nameById.get(id) ?? id}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-700">
                You receive
              </p>
              <ul className="mt-2 max-h-52 space-y-1.5 overflow-y-auto">
                {(partnerRoster?.playerIds ?? []).map((id) => (
                  <li key={id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-white">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300"
                        checked={receive.includes(id)}
                        onChange={() => toggle(receive, id, setReceive)}
                      />
                      <span className="text-slate-900">{nameById.get(id) ?? id}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {myOver || theirOver ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {myOver
                ? `This trade would put you at ${myAfter}/${capacity} active players. Give more or receive fewer.`
                : `This trade would put the other team at ${theirAfter}/${capacity} active players.`}
            </p>
          ) : null}
          <button
            type="button"
            className={cn(fantasyPrimaryBtn, "mt-4")}
            disabled={!partnerId || !give.length || !receive.length || busy || myOver || theirOver}
            onClick={() => void propose()}
          >
            Propose Trade
          </button>
        </FantasyBoard>
      ) : (
        <FantasyBoard bodyClassName="px-4 py-5">
          <p className="text-sm text-slate-600">
            Trades unlock after the draft (and before the deadline) once you have a team seat.
          </p>
          <Link
            to="/league/$linkId/players"
            params={{ linkId }}
            className={cn(fantasyOutlineBtn, "mt-4 inline-flex")}
          >
            Browse Players
          </Link>
        </FantasyBoard>
      )}

      <FantasyBoard title="Trade activity" bodyClassName="divide-y divide-slate-100">
        {trades.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">No trades yet.</p>
            {data?.canPropose ? (
              <p className="mt-2 text-sm text-slate-600">
                Use the form above to send your first offer.
              </p>
            ) : (
              <Link
                to="/league/$linkId/players"
                params={{ linkId }}
                className={cn(fantasyOutlineBtn, "mt-4 inline-flex")}
              >
                Open Players
              </Link>
            )}
          </div>
        ) : (
          <ul>
            {trades.map((t) => {
              const giveLeg = t.legs.find((l) => l.teamId === t.proposerTeamId);
              const getLeg = t.legs.find((l) => l.teamId === t.acceptorTeamId);
              const proposerGives = (giveLeg?.playerIds ?? [])
                .map((id) => nameById.get(id) ?? id)
                .join(", ");
              const acceptorGives = (getLeg?.playerIds ?? [])
                .map((id) => nameById.get(id) ?? id)
                .join(", ");

              return (
                <li key={t.id} className="space-y-3 px-4 py-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">
                      {t.proposerName ?? "Team"} ↔ {t.acceptorName ?? "Team"}
                    </p>
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-xs font-semibold uppercase",
                        t.status === "completed"
                          ? "bg-emerald-50 text-emerald-700"
                          : t.status === "vetoed" || t.status === "rejected" || t.status === "cancelled"
                            ? "bg-slate-100 text-slate-600"
                            : "bg-amber-50 text-amber-800",
                      )}
                    >
                      {t.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        {t.proposerName ?? "Proposer"} gives
                      </p>
                      <p className="mt-1 text-slate-900">{proposerGives || "—"}</p>
                    </div>
                    <div className="rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        {t.acceptorName ?? "Acceptor"} gives
                      </p>
                      <p className="mt-1 text-slate-900">{acceptorGives || "—"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {t.status === "proposed" && t.acceptorTeamId === myTeamId ? (
                      <>
                        <button
                          type="button"
                          className={fantasyPrimaryBtn}
                          disabled={busy}
                          onClick={() => void respond(t.id, "accept")}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className={fantasyOutlineBtn}
                          disabled={busy}
                          onClick={() => void respond(t.id, "reject")}
                        >
                          Reject
                        </button>
                      </>
                    ) : null}
                    {t.status === "proposed" && t.proposerTeamId === myTeamId ? (
                      <button
                        type="button"
                        className={fantasyOutlineBtn}
                        disabled={busy}
                        onClick={() => void respond(t.id, "cancel")}
                      >
                        Cancel
                      </button>
                    ) : null}
                    {(t.status === "veto_window" || t.status === "proposed") && data?.canVeto ? (
                      <button
                        type="button"
                        className={fantasyOutlineBtn}
                        disabled={busy}
                        onClick={() => void respond(t.id, "veto")}
                      >
                        Veto
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </FantasyBoard>
    </div>
  );
}
