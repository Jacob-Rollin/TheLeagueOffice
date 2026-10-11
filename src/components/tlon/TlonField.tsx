import { cn } from "@/lib/utils";

/** End-zone width in % of the full graphic (each side). */
const EZ = 8;
const PLAYABLE = 100 - EZ * 2;
/** White end-board width in viewBox units (% of field width). */
const END_BOARD = 2.15;
/** Sideline chalk thickness in viewBox units (filled rects so corners stay solid). */
const SIDE_W = 1.55;

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
 * Top-down goalposts seated entirely in the white end board.
 * Equal uprights (true plan view); crossbar + stem stay on the chalk.
 */
function GoalPost({ side, large }: { side: "left" | "right"; large?: boolean }) {
  const left = side === "left";
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-1/2 z-[5] -translate-y-1/2",
        large
          ? "h-[min(42%,9.5rem)] min-h-[4.5rem]"
          : "h-[min(34%,6.5rem)] min-h-12 sm:h-[min(36%,7.25rem)]",
      )}
      style={
        left
          ? { left: "0%", width: `${END_BOARD}%` }
          : { right: "0%", width: `${END_BOARD}%` }
      }
      aria-hidden
    >
      <svg
        viewBox="0 0 24 64"
        className="h-full w-full drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
        preserveAspectRatio="xMidYMid meet"
      >
        <g
          stroke="#fde047"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          {left ? (
            <>
              {/* Crossbar centered on white board */}
              <line x1="13" y1="14" x2="13" y2="50" strokeWidth="2.6" />
              {/* Equal uprights — away from field */}
              <line x1="13" y1="14" x2="3" y2="14" strokeWidth="2.4" />
              <line x1="13" y1="50" x2="3" y2="50" strokeWidth="2.4" />
              {/* Stem toward field, still on chalk */}
              <line x1="13" y1="32" x2="20" y2="32" strokeWidth="2.4" />
            </>
          ) : (
            <>
              <line x1="11" y1="14" x2="11" y2="50" strokeWidth="2.6" />
              <line x1="11" y1="14" x2="21" y2="14" strokeWidth="2.4" />
              <line x1="11" y1="50" x2="21" y2="50" strokeWidth="2.4" />
              <line x1="11" y1="32" x2="4" y2="32" strokeWidth="2.4" />
            </>
          )}
        </g>
      </svg>
    </div>
  );
}

/**
 * Stylized 2D field stage. Point adjustments render beside the field
 * (see TlonPointPopups) — yardToPct stays available for any future overlays.
 */
