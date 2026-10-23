import { memo, useEffect, useRef } from "react";
import { Timer } from "lucide-react";

import {
  roundOf,
  teamForPick,
  teamName,
  type Pick,
  type Player,
  type Settings,
} from "@/lib/draft";
import { cn } from "@/lib/utils";

import { posCellClass } from "./posCellStyles";

/** Horizontal inset on both the teams track and the pick grid (px-1.5). */
const PAD_X = 6;

export const MobileMockDraftBoard = memo(function MobileMockDraftBoard({
  settings,
  picks,
  byId,
  currentOverall,
  complete,
  jumpSignal = 0,
  lobby = false,
  slotClaimed = false,
  onClaimSlot,
  onOpenPlayer,
}: {
  settings: Settings;
  picks: Pick[];
  byId: Map<string, Player>;
  currentOverall: number;
  complete: boolean;
  /** Increment to re-center the on-the-clock cell. */
  jumpSignal?: number;
  /** Pre-start lobby: empty board with claim affordance on your slot. */
  lobby?: boolean;
  /** Lobby only — true after the user claims a draft slot (AI names fill in). */
  slotClaimed?: boolean;
  onClaimSlot?: (team: number) => void;
  onOpenPlayer?: (id: string) => void;
}) {
  const pickByOverall = new Map(picks.map((p) => [p.overall, p]));
  const clockRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Target / pick-advance: fully reveal the on-the-clock cell (not just a sliver).
  useEffect(() => {
    const scroller = scrollRef.current;
    const cell = clockRef.current;
    if (!scroller || !cell) return;

    const run = () => {
      const sRect = scroller.getBoundingClientRect();
      const cRect = cell.getBoundingClientRect();
      const cellTop = cRect.top - sRect.top + scroller.scrollTop;
      const cellLeft = cRect.left - sRect.left + scroller.scrollLeft;
      const nextTop = cellTop - (scroller.clientHeight - cRect.height) / 2;
      const nextLeft = cellLeft - (scroller.clientWidth - cRect.width) / 2;
      scroller.scrollTo({
        top: Math.max(0, nextTop),
        left: Math.max(0, nextLeft),
        behavior: "smooth",
      });
    };
    const id = window.requestAnimationFrame(run);
    return () => window.cancelAnimationFrame(id);
  }, [currentOverall, jumpSignal]);

  // Sleeper-sized cells — denser than the old 112×72 tiles.
  const colW = 96;
  const gapPx = 3;
  // Exact track width (N cols + N-1 gaps) — shared by teams row + pick grid.
  const trackWidth =
    settings.teams * colW + Math.max(0, settings.teams - 1) * gapPx;
  const contentWidth = trackWidth + PAD_X * 2;
  /** Highlight the user's column once their slot is known (lobby claim or live). */
  const mineColActive = !lobby || slotClaimed;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-m-bg">
      {/*
        Single scrollport for X + Y. Teams row is position:sticky so it stays
        pinned while scrolling down, but shares the same native horizontal
        scroll as the grid — no nested X/Y (iOS was eating side pans) and no
        JS mirror lag.
      */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto overscroll-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [-webkit-overflow-scrolling:touch]"
      >
        <div style={{ width: contentWidth }}>
          <div
            className="sticky top-0 z-10 border-b border-m-border bg-m-bg pt-1.5 pb-1"
            style={{ paddingLeft: PAD_X, paddingRight: PAD_X }}
          >
            <div className="flex" style={{ width: trackWidth, gap: gapPx }}>
              {Array.from({ length: settings.teams }, (_, i) => i + 1).map((t) => {
                const isMine = mineColActive && t === settings.myTeam;
                const showClaim = lobby && (!slotClaimed || t !== settings.myTeam);
                const label =
                  lobby && !slotClaimed ? `Slot ${t}` : teamName(settings, t);
                return (
                  <div
                    key={`h-${t}`}
                    data-draft-team-header
                    style={{ width: colW }}
                    className={cn(
                      "flex shrink-0 flex-col items-center gap-0.5 bg-m-bg px-0.5 py-1",
                      isMine &&
                        "rounded-t-md bg-[color-mix(in_srgb,var(--m-accent)_16%,var(--m-bg))] ring-1 ring-inset ring-m-accent",
                    )}
                  >
                    {lobby ? (
                      showClaim ? (
                        <button
                          type="button"
                          onClick={() => onClaimSlot?.(t)}
                          className="rounded-full bg-m-chip px-2 py-0.5 font-display text-[9px] font-extrabold uppercase tracking-wide text-m-chip-fg active:bg-m-accent active:text-m-accent-fg"
                        >
                          Claim
                        </button>
                      ) : (
                        <span className="flex size-6 items-center justify-center rounded-full bg-m-accent text-[9px] font-bold text-m-accent-fg">
                          You
                        </span>
                      )
                    ) : (
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full text-[9px] font-bold",
                          isMine
                            ? "bg-m-accent text-m-accent-fg"
                            : "bg-m-chip text-m-chip-fg",
                        )}
                      >
                        {isMine ? "You" : "AI"}
                      </span>
                    )}
                    <span className="max-w-full truncate text-center text-[9px] font-semibold leading-tight text-m-card-fg">
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className="grid pb-3 pt-1"
            style={{
              width: trackWidth,
              marginLeft: PAD_X,
              marginRight: PAD_X,
              columnGap: gapPx,
              rowGap: 0,
              gridTemplateColumns: `repeat(${settings.teams}, ${colW}px)`,
            }}
          >
            {Array.from({ length: settings.rounds }, (_, r) => r + 1).map((round) => {
              const ltr = !settings.snake || round % 2 === 1;
              return Array.from({ length: settings.teams }, (_, i) => {
                const team = i + 1;
                const overall = Array.from(
                  { length: settings.teams },
                  (_, k) => (round - 1) * settings.teams + k + 1,
                ).find((o) => teamForPick(o, settings.teams, settings.snake) === team)!;
                const pick = pickByOverall.get(overall);
                const player = pick ? byId.get(pick.playerId) : undefined;
                const isClock = !complete && overall === currentOverall;
                const isMineCol = mineColActive && team === settings.myTeam;
                const pickLabel = `${round}.${(((overall - 1) % settings.teams) + 1)}`;
                // Last pick of a snake/linear round gets ↓ (Sleeper-style turn marker).
                const isRoundEnd =
                  round < settings.rounds &&
                  (settings.snake
                    ? ltr
                      ? team === settings.teams
                      : team === 1
                    : team === settings.teams);
                const flowArrow = isRoundEnd ? "↓" : ltr ? "→" : "←";

                return (
                  <div
                    key={`${round}-${team}`}
                    ref={isClock ? clockRef : undefined}
                    className={cn(
                      "relative mb-[3px] flex h-[62px] flex-col gap-0.5 overflow-hidden rounded-md px-1 pt-1 pb-3.5",
                      player
                        ? posCellClass(player.pos)
                        : isClock
                          ? "bg-m-card ring-2 ring-inset ring-m-accent"
                          : isMineCol
                            ? "bg-m-accent/12 text-m-muted"
                            : "bg-m-card/70 text-m-muted",
                      // Column wash for filled picks — keeps pos colors, marks "your" lane.
                      isMineCol && player && "ring-1 ring-inset ring-m-accent/45",
                      isMineCol &&
                        !player &&
                        !isClock &&
                        "ring-1 ring-inset ring-m-accent/25",
                    )}
                  >
                    {player ? (
                      <>
                        <div className="flex shrink-0 items-start justify-between gap-0.5">
                          <span className="truncate text-[7px] font-bold uppercase leading-none opacity-75">
                            {player.pos === "DEF" ? "DST" : player.pos} · {player.team}
                            {player.bye ? ` (${player.bye})` : ""}
                          </span>
                          <span className="tabnum shrink-0 text-[7px] font-semibold leading-none opacity-65">
                            {pickLabel}
                          </span>
                        </div>
                        {onOpenPlayer ? (
                          <button
                            type="button"
                            onClick={() => onOpenPlayer(player.id)}
                            className="min-h-0 min-w-0 flex-1 text-left"
                          >
                            <StackedPlayerName name={player.name} />
                          </button>
                        ) : (
                          <div className="min-h-0 min-w-0 flex-1">
                            <StackedPlayerName name={player.name} />
                          </div>
                        )}
                        <span
                          className="absolute bottom-0.5 right-1 text-[8px] opacity-45"
                          aria-hidden
                        >
                          {flowArrow}
                        </span>
                      </>
                    ) : isClock ? (
                      <div className="flex h-full flex-col items-center justify-center gap-0.5 text-m-accent">
                        <Timer className="size-3" strokeWidth={2.5} />
                        <span className="font-display text-[9px] font-extrabold uppercase tracking-wider">
                          On the clock
                        </span>
                        <span className="tabnum text-[9px] text-m-muted">{pickLabel}</span>
                      </div>
                    ) : (
                      <>
                        <span className="tabnum self-end text-[9px]">{pickLabel}</span>
                        <span
                          className="absolute bottom-0.5 right-1 text-[8px] opacity-40"
                          aria-hidden
                        >
                          {flowArrow}
                        </span>
                      </>
                    )}
                  </div>
                );
              });
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

/** Sleeper-style board names: first line, last (+ suffix) on the next. */
function splitPlayerName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

function StackedPlayerName({ name }: { name: string }) {
  const { first, last } = splitPlayerName(name);
  return (
    <span className="flex min-w-0 flex-col pr-2.5">
      <span className="truncate text-[12px] font-extrabold leading-[1.05] tracking-tight">
        {first}
      </span>
      {last ? (
        <span className="truncate text-[12px] font-extrabold leading-[1.05] tracking-tight">
          {last}
        </span>
      ) : null}
    </span>
  );
}

export function pickLabelForOverall(overall: number, teams: number): string {
  const round = roundOf(overall, teams);
  const slot = ((overall - 1) % teams) + 1;
  return `${round}.${slot}`;
}
