import { useEffect, useState } from "react";

import { playerImage } from "@/components/draft/PlayerAvatar";
import type { Pos } from "@/lib/draft";
import type { TlonPlayArc } from "@/lib/tlon-play-feed";
import { cn } from "@/lib/utils";

/** End-zone width in % of the full graphic (each side). */
const EZ = 8;
const PLAYABLE = 100 - EZ * 2;

/** Map yards from the left goal line (0–100) onto the playable field. */
function yardToPct(yardsFromLeftGoal: number): number {
  return EZ + (yardsFromLeftGoal / 100) * PLAYABLE;
}

/** Major yard lines + labels (mirrored after midfield). */
const MAJOR_YARDS = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;

function yardLabel(yardsFromLeftGoal: number): string {
  const fromNear = Math.min(yardsFromLeftGoal, 100 - yardsFromLeftGoal);
  return String(fromNear);
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

  // Arc spots are yard lines (0–100 from left goal); map onto playable grass.
  const start = active?.hasSpot ? yardToPct(active.startPct) : 44;
  const end = active?.hasSpot ? yardToPct(active.endPct) : 56;
  const atEnd = phase === "run" || phase === "hold";
  const x = active ? (atEnd ? end : start) : 50;
  const show = Boolean(active);

  const leftEndZone = (leftName || "Away").trim().toUpperCase() || "AWAY";
  const rightEndZone = (rightName || "Home").trim().toUpperCase() || "HOME";
  const endZoneTextClass = (name: string) =>
    cn(
      "display-title text-center font-extrabold leading-[1.05] text-white",
      name.length > 18
        ? "text-[12px] tracking-[0.04em] sm:text-[15px] sm:tracking-[0.08em]"
        : name.length > 12
          ? "text-[14px] tracking-[0.06em] sm:text-[18px] sm:tracking-[0.1em]"
          : "text-[16px] tracking-[0.1em] sm:text-[22px] sm:tracking-[0.14em]",
    );

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

      {/* Field lines + end zones — same coordinate system as yard numbers */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 50"
        preserveAspectRatio="none"
        aria-hidden
      >
        {/* Alternating 5-yard grass bands (playable field only) */}
        {Array.from({ length: 20 }, (_, i) => {
          const yd0 = i * 5;
          const x = yardToPct(yd0);
          const w = yardToPct(yd0 + 5) - x;
          return (
            <rect
              key={`band-${yd0}`}
              x={x}
              y="0"
              width={w}
              height="50"
              fill={i % 2 === 0 ? "#15803d" : "#16a34a"}
              opacity="0.55"
            />
          );
        })}

        <rect x="0" y="0" width={EZ} height="50" fill="#1e3a5f" opacity="0.92" />
        <rect x={100 - EZ} y="0" width={EZ} height="50" fill="#7f1d1d" opacity="0.92" />

        {/* Goal lines */}
        <line
          x1={EZ}
          y1="0"
          x2={EZ}
          y2="50"
          stroke="white"
          strokeWidth="0.35"
          opacity="0.55"
        />
        <line
          x1={100 - EZ}
          y1="0"
          x2={100 - EZ}
          y2="50"
          stroke="white"
          strokeWidth="0.35"
          opacity="0.55"
        />

        {MAJOR_YARDS.map((yd) => {
          const xPos = yardToPct(yd);
          return (
            <line
              key={yd}
              x1={xPos}
              y1="0"
              x2={xPos}
              y2="50"
              stroke="white"
              strokeWidth={yd === 50 ? 0.45 : 0.22}
              opacity={yd === 50 ? 0.7 : 0.45}
            />
          );
        })}

        {/* 5-yard lines between majors */}
        {[5, 15, 25, 35, 45, 55, 65, 75, 85, 95].map((yd) => {
          const xPos = yardToPct(yd);
          return (
            <line
              key={`five-${yd}`}
              x1={xPos}
              y1="0"
              x2={xPos}
              y2="50"
              stroke="white"
              strokeWidth="0.12"
              opacity="0.22"
            />
          );
        })}

        {/* Hash marks on every yard between the hashes band */}
        {Array.from({ length: 99 }, (_, i) => i + 1)
          .filter((yd) => yd % 5 !== 0)
          .map((yd) => {
            const xPos = yardToPct(yd);
            return (
              <g key={`hash-${yd}`} opacity="0.3" stroke="white" strokeWidth="0.1">
                <line x1={xPos} y1="19" x2={xPos} y2="21.2" />
                <line x1={xPos} y1="28.8" x2={xPos} y2="31" />
              </g>
            );
          })}
      </svg>

      {/*
        Yard numbers split the line (e.g. 5 | 0) for readability — HTML so text
        does not stretch with preserveAspectRatio=none.
      */}
      <div className="pointer-events-none absolute inset-0">
        {MAJOR_YARDS.map((yd) => {
          const left = `${yardToPct(yd)}%`;
          const label = yardLabel(yd);
          const [tens = "", ones = ""] = label.split("");
          const tone = yd === 50 ? "text-white/85" : "text-white/65";
          const botTone = yd === 50 ? "text-white/60" : "text-white/45";
          const digit =
            "absolute top-1/2 -translate-y-1/2 font-display text-[9px] font-bold leading-none tabular-nums sm:text-[11px]";
          return (
            <span key={`yd-${yd}`}>
              {/* Zero-width anchors on the yard line; digits sit left/right of it */}
              <span className="absolute top-[8%] h-3 w-0 sm:top-[10%]" style={{ left }}>
                <span className={cn(digit, "right-[2px]", tone)}>{tens}</span>
                <span className={cn(digit, "left-[2px]", tone)}>{ones}</span>
              </span>
              <span className="absolute bottom-[16%] h-3 w-0 sm:bottom-[14%]" style={{ left }}>
                <span className={cn(digit, "right-[2px]", botTone)}>{tens}</span>
                <span className={cn(digit, "left-[2px]", botTone)}>{ones}</span>
              </span>
            </span>
          );
        })}
      </div>

      {/* Midfield mark — transparent football logo only (no plate / ring) */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1] h-[16%] min-h-[2.5rem] w-[22%] min-w-[3.5rem] max-h-[4.5rem] max-w-[7rem] -translate-x-1/2 -translate-y-1/2 sm:h-[12%] sm:w-[16%]">
        <img
          src="/m/icons/league-mark-field.png"
          alt=""
          className="size-full object-contain drop-shadow-[0_1px_3px_rgba(0,0,0,0.75)]"
          draggable={false}
        />
      </div>

      {/* End zone team names — larger type to fill the end zone */}
      <div
        className="pointer-events-none absolute inset-y-[1%] left-0 z-[1] flex items-center justify-center overflow-visible px-[2%]"
        style={{ width: `${EZ}%` }}
      >
        <span
          className={endZoneTextClass(leftEndZone)}
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
          }}
          title={leftEndZone}
        >
          {leftEndZone}
        </span>
      </div>
      <div
        className="pointer-events-none absolute inset-y-[1%] right-0 z-[1] flex items-center justify-center overflow-visible px-[2%]"
        style={{ width: `${EZ}%` }}
      >
        <span
          className={endZoneTextClass(rightEndZone)}
          style={{ writingMode: "vertical-rl" }}
          title={rightEndZone}
        >
          {rightEndZone}
        </span>
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.4)_100%)]" />

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
