import { createServerFn } from "@tanstack/react-start";

export type ArticleShareMeta = {
  slug: string;
  title: string;
  description: string;
  category: string | null;
  author: string | null;
  publishedAt: string | null;
  url: string | null;
  image: string | null;
  imageIsCover: boolean;
};

function plainExcerpt(html: string, max = 180): string {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Link-preview metadata for a published article. Drafts return null so they never leak. */
export const getArticleShareMeta = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => ({ slug: String(input.slug ?? "").slice(0, 120) }))
  .handler(async ({ data }): Promise<ArticleShareMeta | null> => {
    if (!data.slug) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("articles")
      .select("slug, title, summary, content, image_url, category, author_name, created_at")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (!row) return null;

    let origin: string | null = null;
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const req = getRequest();
      const reqUrl = new URL(req.url);
      const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || reqUrl.protocol.replace(":", "");
      const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || reqUrl.host;
      origin = `${proto}://${host}`;
    } catch {
      origin = null;
    }

    const absolute = (path: string | null | undefined) => {
      const p = path?.trim();
      if (!p) return null;
      if (/^https?:\/\//i.test(p)) return p;
      return origin ? `${origin}${p.startsWith("/") ? "" : "/"}${p}` : null;
    };

    const cover = absolute(row.image_url);
    return {
      slug: row.slug,
      title: row.title,
      description: row.summary?.trim() || plainExcerpt(row.content ?? ""),
      category: row.category ?? null,
      author: row.author_name ?? null,
      publishedAt: row.created_at ?? null,
      url: absolute(`/articles/${row.slug}`),
      image: cover ?? absolute("/the-league-logo.png"),
      imageIsCover: Boolean(cover),
    };
  });
