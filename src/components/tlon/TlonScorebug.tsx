import type { ReactNode } from "react";

import { MatchupTeamAvatar } from "@/components/playbook/MatchupPreviewCard";
import { cn } from "@/lib/utils";

/**
 * Starter game-status dots — same circle for every slot.
 * Lit = NFL game not finished (pregame or in progress); grey = final.
 * Row width matches the record bar beneath it.
 */
function YetToPlayDots({
  count,
  max = 9,
  tone,
}: {
  count: number;
  max?: number;
  tone: "navy" | "red";
}) {
  const slots = Math.max(1, Math.min(12, Math.floor(max)));
  const n = Math.max(0, Math.min(slots, Math.floor(count)));
  const lit = tone === "navy" ? "bg-[#1e3a5f]" : "bg-[#b91c1c]";
  return (
    <div
      className="flex w-full items-center justify-between"
      aria-label={`${n} of ${slots} starters still playing or yet to play`}
      title={`${n} of ${slots} starters still playing or yet to play`}
    >
      {Array.from({ length: slots }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-[3.5px] shrink-0 rounded-full sm:size-[4px]",
            i < n ? lit : "bg-slate-300",
          )}
        />
      ))}
    </div>
  );
}

function formatScore(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

function LogoBlock({
  tone,
  children,
}: {
  tone: "navy" | "red";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex w-7 shrink-0 items-center justify-center self-stretch sm:w-11",
        tone === "navy" ? "bg-[#1e3a5f]" : "bg-[#b91c1c]",
      )}
    >
      <span
        className={cn(
          "shrink-0 [&_span]:rounded [&_span]:border-white/25 [&_span]:bg-white/10",
          "[&_span]:h-6 [&_span]:w-6 sm:[&_span]:h-8 sm:[&_span]:w-8",
        )}
      >
        {children}
      </span>
    </div>
  );
}

