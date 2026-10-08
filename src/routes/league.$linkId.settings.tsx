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
import {
  DEFAULT_IR_ALLOWED_STATUSES,
  NATIVE_IR_ALLOWED_STATUS_LABELS,
  NATIVE_IR_ALLOWED_STATUS_OPTIONS,
  type NativeDraftMode,
  type NativeIrAllowedStatus,
  type NativeScoringPreset,
} from "@/lib/native-league-settings";

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
  const [benchSpots, setBenchSpots] = useState(6);
  const [irSpots, setIrSpots] = useState(1);
  const [irAllowedStatuses, setIrAllowedStatuses] = useState<NativeIrAllowedStatus[]>([
    ...DEFAULT_IR_ALLOWED_STATUSES,
  ]);
  const [inviteDraft, setInviteDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!board) return;
    setName(board.summary.name);
    setScoringPreset((board.summary.scoringPreset as NativeScoringPreset) || "half");
    setDraftMode(board.summary.draftMode === "live" ? "live" : "offline");
    setBenchSpots(Number(board.rosterSlots["BN"] ?? 6) || 0);
    setIrSpots(Number(board.rosterSlots["IR"] ?? 1) || 0);
    setIrAllowedStatuses(
      board.irAllowedStatuses?.length
        ? [...board.irAllowedStatuses]
        : [...DEFAULT_IR_ALLOWED_STATUSES],
    );
    setInviteDraft(board.summary.inviteCode);
  }, [board]);

  const toggleIrStatus = (status: NativeIrAllowedStatus) => {
    setIrAllowedStatuses((prev) => {
      if (prev.includes(status)) {
        const next = prev.filter((s) => s !== status);
        return next.length > 0 ? next : [...DEFAULT_IR_ALLOWED_STATUSES];
      }
      return [...prev, status];
    });
  };

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
          benchSpots,
          irSpots,
          irAllowedStatuses,
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Bench spots
              <input
                type="number"
                min={0}
                max={20}
                className={fieldClass}
                value={benchSpots}
                disabled={!canManage || settingsLocked || saving}
                onChange={(e) => setBenchSpots(Number(e.target.value))}
              />
            </label>
            <label className={labelClass}>
              IR spots
              <input
                type="number"
                min={0}
                max={5}
                className={fieldClass}
                value={irSpots}
                disabled={!canManage || settingsLocked || saving}
                onChange={(e) => setIrSpots(Number(e.target.value))}
              />
            </label>
          </div>
          <fieldset disabled={!canManage || settingsLocked || saving} className="space-y-2">
            <legend className={labelClass}>IR slot designations</legend>
            <p className="text-xs text-muted-foreground">
              Only selected tags may occupy IR. Questionable, Doubtful, and Out never qualify.
              Default is IR only.
            </p>
            <div className="mt-1 space-y-2">
              {NATIVE_IR_ALLOWED_STATUS_OPTIONS.map((status) => (
                <label key={status} className="flex items-center gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-slate-300 text-primary focus:ring-primary"
                    checked={irAllowedStatuses.includes(status)}
                    onChange={() => toggleIrStatus(status)}
                  />
                  {NATIVE_IR_ALLOWED_STATUS_LABELS[status]}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Active roster capacity is starters + bench (+ taxi). IR does not add a free free-agent
            spot. Capacity: {board.rosterCapacity}. When a player on IR no longer matches these tags,
            their manager must activate them (dropping someone if the roster is full) or drop them.
          </p>
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
          Managers join from My Leagues → Join. Commissioners can customize the code. Seat management
          stays on{" "}
          <Link to="/league/$linkId/teams" params={{ linkId }} className="font-medium text-primary hover:underline">
            Teams
          </Link>
          .
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
