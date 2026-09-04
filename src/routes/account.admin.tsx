import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AccountShell } from "@/components/account/AccountShell";
import { ArticleEditor } from "@/components/account/ArticleEditor";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import {
  createArticle,
  deleteArticle,
  listArticles,
  updateArticle,
  type ArticleInput,
  type ArticleRow,
} from "@/lib/articles";
import { generateInviteCode, listInviteCodes, type InviteCodeRow } from "@/lib/inviteCodes";
import { cn } from "@/lib/utils";

type AdminSearch = { tab?: "invites" | "articles" | undefined; edit?: string | undefined };

export const Route = createFileRoute("/account/admin")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): AdminSearch => ({
    tab: search['tab'] === "articles" ? "articles" : search['tab'] === "invites" ? "invites" : undefined,
    edit: typeof search['edit'] === "string" ? search['edit'] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Admin — The League Office" },
      {
        name: "description",
        content: "Generate invite codes and publish League Office articles.",
      },
      { property: "og:title", content: "Admin — The League Office" },
      { property: "og:description", content: "League Office invite code and editorial admin tools." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});


const cardClass = "rounded-xl border border-border bg-card p-6";
const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";
const blueButton =
  "rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60";

type SubTab = "invites" | "articles";

function AdminPage() {
  const { user, ready } = useAuth();
  const { data: isAdmin, isFetched, isError } = useIsAdmin(user?.id ?? null);
  const search = Route.useSearch();
  const [tab, setTab] = useState<SubTab>(search.tab ?? "invites");

  const tabClass = (value: SubTab) =>
    cn(
      "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
      tab === value
        ? "border-accent text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );

  if (!ready || !isFetched) {
    return (
      <AccountShell title="Admin" active="admin">
        <div className="p-6 font-display text-sm uppercase tracking-wide text-muted-foreground">
          Loading Authorization...
        </div>
      </AccountShell>
    );
  }

  if (isError || !isAdmin) {
    return (
      <AccountShell title="Admin" active="admin">
        <div className="p-6 font-display text-sm uppercase tracking-wide text-destructive">
          Unauthorized Access — Admin Privileges Required.
        </div>
      </AccountShell>
    );
  }

  return (
    <AccountShell title="Admin" active="admin">
      <Toaster />
      <div className="mb-5 flex gap-2 border-b border-border">
        <button type="button" className={tabClass("invites")} onClick={() => setTab("invites")}>
          Invite Codes
        </button>
        <button type="button" className={tabClass("articles")} onClick={() => setTab("articles")}>
          Articles
        </button>
      </div>

      {tab === "invites" ? (
        <InviteCodeGenerator userId={user?.id ?? null} />
      ) : (
        <ArticlesManager authorName={user?.email ?? "The League Office"} />
      )}
    </AccountShell>
  );
}

function ArticlesManager({ authorName }: { authorName: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ArticleRow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: articles, isLoading, error } = useQuery({
    queryKey: ["admin-articles"],
    retry: false,
    queryFn: (): Promise<ArticleRow[]> => listArticles(),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-articles"] });
    void queryClient.invalidateQueries({ queryKey: ["latest-article"] });
  };

  const save = async (input: ArticleInput) => {
    setSaving(true);
    try {
      if (editing) await updateArticle(editing.id, input);
      else await createArticle(input);
      toast.success(editing ? "Article updated." : "Article published.");
      setEditorOpen(false);
      setEditing(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the article.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: ArticleRow) => {
    try {
      await deleteArticle(row.id);
      toast.success("Article deleted.");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the article.");
    }
  };

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display-title text-lg uppercase tracking-wide">Articles</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Write and manage League Office editorials featured on the homepage news feed.
          </p>
        </div>
        <button
          type="button"
          className={blueButton}
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          Create New Article
        </button>
      </div>

      <div className="mt-5 divide-y divide-border overflow-hidden rounded-lg border border-border">
        {isLoading ? (
          <p className="px-3 py-6 text-sm text-muted-foreground">Loading articles…</p>
        ) : error ? (
          <p className="px-3 py-6 text-sm text-destructive">
            {error instanceof Error ? error.message : "Could not load articles."}
          </p>
        ) : !articles?.length ? (
          <p className="px-3 py-6 text-sm text-muted-foreground">
            No articles yet. Create one to feature it on the homepage.
          </p>
        ) : (
          articles.map((row) => (
            <div key={row.id} className="flex items-center gap-3 px-3 py-2">
              <img
                src={row.image_url}
                alt={row.title}
                loading="lazy"
                className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{row.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.author_name} • {row.category}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Edit ${row.title}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
                onClick={() => {
                  setEditing(row);
                  setEditorOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${row.title}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-red-600 hover:bg-red-50"
                onClick={() => remove(row)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </div>

      {editorOpen && (
        <ArticleEditor
          article={editing}
          authorName={authorName}
          saving={saving}
          onCancel={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
          onSave={save}
        />
      )}
    </section>
  );
}

function InviteCodeGenerator({ userId }: { userId: string | null }) {
  const [busy, setBusy] = useState(false);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [codes, setCodes] = useState<InviteCodeRow[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["invite-codes"],
    retry: false,
    queryFn: (): Promise<InviteCodeRow[]> => listInviteCodes(),
  });

  useEffect(() => {
    if (data) setCodes(data);
  }, [data]);

  const generate = async () => {
    if (!userId) {
      setOk(false);
      setStatus("Sign in to generate invite codes.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const row = await generateInviteCode(userId);
      setCodes((prev) => [row, ...prev.filter((item) => item.code !== row.code)]);
      setOk(true);
      setStatus(`Created invite code ${row.code}.`);
    } catch (err) {
      setOk(false);
      setStatus(err instanceof Error ? err.message : "Could not generate invite code.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (code: InviteCodeRow) => {
    setDeletingCode(code.code);
    try {
      const { error: deleteError } = await supabase.from("invite_codes").delete().eq("code", code.code);
      if (deleteError) throw new Error(deleteError.message);
      setCodes((prev) => prev.filter((item) => item.code !== code.code));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not delete invite code.";
      toast.error(message);
      setOk(false);
      setStatus(message);
    } finally {
      setDeletingCode(null);
    }
  };

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display-title text-lg uppercase tracking-wide">Invite Code Generator</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Generate and manage single-use invitation codes for new user registration; active codes
            are automatically redeemed and removed upon signup.
          </p>
        </div>
        <button type="button" disabled={busy || !userId} className={buttonClass} onClick={generate}>
          {busy ? "Generating…" : "Generate Invite Code"}
        </button>
      </div>

      {status && (
        <p
          role="status"
          className={cn(
            "mt-4 rounded-md border px-3 py-2 text-sm",
            ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {status}
        </p>
      )}

      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Code
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Created
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Status
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-muted-foreground">
                  Loading invite codes…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-destructive">
                  {error instanceof Error ? error.message : "Could not load invite codes."}
                </td>
              </tr>
            ) : !codes?.length ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-muted-foreground">
                  No invite codes yet. Generate one to get started.
                </td>
              </tr>
            ) : (
              codes.map((row) => (
                <tr key={row.code} className="border-t border-border">
                  <td className="px-3 py-2 font-medium tracking-wide text-foreground">{row.code}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-foreground">{row.is_used ? "Used" : "Available"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={deletingCode === row.code}
                      className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-60"
                      onClick={() => remove(row)}
                    >
                      {deletingCode === row.code ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
