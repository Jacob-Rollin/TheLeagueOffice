import { useEffect, useRef, useState } from "react";

import { playerImage } from "@/components/draft/PlayerAvatar";
import type { Pos } from "@/lib/draft";
import type { TlonFeedEvent, TlonFeedSide } from "@/lib/tlon-play-feed";
import { cn } from "@/lib/utils";

/** Same yard mapping as TlonField. */
const EZ = 8;
const PLAYABLE = 100 - EZ * 2;
function yardToPct(yardsFromLeftGoal: number): number {
  return EZ + (yardsFromLeftGoal / 100) * PLAYABLE;
}

const LEFT_30_PCT = yardToPct(30);
const RIGHT_30_PCT = yardToPct(70);
/** Inside the painted 20 (~12 yd) — clear of the goal line. */
const LEFT_RZ_PCT = yardToPct(12);
const RIGHT_RZ_PCT = yardToPct(88);

const MAX_PER_STACK = 5;
const SCORE_HOLD_MS = 20_000;

export type TlonFieldUnit = "offense" | "defense";

export type TlonFieldPlayer = {
  playerId: string;
  playerName: string;
  pos: string;
  team: string;
  side: TlonFeedSide;
  unit: TlonFieldUnit;
  /** Offense drive inside the 20 (ESPN isRedZone / yardLine ≤ 20). */
  inRedZone: boolean;
};

function sortOnField(a: TlonFieldPlayer, b: TlonFieldPlayer): number {
  // Defenses always sit at the bottom of the stack.
  if (a.unit !== b.unit) return a.unit === "defense" ? 1 : -1;
  const order = ["QB", "RB", "WR", "TE", "K", "DEF"];
  return order.indexOf(a.pos) - order.indexOf(b.pos);
}

function ScoreSlide({
  event,
  side,
  expanded,
  onDone,
}: {
  event: TlonFeedEvent;
  side: TlonFeedSide;
  expanded?: boolean;
  onDone: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const sign = event.delta >= 0 ? "+" : "";
  const up = event.delta >= 0;
  const outward = side === "left" ? "-translate-x-2" : "translate-x-2";
  const outwardHidden = side === "left" ? "-translate-x-6" : "translate-x-6";

  useEffect(() => {
    const enter = window.setTimeout(() => setVisible(true), 20);
    const leave = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(() => onDoneRef.current(event.id), 280);
    }, SCORE_HOLD_MS);
    return () => {
      window.clearTimeout(enter);
      window.clearTimeout(leave);
    };
  }, [event.id]);

  return (
    <span
      className={cn(
        "pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 font-display font-extrabold tabular-nums",
        "rounded-md shadow-lg backdrop-blur-sm",
        side === "left" ? "right-full mr-1" : "left-full ml-1",
        expanded ? "px-1.5 py-0.5 text-[13px] sm:text-[15px]" : "px-1 py-px text-[11px] sm:text-[12px]",
        up ? "bg-emerald-500/25 text-emerald-300" : "bg-rose-500/25 text-rose-300",
        "transition-[opacity,transform] duration-300 ease-out",
        visible ? `opacity-100 ${outward}` : `opacity-0 ${outwardHidden}`,
      )}
    >
      {sign}
      {event.delta.toFixed(2)}
    </span>
  );
}

function PresenceChip({
  player,
  expanded,
  scoreEvent,
  onScoreDone,
}: {
  player: TlonFieldPlayer;
  expanded?: boolean;
  scoreEvent?: TlonFeedEvent;
  onScoreDone: (id: string) => void;
}) {
  const isDef = player.unit === "defense";
  const rz = player.inRedZone;

  return (
    <div className="relative">
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full border bg-[#0b1220]/92 shadow-lg backdrop-blur-md",
          rz
            ? "border-rose-500/55"
            : isDef
              ? "border-sky-400/40"
              : "border-white/20",
          expanded ? "px-2 py-1 sm:gap-2 sm:px-2.5 sm:py-1.5" : "px-1.5 py-0.5",
        )}
        title={
          rz
            ? `${player.playerName} — red zone`
            : isDef
              ? `${player.playerName} — defense`
              : `${player.playerName} — offense`
        }
      >
        <img
          src={playerImage(player.playerId, (player.pos || "WR") as Pos, player.team)}
          alt=""
          className={cn(
            "shrink-0 rounded-full border border-white/30 object-cover",
            expanded ? "size-7 sm:size-8" : "size-5 sm:size-6",
          )}
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
        <span
          className={cn(
            "min-w-0 truncate font-semibold text-white",
            expanded
              ? "max-w-[7rem] text-[12px] sm:max-w-[8.5rem] sm:text-[13px]"
              : "max-w-[5.5rem] text-[10px] sm:text-[11px]",
          )}
        >
          {player.playerName}
        </span>
        {rz ? (
          <span
            className={cn(
              "shrink-0 rounded bg-rose-600 font-display font-extrabold uppercase tracking-wider text-white",
              expanded ? "px-1.5 py-0.5 text-[10px] sm:text-[11px]" : "px-1 py-px text-[9px]",
            )}
          >
            RZ
          </span>
        ) : isDef ? (
          <span
            className={cn(
              "shrink-0 rounded bg-sky-600/90 font-display font-extrabold uppercase tracking-wider text-white",
              expanded ? "px-1.5 py-0.5 text-[10px] sm:text-[11px]" : "px-1 py-px text-[9px]",
            )}
          >
            DEF
          </span>
        ) : null}
      </div>
      {scoreEvent ? (
        <ScoreSlide
          event={scoreEvent}
          side={player.side}
          {...(expanded != null ? { expanded } : {})}
          onDone={onScoreDone}
        />
      ) : null}
    </div>
  );
}

