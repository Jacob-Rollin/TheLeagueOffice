import type { ReactNode } from "react";

import { MatchupTeamAvatar } from "@/components/playbook/MatchupPreviewCard";
import { cn } from "@/lib/utils";

/**
 * Starters yet to play — fantasy analogue of broadcast timeout ticks.
 * Lit bars = players whose NFL game has not started.
 * Slot count follows the lineup (typically 9 starters), not a hard 5.
 */
function YetToPlayTicks({ count, max = 9 }: { count: number; max?: number }) {
  const slots = Math.max(1, Math.min(12, Math.floor(max)));
  const n = Math.max(0, Math.min(slots, Math.floor(count)));
  return (
    <div
      className="flex flex-col justify-center gap-[1.5px]"
      aria-label={`${n} of ${slots} starters yet to play`}
      title={`${n} of ${slots} starters yet to play`}
    >
      {Array.from({ length: slots }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-[1.5px] w-2 rounded-[1px] transition-colors duration-500 sm:w-2.5",
            i < n ? "bg-white" : "bg-white/25",
          )}
        />
      ))}
    </div>
  );
}

function formatScore(n: number): string {
  if (!Number.isFinite(n)) return "0.0";
  return (Math.round(n * 10) / 10).toFixed(1);
}

function rankPrefix(rank: number | null | undefined): string {
  if (rank == null || !Number.isFinite(rank) || rank < 1) return "";
  return `${Math.floor(rank)} `;
}

function LeadMark({ show }: { show: boolean }) {
  if (!show) return <span className="h-[5px]" aria-hidden />;
  return (
    <span
      className="inline-block border-x-[3.5px] border-b-[5px] border-x-transparent border-b-white"
      aria-label="Leading"
    />
  );
}

/**
 * Opaque panel: solid fill on the shell, layout classes on the inner content
 * so flex/gap actually apply to children (TLN + live dot stay inline).
 */
function Panel({
  className,
  fillClass,
  sheenClass,
  children,
}: {
  className?: string;
  fillClass: string;
  sheenClass?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative min-w-0", fillClass)}>
      {sheenClass ? (
        <div aria-hidden className={cn("pointer-events-none absolute inset-0", sheenClass)} />
      ) : null}
      <div className={cn("relative z-[1] h-full", className)}>{children}</div>
    </div>
  );
}

export type TlonDaypart = "PRE" | "LIVE" | "FINAL";

