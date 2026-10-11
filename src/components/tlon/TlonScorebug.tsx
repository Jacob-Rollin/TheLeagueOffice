import type { ReactNode } from "react";

import { MatchupTeamAvatar } from "@/components/playbook/MatchupPreviewCard";
import { cn } from "@/lib/utils";

/**
 * Starters yet to play — fantasy analogue of broadcast timeout dots.
 * Lit dots = players whose NFL game has not started.
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
      className="flex items-center gap-[3px]"
      aria-label={`${n} of ${slots} starters yet to play`}
      title={`${n} of ${slots} starters yet to play`}
    >
      {Array.from({ length: slots }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-[3px] rounded-full sm:size-[3.5px]",
            i < n ? lit : "bg-slate-300",
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

function LeadMark({ show }: { show: boolean }) {
  if (!show) return <span className="h-[5px]" aria-hidden />;
  return (
    <span
      className="inline-block border-x-[3.5px] border-b-[5px] border-x-transparent border-b-slate-900"
      aria-label="Leading"
    />
  );
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
        "flex items-center justify-center px-1.5 sm:px-2",
        tone === "navy" ? "bg-[#1e3a5f]" : "bg-[#b91c1c]",
      )}
    >
      <span
        className={cn(
          "shrink-0 [&_span]:rounded-md [&_span]:border-white/20",
          "[&_span]:h-8 [&_span]:w-8 sm:[&_span]:h-9 sm:[&_span]:w-9",
        )}
      >
        {children}
      </span>
    </div>
  );
}

function TeamInfo({
  name,
  rank,
  record,
  yetToPlay,
  yetToPlayMax,
  tone,
  align,
}: {
  name: string;
  rank?: number | null;
  record?: string | null;
  yetToPlay: number;
  yetToPlayMax: number;
  tone: "navy" | "red";
  align: "left" | "right";
}) {
  const rankLabel =
    rank != null && Number.isFinite(rank) && rank >= 1 ? String(Math.floor(rank)) : "";
  const bar =
    tone === "navy"
      ? "bg-[#1e3a5f]"
      : "bg-[#b91c1c]";

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col justify-center gap-[3px] px-1.5 py-1 sm:gap-1 sm:px-2 sm:py-1.5",
        align === "right" && "items-end",
      )}
    >
      <p
        className={cn(
          "flex min-w-0 items-baseline gap-1 leading-none",
          align === "right" && "w-full justify-end",
        )}
        title={rankLabel ? `${rankLabel} ${name}` : name}
      >
        {rankLabel ? (
          <span className="shrink-0 font-display text-[9px] font-semibold tabular-nums text-slate-500 sm:text-[10px]">
            {rankLabel}
          </span>
        ) : null}
        <span className="truncate font-display text-[10px] font-extrabold uppercase tracking-[0.04em] text-slate-900 sm:text-[12px] sm:tracking-[0.06em]">
          {name}
        </span>
      </p>

      <YetToPlayDots
        count={yetToPlay}
        max={Math.max(yetToPlayMax, 1)}
        tone={tone}
      />

      <div
        className={cn(
          "w-full min-w-[3.5rem] rounded-[2px] px-1.5 py-[2px] sm:min-w-[4.25rem] sm:px-2 sm:py-0.5",
          bar,
        )}
      >
        <p className="text-center font-display text-[9px] font-bold leading-none tabular-nums tracking-wide text-white sm:text-[11px]">
          {record?.trim() || "—"}
        </p>
      </div>
    </div>
  );
}

function ScoreCol({
  score,
  leading,
  pulse,
}: {
  score: number;
  leading: boolean;
  pulse: boolean;
}) {
  return (
    <div className="flex min-w-[2.35rem] flex-col items-center justify-center px-1 sm:min-w-[2.85rem] sm:px-1.5">
      <p
        className={cn(
          "font-display text-[1.35rem] font-extrabold leading-none tabular-nums text-slate-900 sm:text-[1.75rem]",
          "transition-transform duration-300 ease-out",
          pulse && "scale-110 text-emerald-700",
        )}
      >
        {formatScore(score)}
      </p>
      <LeadMark show={leading} />
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

  return (
    <div className="relative mx-auto w-[min(100%,24rem)] sm:w-[min(100%,32rem)]">
      <div className="relative overflow-hidden rounded-sm bg-slate-100 shadow-[0_6px_20px_rgba(0,0,0,0.55)] ring-1 ring-black/20 sm:rounded">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_minmax(0,1fr)_auto] items-stretch">
          <LogoBlock tone="navy">
            <MatchupTeamAvatar
              name={leftName}
              logo={leftLogo ?? null}
              platform={platform ?? null}
              cacheKey={`${leagueKey ?? "tlon"}-left`}
              size="sm"
            />
          </LogoBlock>

          <TeamInfo
            name={leftName}
            rank={leftRank}
            record={leftRecord}
            yetToPlay={leftYetToPlay}
            yetToPlayMax={leftYetToPlayMax}
            tone="navy"
            align="left"
          />

          <ScoreCol
            score={leftLive}
            leading={leadingSide === "left"}
            pulse={scorePulseSide === "left"}
          />

          {/* Center — TLN + status + win prob */}
          <div className="flex min-w-[3.75rem] flex-col items-center justify-center gap-0.5 bg-[#111111] px-1.5 py-1 text-center sm:min-w-[5rem] sm:gap-1 sm:px-2.5 sm:py-1.5">
            <div className="flex items-center justify-center gap-1">
              <span className="display-title text-[9px] leading-none tracking-[0.16em] text-white sm:text-[11px] sm:tracking-[0.18em]">
                TLN
              </span>
              {daypart === "LIVE" ? (
                <span className="relative flex size-1.5 shrink-0">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-500 opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-rose-500" />
                </span>
              ) : null}
            </div>
            <p className="w-full text-center text-[7px] font-bold uppercase tracking-[0.1em] text-amber-300 sm:text-[8px]">
              {statusLabel}
              <span className="text-white/35"> · </span>
              <span className="text-white/85">WK {week}</span>
            </p>
            <p className="w-full text-center font-display text-[0.95rem] font-extrabold leading-none tabular-nums text-white sm:text-[1.2rem]">
              {Math.round(favoredPct)}%
            </p>
            <p className="w-full text-center text-[6.5px] font-semibold uppercase tracking-wide text-white/50 sm:text-[7.5px]">
              Win prob
            </p>
          </div>

          <ScoreCol
            score={rightLive}
            leading={leadingSide === "right"}
            pulse={scorePulseSide === "right"}
          />

          <TeamInfo
            name={rightName}
            rank={rightRank}
            record={rightRecord}
            yetToPlay={rightYetToPlay}
            yetToPlayMax={rightYetToPlayMax}
            tone="red"
            align="right"
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
