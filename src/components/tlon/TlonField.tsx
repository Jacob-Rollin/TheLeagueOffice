import { useEffect, useState } from "react";

import { playerImage } from "@/components/draft/PlayerAvatar";
import type { Pos } from "@/lib/draft";
import type { TlonPlayArc } from "@/lib/tlon-play-feed";
import { cn } from "@/lib/utils";

/**
 * Stylized 2D field with a single approximate play arc.
 * Positions are theater from box-score + scoreboard — not GPS tracking.
 */
export function TlonField({
  arc,
  onArcDone,
}: {
  arc: TlonPlayArc | null;
  onArcDone?: (id: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "run" | "hold">("idle");
  const [active, setActive] = useState<TlonPlayArc | null>(null);

  useEffect(() => {
    if (!arc) return;
    setActive(arc);
    setPhase("idle");
    const t0 = window.setTimeout(() => setPhase("run"), 50);
    const t1 = window.setTimeout(() => setPhase("hold"), 950);
    const t2 = window.setTimeout(() => {
      setPhase("idle");
      setActive(null);
      onArcDone?.(arc.id);
    }, 2900);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // Drive animation from arc identity only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arc?.id]);

  const start = active?.hasSpot ? active.startPct : 44;
  const end = active?.hasSpot ? active.endPct : 56;
  const atEnd = phase === "run" || phase === "hold";
  const x = active ? (atEnd ? end : start) : 50;
  const show = Boolean(active);

  return (
    <div className="relative aspect-[2.2/1] w-full overflow-hidden rounded-t-2xl sm:aspect-[2.6/1]">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg,#166534 0%,#15803d 18%,#16a34a 50%,#15803d 82%,#166534 100%)",
        }}
      />
      <svg className="absolute inset-0 h-full w-full opacity-40" viewBox="0 0 100 50" preserveAspectRatio="none">
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((xPos) => (
          <line key={xPos} x1={xPos} y1="0" x2={xPos} y2="50" stroke="white" strokeWidth="0.15" />
        ))}
        <line x1="50" y1="0" x2="50" y2="50" stroke="white" strokeWidth="0.35" />
        <rect x="0" y="0" width="8" height="50" fill="#1e3a5f" opacity="0.85" />
        <rect x="92" y="0" width="8" height="50" fill="#7f1d1d" opacity="0.85" />
      </svg>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.45)_100%)]" />

      {show && active ? (
        <>
          {active.hasSpot ? (
            <div className="pointer-events-none absolute inset-0">
              <div
                className="absolute top-[52%] h-[3px] -translate-y-1/2 rounded-full bg-white/85 shadow"
                style={{
                  left: `${Math.min(start, end)}%`,
                  width: atEnd ? `${Math.abs(end - start)}%` : "0%",
                  transition: "width 700ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />
              <div
                className="absolute top-[52%] size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80"
                style={{ left: `${start}%` }}
              />
            </div>
          ) : null}

          <div
            className={cn(
              "absolute top-[42%] z-10 -translate-x-1/2 -translate-y-1/2 will-change-transform",
              "transition-[left,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
              phase === "hold" && "scale-110",
            )}
            style={{ left: `${x}%` }}
          >
            <div className="relative">
              <img
                src={playerImage(active.playerId, (active.pos || "WR") as Pos, active.team)}
                alt=""
                className="size-10 rounded-full border-2 border-white object-cover shadow-lg shadow-black/40 sm:size-12"
                onError={(e) => {
                  e.currentTarget.style.visibility = "hidden";
                }}
              />
              <div className="absolute -bottom-6 left-1/2 w-max max-w-[10rem] -translate-x-1/2 rounded-md bg-black/75 px-1.5 py-0.5 text-center text-[10px] font-semibold text-white shadow">
                <span className="block truncate">{active.playerName}</span>
                <span className="text-emerald-300">
                  {active.yardGain > 0 ? `+${active.yardGain} yd` : active.headline} ·{" "}
                  {active.delta >= 0 ? "+" : ""}
                  {active.delta.toFixed(1)}
                </span>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
