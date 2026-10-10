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
            "rounded-[1px] transition-colors duration-500",
            slots > 7 ? "h-[1.5px] w-2.5 sm:w-3" : "h-[2px] w-3 sm:w-3.5",
            i < n ? "bg-white shadow-[0_0_4px_rgba(255,255,255,0.45)]" : "bg-white/20",
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
  if (!show) return <span className="mt-0.5 h-[8px] sm:h-[9px]" aria-hidden />;
  return (
    <span
      className="mt-0.5 inline-block border-x-[4px] border-b-[6px] border-x-transparent border-b-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)] sm:border-x-[4.5px] sm:border-b-[7px]"
      aria-label="Leading"
    />
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
    /* Compact centered bug — leaves field visible on both sides */
    <div className="relative mx-auto w-[min(100%,22.5rem)] sm:w-[min(100%,32rem)]">
      <div
        className={cn(
          "relative overflow-hidden rounded-sm shadow-[0_8px_28px_rgba(0,0,0,0.55),0_2px_8px_rgba(0,0,0,0.35)] sm:rounded",
          "ring-1 ring-white/20",
        )}
      >
        {/* Broadcast glass sheen across the whole bug */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.04)_18%,transparent_42%)]"
        />

        {/* Top strip — names + TLN */}
        <div className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-stretch text-white">
          <div className="min-w-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.28)_0%,rgba(0,0,0,0.12)_100%),linear-gradient(90deg,#1d4ed8_0%,#1e40af_100%)] px-2 py-1 sm:px-3 sm:py-1.5">
            <p
              className="truncate font-display text-[10px] font-bold uppercase tracking-[0.08em] text-white drop-shadow-sm sm:text-[12px] sm:tracking-[0.12em]"
              title={leftTitle}
            >
              {leftTitle}
            </p>
          </div>
          <div className="flex min-w-[3.75rem] items-center justify-center gap-1.5 bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,transparent_100%),#141414] px-2 py-1 sm:min-w-[5.25rem] sm:gap-2 sm:px-2.5 sm:py-1.5">
            <span className="display-title text-[11px] tracking-[0.2em] text-white drop-shadow sm:text-[13px] sm:tracking-[0.22em]">
              TLN
            </span>
            {daypart === "LIVE" ? (
              <span className="relative flex size-1.5 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-500 opacity-80" />
                <span className="relative inline-flex size-1.5 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.9)]" />
              </span>
            ) : (
              <span className="text-[9px] font-bold uppercase tracking-wider text-white/55 sm:text-[10px]">
                {statusLabel}
              </span>
            )}
          </div>
          <div className="min-w-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.28)_0%,rgba(0,0,0,0.12)_100%),linear-gradient(270deg,#dc2626_0%,#b91c1c_100%)] px-2 py-1 text-right sm:px-3 sm:py-1.5">
            <p
              className="truncate font-display text-[10px] font-bold uppercase tracking-[0.08em] text-white drop-shadow-sm sm:text-[12px] sm:tracking-[0.12em]"
              title={rightTitle}
            >
              {rightTitle}
            </p>
          </div>
        </div>

        {/* Main row */}
        <div className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-stretch">
          {/* Away — saturated blue, lighter on the outer edge */}
          <div className="relative min-w-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.1)_0%,transparent_35%),linear-gradient(90deg,#2563eb_0%,#1d4ed8_42%,#1e3a8a_100%)] px-1.5 py-1.5 sm:px-3 sm:py-2.5">
            <div className="flex h-full items-center justify-between gap-1.5 sm:gap-2.5">
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                <span className="shrink-0 rounded-md shadow-md shadow-black/30 ring-1 ring-white/35 [&_span]:rounded-md [&_span]:border-white/20 [&_span]:bg-white/10">
                  <MatchupTeamAvatar
                    name={leftName}
                    logo={leftLogo ?? null}
                    platform={platform ?? null}
                    cacheKey={`${leagueKey ?? "tlon"}-left`}
                    size="md"
                  />
                </span>
                {leftRecord ? (
                  <span className="font-display text-[15px] font-extrabold leading-none tabular-nums text-white drop-shadow-sm sm:text-[1.4rem]">
                    {leftRecord}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2.5">
                <YetToPlayTicks
                  count={leftYetToPlay}
                  max={Math.max(leftYetToPlayMax, 1)}
                />
                <div className="flex min-w-[2.75rem] flex-col items-center sm:min-w-[3.5rem]">
                  <p
                    className={cn(
                      "font-display text-[1.55rem] font-extrabold leading-none tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)] sm:text-[2.55rem]",
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
          </div>

          {/* Center — charcoal glass */}
          <div className="relative flex min-w-[3.75rem] flex-col items-center justify-center bg-[linear-gradient(180deg,rgba(255,255,255,0.08)_0%,transparent_40%),linear-gradient(180deg,#2a2a2a_0%,#141414_55%,#0c0c0c_100%)] px-1.5 py-1.5 shadow-[inset_1px_0_0_rgba(255,255,255,0.08),inset_-1px_0_0_rgba(255,255,255,0.08)] sm:min-w-[5.5rem] sm:px-2.5 sm:py-2">
            <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-amber-300 drop-shadow sm:text-[9px] sm:tracking-[0.16em]">
              {statusLabel}
              <span className="text-white/40"> · </span>
              <span className="text-white/85">WK {week}</span>
            </p>
            <p className="mt-0.5 font-display text-[1.4rem] font-extrabold leading-none tabular-nums text-white drop-shadow sm:text-[2.05rem]">
              {Math.round(favoredPct)}%
            </p>
            <p className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-white/55 sm:text-[9px]">
              Win prob
            </p>
          </div>

          {/* Home — saturated crimson, lighter on the outer edge */}
          <div className="relative min-w-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.1)_0%,transparent_35%),linear-gradient(270deg,#ef4444_0%,#dc2626_42%,#991b1b_100%)] px-1.5 py-1.5 sm:px-3 sm:py-2.5">
            <div className="flex h-full items-center justify-between gap-1.5 sm:gap-2.5">
              <div className="flex items-center gap-1.5 sm:gap-2.5">
                <div className="flex min-w-[2.75rem] flex-col items-center sm:min-w-[3.5rem]">
                  <p
                    className={cn(
                      "font-display text-[1.55rem] font-extrabold leading-none tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)] sm:text-[2.55rem]",
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
              <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
                {rightRecord ? (
                  <span className="font-display text-[15px] font-extrabold leading-none tabular-nums text-white drop-shadow-sm sm:text-[1.4rem]">
                    {rightRecord}
                  </span>
                ) : null}
                <span className="shrink-0 rounded-md shadow-md shadow-black/30 ring-1 ring-white/35 [&_span]:rounded-md [&_span]:border-white/20 [&_span]:bg-white/10">
                  <MatchupTeamAvatar
                    name={rightName}
                    logo={rightLogo ?? null}
                    platform={platform ?? null}
                    cacheKey={`${leagueKey ?? "tlon"}-right`}
                    size="md"
                  />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
