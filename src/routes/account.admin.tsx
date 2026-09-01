import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { AccountShell } from "@/components/account/AccountShell";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { generateInviteCode, listInviteCodes, type InviteCodeRow } from "@/lib/inviteCodes";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/account/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin — The League Office" },
      {
        name: "description",
        content: "Generate and review League Office invite codes.",
      },
      { property: "og:title", content: "Admin — The League Office" },
      { property: "og:description", content: "League Office invite code admin tools." },
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

function AdminPage() {
  const { user, ready } = useAuth();
  const { data: isAdmin, isFetched, isError } = useIsAdmin(user?.id ?? null);

  if (ready && user && isFetched && (isError || !isAdmin)) {
    return <Navigate to="/account" />;
  }

  return (
    <AccountShell title="Admin" active="admin">
      <Toaster />
      <InviteCodeGenerator userId={user?.id ?? null} />
    </AccountShell>
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
                  <td className="px-3 py-2 text-foreground">
                    {row.is_used ? "Used" : "Available"}
                  </td>
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
