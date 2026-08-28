import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftRight, ArrowRight, Grid3X3, Radar } from "lucide-react";
import { useEffect, useState } from "react";
import { LeagueEmptyState } from "@/components/league/LeagueGate";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { cn } from "@/lib/utils";

const NEWS_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news";
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
  const { activeLeague, standings, loading: standingsLoading } = useActiveStandings();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [visibleNews, setVisibleNews] = useState(6);
  const [newsLimit, setNewsLimit] = useState(50);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchNews = (limit: number) =>
    fetch(`${NEWS_BASE_URL}?limit=${limit}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("news"))))
      .then((d) => ((d.articles ?? []) as NewsItem[]).filter(isFantasy));

  useEffect(() => {
    fetchNews(50)
      .then(setNews)
      .catch(() => setNews([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMoreNews = async () => {
    const next = visibleNews + 6;
    if (next <= news.length) {
      setVisibleNews(next);
      return;
    }
    setLoadingMore(true);
    try {
      const bigger = Math.min(newsLimit + 50, 200);
      const more = await fetchNews(bigger);
      if (more.length > news.length) setNews(more);
      setNewsLimit(bigger);
      setVisibleNews(next);
    } catch {
      setVisibleNews(Math.min(next, news.length));
    } finally {
      setLoadingMore(false);
    }
  };


  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-16 md:px-8">
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <div className="mb-6">
            <h1 className="text-4xl font-black tracking-tight text-zinc-950 drop-shadow-[0_4px_10px_rgba(0,0,0,0.15)] md:text-5xl">
              Welcome To{" "}
              <span className="text-blue-600">The League</span>
            </h1>
            <p className="mt-2 mb-6 font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
              FRONT OFFICE INTERFACE // DRAFT & OPERATION ANALYTICS
            </p>
          </div>

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
            <div className="flex flex-col gap-4">
              {news.length
                ? news
                    .filter((n) => Boolean(articleUrl(n)))
                    .slice(0, visibleNews)
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
                            className="h-auto w-full object-contain"
                          />
                        )}
                        <div className="p-4">
                          <p className="text-[10px] uppercase tracking-widest text-primary">Fantasy</p>
                          <h3 className="mt-1 text-lg font-semibold leading-snug group-hover:text-primary">
                            {n.headline}
                          </h3>
                          {n.description && (
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{n.description}</p>
                          )}
                        </div>
                      </a>
                    ))
                : ["Fantasy draft targets to watch", "Fantasy sleepers and busts", "Fantasy players trending up"].map(
                    (x) => (
                      <div key={x} className="rounded-xl border border-border bg-card p-4">
                        <p className="text-[10px] uppercase tracking-widest text-primary">Fantasy</p>
                        <h3 className="mt-1 text-lg font-semibold">{x}</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Live fantasy football headlines will appear here when the news feed is available.
                        </p>
                      </div>
                    ),
                  )}

              {news.length > 0 && (visibleNews < news.length || newsLimit < 200) && (
                <button
                  type="button"
                  onClick={loadMoreNews}
                  disabled={loadingMore}
                  className="rounded-xl border border-border bg-card px-4 py-3 font-display text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "[ Load more ]"}
                </button>
              )}
            </div>

          </section>
        </div>

        <aside className="min-w-0 space-y-0 lg:col-span-1">
          {commandConsole}
          {connectBox}
          {standings && (
            <section className="mt-4 rounded-xl border border-border bg-card p-4">
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