export function TlonField({
  fillHeight = false,
  leftName = "Away",
  rightName = "Home",
}: {
  /** Stretch to fill a fullscreen stage instead of a fixed aspect box. */
  fillHeight?: boolean;
  leftName?: string;
  rightName?: string;
}) {
  const leftEndZone = (leftName || "Away").trim().toUpperCase() || "AWAY";
  const rightEndZone = (rightName || "Home").trim().toUpperCase() || "HOME";
  const endZoneTextClass = (name: string) =>
    cn(
      "display-title text-center font-extrabold leading-[1.05] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]",
      fillHeight
        ? name.length > 18
          ? "text-[clamp(0.85rem,2.1vmin,1.35rem)] tracking-[0.05em]"
          : name.length > 12
            ? "text-[clamp(1rem,2.45vmin,1.55rem)] tracking-[0.08em]"
            : "text-[clamp(1.15rem,2.9vmin,1.85rem)] tracking-[0.12em]"
        : name.length > 18
          ? "text-[12px] tracking-[0.04em] sm:text-[15px] sm:tracking-[0.08em] lg:text-[17px]"
          : name.length > 12
            ? "text-[14px] tracking-[0.06em] sm:text-[18px] sm:tracking-[0.1em] lg:text-[20px]"
            : "text-[16px] tracking-[0.1em] sm:text-[22px] sm:tracking-[0.14em] lg:text-[24px]",
    );

  const yardDigitClass = cn(
    "absolute top-1/2 -translate-y-1/2 font-display font-bold leading-none tabular-nums",
    fillHeight
      ? "text-[clamp(0.7rem,1.55vmin,1.15rem)]"
      : "text-[9px] sm:text-[11px] lg:text-[13px]",
  );

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-t-2xl bg-[#0b1220]",
        fillHeight
          ? "h-full min-h-[12rem]"
          : "aspect-[1.65/1] min-h-[12.5rem] sm:aspect-[2.4/1] sm:min-h-0",
      )}
    >
      {/*
        Field slab — same flat coordinate system as before. Depth is rim +
        lighting only (no perspective transform), so arcs/yard % stay correct.
      */}
      <div className="absolute inset-x-0 top-0 bottom-[4%] overflow-hidden rounded-t-2xl shadow-[0_10px_28px_rgba(0,0,0,0.45)]">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg,#166534 0%,#15803d 18%,#16a34a 50%,#15803d 82%,#166534 100%)",
          }}
        />

        {/* Turf paint + yard lines — under the depth wash */}
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

          {/* Painted end zones — leave room for the white end boards */}
          <rect
            x={END_BOARD}
            y="0"
            width={EZ - END_BOARD}
            height="50"
            fill="#1e3a5f"
          />
          <rect
            x={100 - EZ}
            y="0"
            width={EZ - END_BOARD}
            height="50"
            fill="#7f1d1d"
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

        {/* Depth lighting — grass only; solid white boards/sidelines paint above */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.28)_0%,transparent_22%,transparent_72%,rgba(0,0,0,0.22)_100%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_42%,rgba(0,0,0,0.38)_100%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-white/15"
        />

        {/*
          Solid chalk frame — filled rects (not stroked lines) so corners meet
          with no green leaks. Above the dim overlays so white stays opaque.
        */}
        <svg
          className="pointer-events-none absolute inset-0 z-[2] h-full w-full"
          viewBox="0 0 100 50"
          preserveAspectRatio="none"
          aria-hidden
        >
          {/* Sidelines */}
          <rect x="0" y="0" width="100" height={SIDE_W} fill="#ffffff" />
          <rect x="0" y={50 - SIDE_W} width="100" height={SIDE_W} fill="#ffffff" />
          {/* End boards (back of each end zone) — goalposts sit here */}
          <rect x="0" y="0" width={END_BOARD} height="50" fill="#ffffff" />
          <rect x={100 - END_BOARD} y="0" width={END_BOARD} height="50" fill="#ffffff" />

          {/* Goal lines */}
          <rect x={EZ - 0.28} y="0" width="0.55" height="50" fill="#ffffff" />
          <rect x={100 - EZ - 0.28} y="0" width="0.55" height="50" fill="#ffffff" />
        </svg>

        {/*
          Yard numbers split the line (e.g. 5 | 0) for readability — HTML so text
          does not stretch with preserveAspectRatio=none.
        */}
        <div className="pointer-events-none absolute inset-0 z-[3]">
          {MAJOR_YARDS.map((yd) => {
            const left = `${yardToPct(yd)}%`;
            const label = yardLabel(yd);
            const [tens = "", ones = ""] = label.split("");
            const tone = yd === 50 ? "text-white/90" : "text-white/75";
            const botTone = yd === 50 ? "text-white/70" : "text-white/55";
            return (
              <span key={`yd-${yd}`}>
                {/* Zero-width anchors on the yard line; digits sit left/right of it */}
                <span
                  className={cn(
                    "absolute w-0",
                    fillHeight ? "top-[9%] h-4" : "top-[8%] h-3 sm:top-[10%]",
                  )}
                  style={{ left }}
                >
                  <span className={cn(yardDigitClass, "right-[2px]", tone)}>{tens}</span>
                  <span className={cn(yardDigitClass, "left-[2px]", tone)}>{ones}</span>
                </span>
                <span
                  className={cn(
                    "absolute w-0",
                    fillHeight ? "bottom-[15%] h-4" : "bottom-[16%] h-3 sm:bottom-[14%]",
                  )}
                  style={{ left }}
                >
                  <span className={cn(yardDigitClass, "right-[2px]", botTone)}>{tens}</span>
                  <span className={cn(yardDigitClass, "left-[2px]", botTone)}>{ones}</span>
                </span>
              </span>
            );
          })}
        </div>

        {/* Midfield mark — scales with stage; no hard max that freezes on large screens */}
        <div
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 z-[3] -translate-x-1/2 -translate-y-1/2",
            fillHeight
              ? "h-[min(28%,11rem)] w-[min(20%,14rem)] min-h-[4rem] min-w-[5rem]"
              : "h-[16%] min-h-[2.5rem] w-[22%] min-w-[3.5rem] max-h-[5.5rem] max-w-[8.5rem] sm:h-[14%] sm:w-[18%] lg:max-h-[6.5rem] lg:max-w-[10rem]",
          )}
        >
          <img
            src="/m/icons/league-mark-field.png"
            alt=""
            className="size-full object-contain drop-shadow-[0_1px_3px_rgba(0,0,0,0.75)]"
            draggable={false}
          />
        </div>

        {/*
          End zone team names — centered in the painted EZ (not on the white
          end board at the back).
        */}
        <div
          className="pointer-events-none absolute inset-y-[1%] z-[4] flex items-center justify-center overflow-visible"
          style={{ left: `${END_BOARD}%`, width: `${EZ - END_BOARD}%` }}
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
          className="pointer-events-none absolute inset-y-[1%] z-[4] flex items-center justify-center overflow-visible"
          style={{ right: `${END_BOARD}%`, width: `${EZ - END_BOARD}%` }}
        >
          <span
            className={endZoneTextClass(rightEndZone)}
            style={{ writingMode: "vertical-rl" }}
            title={rightEndZone}
          >
            {rightEndZone}
          </span>
        </div>

        <GoalPost side="left" large={fillHeight} />
        <GoalPost side="right" large={fillHeight} />
      </div>

      {/* Front slab edge — sells thickness without skewing the field plane */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[4%] bg-[linear-gradient(180deg,#14532d_0%,#052e16_55%,#022c22_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[2%] bottom-[1%] h-[2px] rounded-full bg-black/35 blur-[1px]"
      />
    </div>
  );
}
