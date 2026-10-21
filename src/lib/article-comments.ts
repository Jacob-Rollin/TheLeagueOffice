import { supabase } from "@/integrations/supabase/client";

export type ArticleComment = {
  id: string;
  article_id: string;
  user_id: string;
  author_name: string;
  body: string;
  created_at: string;
};

const COLUMNS = "id, article_id, user_id, author_name, body, created_at";

export async function listArticleComments(articleId: string): Promise<ArticleComment[]> {
  const { data, error } = await supabase
    .from("article_comments")
    .select(COLUMNS)
    .eq("article_id", articleId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as ArticleComment[];
}

export async function postArticleComment(input: {
  articleId: string;
  userId: string;
  authorName: string;
  body: string;
}): Promise<ArticleComment> {
  const body = input.body.trim();
  if (!body) throw new Error("Comment cannot be empty.");
  if (body.length > 1000) throw new Error("Comment must be 1000 characters or fewer.");
  const author = input.authorName.trim() || "Member";
  const { data, error } = await supabase
    .from("article_comments")
    .insert({
      article_id: input.articleId,
      user_id: input.userId,
      author_name: author.slice(0, 80),
      body,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as ArticleComment;
}

export async function deleteArticleComment(commentId: string): Promise<void> {
  const { error } = await supabase.from("article_comments").delete().eq("id", commentId);
  if (error) throw new Error(error.message);
}
