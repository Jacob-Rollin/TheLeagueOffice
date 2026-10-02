import type { ReactNode } from "react";

import type { ArticleRow } from "@/lib/articles";

export type ArticleViewData = Pick<
  ArticleRow,
  "title" | "category" | "summary" | "content" | "image_url" | "author_name" | "created_at"
>;

/** Published article layout, shared by the article page and the editor preview. */
export function ArticleView({ article, footer }: { article: ArticleViewData; footer?: ReactNode }) {
  return (
    <article className="overflow-hidden rounded-xl border border-border/80 bg-card">
      {article.image_url ? (
        <div className="aspect-[16/9] w-full overflow-hidden bg-slate-100">
          <img src={article.image_url} alt={article.title} className="h-full w-full object-cover" />
        </div>
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
          className="mt-6 space-y-4 text-base leading-relaxed text-foreground [&_a]:text-blue-600 [&_a]:underline [&_blockquote]:my-6 [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-4 [&_blockquote]:border-blue-600 [&_blockquote]:bg-blue-50/50 [&_blockquote]:px-5 [&_blockquote]:py-4 [&_blockquote]:italic [&_h1]:mb-3 [&_h1]:mt-8 [&_h1]:text-3xl [&_h1]:font-black [&_h1]:tracking-tight [&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_img]:my-6 [&_img]:h-auto [&_img]:w-full [&_img]:max-w-full [&_img]:rounded-xl [&_img]:border [&_img]:border-border/10 [&_img]:object-cover [&_p]:mb-4"
          // Content is authored by league admins only.
          dangerouslySetInnerHTML={{ __html: article.content }}
        />
        {footer}
      </div>
    </article>
  );
}
