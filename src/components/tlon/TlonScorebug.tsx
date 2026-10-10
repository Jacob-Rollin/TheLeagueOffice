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
      className={cn(
        "flex flex-col justify-center",
        slots > 7 ? "gap-[2px]" : "gap-[3px]",
      )}
      aria-label={`${n} of ${slots} starters yet to play`}
      title={`${n} of ${slots} starters yet to play`}
    >
      {Array.from({ length: slots }, (_, i) => (
        <span
          key={i}
          className={cn(
            "rounded-full transition-colors duration-500",
            slots > 7 ? "h-[1.5px] w-2.5 sm:w-3" : "h-[2px] w-3 sm:w-3.5",
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
    /* Compact centered bug — leaves field visible on both sides */
    <div className="relative mx-auto w-[min(100%,22.5rem)] sm:w-[min(100%,32rem)]">
      <div
        className={cn(
          "overflow-hidden rounded-md border border-white/15 shadow-2xl shadow-black/50 sm:rounded-lg",
          "bg-[#0a0a0a]",
        )}
      >
        {/* Top strip — names + TLN (broadcast header row) */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch text-white">
          <div className="min-w-0 bg-[#15233a] px-2 py-1 sm:px-3 sm:py-1.5">
            <p
              className="truncate font-display text-[10px] font-bold uppercase tracking-[0.06em] sm:text-[12px] sm:tracking-[0.1em]"
              title={leftTitle}
            >
              {leftTitle}
            </p>
          </div>
          <div className="flex min-w-[3.75rem] items-center justify-center gap-1.5 bg-[#111111] px-2 py-1 sm:min-w-[5.25rem] sm:gap-2 sm:px-2.5 sm:py-1.5">
            <span className="display-title text-[11px] tracking-[0.18em] sm:text-[13px] sm:tracking-[0.2em]">
              TLN
            </span>
            {daypart === "LIVE" ? (
              <span className="relative flex size-1.5 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-500 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-rose-500" />
              </span>
            ) : (
              <span className="text-[9px] font-bold uppercase tracking-wider text-white/50 sm:text-[10px]">
                {statusLabel}
              </span>
            )}
          </div>
          <div className="min-w-0 bg-[#5c1515] px-2 py-1 text-right sm:px-3 sm:py-1.5">
            <p
              className="truncate font-display text-[10px] font-bold uppercase tracking-[0.06em] sm:text-[12px] sm:tracking-[0.1em]"
              title={rightTitle}
            >
              {rightTitle}
            </p>
          </div>
        </div>

        {/* Main row — logos, records, yet-to-play ticks, scores, win prob */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch">
          {/* Away */}
          <div className="relative min-w-0 bg-[linear-gradient(90deg,#1e3a5f_0%,#15233a_55%,#0f172a_100%)] px-1.5 py-1.5 sm:px-3 sm:py-2.5">
            <div className="flex h-full items-center justify-between gap-1.5 sm:gap-2.5">
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                <MatchupTeamAvatar
                  name={leftName}
                  logo={leftLogo ?? null}
                  platform={platform ?? null}
                  cacheKey={`${leagueKey ?? "tlon"}-left`}
                  size="md"
                />
                {leftRecord ? (
                  <span className="font-display text-[15px] font-bold leading-none tabular-nums text-white sm:text-[1.35rem]">
                    {leftRecord}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2.5">
                <YetToPlayTicks
                  count={leftYetToPlay}
                  max={Math.max(leftYetToPlayMax, 1)}
                />
                <div className="flex flex-col items-center">
                  <p
                    className={cn(
                      "font-display text-[1.5rem] font-extrabold leading-none tabular-nums text-white sm:text-[2.5rem]",
                      "transition-transform duration-300 ease-out",
                      scorePulseSide === "left" && "scale-110 text-emerald-300",
                    )}
                  >
                    {formatScore(leftLive)}
                  </p>
                  {leadingSide === "left" ? (
                    <span
                      className="mt-0.5 text-[9px] leading-none text-white sm:text-[10px]"
                      aria-label="Leading"
                    >
                      ▲
                    </span>
                  ) : (
                    <span className="mt-0.5 h-[9px] sm:h-[10px]" aria-hidden />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Center — status + win prob */}
          <div className="flex min-w-[3.75rem] flex-col items-center justify-center border-x border-white/10 bg-[#0a0a0a] px-1.5 py-1.5 sm:min-w-[5.5rem] sm:px-2.5 sm:py-2">
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
          <div className="relative min-w-0 bg-[linear-gradient(270deg,#7f1d1d_0%,#5c1515_55%,#1a0a0a_100%)] px-1.5 py-1.5 sm:px-3 sm:py-2.5">
            <div className="flex h-full items-center justify-between gap-1.5 sm:gap-2.5">
              <div className="flex items-center gap-1.5 sm:gap-2.5">
                <div className="flex flex-col items-center">
                  <p
                    className={cn(
                      "font-display text-[1.5rem] font-extrabold leading-none tabular-nums text-white sm:text-[2.5rem]",
                      "transition-transform duration-300 ease-out",
                      scorePulseSide === "right" && "scale-110 text-emerald-300",
                    )}
                  >
                    {formatScore(rightLive)}
                  </p>
                  {leadingSide === "right" ? (
                    <span
                      className="mt-0.5 text-[9px] leading-none text-white sm:text-[10px]"
                      aria-label="Leading"
                    >
                      ▲
                    </span>
                  ) : (
                    <span className="mt-0.5 h-[9px] sm:h-[10px]" aria-hidden />
                  )}
                </div>
                <YetToPlayTicks
                  count={rightYetToPlay}
                  max={Math.max(rightYetToPlayMax, 1)}
                />
              </div>
              <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
                {rightRecord ? (
                  <span className="font-display text-[15px] font-bold leading-none tabular-nums text-white sm:text-[1.35rem]">
                    {rightRecord}
                  </span>
                ) : null}
                <MatchupTeamAvatar
                  name={rightName}
                  logo={rightLogo ?? null}
                  platform={platform ?? null}
                  cacheKey={`${leagueKey ?? "tlon"}-right`}
                  size="md"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
