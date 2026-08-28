import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { AuthDialog } from "@/components/auth/AuthDialog";
import { cn } from "@/lib/utils";

/** Minimalist lock emblem used across the un-synced ghost-state overlays. */
export function LockEmblem({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("h-7 w-7 text-black", className)}>
      <rect
        x="4.5"
        y="10.5"
        width="15"
        height="10"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M8.25 10.5V7.75a3.75 3.75 0 1 1 7.5 0v2.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15.5" r="1.15" fill="currentColor" />
    </svg>
  );
}

/** Low-opacity skeleton bars mimicking a roster list behind the alert card. */
function GhostSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div aria-hidden className="pointer-events-none select-none space-y-2 p-3 opacity-[0.35] blur-[1.5px]">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-7 w-7 shrink-0 rounded-full bg-muted-foreground/25" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div
              className="h-2.5 rounded bg-muted-foreground/25"
              style={{ width: `${58 + ((i * 13) % 34)}%` }}
            />
            <div
              className="h-2 rounded bg-muted-foreground/15"
              style={{ width: `${32 + ((i * 17) % 28)}%` }}
            />
          </div>
          <div className="h-2.5 w-8 shrink-0 rounded bg-muted-foreground/20" />
        </div>
      ))}
    </div>
  );
}

/** Floating alert card: title above the state-aware text link. */
export function SyncLockCard({
  authenticated,
  className,
  compact = false,
}: {
  authenticated: boolean;
  className?: string;
  compact?: boolean;
}) {
  const [authOpen, setAuthOpen] = useState(false);
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-border bg-card/95 text-center shadow-sm",
        compact ? "px-4 py-3" : "px-5 py-4",
        className,
      )}
    >
      <LockEmblem className={compact ? "h-6 w-6" : "h-7 w-7"} />
      <p className="font-display text-xs font-bold uppercase tracking-widest text-black">
        No Active League Sync
      </p>
      {authenticated ? (
        <Link
          to="/leaguesync"
          className="text-sm font-semibold text-black underline underline-offset-4"
        >
          Sync a League
        </Link>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="text-sm font-semibold text-black underline underline-offset-4"
          >
            Sign In to Unlock Sync
          </button>
          <AuthDialog open={authOpen} mode="signin" onOpenChange={setAuthOpen} />
        </>
      )}
    </div>
  );
}

/**
 * Wraps a league-specific sidebar: replaces its contents with a ghost skeleton
 * plus a floating alert card, without changing the parent's box dimensions.
 */
export function SyncLock({
  authenticated,
  children,
  rows = 7,
}: {
  authenticated: boolean;
  children: ReactNode;
  rows?: number;
}) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-border bg-background">
      <div aria-hidden className="pointer-events-none select-none opacity-0">
        {children}
      </div>
      <div className="absolute inset-0 overflow-hidden">
        <GhostSkeleton rows={rows} />
      </div>
      <div className="absolute inset-0 flex items-center justify-center px-4">
        <SyncLockCard authenticated={authenticated} />
      </div>
    </div>
  );
}
