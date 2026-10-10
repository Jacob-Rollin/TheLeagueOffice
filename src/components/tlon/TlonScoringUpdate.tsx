import { useEffect, useState } from "react";

import { MatchupTeamAvatar } from "@/components/playbook/MatchupPreviewCard";
import type { TlonScoringUpdate } from "@/lib/tlon-play-feed";
import { cn } from "@/lib/utils";

function useCountUp(from: number, to: number, active: boolean, ms = 900): number {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (!active) {
      setValue(from);
      return;
    }
    setValue(from);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // ease-out cubic — smooth, no snap at the end
      const eased = 1 - (1 - t) ** 3;
      setValue(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setValue(to);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, active, ms]);
  return value;
}

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
  const active = Boolean(update);

  useEffect(() => {
    if (!update) {
      setVisible(false);
      return;
    }
    setVisible(false);
    const enter = window.setTimeout(() => setVisible(true), 20);
    const leave = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(() => onDone?.(), 320);
    }, 6500);
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

  return (
    <button
      type="button"
      onClick={() => onSelect?.(update.matchupId)}
      className={cn(
        "pointer-events-auto absolute right-2 top-2 z-30 w-[min(18rem,calc(100%-1rem))] text-left",
        "rounded-xl border border-white/20 bg-zinc-950/90 p-2.5 shadow-xl shadow-black/50 backdrop-blur-md",
        "transition-[opacity,transform] duration-300 ease-out",
        visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
          Scoring Update
        </span>
        <span className="font-display text-lg font-extrabold tabular-nums text-emerald-400">
          +{update.delta.toFixed(1)}
        </span>
      </div>
      <p className="truncate text-xs font-semibold text-white">
        {update.playerName}{" "}
        <span className="font-normal text-white/60">· {update.headline}</span>
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <MatchupTeamAvatar
            name={update.leftName}
            logo={update.leftLogo ?? null}
            platform={platform ?? null}
            cacheKey={`${leagueKey ?? "tlon"}-su-l-${update.matchupId}`}
            size="sm"
          />
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase text-white/70">{update.leftName}</p>
            <p
              className={cn(
                "font-display text-xl font-extrabold tabular-nums leading-none text-white",
                scoringLeft && "text-emerald-300",
              )}
            >
              {leftDisplay.toFixed(1)}
            </p>
          </div>
        </div>
        <span className="text-[10px] font-bold text-white/40">VS</span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <div className="min-w-0 text-right">
            <p className="truncate text-[10px] font-semibold uppercase text-white/70">{update.rightName}</p>
            <p
              className={cn(
                "font-display text-xl font-extrabold tabular-nums leading-none text-white",
                !scoringLeft && "text-emerald-300",
              )}
            >
              {rightDisplay.toFixed(1)}
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
    </button>
  );
}
