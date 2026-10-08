import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { AccountShell } from "@/components/account/AccountShell";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import {
  getNativeLeagueSummary,
  updateNativeInviteCode,
  type NativeMemberLeagueSummary,
} from "@/lib/native-league.functions";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

export const Route = createFileRoute("/account/leagues/native/$linkId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Native League Settings — The League Office" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NativeLeagueSettingsPage,
});

const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";
const outlineClass =
  "rounded-md border border-border bg-white px-4 py-2 font-display text-sm uppercase tracking-wide text-slate-800 disabled:opacity-60";
const fieldClass =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 font-mono text-sm uppercase tracking-wider text-slate-900 outline-none focus:border-primary";

function nativeScoringLabel(preset: string | null | undefined): string {
  const key = (preset ?? "half").toLowerCase();
  if (key === "ppr") return "Full PPR";
  if (key === "std" || key === "standard") return "Standard";
  return "Half PPR";
}

function NativeLeagueSettingsPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const { setActiveLeagueId } = useActiveLeague();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ["native-league-summary", linkId],
    enabled: Boolean(userId && linkId),
    retry: false,
    queryFn: async (): Promise<NativeMemberLeagueSummary | null> =>
      getNativeLeagueSummary({ data: { linkId } }),
  });

  const [inviteDraft, setInviteDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (summary?.inviteCode) setInviteDraft(summary.inviteCode);
  }, [summary?.inviteCode]);

  const canEditInvite = summary?.canEditInvite === true;

  const saveInvite = async () => {
    if (!canEditInvite || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await updateNativeInviteCode({
        data: { linkId, inviteCode: inviteDraft },
      });
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setInviteDraft(result.inviteCode);
      await queryClient.invalidateQueries({ queryKey: ["native-league-summary", linkId] });
      toast.success("Invite code updated.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not update invite code.");
    } finally {
      setSaving(false);
    }
  };

  const copyInvite = async () => {
    const code = (canEditInvite ? inviteDraft : summary?.inviteCode ?? "").trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Invite code copied.");
    } catch {
      toast.error("Could not copy invite code.");
    }
  };

  if (!userId) {
    return (
      <AccountShell title="League Settings" active="leagues">
        <p className="text-sm text-muted-foreground">Sign in to view league settings.</p>
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title="League Settings"
      active="leagues"
      action={
        <Link to="/account/leagues" className={outlineClass}>
          Back to My Leagues
        </Link>
      }
    >
      <Toaster />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading league settings…</p>
      ) : error || !summary ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load this native league."}
        </p>
      ) : (
        <div className="mx-auto max-w-2xl space-y-5">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="display-title text-xl text-slate-900">
              {summary.name} <span className="text-primary">Settings</span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Native redraft · {summary.seasonYear} ·{" "}
              {summary.role === "commissioner"
                ? "Commissioner"
                : summary.role === "co_commish"
                  ? "Co-Commish"
                  : "Member"}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="rounded-md border border-border px-2 py-1">
                {nativeScoringLabel(summary.scoringPreset)}
              </span>
              <span className="rounded-md border border-border px-2 py-1">Redraft</span>
              <span className="rounded-md border border-border px-2 py-1">
                {summary.filledTeams}/{summary.teamCount} Teams
              </span>
              <span className="rounded-md border border-border px-2 py-1 capitalize">
                {summary.status}
              </span>
              <span className="rounded-md border border-border px-2 py-1 capitalize">
                {summary.draftMode} draft
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  setActiveLeagueId(summary.linkId);
                  void navigate({ to: "/playbook" });
                }}
              >
                Open Tools
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">Invite Code</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {canEditInvite
                ? "Managers use this code on My Leagues → Join. You can customize it anytime."
                : "Ask your commissioner if you need a different code."}
            </p>

            {canEditInvite ? (
              <label className="mt-4 block text-sm font-medium text-slate-800">
                Code (4–16 letters or numbers)
                <input
                  className={fieldClass}
                  value={inviteDraft}
                  onChange={(e) =>
                    setInviteDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))
                  }
                  maxLength={16}
                  spellCheck={false}
                />
              </label>
            ) : (
              <p className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-base tracking-wider">
                {summary.inviteCode}
              </p>
            )}

            {saveError ? <p className="mt-3 text-sm text-red-600">{saveError}</p> : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={outlineClass} onClick={() => void copyInvite()}>
                Copy Code
              </button>
              {canEditInvite ? (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={saving || inviteDraft.trim().length < 4}
                  onClick={() => void saveInvite()}
                >
                  {saving ? "Saving…" : "Save Invite Code"}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </AccountShell>
  );
}
