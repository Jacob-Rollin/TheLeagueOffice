import { useEffect, useState } from "react";

import { playerImage } from "@/components/draft/PlayerAvatar";
import { MatchupTeamAvatar } from "@/components/playbook/MatchupPreviewCard";
import { useCountUp } from "@/hooks/useCountUp";
import type { Pos } from "@/lib/draft";
import type { TlonScoringUpdate } from "@/lib/tlon-play-feed";
import { cn } from "@/lib/utils";

export function TlonScoringUpdateToast({
  update,
  platform,
  leagueKey,
  onSelect,
  onDone,
}: {
  update: TlonScoringUpdate | null;
  platform?: string | null;
  leagueKey?: string | null;
  onSelect?: (matchupId: string) => void;
  onDone?: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!update) {
      setVisible(false);
      return;
    }
    setVisible(false);
    const enter = window.setTimeout(() => setVisible(true), 20);
    // Hold long enough to read player + score tick-up (enter/exit animations extra).
    const leave = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(() => onDone?.(), 320);
    }, 16_000);
    return () => {
      window.clearTimeout(enter);
      window.clearTimeout(leave);
    };
  }, [update?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const leftDisplay = useCountUp(
    update?.leftFrom ?? 0,
    update?.leftTo ?? 0,
    visible && Boolean(update),
  );
  const rightDisplay = useCountUp(
    update?.rightFrom ?? 0,
    update?.rightTo ?? 0,
    visible && Boolean(update),
  );

  if (!update) return null;

  const scoringLeft = update.side === "left";
  const sign = update.delta >= 0 ? "+" : "";

  return (
    <button
      type="button"
      onClick={() => onSelect?.(update.matchupId)}
      className={cn(
        "pointer-events-auto absolute right-2 top-2 z-30 w-[min(20rem,calc(100%-1rem))] text-left",
        "overflow-hidden rounded-xl border border-white/15 bg-[#0b1220]/94 p-0",
        "shadow-[0_10px_28px_rgba(0,0,0,0.5)] backdrop-blur-md",
        "transition-[opacity,transform] duration-300 ease-out",
        visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
      )}
    >
      {/* Accent rail — matches field point chips */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          scoringLeft ? "bg-[#1e3a5f]" : "bg-[#b91c1c]",
        )}
      />

      <div className="px-3 pb-2.5 pt-2.5 pl-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            Scoring Update
          </span>
          <span
            className={cn(
              "rounded-md px-2 py-0.5 font-display text-lg font-extrabold tabular-nums leading-none",
              update.delta >= 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300",
            )}
          >
            {sign}
            {update.delta.toFixed(2)}
          </span>
        </div>

        <div className="mb-2.5 flex items-center gap-2">
          <img
            src={playerImage(update.playerId, (update.pos || "WR") as Pos, update.team)}
            alt=""
            className="size-9 shrink-0 rounded-full border border-white/30 object-cover ring-1 ring-black/40"
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{update.playerName}</p>
            <p className="truncate text-[11px] text-white/55">{update.headline}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2 py-1.5 ring-1 ring-white/10">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <MatchupTeamAvatar
              name={update.leftName}
              logo={update.leftLogo ?? null}
              platform={platform ?? null}
              cacheKey={`${leagueKey ?? "tlon"}-su-l-${update.matchupId}`}
              size="sm"
            />
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase text-white/70">
                {update.leftName}
              </p>
              <p
                className={cn(
                  "font-display text-lg font-extrabold tabular-nums leading-none text-white",
                  scoringLeft && "text-emerald-300",
                )}
              >
                {leftDisplay.toFixed(2)}
              </p>
            </div>
          </div>
          <span className="shrink-0 text-[10px] font-bold text-white/35">VS</span>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
            <div className="min-w-0 text-right">
              <p className="truncate text-[10px] font-semibold uppercase text-white/70">
                {update.rightName}
              </p>
              <p
                className={cn(
                  "font-display text-lg font-extrabold tabular-nums leading-none text-white",
                  !scoringLeft && "text-emerald-300",
                )}
              >
                {rightDisplay.toFixed(2)}
              </p>
            </div>
            <MatchupTeamAvatar
              name={update.rightName}
              logo={update.rightLogo ?? null}
              platform={platform ?? null}
              cacheKey={`${leagueKey ?? "tlon"}-su-r-${update.matchupId}`}
              size="sm"
            />
          </div>
        </div>
      </div>
    </button>
  );
}
