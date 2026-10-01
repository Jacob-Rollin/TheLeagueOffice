import { useEffect, useState, type ReactNode } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { playbookPanelTitleClass, resolveAvatarUrl } from "@/components/playbook/panels";
import type { Player } from "@/lib/draft";
import { cn } from "@/lib/utils";

export type SidebarMatchupSide = {
  rosterId: number;
  name: string;
  logo: string | null;
  live: number;
  proj: number;
  winPct: number;
};

export type SidebarMatchup = {
  id: string;
  a: SidebarMatchupSide;
  b: SidebarMatchupSide;
  started: boolean;
  final: boolean;
};

export type StartSitAlert = {
  id: string;
  start: Player;
  sit: Player;
  startPts: number;
  sitPts: number;
};

export type SlotOrderMove = {
  id: string;
  player: Player;
  from: string;
  to: string;
  kickoffLabel: string;
};

export function SidebarPanel({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <h2 className={playbookPanelTitleClass}>{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

function initials(name: string): string {
  const letters = name.trim().replace(/[^a-zA-Z0-9]/g, "");
  return (letters.length >= 2 ? letters.slice(0, 2) : name.trim().slice(0, 2) || "TM").toUpperCase();
}

function SidebarTeamAvatar({
  name,
  logo,
  platform,
}: {
  name: string;
  logo: string | null;
  platform: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const src = resolveAvatarUrl(logo);
  useEffect(() => setFailed(false), [src]);
  const box = "flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200/80";

  if (src && !failed) {
    return (
      <span className={cn(box, "bg-slate-50")}>
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      </span>
    );
  }
  if ((platform ?? "").toLowerCase() === "espn") {
    return (
      <span className={cn(box, "bg-white p-0.5")}>
        <img src="/espn.png" alt="" className="size-5 object-contain" aria-hidden="true" />
      </span>
    );
  }
  return <span className={cn(box, "bg-slate-50 text-[9px] font-bold text-slate-600")}>{initials(name)}</span>;
}

/** Compact two-team card: names, score (projection before kickoff), win % and bar. */
export function SidebarMatchupCard({
  matchup,
  platform,
  onLineups,
}: {
  matchup: SidebarMatchup;
  platform: string | null;
  onLineups: () => void;
}) {
  const { a, b, started, final } = matchup;
  const aWon = final && a.live > b.live + 0.005;
  const bWon = final && b.live > a.live + 0.005;
  const tied = final && !aWon && !bWon;
  const aLeads = final ? aWon : a.winPct >= b.winPct;

  const score = (side: SidebarMatchupSide) => (started ? side.live : side.proj).toFixed(2);
  const pctLabel = (side: SidebarMatchupSide, won: boolean) =>
    final ? (tied ? "TIE" : won ? "WON" : "LOST") : `${side.winPct}%`;
  const pctTone = (leads: boolean) =>
    final && tied ? "text-slate-500" : leads ? "text-emerald-600" : "text-rose-600";
  const scoreTone = (won: boolean) => (final && !won && !tied ? "text-slate-400" : "text-slate-900");
  const barWidth = (side: SidebarMatchupSide, won: boolean) =>
    final ? (won ? 100 : tied ? 50 : 0) : side.winPct;

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SidebarTeamAvatar name={a.name} logo={a.logo} platform={platform} />
          <span className="truncate text-xs font-bold text-slate-900">{a.name}</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <span className="truncate text-right text-xs font-bold text-slate-900">{b.name}</span>
          <SidebarTeamAvatar name={b.name} logo={b.logo} platform={platform} />
        </div>
      </div>

      <div className="mt-2 flex items-end justify-between">
        <div>
          <p className={cn("text-lg font-bold leading-none tabular-nums", scoreTone(aWon))}>{score(a)}</p>
          <p className={cn("mt-1 text-[11px] font-bold tabular-nums", pctTone(aLeads))}>{pctLabel(a, aWon)}</p>
        </div>
        <span className="pb-3 text-[10px] font-extrabold uppercase text-slate-300">
          {started ? "vs" : "proj"}
        </span>
        <div className="text-right">
          <p className={cn("text-lg font-bold leading-none tabular-nums", scoreTone(bWon))}>{score(b)}</p>
          <p className={cn("mt-1 text-[11px] font-bold tabular-nums", pctTone(!aLeads))}>{pctLabel(b, bWon)}</p>
        </div>
      </div>

      <div className="mt-2 flex h-1 items-center gap-1">
        <div className="flex h-full min-w-0 flex-1 justify-end overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              final ? (aWon ? "bg-emerald-500" : "bg-transparent") : aLeads ? "bg-emerald-500" : "bg-rose-500",
            )}
            style={{ width: `${barWidth(a, aWon)}%` }}
          />
        </div>
        <div className="flex h-full min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              final ? (bWon ? "bg-emerald-500" : "bg-transparent") : aLeads ? "bg-rose-500" : "bg-emerald-500",
            )}
            style={{ width: `${barWidth(b, bWon)}%` }}
          />
        </div>
      </div>

      <div className="mt-2 flex justify-end">
        <button type="button" onClick={onLineups} className="text-xs font-semibold text-primary hover:underline">
          Lineups
        </button>
      </div>
    </div>
  );
}

