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

/** Simple turf + yard lines — only paints the pull reveal strip, not the page. */
const FIELD_BG =
  "linear-gradient(90deg, rgba(255,255,255,0.14) 0 1px, transparent 1px 100%)," +
  "linear-gradient(90deg, transparent 0 49.5%, rgba(255,255,255,0.35) 49.5% 50.5%, transparent 50.5% 100%)," +
  "linear-gradient(180deg, #1f6b3a 0%, #2a8a4a 40%, #247a42 60%, #1a5c32 100%)";

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
      {/* Reveal strip only — turf + yard lines; does not paint the page body. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center overflow-hidden"
        style={{
          height: showReveal ? revealH : 0,
          backgroundImage: FIELD_BG,
          backgroundSize: "28px 100%, 100% 100%, 100% 100%",
          backgroundPosition: "center, center, center",
          transition,
        }}
        aria-hidden={!showReveal}
      >
        <span
          className={cn(
            "flex size-11 items-center justify-center rounded-full bg-white/95 text-m-header shadow-md ring-1 ring-black/10",
            (state === "armed" || refreshing) && "text-m-accent ring-m-accent/30",
          )}
          role="status"
          aria-live="polite"
          aria-label={
            refreshing ? "Refreshing" : state === "armed" ? "Release to refresh" : "Pull to refresh"
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
