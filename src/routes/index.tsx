import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftRight, ArrowRight, Grid3X3, Radar } from "lucide-react";
import { useEffect, useState } from "react";
import { getStandings, getUserLeagues } from "@/lib/league.functions";
import type { LeagueSummary, Standings } from "@/lib/league.server";
import { cn } from "@/lib/utils";

const KEY = "league-office-link-v1";
const NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50";

type Saved = { username: string; leagueId: string };
type LinkNode = { web?: { href?: string }; href?: string };
type NewsItem = {
  headline: string;
  description?: string;
  links?: LinkNode | LinkNode[];
  published?: string;
  images?: { url: string; alt?: string }[];
  categories?: { description?: string }[];
};

const articleUrl = (n: NewsItem) => {
  const nodes = Array.isArray(n.links) ? n.links : n.links ? [n.links] : [];
  for (const l of nodes) {
    const href = l?.web?.href ?? l?.href;
    if (typeof href === "string" && href) return href;
  }
  return "https://www.espn.com/fantasy/football/";
};

const isFantasy = (n: NewsItem) => {
  const tags = (n.categories ?? []).map((c) => (c.description ?? "").toLowerCase());
  return (
    tags.some((t) => t.includes("fantasy")) || `${n.headline} ${n.description ?? ""}`.toLowerCase().includes("fantasy")
  );
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "The League Office — Fantasy Football HQ" },
      {
        name: "description",
        content: "Connect your Sleeper league, follow standings, run your War Room and grade trades.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const [username, setUsername] = useState("");
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [standings, setStandings] = useState<Standings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [latency] = useState(() => Math.floor(Math.random() * 7) + 12);
  const leaguesM = useMutation({ mutationFn: (name: string) => getUserLeagues({ data: { username: name } }) });
  const standingsM = useMutation({ mutationFn: (leagueId: string) => getStandings({ data: { leagueId } }) });

  useEffect(() => {
    fetch(NEWS_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setNews(((d.articles ?? []) as NewsItem[]).filter(isFantasy).slice(0, 6)))
      .catch(() => setNews([]));
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Saved;
      if (saved.username) setUsername(saved.username);
      if (saved.leagueId) standingsM.mutateAsync(saved.leagueId).then((res) => res && setStandings(res));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLeague = async (leagueId: string, name: string) => {
    setError(null);
    const res = await standingsM.mutateAsync(leagueId);
    if (!res) return setError("Couldn't load that league.");
    setStandings(res);
    localStorage.setItem(KEY, JSON.stringify({ username: name, leagueId } satisfies Saved));
  };
  const search = async () => {
    setError(null);
    setStandings(null);
    const res = await leaguesM.mutateAsync(username);
    setLeagues(res);
    if (!res.length) setError("No leagues found for that Sleeper username.");
    else if (res.length === 1) await loadLeague(res[0]!.id, username);
  };
  const unlink = () => {
    localStorage.removeItem(KEY);
    setStandings(null);
    setLeagues([]);
  };

  const connectBox = (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="display-title text-2xl">League Sync</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Import your active Sleeper league assets to instantly unlock custom front-office analytics and real- time
          draft tracking.
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Enter Sleeper Username..."
          className="w-full rounded-md border border-zinc-300 bg-zinc-100 px-3 py-2.5 text-sm font-medium text-black outline-none placeholder:text-zinc-500 focus:border-zinc-400 focus:bg-white transition-colors"
        />
        <div className="flex gap-2">
          <button
            onClick={search}
            disabled={!username.trim() || leaguesM.isPending}
            className="flex-1 rounded-md bg-accent px-5 py-2.5 font-display uppercase tracking-wide text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {leaguesM.isPending ? "Looking…" : "Sync"}
          </button>
          {standings && (
            <button
              onClick={unlink}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-muted-foreground"
            >
              Unlink
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {leagues.length > 1 && !standings && (
        <ul className="mt-3 space-y-1">
          {leagues.map((l) => (
            <li key={l.id}>
              <button
                onClick={() => loadLeague(l.id, username)}
                className="flex w-full flex-col items-start gap-0.5 rounded-md border border-border bg-background px-3 py-2 text-left text-sm hover:border-primary"
              >
                <span className="w-full truncate">{l.name}</span>
                <span className="text-xs text-muted-foreground">
                  {l.season} · {l.teams} teams · {l.scoring}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {standingsM.isPending && <p className="mt-4 text-sm text-muted-foreground">Loading standings…</p>}
    </section>
  );

  return (
    <>
      <section className="w-full bg-gradient-to-b from-blue-50/40 via-transparent to-transparent pb-10">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-3">
            <div className="md:col-span-2">
              <h1 className="text-4xl font-black tracking-tight text-zinc-900 md:text-5xl">
                Welcome To{" "}
                <span className="text-blue-600">The League</span>
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                <span className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-1 font-mono text-xs font-semibold tracking-wider text-blue-700 shadow-sm">
                  Your league.
                </span>
                <span className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-1 font-mono text-xs font-semibold tracking-wider text-blue-700 shadow-sm">
                  Draft Room Operations.
                </span>
                <span className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-1 font-mono text-xs font-semibold tracking-wider text-blue-700 shadow-sm">
                  Front Office Analytics.
                </span>
              </div>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-500">
                Synchronize your active assets to manage every decision from a single terminal.
              </p>
            </div>
            <div className="flex flex-col items-end space-y-1.5 text-right md:col-span-1">
              <p className="font-mono text-xs tracking-[0.25em] text-zinc-500">
                // SYSTEM OPERATIONS TERMINAL v1.0
              </p>
              <div className="flex w-max items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2 font-mono text-xs tracking-wider text-red-600">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
                </span>
                LIVE DATA STREAM // LINK ACTIVE
              </div>
              <p className="text-[10px] font-mono tracking-widest text-zinc-400">
                LATENCY: {latency}ms // DB_STATUS: NOMINAL
              </p>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto w-full max-w-7xl px-4 pb-16 md:px-8">
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <section className="grid gap-3 sm:grid-cols-3">
            <HomeCard
              to="/draft"
              title="War Room"
              action="Open War Room"
              desc="Live draft engine, ADP tracking, and advanced player data metrics."
              icon={<Grid3X3 className="h-6 w-6 text-primary" aria-hidden="true" />}
            />
            <HomeCard
              to="/trade"
              title="Trade Desk"
              action="Launch Trade Desk"
              desc="Instant asset evaluation, roster impact modeling, and value tracking."
              icon={<ArrowLeftRight className="h-6 w-6 text-primary" aria-hidden="true" />}
            />
            <HomeCard
              to="/waiver"
              title="The Wire"
              action="Access The Wire"
              desc="Free agency priority tools, trend monitoring, and waiver budget analysis."
              icon={<Radar className="h-6 w-6 text-primary" aria-hidden="true" />}
            />
          </section>

          <section className="mt-10">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="eyebrow">Intelligence Briefings</p>
                <h2 className="display-title text-3xl">Around The League</h2>
              </div>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Updated on load</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {news.length
                ? news
                    .filter((n) => Boolean(articleUrl(n)))
                    .map((n, i) => (
                      <a
                        key={`${n.headline}-${i}`}
                        href={articleUrl(n)}
                        target="_blank"
                        rel="noreferrer"
                        className="group overflow-hidden rounded-xl border border-border bg-card hover:border-primary"
                      >
                        {n.images?.[0]?.url && (
                          <img
                            src={n.images[0].url}
                            alt={n.images[0].alt ?? "Fantasy football news"}
                            loading="lazy"
                            className="h-32 w-full object-cover"
                          />
                        )}
                        <div className="p-4">
                          <p className="text-[10px] uppercase tracking-widest text-primary">Fantasy</p>
                          <h3 className="mt-1 font-semibold leading-5 group-hover:text-primary">{n.headline}</h3>
                          {n.description && (
                            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{n.description}</p>
                          )}
                        </div>
                      </a>
                    ))
                : ["Fantasy draft targets to watch", "Fantasy sleepers and busts", "Fantasy players trending up"].map(
                    (x) => (
                      <div key={x} className="rounded-xl border border-border bg-card p-4">
                        <p className="text-[10px] uppercase tracking-widest text-primary">Fantasy</p>
                        <h3 className="mt-1 font-semibold">{x}</h3>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Live fantasy football headlines will appear here when the news feed is available.
                        </p>
                      </div>
                    ),
                  )}
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-4 lg:col-span-1">
          {connectBox}
          {standings && (
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="display-title min-w-0 truncate text-lg">{standings.league.name}</h2>
                <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
                  {standings.league.season}
                </span>
              </div>
              <div className="rounded-lg border border-border">
                <table className="w-full table-fixed text-xs">
                  <thead className="bg-surface text-[10px] uppercase tracking-widest text-muted-foreground">
                    <tr>
                      <th className="w-8 px-1 py-1.5 text-left">#</th>
                      <th className="px-1 py-1.5 text-left">Team</th>
                      <th className="w-16 px-1 py-1.5 text-right">W-L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.rows.map((r, i) => (
                      <tr key={r.rosterId} className={cn("border-t border-border", i < 4 && "bg-primary/5")}>
                        <td className="tabnum px-1 py-1.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-1 py-1.5">
                          <div className="truncate font-medium">{r.team}</div>
                          <div className="truncate text-[10px] text-muted-foreground">{r.owner}</div>
                        </td>
                        <td className="tabnum px-1 py-1.5 text-right">
                          {r.wins}-{r.losses}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </aside>
      </div>
    </main>
  </>
  );
}

function HomeCard({
  to,
  title,
  action,
  desc,
  icon,
}: {
  to: string;
  title: string;
  action: string;
  desc: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-zinc-700"
    >
      <div className="mb-3 flex w-full items-center justify-between">
        <div className="font-display text-xl uppercase tracking-wide">{title}</div>
        <div className="inline-flex rounded-lg bg-primary/10 p-2.5 text-primary">{icon}</div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{desc}</p>
      <div className="mt-auto inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-zinc-900/40 px-4 py-2 text-sm font-medium text-white transition-colors group-hover:border-zinc-600 group-hover:bg-zinc-800/60">
        <span>{action}</span>
        <ArrowRight
          className="h-4 w-4 transition-transform group-hover:translate-x-1"
          aria-hidden="true"
        />
      </div>
    </Link>
  );
}