const POS_TEXT: Record<string, string> = {
  QB: "text-qb",
  RB: "text-rb",
  WR: "text-wr",
  TE: "text-te",
  K: "text-k",
  DEF: "text-def",
};

export function SlotOrderPanel({
  moves,
  onOpenPlayer,
}: {
  moves: SlotOrderMove[];
  onOpenPlayer: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-bold leading-relaxed text-slate-400">
        Same starters, same projection. Earlier games moved into fixed slots so the flex stays editable later.
      </p>
      {moves.map((move) => (
        <button
          key={move.id}
          type="button"
          onClick={() => onOpenPlayer(move.player.id)}
          className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/40 p-3 text-left transition-opacity hover:opacity-85"
        >
          <PlayerAvatar
            id={move.player.id}
            pos={move.player.pos}
            team={move.player.team}
            name={move.player.name}
            className="size-10 shrink-0 rounded-full border border-slate-100 bg-white"
            logoClassName="size-3.5"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-black text-slate-900">{move.player.name}</span>
            <span className="mt-1 flex items-center gap-1.5 text-[11px] font-bold">
              <span className={POS_TEXT[move.player.pos] ?? "text-slate-500"}>{move.player.pos}</span>
              <span className="text-slate-500">{(move.player.team || "FA").toUpperCase()}</span>
              {move.kickoffLabel ? (
                <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                  {move.kickoffLabel}
                </span>
              ) : null}
            </span>
          </span>
          <span className="shrink-0 text-[11px] font-black tracking-wide text-primary">
            {move.from} → {move.to}
          </span>
        </button>
      ))}
    </div>
  );
}

export function StartSitPanel({
  alerts,
  lock,
  isCurrentWeek,
  onOpenPlayer,
}: {
  alerts: StartSitAlert[];
  lock: "none" | "some" | "all";
  isCurrentWeek: boolean;
  onOpenPlayer: (id: string) => void;
}) {
  if (!isCurrentWeek || !alerts.length) {
    const label = !isCurrentWeek ? "PAST WEEK" : lock === "all" ? "LOCKED" : "OPTIMIZED";
    const title = !isCurrentWeek
      ? "Advice Covers the Current Week"
      : lock === "all"
        ? "Games Have Started"
        : lock === "some"
          ? "No Available Moves"
          : "Your Lineup is Optimal";
    const detail = !isCurrentWeek
      ? "Switch back to the current week to see start/sit upgrades."
      : lock === "all"
        ? "All of your players' games have kicked off. No lineup moves remain this week."
        : lock === "some"
          ? "Games are underway. Players whose games have kicked off are locked and left out of this advice."
          : "No projection upgrades detected on your bench.";
    return (
      <div className="flex w-full items-center gap-4 rounded-xl border border-slate-100 bg-slate-50/40 p-4 text-left">
        <span
          className={cn(
            "shrink-0 rounded px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider",
            !isCurrentWeek || lock === "all" ? "bg-slate-200 text-slate-700" : "bg-emerald-100 text-emerald-800",
          )}
        >
          {label}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-black tracking-wide text-slate-900">{title}</p>
          <p className="mt-0.5 text-[11px] font-bold text-slate-400">{detail}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="grid w-full grid-cols-[1fr_32px_1fr] items-center rounded-xl border border-slate-100 bg-slate-50/40 p-3"
        >
          <button
            type="button"
            onClick={() => onOpenPlayer(alert.start.id)}
            className="flex min-w-0 flex-col items-start gap-2 text-left transition-opacity hover:opacity-85"
          >
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black tracking-wider text-emerald-800">
              START
            </span>
            <span className="flex w-full min-w-0 items-center gap-2">
              <PlayerAvatar
                id={alert.start.id}
                pos={alert.start.pos}
                team={alert.start.team}
                name={alert.start.name}
                className="size-9 shrink-0 rounded-full border border-slate-100 bg-white"
                logoClassName="size-3"
              />
              <span className="min-w-0">
                <span className="block truncate text-xs font-black text-slate-900">{alert.start.name}</span>
                <span className="mt-0.5 block text-[11px] font-bold text-slate-500">
                  {alert.startPts.toFixed(1)} Proj
                </span>
              </span>
            </span>
          </button>

          <span className="flex size-6 items-center justify-center justify-self-center rounded-full border border-slate-200 bg-white text-[9px] font-black text-slate-400">
            vs
          </span>

          <button
            type="button"
            onClick={() => onOpenPlayer(alert.sit.id)}
            className="flex min-w-0 flex-col items-end gap-2 text-right transition-opacity hover:opacity-85"
          >
            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-black tracking-wider text-rose-800">
              SIT
            </span>
            <span className="flex w-full min-w-0 items-center justify-end gap-2">
              <span className="min-w-0">
                <span className="block truncate text-xs font-black text-slate-900">{alert.sit.name}</span>
                <span className="mt-0.5 block text-[11px] font-bold text-slate-500">
                  {alert.sitPts.toFixed(1)} Proj
                </span>
              </span>
              <PlayerAvatar
                id={alert.sit.id}
                pos={alert.sit.pos}
                team={alert.sit.team}
                name={alert.sit.name}
                className="size-9 shrink-0 rounded-full border border-slate-100 bg-white"
                logoClassName="size-3"
              />
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
