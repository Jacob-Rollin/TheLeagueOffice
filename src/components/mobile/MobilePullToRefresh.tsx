import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";

import { FootballIcon } from "@/components/mobile/league/mobileNavIcons";
import { cn } from "@/lib/utils";

/** Arm distance — ~2× the last shipped pull (~100px) so the cue has real travel. */
const TRIGGER_PX = 200;
const MAX_PULL_PX = 300;
const SETTLE_MS = 240;
/** Brief hold after release so refresh is visible, without feeling stuck. */
const MIN_REFRESH_VISIBLE_MS = 1800;

type PtrState = "idle" | "pulling" | "armed" | "refreshing";

type MobilePullToRefreshProps = {
  onRefresh: () => Promise<unknown> | void;
  children: ReactNode;
  className?: string;
  /** When false, gesture is ignored (e.g. nested sheet open). */
  enabled?: boolean;
};

/** Yard numbers along the field (50 at midfield, counting down each way). */
const YARD_MARKS = [10, 20, 30, 40, 50, 40, 30, 20, 10] as const;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

function atScrollTop() {
  if (typeof window === "undefined") return true;
  const docTop = document.documentElement?.scrollTop ?? 0;
  const bodyTop = document.body?.scrollTop ?? 0;
  return Math.max(window.scrollY, docTop, bodyTop) <= 1;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Pull-to-refresh for /m pages. Reveal strip shows a turf background with the
 * Matchup football icon centered (spins while refreshing). Page chrome untouched.
 */
export function MobilePullToRefresh({
  onRefresh,
  children,
  className,
  enabled = true,
}: MobilePullToRefreshProps) {
  const reduceMotion = usePrefersReducedMotion();
  const [pull, setPull] = useState(0);
  const [state, setState] = useState<PtrState>("idle");
  const startY = useRef<number | null>(null);
  const tracking = useRef(false);
  const pullRef = useRef(0);
  const stateRef = useRef<PtrState>("idle");
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    pullRef.current = pull;
  }, [pull]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const reset = useCallback(() => {
    startY.current = null;
    tracking.current = false;
    setPull(0);
    setState("idle");
  }, []);

  const runRefresh = useCallback(async () => {
    setState("refreshing");
    setPull(TRIGGER_PX);
    const started = Date.now();
    try {
      await Promise.resolve(onRefreshRef.current());
    } finally {
      const hold = reduceMotion
        ? 0
        : Math.max(0, MIN_REFRESH_VISIBLE_MS - (Date.now() - started));
      if (hold > 0) await wait(hold);
      setPull(0);
      setState("idle");
      startY.current = null;
      tracking.current = false;
    }
  }, [reduceMotion]);

  const onTouchStart = (e: ReactTouchEvent) => {
    if (!enabled || stateRef.current === "refreshing") return;
    if (!atScrollTop()) return;
    const t = e.touches[0];
    if (!t) return;
    startY.current = t.clientY;
    tracking.current = true;
  };

  const onTouchMove = () => {
    if (!tracking.current || startY.current == null) return;
    if (stateRef.current === "refreshing") return;
    if (!atScrollTop()) {
      reset();
    }
  };

  useEffect(() => {
    if (!enabled) return;

    const onMove = (e: TouchEvent) => {
      if (!tracking.current || startY.current == null) return;
      if (stateRef.current === "refreshing") return;
      if (!atScrollTop()) {
        startY.current = null;
        tracking.current = false;
        setPull(0);
        setState("idle");
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      const raw = t.clientY - startY.current;
      if (raw <= 0) {
        setPull(0);
        setState("idle");
        return;
      }
      const eased = raw <= TRIGGER_PX ? raw : TRIGGER_PX + (raw - TRIGGER_PX) * 0.28;
      const next = Math.min(eased, MAX_PULL_PX);
      setPull(next);
      setState(next >= TRIGGER_PX ? "armed" : "pulling");
      if (next > 6 && e.cancelable) e.preventDefault();
    };

    window.addEventListener("touchmove", onMove, { passive: false });
    return () => window.removeEventListener("touchmove", onMove);
  }, [enabled]);

  const onTouchEnd = () => {
    if (!tracking.current) return;
    const armed = pullRef.current >= TRIGGER_PX && stateRef.current !== "refreshing";
    tracking.current = false;
    startY.current = null;
    if (armed) {
      void runRefresh();
    } else {
      setPull(0);
      setState("idle");
    }
  };

  const dragging = state === "pulling" || state === "armed";
  const transition =
    dragging || reduceMotion || state === "refreshing"
      ? "none"
      : `transform ${SETTLE_MS}ms cubic-bezier(0.23, 1, 0.32, 1), opacity ${SETTLE_MS}ms ease`;
  const progress = Math.min(1, pull / TRIGGER_PX);
  const refreshing = state === "refreshing";
  /** Visible reveal height — tracks pull so the football stays centered in the strip. */
  const revealH = Math.min(pull, TRIGGER_PX) * 0.92;
  const showReveal = refreshing || pull > 2;
  const spinDeg = refreshing ? undefined : progress * 360;

  return (
    <div
      className={cn("relative", className)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      style={{ overscrollBehaviorY: "none" }}
    >
      {/* Reveal strip only — grey field with proper yard lines; does not paint the page. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 overflow-hidden"
        style={{
          height: showReveal ? revealH : 0,
          backgroundColor: "var(--m-bg)",
          transition,
        }}
        aria-hidden={!showReveal}
      >
        <PtrFieldBackdrop showNumbers={revealH > 72} />
        <div className="relative z-[1] flex h-full items-center justify-center">
          <span
            className={cn(
              "flex size-11 items-center justify-center rounded-full bg-white/95 text-m-header shadow-md ring-1 ring-black/10",
              (state === "armed" || refreshing) && "text-m-accent ring-m-accent/30",
            )}
            role="status"
            aria-live="polite"
            aria-label={
              refreshing
                ? "Refreshing"
                : state === "armed"
                  ? "Release to refresh"
                  : "Pull to refresh"
            }
            style={{
              opacity: showReveal ? Math.min(1, progress * 3 + (refreshing ? 1 : 0)) : 0,
              transition,
            }}
          >
            <FootballIcon
              className={cn("size-7", refreshing && !reduceMotion && "m-ptr-spin")}
              strokeWidth={2.25}
              style={
                refreshing || reduceMotion
                  ? undefined
                  : { transform: `rotate(${spinDeg ?? 0}deg)`, transition }
              }
            />
          </span>
        </div>
      </div>

      <div
        style={{
          transform: pull > 0 || refreshing ? `translateY(${revealH}px)` : undefined,
          transition,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Top-down field: end zones, 10-yard lines, hash ticks, and yard numbers
 * in theme accent blue on the grey pull reveal.
 */
function PtrFieldBackdrop({ showNumbers }: { showNumbers: boolean }) {
  return (
    <div className="absolute inset-0 text-m-accent">
      {/* Soft end-zone washes */}
      <div className="absolute inset-y-0 left-0 w-[8%] bg-m-accent/10" aria-hidden />
      <div className="absolute inset-y-0 right-0 w-[8%] bg-m-accent/10" aria-hidden />

      {/* Sidelines */}
      <div className="absolute inset-x-[2%] top-[10%] h-px bg-m-accent/50" aria-hidden />
      <div className="absolute inset-x-[2%] bottom-[10%] h-px bg-m-accent/50" aria-hidden />

      {/* Goal lines */}
      <div className="absolute inset-y-[10%] left-[8%] w-[2px] bg-m-accent/55" aria-hidden />
      <div className="absolute inset-y-[10%] right-[8%] w-[2px] bg-m-accent/55" aria-hidden />

      {/* Every-10-yard lines across the playing field between goal lines */}
      {Array.from({ length: 9 }, (_, i) => {
        const pct = 8 + ((i + 1) * 84) / 10;
        const isFifty = i === 4;
        return (
          <div
            key={`yl-${i}`}
            className={cn(
              "absolute inset-y-[10%]",
              isFifty ? "w-[2.5px] bg-m-accent/70" : "w-px bg-m-accent/40",
            )}
            style={{ left: `${pct}%` }}
            aria-hidden
          />
        );
      })}

      {/* Hash marks — short ticks between each 10-yard segment */}
      {Array.from({ length: 10 }, (_, segment) =>
        [1, 2, 3, 4].map((tick) => {
          const pct = 8 + (segment * 84) / 10 + (tick * 84) / 50;
          return (
            <span key={`h-${segment}-${tick}`} aria-hidden>
              <span
                className="absolute h-[9%] w-px bg-m-accent/35"
                style={{ left: `${pct}%`, top: "28%" }}
              />
              <span
                className="absolute h-[9%] w-px bg-m-accent/35"
                style={{ left: `${pct}%`, bottom: "28%" }}
              />
            </span>
          );
        }),
      )}

      {showNumbers ? (
        <div className="absolute inset-x-[8%] bottom-[14%] flex justify-between px-[4%]">
          {YARD_MARKS.map((n, i) => (
            <span
              key={`yn-${i}`}
              className={cn(
                "font-display text-[9px] font-bold leading-none tracking-wider tabular-nums",
                n === 50 ? "text-m-accent/70" : "text-m-accent/45",
              )}
            >
              {n}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
