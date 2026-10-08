import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  getNativeLeagueBoard,
  updateNativeInviteCode,
  updateNativeLeagueBasics,
} from "@/lib/native-league.functions";
import type { NativeDraftMode, NativeScoringPreset } from "@/lib/native-league-settings";

export const Route = createFileRoute("/league/$linkId/settings")({
  ssr: false,
  component: NativeLeagueSettingsInLeague,
});

const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";
const outlineClass =
  "rounded-md border border-border bg-white px-4 py-2 font-display text-sm uppercase tracking-wide text-slate-800";
const fieldClass =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary";
const labelClass = "block text-sm font-medium text-slate-800";

function NativeLeagueSettingsInLeague() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: board } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });

  const [name, setName] = useState("");
  const [scoringPreset, setScoringPreset] = useState<NativeScoringPreset>("half");
  const [draftMode, setDraftMode] = useState<NativeDraftMode>("offline");
  const [inviteDraft, setInviteDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!board) return;
    setName(board.summary.name);
    setScoringPreset((board.summary.scoringPreset as NativeScoringPreset) || "half");
    setDraftMode(board.summary.draftMode === "live" ? "live" : "offline");
    setInviteDraft(board.summary.inviteCode);
  }, [board]);

  if (!board) return null;
  const { summary, canManage, settingsLocked } = board;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] });
    await queryClient.invalidateQueries({ queryKey: ["native-league-summary", linkId] });
    await queryClient.invalidateQueries({ queryKey: ["native-league-summaries"] });
    await queryClient.invalidateQueries({ queryKey: ["native-league-links"] });
    await queryClient.invalidateQueries({ queryKey: ["active-league-connections"] });
  };

  const saveBasics = async () => {
    if (!canManage || saving) return;
    setSaving(true);
    try {
      const result = await updateNativeLeagueBasics({
        data: {
          linkId,
          name,
          scoringPreset,
          draftMode,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("League settings saved.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const saveInvite = async () => {
    if (!summary.canEditInvite || saving) return;
    setSaving(true);
    try {
      const result = await updateNativeInviteCode({
        data: { linkId, inviteCode: inviteDraft },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setInviteDraft(result.inviteCode);
      toast.success("Invite code updated.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update invite code.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Toaster />
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">League Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {settingsLocked
            ? "Structural settings are locked after the draft starts. Invite code can still be updated."
            : "Edit basics before the draft. Full scoring/roster editors expand in a later pass."}
        </p>

        <div className="mt-4 space-y-3">
          <label className={labelClass}>
            League name
            <input
              className={fieldClass}
              value={name}
              disabled={!canManage || settingsLocked || saving}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
            />
          </label>
          <label className={labelClass}>
            Scoring preset
            <select
              className={fieldClass}
              value={scoringPreset}
              disabled={!canManage || settingsLocked || saving}
              onChange={(e) => setScoringPreset(e.target.value as NativeScoringPreset)}
            >
              <option value="half">Half PPR</option>
              <option value="ppr">Full PPR</option>
              <option value="std">Standard</option>
            </select>
          </label>
          <label className={labelClass}>
            Draft mode
            <select
              className={fieldClass}
              value={draftMode}
              disabled={!canManage || settingsLocked || saving}
              onChange={(e) => setDraftMode(e.target.value as NativeDraftMode)}
            >
              <option value="offline">Offline / commissioner enter</option>
              <option value="live">Live snake (entry board available; clock later)</option>
            </select>
          </label>
        </div>

        {canManage && !settingsLocked ? (
          <button type="button" className={`${buttonClass} mt-4`} disabled={saving} onClick={() => void saveBasics()}>
            {saving ? "Saving…" : "Save Settings"}
          </button>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Invite Code</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Managers join from My Leagues → Join. Commissioners can customize the code.
        </p>
        {summary.canEditInvite ? (
          <label className={`${labelClass} mt-4`}>
            Code
            <input
              className={`${fieldClass} font-mono uppercase tracking-wider`}
              value={inviteDraft}
              onChange={(e) =>
                setInviteDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))
              }
              maxLength={16}
            />
          </label>
        ) : (
          <p className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono tracking-wider">
            {summary.inviteCode}
          </p>
        )}
        {summary.canEditInvite ? (
          <button
            type="button"
            className={`${buttonClass} mt-4`}
            disabled={saving || inviteDraft.trim().length < 4}
            onClick={() => void saveInvite()}
          >
            Save Invite Code
          </button>
        ) : null}
      </section>

      <p className="text-sm text-muted-foreground">
        Account-style settings also live at{" "}
        <Link to="/account/leagues/native/$linkId" params={{ linkId }} className="text-primary hover:underline">
          My Leagues → Settings
        </Link>
        .
      </p>
    </div>
  );
}
