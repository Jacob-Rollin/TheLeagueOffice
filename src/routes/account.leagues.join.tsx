import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { AccountShell } from "@/components/account/AccountShell";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { joinNativeLeague } from "@/lib/native-league.functions";

export const Route = createFileRoute("/account/leagues/join")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Join League — The League Office" }, { name: "robots", content: "noindex" }],
  }),
  component: NativeLeagueJoinPage,
});

const fieldClass =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary";
const labelClass = "block text-sm font-medium text-slate-800";
const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";
const outlineClass =
  "rounded-md border border-border bg-white px-4 py-2 font-display text-sm uppercase tracking-wide text-slate-800 disabled:opacity-60";

function NativeLeagueJoinPage() {
  const { user } = useAuth();
  const { refresh, setActiveLeagueId } = useActiveLeague();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  const [inviteCode, setInviteCode] = useState("");
  const [joinTeamName, setJoinTeamName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

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
      await queryClient.invalidateQueries({ queryKey: ["league-connections", userId] });
      await queryClient.invalidateQueries({ queryKey: ["native-league-links", userId] });
      await queryClient.invalidateQueries({ queryKey: ["active-league-connections", userId] });
      await refresh();
      setActiveLeagueId(result.linkId);
      void navigate({ to: "/account/leagues" });
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Could not join league");
    } finally {
      setJoining(false);
    }
  };

  if (!userId) {
    return (
      <AccountShell title="Join League" active="leagues">
        <p className="text-sm text-slate-600">Sign in to join a native league.</p>
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title="Join League"
      active="leagues"
      action={
        <Link to="/account/leagues" className={outlineClass}>
          Back to My Leagues
        </Link>
      }
    >
      <section className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="display-title text-xl text-slate-900">
          Join <span className="text-primary">League</span>
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Enter the commissioner invite code to claim an open seat.
        </p>

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
    </AccountShell>
  );
}
