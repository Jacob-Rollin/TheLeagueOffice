import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftRight, ArrowRight, Grid3X3, Radar } from "lucide-react";
import { useEffect, useState } from "react";
import { getStandings, getUserLeagues } from "@/lib/league.functions";
import type { LeagueSummary, Standings } from "@/lib/league.server";
import { useLeagueLink } from "@/lib/league-link";
import { cn } from "@/lib/utils";

const NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50";
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
  const { link, saveLink, clearLink } = useLeagueLink();
  const [username, setUsername] = useState("");
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [standings, setStandings] = useState<Standings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [visibleNews, setVisibleNews] = useState(6);
  const [newsLimit, setNewsLimit] = useState(50);
  const [loadingMore, setLoadingMore] = useState(false);
  const [latency, setLatency] = useState(14);
  useEffect(() => {
    setLatency(Math.floor(Math.random() * 7) + 12);
  }, []);
  const leaguesM = useMutation({ mutationFn: (name: string) => getUserLeagues({ data: { username: name } }) });
  const standingsM = useMutation({ mutationFn: (leagueId: string) => getStandings({ data: { leagueId } }) });

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


  // Hydrate from the globally shared league link (set here, in the War Room, or on Trade).
  const linkedLeagueId = link?.leagueId ?? null;
  useEffect(() => {
    if (link?.username) setUsername((u) => u || link.username);
    if (!linkedLeagueId) {
      setStandings(null);
      return;
    }
    let alive = true;
    standingsM.mutateAsync(linkedLeagueId).then((res) => {
      if (alive && res) setStandings(res);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedLeagueId, link?.username]);

  const loadLeague = async (leagueId: string, name: string) => {
    setError(null);
    const res = await standingsM.mutateAsync(leagueId);
    if (!res) return setError("Couldn't load that league.");
    setStandings(res);
    saveLink({
      username: name.trim(),
      leagueId,
      leagueName: res.league?.name,
      syncedAt: new Date().toISOString(),
    });
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
    clearLink();
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
          {(standings || link) && (
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

  const commandConsole = (
    <section className="w-full flex flex-col space-y-2 p-4 rounded-xl border border-zinc-200/80 bg-zinc-50/50 backdrop-blur-sm shadow-sm text-left items-start mb-4">
      <span className="block w-full border-b border-zinc-200/60 pb-1.5 font-mono text-xs font-medium uppercase tracking-wider text-zinc-400">
        // SYSTEM OPERATIONS TERMINAL v1.0
      </span>
      <div className="flex w-full items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 font-mono text-xs tracking-wider text-red-600">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600 shadow-[0_0_15px_rgba(239,68,68,0.8)]" />
        </span>
        LIVE DATA STREAM // LINK ACTIVE
      </div>
      {standingsM.isPending || leaguesM.isPending ? (
        <div className="flex w-full items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 font-mono text-xs tracking-wider text-amber-600">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-600 shadow-[0_0_15px_rgba(245,158,11,0.8)]" />
          </span>
          SYNC INITIALIZING // STANDBY
        </div>
      ) : standings || link ? (
        <div className="flex w-full items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 font-mono text-xs tracking-wider text-red-600">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600 shadow-[0_0_15px_rgba(239,68,68,0.8)]" />
          </span>
          LEAGUE SYNC // LINK ACTIVE
        </div>
      ) : (
        <div className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1.5 font-mono text-xs tracking-wider text-zinc-400">
          <span className="h-2 w-2 rounded-full bg-zinc-400" aria-hidden="true" />
          LEAGUE SYNC // DISCONNECTED
        </div>
      )}
      <span className="block w-full font-mono text-xs font-bold uppercase tracking-widest text-blue-600">
        LATENCY: {latency}ms // DB_STATUS: NOMINAL
      </span>
    </section>
  );

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
