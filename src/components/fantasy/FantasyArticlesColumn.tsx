import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

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

function WireStory({
  item,
  featured = false,
}: {
  item: FantasyNewsItem;
  featured?: boolean;
}) {
  const ago = timeAgo(item.published);

  if (featured) {
    const featuredBody = (
      <>
        {item.image ? (
          <div className="relative w-full overflow-hidden bg-slate-100">
            <img
              src={item.image}
              alt=""
              loading="lazy"
              className="h-auto max-h-[22rem] w-full object-cover transition-transform duration-500 group-hover:scale-[1.01]"
            />
          </div>
        ) : null}
        <div className="border-t border-slate-200 p-5">
          <h3 className="text-2xl font-black leading-snug tracking-tight text-slate-900 transition-colors group-hover:text-blue-600 md:text-[1.75rem]">
            {item.headline}
          </h3>
          {item.body ? (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-600">
              {item.body}
            </p>
          ) : null}
          <p className="mt-3 text-[11px] font-medium uppercase tracking-wider text-slate-500">
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

    const featuredClass =
      "group block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-colors hover:border-blue-600/50";

    if (item.link) {
      return (
        <a href={item.link} target="_blank" rel="noopener noreferrer" className={featuredClass}>
          {featuredBody}
        </a>
      );
    }
    return <div className={featuredClass}>{featuredBody}</div>;
  }

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

/** Fantasy Home news column — snap/CDN wire only (no admin CMS articles). */
export function FantasyArticlesColumn() {
  const { data: wireFeed = [], isLoading } = useQuery({
    queryKey: ["fantasy-news-feed", 40],
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: () => fetchSnapFantasyNews(40),
  });

  const wireItems = useMemo(() => {
    const withLink = wireFeed.filter((i) => i.link || i.headline);
    const espn = withLink.filter((i) => i.source === "ESPN");
    const fill = withLink.filter((i) => i.source !== "ESPN");
    const time = (i: FantasyNewsItem) => (i.published ? Date.parse(i.published) || 0 : 0);
    return [...espn, ...fill].sort((a, b) => time(b) - time(a)).slice(0, 12);
  }, [wireFeed]);

  const featured = wireItems[0] ?? null;
  const wireList = featured ? wireItems.slice(1) : [];

  const [visibleWire, setVisibleWire] = useState(4);

  return (
    <div className="min-w-0 space-y-8">
      <section>
        <div className="mb-4">
          <h2 className="display-title text-3xl uppercase tracking-wide text-slate-900">
            Fantasy <span className="text-primary">News</span>
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Latest fantasy wire from ESPN and our news sources.
          </p>
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-500">Loading fantasy news…</p>
        ) : featured ? (
          <WireStory item={featured} featured />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-600">
              Fantasy news will appear here when the wire is available.
            </p>
          </div>
        )}
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
