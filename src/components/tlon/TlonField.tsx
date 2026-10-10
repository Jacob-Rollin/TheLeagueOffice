import { useEffect, useState } from "react";

import { playerImage } from "@/components/draft/PlayerAvatar";
import type { Pos } from "@/lib/draft";
import type { TlonPlayArc } from "@/lib/tlon-play-feed";
import { cn } from "@/lib/utils";

/** Yard markers aligned to field lines (viewBox 0–100; end zones 0–8 / 92–100). */
const YARD_MARKERS: { pct: number; label: string }[] = [
  { pct: 16.4, label: "10" },
  { pct: 24.8, label: "20" },
  { pct: 33.2, label: "30" },
  { pct: 41.6, label: "40" },
  { pct: 50, label: "50" },
  { pct: 58.4, label: "40" },
  { pct: 66.8, label: "30" },
  { pct: 75.2, label: "20" },
  { pct: 83.6, label: "10" },
];

function endZoneLabel(name: string): string {
  const cleaned = name.trim().toUpperCase();
  if (!cleaned) return "TEAM";
  if (cleaned.length <= 12) return cleaned;
  return `${cleaned.slice(0, 11)}…`;
}

/**
 * Stylized 2D field with a single approximate play arc.
 * Positions are theater from box-score + scoreboard — not GPS tracking.
 */
export function TlonField({
  arc,
  onArcDone,
  fillHeight = false,
  leftName = "Away",
  rightName = "Home",
}: {
  arc: TlonPlayArc | null;
  onArcDone?: (id: string) => void;
  /** Stretch to fill a fullscreen stage instead of a fixed aspect box. */
  fillHeight?: boolean;
  leftName?: string;
  rightName?: string;
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
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-t-2xl",
        fillHeight
          ? "h-full min-h-[12rem]"
          : "aspect-[1.65/1] min-h-[12.5rem] sm:aspect-[2.4/1] sm:min-h-0",
      )}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg,#166534 0%,#15803d 18%,#16a34a 50%,#15803d 82%,#166534 100%)",
        }}
      />

      {/* Field lines + end zones */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 50"
        preserveAspectRatio="none"
        aria-hidden
      >
        {/* End zones */}
        <rect x="0" y="0" width="8" height="50" fill="#1e3a5f" opacity="0.92" />
        <rect x="92" y="0" width="8" height="50" fill="#7f1d1d" opacity="0.92" />

        {/* Yard lines */}
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((xPos) => (
          <line
            key={xPos}
            x1={xPos}
            y1="0"
            x2={xPos}
            y2="50"
            stroke="white"
            strokeWidth={xPos === 50 ? 0.4 : 0.18}
            opacity={xPos === 50 ? 0.55 : 0.35}
          />
        ))}

        {/* Hash marks (mid-field band) */}
        {[15, 25, 35, 45, 55, 65, 75, 85].map((xPos) => (
          <g key={`hash-${xPos}`} opacity="0.28" stroke="white" strokeWidth="0.12">
            <line x1={xPos} y1="18" x2={xPos} y2="21" />
            <line x1={xPos} y1="29" x2={xPos} y2="32" />
          </g>
        ))}
      </svg>

      {/* Yard numbers — HTML so text stays readable (SVG text stretches with preserveAspectRatio=none) */}
      <div className="pointer-events-none absolute inset-0 top-[9%] sm:top-[11%]">
        {YARD_MARKERS.map((m) => (
          <span
            key={`top-${m.pct}`}
            className={cn(
              "absolute -translate-x-1/2 font-display text-[9px] font-bold tabular-nums sm:text-[11px]",
              m.label === "50" ? "text-white/70" : "text-white/50",
            )}
            style={{ left: `${m.pct}%` }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bottom-[20%] sm:bottom-[18%]">
        {YARD_MARKERS.map((m) => (
          <span
            key={`bot-${m.pct}`}
            className="absolute bottom-0 -translate-x-1/2 font-display text-[9px] font-bold tabular-nums text-white/40 sm:text-[11px]"
            style={{ left: `${m.pct}%` }}
          >
            {m.label}
          </span>
        ))}
      </div>

      {/* End zone team names */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] flex w-[8%] items-center justify-center">
        <span
          className="display-title max-w-[9rem] truncate text-center text-[9px] tracking-wider text-white/90 sm:text-[11px]"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          title={leftName}
        >
          {endZoneLabel(leftName)}
        </span>
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 z-[1] flex w-[8%] items-center justify-center">
        <span
          className="display-title max-w-[9rem] truncate text-center text-[9px] tracking-wider text-white/90 sm:text-[11px]"
          style={{ writingMode: "vertical-rl" }}
          title={rightName}
        >
          {endZoneLabel(rightName)}
        </span>
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.45)_100%)]" />

      {show && active ? (
        <>
          {active.hasSpot ? (
            <div className="pointer-events-none absolute inset-0 z-[2]">
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
