import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
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
import { cn } from "@/lib/utils";

type TabId = "basic" | "roster" | "scoring" | "draft";

const TABS: { id: TabId; label: string }[] = [
  { id: "basic", label: "Basic" },
  { id: "roster", label: "Roster" },
  { id: "scoring", label: "Scoring" },
  { id: "draft", label: "Draft Details" },
];

const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";
const outlineClass =
  "rounded-md border border-border bg-white px-4 py-2 font-display text-sm uppercase tracking-wide text-slate-800 disabled:opacity-60";
const fieldClass =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary disabled:bg-muted/40 disabled:text-muted-foreground";
const labelClass = "block text-sm font-medium text-slate-800";

function nativeScoringLabel(preset: string | null | undefined): string {
  const key = (preset ?? "half").toLowerCase();
  if (key === "ppr") return "Full PPR";
  if (key === "std" || key === "standard") return "Standard";
  return "Half PPR";
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">{title}</h3>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

/**
 * Account-shell native settings — tabbed like synced league review,
 * with commissioner edits gated by canManage / settingsLocked.
 */
export function NativeLeagueAccountSettings({ linkId }: { linkId: string }) {
  const queryClient = useQueryClient();
  const { setActiveLeagueId } = useActiveLeague();
  const [tab, setTab] = useState<TabId>("basic");

  const { data: board, isLoading, error } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(linkId),
    staleTime: 60_000,
    retry: false,
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
  const [allowAiTeams, setAllowAiTeams] = useState(false);
  const [seasonStartWeek, setSeasonStartWeek] = useState(1);
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
    setAllowAiTeams(Boolean(board.commissioner.allowAiTeams));
    setSeasonStartWeek(
      Math.max(1, Math.min(14, Number(board.commissioner.seasonStartWeek ?? 1) || 1)),
    );
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

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading league settings…</p>;
  }
  if (error || !board) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Could not load this native league."}
      </p>
    );
  }

  const { summary, canManage, settingsLocked } = board;
  const readOnly = !canManage || settingsLocked;
  const roleLabel =
    summary.role === "commissioner"
      ? "Commissioner"
      : summary.role === "co_commish"
        ? "Co-Commish"
        : "Member";

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] });
    await queryClient.invalidateQueries({ queryKey: ["native-league-summary", linkId] });
    await queryClient.invalidateQueries({ queryKey: ["native-league-summaries"] });
    await queryClient.invalidateQueries({ queryKey: ["active-league-connections"] });
  };

  const saveBasics = async () => {
    if (!canManage || saving) return;
    setSaving(true);
    try {
      const result = await updateNativeLeagueBasics({
        data: settingsLocked
          ? { linkId, allowAiTeams }
          : {
              linkId,
              name,
              scoringPreset,
              draftMode,
              benchSpots,
              irSpots,
              irAllowedStatuses,
              seasonStartWeek,
              allowAiTeams,
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

  const copyInvite = async () => {
    const code = (summary.canEditInvite ? inviteDraft : summary.inviteCode).trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Invite code copied.");
    } catch {
      toast.error("Could not copy invite code.");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Toaster />
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="display-title text-xl text-slate-900">
          {summary.name} <span className="text-primary">Settings</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Native redraft · {summary.seasonYear} · {roleLabel}
          {settingsLocked ? " · Structural settings locked after draft start" : ""}
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
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            to="/league/$linkId"
            params={{ linkId }}
            className={buttonClass}
            onClick={() => setActiveLeagueId(linkId)}
          >
            Open Fantasy
          </Link>
          <button type="button" className={outlineClass} onClick={() => void copyInvite()}>
            Copy Invite Code
          </button>
        </div>
      </section>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "basic" ? (
        <Card title="Basic">
          <label className={labelClass}>
            League name
            <input
              className={fieldClass}
              value={name}
              disabled={readOnly || saving}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
            />
          </label>
          <label className={labelClass}>
            League start week
            <select
              className={fieldClass}
              value={seasonStartWeek}
              disabled={readOnly || saving}
              onChange={(e) => setSeasonStartWeek(Number(e.target.value))}
            >
              {Array.from({ length: 14 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-slate-300 text-primary focus:ring-primary"
              checked={allowAiTeams}
              disabled={!canManage || saving}
              onChange={(e) => setAllowAiTeams(e.target.checked)}
            />
            <span>
              <span className="font-medium">Allow AI managers</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Testing seats can be AI-managed. Stays editable after the draft starts.
              </span>
            </span>
          </label>
          {summary.canEditInvite ? (
            <label className={labelClass}>
              Invite code
              <input
                className={`${fieldClass} font-mono uppercase tracking-wider`}
                value={inviteDraft}
                disabled={saving}
                onChange={(e) =>
                  setInviteDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))
                }
                maxLength={16}
              />
            </label>
          ) : (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono tracking-wider">
              {summary.inviteCode}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {canManage ? (
              <button
                type="button"
                className={buttonClass}
                disabled={saving}
                onClick={() => void saveBasics()}
              >
                {saving
                  ? "Saving…"
                  : settingsLocked
                    ? "Save AI Setting"
                    : "Save Settings"}
              </button>
            ) : null}
            {summary.canEditInvite ? (
              <button
                type="button"
                className={outlineClass}
                disabled={saving || inviteDraft.trim().length < 4}
                onClick={() => void saveInvite()}
              >
                Save Invite Code
              </button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {tab === "roster" ? (
        <Card title="Roster">
          <p className="text-sm text-muted-foreground">
            Active capacity (starters + bench): {board.rosterCapacity}. IR does not add a free FA
            spot.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Bench spots
              <input
                type="number"
                min={0}
                max={20}
                className={fieldClass}
                value={benchSpots}
                disabled={readOnly || saving}
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
                disabled={readOnly || saving}
                onChange={(e) => setIrSpots(Number(e.target.value))}
              />
            </label>
          </div>
          <fieldset disabled={readOnly || saving} className="space-y-2">
            <legend className={labelClass}>IR slot designations</legend>
            <p className="text-xs text-muted-foreground">
              Only selected tags may occupy IR. Questionable, Doubtful, and Out never qualify.
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
          {canManage && !settingsLocked ? (
            <button
              type="button"
              className={buttonClass}
              disabled={saving}
              onClick={() => void saveBasics()}
            >
              {saving ? "Saving…" : "Save Roster Settings"}
            </button>
          ) : null}
        </Card>
      ) : null}

      {tab === "scoring" ? (
        <Card title="Scoring">
          <label className={labelClass}>
            Scoring preset
            <select
              className={fieldClass}
              value={scoringPreset}
              disabled={readOnly || saving}
              onChange={(e) => setScoringPreset(e.target.value as NativeScoringPreset)}
            >
              <option value="half">Half PPR</option>
              <option value="ppr">Full PPR</option>
              <option value="std">Standard</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            Preset scoring only for now — custom point editors can expand later.
          </p>
          {canManage && !settingsLocked ? (
            <button
              type="button"
              className={buttonClass}
              disabled={saving}
              onClick={() => void saveBasics()}
            >
              {saving ? "Saving…" : "Save Scoring"}
            </button>
          ) : null}
        </Card>
      ) : null}

      {tab === "draft" ? (
        <Card title="Draft Details">
          <label className={labelClass}>
            Draft mode
            <select
              className={fieldClass}
              value={draftMode}
              disabled={readOnly || saving}
              onChange={(e) => setDraftMode(e.target.value as NativeDraftMode)}
            >
              <option value="offline">Offline / commissioner enter</option>
              <option value="live">Live snake</option>
            </select>
          </label>
          <p className="text-sm text-muted-foreground capitalize">
            Status: {summary.draftStatus.replace("_", " ")}
          </p>
          <Link
            to="/league/$linkId/draft"
            params={{ linkId }}
            className={outlineClass + " inline-flex"}
            onClick={() => setActiveLeagueId(linkId)}
          >
            Open Draft Board
          </Link>
          {canManage && !settingsLocked ? (
            <button
              type="button"
              className={buttonClass}
              disabled={saving}
              onClick={() => void saveBasics()}
            >
              {saving ? "Saving…" : "Save Draft Settings"}
            </button>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
