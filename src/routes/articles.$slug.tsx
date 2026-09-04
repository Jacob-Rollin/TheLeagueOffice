import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { StandingsPanel } from "@/components/league/StandingsPanel";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { getArticleBySlug } from "@/lib/articles";


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

const imageClass = "w-full max-w-full h-auto object-cover rounded-xl shadow-sm border border-border/10";

const blueButton =
  "block w-full rounded-md bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90";

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
    <main className="mx-auto w-full max-w-7xl px-4 pb-16 md:px-8">
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Link
            to="/"
            className="mb-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to the feed
          </Link>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading article…</p>
          ) : error ? (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Could not load this article."}
            </p>
          ) : !article ? (
            <p className="text-sm text-muted-foreground">This article is no longer available.</p>
          ) : (
            <article className="overflow-hidden rounded-xl border border-border bg-card">
              {article.image_url && (
                <img src={article.image_url} alt={article.title} className={imageClass} />
              )}
              <div className="p-6">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                  {article.category}
                </p>
                <h1 className="mt-2 text-3xl font-black leading-tight tracking-tight text-foreground md:text-4xl">
                  {article.title}
                </h1>
                <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  By {article.author_name}
                  {article.created_at ? ` • ${new Date(article.created_at).toLocaleDateString()}` : ""}
                </p>
                <p className="mt-4 text-base leading-relaxed text-muted-foreground">{article.summary}</p>
                <div
                  className="mt-6 space-y-4 text-base leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_blockquote]:my-6 [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-4 [&_blockquote]:border-primary [&_blockquote]:bg-muted/15 [&_blockquote]:px-5 [&_blockquote]:py-4 [&_blockquote]:italic [&_h1]:mb-3 [&_h1]:mt-8 [&_h1]:text-3xl [&_h1]:font-black [&_h1]:tracking-tight [&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_img]:my-6 [&_img]:h-auto [&_img]:w-full [&_img]:max-w-full [&_img]:rounded-xl [&_img]:border [&_img]:border-border/10 [&_img]:object-cover [&_img]:shadow-sm [&_p]:mb-4"
                  // Content is authored by league admins only.
                  dangerouslySetInnerHTML={{ __html: article.content }}
                />
              </div>
            </article>
          )}
        </div>

        <aside className="min-w-0 space-y-0 lg:col-span-1">
          <StandingsPanel />
        </aside>
      </div>
    </main>
  );
}
