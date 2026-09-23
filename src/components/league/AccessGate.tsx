import { Link } from "@tanstack/react-router";
import { Check, Lock } from "lucide-react";
import { useState } from "react";

import { AuthDialog, type AuthMode } from "@/components/auth/AuthDialog";
import { cn } from "@/lib/utils";

export type AccessGateKind = "guest" | "sync";

type Feature = { title: string; desc: string };

const DEFAULT_FEATURES: Record<AccessGateKind, Feature[]> = {
  guest: [
    {
      title: "Sync your league",
      desc: "Pull live rosters, standings, and matchups from Sleeper or ESPN into one front office.",
    },
    {
      title: "Grade every trade",
      desc: "Model roster impact instantly so you never ship away your edge.",
    },
    {
      title: "Own the waiver wire",
      desc: "See ranked free-agent targets, trends, and schedule advantages before your league mates.",
    },
    {
      title: "Run the week",
      desc: "Matchup boards, projections, and Press Room intel stay tied to your active league.",
    },
  ],
  sync: [
    {
      title: "Live league data",
      desc: "Standings, rosters, and transactions refresh from your host platform automatically.",
    },
    {
      title: "Personalized tools",
      desc: "Trade Desk, The Wire, and Playbook all load against your real roster context.",
    },
    {
      title: "Matchup command",
      desc: "Track win probability, projections, and lineup decisions for the current week.",
    },
    {
      title: "Front office feed",
      desc: "Press Room awards and activity stay grounded in your league’s actual results.",
    },
  ],
};

type AccessGateProps = {
  kind: AccessGateKind;
  /** Short tool label next to the lock, e.g. Playbook */
  product: string;
  headline: string;
  description: string;
  features?: Feature[];
  /** Compact sidebar/card layout without the full marketing stack */
  compact?: boolean;
  /** Override sync CTA destination (defaults to /leaguesync). */
  syncTo?: "/leaguesync" | "/account/leagues";
  syncLabel?: string;
  className?: string;
};

/** FantasyPros-style unlock panel using League Office light/blue styling. */
export function AccessGate({
  kind,
  product,
  headline,
  description,
  features,
  compact = false,
  syncTo = "/leaguesync",
  syncLabel = "Sync Your League",
  className,
}: AccessGateProps) {
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const featureList = features ?? DEFAULT_FEATURES[kind];

  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  if (compact) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border border-border/80 bg-card px-4 py-10 text-center",
          className,
        )}
      >
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">
          <Lock className="size-4" aria-hidden="true" />
        </span>
        <h2 className="display-title text-xl uppercase tracking-wide text-zinc-950">{product}</h2>
        <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
        {kind === "guest" ? (
          <button
            type="button"
            onClick={() => openAuth("signup")}
            className="mt-1 inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Create Account
          </button>
        ) : (
          <Link
            to={syncTo}
            className="mt-1 inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            {syncLabel}
          </Link>
        )}
        {kind === "guest" ? (
          <button
            type="button"
            onClick={() => openAuth("signin")}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Sign in
          </button>
        ) : null}
        <AuthDialog open={authOpen} mode={authMode} onOpenChange={setAuthOpen} />
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <section className="mx-auto max-w-3xl px-4 pb-10 pt-8 text-center md:pt-12">
        <div className="mb-4 inline-flex items-center gap-2.5">
          <span className="inline-flex size-9 items-center justify-center rounded-full bg-blue-100 text-blue-600">
            <Lock className="size-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold text-zinc-800">{product}</span>
        </div>

        <h1 className="display-title text-3xl font-black uppercase leading-tight tracking-wide text-zinc-950 md:text-5xl">
          {headline}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
          {description}
        </p>

        <div className="mt-7 flex flex-col items-center gap-3">
          {kind === "guest" ? (
            <>
              <button
                type="button"
                onClick={() => openAuth("signup")}
                className="inline-flex min-w-[14rem] items-center justify-center rounded-md bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
              >
                Create Account to Unlock
              </button>
              <button
                type="button"
                onClick={() => openAuth("signin")}
                className="text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
              >
                Already have an account? Sign in
              </button>
            </>
          ) : (
            <Link
              to={syncTo}
              className="inline-flex min-w-[14rem] items-center justify-center rounded-md bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              {syncLabel}
            </Link>
          )}
        </div>

        {/* Soft teaser preview */}
        <div className="relative mx-auto mt-10 max-w-2xl overflow-hidden rounded-xl border border-border/70 bg-white">
          <div className="grid grid-cols-2 gap-0 border-b border-border/60 bg-slate-50/80 px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <span>Start these</span>
            <span>Monitor these</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="size-8 shrink-0 rounded-full bg-slate-200/90" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-2.5 w-[72%] rounded bg-slate-200/90" />
                  <div className="h-2 w-[48%] rounded bg-slate-100" />
                </div>
                <span className="text-[11px] font-semibold tabular-nums text-slate-300">
                  {i % 2 === 0 ? "92%" : "····"}
                </span>
              </div>
            ))}
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white via-white/90 to-transparent"
          />
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-12">
        <div className="mb-6 text-center">
          <h2 className="text-xl font-bold text-zinc-900 md:text-2xl">Key Features</h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {featureList.map((feature) => (
            <div key={feature.title} className="flex gap-3 text-left">
              <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-base font-bold text-zinc-900 md:text-lg">{feature.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground md:text-[15px]">
                  {feature.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-border/60 bg-gradient-to-b from-blue-50/80 to-slate-50 px-4 py-14 text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-full h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/3 rounded-full border border-blue-200/50"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-full h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/3 rounded-full border border-blue-200/35"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-full h-[48rem] w-[48rem] -translate-x-1/2 -translate-y-1/3 rounded-full border border-blue-200/25"
        />

        <div className="relative z-10 mx-auto max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-2.5">
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-blue-600 text-white">
              <Lock className="size-3.5" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold text-zinc-700">The League Office</span>
          </div>
          <h2 className="display-title text-3xl font-black uppercase tracking-wide text-zinc-950 md:text-4xl">
            Dominate Your Fantasy Football League
          </h2>
          <div className="mt-6">
            {kind === "guest" ? (
              <button
                type="button"
                onClick={() => openAuth("signup")}
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
              >
                Create Account Today
              </button>
            ) : (
              <Link
                to={syncTo}
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
              >
                {syncLabel.includes("Sync") ? "Sync a League Today" : syncLabel}
              </Link>
            )}
          </div>
        </div>
      </section>

      <AuthDialog open={authOpen} mode={authMode} onOpenChange={setAuthOpen} />
    </div>
  );
}
