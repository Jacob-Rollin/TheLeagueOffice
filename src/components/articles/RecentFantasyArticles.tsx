import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getFantasyNewsFeed } from "@/lib/players.functions";
import type { FantasyNewsItem } from "@/lib/players.server";

const COUNT = 5;

function timeAgo(iso: string | null): string | null {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return null;
  const mins = Math.max(1, Math.round((Date.now() - at) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Full ESPN stories first; RotoWire blurbs only fill the list when there aren't enough. */
function pickArticles(items: FantasyNewsItem[]): FantasyNewsItem[] {
  const withLink = items.filter((i) => i.link);
  const espn = withLink.filter((i) => i.source === "ESPN");
  const fill = withLink.filter((i) => i.source !== "ESPN");
  const time = (i: FantasyNewsItem) => (i.published ? Date.parse(i.published) || 0 : 0);
  return [...espn.slice(0, COUNT), ...fill]
    .slice(0, COUNT)
    .sort((a, b) => time(b) - time(a));
}

function Thumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-12 w-16 shrink-0 rounded-md border border-border/60 bg-slate-100 object-cover"
    />
  );
}

export function RecentFantasyArticles() {
  const { data, isLoading } = useQuery({
    queryKey: ["fantasy-news-feed", 40],
    queryFn: () => getFantasyNewsFeed({ data: { limit: 40 } }),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const articles = pickArticles(data ?? []);

  return (
    <section className="rounded-xl border border-border/80 bg-card p-4">
      <h2 className="display-title text-sm uppercase tracking-wide text-zinc-950">Recent Articles</h2>
      <div className="mt-3 divide-y divide-border/70">
        {isLoading ? (
          <p className="py-2 text-xs text-muted-foreground">Loading the latest fantasy stories…</p>
        ) : articles.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">No fantasy stories right now.</p>
        ) : (
          articles.map((item) => {
            const ago = timeAgo(item.published);
            return (
              <a
                key={item.id}
                href={item.link ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <Thumb src={item.image} />
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-900 transition-colors group-hover:text-blue-600">
                    {item.headline}
                  </span>
                  <span className="mt-0.5 block text-[11px] font-medium text-muted-foreground">
                    {item.source}
                    {ago ? ` · ${ago}` : ""}
                  </span>
                </span>
              </a>
            );
          })
        )}
      </div>
    </section>
  );
}
