import { useEffect, useRef, useState } from "react";

import { playerImage } from "@/components/draft/PlayerAvatar";
import type { Pos } from "@/lib/draft";
import type { TlonFeedEvent } from "@/lib/tlon-play-feed";
import { cn } from "@/lib/utils";

const HOLD_MS = 8_000;
const MAX_PER_SIDE = 4;

/**
 * Same yard mapping as TlonField — stacks sit on each side’s 20-yard line
 * for balance (not jammed in the end-zone corners).
 */
const EZ = 8;
const PLAYABLE = 100 - EZ * 2;
function yardToPct(yardsFromLeftGoal: number): number {
  return EZ + (yardsFromLeftGoal / 100) * PLAYABLE;
}
const LEFT_20_PCT = yardToPct(20);
const RIGHT_20_PCT = yardToPct(80);

function PointChip({
  event,
  onDone,
}: {
  event: TlonFeedEvent;
  onDone: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const left = event.side === "left";
  const sign = event.delta >= 0 ? "+" : "";

  useEffect(() => {
    const enter = window.setTimeout(() => setVisible(true), 20);
    const leave = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(() => onDoneRef.current(event.id), 280);
    }, HOLD_MS);
    return () => {
      window.clearTimeout(enter);
      window.clearTimeout(leave);
    };
  }, [event.id]);

  return (
    <div
      className={cn(
        "flex max-w-[11.5rem] items-center gap-1.5 rounded-lg border px-1.5 py-1 shadow-lg backdrop-blur-md transition-[opacity,transform] duration-300 ease-out sm:max-w-[13rem]",
        left
          ? "border-[#1e3a5f]/60 bg-[#0b1220]/92 origin-left"
          : "border-[#b91c1c]/60 bg-[#0b1220]/92 origin-right",
        visible ? "translate-x-0 opacity-100" : left ? "-translate-x-2 opacity-0" : "translate-x-2 opacity-0",
      )}
    >
      <img
        src={playerImage(event.playerId, (event.pos || "WR") as Pos, event.team)}
        alt=""
        className="size-7 shrink-0 rounded-full border border-white/25 object-cover sm:size-8"
        onError={(e) => {
          e.currentTarget.style.visibility = "hidden";
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-semibold leading-tight text-white sm:text-[11px]">
          {event.playerName}
        </p>
        <p className="truncate text-[9px] leading-tight text-white/55">{event.headline}</p>
      </div>
      <span
        className={cn(
          "shrink-0 font-display text-[0.95rem] font-extrabold leading-none tabular-nums sm:text-[1.05rem]",
          event.delta >= 0 ? "text-emerald-300" : "text-rose-300",
        )}
      >
        {sign}
        {event.delta.toFixed(2)}
      </span>
    </div>
  );
}

/**
 * Selected-matchup point adjustments — stacked on each team’s 20-yard line.
 * Multiple scorers from one poll appear together; each auto-dismisses.
 */
export function TlonPointPopups({
  events,
  onDismiss,
}: {
  events: TlonFeedEvent[];
  onDismiss: (id: string) => void;
}) {
  const left = events.filter((e) => e.side === "left").slice(0, MAX_PER_SIDE);
  const right = events.filter((e) => e.side === "right").slice(0, MAX_PER_SIDE);

  if (!left.length && !right.length) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div
        className="absolute top-[26%] flex w-[min(42%,13rem)] -translate-x-1/2 flex-col gap-1.5 sm:top-[28%]"
        style={{ left: `${LEFT_20_PCT}%` }}
      >
        {left.map((event) => (
          <PointChip key={event.id} event={event} onDone={onDismiss} />
        ))}
      </div>
      <div
        className="absolute top-[26%] flex w-[min(42%,13rem)] -translate-x-1/2 flex-col items-end gap-1.5 sm:top-[28%]"
        style={{ left: `${RIGHT_20_PCT}%` }}
      >
        {right.map((event) => (
          <PointChip key={event.id} event={event} onDone={onDismiss} />
        ))}
      </div>
    </div>
  );
}
