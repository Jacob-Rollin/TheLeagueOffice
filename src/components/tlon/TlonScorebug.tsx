import { MatchupTeamAvatar } from "@/components/playbook/MatchupPreviewCard";
import { cn } from "@/lib/utils";

function TimeoutTicks({ count, max = 5 }: { count: number; max?: number }) {
  const n = Math.max(0, Math.min(max, Math.floor(count)));
  const slots = Math.min(5, Math.max(max, 1));
  return (
    <div className="mt-0.5 flex items-center justify-center gap-[3px]" aria-label={`${n} starters yet to play`}>
      {Array.from({ length: slots }, (_, i) => (
        <span
          key={i}
          className={cn("h-[2px] w-2.5 rounded-full transition-colors duration-500", i < n ? "bg-white/90" : "bg-white/20")}
        />
      ))}
    </div>
  );
}

function formatScore(n: number): string {
  if (!Number.isFinite(n)) return "0.0";
  return (Math.round(n * 10) / 10).toFixed(1);
}

function shortName(name: string): string {
  const cleaned = name.trim().toUpperCase();
  if (cleaned.length <= 14) return cleaned;
  return `${cleaned.slice(0, 13)}…`;
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
  /** Briefly pulse the score numeral after a feed hit. */
  scorePulseSide?: "left" | "right" | null;
}) {
  const favored = winPctLeft >= winPctRight ? "left" : "right";
  const favoredPct = favored === "left" ? winPctLeft : winPctRight;

  return (
    <div className="relative mx-auto w-full max-w-5xl pt-3">
      {/* Glossy network tab — logo only + live dot */}
      <div className="absolute left-1/2 top-0 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-t-lg border border-b-0 border-white/25 bg-zinc-950 px-4 py-1 shadow-lg shadow-black/50">
        <span className="display-title text-[13px] tracking-[0.2em] text-white">TLN</span>
        {daypart === "LIVE" ? (
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-500 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-rose-500" />
          </span>
        ) : null}
      </div>

      <div
        className={cn(
          "overflow-hidden rounded-xl border border-white/20 shadow-2xl shadow-black/50",
          "bg-zinc-950/85 backdrop-blur-md",
          /* top specular */
          "bg-[linear-gradient(180deg,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0)_42%),linear-gradient(90deg,#18181b_0%,#09090b_50%,#18181b_100%)]",
        )}
      >
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch">
          {/* Away — charcoal */}
          <div className="relative bg-[linear-gradient(135deg,#27272a_0%,#18181b_55%,#09090b_100%)] px-3 py-2.5 sm:px-4">
            {leadingSide === "left" ? (
              <span className="absolute left-1/2 top-0.5 -translate-x-1/2 text-[9px] text-white drop-shadow" aria-label="Leading">
                ▼
              </span>
            ) : null}
            <p className="truncate font-display text-[11px] font-bold uppercase tracking-wider text-white sm:text-xs">
              {shortName(leftName)}
            </p>
            <div className="mt-1 flex items-end justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <MatchupTeamAvatar
                  name={leftName}
                  logo={leftLogo ?? null}
                  platform={platform ?? null}
                  cacheKey={`${leagueKey ?? "tlon"}-left`}
                  size="sm"
                />
                {leftRecord ? <span className="truncate text-[10px] text-white/65">{leftRecord}</span> : null}
              </div>
              <div className="text-right">
                <p
                  className={cn(
                    "font-display text-[2rem] font-extrabold leading-none tabular-nums text-white sm:text-[2.35rem]",
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

          {/* Center hub — win% only */}
          <div className="flex min-w-[5.5rem] flex-col items-center justify-center border-x border-white/10 bg-black/80 px-2.5 py-2 sm:min-w-[6.5rem] sm:px-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-amber-400">
              {daypart === "LIVE" ? "Live" : daypart === "FINAL" ? "Final" : "Week"} {week}
            </p>
            <p className="font-display text-[1.75rem] font-extrabold leading-none tabular-nums text-white sm:text-[2rem]">
              {Math.round(favoredPct)}%
            </p>
            <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/45">Win prob</p>
          </div>

          {/* Home — navy / red brand */}
          <div className="relative bg-[linear-gradient(225deg,#7f1d1d_0%,#1e3a5f_48%,#0f172a_100%)] px-3 py-2.5 sm:px-4">
            {leadingSide === "right" ? (
              <span className="absolute left-1/2 top-0.5 -translate-x-1/2 text-[9px] text-white drop-shadow" aria-label="Leading">
                ▼
              </span>
            ) : null}
            <p className="truncate text-right font-display text-[11px] font-bold uppercase tracking-wider text-white sm:text-xs">
              {shortName(rightName)}
            </p>
            <div className="mt-1 flex items-end justify-between gap-2">
              <div className="text-left">
                <p
                  className={cn(
                    "font-display text-[2rem] font-extrabold leading-none tabular-nums text-white sm:text-[2.35rem]",
                    "transition-transform duration-300 ease-out",
                    scorePulseSide === "right" && "scale-110 text-emerald-300",
                  )}
                >
                  {formatScore(rightLive)}
                </p>
                <TimeoutTicks count={rightYetToPlay} max={Math.max(rightYetToPlayMax, 1)} />
              </div>
              <div className="flex min-w-0 items-center justify-end gap-1.5">
                {rightRecord ? <span className="truncate text-[10px] text-white/65">{rightRecord}</span> : null}
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
