import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
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
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">League HQ</p>
            <h2 className="display-title text-2xl">Connect Your Sleeper League</h2>
          </div>
          <span className="status-dot shrink-0">LIVE DATA</span>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Enter Sleeper username"
          className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
        />
        <div className="flex gap-2">
          <button
            onClick={search}
            disabled={!username.trim() || leaguesM.isPending}
            className="flex-1 rounded-md bg-primary px-5 py-2.5 font-display uppercase tracking-wide text-primary-foreground disabled:opacity-50"
          >
            {leaguesM.isPending ? "Looking…" : "Connect"}
          </button>
          {standings && (
            <button onClick={unlink} className="rounded-md border border-border px-4 py-2.5 text-sm text-muted-foreground">
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
    <main className="mx-auto w-full max-w-6xl px-3 pb-16">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,68fr)_minmax(0,32fr)]">
        <div className="min-w-0">
          <section className="py-10 text-center lg:py-14 lg:text-left">
            <h1 className="display-title text-5xl leading-none sm:text-7xl">
              Welcome To The <span className="text-primary">League</span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base lg:mx-0 mx-auto">
              Your league. Your draft room. Your front office. Connect Sleeper and keep every decision in one place.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2 lg:justify-start">
              <Link
                className="rounded-md bg-primary px-5 py-2.5 font-display uppercase tracking-wide text-primary-foreground"
                to="/draft"
              >
                Enter War Room
              </Link>
              <Link
                className="rounded-md border border-border px-5 py-2.5 font-display uppercase tracking-wide"
                to="/trade"
              >
                Evaluate A Trade
              </Link>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <HomeCard
              to="/draft"
              title="War Room"
              desc="ADP, projections, stats, player cards, custom rankings and a live draft board."
            />
            <HomeCard
              to="/trade"
              title="Trade Analyzer"
              desc="Compare what you give and get with roster-fit and player value."
            />
            <HomeCard to="/waiver" title="Waiver Wire" desc="Find the best free-agent adds and get a claim grade." />
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

        <aside className="min-w-0 space-y-4 lg:pt-10">
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
  );
}


function HomeCard({ to, title, desc }: { to: string; title: string; desc: string }) {
  return (
    <Link to={to} className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary">
      <div className="font-display text-xl uppercase tracking-wide">{title}</div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{desc}</p>
    </Link>
  );
}
