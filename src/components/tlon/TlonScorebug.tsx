import { MatchupTeamAvatar } from "@/components/playbook/MatchupPreviewCard";
import { cn } from "@/lib/utils";

function TimeoutTicks({ count, max = 5 }: { count: number; max?: number }) {
  const n = Math.max(0, Math.min(max, Math.floor(count)));
  const slots = Math.min(5, Math.max(1, Math.min(max, 5)));
  return (
    <div
      className="mt-0.5 flex items-center gap-[2px]"
      aria-label={`${n} starters yet to play`}
    >
      {Array.from({ length: slots }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-[2px] w-2 rounded-full transition-colors duration-500 sm:w-2.5",
            i < n ? "bg-white/90" : "bg-white/20",
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

export type TlonDaypart = "PRE" | "LIVE" | "FINAL";

export function TlonScorebug({
  week,
  daypart,
  leftName,
  leftLogo,
  leftRecord,
  leftLive,
  leftYetToPlay,
  leftYetToPlayMax,
  rightName,
  rightLogo,
  rightRecord,
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
  leftLive: number;
  leftYetToPlay: number;
  leftYetToPlayMax: number;
  rightName: string;
  rightLogo?: string | null;
  rightRecord?: string | null;
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
    <div className="relative mx-auto w-full max-w-5xl">
      {/*
        Tab + bar share one border/background. Tab uses extra bottom padding and
        a negative margin so it paints over the bar’s top edge (no hairline seam).
      */}
      <div className="flex justify-center">
        <div className="relative z-20 -mb-1 flex items-center gap-1.5 rounded-t-md border border-b-0 border-white/20 bg-zinc-950 px-2.5 pb-1.5 pt-0.5 sm:-mb-1.5 sm:gap-2 sm:px-4 sm:pb-2 sm:pt-1">
          <span className="display-title text-[11px] tracking-[0.18em] text-white sm:text-[13px] sm:tracking-[0.2em]">
            TLN
          </span>
          {daypart === "LIVE" ? (
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-500 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-rose-500" />
            </span>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "relative z-10 overflow-hidden rounded-lg border border-white/20 shadow-2xl shadow-black/50 sm:rounded-xl",
          /* Solid zinc-950 matches the TLN tab — no lighter top highlight (that read as a seam) */
          "bg-zinc-950",
          "bg-[linear-gradient(90deg,#18181b_0%,#09090b_50%,#18181b_100%)]",
        )}
      >
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch">
          {/* Away */}
          <div className="relative min-w-0 bg-[linear-gradient(135deg,#27272a_0%,#18181b_55%,#09090b_100%)] px-1.5 py-1.5 sm:px-4 sm:py-2.5">
            {leadingSide === "left" ? (
              <span
                className="absolute left-1/2 top-0 -translate-x-1/2 text-[8px] text-white drop-shadow sm:top-0.5 sm:text-[9px]"
                aria-label="Leading"
              >
                ▼
              </span>
            ) : null}
            <p
              className="truncate font-display text-[9px] font-bold uppercase tracking-wide text-white sm:text-xs sm:tracking-wider"
              title={leftName}
            >
              {leftName}
            </p>
            <div className="mt-0.5 flex items-end justify-between gap-1 sm:mt-1 sm:gap-2">
              <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
                <MatchupTeamAvatar
                  name={leftName}
                  logo={leftLogo ?? null}
                  platform={platform ?? null}
                  cacheKey={`${leagueKey ?? "tlon"}-left`}
                  size="sm"
                />
                {leftRecord ? (
                  <span className="hidden truncate text-[10px] text-white/65 sm:inline">{leftRecord}</span>
                ) : null}
              </div>
              <div className="flex flex-col items-end">
                <p
                  className={cn(
                    "font-display text-[1.35rem] font-extrabold leading-none tabular-nums text-white sm:text-[2.35rem]",
                    "transition-transform duration-300 ease-out",
                    scorePulseSide === "left" && "scale-110 text-emerald-300",
                  )}
                >
                  {formatScore(leftLive)}
                </p>
                <TimeoutTicks count={leftYetToPlay} max={Math.max(leftYetToPlayMax, 1)} />
              </div>
            </div>
          </div>

          {/* Center — WK label avoids “LIVE 5” reading as five live players */}
          <div className="flex min-w-[3.75rem] flex-col items-center justify-center border-x border-white/10 bg-black/80 px-1.5 py-1.5 sm:min-w-[6.5rem] sm:px-3 sm:py-2">
            <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-amber-400 sm:text-[9px] sm:tracking-[0.14em]">
              {statusLabel}
              <span className="text-white/35"> · </span>
              WK {week}
            </p>
            <p className="font-display text-[1.35rem] font-extrabold leading-none tabular-nums text-white sm:text-[2rem]">
              {Math.round(favoredPct)}%
            </p>
            <p className="mt-0.5 text-[8px] font-semibold uppercase tracking-wide text-white/45 sm:text-[9px]">
              Win prob
            </p>
          </div>

          {/* Home */}
          <div className="relative min-w-0 bg-[linear-gradient(225deg,#7f1d1d_0%,#1e3a5f_48%,#0f172a_100%)] px-1.5 py-1.5 sm:px-4 sm:py-2.5">
            {leadingSide === "right" ? (
              <span
                className="absolute left-1/2 top-0 -translate-x-1/2 text-[8px] text-white drop-shadow sm:top-0.5 sm:text-[9px]"
                aria-label="Leading"
              >
                ▼
              </span>
            ) : null}
            <p
              className="truncate text-right font-display text-[9px] font-bold uppercase tracking-wide text-white sm:text-xs sm:tracking-wider"
              title={rightName}
            >
              {rightName}
            </p>
            <div className="mt-0.5 flex items-end justify-between gap-1 sm:mt-1 sm:gap-2">
              <div className="flex flex-col items-start">
                <p
                  className={cn(
                    "font-display text-[1.35rem] font-extrabold leading-none tabular-nums text-white sm:text-[2.35rem]",
                    "transition-transform duration-300 ease-out",
                    scorePulseSide === "right" && "scale-110 text-emerald-300",
                  )}
                >
                  {formatScore(rightLive)}
                </p>
                <TimeoutTicks count={rightYetToPlay} max={Math.max(rightYetToPlayMax, 1)} />
              </div>
              <div className="flex min-w-0 items-center justify-end gap-1 sm:gap-1.5">
                {rightRecord ? (
                  <span className="hidden truncate text-[10px] text-white/65 sm:inline">{rightRecord}</span>
                ) : null}
                <MatchupTeamAvatar
                  name={rightName}
                  logo={rightLogo ?? null}
                  platform={platform ?? null}
                  cacheKey={`${leagueKey ?? "tlon"}-right`}
                  size="sm"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
