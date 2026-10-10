import type { ReactNode } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import type { Pos } from "@/lib/draft";
import type { NflGameProgress } from "@/lib/rolling-live-projection";
import { cn } from "@/lib/utils";

export type TlonStudioPlayer = {
  id: string;
  name: string;
  pos: string;
  team: string;
  side: "left" | "right";
  livePoints: number;
  progress?: NflGameProgress | null;
};

function periodLabel(p?: NflGameProgress | null): string {
  if (!p) return "";
  if (p.phase === "pre") {
    if (p.kickoffIso) {
      const t = Date.parse(p.kickoffIso);
      if (Number.isFinite(t)) {
        return new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      }
    }
    return p.shortDetail || "Upcoming";
  }
  if (p.phase === "post") return "Final";
  const q = p.period != null ? (p.period > 4 ? "OT" : `Q${p.period}`) : "";
  const clock = p.displayClock || "";
  return [q, clock].filter(Boolean).join(" ");
}

function StudioRow({
  row,
  leftLabel,
  rightLabel,
  onOpen,
}: {
  row: TlonStudioPlayer;
  leftLabel: string;
  rightLabel: string;
  onOpen?: (id: string) => void;
}) {
  const side = row.side === "left" ? leftLabel : rightLabel;
  return (
    <button
      type="button"
      onClick={() => onOpen?.(row.id)}
      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-slate-50"
    >
      <PlayerAvatar
        id={row.id}
        pos={(row.pos || "WR") as Pos}
        team={row.team}
        name={row.name}
        className="size-8"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded px-1 py-px text-[9px] font-bold uppercase",
              row.side === "left" ? "bg-blue-600 text-white" : "bg-slate-700 text-white",
            )}
          >
            {side}
          </span>
          <span className="truncate text-sm font-semibold text-slate-900">{row.name}</span>
        </div>
        <p className="truncate text-[11px] text-slate-500">
          {row.team || "—"}
          {row.progress?.opponentAbbr ? ` @ ${row.progress.opponentAbbr}` : ""}
          {row.progress?.isRedZone ? " · Red zone" : ""}
          {row.progress?.possessionAbbr === (row.team || "").toUpperCase() ? " · Ball" : ""}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums text-slate-900">
          {(Math.round(row.livePoints * 10) / 10).toFixed(1)}
        </p>
        <p className="text-[11px] tabular-nums text-slate-500">{periodLabel(row.progress)}</p>
      </div>
    </button>
  );
}

function Panel({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode;
}) {
  const hasKids = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-3 py-2">
        <h3 className="display-title text-sm text-slate-900">{title}</h3>
      </header>
      <div className="max-h-56 space-y-0.5 overflow-y-auto px-2 py-1.5">
        {hasKids ? children : <p className="px-1.5 py-3 text-sm text-slate-500">{empty}</p>}
      </div>
    </section>
  );
}

export function TlonStudio({
  onClock,
  comingUp,
  locked,
  leftLabel,
  rightLabel,
  onOpenPlayer,
}: {
  onClock: TlonStudioPlayer[];
  comingUp: TlonStudioPlayer[];
  locked: TlonStudioPlayer[];
  leftLabel: string;
  rightLabel: string;
  onOpenPlayer?: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Panel title="On the Clock" empty="No starters in live NFL games right now.">
        {onClock.map((row) => (
          <StudioRow
            key={`live-${row.id}`}
            row={row}
            leftLabel={leftLabel}
            rightLabel={rightLabel}
            {...(onOpenPlayer ? { onOpen: onOpenPlayer } : {})}
          />
        ))}
      </Panel>
      <Panel title="Coming Up" empty="Every starter is already underway or final.">
        {comingUp.map((row) => (
          <StudioRow
            key={`pre-${row.id}`}
            row={row}
            leftLabel={leftLabel}
            rightLabel={rightLabel}
            {...(onOpenPlayer ? { onOpen: onOpenPlayer } : {})}
          />
        ))}
      </Panel>
      <Panel title="Final / Locked" empty="No starter games are final yet.">
        {locked.map((row) => (
          <StudioRow
            key={`post-${row.id}`}
            row={row}
            leftLabel={leftLabel}
            rightLabel={rightLabel}
            {...(onOpenPlayer ? { onOpen: onOpenPlayer } : {})}
          />
        ))}
      </Panel>
    </div>
  );
}

export function TlonChaseMeter({
  leftLive,
  rightLive,
  leftProj,
  rightProj,
  leftName,
  rightName,
  winHistory,
}: {
  leftLive: number;
  rightLive: number;
  leftProj: number;
  rightProj: number;
  leftName: string;
  rightName: string;
  /** Session win% samples for left side (0–100). */
  winHistory: number[];
}) {
  const liveGap = Math.round((leftLive - rightLive) * 10) / 10;
  const projGap = Math.round((leftProj - rightProj) * 10) / 10;
  const livePhrase =
    Math.abs(liveGap) < 0.05
      ? "Tied live"
      : liveGap > 0
        ? `${leftName} leads by ${liveGap.toFixed(1)}`
        : `${rightName} leads by ${Math.abs(liveGap).toFixed(1)}`;
  const projPhrase =
    Math.abs(projGap) < 0.05
      ? "Projected toss-up"
      : projGap > 0
        ? `Expected final +${projGap.toFixed(1)} ${leftName}`
        : `Expected final +${Math.abs(projGap).toFixed(1)} ${rightName}`;

  const spark = winHistory.slice(-24);
  const w = 160;
  const h = 36;
  const pts =
    spark.length > 1
      ? spark
          .map((v, i) => {
            const x = (i / (spark.length - 1)) * w;
            const y = h - (Math.max(0, Math.min(100, v)) / 100) * h;
            return `${x},${y}`;
          })
          .join(" ")
      : "";

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="display-title text-sm text-slate-900">Score Chase</h3>
          <p className="mt-1 text-sm font-semibold text-slate-800">{livePhrase}</p>
          <p className="text-sm text-slate-500">{projPhrase}</p>
        </div>
        {pts ? (
          <div className="text-right">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Win% this session
            </p>
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-blue-600"
                points={pts}
              />
            </svg>
          </div>
        ) : null}
      </div>
    </section>
  );
}
