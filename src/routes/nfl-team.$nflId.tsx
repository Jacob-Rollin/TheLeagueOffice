import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";

import { PositionBadge } from "@/components/draft/PositionBadge";
import { teamLogo } from "@/components/draft/PlayerAvatar";
import { NFL_TEAMS, teamById } from "@/lib/nfl-teams";
import { getPlayers, getTeamNews } from "@/lib/players.functions";

export const Route = createFileRoute("/nfl-team/$nflId")({
  head: ({ params }) => {
    const t = teamById(params.nflId);
    const name = t ? `${t.city} ${t.name}` : "NFL team";
    return {
      meta: [
        { title: `${name} roster & injuries — The League Office` },
        {
          name: "description",
          content: `${name} fantasy roster, projections and training-camp injury tracker.`,
        },
        { property: "og:title", content: `${name} — The League Office` },
        {
          property: "og:description",
          content: `${name} fantasy-relevant roster with projections and injury report.`,
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  loader: ({ params }) => {
    if (!teamById(params.nflId)) throw notFound();
  },
  component: NflTeamHub,
});

function NflTeamHub() {
  const { nflId } = Route.useParams();
  const team = teamById(nflId)!;
  const { data, isLoading } = useQuery({
    queryKey: ["players"],
    queryFn: () => getPlayers(),
    staleTime: 1000 * 60 * 30,
  });

  const roster = (data?.players ?? [])
    .filter((p) => p.team === team.id)
    .sort((a, b) => b.proj.half - a.proj.half);
  const injured = roster.filter((p) => p.injury);
  const [tab, setTab] = useState<"roster" | "news">("roster");

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <header className="flex items-center gap-4 rounded-xl border border-border bg-card p-5">
        <img src={teamLogo(team.id) ?? ""} alt={`${team.name} logo`} className="size-16" />
        <div>
          <p className="font-display text-xs uppercase tracking-widest text-muted-foreground">
            {team.conference} {team.division}
          </p>
          <h1 className="display-title text-3xl">
            {team.city} {team.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {roster.length} fantasy-relevant players · {injured.length} on the injury report
          </p>
        </div>
      </header>

      <nav className="mt-6 flex items-center gap-6 border-b border-border pb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
        {(["roster", "news"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={
              "-mb-2 pb-2 transition-colors hover:text-foreground " +
              (tab === k ? "border-b-2 border-primary text-primary" : "")
            }
          >
            {k === "roster" ? "Roster" : "News"}
          </button>
        ))}
      </nav>

      {tab === "news" && <TeamNews team={team.id} />}

      {tab === "roster" && (
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="font-display text-sm uppercase tracking-widest">Active roster</h2>
          <div className="mt-2 overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Player</th>
                  <th className="w-16 px-2 py-2 text-center font-medium">Bye</th>
                  <th className="w-16 px-2 py-2 text-center font-medium">ADP</th>
                  <th className="w-20 px-2 py-2 text-center font-medium">Proj</th>
                  <th className="w-20 px-2 py-2 text-center font-medium">Last yr</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2">
                      <Link
                        to="/player/$id"
                        params={{ id: p.id }}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <PositionBadge pos={p.pos} />
                        <span className="truncate">{p.name}</span>
                      </Link>
                    </td>
                    <td className="tabnum px-2 py-2 text-center text-muted-foreground">
                      {p.bye ?? "—"}
                    </td>
                    <td className="tabnum px-2 py-2 text-center">
                      {p.adp.half < 999 ? p.adp.half.toFixed(1) : "—"}
                    </td>
                    <td className="tabnum px-2 py-2 text-center">{p.proj.half.toFixed(1)}</td>
                    <td className="tabnum px-2 py-2 text-center text-muted-foreground">
                      {p.prev ? p.prev.half.toFixed(1) : "—"}
                    </td>
                  </tr>
                ))}
                {!roster.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {isLoading ? "Loading roster…" : "No roster data available."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside>
          <h2 className="font-display text-sm uppercase tracking-widest">Injury tracker</h2>
          <ul className="mt-2 space-y-2">
            {injured.map((p) => (
              <li key={p.id} className="rounded-lg border border-border bg-card p-3">
                <Link
                  to="/player/$id"
                  params={{ id: p.id }}
                  className="flex items-center gap-2 text-sm font-medium hover:underline"
                >
                  <PositionBadge pos={p.pos} />
                  <span className="truncate">{p.name}</span>
                </Link>
                <p className="mt-1 text-xs uppercase tracking-wide text-destructive">
                  {p.injury}
                </p>
              </li>
            ))}
            {!injured.length && (
              <li className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                {isLoading ? "Checking camp reports…" : "No reported injuries. Fully healthy."}
              </li>
            )}
          </ul>

          <h2 className="mt-6 font-display text-sm uppercase tracking-widest">Jump to team</h2>
          <div className="mt-2 flex flex-wrap gap-1">
            {NFL_TEAMS.map((t) => (
              <Link
                key={t.id}
                to="/nfl-team/$nflId"
                params={{ nflId: t.id }}
                className="rounded border border-border bg-card px-2 py-1 text-xs hover:bg-accent"
              >
                {t.id}
              </Link>
            ))}
          </div>
        </aside>
      </div>
      )}
    </main>
  );
}

function TeamNews({ team }: { team: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["team-news", team],
    queryFn: () => getTeamNews({ data: { team } }),
    staleTime: 1000 * 60 * 10,
  });

  if (isLoading)
    return (
      <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Loading team news…
      </p>
    );
  if (isError || !data?.length)
    return (
      <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No news available right now.
      </p>
    );

  return (
    <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
      {data.map((n) => (
        <li key={n.id} className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold leading-snug">{n.headline}</h3>
          {n.description && (
            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{n.description}</p>
          )}
          {n.link && (
            <a
              href={n.link}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-primary"
            >
              Read on ESPN <ExternalLink className="size-3" />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
