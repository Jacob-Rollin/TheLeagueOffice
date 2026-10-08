import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { AccountShell } from "@/components/account/AccountShell";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { createNativeLeague, joinNativeLeague } from "@/lib/native-league.functions";
import {
  NATIVE_LEAGUE_MAX_TEAMS,
  NATIVE_LEAGUE_MIN_TEAMS,
  type NativeDraftMode,
  type NativeScoringPreset,
} from "@/lib/native-league-settings";

export const Route = createFileRoute("/account/leagues/native")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Native League — The League Office" }, { name: "robots", content: "noindex" }],
  }),
  component: NativeLeaguePage,
});

const fieldClass =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary";
const labelClass = "block text-sm font-medium text-slate-800";
const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";
const outlineClass =
  "rounded-md border border-border bg-white px-4 py-2 font-display text-sm uppercase tracking-wide text-slate-800 disabled:opacity-60";

function NativeLeaguePage() {
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
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<string | null>(null);

  const [inviteCode, setInviteCode] = useState("");
  const [joinTeamName, setJoinTeamName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const invalidate = async (linkId: string) => {
    await queryClient.invalidateQueries({ queryKey: ["league-connections", userId] });
    await queryClient.invalidateQueries({ queryKey: ["native-league-links", userId] });
    await queryClient.invalidateQueries({ queryKey: ["active-league-connections", userId] });
    await refresh();
    setActiveLeagueId(linkId);
  };

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
          ...(teamName.trim() ? { teamName: teamName.trim() } : {}),
        },
      });
      if (!result.ok) {
        setCreateError(result.error);
        return;
      }
      setCreatedInvite(result.inviteCode);
      await invalidate(result.linkId);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create league");
    } finally {
      setCreating(false);
    }
  };

  const onJoin = async () => {
    if (!userId || joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      const result = await joinNativeLeague({
        data: {
          inviteCode,
          ...(joinTeamName.trim() ? { teamName: joinTeamName.trim() } : {}),
        },
      });
      if (!result.ok) {
        setJoinError(result.error);
        return;
      }
      await invalidate(result.linkId);
      void navigate({ to: "/playbook" });
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Could not join league");
    } finally {
      setJoining(false);
    }
  };

  if (!userId) {
    return (
      <AccountShell title="Native League" active="leagues">
        <p className="text-sm text-slate-600">Sign in to create or join a native league.</p>
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title="Native League"
      active="leagues"
      action={
        <Link to="/account/leagues" className={outlineClass}>
          Back to My Leagues
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="display-title text-xl text-slate-900">
            Create <span className="text-primary">League</span>
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
          </div>

          {createError ? <p className="mt-3 text-sm text-red-600">{createError}</p> : null}
          {createdInvite ? (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-800">
              League created. Invite code:{" "}
              <span className="font-display text-base font-semibold tracking-wide text-primary">
                {createdInvite}
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => void navigate({ to: "/playbook" })}
                >
                  Open Playbook
                </button>
                <Link to="/account/leagues" className={outlineClass}>
                  My Leagues
                </Link>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            className={`${buttonClass} mt-4`}
            disabled={creating || name.trim().length < 1}
            onClick={() => void onCreate()}
          >
            {creating ? "Creating…" : "Create League"}
          </button>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="display-title text-xl text-slate-900">
            Join <span className="text-primary">League</span>
          </h2>
          <p className="mt-1 text-sm text-slate-600">Enter the commissioner invite code to claim an open seat.</p>

          <div className="mt-4 space-y-3">
            <label className={labelClass}>
              Invite code
              <input
                className={`${fieldClass} uppercase tracking-wider`}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                maxLength={16}
                placeholder="ABCD2345"
              />
            </label>
            <label className={labelClass}>
              Your team name (optional)
              <input
                className={fieldClass}
                value={joinTeamName}
                onChange={(e) => setJoinTeamName(e.target.value)}
                maxLength={64}
                placeholder="Uses the open seat name if blank"
              />
            </label>
          </div>

          {joinError ? <p className="mt-3 text-sm text-red-600">{joinError}</p> : null}

          <button
            type="button"
            className={`${buttonClass} mt-4`}
            disabled={joining || inviteCode.trim().length < 4}
            onClick={() => void onJoin()}
          >
            {joining ? "Joining…" : "Join League"}
          </button>
        </section>
      </div>
    </AccountShell>
  );
}