function SideStacks({
  players,
  side,
  expanded,
  scoreByPlayer,
  onScoreDone,
}: {
  players: TlonFieldPlayer[];
  side: TlonFeedSide;
  expanded?: boolean;
  scoreByPlayer: Map<string, TlonFeedEvent>;
  onScoreDone: (id: string) => void;
}) {
  const at30 = players.filter((p) => !p.inRedZone).sort(sortOnField).slice(0, MAX_PER_STACK);
  const atRz = players.filter((p) => p.inRedZone).sort(sortOnField).slice(0, MAX_PER_STACK);
  const x30 = side === "left" ? LEFT_30_PCT : RIGHT_30_PCT;
  const xRz = side === "left" ? LEFT_RZ_PCT : RIGHT_RZ_PCT;

  const stackClass = cn(
    "absolute top-[52%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center",
    expanded ? "gap-1.5" : "gap-1",
  );

  return (
    <>
      {at30.length ? (
        <div className={stackClass} style={{ left: `${x30}%` }}>
          {at30.map((p) => {
            const scoreEvent = scoreByPlayer.get(p.playerId);
            return (
              <PresenceChip
                key={`fld-30-${p.side}-${p.playerId}`}
                player={p}
                {...(expanded != null ? { expanded } : {})}
                {...(scoreEvent ? { scoreEvent } : {})}
                onScoreDone={onScoreDone}
              />
            );
          })}
        </div>
      ) : null}
      {atRz.length ? (
        <div className={stackClass} style={{ left: `${xRz}%` }}>
          {atRz.map((p) => {
            const scoreEvent = scoreByPlayer.get(p.playerId);
            return (
              <PresenceChip
                key={`fld-rz-${p.side}-${p.playerId}`}
                player={p}
                {...(expanded != null ? { expanded } : {})}
                {...(scoreEvent ? { scoreEvent } : {})}
                onScoreDone={onScoreDone}
              />
            );
          })}
        </div>
      ) : null}
    </>
  );
}

/**
 * Live on-field presence — offense stacked on each side’s 30, shifting inside
 * the 20 when that NFL unit is in the red zone. DST sits at the bottom of the
 * stack. Point ticks slide out sideways from the player chip (not toast cards).
 */
export function TlonFieldPresence({
  players,
  scoreEvents = [],
  onDismissScore,
  expanded = false,
}: {
  players: TlonFieldPlayer[];
  scoreEvents?: TlonFeedEvent[];
  onDismissScore?: (id: string) => void;
  expanded?: boolean;
}) {
  const left = players.filter((p) => p.side === "left");
  const right = players.filter((p) => p.side === "right");

  const scoreByPlayer = new Map<string, TlonFeedEvent>();
  for (const e of scoreEvents) {
    if (!scoreByPlayer.has(e.playerId)) scoreByPlayer.set(e.playerId, e);
  }

  if (!left.length && !right.length) return null;

  const onDone = onDismissScore ?? (() => undefined);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 bottom-[4%] z-[25] overflow-hidden">
      <SideStacks
        players={left}
        side="left"
        expanded={expanded}
        scoreByPlayer={scoreByPlayer}
        onScoreDone={onDone}
      />
      <SideStacks
        players={right}
        side="right"
        expanded={expanded}
        scoreByPlayer={scoreByPlayer}
        onScoreDone={onDone}
      />
    </div>
  );
}

/** Player ids currently shown on the field (for suppressing duplicate popups). */
export function fieldPresencePlayerIds(players: TlonFieldPlayer[]): Set<string> {
  return new Set(players.map((p) => p.playerId));
}
