import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { AccountShell } from "@/components/account/AccountShell";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { createNativeLeague } from "@/lib/native-league.functions";
import {
  DEFAULT_IR_ALLOWED_STATUSES,
  NATIVE_IR_ALLOWED_STATUS_LABELS,
  NATIVE_IR_ALLOWED_STATUS_OPTIONS,
  NATIVE_LEAGUE_MAX_TEAMS,
  NATIVE_LEAGUE_MIN_TEAMS,
  type NativeDraftMode,
  type NativeIrAllowedStatus,
  type NativeScoringPreset,
} from "@/lib/native-league-settings";

export const Route = createFileRoute("/account/leagues/setup")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Create League — The League Office" }, { name: "robots", content: "noindex" }],
  }),
  component: NativeLeagueSetupPage,
});

const fieldClass =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary";
const labelClass = "block text-sm font-medium text-slate-800";
const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";
const outlineClass =
  "rounded-md border border-border bg-white px-4 py-2 font-display text-sm uppercase tracking-wide text-slate-800 disabled:opacity-60";

function NativeLeagueSetupPage() {
  const { user } = useAuth();
  const { refresh, setActiveLeagueId } = useActiveLeague();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  const [name, setName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamCount, setTeamCount] = useState(10);
  const [scoringPreset, setScoringPreset] = useState<NativeScoringPreset>("half");
  const [draftMode, setDraftMode] = useState<NativeDraftMode>("offline");
  const [benchSpots, setBenchSpots] = useState(6);
  const [irSpots, setIrSpots] = useState(1);
  const [irAllowedStatuses, setIrAllowedStatuses] = useState<NativeIrAllowedStatus[]>([
    ...DEFAULT_IR_ALLOWED_STATUSES,
  ]);
  const [creating, setCreating] = useState(false);

  const toggleIrStatus = (status: NativeIrAllowedStatus) => {
    setIrAllowedStatuses((prev) => {
      if (prev.includes(status)) {
        const next = prev.filter((s) => s !== status);
        return next.length > 0 ? next : [...DEFAULT_IR_ALLOWED_STATUSES];
      }
      return [...prev, status];
    });
  };
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<string | null>(null);

  const onCreate = async () => {
    if (!userId || creating) return;
    setCreating(true);
    setCreateError(null);
    setCreatedInvite(null);
    try {
      const result = await createNativeLeague({
        data: {
          name,
          teamCount,
          scoringPreset,
          draftMode: draftMode === "live" ? "live" : "offline",
          seasonYear: new Date().getUTCFullYear(),
          benchSpots,
          irSpots,
          irAllowedStatuses,
          ...(teamName.trim() ? { teamName: teamName.trim() } : {}),
        },
      });
      if (!result.ok) {
        setCreateError(result.error);
        return;
      }
      setCreatedInvite(result.inviteCode);
      await queryClient.invalidateQueries({ queryKey: ["league-connections", userId] });
      await queryClient.invalidateQueries({ queryKey: ["native-league-links", userId] });
      await queryClient.invalidateQueries({ queryKey: ["native-league-summaries", userId] });
      await queryClient.invalidateQueries({ queryKey: ["active-league-connections", userId] });
      await refresh();
      setActiveLeagueId(result.linkId);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create league");
    } finally {
      setCreating(false);
    }
  };

  if (!userId) {
    return (
      <AccountShell title="Create League" active="leagues">
        <p className="text-sm text-slate-600">Sign in to create a native league.</p>
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title="Create League"
      active="leagues"
      action={
        <Link to="/account/leagues" className={outlineClass}>
          Back to My Leagues
        </Link>
      }
    >
      <section className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="display-title text-xl text-slate-900">
          League <span className="text-primary">Setup</span>
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Redraft league hosted on The League Office. Share the invite code after create.
        </p>

        <div className="mt-4 space-y-3">
          <label className={labelClass}>
            League name
            <input
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
              placeholder="Thursday Night League"
            />
          </label>
          <label className={labelClass}>
            Your team name
            <input
              className={fieldClass}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              maxLength={64}
              placeholder="Team 1"
            />
          </label>
          <label className={labelClass}>
            Teams ({NATIVE_LEAGUE_MIN_TEAMS}–{NATIVE_LEAGUE_MAX_TEAMS})
            <select
              className={fieldClass}
              value={teamCount}
              onChange={(e) => setTeamCount(Number(e.target.value))}
            >
              {Array.from(
                { length: NATIVE_LEAGUE_MAX_TEAMS - NATIVE_LEAGUE_MIN_TEAMS + 1 },
                (_, i) => NATIVE_LEAGUE_MIN_TEAMS + i,
              ).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Scoring
            <select
              className={fieldClass}
              value={scoringPreset}
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
              onChange={(e) => setDraftMode(e.target.value as NativeDraftMode)}
            >
              <option value="offline">Offline / commissioner enter</option>
              <option value="live">Live snake (scheduled later)</option>
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
                onChange={(e) => setIrSpots(Number(e.target.value))}
              />
            </label>
          </div>
          <fieldset className="space-y-2">
            <legend className={labelClass}>IR slot designations</legend>
            <p className="text-xs text-slate-600">
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
        </div>

        {createError ? <p className="mt-3 text-sm text-red-600">{createError}</p> : null}
        {createdInvite ? (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-800">
            League created. Invite code:{" "}
            <span className="font-display text-base font-semibold tracking-wide text-primary">
              {createdInvite}
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link to="/account/leagues" className={buttonClass}>
                My Leagues
              </Link>
              <button
                type="button"
                className={outlineClass}
                onClick={() => void navigate({ to: "/playbook" })}
              >
                Open Tools
              </button>
            </div>
          </div>
        ) : null}

        {!createdInvite ? (
          <button
            type="button"
            className={`${buttonClass} mt-4`}
            disabled={creating || name.trim().length < 1}
            onClick={() => void onCreate()}
          >
            {creating ? "Creating…" : "Create League"}
          </button>
        ) : null}
      </section>
    </AccountShell>
  );
}
