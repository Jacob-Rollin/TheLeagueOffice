import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  cancelNativeWaiverClaim,
  getNativeLeagueBoard,
  listNativeWaiverClaims,
  submitNativeWaiverClaim,
} from "@/lib/native-league.functions";
import { loadPlayersCatalog } from "@/lib/players-catalog";

export const Route = createFileRoute("/league/$linkId/waivers")({
  ssr: false,
  component: NativeWaiversPage,
});

const buttonClass =
  "rounded-md bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground disabled:opacity-60";
const outlineClass =
  "rounded-md border border-border bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-800 disabled:opacity-60";

function NativeWaiversPage() {
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
    queryKey: ["native-waiver-claims", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 15_000,
    queryFn: () => listNativeWaiverClaims({ data: { linkId } }),
  });

  const [addId, setAddId] = useState("");
  const [dropId, setDropId] = useState("");
  const [bid, setBid] = useState(0);
  const [busy, setBusy] = useState(false);

  const myTeamId = data?.myTeamId ?? board?.summary.teamId ?? null;
  const myRoster = board?.rosters.find((r) => r.teamId === myTeamId);
  const available = useMemo(() => {
    const ownership = board?.ownership ?? {};
    return players.filter((p) => ownership[p.id] == null).slice(0, 200);
  }, [players, board?.ownership]);

  const pending = (data?.claims ?? []).filter((c) => c.status === "pending");
  const minePending = pending.filter((c) => c.teamId === myTeamId);

  const submit = async () => {
    if (!addId || busy) return;
    setBusy(true);
    try {
      const result = await submitNativeWaiverClaim({
        data: {
          linkId,
          playerToAdd: addId,
          playerToDrop: dropId || null,
          bidAmount: data?.waiverType === "faab" ? bid : null,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Waiver claim submitted.");
      setAddId("");
      setDropId("");
      await queryClient.invalidateQueries({ queryKey: ["native-waiver-claims", linkId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit claim.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (claimId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await cancelNativeWaiverClaim({ data: { linkId, claimId } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Claim cancelled.");
      await queryClient.invalidateQueries({ queryKey: ["native-waiver-claims", linkId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel claim.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading waivers…</p>;

  return (
    <div className="space-y-4">
      <Toaster />
      <div>
        <h2 className="display-title text-2xl text-slate-900">
          Waiver <span className="text-primary">Wire</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Type: {data?.waiverType ?? "—"}
          {data?.waiverType === "faab" && data.faabBalance != null
            ? ` · FAAB ${data.faabBalance}`
            : ""}
          {" · "}Period {data?.waiverPeriodDays ?? 0} day(s)
          {data?.postDraftPlayerStatus === "follow_waiver_rules"
            ? " · Free agents follow waiver rules"
            : " · Immediate FA also available"}
        </p>
      </div>

      {!data?.canSubmit ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          {data?.waiverPeriodDays === 0
            ? "Waivers are disabled for this league — use Players for free-agent adds."
            : "Waivers unlock after the draft is complete and you claim a team seat."}
          <div className="mt-3">
            <Link to="/league/$linkId/players" params={{ linkId }} className={outlineClass}>
              Open Players
            </Link>
          </div>
        </div>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-900">Submit claim</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-muted-foreground">Add</span>
              <select
                className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
              >
                <option value="">Select free agent…</option>
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.pos === "DEF" ? "DST" : p.pos})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Drop (if full)</span>
              <select
                className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                value={dropId}
                onChange={(e) => setDropId(e.target.value)}
              >
                <option value="">None</option>
                {(myRoster?.playerIds ?? []).map((id) => (
                  <option key={id} value={id}>
                    {nameById.get(id) ?? id}
                  </option>
                ))}
              </select>
            </label>
            {data.waiverType === "faab" ? (
              <label className="block text-sm">
                <span className="text-muted-foreground">Bid</span>
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                  value={bid}
                  onChange={(e) => setBid(Number(e.target.value))}
                />
              </label>
            ) : null}
          </div>
          <button type="button" className={`${buttonClass} mt-3`} disabled={!addId || busy} onClick={() => void submit()}>
            {busy ? "Submitting…" : "Submit Claim"}
          </button>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-900">
            Pending ({pending.length})
          </h3>
        </div>
        {pending.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No pending claims.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-slate-900">
                    {c.teamName ?? `Team ${c.teamId}`} · +{nameById.get(c.playerToAdd) ?? c.playerToAdd}
                    {c.playerToDrop ? ` / −${nameById.get(c.playerToDrop) ?? c.playerToDrop}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.bidAmount != null ? `Bid $${c.bidAmount} · ` : ""}
                    Priority {c.priorityAtSubmit}
                  </p>
                </div>
                {minePending.some((m) => m.id === c.id) ? (
                  <button type="button" className={outlineClass} disabled={busy} onClick={() => void cancel(c.id)}>
                    Cancel
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
