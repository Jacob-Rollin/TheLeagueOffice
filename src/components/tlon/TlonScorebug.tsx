import { MatchupTeamAvatar } from "@/components/playbook/MatchupPreviewCard";
import { cn } from "@/lib/utils";

function TimeoutTicks({ count, max = 5 }: { count: number; max?: number }) {
  const n = Math.max(0, Math.min(max, Math.floor(count)));
  if (max <= 0) return null;
  return (
    <div className="mt-1 flex items-center justify-center gap-1" aria-label={`${n} starters yet to play`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-0.5 w-3 rounded-full",
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
  projTotal,
  liveTotal,
  platform,
  leagueKey,
  leadingSide,
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
  projTotal: number;
  liveTotal: number;
  platform?: string | null;
  leagueKey?: string | null;
  /** Side currently favored / leading for the possession triangle. */
  leadingSide: "left" | "right" | "tie";
}) {
  const favored = winPctLeft >= winPctRight ? "left" : "right";
  const favoredPct = favored === "left" ? winPctLeft : winPctRight;
  const daypartClass =
    daypart === "LIVE"
      ? "bg-rose-600 text-white"
      : daypart === "FINAL"
        ? "bg-emerald-600 text-white"
        : "bg-white/15 text-white/90";

  return (
    <div className="relative mx-auto w-full max-w-4xl">
      {/* Glossy network tab */}
      <div className="absolute left-1/2 top-0 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-white/20 bg-zinc-950 px-4 py-1 shadow-lg shadow-black/40">
        <span className="display-title text-sm tracking-widest text-white">TLN</span>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", daypartClass)}>
          {daypart === "LIVE" ? "On Air" : daypart}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/15 bg-zinc-950/90 shadow-2xl shadow-black/50 backdrop-blur-md">
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch">
          {/* Away / left */}
          <div className="relative bg-gradient-to-r from-zinc-900 to-zinc-900/80 px-3 py-4 sm:px-5">
            {leadingSide === "left" ? (
              <span
                className="absolute right-3 top-2 text-[10px] text-white"
                aria-label="Leading"
              >
                ▼
              </span>
            ) : null}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold uppercase tracking-wide text-white sm:text-sm">
                  {leftName}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <MatchupTeamAvatar
                    name={leftName}
                    logo={leftLogo ?? null}
                    platform={platform ?? null}
                    cacheKey={`${leagueKey ?? "tlon"}-left`}
                    size="sm"
                  />
                  {leftRecord ? (
                    <span className="text-[11px] text-white/70">{leftRecord}</span>
                  ) : null}
                </div>
              </div>
              <div className="text-right">
                <p
                  className={cn(
                    "font-display text-3xl font-extrabold tabular-nums text-white sm:text-4xl",
                    "transition-[transform,color] duration-300",
                  )}
                >
                  {formatScore(leftLive)}
                </p>
                <TimeoutTicks count={leftYetToPlay} max={Math.max(leftYetToPlayMax, 1)} />
              </div>
            </div>
          </div>

          {/* Center hub */}
          <div className="flex min-w-[7.5rem] flex-col items-center justify-center border-x border-white/10 bg-zinc-950 px-3 py-3 sm:min-w-[9rem] sm:px-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
              Win prob
            </p>
            <p className="font-display text-3xl font-extrabold tabular-nums text-white sm:text-4xl">
              {Math.round(favoredPct)}%
            </p>
            <div className="mt-1.5 flex h-1.5 w-full max-w-[7rem] overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-emerald-500 transition-[width] duration-500"
                style={{ width: `${Math.max(0, Math.min(100, winPctLeft))}%` }}
              />
              <div
                className="h-full bg-rose-500 transition-[width] duration-500"
                style={{ width: `${Math.max(0, Math.min(100, winPctRight))}%` }}
              />
            </div>
            <p className="mt-2 text-center text-[10px] leading-tight text-white/65">
              <span className="tabular-nums text-white">{formatScore(liveTotal)}</span>
              <span className="mx-1 text-white/40">·</span>
              <span className="tabular-nums">proj {formatScore(projTotal)}</span>
            </p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/45">
              Week {week}
            </p>
          </div>

          {/* Home / right */}
          <div className="relative bg-gradient-to-l from-red-950/90 via-zinc-900 to-zinc-900/80 px-3 py-4 sm:px-5">
            {leadingSide === "right" ? (
              <span
                className="absolute left-3 top-2 text-[10px] text-white"
                aria-label="Leading"
              >
                ▼
              </span>
            ) : null}
            <div className="flex items-start justify-between gap-2">
              <div className="text-left">
                <p
                  className={cn(
                    "font-display text-3xl font-extrabold tabular-nums text-white sm:text-4xl",
                    "transition-[transform,color] duration-300",
                  )}
                >
                  {formatScore(rightLive)}
                </p>
                <TimeoutTicks count={rightYetToPlay} max={Math.max(rightYetToPlayMax, 1)} />
              </div>
              <div className="min-w-0 text-right">
                <p className="truncate text-xs font-bold uppercase tracking-wide text-white sm:text-sm">
                  {rightName}
                </p>
                <div className="mt-1.5 flex items-center justify-end gap-2">
                  {rightRecord ? (
                    <span className="text-[11px] text-white/70">{rightRecord}</span>
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
    </div>
  );
}
