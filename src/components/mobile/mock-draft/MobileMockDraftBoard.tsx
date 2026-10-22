import { useEffect, useRef } from "react";
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

export function MobileMockDraftBoard({
  settings,
  picks,
  byId,
  currentOverall,
  myTurn,
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
  myTurn: boolean;
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

  useEffect(() => {
    clockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [currentOverall, jumpSignal]);

  const colW = 112;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div
        className="inline-grid gap-1 p-2 pb-4"
        style={{
          gridTemplateColumns: `repeat(${settings.teams}, ${colW}px)`,
          minWidth: settings.teams * (colW + 4),
        }}
      >
        {Array.from({ length: settings.teams }, (_, i) => i + 1).map((t) => {
          const isMine = slotClaimed
            ? t === settings.myTeam
            : !lobby && t === settings.myTeam;
          const showClaim = lobby && (!slotClaimed || t !== settings.myTeam);
          const label =
            lobby && !slotClaimed ? `Slot ${t}` : teamName(settings, t);
          return (
            <div
              key={`h-${t}`}
              className={cn(
                "sticky top-0 z-10 flex flex-col items-center gap-0.5 bg-m-bg/95 px-0.5 py-1 backdrop-blur",
                isMine && "rounded-md ring-1 ring-m-accent",
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
            const pickLabel = `${round}.${(((overall - 1) % settings.teams) + 1)}`;
            // Last pick of a snake/linear round gets ↓ (Sleeper-style turn marker).
            const isRoundEnd =
              round < settings.rounds &&
              (settings.snake ? (ltr ? team === settings.teams : team === 1) : team === settings.teams);
            const flowArrow = isRoundEnd ? "↓" : ltr ? "→" : "←";

            return (
              <div
                key={`${round}-${team}`}
                ref={isClock ? clockRef : undefined}
                className={cn(
                  "relative flex h-[72px] flex-col justify-between overflow-hidden rounded-lg px-1.5 py-1.5",
                  player
                    ? posCellClass(player.pos)
                    : isClock
                      ? "bg-m-card ring-2 ring-m-accent"
                      : "bg-m-card/70 text-m-muted",
                )}
              >
                {player ? (
                  <>
                    <div className="flex items-start justify-between gap-1">
                      <span className="truncate text-[9px] font-bold uppercase opacity-80">
                        {player.pos === "DEF" ? "DST" : player.pos} · {player.team}
                        {player.bye ? ` (${player.bye})` : ""}
                      </span>
                      <span className="tabnum shrink-0 text-[9px] font-semibold opacity-70">
                        {pickLabel}
                      </span>
                    </div>
                    {onOpenPlayer ? (
                      <button
                        type="button"
                        onClick={() => onOpenPlayer(player.id)}
                        className="line-clamp-2 text-left text-[12px] font-bold leading-tight"
                      >
                        {shortName(player.name)}
                      </button>
                    ) : (
                      <span className="line-clamp-2 text-[12px] font-bold leading-tight">
                        {shortName(player.name)}
                      </span>
                    )}
                    <span
                      className="absolute bottom-1 right-1.5 text-[10px] opacity-50"
                      aria-hidden
                    >
                      {flowArrow}
                    </span>
                  </>
                ) : isClock ? (
                  <div className="flex h-full flex-col items-center justify-center gap-1 text-m-accent">
                    <Timer className="size-3.5" strokeWidth={2.5} />
                    <span className="font-display text-[10px] font-bold uppercase tracking-wider">
                      {myTurn ? "Your pick" : "On the clock"}
                    </span>
                    <span className="tabnum text-[10px] text-m-muted">{pickLabel}</span>
                  </div>
                ) : (
                  <>
                    <span className="tabnum self-end text-[10px]">{pickLabel}</span>
                    <span className="absolute bottom-1 right-1.5 text-[10px] opacity-40" aria-hidden>
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
  );
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const first = parts[0]!;
  return `${first[0]}. ${parts.slice(1).join(" ")}`;
}

export function pickLabelForOverall(overall: number, teams: number): string {
  const round = roundOf(overall, teams);
  const slot = ((overall - 1) % teams) + 1;
  return `${round}.${slot}`;
}
