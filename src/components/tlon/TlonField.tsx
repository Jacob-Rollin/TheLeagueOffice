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
      "display-title text-center font-bold leading-none text-white/95",
      name.length > 18
        ? "text-[5.5px] tracking-[0.04em] sm:text-[8px] sm:tracking-[0.08em]"
        : name.length > 12
          ? "text-[6.5px] tracking-[0.06em] sm:text-[9px] sm:tracking-[0.1em]"
          : "text-[8px] tracking-[0.1em] sm:text-[11px] sm:tracking-[0.14em]",
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
              strokeWidth={yd === 50 ? 0.45 : 0.2}
              opacity={yd === 50 ? 0.6 : 0.38}
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

      {/* Yard numbers flush on the major lines */}
      <div className="pointer-events-none absolute inset-0 top-[8%] sm:top-[10%]">
        {MAJOR_YARDS.map((yd) => (
          <span
            key={`top-${yd}`}
            className={cn(
              "absolute -translate-x-1/2 font-display text-[9px] font-bold tabular-nums sm:text-[11px]",
              yd === 50 ? "text-white/75" : "text-white/55",
            )}
            style={{ left: `${yardToPct(yd)}%` }}
          >
            {yardLabel(yd)}
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0">
        {MAJOR_YARDS.map((yd) => (
          <span
            key={`bot-${yd}`}
            className={cn(
              "absolute bottom-[18%] -translate-x-1/2 font-display text-[9px] font-bold tabular-nums sm:bottom-[16%] sm:text-[11px]",
              yd === 50 ? "text-white/55" : "text-white/40",
            )}
            style={{ left: `${yardToPct(yd)}%` }}
          >
            {yardLabel(yd)}
          </span>
        ))}
      </div>

      {/* Midfield logo — 512×512 app icon (sharper than favicon / wide wordmark) */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1] flex h-[22%] min-h-[3.25rem] w-[22%] min-w-[3.25rem] max-h-[5.75rem] max-w-[5.75rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center sm:h-[16%] sm:w-[16%]">
        <div className="flex size-full items-center justify-center rounded-full border border-white/30 bg-black/30 p-[10%] shadow-lg shadow-black/35 backdrop-blur-[1px]">
          <img
            src="/m/icons/icon-512.png"
            alt=""
            className="size-full object-contain opacity-95"
            draggable={false}
          />
        </div>
      </div>

      {/* End zone team names — full names, no ellipsis; scale type for longer labels */}
      <div
        className="pointer-events-none absolute inset-y-[4%] left-0 z-[1] flex items-center justify-center overflow-visible"
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
        className="pointer-events-none absolute inset-y-[4%] right-0 z-[1] flex items-center justify-center overflow-visible"
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
