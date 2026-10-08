import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import {
  getNativeLeagueBoard,
  updateNativeLeagueBasics,
} from "@/lib/native-league.functions";
import {
  DEFAULT_IR_ALLOWED_STATUSES,
  NATIVE_IR_ALLOWED_STATUS_LABELS,
  NATIVE_IR_ALLOWED_STATUS_OPTIONS,
  defaultNativeScoringSettings,
  type NativeCommissionerSettings,
  type NativeDraftMode,
  type NativeIrAllowedStatus,
  type NativeScoringPreset,
} from "@/lib/native-league-settings";
import { cn } from "@/lib/utils";

import {
  COMMISH_SCROLL_PAD,
  CommishHeader,
  CommishSection,
  FieldLabel,
  NavRow,
  SegmentedRow,
  Stepper,
  TextInput,
  ToggleRow,
} from "./MobileCommissionerChrome";

const dialogShellClass =
  "fixed inset-0 z-[60] overflow-x-hidden overflow-y-auto overscroll-x-none bg-m-bg touch-pan-y";
const dialogInnerClass = "mx-auto flex min-h-full w-full max-w-md flex-col overflow-x-hidden";
const dialogInnerStyle = { paddingBottom: COMMISH_SCROLL_PAD } as const;

type HubTab = "league" | "draft" | "rosters";
type Screen =
  | "hub"
  | "league-info"
  | "scoring"
  | "waivers"
  | "playoffs"
  | "divisions"
  | "teams"
  | "managers"
  | "draft-settings"
  | "keepers"
  | "roster-slots";

type ScoringTab = "passing" | "rushing" | "receiving" | "kicking";

const LEAGUE_NAV: { id: Screen; label: string }[] = [
  { id: "league-info", label: "League Info" },
  { id: "scoring", label: "Scoring" },
  { id: "waivers", label: "Waivers, Adds, Trades" },
  { id: "playoffs", label: "Playoffs & Ties" },
  { id: "divisions", label: "Divisions" },
  { id: "teams", label: "Teams" },
  { id: "managers", label: "Managers & Co-Managers" },
];

function yardsEveryLabel(ptsPerYard: number | undefined): string {
  if (ptsPerYard == null || !(ptsPerYard > 0)) return "";
  const every = Math.round(1 / ptsPerYard);
  return Number.isFinite(every) ? String(every) : "";
}

function fromYardsEvery(every: string): number {
  const n = Number(every);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return 1 / n;
}

