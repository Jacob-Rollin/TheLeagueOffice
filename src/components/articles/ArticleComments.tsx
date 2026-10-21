import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "@tanstack/react-router";

import { AuthDialog } from "@/components/auth/AuthDialog";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
  deleteArticleComment,
  listArticleComments,
  postArticleComment,
} from "@/lib/article-comments";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const textareaClass =
  "mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600";

export function ArticleComments({ articleId }: { articleId: string }) {
  const { user, ready } = useAuth();
  const { data: isAdmin } = useIsAdmin(user?.id ?? null);
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commentsQuery = useQuery({
    queryKey: ["article-comments", articleId],
    queryFn: () => listArticleComments(articleId),
    staleTime: 30_000,
  });

  const profileQuery = useQuery({
    queryKey: ["profile-display-name", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", user!.id)
        .maybeSingle();
      if (err) throw new Error(err.message);
      return data;
    },
  });

  const postMutation = useMutation({
    mutationFn: postArticleComment,
    onSuccess: async () => {
      setBody("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["article-comments", articleId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteArticleComment,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["article-comments", articleId] });
    },
  });

  const comments = commentsQuery.data ?? [];
  const metaName =
    typeof user?.user_metadata?.["full_name"] === "string"
      ? user.user_metadata["full_name"]
      : "";
  const displayName =
    profileQuery.data?.full_name?.trim() ||
    metaName.trim() ||
    user?.email?.split("@")[0] ||
    "Member";

  const submit = () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    const trimmed = body.trim();
    if (!trimmed) {
      setError("Write a comment first.");
      return;
    }
    postMutation.mutate({
      articleId,
      userId: user.id,
      authorName: String(displayName),
      body: trimmed,
    });
  };

  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h2 className="display-title text-lg uppercase tracking-wide text-slate-900">
          Comments
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Signed-in members only · {comments.length}{" "}
          {comments.length === 1 ? "comment" : "comments"}
        </p>
      </header>

      <div className="space-y-4 p-4">
        {!ready ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !user ? (
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-slate-800">
            <button
              type="button"
              className="font-semibold text-blue-700 underline"
              onClick={() => setAuthOpen(true)}
            >
              Sign in
            </button>{" "}
            to join the discussion. Guests cannot post comments.
            <p className="mt-1 text-xs text-muted-foreground">
              No account?{" "}
              <Link
                to="/auth"
                search={{ mode: "signup" }}
                className="font-semibold text-blue-700 underline"
              >
                Create one
              </Link>
              .
            </p>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-700" htmlFor="article-comment">
              Add a comment
            </label>
            <textarea
              id="article-comment"
              className={textareaClass}
              rows={3}
              maxLength={1000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Share your take…"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Posting as {displayName}</p>
              <button
                type="button"
                className={cn(
                  "rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white",
                  "hover:bg-blue-700 disabled:opacity-60",
                )}
                disabled={postMutation.isPending || !body.trim()}
                onClick={submit}
              >
                {postMutation.isPending ? "Posting…" : "Post comment"}
              </button>
            </div>
            {error ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}

        {commentsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading comments…</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {comments.map((c) => {
              const canDelete = user?.id === c.user_id || isAdmin === true;
              return (
                <li key={c.id} className="flex gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-semibold text-slate-900">{c.author_name}</span>
                      <time
                        className="text-[11px] uppercase tracking-wide text-muted-foreground"
                        dateTime={c.created_at}
                      >
                        {new Date(c.created_at).toLocaleString()}
                      </time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                      {c.body}
                    </p>
                  </div>
                  {canDelete ? (
                    <button
                      type="button"
                      className="shrink-0 self-start text-xs font-semibold text-slate-500 hover:text-red-600"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(c.id)}
                    >
                      Delete
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AuthDialog open={authOpen} mode="signin" onOpenChange={setAuthOpen} />
    </section>
  );
}
