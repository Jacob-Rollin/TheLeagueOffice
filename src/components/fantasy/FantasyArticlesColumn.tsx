import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { listPublishedArticles, type ArticleRow } from "@/lib/articles";
import type { FantasyNewsItem } from "@/lib/players.server";
import { fetchSnapFantasyNews } from "@/lib/snap-cdn";

function timeAgo(iso: string | null | undefined): string | null {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return null;
  const mins = Math.max(1, Math.round((Date.now() - at) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function FeaturedArticle({ article }: { article: ArticleRow }) {
  return (
    <Link
      to="/articles/$slug"
      params={{ slug: article.slug }}
      className="group block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-colors hover:border-blue-600/50"
    >
      {article.image_url ? (
        <div className="relative w-full overflow-hidden bg-slate-100">
          <img
            src={article.image_url}
            alt=""
            loading="lazy"
            className="h-auto max-h-[22rem] w-full object-cover transition-transform duration-500 group-hover:scale-[1.01]"
          />
        </div>
      ) : null}
      <div className="border-t border-slate-200 p-5">
        <h3 className="text-2xl font-black leading-snug tracking-tight text-slate-900 transition-colors group-hover:text-blue-600 md:text-[1.75rem]">
          {article.title}
        </h3>
        {article.summary ? (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-600">
            {article.summary}
          </p>
        ) : null}
        <p className="mt-3 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          {timeAgo(article.created_at) ?? ""}
          {article.author_name ? (
            <>
              {article.created_at ? " · " : ""}
              {article.author_name}
            </>
          ) : null}
        </p>
      </div>
    </Link>
  );
}

function ArticleRowCard({ article }: { article: ArticleRow }) {
  return (
    <Link
      to="/articles/$slug"
      params={{ slug: article.slug }}
      className="group flex gap-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-colors hover:border-blue-600/40 sm:p-4"
    >
      {article.image_url ? (
        <div className="h-24 w-36 shrink-0 overflow-hidden rounded-lg bg-slate-100">
          <img
            src={article.image_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1 py-0.5">
        <h3 className="text-base font-bold leading-snug tracking-tight text-slate-900 transition-colors group-hover:text-blue-600 sm:text-lg">
          {article.title}
        </h3>
        {article.summary ? (
          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{article.summary}</p>
        ) : null}
        <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          {timeAgo(article.created_at) ?? ""}
          {article.author_name ? (
            <>
              {article.created_at ? " · " : ""}
              {article.author_name}
            </>
          ) : null}
        </p>
      </div>
    </Link>
  );
}

function WireStory({ item }: { item: FantasyNewsItem }) {
  const ago = timeAgo(item.published);
  const body = (
    <>
      {item.image ? (
        <div className="h-24 w-36 shrink-0 overflow-hidden rounded-lg bg-slate-100">
          <img
            src={item.image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1 py-0.5">
        <h3 className="text-base font-bold leading-snug tracking-tight text-slate-900 transition-colors group-hover:text-blue-600 sm:text-lg">
          {item.headline}
        </h3>
        {item.body ? (
          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.body}</p>
        ) : null}
        <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          {ago ?? ""}
          {item.source ? (
            <>
              {ago ? " · " : ""}
              {item.source}
            </>
          ) : null}
        </p>
      </div>
    </>
  );

  const className =
    "group flex gap-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-colors hover:border-blue-600/40 sm:p-4";

  if (item.link) {
    return (
      <a href={item.link} target="_blank" rel="noopener noreferrer" className={className}>
        {body}
      </a>
    );
  }

  return <div className={className}>{body}</div>;
}

export function FantasyArticlesColumn() {
  const { data: officeArticles = [], isLoading: officeLoading } = useQuery({
    queryKey: ["published-articles", 8],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => listPublishedArticles(8),
  });

  const { data: wireFeed = [], isLoading: wireLoading } = useQuery({
    queryKey: ["fantasy-news-feed", 40],
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: () => fetchSnapFantasyNews(40),
  });

  const featured = officeArticles[0] ?? null;
  const moreOffice = officeArticles.slice(1, 4);

  const wireItems = useMemo(() => {
    const withLink = wireFeed.filter((i) => i.link || i.headline);
    const espn = withLink.filter((i) => i.source === "ESPN");
    const fill = withLink.filter((i) => i.source !== "ESPN");
    const time = (i: FantasyNewsItem) => (i.published ? Date.parse(i.published) || 0 : 0);
    return [...espn, ...fill].sort((a, b) => time(b) - time(a)).slice(0, 12);
  }, [wireFeed]);

  /** When there is no League Office feature, promote the top wire story. */
  const wireFeatured = !featured ? (wireItems[0] ?? null) : null;
  const wireList = wireFeatured ? wireItems.slice(1) : wireItems;

  const [visibleWire, setVisibleWire] = useState(4);
  const loading = officeLoading && wireLoading;

  return (
    <div className="min-w-0 space-y-8">
      <section>
        <div className="mb-4">
          <h2 className="display-title text-3xl uppercase tracking-wide text-slate-900">
            Fantasy <span className="text-primary">News</span>
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            League Office briefings and the latest fantasy wire.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading articles…</p>
        ) : featured ? (
          <FeaturedArticle article={featured} />
        ) : wireFeatured ? (
          <WireStory item={wireFeatured} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-600">
              Fantasy articles will appear here when published.
            </p>
          </div>
        )}

        {moreOffice.length > 0 ? (
          <div className="mt-4 flex flex-col gap-3">
            {moreOffice.map((article) => (
              <ArticleRowCard key={article.id} article={article} />
            ))}
          </div>
        ) : null}
      </section>

      {wireList.length > 0 ? (
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="display-title text-2xl uppercase tracking-wide text-slate-900">
              Fantasy Wire
            </h2>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              External
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {wireList.slice(0, visibleWire).map((item) => (
              <WireStory key={item.id} item={item} />
            ))}
          </div>
          {visibleWire < wireList.length ? (
            <button
              type="button"
              onClick={() => setVisibleWire((n) => Math.min(n + 4, wireList.length))}
              className="mt-4 w-full rounded-md border border-blue-600 bg-transparent px-4 py-2.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-600 hover:text-white"
            >
              Load more
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
