import { useEffect, useRef, useState, type ReactNode } from "react";

import { MatchupTeamAvatar } from "@/components/playbook/MatchupPreviewCard";
import { useCountUp } from "@/hooks/useCountUp";
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
  expanded,
}: {
  count: number;
  max?: number;
  tone: "navy" | "red";
  expanded?: boolean;
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
            "shrink-0 rounded-full",
            expanded ? "size-[5px] sm:size-[6px]" : "size-[3.5px] sm:size-[4px]",
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

/** Same ease-out tick as Scoring Update toasts — no hard snap on live polls. */
function AnimatedScore({
  score,
  pulse,
  expanded,
}: {
  score: number;
  pulse: boolean;
  expanded?: boolean;
}) {
  const target = Math.round((Number.isFinite(score) ? score : 0) * 100) / 100;
  const prevRef = useRef(target);
  const [from, setFrom] = useState(target);
  const [to, setTo] = useState(target);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    const prev = prevRef.current;
    if (target === prev) return;
    setFrom(prev);
    setTo(target);
    setAnimating(true);
    prevRef.current = target;
    const done = window.setTimeout(() => setAnimating(false), 950);
    return () => window.clearTimeout(done);
  }, [target]);

  const display = useCountUp(from, to, animating, 900);

  return (
    <p
      className={cn(
        "relative z-[1] shrink-0 font-display font-extrabold leading-none tabular-nums text-slate-900",
        "transition-transform duration-300 ease-out",
        expanded ? "text-[1.55rem] sm:text-[1.85rem]" : "text-[1.05rem] sm:text-[1.45rem]",
        (pulse || animating) && "scale-110 text-emerald-700",
      )}
    >
      {formatScore(display)}
    </p>
  );
}

