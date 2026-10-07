import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, ChevronDown, Settings, Users } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { LeagueSettingsDetail } from "@/lib/league-settings";
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

export function MobileTradesView() {
  const { data: settings } = useMobileLeagueSettings();

  return (
    <main className="pt-3">
      <div className="px-2.5">
        <Link
          to="/trade"
          className="block w-full rounded-lg bg-m-accent py-3 text-center font-display text-lg font-semibold tracking-wide text-m-accent-fg"
        >
          Propose Trade
        </Link>
      </div>

      <EmptyState icon={<ArrowLeftRight className="size-28" strokeWidth={1.75} />} title="No trades pending">
        <p className="mt-3 text-[15px] leading-relaxed text-m-muted">
          Improve weak spots by proposing a trade for another manager's player. A trade that also benefits the other
          team has a better chance of being accepted.
        </p>
        <Link to="/trade" className={cn(outlineButton, "mt-6")}>
          Review Suggestions
        </Link>
      </EmptyState>

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
