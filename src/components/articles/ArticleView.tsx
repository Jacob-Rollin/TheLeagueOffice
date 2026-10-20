import type { ReactNode } from "react";

import {
  ArticleHero,
  articleFeaturedFromRow,
} from "@/components/articles/ArticleHero";
import type { ArticleRow } from "@/lib/articles";

export type ArticleViewData = Pick<
  ArticleRow,
  | "title"
  | "category"
  | "summary"
  | "content"
  | "image_url"
  | "author_name"
  | "created_at"
  | "featured_player_id"
  | "featured_player_name"
  | "featured_player_pos"
  | "featured_player_team"
>;

/** Published article layout, shared by the article page and the editor preview. */
export function ArticleView({ article, footer }: { article: ArticleViewData; footer?: ReactNode }) {
  const featured = articleFeaturedFromRow(article);

  return (
    <article className="overflow-hidden rounded-xl border border-border/80 bg-card">
      {article.image_url ? (
        <ArticleHero imageUrl={article.image_url} title={article.title} featured={featured} />
      ) : null}
      <div className="p-6 md:p-8">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-600">
          League Office · {article.category}
        </p>
        <h1 className="mt-2 text-3xl font-black leading-tight tracking-tight text-zinc-950 md:text-4xl">
          {article.title}
        </h1>
        <p className="mt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          By {article.author_name}
          {article.created_at ? ` · ${new Date(article.created_at).toLocaleDateString()}` : ""}
        </p>
        {article.summary ? (
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">{article.summary}</p>
        ) : null}
        <div
          className={
            "mt-6 space-y-4 text-base leading-relaxed text-foreground " +
            "[&_a]:text-blue-600 [&_a]:underline " +
            "[&_blockquote]:my-6 [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-4 [&_blockquote]:border-blue-600 [&_blockquote]:bg-blue-50/50 [&_blockquote]:px-5 [&_blockquote]:py-4 [&_blockquote]:italic " +
            "[&_h1]:mb-3 [&_h1]:mt-8 [&_h1]:text-3xl [&_h1]:font-black [&_h1]:tracking-tight " +
            "[&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:text-2xl [&_h2]:font-bold " +
            "[&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold " +
            "[&_img]:my-6 [&_img]:h-auto [&_img]:w-full [&_img]:max-w-full [&_img]:rounded-xl [&_img]:border [&_img]:border-border/10 [&_img]:object-cover " +
            "[&_p]:mb-4 " +
            /* Structured weekly-desk player breaks */
            "[&_.lo-player-hero]:my-8 [&_.lo-player-hero]:overflow-hidden [&_.lo-player-hero]:rounded-xl [&_.lo-player-hero]:border [&_.lo-player-hero]:border-slate-200 [&_.lo-player-hero]:bg-slate-50 " +
            "[&_.lo-player-hero__head]:flex [&_.lo-player-hero__head]:items-center [&_.lo-player-hero__head]:gap-4 [&_.lo-player-hero__head]:border-b [&_.lo-player-hero__head]:border-slate-200 [&_.lo-player-hero__head]:bg-white [&_.lo-player-hero__head]:p-4 " +
            "[&_.lo-player-hero__head_img]:size-16 [&_.lo-player-hero__head_img]:rounded-full [&_.lo-player-hero__head_img]:object-cover " +
            "[&_.lo-player-hero__body]:p-4 [&_.lo-player-hero__body_p]:mb-0 " +
            "[&_.lo-player-row]:my-3 [&_.lo-player-row]:flex [&_.lo-player-row]:gap-3 [&_.lo-player-row]:rounded-lg [&_.lo-player-row]:border [&_.lo-player-row]:border-slate-100 [&_.lo-player-row]:bg-white [&_.lo-player-row]:p-3 " +
            "[&_.lo-player-row_img]:size-11 [&_.lo-player-row_img]:shrink-0 [&_.lo-player-row_img]:rounded-full [&_.lo-player-row_img]:object-cover " +
            "[&_.lo-player-row__copy_p]:mb-1 [&_.lo-player-row__copy_p]:text-sm"
          }
          // Content is authored by league admins / weekly desk only.
          dangerouslySetInnerHTML={{ __html: article.content }}
        />
        {footer}
      </div>
    </article>
  );
}
