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
            /* NFL Fantasy-style: boxed player header only; prose stays normal article text */
            "[&_.lo-priority]:my-8 [&_.lo-priority__list]:my-3 [&_.lo-priority__list]:list-none [&_.lo-priority__list]:space-y-2 [&_.lo-priority__list]:pl-0 " +
            "[&_.lo-priority__list_li]:text-base [&_.lo-priority__list_li]:leading-snug " +
            "[&_.lo-priority__rank]:mr-1 [&_.lo-priority__rank]:font-bold [&_.lo-priority__rank]:text-slate-900 " +
            "[&_.lo-player-header]:my-6 [&_.lo-player-header]:overflow-hidden [&_.lo-player-header]:rounded-xl [&_.lo-player-header]:border [&_.lo-player-header]:border-slate-200 [&_.lo-player-header]:bg-white [&_.lo-player-header]:shadow-sm " +
            "[&_.lo-player-header__inner]:flex [&_.lo-player-header__inner]:items-start [&_.lo-player-header__inner]:gap-3 [&_.lo-player-header__inner]:p-4 [&_.lo-player-header__inner]:no-underline [&_.lo-player-header__inner]:text-inherit " +
            "[&_.lo-player-header__shot]:!my-0 [&_.lo-player-header__shot]:!size-14 [&_.lo-player-header__shot]:!w-14 [&_.lo-player-header__shot]:!max-w-14 [&_.lo-player-header__shot]:shrink-0 [&_.lo-player-header__shot]:!rounded-full [&_.lo-player-header__shot]:!border-0 [&_.lo-player-header__shot]:object-cover [&_.lo-player-header__shot]:ring-1 [&_.lo-player-header__shot]:ring-slate-200 " +
            "[&_.lo-player-header__id]:flex [&_.lo-player-header__id]:min-w-0 [&_.lo-player-header__id]:flex-col [&_.lo-player-header__id]:gap-0.5 " +
            "[&_.lo-player-header__name]:text-xl [&_.lo-player-header__name]:font-bold [&_.lo-player-header__name]:leading-tight [&_.lo-player-header__name]:text-slate-900 " +
            "[&_.lo-player-header__team]:text-sm [&_.lo-player-header__team]:font-semibold [&_.lo-player-header__team]:uppercase [&_.lo-player-header__team]:tracking-wide [&_.lo-player-header__team]:text-slate-600 " +
            "[&_.lo-player-header__stat]:text-xs [&_.lo-player-header__stat]:font-bold [&_.lo-player-header__stat]:uppercase [&_.lo-player-header__stat]:tracking-wider [&_.lo-player-header__stat]:text-blue-700"
          }
          // Content is authored by league admins / weekly desk only.
          dangerouslySetInnerHTML={{ __html: article.content }}
        />
        {footer}
      </div>
    </article>
  );
}
