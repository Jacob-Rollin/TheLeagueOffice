import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";

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

const num = (v: number | null | undefined) =>
  typeof v === "number" ? v.toFixed(2).replace(/\.00$/, "") : "—";

function HofPage() {
  const { data: years } = useSuspenseQuery(hofQuery);

  return (
    <main className="min-h-screen bg-zinc-950 px-4 pb-24 pt-12">
      <header className="mx-auto max-w-3xl text-center">
        <p className="font-display text-xs uppercase tracking-[0.3em] text-amber-400/80">
          The League Office
        </p>
        <h1 className="mt-2 bg-gradient-to-b from-amber-200 to-yellow-600 bg-clip-text font-display text-4xl font-black uppercase tracking-tight text-transparent sm:text-6xl">
          Hall of Fame
        </h1>
        <p className="mt-3 text-sm text-zinc-400">
          Champions and record books, season by season.
        </p>
      </header>

      {years.length === 0 ? (
        <p className="mt-16 text-center text-sm text-zinc-500">
          No records have been added yet.
        </p>
      ) : (
        <div className="relative mx-auto mt-16 max-w-6xl">
          {/* Center timeline track */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-4 w-[3px] rounded-full bg-gradient-to-b from-amber-400 to-yellow-600 shadow-[0_0_22px_rgba(251,191,36,0.45)] lg:left-1/2 lg:-translate-x-1/2"
          />
          <div className="space-y-20 lg:space-y-28">
            {years.map((entry, i) => (
              <YearNode key={entry.year} entry={entry} side={i % 2 === 0 ? "left" : "right"} />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function YearNode({ entry, side }: { entry: HofYear; side: "left" | "right" }) {
  const left = side === "left";
  return (
    <section className="relative">
      {/* Massive year label anchored on the track */}
      <div className="relative z-10 mb-8 flex items-center gap-4 pl-12 lg:mb-10 lg:justify-center lg:pl-0">
        <span className="rounded-full bg-zinc-950 px-4 font-display text-5xl font-black leading-none tracking-tighter text-transparent [background:linear-gradient(to_bottom,#fcd34d,#ca8a04)] [-webkit-background-clip:text] [background-clip:text] sm:text-6xl lg:text-7xl">
          {entry.year}
        </span>
      </div>
      <div
        aria-hidden
        className="absolute left-4 top-6 z-10 h-3 w-3 -translate-x-1/2 rounded-full bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.9)] lg:left-1/2"
      />

      <div className="grid gap-8 pl-12 lg:grid-cols-2 lg:gap-14 lg:pl-0">
        <div className={cn(left ? "lg:col-start-1 lg:pr-10" : "lg:col-start-2 lg:pl-10")}>
          <ChampionCard entry={entry} />
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <RecordCard
              label="Player Week Record"
              headline={entry.playerWeek?.player_name ?? "—"}
              points={entry.playerWeek?.points ?? null}
              meta={[
                entry.playerWeek?.week,
                entry.playerWeek?.fantasy_team_name,
                entry.playerWeek?.manager_name,
              ]}
            />
            <RecordCard
              label="Team Week Record"
              headline={entry.teamWeek?.fantasy_team_name ?? "—"}
              points={entry.teamWeek?.points ?? null}
              meta={[entry.teamWeek?.week, entry.teamWeek?.manager_name]}
            />
            <RecordCard
              label="Team Season Record"
              headline={entry.teamSeason?.fantasy_team_name ?? "—"}
              points={entry.teamSeason?.points ?? null}
              meta={["Season total", entry.teamSeason?.manager_name]}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function ChampionCard({ entry }: { entry: HofYear }) {
  const champ = entry.championship;
  return (
    <article className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 shadow-[0_0_40px_-18px_rgba(251,191,36,0.7)] sm:p-8">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400 to-transparent"
      />
      <p className="font-display text-[11px] uppercase tracking-[0.28em] text-amber-400">
        League Champion
      </p>
      <h2 className="mt-3 font-display text-3xl font-black leading-tight text-zinc-50 sm:text-4xl">
        {champ?.fantasy_team_name ?? "Not recorded"}
      </h2>
      <p className="mt-2 text-sm text-zinc-400">
        Managed by <span className="text-zinc-200">{champ?.manager_name ?? "—"}</span>
      </p>
      {champ?.wins_losses ? (
        <p className="mt-5 inline-flex items-baseline gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-2">
          <span className="font-display text-2xl font-bold text-amber-300">
            {champ.wins_losses}
          </span>
          <span className="text-[11px] uppercase tracking-widest text-amber-200/70">Record</span>
        </p>
      ) : null}
    </article>
  );
}

function RecordCard({
  label,
  headline,
  points,
  meta,
}: {
  label: string;
  headline: string;
  points: number | null;
  meta: (string | null | undefined)[];
}) {
  const details = meta.filter(Boolean) as string[];
  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-amber-500/40">
      <p className="font-display text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-2 truncate text-sm font-semibold text-zinc-100" title={headline}>
        {headline}
      </p>
      <p className="mt-1 font-display text-2xl font-bold text-amber-300">{num(points)}</p>
      {details.length > 0 ? (
        <p className="mt-1 text-[11px] leading-snug text-zinc-500">{details.join(" · ")}</p>
      ) : null}
    </article>
  );
}
