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
            /* NFL Fantasy-style: boxed name/pos/team chip; bold meta under it; prose unboxed */
            "[&_.lo-priority]:my-8 [&_.lo-priority__list]:my-3 [&_.lo-priority__list]:list-none [&_.lo-priority__list]:space-y-2 [&_.lo-priority__list]:pl-0 " +
            "[&_.lo-priority__list_li]:text-base [&_.lo-priority__list_li]:leading-snug " +
            "[&_.lo-priority__rank]:mr-1 [&_.lo-priority__rank]:font-bold [&_.lo-priority__rank]:text-slate-900 " +
            "[&_.lo-player-header]:mb-2 [&_.lo-player-header]:mt-7 [&_.lo-player-header]:overflow-hidden [&_.lo-player-header]:rounded-xl [&_.lo-player-header]:border [&_.lo-player-header]:border-slate-200 [&_.lo-player-header]:bg-slate-50 [&_.lo-player-header]:shadow-sm " +
            "[&_.lo-player-header_a]:!text-inherit [&_.lo-player-header_a]:!no-underline " +
            "[&_.lo-player-header__inner]:flex [&_.lo-player-header__inner]:items-center [&_.lo-player-header__inner]:gap-3 [&_.lo-player-header__inner]:p-4 " +
            "[&_.lo-player-header__shot]:!my-0 [&_.lo-player-header__shot]:!size-14 [&_.lo-player-header__shot]:!h-14 [&_.lo-player-header__shot]:!w-14 [&_.lo-player-header__shot]:!max-w-[3.5rem] [&_.lo-player-header__shot]:shrink-0 [&_.lo-player-header__shot]:!rounded-full [&_.lo-player-header__shot]:!border-0 [&_.lo-player-header__shot]:object-cover [&_.lo-player-header__shot]:ring-1 [&_.lo-player-header__shot]:ring-slate-200 " +
            "[&_.lo-player-header__id]:flex [&_.lo-player-header__id]:min-w-0 [&_.lo-player-header__id]:flex-col [&_.lo-player-header__id]:gap-1 " +
            "[&_.lo-player-header__name]:block [&_.lo-player-header__name]:text-xl [&_.lo-player-header__name]:font-bold [&_.lo-player-header__name]:leading-tight [&_.lo-player-header__name]:text-slate-900 " +
            "[&_.lo-player-header__sub]:block [&_.lo-player-header__sub]:text-sm [&_.lo-player-header__sub]:font-semibold [&_.lo-player-header__sub]:uppercase [&_.lo-player-header__sub]:tracking-wide [&_.lo-player-header__sub]:text-slate-500 " +
            "[&_.lo-player-meta]:mb-3 [&_.lo-player-meta]:mt-0 [&_.lo-player-meta]:text-sm [&_.lo-player-meta]:font-bold [&_.lo-player-meta]:uppercase [&_.lo-player-meta]:tracking-wide [&_.lo-player-meta]:text-slate-900"
          }
          // Content is authored by league admins / weekly desk only.
          dangerouslySetInnerHTML={{ __html: article.content }}
        />
        {footer}
      </div>
    </article>
  );
}