export function TlonScorebug({
  week,
  daypart,
  leftName,
  leftLogo,
  leftRecord,
  leftRank,
  leftLive,
  leftYetToPlay,
  leftYetToPlayMax,
  rightName,
  rightLogo,
  rightRecord,
  rightRank,
  rightLive,
  rightYetToPlay,
  rightYetToPlayMax,
  winPctLeft,
  winPctRight,
  platform,
  leagueKey,
  leadingSide,
  scorePulseSide,
}: {
  week: number;
  daypart: TlonDaypart;
  leftName: string;
  leftLogo?: string | null;
  leftRecord?: string | null;
  leftRank?: number | null;
  leftLive: number;
  leftYetToPlay: number;
  leftYetToPlayMax: number;
  rightName: string;
  rightLogo?: string | null;
  rightRecord?: string | null;
  rightRank?: number | null;
  rightLive: number;
  rightYetToPlay: number;
  rightYetToPlayMax: number;
  winPctLeft: number;
  winPctRight: number;
  platform?: string | null;
  leagueKey?: string | null;
  leadingSide: "left" | "right" | "tie";
  scorePulseSide?: "left" | "right" | null;
}) {
  const favored = winPctLeft >= winPctRight ? "left" : "right";
  const favoredPct = favored === "left" ? winPctLeft : winPctRight;
  const statusLabel =
    daypart === "LIVE" ? "LIVE" : daypart === "FINAL" ? "FINAL" : "PRE";

  const leftTitle = `${rankPrefix(leftRank)}${leftName}`.trim();
  const rightTitle = `${rankPrefix(rightRank)}${rightName}`.trim();

  return (
    <div className="relative mx-auto w-[min(100%,22rem)] sm:w-[min(100%,30rem)]">
      <div className="relative overflow-hidden rounded-sm shadow-[0_6px_20px_rgba(0,0,0,0.55)] ring-1 ring-white/25 sm:rounded">
        {/* Top strip — thin one-line labels */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch text-white">
          <Panel
            fillClass="bg-[#1e40af]"
            sheenClass="bg-gradient-to-b from-black/20 to-transparent"
            className="flex items-center px-2 py-px sm:px-2.5 sm:py-0.5"
          >
            <p
              className="truncate font-display text-[8px] font-bold uppercase leading-none tracking-[0.06em] sm:text-[10px] sm:tracking-[0.1em]"
              title={leftTitle}
            >
              {leftTitle}
            </p>
          </Panel>

          <Panel
            fillClass="bg-[#111111]"
            sheenClass="bg-gradient-to-b from-white/10 to-transparent"
            className="flex min-w-[3.25rem] items-center justify-center gap-1 px-2 py-px sm:min-w-[4.5rem] sm:gap-1.5 sm:px-2.5 sm:py-0.5"
          >
            <span className="display-title text-[9px] leading-none tracking-[0.18em] sm:text-[11px] sm:tracking-[0.2em]">
              TLN
            </span>
            {daypart === "LIVE" ? (
              <span className="relative flex size-1.5 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-500 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-rose-500" />
              </span>
            ) : (
              <span className="text-[8px] font-bold uppercase leading-none tracking-wider text-white/55">
                {statusLabel}
              </span>
            )}
          </Panel>

          <Panel
            fillClass="bg-[#b91c1c]"
            sheenClass="bg-gradient-to-b from-black/20 to-transparent"
            className="flex items-center justify-end px-2 py-px sm:px-2.5 sm:py-0.5"
          >
            <p
              className="truncate font-display text-[8px] font-bold uppercase leading-none tracking-[0.06em] sm:text-[10px] sm:tracking-[0.1em]"
              title={rightTitle}
            >
              {rightTitle}
            </p>
          </Panel>
        </div>

        {/* Main row */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch">
          <Panel
            fillClass="bg-[#1d4ed8]"
            sheenClass="bg-gradient-to-r from-white/15 via-transparent to-black/20"
            className="px-1.5 py-1 sm:px-2.5 sm:py-1.5"
          >
            <div className="flex h-full items-center justify-between gap-1 sm:gap-2">
              <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
                <span className="shrink-0 rounded ring-1 ring-white/30 [&_span]:h-7 [&_span]:w-7 [&_span]:rounded [&_span]:border-white/15 sm:[&_span]:h-8 sm:[&_span]:w-8">
                  <MatchupTeamAvatar
                    name={leftName}
                    logo={leftLogo ?? null}
                    platform={platform ?? null}
                    cacheKey={`${leagueKey ?? "tlon"}-left`}
                    size="sm"
                  />
                </span>
                {leftRecord ? (
                  <span className="font-display text-[13px] font-extrabold leading-none tabular-nums text-white sm:text-[1.15rem]">
                    {leftRecord}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1 sm:gap-1.5">
                <YetToPlayTicks
                  count={leftYetToPlay}
                  max={Math.max(leftYetToPlayMax, 1)}
                />
                <div className="flex min-w-[2.4rem] flex-col items-center sm:min-w-[2.9rem]">
                  <p
                    className={cn(
                      "font-display text-[1.25rem] font-extrabold leading-none tabular-nums text-white sm:text-[1.85rem]",
                      "transition-transform duration-300 ease-out",
                      scorePulseSide === "left" && "scale-110 text-emerald-200",
                    )}
                  >
                    {formatScore(leftLive)}
                  </p>
                  <LeadMark show={leadingSide === "left"} />
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            fillClass="bg-[#0f0f0f]"
            sheenClass="bg-gradient-to-b from-white/10 to-transparent"
            className="flex min-w-[3.5rem] flex-col items-center justify-center border-x border-white/10 px-1.5 py-1 text-center sm:min-w-[5rem] sm:px-2 sm:py-1.5"
          >
            <p className="w-full text-center text-[7px] font-bold uppercase tracking-[0.12em] text-amber-300 sm:text-[8px]">
              {statusLabel}
              <span className="text-white/35"> · </span>
              <span className="text-white/85">WK {week}</span>
            </p>
            <p className="w-full text-center font-display text-[1.15rem] font-extrabold leading-none tabular-nums text-white sm:text-[1.65rem]">
              {Math.round(favoredPct)}%
            </p>
            <p className="w-full text-center text-[7px] font-semibold uppercase tracking-wide text-white/50 sm:text-[8px]">
              Win prob
            </p>
          </Panel>

          <Panel
            fillClass="bg-[#dc2626]"
            sheenClass="bg-gradient-to-l from-white/15 via-transparent to-black/20"
            className="px-1.5 py-1 sm:px-2.5 sm:py-1.5"
          >
            <div className="flex h-full items-center justify-between gap-1 sm:gap-2">
              <div className="flex items-center gap-1 sm:gap-1.5">
                <div className="flex min-w-[2.4rem] flex-col items-center sm:min-w-[2.9rem]">
                  <p
                    className={cn(
                      "font-display text-[1.25rem] font-extrabold leading-none tabular-nums text-white sm:text-[1.85rem]",
                      "transition-transform duration-300 ease-out",
                      scorePulseSide === "right" && "scale-110 text-emerald-200",
                    )}
                  >
                    {formatScore(rightLive)}
                  </p>
                  <LeadMark show={leadingSide === "right"} />
                </div>
                <YetToPlayTicks
                  count={rightYetToPlay}
                  max={Math.max(rightYetToPlayMax, 1)}
                />
              </div>
              <div className="flex min-w-0 items-center justify-end gap-1 sm:gap-1.5">
                {rightRecord ? (
                  <span className="font-display text-[13px] font-extrabold leading-none tabular-nums text-white sm:text-[1.15rem]">
                    {rightRecord}
                  </span>
                ) : null}
                <span className="shrink-0 rounded ring-1 ring-white/30 [&_span]:h-7 [&_span]:w-7 [&_span]:rounded [&_span]:border-white/15 sm:[&_span]:h-8 sm:[&_span]:w-8">
                  <MatchupTeamAvatar
                    name={rightName}
                    logo={rightLogo ?? null}
                    platform={platform ?? null}
                    cacheKey={`${leagueKey ?? "tlon"}-right`}
                    size="sm"
                  />
                </span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
