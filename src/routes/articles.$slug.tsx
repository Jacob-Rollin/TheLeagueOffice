import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { ArticleShare } from "@/components/articles/ArticleShare";
import { ArticleView } from "@/components/articles/ArticleView";
import { RecentFantasyArticles } from "@/components/articles/RecentFantasyArticles";
import { StandingsPanel } from "@/components/league/StandingsPanel";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { getArticleBySlug } from "@/lib/articles";
import { getArticleShareMeta } from "@/lib/articles.functions";
import { cn } from "@/lib/utils";


const DEFAULT_META = [
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
  { property: "og:site_name", content: "The League Office" },
  { name: "twitter:card", content: "summary" },
];

export const Route = createFileRoute("/articles/$slug")({
  // Loader and head run on the server so link-preview bots see real article tags;
  // the page itself still renders client-side.
  ssr: "data-only",
  loader: async ({ params }) => {
    try {
      return await getArticleShareMeta({ data: { slug: params.slug } });
    } catch {
      return null;
    }
  },
  staleTime: 5 * 60 * 1000,
  head: ({ loaderData }) => {
    const meta = loaderData;
    if (!meta) return { meta: DEFAULT_META };
    const title = `${meta.title} — The League Office`;
    return {
      meta: [
        { title },
        { name: "description", content: meta.description },
        { property: "og:site_name", content: "The League Office" },
        { property: "og:type", content: "article" },
        { property: "og:title", content: meta.title },
        { property: "og:description", content: meta.description },
        ...(meta.url ? [{ property: "og:url", content: meta.url }] : []),
        ...(meta.image
          ? [
              { property: "og:image", content: meta.image },
              { property: "og:image:alt", content: meta.title },
              { name: "twitter:image", content: meta.image },
            ]
          : []),
        { name: "twitter:card", content: meta.imageIsCover ? "summary_large_image" : "summary" },
        { name: "twitter:title", content: meta.title },
        { name: "twitter:description", content: meta.description },
        ...(meta.publishedAt ? [{ property: "article:published_time", content: meta.publishedAt }] : []),
        ...(meta.category ? [{ property: "article:section", content: meta.category }] : []),
        ...(meta.author ? [{ property: "article:author", content: meta.author }] : []),
      ],
      links: meta.url ? [{ rel: "canonical", href: meta.url }] : [],
    };
  },
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
            <ArticleView
              article={article}
              footer={<ArticleShare slug={article.slug} title={article.title} summary={article.summary} />}
            />
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
          <RecentFantasyArticles />
        </aside>
      </div>
    </main>
  );
}
