import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";

import { cn } from "@/lib/utils";

const TRIGGER_PX = 68;
const MAX_PULL_PX = 104;
const SETTLE_MS = 220;

type PtrState = "idle" | "pulling" | "armed" | "refreshing";

type MobilePullToRefreshProps = {
  onRefresh: () => Promise<unknown> | void;
  children: ReactNode;
  className?: string;
  /** When false, gesture is ignored (e.g. nested sheet open). */
  enabled?: boolean;
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

/**
 * Sleeper-style pull-to-refresh for /m pages: small football indicator that
 * tracks the finger, then spins while `onRefresh` resolves.
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
    try {
      await Promise.resolve(onRefreshRef.current());
    } finally {
      setPull(0);
      setState("idle");
      startY.current = null;
      tracking.current = false;
    }
  }, []);

  const onTouchStart = (e: ReactTouchEvent) => {
    if (!enabled || stateRef.current === "refreshing") return;
    if (!atScrollTop()) return;
    const t = e.touches[0];
    if (!t) return;
    startY.current = t.clientY;
    tracking.current = true;
  };

  const onTouchMove = (e: ReactTouchEvent) => {
    if (!tracking.current || startY.current == null) return;
    if (stateRef.current === "refreshing") return;
    if (!atScrollTop()) {
      reset();
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
    const eased = raw <= TRIGGER_PX ? raw : TRIGGER_PX + (raw - TRIGGER_PX) * 0.32;
    const next = Math.min(eased, MAX_PULL_PX);
    setPull(next);
    setState(next >= TRIGGER_PX ? "armed" : "pulling");
    // preventDefault is applied via the non-passive window listener below.
  };

  // React's touchmove handlers are passive — attach a real listener when pulling
  // so we can block native overscroll without console warnings.
  useEffect(() => {
    if (state !== "pulling" && state !== "armed") return;
    const block = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    window.addEventListener("touchmove", block, { passive: false });
    return () => window.removeEventListener("touchmove", block);
  }, [state]);

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
  const spinDeg = state === "refreshing" ? undefined : progress * 200;
  const indicatorOffset = Math.min(pull, TRIGGER_PX) - TRIGGER_PX;

  return (
    <div
      className={cn("relative", className)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      style={{ overscrollBehaviorY: "contain" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
        style={{
          transform: `translateY(${indicatorOffset}px)`,
          opacity:
            state === "idle" && pull < 2
              ? 0
              : Math.min(1, pull / 28 + (state === "refreshing" ? 1 : 0)),
          transition,
          paddingTop: "0.35rem",
        }}
      >
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-full border border-m-border bg-m-card shadow-sm",
            state === "armed" || state === "refreshing" ? "text-m-accent" : "text-m-muted",
          )}
          role="status"
          aria-live="polite"
          aria-label={
            state === "refreshing"
              ? "Refreshing"
              : state === "armed"
                ? "Release to refresh"
                : "Pull to refresh"
          }
        >
          <FootballGlyph
            className={cn("size-5", state === "refreshing" && !reduceMotion && "m-ptr-spin")}
            style={
              state === "refreshing" || reduceMotion
                ? undefined
                : { transform: `rotate(${spinDeg ?? 0}deg)`, transition }
            }
          />
        </span>
      </div>

      <div
        style={{
          transform:
            pull > 0 || state === "refreshing"
              ? `translateY(${Math.min(pull, TRIGGER_PX) * 0.85}px)`
              : undefined,
          transition,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function FootballGlyph({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} fill="currentColor" aria-hidden>
      <ellipse cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-35 12 12)" />
      <path
        fill="var(--m-card)"
        d="M9.2 10.1c.9-.7 2.1-1.1 2.8-.6.7.5.6 1.7-.3 2.4-.9.7-2.1 1.1-2.8.6-.7-.5-.6-1.7.3-2.4z"
        opacity="0.35"
      />
      <path
        stroke="var(--m-card)"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
        d="M10.2 9.6l3.6 4.8M11.4 8.9l1.2 1.6M13.2 13.8l1.2 1.6"
      />
    </svg>
  );
}
