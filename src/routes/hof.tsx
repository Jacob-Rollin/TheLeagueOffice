import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { getHallOfFame } from "@/lib/hof.functions";
import type { HofYear } from "@/lib/hof.server";
import { cn } from "@/lib/utils";

const hofQuery = queryOptions({
  queryKey: ["hall-of-fame"],
  queryFn: () => getHallOfFame(),
  staleTime: 1000 * 60 * 10,
});

export const Route = createFileRoute("/hof")({
  head: () => ({
    meta: [
      { title: "Hall of Fame Timeline — The League Office" },
      {
        name: "description",
        content:
          "Every league champion, record-setting player week, team week and team season, laid out season by season.",
      },
      { property: "og:title", content: "Hall of Fame Timeline — The League Office" },
      {
        property: "og:description",
        content: "League champions and all-time scoring records, season by season.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(hofQuery);
  },
  component: HofPage,
  errorComponent: HofError,
  notFoundComponent: () => (
    <div className="bg-zinc-950 py-24 text-center text-zinc-400">No Hall of Fame records yet.</div>
  ),
});

function HofError({ error }: { error: Error }) {
  const router = useRouter();
  return (
    <div className="min-h-[60vh] bg-zinc-950 py-24 text-center" role="alert">
      <p className="text-zinc-300">Couldn&apos;t load the Hall of Fame.</p>
      <p className="mt-1 text-xs text-zinc-500">{error.message}</p>
      <button
        onClick={() => router.invalidate()}
        className="mt-4 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950"
      >
        Try again
      </button>
    </div>
  );
}

const num = (v: number | null | undefined) => (typeof v === "number" ? v.toFixed(2).replace(/\.00$/, "") : "—");

const wk = (v: string | null | undefined) => (v ? v.replace(/^\s*week\s*/i, "").trim() || null : null);

const pts = (v: number | null | undefined) => (typeof v === "number" ? `${num(v)} pts` : null);

function HofPage() {
  const { data: years } = useSuspenseQuery(hofQuery);

  return (
    <main className="min-h-screen bg-zinc-950 px-4 pb-24 pt-12">
      <header className="mx-auto max-w-3xl text-center">
        <p className="font-display text-xs uppercase tracking-[0.3em] text-amber-400/80">The League</p>
        <h1 className="mt-2 bg-gradient-to-b from-amber-200 to-yellow-600 bg-clip-text font-display text-4xl font-black uppercase tracking-tight text-transparent sm:text-6xl">
          Hall of Fame
        </h1>
        <p className="mt-3 text-sm text-zinc-400">Champions and record books, season by season.</p>
      </header>

      {years.length === 0 ? (
        <p className="mt-16 text-center text-sm text-zinc-500">No records have been added yet.</p>
      ) : (
        <div className="relative mx-auto mt-16 max-w-6xl before:absolute before:bottom-0 before:left-4 before:top-0 before:w-1 before:bg-gradient-to-b before:from-amber-500 before:to-amber-600/30 md:before:left-1/2 md:before:-translate-x-1/2">
          <div className="space-y-16 md:space-y-24">
            {years.map((entry) => (
              <YearNode key={entry.year} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function TimelineRow({ side, children }: { side: "left" | "right"; children: ReactNode }) {
  const left = side === "left";
  return (
    <div className="relative pl-12 md:pl-0">
      <div
        className={cn(
          "relative w-full md:w-[calc(50%-2rem)]",
          left ? "md:mr-auto" : "md:ml-auto",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 hidden h-px w-8 -translate-y-1/2 md:block lg:w-16",
            left
              ? "left-full bg-gradient-to-l from-amber-500/40 to-transparent"
              : "right-full bg-gradient-to-r from-amber-500/40 to-transparent",
          )}
        />
        <span
          aria-hidden
          className="absolute right-full top-1/2 block h-px w-8 -translate-y-1/2 bg-gradient-to-r from-amber-500/40 to-transparent md:hidden"
        />
        {children}
      </div>
    </div>
  );
}

function YearNode({ entry }: { entry: HofYear }) {
  return (
    <section className="relative">
      <span className="relative z-10 mx-auto my-8 block w-fit rounded-md border-2 border-amber-500 bg-zinc-900 px-4 py-1.5 font-mono text-xl font-bold tracking-tight text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
        {entry.year}
      </span>

      <div className="space-y-12 md:space-y-16">
        <TimelineRow side="left">
          <FlipCard
            className="h-72 w-full sm:h-80"
            front={
              <div className="flex h-full flex-col items-center justify-center gap-3 overflow-visible rounded-2xl border border-amber-500/30 bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 pr-4 text-center shadow-[0_0_40px_-18px_rgba(251,191,36,0.7)]">
                <TrophyIcon />
                <span className="bg-gradient-to-b from-amber-200 to-yellow-600 bg-clip-text px-1 font-display text-5xl font-black leading-none tracking-tight text-transparent sm:text-6xl">
                  {entry.year}
                </span>
                <span className="font-display text-xs uppercase tracking-[0.3em] text-amber-400">League Champion</span>
              </div>
            }
            back={
              <CardBack
                title="Record: League Champion"
                rows={[
                  ["Team", entry.championship?.fantasy_team_name],
                  ["Manager", entry.championship?.manager_name],
                  ["Record", entry.championship?.wins_losses],
                ]}
                large
              />
            }
          />
        </TimelineRow>

        <TimelineRow side="right">
          <FlipCard
            className="h-56 w-full"
            front={<SmallFront label="Highest Scoring Player (Week)" />}
            back={
              <CardBack
                title="Record: Highest Scoring Player (Week)"
                rows={[
                  ["Player", entry.playerWeek?.player_name],
                  ["Points", pts(entry.playerWeek?.points)],
                  ["Week", wk(entry.playerWeek?.week)],
                  ["Team", entry.playerWeek?.fantasy_team_name],
                  ["Manager", entry.playerWeek?.manager_name],
                ]}
              />
            }
          />
        </TimelineRow>

        <TimelineRow side="left">
          <FlipCard
            className="h-56 w-full"
            front={<SmallFront label="Highest Points For Team (Week)" />}
            back={
              <CardBack
                title="Record: Highest Points For Team (Week)"
                rows={[
                  ["Team", entry.teamWeek?.fantasy_team_name],
                  ["Points", pts(entry.teamWeek?.points)],
                  ["Week", wk(entry.teamWeek?.week)],
                  ["Manager", entry.teamWeek?.manager_name],
                ]}
              />
            }
          />
        </TimelineRow>

        <TimelineRow side="right">
          <FlipCard
            className="h-56 w-full"
            front={<SmallFront label="Highest Points For Team (Season)" />}
            back={
              <CardBack
                title="Record: Highest Points For Team (Season)"
                rows={[
                  ["Team", entry.teamSeason?.fantasy_team_name],
                  ["Total Points", pts(entry.teamSeason?.points)],
                  ["Season", String(entry.year)],
                  ["Manager", entry.teamSeason?.manager_name],
                ]}
              />
            }
          />
        </TimelineRow>
      </div>
    </section>
  );
}


function FlipCard({ front, back, className }: { front: ReactNode; back: ReactNode; className?: string }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className={cn("[perspective:1200px]", className)}>
      <button
        type="button"
        aria-pressed={flipped}
        onClick={() => setFlipped((f) => !f)}
        className="relative h-full w-full cursor-pointer rounded-2xl text-left transition-all duration-300 [transform-style:preserve-3d] hover:scale-[1.03] hover:shadow-[0_0_35px_rgba(245,158,11,0.6)] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        style={{ transform: flipped ? "rotateY(180deg)" : undefined }}
      >
        <div className="absolute inset-0 [backface-visibility:hidden]">{front}</div>
        <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">{back}</div>
      </button>
    </div>
  );
}

function SmallFront({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center transition-colors hover:border-amber-500/40">
      <span className="h-px w-8 bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      <span className="font-display text-sm font-semibold uppercase leading-snug tracking-wide text-zinc-200">
        {label}
      </span>
      <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Tap to flip</span>
    </div>
  );
}

function CardBack({
  title,
  rows,
  large,
}: {
  title: string;
  rows: [string, string | null | undefined][];
  large?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center space-y-3 overflow-hidden rounded-xl border bg-zinc-900 p-6 text-center",
        large
          ? "rounded-2xl border-amber-500/40 shadow-[0_0_40px_-18px_rgba(251,191,36,0.7)] sm:p-6"
          : "border-zinc-800",
      )}
    >
      <span className="mb-2 block font-mono text-xs font-semibold uppercase tracking-wider text-amber-500">{title}</span>
      {rows.map(([label, value]) => (
        <p
          key={label}
          className={cn("max-w-full truncate text-zinc-300", large ? "text-base sm:text-lg" : "text-sm")}
          title={value ?? undefined}
        >
          <span className="text-zinc-500">{label}: </span>
          <span className="font-semibold text-zinc-100">{value || "—"}</span>
        </p>
      ))}
    </div>
  );
}

function TrophyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-10 w-10 text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.6)]"
      fill="currentColor"
    >
      <path d="M18 3h3v3a4 4 0 0 1-3.4 3.95A6 6 0 0 1 13 13.9V17h3a1 1 0 0 1 0 2H8a1 1 0 0 1 0-2h3v-3.1A6 6 0 0 1 6.4 9.95 4 4 0 0 1 3 6V3h3V2h12v1zM6 5H5v1a2 2 0 0 0 1 1.73V5zm13 0h-1v2.73A2 2 0 0 0 19 6V5z" />
    </svg>
  );
}
