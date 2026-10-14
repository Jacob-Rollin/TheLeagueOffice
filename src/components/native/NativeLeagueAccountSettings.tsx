import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  Activity,
  Bot,
  CalendarClock,
  CalendarDays,
  Calculator,
  ChevronRight,
  ClipboardList,
  Hash,
  KeyRound,
  ListOrdered,
  RefreshCw,
  Shield,
  Shuffle,
  Trophy,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { LeagueAvatar } from "@/components/league/LeagueAvatar";
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
import {
  RESERVE_SLOT_KEYS,
  ROSTER_SLOT_LABEL,
  SCORING_GROUPS,
  STARTER_SLOT_KEYS,
  emptyRoster,
  formatScoringValue,
  rosterSummary,
  scoringFormatLabel,
  scoringRows,
  type RosterSlotKey,
} from "@/lib/league-settings";
import { cn } from "@/lib/utils";

type TabId = "basic" | "roster" | "scoring" | "draft";

const TABS: { id: TabId; label: string }[] = [
  { id: "basic", label: "Basic" },
  { id: "roster", label: "Roster" },
  { id: "scoring", label: "Scoring" },
  { id: "draft", label: "Draft Details" },
];

const fieldClass =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary disabled:bg-muted/40 disabled:text-muted-foreground";
const labelClass = "block text-sm font-medium text-slate-800";
const buttonClass =
  "rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60";
const outlineClass =
  "rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-60";

function slotsToRoster(slots: Record<string, number>): Record<RosterSlotKey, number> {
  const roster = emptyRoster();
  for (const key of Object.keys(roster) as RosterSlotKey[]) {
    const n = Number(slots[key] ?? 0);
    roster[key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return roster;
}

function draftModeLabel(mode: string): string {
  return mode === "live" ? "Live snake" : "Offline / commissioner enter";
}

function draftStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-bold uppercase tracking-wide text-slate-900">{children}</h3>;
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground">{value}</p>
      </div>
    </div>
  );
}

