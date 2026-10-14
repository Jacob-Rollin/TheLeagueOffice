import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronDown, Settings, Users } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { LeagueSettingsDetail } from "@/lib/league-settings";
import { listNativeTrades, respondNativeTrade } from "@/lib/native-league.functions";
import { cn } from "@/lib/utils";

import { MobileActivityList } from "./MobileLeagueChrome";
import { useMobileLeagueSettings } from "./useMobileLeague";

const outlineButton =
  "inline-flex items-center justify-center rounded-lg border border-m-border px-5 py-2.5 font-display text-base font-semibold tracking-wide text-m-card-fg";

function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-8 pb-6 pt-10 text-center">
      <div className="text-m-muted/70">{icon}</div>
      <p className="mt-5 font-display text-[28px] font-bold leading-tight text-m-section">{title}</p>
      {children}
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center gap-4 border-b border-m-border px-4 py-3.5">
      <Settings className="size-5 shrink-0 text-m-muted" strokeWidth={2.5} />
      <span className="min-w-0">
        <span className="block font-display text-lg font-semibold leading-tight">{label}</span>
        <span className="block text-sm text-m-muted">{value}</span>
      </span>
    </li>
  );
}

const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? "" : "s"}`;

function waiverTypeLabel(s: LeagueSettingsDetail | null | undefined) {
  if (!s?.waiverType) return "Unavailable";
  if (s.waiverType === "FAAB") return s.waiverBudget ? `FAAB, ${s.waiverBudget} budget` : "FAAB";
  if (s.waiverType === "Reverse Standings") return "Resets to Inverse Standings Order";
  return "Rolling list, successful claims move to the back";
}

/* ---------------- Waivers ---------------- */

export function MobileWaiversView({ leagueId }: { leagueId: string }) {
  const [tab, setTab] = useState<"pending" | "report">("pending");
  const [showInfo, setShowInfo] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const { data: settings } = useMobileLeagueSettings();

  const order = settings?.waiverOrder ?? [];
  const mine = order.find((o) => o.isMine);
  const teamCount = settings?.teams ?? order.length;

  return (
    <main>
      <div className="grid grid-cols-2 border-b border-m-border">
        {(
          [
            ["pending", "Pending"],
            ["report", "Waiver Report"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "border-b-4 py-3.5 font-display text-lg font-semibold tracking-wide",
              tab === id ? "border-m-accent text-m-card-fg" : "border-transparent text-m-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "pending" ? (
        <>
          <EmptyState icon={<Users className="size-32" strokeWidth={1.5} />} title="No waiver claims">
            <p className="mt-3 text-[15px] leading-relaxed text-m-muted">
              Visit the{" "}
              <Link to="/m/league/$leagueId/players" params={{ leagueId }} className="font-semibold text-m-accent">
                Add Players
              </Link>{" "}
              section to search for better starters and bench depth.
            </p>
            <button type="button" onClick={() => setShowInfo((v) => !v)} className={cn(outlineButton, "mt-6")}>
              {showInfo ? "Hide Waiver Info" : "Learn About Waivers"}
            </button>
            {showInfo ? (
              <p className="mt-4 rounded-xl bg-m-card p-4 text-left text-sm leading-relaxed text-m-card-fg">
                Dropped players and free agents locked after kickoff go on waivers. When the waiver period ends, the
                team with the best priority that put in a claim gets the player. Players nobody claims become free
                agents anyone can add.
              </p>
            ) : null}
          </EmptyState>

          <section className="mt-2">
            <button
              type="button"
              onClick={() => setShowOrder((v) => !v)}
              aria-expanded={showOrder}
              disabled={!order.length}
              className="flex w-full items-center justify-between border-b border-m-border px-4 py-4 font-display text-lg font-semibold"
            >
              Waiver Priority: {mine ? `${mine.priority} of ${teamCount}` : "Unavailable"}
              {order.length ? (
                <ChevronDown className={cn("size-6 transition-transform", showOrder && "rotate-180")} />
              ) : null}
            </button>
            {showOrder ? (
              <ol className="border-b border-m-border bg-m-card">
                {order.map((o) => (
                  <li
                    key={`${o.priority}-${o.team}`}
                    className={cn("flex items-center gap-3 px-4 py-2.5 text-sm", o.isMine && "bg-m-highlight font-semibold")}
                  >
                    <span className="w-6 text-right font-display text-base font-bold text-m-muted">{o.priority}</span>
                    <span className="truncate">{o.team}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            <ul>
              <SettingRow label="Waiver Type" value={waiverTypeLabel(settings)} />
              <SettingRow
                label="Waiver Period"
                value={settings?.waiverPeriodDays != null ? days(settings.waiverPeriodDays) : "Unavailable"}
              />
            </ul>
          </section>
        </>
      ) : (
        <section className="px-3">
          <MobileActivityList
            kinds={["waiver"]}
            empty={<p className="py-12 text-center text-sm text-m-muted">No waiver claims have been processed yet.</p>}
          />
        </section>
      )}
    </main>
  );
}

/* ---------------- Trades ---------------- */

function deadlineLabel(s: LeagueSettingsDetail | null | undefined) {
  if (s?.tradeDeadlineDate) {
    return new Date(s.tradeDeadlineDate).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }
  if (s?.tradeDeadlineWeek) return `Week ${s.tradeDeadlineWeek}`;
  return "No deadline";
}

const PENDING_TRADE_STATUSES = new Set(["proposed", "veto_window"]);

export function MobileTradesView({ leagueId }: { leagueId: string }) {
  const { data: settings } = useMobileLeagueSettings();
  const { activeLeague } = useActiveLeague();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: playersPayload } = useSleeperPlayers();
  const [busyId, setBusyId] = useState<number | null>(null);

  const isNative = (activeLeague?.platform ?? "").toLowerCase() === "native";
  const linkId = isNative ? (activeLeague?.id ?? null) : null;

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of playersPayload?.players ?? []) map.set(p.id, p.name);
    return map;
  }, [playersPayload?.players]);

  const tradesQuery = useQuery({
    queryKey: ["native-trades", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 15_000,
    queryFn: () => listNativeTrades({ data: { linkId: linkId! } }),
  });

  const pending = (tradesQuery.data?.trades ?? []).filter((t) =>
    PENDING_TRADE_STATUSES.has(String(t.status).toLowerCase()),
  );
  const myTeamId = tradesQuery.data?.myTeamId ?? null;
  const canVeto = Boolean(tradesQuery.data?.canVeto);

  const refreshTrades = async () => {
    if (!linkId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["native-trades", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["league-transaction-log", linkId] }),
      queryClient.invalidateQueries({ queryKey: ["native-transactions", linkId] }),
    ]);
  };

  const respond = async (tradeId: number, action: "accept" | "reject" | "cancel" | "veto") => {
    if (!linkId || busyId != null) return;
    setBusyId(tradeId);
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
      await refreshTrades();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update trade.");
    } finally {
      setBusyId(null);
    }
  };

  const proposeHref = isNative ? undefined : "/trade";
  const proposeToPlayers = isNative;

  return (
    <main className="pt-3">
      <div className="px-2.5">
        {proposeToPlayers ? (
          <Link
            to="/m/league/$leagueId/players"
            params={{ leagueId }}
            className="block w-full rounded-lg bg-m-accent py-3 text-center font-display text-lg font-semibold tracking-wide text-m-accent-fg"
          >
            Propose Trade
          </Link>
        ) : (
          <Link
            to={proposeHref!}
            className="block w-full rounded-lg bg-m-accent py-3 text-center font-display text-lg font-semibold tracking-wide text-m-accent-fg"
          >
            Propose Trade
          </Link>
        )}
      </div>

      {isNative && tradesQuery.isLoading ? (
        <p className="px-4 py-10 text-center text-sm text-m-muted">Loading pending trades…</p>
      ) : isNative && pending.length > 0 ? (
        <section className="mt-4 space-y-3 px-3">
          <h2 className="px-1 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">
            Pending Trades
          </h2>
          {pending.map((t) => {
            const giveLeg = t.legs.find((l) => l.teamId === t.proposerTeamId);
            const getLeg = t.legs.find((l) => l.teamId === t.acceptorTeamId);
            const proposerGives = (giveLeg?.playerIds ?? []).map((id) => nameById.get(id) ?? id);
            const acceptorGives = (getLeg?.playerIds ?? []).map((id) => nameById.get(id) ?? id);
            const status = String(t.status).toLowerCase();
            const busy = busyId === t.id;
            return (
              <article
                key={t.id}
                className="overflow-hidden rounded-xl border border-m-border bg-m-card"
              >
                <header className="flex items-center justify-between gap-2 border-b border-m-border px-3 py-2.5">
                  <span className="min-w-0 truncate text-sm font-semibold">
                    {t.proposerName ?? "Team"} and {t.acceptorName ?? "Team"}
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-m-muted">
                    {status === "veto_window" ? "Review" : "Proposed"}
                  </span>
                </header>
                <div className="divide-y divide-m-border">
                  <div className="px-3 py-2.5">
                    <p className="text-xs font-semibold text-m-muted">{t.proposerName ?? "Proposer"}</p>
                    <ul className="mt-1 space-y-0.5">
                      {proposerGives.map((name) => (
                        <li key={`give-${t.id}-${name}`} className="text-sm text-m-card-fg">
                          <span className="font-semibold text-red-500">−</span> {name}
                        </li>
                      ))}
                      {acceptorGives.map((name) => (
                        <li key={`get-${t.id}-${name}`} className="text-sm text-m-card-fg">
                          <span className="font-semibold text-emerald-500">+</span> {name}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="px-3 py-2.5">
                    <p className="text-xs font-semibold text-m-muted">{t.acceptorName ?? "Acceptor"}</p>
                    <ul className="mt-1 space-y-0.5">
                      {acceptorGives.map((name) => (
                        <li key={`agive-${t.id}-${name}`} className="text-sm text-m-card-fg">
                          <span className="font-semibold text-red-500">−</span> {name}
                        </li>
                      ))}
                      {proposerGives.map((name) => (
                        <li key={`aget-${t.id}-${name}`} className="text-sm text-m-card-fg">
                          <span className="font-semibold text-emerald-500">+</span> {name}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-m-border px-3 py-2.5">
                  {status === "proposed" && t.acceptorTeamId === myTeamId ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void respond(t.id, "accept")}
                        className="rounded-lg bg-m-accent px-3 py-1.5 font-display text-sm font-semibold text-m-accent-fg disabled:opacity-60"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void respond(t.id, "reject")}
                        className={cn(outlineButton, "px-3 py-1.5 text-sm")}
                      >
                        Reject
                      </button>
                    </>
                  ) : null}
                  {status === "proposed" && t.proposerTeamId === myTeamId ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void respond(t.id, "cancel")}
                      className={cn(outlineButton, "px-3 py-1.5 text-sm")}
                    >
                      Cancel
                    </button>
                  ) : null}
                  {(status === "veto_window" || status === "proposed") && canVeto ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void respond(t.id, "veto")}
                      className={cn(outlineButton, "px-3 py-1.5 text-sm")}
                    >
                      Veto
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <EmptyState icon={<ArrowLeftRight className="size-28" strokeWidth={1.75} />} title="No trades pending">
          <p className="mt-3 text-[15px] leading-relaxed text-m-muted">
            Improve weak spots by proposing a trade for another manager&apos;s player. A trade that also benefits the
            other team has a better chance of being accepted.
          </p>
          {proposeToPlayers ? (
            <Link
              to="/m/league/$leagueId/players"
              params={{ leagueId }}
              className={cn(outlineButton, "mt-6")}
            >
              Browse Players
            </Link>
          ) : (
            <Link to="/trade" className={cn(outlineButton, "mt-6")}>
              Review Suggestions
            </Link>
          )}
        </EmptyState>
      )}

      <ul className="mt-2">
        <SettingRow
          label="Max Trades per Season"
          value={settings?.maxTrades ? `${settings.maxTrades} trades` : "Unlimited Trades"}
        />
        <SettingRow label="Trade Review Type" value={settings?.tradeReviewType ?? "Set by your league host"} />
        <SettingRow label="Trade Deadline" value={deadlineLabel(settings)} />
        <SettingRow
          label="Trade Review Period"
          value={settings?.tradeReviewDays != null ? days(settings.tradeReviewDays) : "Unavailable"}
        />
      </ul>

      <h2 className="px-4 pb-1 pt-6 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">
        Completed Trades
      </h2>
      <section className="px-3">
        <MobileActivityList
          kinds={["trade"]}
          empty={<p className="py-10 text-center text-sm text-m-muted">No trades completed this season.</p>}
        />
      </section>
    </main>
  );
}