function TeamSide({
  name,
  rank,
  record,
  score,
  yetToPlay,
  yetToPlayMax,
  tone,
  align,
  pulse,
}: {
  name: string;
  rank?: number | null;
  record?: string | null;
  score: number;
  yetToPlay: number;
  yetToPlayMax: number;
  tone: "navy" | "red";
  align: "left" | "right";
  pulse: boolean;
}) {
  const rankLabel =
    rank != null && Number.isFinite(rank) && rank >= 1 ? String(Math.floor(rank)) : "";
  const bar = tone === "navy" ? "bg-[#1e3a5f]" : "bg-[#b91c1c]";
  const right = align === "right";

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-1 py-1 sm:gap-1.5 sm:px-2.5 sm:py-1.5">
      {/* Top: rank + full team name only */}
      <p
        className={cn(
          "flex min-w-0 items-baseline gap-1 leading-tight",
          right && "justify-end text-right",
        )}
        title={rankLabel ? `${rankLabel} ${name}` : name}
      >
        {rankLabel ? (
          <span className="shrink-0 font-display text-[8px] font-semibold tabular-nums text-slate-500 sm:text-[10px]">
            {rankLabel}
          </span>
        ) : null}
        <span className="min-w-0 break-words font-display text-[8px] font-extrabold uppercase tracking-[0.02em] text-slate-900 sm:text-[11px] sm:tracking-[0.04em]">
          {name}
        </span>
      </p>

      {/* Bottom: dots + record bar, score beside them */}
      <div
        className={cn(
          "flex items-end gap-1 sm:gap-2",
          right && "flex-row-reverse",
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-[3px] sm:min-w-[5rem] sm:gap-1">
          <YetToPlayDots
            count={yetToPlay}
            max={Math.max(yetToPlayMax, 1)}
            tone={tone}
          />
          <div className={cn("w-full rounded-[2px] px-1 py-[2px] sm:px-2 sm:py-0.5", bar)}>
            <p className="text-center font-display text-[8px] font-bold leading-none tabular-nums tracking-wide text-white sm:text-[11px]">
              {record?.trim() || "—"}
            </p>
          </div>
        </div>

        <p
          className={cn(
            "relative z-[1] shrink-0 font-display text-[1.05rem] font-extrabold leading-none tabular-nums text-slate-900 sm:text-[1.45rem]",
            "transition-transform duration-300 ease-out",
            pulse && "scale-110 text-emerald-700",
          )}
        >
          {formatScore(score)}
        </p>
      </div>
    </div>
  );
}

export type TlonDaypart = "PRE" | "LIVE" | "FINAL";

export function TlonScorebug({
  week: _week,
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
  leadingSide: _leadingSide,
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

  return (
    <div className="relative mx-auto w-[min(100%,28rem)] sm:w-[min(100%,36rem)]">
      <div className="relative overflow-hidden rounded-sm bg-slate-100 shadow-[0_6px_20px_rgba(0,0,0,0.55)] ring-1 ring-black/20 sm:rounded">
        <div className="flex items-stretch">
          <LogoBlock tone="navy">
            <MatchupTeamAvatar
              name={leftName}
              logo={leftLogo ?? null}
              platform={platform ?? null}
              cacheKey={`${leagueKey ?? "tlon"}-left`}
              size="sm"
            />
          </LogoBlock>

          <TeamSide
            name={leftName}
            rank={leftRank}
            record={leftRecord}
            score={leftLive}
            yetToPlay={leftYetToPlay}
            yetToPlayMax={leftYetToPlayMax}
            tone="navy"
            align="left"
            pulse={scorePulseSide === "left"}
          />

          {/*
            Center — TLN + live flash on top; win % + arrow + WIN PROB below.
            Keep narrow on phones so scores stay visible in portrait.
          */}
          <div className="flex w-[2.65rem] shrink-0 flex-col items-center justify-center gap-[2px] bg-[#111111] px-0.5 py-1 sm:w-auto sm:min-w-[4.5rem] sm:gap-1 sm:px-2 sm:py-1.5">
            <div className="flex items-center justify-center gap-0.5 sm:gap-1">
              <span className="display-title text-[7px] leading-none tracking-[0.12em] text-white sm:text-[10px] sm:tracking-[0.16em]">
                TLN
              </span>
              {daypart === "LIVE" ? (
                <span className="relative flex size-1 shrink-0 sm:size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-500 opacity-75" />
                  <span className="relative inline-flex size-1 rounded-full bg-rose-500 sm:size-1.5" />
                </span>
              ) : null}
            </div>
            <div className="flex items-center justify-center gap-0.5 sm:gap-1">
              {favored === "left" ? (
                <span
                  className="inline-block border-y-[3px] border-r-[4px] border-y-transparent border-r-white sm:border-y-[4px] sm:border-r-[5px]"
                  aria-label="Favored left"
                />
              ) : null}
              <span className="font-display text-[0.85rem] font-extrabold leading-none tabular-nums text-white sm:text-[1.25rem]">
                {Math.round(favoredPct)}%
              </span>
              {favored === "right" ? (
                <span
                  className="inline-block border-y-[3px] border-l-[4px] border-y-transparent border-l-white sm:border-y-[4px] sm:border-l-[5px]"
                  aria-label="Favored right"
                />
              ) : null}
            </div>
            <p className="w-full text-center text-[5.5px] font-semibold uppercase tracking-wide text-white/55 sm:text-[7.5px]">
              Win prob
            </p>
          </div>

          <TeamSide
            name={rightName}
            rank={rightRank}
            record={rightRecord}
            score={rightLive}
            yetToPlay={rightYetToPlay}
            yetToPlayMax={rightYetToPlayMax}
            tone="red"
            align="right"
            pulse={scorePulseSide === "right"}
          />

          <LogoBlock tone="red">
            <MatchupTeamAvatar
              name={rightName}
              logo={rightLogo ?? null}
              platform={platform ?? null}
              cacheKey={`${leagueKey ?? "tlon"}-right`}
              size="sm"
            />
          </LogoBlock>
        </div>
      </div>
    </div>
  );
}
