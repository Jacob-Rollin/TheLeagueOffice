import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronDown, Minus, Plus, Settings, Users } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  buildActivityPlayerIndex,
  hydrateActivityMove,
  tradeTeams,
} from "@/components/dashboard/ActivityFeed";
import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { playerPressProps, useOpenMobilePlayer } from "@/components/mobile/MobilePlayerSheet";
import type { LeagueSettingsDetail } from "@/lib/league-settings";
import type { LeagueActivityMove } from "@/lib/league.functions";
import type { Pos } from "@/lib/draft";
import { respondNativeTrade } from "@/lib/native-league.functions";
import { tradeMovesFromNativeLegs } from "@/lib/native-league-sync-adapter";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { cn } from "@/lib/utils";

import { MobileActivityList } from "./MobileLeagueChrome";
import { useMobileLeagueSettings, useNativePendingTrades } from "./useMobileLeague";

const AVATAR_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

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

function PendingTradeMoveRow({
  move,
  action,
  note,
}: {
  move: LeagueActivityMove;
  action: "add" | "drop";
  note?: string;
}) {
  const openPlayer = useOpenMobilePlayer();
  const pos = move.pos.toUpperCase();
  const ActionIcon = action === "add" ? Plus : Minus;
  const openId = move.playerId || null;
  return (
    <li
      className={cn("flex items-center gap-3 px-3 py-2", openId && "cursor-pointer")}
      {...playerPressProps(openPlayer, openId)}
    >
      <ActionIcon
        className={cn("size-5 shrink-0", action === "add" ? "text-emerald-500" : "text-red-500")}
        strokeWidth={2.5}
      />
      <PlayerAvatar
        id={move.playerId}
        pos={(AVATAR_POS.has(pos) ? pos : "WR") as Pos}
        team={move.team}
        name={move.name}
        className="size-10"
        logoClassName="size-4"
      />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold">{move.name}</span>
        <span className="block truncate text-xs text-m-muted">
          {pos === "DEF" ? "DST" : pos} - {move.team || "FA"}
          {note ? ` · ${note}` : ""}
        </span>
      </span>
    </li>
  );
}

type PendingTrade = {
  id: number;
  proposerTeamId: number;
  acceptorTeamId: number;
  proposerName: string | null;
  acceptorName: string | null;
  status: string;
  legs: { teamId: number; playerIds: string[] }[];
};

function PendingTradeCard({
  trade,
  myTeamId,
  canVeto,
  busy,
  onRespond,
  hydrate,
}: {
  trade: PendingTrade;
  myTeamId: number | null;
  canVeto: boolean;
  busy: boolean;
  onRespond: (tradeId: number, action: "accept" | "reject" | "cancel" | "veto") => void;
  hydrate: (move: LeagueActivityMove) => LeagueActivityMove;
}) {
  const nameByTeamId = new Map<number, string>();
  nameByTeamId.set(trade.proposerTeamId, trade.proposerName?.trim() || `Team ${trade.proposerTeamId}`);
  nameByTeamId.set(trade.acceptorTeamId, trade.acceptorName?.trim() || `Team ${trade.acceptorTeamId}`);
  const moves = tradeMovesFromNativeLegs(trade.legs, nameByTeamId).map(hydrate);
  const teams = tradeTeams(moves);
  const adds = moves.filter((m) => m.action === "add");
  const status = String(trade.status).toLowerCase();
  const title =
    teams.length === 2
      ? `${teams[0]} and ${teams[1]}`
      : `${trade.proposerName ?? "Team"} and ${trade.acceptorName ?? "Team"}`;

  return (
    <article className="overflow-hidden rounded-xl border border-m-border bg-m-card">
      <header className="flex items-center justify-between gap-2 border-b border-m-border px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-m-muted">
          {status === "veto_window" ? "Review" : "Proposed"}
        </span>
      </header>
      <div className="divide-y divide-m-border pb-1">
        {teams.map((team) => {
          const received = adds.filter((m) => m.fantasyTeam?.trim() === team);
          const sent = adds.filter((m) => m.fromFantasyTeam?.trim() === team);
          if (!received.length && !sent.length) return null;
          return (
            <div key={team}>
              <p className="px-3 pb-0.5 pt-2.5 text-xs font-semibold text-m-muted">{team}</p>
              <ul>
                {received.map((move, i) => (
                  <PendingTradeMoveRow
                    key={`in-${move.playerId}-${i}`}
                    move={move}
                    action="add"
                    {...(move.fromFantasyTeam ? { note: `from ${move.fromFantasyTeam}` } : {})}
                  />
                ))}
                {sent.map((move, i) => (
                  <PendingTradeMoveRow
                    key={`out-${move.playerId}-${i}`}
                    move={move}
                    action="drop"
                    {...(move.fantasyTeam ? { note: `to ${move.fantasyTeam}` } : {})}
                  />
                ))}
              </ul>
            </div>
          );
        })}
        {!teams.length ? (
          <p className="px-3 py-3 text-sm text-m-muted">Trade details unavailable.</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-m-border px-3 py-2.5">
        {status === "proposed" && trade.acceptorTeamId === myTeamId ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRespond(trade.id, "accept")}
              className="rounded-lg bg-m-accent px-3 py-1.5 font-display text-sm font-semibold text-m-accent-fg disabled:opacity-60"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRespond(trade.id, "reject")}
              className={cn(outlineButton, "px-3 py-1.5 text-sm")}
            >
              Reject
            </button>
          </>
        ) : null}
        {status === "proposed" && trade.proposerTeamId === myTeamId ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRespond(trade.id, "cancel")}
            className={cn(outlineButton, "px-3 py-1.5 text-sm")}
          >
            Cancel
          </button>
        ) : null}
        {(status === "veto_window" || status === "proposed") && canVeto ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRespond(trade.id, "veto")}
            className={cn(outlineButton, "px-3 py-1.5 text-sm")}
          >
            Veto
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function MobileTradesView({ leagueId }: { leagueId: string }) {
  const { data: settings } = useMobileLeagueSettings();
  const queryClient = useQueryClient();
  const { data: playersPayload } = useSleeperPlayers();
  const [busyId, setBusyId] = useState<number | null>(null);
  const {
    isNative,
    linkId,
    myTeamId,
    canVeto,
    pendingAll: pending,
    isLoading,
  } = useNativePendingTrades();

  const playerIndex = useMemo(
    () => buildActivityPlayerIndex(playersPayload?.players),
    [playersPayload?.players],
  );
  const hydrate = (move: LeagueActivityMove) =>
    hydrateActivityMove(move, playerIndex.playersById, playerIndex.playersByName);

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
            to="/trade"
            className="block w-full rounded-lg bg-m-accent py-3 text-center font-display text-lg font-semibold tracking-wide text-m-accent-fg"
          >
            Propose Trade
          </Link>
        )}
      </div>

      {isNative && isLoading ? (
        <p className="px-4 py-10 text-center text-sm text-m-muted">Loading pending trades…</p>
      ) : isNative && pending.length > 0 ? (
        <section className="mt-4 space-y-3 px-3">
          <h2 className="px-1 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">
            Pending Trades
          </h2>
          {pending.map((t) => (
            <PendingTradeCard
              key={t.id}
              trade={t}
              myTeamId={myTeamId}
              canVeto={canVeto}
              busy={busyId === t.id}
              onRespond={(id, action) => void respond(id, action)}
              hydrate={hydrate}
            />
          ))}
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
