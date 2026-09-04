import { supabase } from "@/integrations/supabase/client";

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
};

const COLUMNS =
  "id, title, slug, category, summary, content, image_url, author_name, published, created_at";

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || `article-${Date.now()}`;
}

export async function listArticles(): Promise<ArticleRow[]> {
  const { data, error } = await supabase
    .from("articles")
    .select(COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ArticleRow[];
}

export async function latestPublishedArticle(): Promise<ArticleRow | null> {
  const { data, error } = await supabase
    .from("articles")
    .select(COLUMNS)
    .eq("published", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ArticleRow | null) ?? null;
}

export async function getArticleBySlug(slug: string): Promise<ArticleRow | null> {
  const { data, error } = await supabase
    .from("articles")
    .select(COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ArticleRow | null) ?? null;
}

export type ArticleInput = {
  title: string;
  category: string;
  summary: string;
  content: string;
  image_url: string;
  author_name: string;
  published: boolean;
};

export async function createArticle(input: ArticleInput): Promise<ArticleRow> {
  const { data, error } = await supabase
    .from("articles")
    .insert({ ...input, slug: slugify(input.title) })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as ArticleRow;
}

export async function updateArticle(id: string, input: ArticleInput): Promise<ArticleRow> {
  const { data, error } = await supabase
    .from("articles")
    .update({ ...input, slug: slugify(input.title) })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as ArticleRow;
}

export async function deleteArticle(id: string): Promise<void> {
  const { error } = await supabase.from("articles").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
