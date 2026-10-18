import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";

import { cn } from "@/lib/utils";

/** Pull distance required to arm refresh (slightly longer for a clearer cue). */
const TRIGGER_PX = 100;
const MAX_PULL_PX = 148;
const SETTLE_MS = 280;
/** Keep the spinner visible so users see refresh working before snap-back. */
const MIN_REFRESH_VISIBLE_MS = 3500;
/** Circumference of the 36px viewBox ring (r=14). */
const RING_C = 2 * Math.PI * 14;

type PtrState = "idle" | "pulling" | "armed" | "refreshing";

type MobilePullToRefreshProps = {
  onRefresh: () => Promise<unknown> | void;
  children: ReactNode;
  className?: string;
  /** When false, gesture is ignored (e.g. nested sheet open). */
  enabled?: boolean;
  /**
   * Fill color behind content while pulling (defaults to header blue so Team
   * hero pages do not flash grey). Override with a CSS color / token.
   */
  revealColor?: string;
};

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
 * Pull-to-refresh for /m pages. Content below the fixed header translates;
 * a circular progress ring fills on pull, then spins for at least ~3.5s.
 */
export function MobilePullToRefresh({
  onRefresh,
  children,
  className,
  enabled = true,
  revealColor = "var(--m-header)",
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
  const indicatorTravel = Math.min(pull, TRIGGER_PX);
  const refreshing = state === "refreshing";
  const showIndicator = refreshing || pull > 2;
  const contentShift = Math.min(pull, TRIGGER_PX) * 0.92;

  return (
    <div
      className={cn("relative", className)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      style={{
        overscrollBehaviorY: "none",
        // Slot behind translating content — header blue avoids the grey seam on Team.
        backgroundColor: revealColor,
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
        style={{
          height: TRIGGER_PX,
          transform: `translateY(${showIndicator ? indicatorTravel - TRIGGER_PX : -TRIGGER_PX}px)`,
          opacity: showIndicator ? Math.min(1, progress * 1.15 + (refreshing ? 1 : 0)) : 0,
          transition,
        }}
      >
        <span
          className={cn(
            "mt-3 flex size-11 items-center justify-center rounded-full border bg-m-card shadow-md",
            state === "armed" || refreshing
              ? "border-m-accent text-m-accent"
              : "border-m-border text-m-muted",
          )}
          role="status"
          aria-live="polite"
          aria-label={
            refreshing ? "Refreshing" : state === "armed" ? "Release to refresh" : "Pull to refresh"
          }
        >
          <RefreshRing progress={progress} spinning={refreshing && !reduceMotion} />
        </span>
      </div>

      <div
        style={{
          transform: pull > 0 || refreshing ? `translateY(${contentShift}px)` : undefined,
          transition,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Circular progress that fills on pull, then spins as a loader while refreshing. */
function RefreshRing({ progress, spinning }: { progress: number; spinning: boolean }) {
  const dash = Math.max(0.08, progress) * RING_C;
  return (
    <svg viewBox="0 0 36 36" className={cn("size-7", spinning && "m-ptr-spin")} aria-hidden>
      <circle
        cx="18"
        cy="18"
        r="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.2"
      />
      <circle
        cx="18"
        cy="18"
        r="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={spinning ? `${RING_C * 0.72} ${RING_C}` : `${dash} ${RING_C}`}
        transform="rotate(-90 18 18)"
      />
    </svg>
  );
}