function LogoBlock({
  tone,
  children,
  expanded,
}: {
  tone: "navy" | "red";
  children: ReactNode;
  expanded?: boolean;
}) {
  return (
    <div
      className={cn(
        // Fixed-width end caps stretched to row height — avoid aspect-square
        // (it fights flex stretch and collapses one side into a tall thin strip).
        "flex shrink-0 items-stretch self-stretch",
        expanded ? "w-[3.5rem] p-1.5 sm:w-16 sm:p-2" : "w-10 p-1 sm:w-12 sm:p-[5px]",
        tone === "navy" ? "bg-[#1e3a5f]" : "bg-[#b91c1c]",
      )}
    >
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-white/10",
          // MatchupTeamAvatar renders a sized <span> — force it to fill the frame.
          "[&>span]:!box-border [&>span]:!h-full [&>span]:!w-full [&>span]:!max-h-none [&>span]:!max-w-none",
          "[&>span]:!rounded-[3px] [&>span]:!border-0 [&>span]:!bg-transparent",
          "[&>span>img]:!h-full [&>span>img]:!w-full [&>span>img]:!object-cover",
        )}
      >
        {children}
      </div>
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
  expanded,
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
  expanded?: boolean;
}) {
  const rankLabel =
    rank != null && Number.isFinite(rank) && rank >= 1 ? String(Math.floor(rank)) : "";
  const bar = tone === "navy" ? "bg-[#1e3a5f]" : "bg-[#b91c1c]";
  const right = align === "right";

  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col justify-center",
        expanded ? "px-2.5 py-1.5 sm:px-3.5 sm:py-2" : "px-1 py-1 sm:px-2.5 sm:py-1.5",
      )}
    >
      {/* Top: rank + team name, hairline separates from dots/score */}
      <p
        className={cn(
          "flex min-w-0 items-baseline gap-1 leading-tight border-b border-slate-300",
          expanded ? "pb-1.5 mb-1.5 sm:pb-2 sm:mb-2" : "pb-1 mb-1 sm:pb-1.5 sm:mb-1.5",
          right && "justify-end text-right",
        )}
        title={rankLabel ? `${rankLabel} ${name}` : name}
      >
        {rankLabel ? (
          <span
            className={cn(
              "shrink-0 font-display font-semibold tabular-nums text-slate-500",
              expanded ? "text-[11px] sm:text-[13px]" : "text-[8px] sm:text-[10px]",
            )}
          >
            {rankLabel}
          </span>
        ) : null}
        <span
          className={cn(
            "min-w-0 break-words font-display font-extrabold uppercase text-slate-900",
            expanded
              ? "text-[12px] tracking-[0.03em] sm:text-[14px] sm:tracking-[0.05em]"
              : "text-[8px] tracking-[0.02em] sm:text-[11px] sm:tracking-[0.04em]",
          )}
        >
          {name}
        </span>
      </p>

      {/* Bottom: dots + record bar, score beside them */}
      <div
        className={cn(
          "flex items-end",
          expanded ? "gap-2 sm:gap-2.5" : "gap-1 sm:gap-2",
          right && "flex-row-reverse",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            expanded ? "gap-1 sm:min-w-[6.5rem] sm:gap-1.5" : "gap-[3px] sm:min-w-[5rem] sm:gap-1",
          )}
        >
          <YetToPlayDots
            count={yetToPlay}
            max={Math.max(yetToPlayMax, 1)}
            tone={tone}
            expanded={expanded}
          />
          <div
            className={cn(
              "w-full rounded-[2px]",
              expanded ? "px-2 py-1 sm:px-2.5" : "px-1 py-[2px] sm:px-2 sm:py-0.5",
              bar,
            )}
          >
            <p
              className={cn(
                "text-center font-display font-bold leading-none tabular-nums tracking-wide text-white",
                expanded ? "text-[11px] sm:text-[13px]" : "text-[8px] sm:text-[11px]",
              )}
            >
              {record?.trim() || "—"}
            </p>
          </div>
        </div>

        <AnimatedScore score={score} pulse={pulse} expanded={expanded} />
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
  expanded = false,
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
  /** Fullscreen / large desktop — grow type and chrome with the stage. */
  expanded?: boolean;
}) {
  const favored = winPctLeft >= winPctRight ? "left" : "right";
  const favoredPct = favored === "left" ? winPctLeft : winPctRight;

  return (
    <div
      className={cn(
        "relative mx-auto w-full",
        expanded
          ? "max-w-[min(100%,52rem)]"
          : "max-w-[min(100%,28rem)] sm:max-w-[min(100%,36rem)] lg:max-w-[min(100%,42rem)]",
      )}
    >
      <div className="relative overflow-hidden rounded-sm bg-slate-100 shadow-[0_6px_20px_rgba(0,0,0,0.55)] ring-1 ring-black/20 sm:rounded">
        <div className="flex items-stretch">
          <LogoBlock tone="navy" expanded={expanded}>
            <MatchupTeamAvatar
              name={leftName}
              logo={leftLogo ?? null}
              platform={platform ?? null}
              cacheKey={`${leagueKey ?? "tlon"}-left`}
              size={expanded ? "md" : "sm"}
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
            expanded={expanded}
          />

          {/*
            Center — TLN + live flash on top; win % + arrow + WIN PROB below.
            Keep narrow on phones so scores stay visible in portrait.
          */}
          <div
            className={cn(
              "flex shrink-0 flex-col items-center justify-center bg-[#111111]",
              expanded
                ? "min-w-[5.5rem] gap-1 px-2 py-2 sm:min-w-[6.5rem] sm:gap-1.5 sm:px-3 sm:py-2.5"
                : "w-[2.65rem] gap-[2px] px-0.5 py-1 sm:w-auto sm:min-w-[4.5rem] sm:gap-1 sm:px-2 sm:py-1.5",
            )}
          >
            {/* Hairline under TLN — same slate-300 rule as team-name / score split */}
            <div
              className={cn(
                "flex w-full items-center justify-center gap-0.5 border-b border-slate-300 sm:gap-1",
                expanded ? "pb-1.5 mb-1.5 sm:pb-2 sm:mb-2" : "pb-1 mb-1 sm:pb-1.5 sm:mb-1.5",
              )}
            >
              <span
                className={cn(
                  "display-title leading-none text-white",
                  expanded
                    ? "text-[10px] tracking-[0.14em] sm:text-[12px] sm:tracking-[0.18em]"
                    : "text-[7px] tracking-[0.12em] sm:text-[10px] sm:tracking-[0.16em]",
                )}
              >
                TLN
              </span>
              {daypart === "LIVE" ? (
                <span
                  className={cn(
                    "relative flex shrink-0",
                    expanded ? "size-1.5 sm:size-2" : "size-1 sm:size-1.5",
                  )}
                >
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-500 opacity-75" />
                  <span
                    className={cn(
                      "relative inline-flex rounded-full bg-rose-500",
                      expanded ? "size-1.5 sm:size-2" : "size-1 sm:size-1.5",
                    )}
                  />
                </span>
              ) : null}
            </div>
            <div className="flex items-center justify-center gap-0.5 sm:gap-1">
              {favored === "left" ? (
                <span
                  className={cn(
                    "inline-block border-y-transparent border-r-white",
                    expanded
                      ? "border-y-[4px] border-r-[6px] sm:border-y-[5px] sm:border-r-[7px]"
                      : "border-y-[3px] border-r-[4px] sm:border-y-[4px] sm:border-r-[5px]",
                  )}
                  aria-label="Favored left"
                />
              ) : null}
              <span
                className={cn(
                  "font-display font-extrabold leading-none tabular-nums text-white",
                  expanded ? "text-[1.35rem] sm:text-[1.55rem]" : "text-[0.85rem] sm:text-[1.25rem]",
                )}
              >
                {Math.round(favoredPct)}%
              </span>
              {favored === "right" ? (
                <span
                  className={cn(
                    "inline-block border-y-transparent border-l-white",
                    expanded
                      ? "border-y-[4px] border-l-[6px] sm:border-y-[5px] sm:border-l-[7px]"
                      : "border-y-[3px] border-l-[4px] sm:border-y-[4px] sm:border-l-[5px]",
                  )}
                  aria-label="Favored right"
                />
              ) : null}
            </div>
            <p
              className={cn(
                "w-full text-center font-semibold uppercase tracking-wide text-white/55",
                expanded ? "text-[7.5px] sm:text-[9px]" : "text-[5.5px] sm:text-[7.5px]",
              )}
            >
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
            expanded={expanded}
          />

          <LogoBlock tone="red" expanded={expanded}>
            <MatchupTeamAvatar
              name={rightName}
              logo={rightLogo ?? null}
              platform={platform ?? null}
              cacheKey={`${leagueKey ?? "tlon"}-right`}
              size={expanded ? "md" : "sm"}
            />
          </LogoBlock>
        </div>
      </div>
    </div>
  );
}
