import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, startTransition } from "react";
import { toast } from "sonner";

import {
  FantasyBoard,
  FantasyPosChip,
  FantasyPosChipRow,
  fantasyOutlineBtn,
  fantasyPrimaryBtn,
} from "@/components/native/fantasy";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/league/$linkId/waivers")({
  ssr: false,
  component: NativeWaiversPage,
});

type WaiverTab = "pending" | "submit" | "settings";

function waiverTypeLabel(raw: string) {
  const t = raw.toLowerCase();
  if (t === "faab") return "FAAB";
  if (t === "reverse") return "Reverse standings";
  if (t === "rolling") return "Rolling";
  return raw;
}

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

  const [tab, setTab] = useState<WaiverTab>("pending");
  const [addId, setAddId] = useState("");
  const [dropId, setDropId] = useState("");
  const [bid, setBid] = useState(0);
  const [busy, setBusy] = useState(false);

  const commissioner = board?.commissioner;
  const waiverType = commissioner?.waiverType ?? data?.waiverType ?? "rolling";
  const waiverBudget = commissioner?.waiverBudget;
  const waiverPeriodDays = commissioner?.waiverPeriodDays ?? data?.waiverPeriodDays ?? 0;

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
          bidAmount: waiverType === "faab" ? bid : null,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Waiver claim submitted.");
      setAddId("");
      setDropId("");
      setTab("pending");
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

  const canSubmit = data?.canSubmit ?? false;

  return (
    <div className="space-y-4">
      <Toaster />
      <div>
        <h2 className="display-title text-3xl text-slate-900">Waivers</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Process claims on a schedule set by your commissioner. Add free agents from the Players
          board when waivers are off or after the waiver period.
        </p>
      </div>

      <FantasyPosChipRow>
        {(
          [
            ["pending", "Pending"],
            ["submit", "Submit Claim"],
            ["settings", "Settings"],
          ] as const
        ).map(([key, label]) => (
          <FantasyPosChip
            key={key}
            label={label}
            active={tab === key}
            onClick={() => startTransition(() => setTab(key))}
          />
        ))}
      </FantasyPosChipRow>

      {tab === "pending" ? (
        <FantasyBoard title={`Pending claims (${pending.length})`} bodyClassName="divide-y divide-slate-100">
          {pending.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">No pending waiver claims.</p>
              <Link
                to="/league/$linkId/players"
                params={{ linkId }}
                className={cn(fantasyPrimaryBtn, "mt-4 inline-flex")}
              >
                Browse Players
              </Link>
            </div>
          ) : (
            <ul>
              {pending.map((c) => {
                const mine = minePending.some((m) => m.id === c.id);
                return (
                  <li
                    key={c.id}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm",
                      mine && "bg-blue-50/50",
                    )}
                  >
                    <div>
                      <p className="font-medium text-slate-900">
                        {c.teamName ?? `Team ${c.teamId}`}
                        {mine ? (
                          <span className="ml-2 text-xs font-semibold uppercase text-blue-700">
                            You
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-slate-700">
                        <span className="text-emerald-700">+</span>{" "}
                        {nameById.get(c.playerToAdd) ?? c.playerToAdd}
                        {c.playerToDrop ? (
                          <>
                            {" "}
                            <span className="text-red-700">/ −</span>{" "}
                            {nameById.get(c.playerToDrop) ?? c.playerToDrop}
                          </>
                        ) : null}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.bidAmount != null ? `Bid $${c.bidAmount} · ` : ""}
                        Priority {c.priorityAtSubmit}
                      </p>
                    </div>
                    {mine ? (
                      <button
                        type="button"
                        className={fantasyOutlineBtn}
                        disabled={busy}
                        onClick={() => void cancel(c.id)}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </FantasyBoard>
      ) : null}

      {tab === "submit" ? (
        !canSubmit ? (
          <FantasyBoard bodyClassName="px-4 py-5">
            <p className="text-sm text-slate-600">
              {waiverPeriodDays === 0
                ? "Waivers are disabled for this league — use Players for free-agent adds."
                : "Waivers unlock after the draft is complete and you claim a team seat."}
            </p>
            <Link
              to="/league/$linkId/players"
              params={{ linkId }}
              className={cn(fantasyOutlineBtn, "mt-4 inline-flex")}
            >
              Open Players
            </Link>
          </FantasyBoard>
        ) : (
          <FantasyBoard title="Submit claim" bodyClassName="p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Add
                </span>
                <select
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary"
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
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Drop (if full)
                </span>
                <select
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary"
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
              {waiverType === "faab" ? (
                <label className="block text-sm sm:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Bid
                  </span>
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary"
                    value={bid}
                    onChange={(e) => setBid(Number(e.target.value))}
                  />
                  {data?.faabBalance != null ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      FAAB remaining: ${data.faabBalance}
                    </span>
                  ) : null}
                </label>
              ) : null}
            </div>
            <button
              type="button"
              className={cn(fantasyPrimaryBtn, "mt-4")}
              disabled={!addId || busy}
              onClick={() => void submit()}
            >
              {busy ? "Submitting…" : "Submit Claim"}
            </button>
          </FantasyBoard>
        )
      ) : null}

      {tab === "settings" ? (
        <FantasyBoard title="League waiver settings" bodyClassName="space-y-4 p-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Type</dt>
              <dd className="mt-1 font-medium text-slate-900">{waiverTypeLabel(waiverType)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Waiver budget
              </dt>
              <dd className="mt-1 font-medium text-slate-900">
                {waiverType === "faab" && waiverBudget != null ? `$${waiverBudget}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Waiver period
              </dt>
              <dd className="mt-1 font-medium text-slate-900">
                {waiverPeriodDays} day{waiverPeriodDays === 1 ? "" : "s"}
              </dd>
            </div>
          </dl>
          {commissioner?.postDraftPlayerStatus === "follow_waiver_rules" ? (
            <p className="text-sm text-muted-foreground">
              Free agents added after the draft follow waiver rules until the waiver period clears.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Undrafted players and immediate free agents can be added on the Players page without a
              claim.
            </p>
          )}
          <Link
            to="/league/$linkId/players"
            params={{ linkId }}
            className={cn(fantasyOutlineBtn, "inline-flex")}
          >
            Browse Players to add
          </Link>
        </FantasyBoard>
      ) : null}
    </div>
  );
}
