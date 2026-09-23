import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, ArrowRight, Grid3X3, Radar } from "lucide-react";
import { useEffect, useState } from "react";
import { StandingsPanel } from "@/components/league/StandingsPanel";
import { listPublishedArticles, type ArticleRow } from "@/lib/articles";
import { cn } from "@/lib/utils";


const relativeTime = (iso?: string) => {
  if (!iso) return "Fantasy Insight Feed";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "Fantasy Insight Feed";
  const mins = Math.max(1, Math.round((Date.now() - then) / 60000));
  const label =
    mins < 60
      ? `${mins} minute${mins === 1 ? "" : "s"} ago`
      : mins < 60 * 24
        ? `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? "" : "s"} ago`
        : `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? "" : "s"} ago`;
  return `Published ${label}`;
};


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
  const { data: briefings = [] } = useQuery({
    queryKey: ["published-articles", 6],
    retry: false,
    queryFn: () => listPublishedArticles(6),
  });
  const featured = briefings[0] ?? null;
  const moreBriefings = briefings.slice(1, 3);

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

  const wireItems = news.filter((n) => Boolean(articleUrl(n))).slice(0, visibleNews);

  return (
    <main className="mx-auto w-full max-w-shell px-4 pb-16 md:px-8">
      <section className="relative mt-6 overflow-hidden rounded-xl border border-border/60 bg-[#f8fafc] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] md:px-8 md:py-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-100/90 via-white to-blue-50/70"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-16 h-40 w-56 rounded-full bg-blue-500/[0.08] blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 left-1/4 h-36 w-72 rounded-full bg-slate-400/[0.07] blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(15, 23, 42, 0.045) 1px, transparent 0)",
            backgroundSize: "18px 18px",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full bg-gradient-to-b from-blue-500/80 via-blue-600/50 to-blue-400/20"
        />

        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 pl-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-600">
              Front Office
            </p>
            <h1 className="mt-1 font-display text-3xl font-black uppercase leading-none tracking-wide text-zinc-950 md:text-4xl">
              Your league,{" "}
              <span className="text-blue-600">managed with an edge</span>
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-600 md:text-[15px]">
              Sync your roster, grade trades, and track the week with tools built for serious managers.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <Link
              to="/account/leagues"
              className="inline-flex items-center gap-2 rounded-md border border-blue-600 bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Manage Your League
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              to="/playbook"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-white/90 px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-blue-600/40 hover:text-blue-600"
            >
              Open Playbook
            </Link>
          </div>
        </div>
      </section>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left: featured briefing + latest wire */}
        <div className="min-w-0 space-y-8 lg:col-span-2">
          <section>
            <div className="mb-4">
              <h2 className="display-title text-3xl uppercase tracking-wide text-zinc-950">
                Around The League
              </h2>
            </div>

            {featured ? (
              <FeaturedBriefing article={featured} />
            ) : (
              <div className="rounded-xl border border-border bg-card p-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-600">
                  League Office
                </p>
                <h3 className="mt-1 text-lg font-semibold text-zinc-900">Briefings coming soon</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  League Office articles will appear here when published.
                </p>
              </div>
            )}

            {moreBriefings.length > 0 ? (
              <div className="mt-4 flex flex-col gap-3">
                {moreBriefings.map((article) => (
                  <BriefingRow key={article.id} article={article} />
                ))}
              </div>
            ) : null}
          </section>

          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <h2 className="display-title text-2xl uppercase tracking-wide text-zinc-950">
                Latest Articles
              </h2>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Fantasy Wire
              </span>
            </div>

            {wireItems.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {wireItems.map((n, i) => (
                  <WireCard key={`${n.headline}-${i}`} item={n} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-border/70 bg-card p-5">
                <p className="text-sm text-muted-foreground">
                  Fantasy wire headlines will appear here when the news feed is available.
                </p>
              </div>
            )}

            {news.length > 0 && (visibleNews < news.length || newsLimit < 200) ? (
              <button
                type="button"
                onClick={loadMoreNews}
                disabled={loadingMore}
                className={cn(
                  "mt-5 w-full rounded-md border border-blue-600 bg-transparent px-4 py-2.5",
                  "text-sm font-medium text-blue-600 transition-colors",
                  "hover:bg-blue-600 hover:text-white disabled:opacity-60",
                )}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </section>
        </div>

        {/* Right: standings + tools */}
        <aside className="min-w-0 space-y-5 lg:col-span-1">
          <StandingsPanel />
          <section className="rounded-xl border border-border/80 bg-card p-3">
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Tools
            </p>
            <div className="flex flex-col gap-2">
              <ToolShortcut
                to="/draft"
                title="War Room"
                status="Draft ready"
                icon={<Grid3X3 className="h-4 w-4" aria-hidden="true" />}
              />
              <ToolShortcut
                to="/trade"
                title="Trade Desk"
                status="Value grading"
                icon={<ArrowLeftRight className="h-4 w-4" aria-hidden="true" />}
              />
              <ToolShortcut
                to="/waiver"
                title="The Wire"
                status="Waiver board"
                icon={<Radar className="h-4 w-4" aria-hidden="true" />}
              />
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function FeaturedBriefing({ article }: { article: ArticleRow }) {
  return (
    <Link
      to="/articles/$slug"
      params={{ slug: article.slug }}
      className="group block overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-blue-600/50"
    >
      {article.image_url ? (
        <div className="relative w-full overflow-hidden bg-slate-100">
          <img
            src={article.image_url}
            alt={article.title}
            loading="lazy"
            className="h-auto w-full object-cover transition-transform duration-500 group-hover:scale-[1.01]"
          />
          <span className="absolute right-3 top-3 rounded-md bg-blue-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
            Featured
          </span>
        </div>
      ) : null}
      <div className="border-t border-border p-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-600">
          League Office · {article.category}
        </p>
        <h3 className="mt-2 text-2xl font-black leading-snug tracking-tight text-zinc-950 transition-colors group-hover:text-blue-600 md:text-3xl">
          {article.title}
        </h3>
        {article.summary ? (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {article.summary}
          </p>
        ) : null}
        <p className="mt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          By {article.author_name}
          {article.created_at
            ? ` · ${new Date(article.created_at).toLocaleDateString()}`
            : ""}
          <span className="ml-2 text-blue-600 group-hover:underline">Read more</span>
        </p>
      </div>
    </Link>
  );
}

function BriefingRow({ article }: { article: ArticleRow }) {
  return (
    <Link
      to="/articles/$slug"
      params={{ slug: article.slug }}
      className="group flex gap-4 overflow-hidden rounded-xl border border-border/80 bg-card p-3 transition-colors hover:border-blue-600/40 sm:p-4"
    >
      {article.image_url ? (
        <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-100 sm:h-24 sm:w-36">
          <img
            src={article.image_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-600">
          League Office · {article.category}
        </p>
        <h3 className="mt-1 text-base font-bold leading-snug tracking-tight text-zinc-950 transition-colors group-hover:text-blue-600 sm:text-lg">
          {article.title}
        </h3>
        {article.summary ? (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{article.summary}</p>
        ) : null}
      </div>
    </Link>
  );
}

function WireCard({ item }: { item: NewsItem }) {
  const image = item.images?.[0];
  return (
    <a
      href={articleUrl(item)}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card transition-colors hover:border-blue-600/40"
    >
      <div className="aspect-[16/10] w-full overflow-hidden bg-slate-100">
        {image?.url ? (
          <img
            src={image.url}
            alt={image.alt ?? ""}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="text-sm font-bold leading-snug text-zinc-950 transition-colors group-hover:text-blue-600">
          {item.headline}
        </h3>
        {item.description ? (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-600">
            NFL
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {relativeTime(item.published)}
          </span>
        </div>
      </div>
    </a>
  );
}

function ToolShortcut({
  to,
  title,
  status,
  icon,
}: {
  to: string;
  title: string;
  status: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-lg border border-border/70 bg-white px-3 py-2.5 transition-colors hover:border-blue-600/40"
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-sm font-bold uppercase tracking-wide text-zinc-950 group-hover:text-blue-600">
          {title}
        </span>
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {status}
        </span>
      </span>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-blue-600 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}