/** Full-screen Commissioner Tools overlay matching NFL Fantasy IA. */
export function MobileCommissionerTools({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { activeLeague } = useActiveLeague();
  const queryClient = useQueryClient();
  const isNative = activeLeague?.platform === "native";
  const linkId = isNative ? activeLeague?.id ?? null : null;

  const { data: board, isLoading } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 30_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId: linkId! } }),
  });

  const [tab, setTab] = useState<HubTab>("league");
  const [screen, setScreen] = useState<Screen>("hub");
  const [draft, setDraft] = useState<NativeCommissionerSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [scoringTab, setScoringTab] = useState<ScoringTab>("passing");

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (screen !== "hub") setScreen("hub");
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, screen]);

  useEffect(() => {
    if (board?.commissioner) setDraft(board.commissioner);
  }, [board]);

  const locked = Boolean(draft?.settingsLocked);
  const canEdit = Boolean(draft?.canManage) && !locked;

  const savePatch = async (patch: Record<string, unknown>) => {
    if (!linkId || !canEdit || saving) return;
    setSaving(true);
    try {
      const result = await updateNativeLeagueBasics({ data: { linkId, ...patch } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Settings saved.");
      await queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] });
      await queryClient.invalidateQueries({ queryKey: ["native-league-summaries"] });
      await queryClient.invalidateQueries({ queryKey: ["active-league-connections"] });
      setScreen("hub");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  if (!isNative) {
    return (
      <div role="dialog" aria-modal="true" className={dialogShellClass}>
        <div className={dialogInnerClass} style={dialogInnerStyle}>
          <CommishHeader title="Commissioner Tools" onClose={onClose} />
          <main className="px-4 py-8 text-sm text-m-muted">
            Commissioner Tools edit native leagues hosted on The League Office. Synced ESPN / Sleeper /
            Yahoo leagues keep host-site settings — use Waivers and Trades tabs for read-only rules.
          </main>
        </div>
      </div>
    );
  }

  if (isLoading || !draft) {
    return (
      <div role="dialog" aria-modal="true" className={dialogShellClass}>
        <div className={dialogInnerClass} style={dialogInnerStyle}>
          <CommishHeader title="Commissioner Tools" onClose={onClose} />
          <p className="px-4 py-8 text-sm text-m-muted">Loading league settings…</p>
        </div>
      </div>
    );
  }

  if (!draft.canManage) {
    return (
      <div role="dialog" aria-modal="true" className={dialogShellClass}>
        <div className={dialogInnerClass} style={dialogInnerStyle}>
          <CommishHeader title="Commissioner Tools" onClose={onClose} />
          <main className="px-4 py-8 text-sm text-m-muted">
            Only commissioners and co-managers can edit these settings.
          </main>
        </div>
      </div>
    );
  }

  const title =
    screen === "hub"
      ? "Commissioner Tools"
      : LEAGUE_NAV.find((n) => n.id === screen)?.label ??
        (screen === "draft-settings"
          ? "Draft Settings"
          : screen === "keepers"
            ? "Keeper Settings"
            : screen === "roster-slots"
              ? "Roster Slots"
              : "Settings");

  return (
    <div role="dialog" aria-modal="true" aria-label="Commissioner Tools" className={dialogShellClass}>
      <Toaster />
      <div className={dialogInnerClass} style={dialogInnerStyle}>
        <CommishHeader
          title={title}
          onClose={screen === "hub" ? onClose : undefined}
          onBack={screen === "hub" ? undefined : () => setScreen("hub")}
          onSave={
            screen === "hub" || screen === "managers"
              ? undefined
              : () => {
                  if (screen === "league-info") {
                    void savePatch({
                      name: draft.name,
                      seasonStartWeek: draft.seasonStartWeek,
                      isPublic: draft.isPublic,
                      autoActivateNextYear: draft.autoActivateNextYear,
                    });
                  } else if (screen === "scoring") {
                    void savePatch({
                      scoringPreset: draft.scoringPreset as NativeScoringPreset,
                      scoringSettings: draft.scoringSettings,
                    });
                  } else if (screen === "waivers") {
                    void savePatch({
                      waiverType: draft.waiverType,
                      waiverBudget: draft.waiverBudget,
                      waiverPeriodDays: draft.waiverPeriodDays,
                      postDraftPlayerStatus: draft.postDraftPlayerStatus,
                      lockFaOnGametime: draft.lockFaOnGametime,
                      maxAddsPerWeek: draft.maxAddsPerWeek,
                      maxAddsPerSeason: draft.maxAddsPerSeason,
                      undroppableTopPlayers: draft.undroppableTopPlayers,
                      rosterLockType: draft.rosterLockType,
                      tradeDeadlineWeek: draft.tradeDeadlineWeek,
                      tradeReviewHours: draft.tradeReviewHours,
                      tradeVetoMode: draft.tradeVetoMode,
                      maxTradesPerSeason: draft.maxTradesPerSeason,
                    });
                  } else if (screen === "playoffs") {
                    void savePatch({
                      playoffTeams: draft.playoffTeams,
                      playoffMatchupLength: draft.playoffMatchupLength,
                      playoffWeekPair: draft.playoffWeekPair,
                      standingsTiebreaker: draft.standingsTiebreaker,
                      allowMatchupTies: draft.allowMatchupTies,
                      matchupTiebreakerSlot: draft.matchupTiebreakerSlot,
                    });
                  } else if (screen === "divisions") {
                    void savePatch({ divisionsEnabled: draft.divisionsEnabled });
                  } else if (screen === "teams") {
                    void savePatch({ teamCount: draft.teamCount });
                  } else if (screen === "draft-settings") {
                    void savePatch({
                      draftMode: draft.draftMode as NativeDraftMode,
                      draftFormat: draft.draftFormat,
                      draftOrderType: draft.draftOrderType,
                      draftPickTimeLimitSec: draft.draftPickTimeLimitSec,
                    });
                  } else if (screen === "keepers") {
                    void savePatch({
                      keepersPerTeam: draft.keepersPerTeam,
                      keeperNote: draft.keeperNote,
                    });
                  } else if (screen === "roster-slots") {
                    void savePatch({
                      benchSpots: draft.rosterSlots["BN"] ?? 0,
                      irSpots: draft.rosterSlots["IR"] ?? 0,
                      irAllowedStatuses: draft.irAllowedStatuses?.length
                        ? draft.irAllowedStatuses
                        : [...DEFAULT_IR_ALLOWED_STATUSES],
                    });
                  }
                }
          }
          saving={saving}
          saveDisabled={!canEdit}
        />

        {locked ? (
          <p className="border-b border-m-border bg-m-card px-4 py-2 text-xs text-m-muted">
            Structural settings lock after the draft starts.
          </p>
        ) : null}

        {screen === "hub" ? (
          <>
            <nav className="grid grid-cols-3 border-b border-m-border">
              {(
                [
                  ["league", "League"],
                  ["draft", "Draft"],
                  ["rosters", "Rosters"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "border-b-4 py-3 font-display text-base font-semibold",
                    tab === id
                      ? "border-m-accent text-m-card-fg"
                      : "border-transparent text-m-muted",
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>
            <main>
              <p className="border-b border-m-border px-4 py-3 text-sm text-m-muted">
                Saves write to the league now. Live enforcement today: league name, scoring preset
                (display), draft mode, bench/IR counts, IR designations, and weekly/season add
                limits. Waivers, trades, playoffs, locks, and keepers are stored for upcoming
                features.
              </p>
              {tab === "league"
                ? LEAGUE_NAV.map((item) => (
                    <NavRow key={item.id} label={item.label} onClick={() => setScreen(item.id)} />
                  ))
                : null}
              {tab === "draft" ? (
                <NavRow label="Draft Settings" onClick={() => setScreen("draft-settings")} />
              ) : null}
              {tab === "rosters" ? (
                <>
                  <NavRow label="Roster Slots" onClick={() => setScreen("roster-slots")} />
                  <NavRow label="Keeper Settings" onClick={() => setScreen("keepers")} />
                </>
              ) : null}
            </main>
          </>
        ) : null}

        {screen === "league-info" ? (
          <main className="space-y-4 px-4 py-4">
            <FieldLabel>
              League Name
              <TextInput
                value={draft.name}
                disabled={!canEdit}
                maxLength={128}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </FieldLabel>
            <FieldLabel>
              Invite Code
              <TextInput value={draft.inviteCode} disabled readOnly className="font-mono tracking-wider" />
            </FieldLabel>
            <SegmentedRow
              label="League Start"
              value={String(draft.seasonStartWeek)}
              disabled={!canEdit}
              options={[1, 2, 3, 4, 5].map((w) => ({ value: String(w), label: `Week ${w}` }))}
              onChange={(v) => setDraft({ ...draft, seasonStartWeek: Number(v) })}
            />
            <ToggleRow
              label="Auto-activate next year"
              description="Automatically activates your league for the following season"
              checked={draft.autoActivateNextYear}
              disabled={!canEdit}
              onChange={(v) => setDraft({ ...draft, autoActivateNextYear: v })}
            />
            <ToggleRow
              label="Viewable by public"
              description="League, teams, standings, and stats are viewable to the public through website."
              checked={draft.isPublic}
              disabled={!canEdit}
              onChange={(v) => setDraft({ ...draft, isPublic: v })}
            />
            <div>
              <p className="text-sm text-m-muted">League ID</p>
              <p className="mt-1 font-mono text-sm text-m-card-fg">{draft.leagueId}</p>
            </div>
          </main>
        ) : null}

        {screen === "scoring" ? (
          <main>
            <div className="space-y-2 border-b border-m-border px-4 py-3">
              <SegmentedRow
                label="Scoring Preset"
                value={draft.scoringPreset}
                disabled={!canEdit}
                options={[
                  { value: "half", label: "Half PPR" },
                  { value: "ppr", label: "Full PPR" },
                  { value: "std", label: "Standard" },
                  { value: "custom", label: "Custom" },
                ]}
                onChange={(v) => {
                  const preset = v as NativeScoringPreset;
                  const next =
                    preset === "ppr"
                      ? { ...defaultNativeScoringSettings(), rec: 1 }
                      : preset === "std"
                        ? { ...defaultNativeScoringSettings(), rec: 0 }
                        : defaultNativeScoringSettings();
                  setDraft({
                    ...draft,
                    scoringPreset: preset,
                    scoringSettings: preset === "custom" ? draft.scoringSettings : next,
                  });
                }}
              />
            </div>
            <nav className="flex max-w-full gap-1 overflow-x-auto overscroll-x-contain border-b border-m-border px-2">
              {(
                [
                  ["passing", "Passing"],
                  ["rushing", "Rushing"],
                  ["receiving", "Receiving"],
                  ["kicking", "Kicking"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setScoringTab(id)}
                  className={cn(
                    "shrink-0 border-b-4 px-3 py-3 font-display text-sm font-semibold",
                    scoringTab === id
                      ? "border-m-accent text-m-card-fg"
                      : "border-transparent text-m-muted",
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>
            <ScoringFields
              tab={scoringTab}
              values={draft.scoringSettings}
              disabled={!canEdit}
              onChange={(scoringSettings) =>
                setDraft({ ...draft, scoringPreset: "custom", scoringSettings })
              }
            />
          </main>
        ) : null}

        {screen === "waivers" ? (
          <main>
            <CommishSection title="Waivers" info="Dropped and locked free agents enter waivers.">
              <SegmentedRow
                label="Waiver Period"
                value={String(draft.waiverPeriodDays)}
                disabled={!canEdit}
                options={[
                  { value: "0", label: "No Waivers" },
                  { value: "1", label: "1 day" },
                  { value: "2", label: "2 days" },
                  { value: "3", label: "3 days" },
                  { value: "4", label: "4 days" },
                ]}
                onChange={(v) => setDraft({ ...draft, waiverPeriodDays: Number(v) })}
              />
              <SegmentedRow
                label="Waiver Type"
                value={draft.waiverType}
                disabled={!canEdit}
                options={[
                  { value: "rolling", label: "Move to Last after Claim" },
                  { value: "reverse", label: "Resets to Inverse Standings" },
                  { value: "faab", label: "FAAB" },
                ]}
                onChange={(v) => setDraft({ ...draft, waiverType: v })}
              />
              {draft.waiverType === "faab" ? (
                <FieldLabel>
                  FAAB Budget
                  <TextInput
                    type="number"
                    disabled={!canEdit}
                    value={draft.waiverBudget ?? 100}
                    onChange={(e) =>
                      setDraft({ ...draft, waiverBudget: Number(e.target.value) || 0 })
                    }
                  />
                </FieldLabel>
              ) : null}
              <SegmentedRow
                label="Post-Draft Players"
                value={draft.postDraftPlayerStatus}
                disabled={!canEdit}
                options={[
                  { value: "free_agents", label: "Free Agents" },
                  { value: "follow_waiver_rules", label: "Follow Waiver Rules" },
                ]}
                onChange={(v) => setDraft({ ...draft, postDraftPlayerStatus: v })}
              />
              <ToggleRow
                label="Lock Free Agents on Gametime"
                checked={draft.lockFaOnGametime}
                disabled={!canEdit}
                onChange={(v) => setDraft({ ...draft, lockFaOnGametime: v })}
              />
            </CommishSection>
            <div className="border-t border-m-border" />
            <CommishSection title="Adds & Drops">
              <FieldLabel>
                Max Adds Per Week
                <select
                  disabled={!canEdit}
                  className="w-full rounded-lg border border-m-border bg-m-bg px-3 py-2.5 text-base text-m-card-fg"
                  value={draft.maxAddsPerWeek == null ? "" : String(draft.maxAddsPerWeek)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      maxAddsPerWeek: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="">No Maximum</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </FieldLabel>
              <FieldLabel>
                Max Adds Per Season
                <select
                  disabled={!canEdit}
                  className="w-full rounded-lg border border-m-border bg-m-bg px-3 py-2.5 text-base text-m-card-fg"
                  value={draft.maxAddsPerSeason == null ? "" : String(draft.maxAddsPerSeason)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      maxAddsPerSeason: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="">No Maximum</option>
                  {[10, 20, 30, 40, 50, 75, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </FieldLabel>
              <ToggleRow
                label="Top Players Undroppable"
                checked={draft.undroppableTopPlayers}
                disabled={!canEdit}
                onChange={(v) => setDraft({ ...draft, undroppableTopPlayers: v })}
              />
              <SegmentedRow
                label="Roster Lock Type"
                value={draft.rosterLockType}
                disabled={!canEdit}
                options={[
                  { value: "game_time", label: "Game Time" },
                  { value: "first_game", label: "First Game" },
                ]}
                onChange={(v) => setDraft({ ...draft, rosterLockType: v })}
              />
            </CommishSection>
            <div className="border-t border-m-border" />
            <CommishSection title="Trades">
              <FieldLabel>
                Max Trades Per Season
                <select
                  disabled={!canEdit}
                  className="w-full rounded-lg border border-m-border bg-m-bg px-3 py-2.5 text-base text-m-card-fg"
                  value={draft.maxTradesPerSeason == null ? "" : String(draft.maxTradesPerSeason)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      maxTradesPerSeason: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="">Unlimited</option>
                  {[5, 10, 15, 20, 25].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </FieldLabel>
              <SegmentedRow
                label="Trade Review"
                value={draft.tradeVetoMode}
                disabled={!canEdit}
                options={[
                  { value: "none", label: "None" },
                  { value: "commissioner", label: "Commissioner" },
                ]}
                onChange={(v) => setDraft({ ...draft, tradeVetoMode: v })}
              />
              <FieldLabel>
                Trade Deadline Week
                <TextInput
                  type="number"
                  min={1}
                  max={18}
                  disabled={!canEdit}
                  value={draft.tradeDeadlineWeek ?? ""}
                  placeholder="None"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      tradeDeadlineWeek: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </FieldLabel>
            </CommishSection>
          </main>
        ) : null}

        {screen === "playoffs" ? (
          <main>
            <CommishSection title="Playoffs">
              <SegmentedRow
                label="Weeks Per Playoff Matchup"
                value={draft.playoffMatchupLength}
                disabled={!canEdit}
                options={[
                  { value: "one", label: "1 Week" },
                  { value: "two_all", label: "2 Weeks (All)" },
                  { value: "two_championship", label: "2 Weeks (Championship)" },
                ]}
                onChange={(v) => setDraft({ ...draft, playoffMatchupLength: v })}
              />
              <SegmentedRow
                label="Playoff Teams"
                description="Selecting None will disable playoffs"
                value={String(draft.playoffTeams)}
                disabled={!canEdit}
                options={[0, 4, 6, 7, 8].map((n) => ({
                  value: String(n),
                  label: n === 0 ? "None" : `${n} Teams`,
                }))}
                onChange={(v) => setDraft({ ...draft, playoffTeams: Number(v) })}
              />
              <SegmentedRow
                label="Playoff Weeks"
                value={draft.playoffWeekPair}
                disabled={!canEdit}
                options={[
                  { value: "15-17", label: "15–17" },
                  { value: "16-17", label: "16 & 17" },
                  { value: "17-18", label: "17 & 18" },
                ]}
                onChange={(v) => setDraft({ ...draft, playoffWeekPair: v })}
              />
            </CommishSection>
            <div className="border-t border-m-border" />
            <CommishSection title="Ties">
              <SegmentedRow
                label="Standings Tiebreaker"
                value={draft.standingsTiebreaker}
                disabled={!canEdit}
                options={[
                  { value: "points_for", label: "Points For" },
                  { value: "head_to_head", label: "Head to Head" },
                  { value: "division", label: "Division Record" },
                ]}
                onChange={(v) => setDraft({ ...draft, standingsTiebreaker: v })}
              />
              <ToggleRow
                label="Allow Matchup Ties"
                checked={draft.allowMatchupTies}
                disabled={!canEdit}
                onChange={(v) => setDraft({ ...draft, allowMatchupTies: v })}
              />
              <SegmentedRow
                label="Matchup Tiebreaker"
                value={draft.matchupTiebreakerSlot}
                disabled={!canEdit}
                options={["Bench", "QB", "RB", "WR", "TE", "K", "DEF"].map((s) => ({
                  value: s,
                  label: s,
                }))}
                onChange={(v) => setDraft({ ...draft, matchupTiebreakerSlot: v })}
              />
            </CommishSection>
          </main>
        ) : null}

        {screen === "divisions" ? (
          <main>
            <CommishSection
              title="League Divisions"
              info="Divisions help break playoff ties, mix up the schedule, and create rivalries."
            >
              <p className="text-sm text-m-muted">
                Divisions are a great way to break playoff ties, mix up the schedule, and create
                rivalries.
              </p>
              <ToggleRow
                label="Divisions"
                checked={draft.divisionsEnabled}
                disabled={!canEdit}
                onChange={(v) => setDraft({ ...draft, divisionsEnabled: v })}
              />
            </CommishSection>
          </main>
        ) : null}

        {screen === "teams" ? (
          <main className="px-4 py-4">
            <h2 className="font-display text-lg font-bold">Add & Remove Teams</h2>
            <p className="mt-2 text-sm text-m-muted">
              You can add or remove teams before your league drafts. If you add teams, invite
              managers to take those seats from Teams on desktop.
            </p>
            <div className="mt-4">
              <SegmentedRow
                label="Teams"
                value={String(draft.teamCount)}
                disabled={!canEdit}
                options={[10, 12, 14, 16, 18, 20].map((n) => ({
                  value: String(n),
                  label: String(n),
                }))}
                onChange={(v) => setDraft({ ...draft, teamCount: Number(v) })}
              />
            </div>
            <p className="mt-3 text-xs text-m-muted">
              Changing seat count from mobile is not available yet — use desktop Teams management.
              Current size: {board?.summary.teamCount ?? draft.teamCount}.
            </p>
          </main>
        ) : null}

        {screen === "managers" ? (
          <main className="px-4 py-8 text-sm text-m-muted">
            Manager invites and co-manager roles stay on desktop Teams / Settings for now. Invite
            code: <span className="font-mono text-m-card-fg">{draft.inviteCode}</span>
          </main>
        ) : null}

        {screen === "draft-settings" ? (
          <main>
            <CommishSection title="Draft">
              <SegmentedRow
                label="Draft Type"
                value={draft.draftMode === "auto" ? "offline" : draft.draftMode}
                disabled={!canEdit}
                options={[
                  { value: "live", label: "Live" },
                  { value: "offline", label: "Offline" },
                ]}
                onChange={(v) => setDraft({ ...draft, draftMode: v })}
              />
              <SegmentedRow
                label="Draft Format"
                value={draft.draftFormat}
                disabled={!canEdit}
                options={[
                  { value: "standard", label: "Standard" },
                  { value: "salary_cap", label: "Salary Cap" },
                ]}
                onChange={(v) => setDraft({ ...draft, draftFormat: v })}
              />
              <SegmentedRow
                label="Draft Order"
                value={draft.draftOrderType}
                disabled={!canEdit}
                options={[
                  { value: "snake", label: "Snake" },
                  { value: "linear", label: "Linear" },
                ]}
                onChange={(v) => setDraft({ ...draft, draftOrderType: v })}
              />
              <SegmentedRow
                label="Time Per Pick"
                value={String(draft.draftPickTimeLimitSec)}
                disabled={!canEdit}
                options={[15, 30, 45, 60, 90, 120].map((n) => ({
                  value: String(n),
                  label: `${n} seconds`,
                }))}
                onChange={(v) => setDraft({ ...draft, draftPickTimeLimitSec: Number(v) })}
              />
            </CommishSection>
          </main>
        ) : null}

        {screen === "keepers" ? (
          <main>
            <CommishSection title="Keeper Settings">
              <Stepper
                label="Keepers Per Team"
                value={draft.keepersPerTeam}
                min={0}
                max={0}
                disabled={!canEdit}
                onChange={(n) => setDraft({ ...draft, keepersPerTeam: n })}
              />
              <p className="text-sm text-m-muted">Keepers are not enabled in v1 (must stay 0).</p>
              <FieldLabel>
                Note To Managers
                <TextInput
                  value={draft.keeperNote ?? ""}
                  disabled={!canEdit}
                  placeholder="Post a note…"
                  onChange={(e) => setDraft({ ...draft, keeperNote: e.target.value || null })}
                />
              </FieldLabel>
            </CommishSection>
          </main>
        ) : null}

        {screen === "roster-slots" ? (
          <main>
            <CommishSection title="Roster Slots">
              <Stepper
                label="Bench Spots"
                value={Number(draft.rosterSlots["BN"] ?? 0)}
                min={0}
                max={20}
                disabled={!canEdit}
                onChange={(n) =>
                  setDraft({ ...draft, rosterSlots: { ...draft.rosterSlots, BN: n } })
                }
              />
              <Stepper
                label="IR Spots"
                value={Number(draft.rosterSlots["IR"] ?? 0)}
                min={0}
                max={5}
                disabled={!canEdit}
                onChange={(n) =>
                  setDraft({ ...draft, rosterSlots: { ...draft.rosterSlots, IR: n } })
                }
              />
              <p className="text-sm text-m-muted">
                Active roster capacity (starters + bench): {draft.rosterCapacity}. IR does not add a
                free free-agent spot.
              </p>
            </CommishSection>
            <CommishSection
              title="IR Slot Designations"
              info="Only selected tags may occupy IR. Questionable, Doubtful, and Out never qualify."
            >
              {NATIVE_IR_ALLOWED_STATUS_OPTIONS.map((status) => (
                <ToggleRow
                  key={status}
                  label={NATIVE_IR_ALLOWED_STATUS_LABELS[status]}
                  checked={(draft.irAllowedStatuses ?? DEFAULT_IR_ALLOWED_STATUSES).includes(status)}
                  disabled={!canEdit}
                  onChange={(on) => {
                    const current = draft.irAllowedStatuses?.length
                      ? [...draft.irAllowedStatuses]
                      : [...DEFAULT_IR_ALLOWED_STATUSES];
                    let next: NativeIrAllowedStatus[];
                    if (on) {
                      next = current.includes(status) ? current : [...current, status];
                    } else {
                      next = current.filter((s) => s !== status);
                      if (next.length === 0) next = [...DEFAULT_IR_ALLOWED_STATUSES];
                    }
                    setDraft({ ...draft, irAllowedStatuses: next });
                  }}
                />
              ))}
              <p className="text-sm text-m-muted">
                Managers must activate or drop IR players who no longer match these tags.
              </p>
            </CommishSection>
          </main>
        ) : null}
      </div>
    </div>
  );
}

function ScoringFields({
  tab,
  values,
  disabled,
  onChange,
}: {
  tab: ScoringTab;
  values: Record<string, number>;
  disabled?: boolean;
  onChange: (next: Record<string, number>) => void;
}) {
  const set = (key: string, raw: string) => {
    const n = Number(raw);
    onChange({ ...values, [key]: Number.isFinite(n) ? n : 0 });
  };
  const row = (label: string, key: string, suffix: string, display?: string) => (
    <div key={key} className="flex items-center justify-between gap-3 border-b border-m-border px-4 py-3">
      <span className="min-w-0 text-sm text-m-card-fg">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          disabled={disabled}
          value={display ?? (values[key] ?? "")}
          onChange={(e) => {
            if (key === "pass_yd" || key === "rush_yd" || key === "rec_yd") {
              onChange({ ...values, [key]: fromYardsEvery(e.target.value) });
            } else {
              set(key, e.target.value);
            }
          }}
          className="w-16 rounded-md border border-m-border bg-m-bg px-2 py-1.5 text-center text-sm text-m-card-fg disabled:opacity-50"
        />
        <span className="w-20 text-xs text-m-muted">{suffix}</span>
      </div>
    </div>
  );

  if (tab === "passing") {
    return (
      <div>
        <h3 className="px-4 pb-1 pt-4 font-display text-base font-bold">Passing</h3>
        {row("Passing Yards", "pass_yd", "1 pt every yds", yardsEveryLabel(values["pass_yd"]))}
        {row("Passing Touchdowns", "pass_td", "pts")}
        {row("Interceptions Thrown", "pass_int", "pts")}
        {row("2-Pt Pass Conversions", "pass_2pt", "pts")}
        <h3 className="px-4 pb-1 pt-4 font-display text-base font-bold">Bonuses</h3>
        <p className="px-4 pb-4 text-sm text-m-muted">Bonus fields can expand with custom scoring later.</p>
      </div>
    );
  }
  if (tab === "rushing") {
    return (
      <div>
        <h3 className="px-4 pb-1 pt-4 font-display text-base font-bold">Rushing</h3>
        {row("Rushing Yards", "rush_yd", "1 pt every yds", yardsEveryLabel(values["rush_yd"]))}
        {row("Rushing Touchdowns", "rush_td", "pts")}
        {row("2-Pt Rush Conversions", "rush_2pt", "pts")}
        {row("Fumbles Lost", "fum_lost", "pts")}
      </div>
    );
  }
  if (tab === "receiving") {
    return (
      <div>
        <h3 className="px-4 pb-1 pt-4 font-display text-base font-bold">Receiving</h3>
        {row("Receptions", "rec", "pts")}
        {row("Receiving Yards", "rec_yd", "1 pt every yds", yardsEveryLabel(values["rec_yd"]))}
        {row("Receiving Touchdowns", "rec_td", "pts")}
        {row("2-Pt Receiving Conversions", "rec_2pt", "pts")}
      </div>
    );
  }
  return (
    <div>
      <h3 className="px-4 pb-1 pt-4 font-display text-base font-bold">Kicking</h3>
      {row("PAT Made", "pat_made", "pts")}
      {row("PAT Miss", "pat_miss", "pts")}
      {row("FG 0–19", "fgm_0_19", "pts")}
      {row("FG 20–29", "fgm_20_29", "pts")}
      {row("FG 30–39", "fgm_30_39", "pts")}
      {row("FG 40–49", "fgm_40_49", "pts")}
      {row("FG 50+", "fgm_50p", "pts")}
      {row("FG Miss", "fgmiss", "pts")}
    </div>
  );
}
