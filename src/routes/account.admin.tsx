import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AccountShell } from "@/components/account/AccountShell";
import { ArticleEditor } from "@/components/account/ArticleEditor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

type AdminSearch = {
  tab?: "invites" | "articles" | "users" | undefined;
  edit?: string | undefined;
};

export const Route = createFileRoute("/account/admin")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): AdminSearch => ({
    tab:
      search["tab"] === "articles"
        ? "articles"
        : search["tab"] === "users"
          ? "users"
          : search["tab"] === "invites"
            ? "invites"
            : undefined,
    edit: typeof search["edit"] === "string" ? search["edit"] : undefined,
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

type SubTab = "invites" | "articles" | "users";

type ProfileAdminRow = {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  is_verified: boolean | null;
};

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
        <button type="button" className={tabClass("users")} onClick={() => setTab("users")}>
          Users
        </button>
      </div>

      {tab === "invites" ? (
        <InviteCodeGenerator userId={user?.id ?? null} />
      ) : tab === "articles" ? (
        <ArticlesManager
          authorName={user?.email ?? "The League Office"}
          initialEditId={search.edit ?? null}
        />
      ) : (
        <UsersManager currentUserId={user?.id ?? null} currentUserEmail={user?.email ?? null} />
      )}
    </AccountShell>
  );
}

function profileInitials(name: string | null, email: string): string {
  const source = (name?.trim() || email.split("@")[0] || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function roleLabel(role: string | null | undefined): string {
  const normalized = (role ?? "user").trim().toLowerCase();
  if (normalized === "admin") return "admin";
  if (normalized === "standard") return "standard";
  return "user";
}

function UsersManager({
  currentUserId,
  currentUserEmail,
}: {
  currentUserId: string | null;
  currentUserEmail: string | null;
}) {
  const { data: isAdmin, isFetched, isError } = useIsAdmin(currentUserId);
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const authorized = isFetched && !isError && isAdmin === true && Boolean(currentUserEmail);

  const { data: profiles, isLoading, error } = useQuery({
    queryKey: ["admin-profiles"],
    enabled: authorized,
    retry: false,
    queryFn: async (): Promise<ProfileAdminRow[]> => {
      // Fetch every profile row — no role or session filters.
      const { data, error: queryError } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url, role, is_verified")
        .order("created_at", { ascending: false });
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as ProfileAdminRow[];
    },
  });

  // Render the full result set with no role-based client filtering.
  const rows = profiles ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
  };

  const toggleAdmin = async (row: ProfileAdminRow) => {
    const currentRole = (row.role ?? "user").trim().toLowerCase();
    const nextRole: "admin" | "user" = currentRole === "admin" ? "user" : "admin";
    setBusyId(row.id);
    try {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ role: nextRole })
        .eq("id", row.id);
      if (updateError) {
        console.error("[toggleAdmin]", updateError);
        toast.error(updateError.message);
        return;
      }
      toast.success(nextRole === "admin" ? "Admin role granted." : "Admin role removed.");
      refresh();
    } catch (err) {
      console.error("[toggleAdmin]", err);
      toast.error(err instanceof Error ? err.message : "Could not update user role.");
    } finally {
      setBusyId(null);
    }
  };

  const removeAccount = async (row: ProfileAdminRow) => {
    if (row.id === currentUserId) {
      toast.error("You cannot remove your own account from this list.");
      return;
    }
    if (!window.confirm("Are you sure you want to remove this user account?")) return;
    setBusyId(row.id);
    try {
      const { error: deleteError } = await supabase.from("profiles").delete().eq("id", row.id);
      if (deleteError) throw new Error(deleteError.message);
      toast.success("User account removed.");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove user account.");
    } finally {
      setBusyId(null);
    }
  };

  if (!isFetched) {
    return (
      <section className={cardClass}>
        <p className="text-sm text-muted-foreground">Loading authorization…</p>
      </section>
    );
  }

  if (!authorized) {
    return (
      <section className={cardClass}>
        <p className="font-display text-sm uppercase tracking-wide text-destructive">
          Access denied. Admin privileges are required to manage users.
        </p>
      </section>
    );
  }

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display-title text-lg uppercase tracking-wide">Users</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review registered profiles, toggle admin access, and remove accounts when needed.
          </p>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                User
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Email
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Role
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
                  Loading users…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-destructive">
                  {error instanceof Error ? error.message : "Could not load users."}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-muted-foreground">
                  No user profiles registered on the platform.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const label = roleLabel(row.role);
                const initials = profileInitials(row.full_name, row.email);
                return (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        {row.avatar_url ? (
                          <img
                            src={row.avatar_url}
                            alt=""
                            loading="lazy"
                            className="h-8 w-8 shrink-0 rounded-full border border-border object-cover"
                          />
                        ) : (
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {initials}
                          </span>
                        )}
                        <span className="truncate font-medium text-foreground">
                          {row.full_name?.trim() || "Unnamed user"}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <span className="block truncate">{row.email}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium capitalize text-muted-foreground">
                        {label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          disabled={busyId === row.id}
                          className={cn(blueButton, "px-3 py-1.5 text-xs")}
                        >
                          {busyId === row.id ? "Working…" : "Actions"}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            className="font-medium"
                            onSelect={() => {
                              void toggleAdmin(row);
                            }}
                          >
                            Toggle Admin
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="font-medium text-red-600 focus:text-red-700"
                            onSelect={() => {
                              void removeAccount(row);
                            }}
                          >
                            Remove Account
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ArticlesManager({
  authorName,
  initialEditId,
}: {
  authorName: string;
  initialEditId: string | null;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ArticleRow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);

  const { data: articles, isLoading, error } = useQuery({
    queryKey: ["admin-articles"],
    retry: false,
    queryFn: (): Promise<ArticleRow[]> => listArticles(),
  });

  useEffect(() => {
    if (autoOpened || !initialEditId || !articles?.length) return;
    const row = articles.find((item) => item.id === initialEditId);
    setAutoOpened(true);
    if (!row) return;
    setEditing(row);
    setEditorOpen(true);
  }, [articles, autoOpened, initialEditId]);


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
