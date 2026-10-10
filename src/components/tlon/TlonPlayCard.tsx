import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import type { Pos } from "@/lib/draft";
import type { TlonFeedEvent } from "@/lib/tlon-play-feed";
import { cn } from "@/lib/utils";

function formatDelta(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)}`;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function TlonPlayCard({
  event,
  leftLabel = "YOU",
  rightLabel = "OPP",
  onOpenPlayer,
}: {
  event: TlonFeedEvent;
  leftLabel?: string;
  rightLabel?: string;
  onOpenPlayer?: (id: string) => void;
}) {
  const positive = event.delta >= 0;
  const sideLabel = event.side === "left" ? leftLabel : rightLabel;
  const pos = (event.pos || "WR") as Pos;

  return (
    <article
      className={cn(
        "flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm",
        "animate-in fade-in slide-in-from-top-1 duration-300",
      )}
    >
      <button
        type="button"
        className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={() => onOpenPlayer?.(event.playerId)}
        aria-label={`Open ${event.playerName}`}
      >
        <PlayerAvatar id={event.playerId} pos={pos} team={event.team} name={event.playerName} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              event.side === "left"
                ? "bg-blue-600 text-white"
                : "bg-slate-700 text-white",
            )}
          >
            {sideLabel}
          </span>
          <button
            type="button"
            className="truncate text-sm font-semibold text-slate-900 hover:underline"
            onClick={() => onOpenPlayer?.(event.playerId)}
          >
            {event.playerName}
          </button>
          <span className="text-[11px] font-medium uppercase text-slate-400">{event.pos}</span>
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-600">{event.headline}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {formatTime(event.at)}
          {event.gameLabel ? <span className="ml-1.5 text-slate-500">{event.gameLabel}</span> : null}
        </p>
      </div>

      <div
        className={cn(
          "shrink-0 font-display text-2xl font-extrabold tabular-nums",
          positive ? "text-emerald-600" : "text-rose-600",
        )}
      >
        {formatDelta(event.delta)}
      </div>
    </article>
  );
}
