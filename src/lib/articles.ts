import { supabase } from "@/integrations/supabase/client";
import {
  deleteArticlePolls,
  extractPollIdsFromContent,
  syncArticlePollLinks,
} from "@/lib/article-polls";

export type ArticleRow = {
  id: string;
  title: string;
  slug: string;
  category: string;
  summary: string;
  content: string;
  image_url: string;
  author_name: string;
  published: boolean;
  created_at: string | null;
  featured_player_id: string | null;
  featured_player_name: string | null;
  featured_player_pos: string | null;
  featured_player_team: string | null;
};

const COLUMNS =
  "id, title, slug, category, summary, content, image_url, author_name, published, created_at, featured_player_id, featured_player_name, featured_player_pos, featured_player_team";

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 55);

  const uniqueId = Math.random().toString(36).substring(2, 6);

  return base ? `${base}-${uniqueId}` : `article-${Date.now()}`;
}

function mapRow(row: ArticleRow): ArticleRow {
  return {
    ...row,
    featured_player_id: row.featured_player_id ?? null,
    featured_player_name: row.featured_player_name ?? null,
    featured_player_pos: row.featured_player_pos ?? null,
    featured_player_team: row.featured_player_team ?? null,
  };
}

export async function listArticles(): Promise<ArticleRow[]> {
  const { data, error } = await supabase
    .from("articles")
    .select(COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ArticleRow[]).map(mapRow);
}

export async function latestPublishedArticle(): Promise<ArticleRow | null> {
  const rows = await listPublishedArticles(1);
  return rows[0] ?? null;
}

/** Recent published briefings for the Front Office feed (excludes optional slug). */
export async function listPublishedArticles(limit = 6): Promise<ArticleRow[]> {
  // Homepage only surfaces Waiver Wire (and manual editorials) — Start/Sit desks retired.
  const { data, error } = await supabase
    .from("articles")
    .select(COLUMNS)
    .eq("published", true)
    .neq("category", "Start Sit")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ArticleRow[])
    .filter((row) => !String(row.slug ?? "").startsWith("start-sit-week-"))
    .map(mapRow);
}

export async function getArticleBySlug(slug: string): Promise<ArticleRow | null> {
  const { data, error } = await supabase
    .from("articles")
    .select(COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as ArticleRow) : null;
}

export type ArticleInput = {
  title: string;
  category: string;
  summary: string;
  content: string;
  image_url: string;
  author_name: string;
  published: boolean;
  featured_player_id?: string | null;
  featured_player_name?: string | null;
  featured_player_pos?: string | null;
  featured_player_team?: string | null;
};

function featuredFields(input: ArticleInput) {
  return {
    featured_player_id: input.featured_player_id?.trim() || null,
    featured_player_name: input.featured_player_name?.trim() || null,
    featured_player_pos: input.featured_player_pos?.trim() || null,
    featured_player_team: input.featured_player_team?.trim() || null,
  };
}

export async function createArticle(input: ArticleInput): Promise<ArticleRow> {
  const { data, error } = await supabase
    .from("articles")
    .insert({
      title: input.title,
      category: input.category,
      summary: input.summary,
      content: input.content,
      image_url: input.image_url,
      author_name: input.author_name,
      published: input.published,
      slug: slugify(input.title),
      ...featuredFields(input),
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  const row = mapRow(data as ArticleRow);
  await syncArticlePollLinks(row.id, input.content);
  return row;
}

export async function updateArticle(id: string, input: ArticleInput): Promise<ArticleRow> {
  const { data, error } = await supabase
    .from("articles")
    .update({
      title: input.title,
      category: input.category,
      summary: input.summary,
      content: input.content,
      image_url: input.image_url,
      author_name: input.author_name,
      published: input.published,
      ...featuredFields(input),
    })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  const row = mapRow(data as ArticleRow);
  await syncArticlePollLinks(row.id, input.content);
  return row;
}

export async function deleteArticle(id: string): Promise<void> {
  // Fetch content first so we can drop polls that were never linked via article_id.
  const { data: existing, error: fetchError } = await supabase
    .from("articles")
    .select("id, content")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);

  const pollIds = extractPollIdsFromContent(String(existing?.content ?? ""));
  await deleteArticlePolls(pollIds);

  // Comments cascade via FK; linked polls also cascade after migration.
  const { error } = await supabase.from("articles").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