function SlotGrid({ keys, roster }: { keys: RosterSlotKey[]; roster: Record<RosterSlotKey, number> }) {
  return (
    <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
      {keys.map((key) => (
        <div key={key} className="flex items-center justify-between border-b border-border py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{ROSTER_SLOT_LABEL[key].short}</p>
            <p className="truncate text-xs text-muted-foreground">{ROSTER_SLOT_LABEL[key].long}</p>
          </div>
          <span
            className={cn(
              "flex h-8 min-w-10 items-center justify-center rounded-md border px-2 font-mono text-sm tabular-nums",
              roster[key]
                ? "border-primary/30 bg-primary/5 text-primary"
                : "border-border text-muted-foreground",
            )}
          >
            {roster[key]}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Account-shell native settings — same chrome as synced league review,
 * with commissioner edits for native-only fields under Basic (and locked-aware roster/scoring/draft).
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

  const { summary, canManage, settingsLocked, commissioner, teams, picksPerTeam } = board;
  const readOnly = !canManage || settingsLocked;
  const myTeam = summary.teamId != null ? teams.find((t) => t.id === summary.teamId) : null;
  const roster = slotsToRoster(board.rosterSlots);
  const scoring = commissioner.scoringSettings ?? {};
  const playoffs = `${commissioner.playoffTeams} teams · Starts Week ${board.playoffStartWeek}`;
  const waiver = commissioner.waiverBudget
    ? `${commissioner.waiverType} · ${commissioner.waiverBudget} budget`
    : commissioner.waiverType;
  const deadline = commissioner.tradeDeadlineWeek
    ? `Week ${commissioner.tradeDeadlineWeek}`
    : "None";
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
    <div className="space-y-6">
      <Toaster />

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <LeagueAvatar
            platform="native"
            src={myTeam?.avatarUrl ?? null}
            alt={`${myTeam?.teamName ?? summary.name} team avatar`}
            className="size-14 max-h-14 max-w-14 h-14 w-14"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                Native
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {summary.seasonYear} Season
              </span>
            </div>
            <p className="mt-1 truncate text-lg font-semibold text-foreground">
              {myTeam?.teamName ?? "My Team"}
            </p>
            <p className="truncate text-sm text-muted-foreground">{summary.name}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-center">
          <Link
            to="/league/$linkId"
            params={{ linkId }}
            className={buttonClass}
            onClick={() => setActiveLeagueId(linkId)}
          >
            Open Fantasy
          </Link>
          <button type="button" className={outlineClass} onClick={() => void copyInvite()}>
            Copy Invite
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex flex-col gap-1 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Settings</h2>
            <p className="text-xs text-muted-foreground">
              Hosted on The League Office · {roleLabel}
              {settingsLocked ? " · Structural settings locked after draft start" : ""}
            </p>
          </div>
          <Link
            to="/league/$linkId/teams"
            params={{ linkId }}
            className="text-sm font-semibold text-primary hover:underline"
            onClick={() => setActiveLeagueId(linkId)}
          >
            Manage Teams
          </Link>
        </header>

        <div className="grid sm:grid-cols-[180px_1fr]">
          <nav className="flex gap-1 overflow-x-auto border-b border-border p-2 sm:flex-col sm:border-b-0 sm:border-r">
            {TABS.map((t) => {
              const active = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-muted",
                    active && "bg-primary/10 font-semibold text-primary hover:bg-primary/10",
                  )}
                >
                  {t.label}
                  {active ? (
                    <ChevronRight className="hidden size-4 sm:block" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 p-5">
            {tab === "basic" ? (
              <div className="space-y-6">
                <div>
                  <SectionTitle>League</SectionTitle>
                  <div className="mt-4 grid gap-5 sm:grid-cols-2">
                    <InfoItem icon={Shield} label="League Type" value="Redraft" />
                    <InfoItem
                      icon={Users}
                      label="Teams"
                      value={`${summary.filledTeams}/${summary.teamCount}`}
                    />
                    <InfoItem icon={Trophy} label="Playoffs" value={playoffs} />
                    <InfoItem
                      icon={Calculator}
                      label="Scoring"
                      value={scoringFormatLabel(scoring)}
                    />
                    <InfoItem
                      icon={ClipboardList}
                      label="Roster"
                      value={rosterSummary(roster) || "—"}
                    />
                    <InfoItem icon={RefreshCw} label="Waiver Type" value={waiver || "—"} />
                    <InfoItem icon={CalendarClock} label="Trade Deadline" value={deadline} />
                    <InfoItem
                      icon={Activity}
                      label="Status"
                      value={
                        <span className="capitalize">{summary.status.replace(/_/g, " ")}</span>
                      }
                    />
                  </div>
                </div>

                <div className="border-t border-border pt-6">
                  <SectionTitle>Draft</SectionTitle>
                  <div className="mt-4 grid gap-5 sm:grid-cols-2">
                    <InfoItem
                      icon={Shuffle}
                      label="Draft Type"
                      value={draftModeLabel(summary.draftMode)}
                    />
                    <InfoItem
                      icon={ListOrdered}
                      label="No. Rounds"
                      value={picksPerTeam || "—"}
                    />
                    <InfoItem
                      icon={Hash}
                      label="Draft Position"
                      value={
                        myTeam?.draftSlot != null ? `Pick ${myTeam.draftSlot}` : "Not set"
                      }
                    />
                    <InfoItem
                      icon={CalendarDays}
                      label="Draft Status"
                      value={
                        <span className="capitalize">
                          {draftStatusLabel(summary.draftStatus)}
                        </span>
                      }
                    />
                  </div>
                </div>

                <div className="border-t border-border pt-6">
                  <SectionTitle>Native Controls</SectionTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Settings exclusive to leagues hosted on The League Office.
                  </p>
                  <div className="mt-4 space-y-3">
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
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <Bot className="size-3.5 text-primary" aria-hidden="true" />
                          Allow AI managers
                        </span>
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
                            setInviteDraft(
                              e.target.value
                                .toUpperCase()
                                .replace(/[^A-Z0-9]/g, "")
                                .slice(0, 16),
                            )
                          }
                          maxLength={16}
                        />
                      </label>
                    ) : (
                      <div className="flex items-start gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <KeyRound className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Invite code</p>
                          <p className="font-mono text-sm font-semibold tracking-wider text-foreground">
                            {summary.inviteCode}
                          </p>
                        </div>
                      </div>
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
                  </div>
                </div>
              </div>
            ) : null}

            {tab === "roster" ? (
              <div className="space-y-6">
                <div>
                  <SectionTitle>Starting Lineup</SectionTitle>
                  <SlotGrid keys={STARTER_SLOT_KEYS} roster={roster} />
                </div>
                <div>
                  <SectionTitle>Reserves</SectionTitle>
                  <SlotGrid
                    keys={RESERVE_SLOT_KEYS.filter((k) => k !== "TAXI" || roster.TAXI > 0)}
                    roster={roster}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Total roster spots:{" "}
                  <span className="font-semibold text-foreground">
                    {[...STARTER_SLOT_KEYS, ...RESERVE_SLOT_KEYS].reduce(
                      (sum, k) => sum + (roster[k] ?? 0),
                      0,
                    )}
                  </span>
                  {" · "}
                  Active capacity (excludes IR):{" "}
                  <span className="font-semibold text-foreground">{board.rosterCapacity}</span>
                </p>

                {canManage ? (
                  <div className="border-t border-border pt-6">
                    <SectionTitle>Edit Reserves</SectionTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {settingsLocked
                        ? "Bench and IR counts lock after the draft starts."
                        : "Adjust bench / IR before the draft. Starters stay at the league template."}
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
                    <fieldset disabled={readOnly || saving} className="mt-4 space-y-2">
                      <legend className={labelClass}>IR slot designations</legend>
                      <p className="text-xs text-muted-foreground">
                        Only selected tags may occupy IR. Questionable, Doubtful, and Out never
                        qualify.
                      </p>
                      <div className="mt-1 space-y-2">
                        {NATIVE_IR_ALLOWED_STATUS_OPTIONS.map((status) => (
                          <label
                            key={status}
                            className="flex items-center gap-2 text-sm text-slate-800"
                          >
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
                    {!settingsLocked ? (
                      <button
                        type="button"
                        className={`${buttonClass} mt-4`}
                        disabled={saving}
                        onClick={() => void saveBasics()}
                      >
                        {saving ? "Saving…" : "Save Roster Settings"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === "scoring" ? (
              <ScoringPanel
                scoring={scoring}
                scoringPreset={scoringPreset}
                setScoringPreset={setScoringPreset}
                canEdit={canManage && !settingsLocked}
                saving={saving}
                onSave={() => void saveBasics()}
              />
            ) : null}

            {tab === "draft" ? (
              <div className="space-y-6">
                <div>
                  <SectionTitle>Draft Details</SectionTitle>
                  <div className="mt-4 grid gap-5 sm:grid-cols-2">
                    <InfoItem
                      icon={Shuffle}
                      label="Draft Type"
                      value={draftModeLabel(summary.draftMode)}
                    />
                    <InfoItem
                      icon={Activity}
                      label="Draft Status"
                      value={
                        <span className="capitalize">
                          {draftStatusLabel(summary.draftStatus)}
                        </span>
                      }
                    />
                    <InfoItem
                      icon={ListOrdered}
                      label="No. Rounds"
                      value={picksPerTeam || "—"}
                    />
                    <InfoItem
                      icon={Hash}
                      label="Your Position"
                      value={
                        myTeam?.draftSlot != null ? `Pick ${myTeam.draftSlot}` : "Not set"
                      }
                    />
                  </div>
                </div>

                {canManage && !settingsLocked ? (
                  <div className="border-t border-border pt-6">
                    <SectionTitle>Edit Draft Mode</SectionTitle>
                    <label className={`${labelClass} mt-3`}>
                      Draft mode
                      <select
                        className={fieldClass}
                        value={draftMode}
                        disabled={saving}
                        onChange={(e) => setDraftMode(e.target.value as NativeDraftMode)}
                      >
                        <option value="offline">Offline / commissioner enter</option>
                        <option value="live">Live snake</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className={`${buttonClass} mt-4`}
                      disabled={saving}
                      onClick={() => void saveBasics()}
                    >
                      {saving ? "Saving…" : "Save Draft Settings"}
                    </button>
                  </div>
                ) : null}

                <div className="border-t border-border pt-6">
                  <SectionTitle>Draft Order</SectionTitle>
                  {teams.length ? (
                    <ol className="mt-3 grid gap-x-6 sm:grid-cols-2">
                      {[...teams]
                        .sort((a, b) => a.draftSlot - b.draftSlot)
                        .map((team) => {
                          const isMine = team.id === summary.teamId;
                          return (
                            <li
                              key={team.id}
                              className={cn(
                                "flex items-center gap-3 border-b border-border px-2 py-2.5 text-sm",
                                isMine && "rounded-md bg-primary/5",
                              )}
                            >
                              <span className="w-6 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                                {team.draftSlot}
                              </span>
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate",
                                  isMine ? "font-semibold text-primary" : "text-foreground",
                                )}
                              >
                                {team.teamName}
                                {team.isAi ? " (AI)" : ""}
                              </span>
                              {isMine ? (
                                <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                                  You
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                    </ol>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      The draft order hasn&apos;t been set yet.
                    </p>
                  )}
                </div>

                <Link
                  to="/league/$linkId/draft"
                  params={{ linkId }}
                  className={`${outlineClass} inline-flex`}
                  onClick={() => setActiveLeagueId(linkId)}
                >
                  Open Draft Board
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function ScoringPanel({
  scoring,
  scoringPreset,
  setScoringPreset,
  canEdit,
  saving,
  onSave,
}: {
  scoring: Record<string, number>;
  scoringPreset: NativeScoringPreset;
  setScoringPreset: (v: NativeScoringPreset) => void;
  canEdit: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const groups = SCORING_GROUPS.filter((g) => scoringRows(g.id, scoring).length > 0);
  const [group, setGroup] = useState(groups[0]?.id ?? "passing");
  const rows = scoringRows(group, scoring);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-muted-foreground">Scoring Format</p>
        <p className="text-sm font-semibold text-foreground">{scoringFormatLabel(scoring)}</p>
      </div>

      {canEdit ? (
        <label className={labelClass}>
          Scoring preset
          <select
            className={fieldClass}
            value={scoringPreset}
            disabled={saving}
            onChange={(e) => setScoringPreset(e.target.value as NativeScoringPreset)}
          >
            <option value="half">Half PPR</option>
            <option value="ppr">Full PPR</option>
            <option value="std">Standard</option>
          </select>
        </label>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b border-border">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGroup(g.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              g.id === group
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>
      <dl className="grid gap-x-6 sm:grid-cols-2">
        {rows.map((r) => (
          <div
            key={r.key}
            className="flex items-center justify-between border-b border-border py-2.5 text-sm"
          >
            <dt className="text-foreground/80">{r.label}</dt>
            <dd
              className={cn(
                "font-mono tabular-nums",
                r.value < 0
                  ? "text-red-600"
                  : r.value > 0
                    ? "text-foreground"
                    : "text-muted-foreground",
              )}
            >
              {formatScoringValue(r.key, r.value)}
            </dd>
          </div>
        ))}
      </dl>
      {canEdit ? (
        <button type="button" className={buttonClass} disabled={saving} onClick={onSave}>
          {saving ? "Saving…" : "Save Scoring"}
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Preset scoring only for now — custom point editors can expand later.
        </p>
      )}
    </div>
  );
}
