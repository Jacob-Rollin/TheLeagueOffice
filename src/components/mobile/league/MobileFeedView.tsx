import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { useOpenMobilePlayer } from "@/components/mobile/MobilePlayerSheet";
import { listPublishedArticles } from "@/lib/articles";
import type { Pos } from "@/lib/draft";
import { fetchSnapFantasyNews } from "@/lib/snap-cdn";
import { cn } from "@/lib/utils";

import { MobileActivityList } from "./MobileLeagueChrome";

type Tab = "transactions" | "news";

type FeedNewsItem = {
  id: string;
  headline: string;
  body: string;
  published: string | null;
  image: string | null;
  source: string;
  player: { id: string; name: string; team: string | null; pos: string } | null;
  href: { internal: string } | { external: string } | null;
};

const AVATAR_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

async function loadFantasyNews(): Promise<FeedNewsItem[]> {
  const [articles, feed] = await Promise.all([
    listPublishedArticles(6).catch(() => []),
    fetchSnapFantasyNews(40).catch(() => []),
  ]);
  const ours: FeedNewsItem[] = articles.map((a) => ({
    id: `article-${a.id}`,
    headline: a.title,
    body: a.summary ?? "",
    published: a.created_at,
    image: a.image_url || null,
    source: "The League Office",
    player: null,
    href: { internal: a.slug },
  }));
  const external: FeedNewsItem[] = feed.map((n) => ({
    ...n,
    href: n.link ? { external: n.link } : null,
  }));
  const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);
  return [...ours, ...external].sort((a, b) => time(b.published) - time(a.published));
}

function relativeTime(iso: string | null) {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function MobileFeedView() {
  const [tab, setTab] = useState<Tab>("transactions");

  return (
    <main>
      <div className="grid grid-cols-2 border-b border-m-border bg-m-bg">
        {(
          [
            ["transactions", "Transactions"],
            ["news", "Fantasy News"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "border-b-4 py-3.5 font-display text-lg font-semibold tracking-wide transition-colors",
              tab === id ? "border-m-accent text-m-card-fg" : "border-transparent text-m-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "transactions" ? (
        <section className="px-3">
          <h2 className="px-1 pb-1 pt-5 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">
            League Transactions
          </h2>
          <MobileActivityList empty={<FeedEmpty />} />
        </section>
      ) : (
        <FantasyNews />
      )}
    </main>
  );
}

function FeedEmpty() {
  return (
    <div className="flex flex-col items-center px-8 py-14 text-center">
      <div className="w-36 overflow-hidden rounded-xl bg-m-muted/40 p-3">
        <div className="flex items-center gap-2">
          <span className="size-6 rounded-full bg-m-muted/50" />
          <span className="h-2.5 flex-1 rounded-full bg-m-muted/50" />
        </div>
        <div className="mt-3 h-14 rounded-lg bg-m-muted/50" />
      </div>
      <p className="mt-5 font-display text-2xl font-bold text-m-section">No Activity Yet</p>
      <p className="mt-2 text-sm text-m-muted">Adds, drops, waivers and trades in your league will show up here.</p>
    </div>
  );
}

function FantasyNews() {
  const { data: items = [], isPending, isError } = useQuery({
    queryKey: ["mobile-fantasy-news"],
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: loadFantasyNews,
  });

  return (
    <section className="px-3 pb-4">
      <h2 className="px-1 pb-3 pt-5 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">
        Latest Fantasy News
      </h2>
      {isPending ? (
        <p className="py-10 text-center text-sm text-m-muted">Loading fantasy news...</p>
      ) : isError || !items.length ? (
        <p className="py-10 text-center text-sm text-m-muted">Fantasy news will appear here when available.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function NewsCard({ item }: { item: FeedNewsItem }) {
  const openPlayer = useOpenMobilePlayer();
  const when = relativeTime(item.published);
  const pos = item.player?.pos.toUpperCase() ?? "";
  const playerId = item.player?.id ?? null;
  const body = (
    <article className="overflow-hidden rounded-xl bg-m-card text-m-card-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
      {item.image ? <img src={item.image} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" /> : null}
      <div className="p-3.5">
        {item.player ? (
          <div
            role="button"
            tabIndex={0}
            className="mb-2.5 flex w-fit cursor-pointer items-center gap-2.5"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (playerId) openPlayer(playerId);
            }}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && playerId) {
                e.preventDefault();
                e.stopPropagation();
                openPlayer(playerId);
              }
            }}
          >
            <PlayerAvatar
              id={item.player.id}
              pos={(AVATAR_POS.has(pos) ? pos : "WR") as Pos}
              team={item.player.team ?? ""}
              name={item.player.name}
              className="size-10"
              logoClassName="hidden"
            />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold leading-tight">{item.player.name}</p>
              <p className="truncate text-xs text-m-muted">
                {item.player.team || "FA"} - {pos}
              </p>
            </div>
          </div>
        ) : null}
        <h3 className="font-display text-xl font-bold leading-tight">{item.headline}</h3>
        {item.body ? <p className="mt-1.5 line-clamp-4 text-sm leading-snug text-m-muted">{item.body}</p> : null}
        <p className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-m-muted">
          <span className="uppercase tracking-wide">{item.source}</span>
          {when ? (
            <>
              <span className="size-1 rounded-full bg-m-muted/60" />
              <span>{when}</span>
            </>
          ) : null}
        </p>
      </div>
    </article>
  );

  if (!item.href) return body;
  return "internal" in item.href ? (
    <Link to="/articles/$slug" params={{ slug: item.href.internal }} className="block">
      {body}
    </Link>
  ) : (
    <a href={item.href.external} target="_blank" rel="noreferrer" className="block">
      {body}
    </a>
  );
}
