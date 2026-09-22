import { memo, type CSSProperties } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import type { Player } from "@/lib/draft";
import { cn } from "@/lib/utils";

export type ProjectionOwnership = "roster" | "taken" | "available";

export type ProjectionRowData = {
  player: Player;
  /** Null when Sleeper has no projection line ("—"). */
  proj: number | null;
  ownership: ProjectionOwnership;
  value: number;
  trend: number;
  injuryLabel: string | null;
  injuryClass: string | null;
  metaLine: string;
};

export const PROJECTION_OWNERSHIP_META: Record<
  ProjectionOwnership,
  { label: string; swatch: string; row: string; chip: string }
> = {
  roster: {
    label: "Roster",
    swatch: "bg-sky-100 border-sky-300",
    row: "bg-sky-50/90",
    chip: "bg-sky-100 text-sky-800",
  },
  taken: {
    label: "Taken",
    swatch: "bg-white border-slate-300",
    row: "bg-white",
    chip: "bg-slate-100 text-slate-600",
  },
  available: {
    label: "Available",
    swatch: "bg-emerald-100 border-emerald-300",
    row: "bg-emerald-50/80",
    chip: "bg-emerald-100 text-emerald-800",
  },
};

export const PROJECTION_ROW_HEIGHT = 58;

export const ProjectionListRow = memo(function ProjectionListRow({
  row,
  rank,
  onOpen,
  style,
}: {
  row: ProjectionRowData;
  rank: number;
  onOpen: (id: string) => void;
  style?: CSSProperties;
}) {
  const meta = PROJECTION_OWNERSHIP_META[row.ownership];
  const trendUp = row.trend > 0.05;
  const trendDown = row.trend < -0.05;
  const { player } = row;

  return (
    <li className={cn("absolute left-0 top-0 w-full select-none", meta.row)} style={style}>
      <button
        type="button"
        onClick={() => onOpen(player.id)}
        className="grid h-full w-full cursor-pointer grid-cols-[2.5rem_minmax(0,1.35fr)_minmax(5rem,0.7fr)_minmax(7.5rem,0.95fr)_3.5rem] items-center gap-x-2 border-b border-slate-100 px-3 text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 sm:grid-cols-[2.75rem_minmax(12rem,1.45fr)_minmax(5.5rem,0.75fr)_minmax(8.5rem,1fr)_4rem] sm:gap-x-4 sm:px-4"
      >
        <span className="text-center text-sm tabular-nums text-slate-500">{rank}</span>
        <span className="flex min-w-0 items-center gap-2.5">
          <PlayerAvatar
            id={player.id}
            pos={player.pos}
            team={player.team}
            name={player.name}
            className="size-9 flex-shrink-0 rounded-full border-2 border-slate-200 bg-white"
            logoClassName="size-3"
          />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-semibold text-blue-700">{player.name}</span>
              {row.injuryLabel && row.injuryClass ? (
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[2px] px-0.5 text-[9px] font-bold text-white",
                    row.injuryClass,
                  )}
                >
                  {row.injuryLabel}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-[11px] font-medium uppercase text-slate-400">
              {row.metaLine}
            </span>
          </span>
        </span>
        <span className="flex justify-center">
          <span
            className={cn(
              "inline-flex items-center justify-center rounded px-2 py-0.5 text-center text-[9px] font-black uppercase tracking-wider",
              meta.chip,
            )}
          >
            {meta.label}
          </span>
        </span>
        <span className="inline-flex items-center justify-center gap-1.5 text-sm tabular-nums text-slate-500">
          <span>{row.value.toFixed(1)}</span>
          <span className="text-slate-300">/</span>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-semibold",
              trendUp ? "text-emerald-600" : trendDown ? "text-rose-600" : "text-slate-400",
            )}
          >
            <span aria-hidden="true">{trendUp ? "▲" : trendDown ? "▼" : "–"}</span>
            <span>{Math.abs(row.trend).toFixed(1)}</span>
          </span>
        </span>
        <span className="text-right text-sm font-semibold tabular-nums text-slate-900">
          {row.proj != null && Number.isFinite(row.proj) ? row.proj.toFixed(2) : "—"}
        </span>
      </button>
    </li>
  );
});
