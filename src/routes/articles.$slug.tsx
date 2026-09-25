import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { StandingsPanel } from "@/components/league/StandingsPanel";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { getArticleBySlug } from "@/lib/articles";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/articles/$slug")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "League Office Briefing — The League Office" },
      {
        name: "description",
        content: "Read the latest front-office briefing written by The League Office desk.",
      },
      { property: "og:title", content: "League Office Briefing — The League Office" },
      {
        property: "og:description",
        content: "Front-office analysis, editorials and league intelligence briefings.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ArticlePage,
});

function ArticlePage() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const { data: isAdmin } = useIsAdmin(user?.id ?? null);
  const { data: article, isLoading, error } = useQuery({
    queryKey: ["article", slug],
    retry: false,
    queryFn: () => getArticleBySlug(slug),
  });

  return (
    <main className="mx-auto w-full max-w-shell px-4 pb-16 md:px-8">
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading article…</p>
          ) : error ? (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Could not load this article."}
            </p>
          ) : !article ? (
            <p className="text-sm text-muted-foreground">This article is no longer available.</p>
          ) : (
            <article className="overflow-hidden rounded-xl border border-border/80 bg-card">
              {article.image_url ? (
                <div className="aspect-[16/9] w-full overflow-hidden bg-slate-100">
                  <img
                    src={article.image_url}
                    alt={article.title}
                    className="h-full w-full object-cover"
                  />
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
                  {article.created_at
                    ? ` · ${new Date(article.created_at).toLocaleDateString()}`
                    : ""}
                </p>
                {article.summary ? (
                  <p className="mt-5 text-base leading-relaxed text-muted-foreground">
                    {article.summary}
                  </p>
                ) : null}
                <div
                  className="mt-6 space-y-4 text-base leading-relaxed text-foreground [&_a]:text-blue-600 [&_a]:underline [&_blockquote]:my-6 [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-4 [&_blockquote]:border-blue-600 [&_blockquote]:bg-blue-50/50 [&_blockquote]:px-5 [&_blockquote]:py-4 [&_blockquote]:italic [&_h1]:mb-3 [&_h1]:mt-8 [&_h1]:text-3xl [&_h1]:font-black [&_h1]:tracking-tight [&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_img]:my-6 [&_img]:h-auto [&_img]:w-full [&_img]:max-w-full [&_img]:rounded-xl [&_img]:border [&_img]:border-border/10 [&_img]:object-cover [&_p]:mb-4"
                  // Content is authored by league admins only.
                  dangerouslySetInnerHTML={{ __html: article.content }}
                />
              </div>
            </article>
          )}
        </div>

        <aside className="min-w-0 space-y-4 lg:col-span-1">
          <StandingsPanel />
          {isAdmin === true && (
            <section className="rounded-xl border border-border/80 bg-card p-4">
              <h2 className="display-title text-sm uppercase tracking-wide text-zinc-950">
                Admin Console
              </h2>
              <div className="mt-3 space-y-2">
                {article && (
                  <Link
                    to="/account/admin"
                    search={{ tab: "articles", edit: article.id }}
                    className={cn(
                      "block w-full rounded-md border border-blue-600 bg-transparent px-4 py-2",
                      "text-center text-sm font-medium text-blue-600 transition-colors",
                      "hover:bg-blue-600 hover:text-white",
                    )}
                  >
                    Edit This Article
                  </Link>
                )}
                <Link
                  to="/account/admin"
                  search={{ tab: "articles" }}
                  className={cn(
                    "block w-full rounded-md border border-blue-600 bg-transparent px-4 py-2",
                    "text-center text-sm font-medium text-blue-600 transition-colors",
                    "hover:bg-blue-600 hover:text-white",
                  )}
                >
                  Manage All Articles
                </Link>
              </div>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
