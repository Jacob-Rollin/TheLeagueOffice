import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "@tanstack/react-router";

import { AuthDialog } from "@/components/auth/AuthDialog";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
  castArticlePollVote,
  closeArticlePoll,
  fetchArticlePollBundle,
  userCanVoteInLeague,
} from "@/lib/article-polls";
import { cn } from "@/lib/utils";

export function ArticlePollBlock({ pollId }: { pollId: string }) {
  const { user, ready } = useAuth();
  const { data: isAdmin } = useIsAdmin(user?.id ?? null);
  const queryClient = useQueryClient();
  const [authOpen, setAuthOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bundleQuery = useQuery({
    queryKey: ["article-poll", pollId, user?.id ?? "anon"],
    queryFn: () => fetchArticlePollBundle(pollId, user?.id ?? null),
    staleTime: 30_000,
  });

  const leagueOkQuery = useQuery({
    queryKey: ["article-poll-league", pollId, bundleQuery.data?.poll.native_league_id, user?.id],
    enabled: Boolean(bundleQuery.data?.poll.native_league_id && user?.id),
    queryFn: () =>
      userCanVoteInLeague(bundleQuery.data!.poll.native_league_id, user?.id ?? null),
    staleTime: 60_000,
  });

  const voteMutation = useMutation({
    mutationFn: castArticlePollVote,
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["article-poll", pollId] });
    },
    onError: (err: Error) => setError(err.message),
    onSettled: () => setPending(null),
  });

  const closeMutation = useMutation({
    mutationFn: () => closeArticlePoll(pollId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["article-poll", pollId] });
    },
  });

  if (bundleQuery.isLoading || !ready) {
    return (
      <div className="my-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-muted-foreground">
        Loading poll…
      </div>
    );
  }

  if (bundleQuery.isError) {
    return (
      <div className="my-6 rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-sm text-red-800">
        Could not load this poll
        {bundleQuery.error instanceof Error ? `: ${bundleQuery.error.message}` : "."}
        {" "}
        If this is a new feature, confirm the Supabase poll migration has been applied.
      </div>
    );
  }

  const bundle = bundleQuery.data;
  if (!bundle) {
    return (
      <div className="my-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-muted-foreground">
        This poll is no longer available.
      </div>
    );
  }

  const { poll, questions, tallies, myVotes } = bundle;
  const isOpen = poll.status === "open";
  const leagueLocked = Boolean(poll.native_league_id);
  const leagueOk = !leagueLocked || leagueOkQuery.data === true;
  const canVote = Boolean(user) && isOpen && leagueOk;

  const onPick = (questionId: string, optionId: string) => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (!canVote) return;
    setPending(questionId);
    voteMutation.mutate({ questionId, userId: user.id, optionId });
  };

  return (
    <section className="my-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-600">Poll</p>
          <h3 className="text-base font-bold text-slate-900">
            {poll.title?.trim() || "League vote"}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isOpen ? "Open" : "Closed"}
            {leagueLocked ? " · League members only" : " · Signed-in users"}
            {" · One vote per question"}
          </p>
        </div>
        {isAdmin && isOpen ? (
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            disabled={closeMutation.isPending}
            onClick={() => closeMutation.mutate()}
          >
            {closeMutation.isPending ? "Closing…" : "Close poll"}
          </button>
        ) : null}
      </header>

      <div className="space-y-6 p-4">
        {!user ? (
          <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-800">
            <button
              type="button"
              className="font-semibold text-blue-700 underline"
              onClick={() => setAuthOpen(true)}
            >
              Sign in
            </button>{" "}
            to vote. Guests cannot cast ballots.
          </p>
        ) : leagueLocked && leagueOkQuery.isFetched && !leagueOk ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-slate-800">
            This poll is locked to members of a specific native league. Your account is not linked to
            that league.
          </p>
        ) : null}

        {questions.map((question, index) => {
          const total = question.options.reduce((sum, o) => sum + (tallies[o.id] ?? 0), 0);
          const mine = myVotes[question.id];
          const showBars = Boolean(mine) || !isOpen;

          return (
            <div key={question.id} className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">
                <span className="mr-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Q{index + 1}
                </span>
                {question.prompt}
              </p>
              <ul className="space-y-2">
                {question.options.map((option) => {
                  const count = tallies[option.id] ?? 0;
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  const selected = mine === option.id;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        disabled={!canVote || pending === question.id}
                        onClick={() => onPick(question.id, option.id)}
                        className={cn(
                          "relative w-full overflow-hidden rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                          selected
                            ? "border-blue-600 bg-blue-50 text-slate-900"
                            : "border-slate-200 bg-white text-slate-800 hover:border-blue-300",
                          !canVote && "cursor-default hover:border-slate-200",
                        )}
                      >
                        {showBars ? (
                          <span
                            className="pointer-events-none absolute inset-y-0 left-0 bg-blue-100/80"
                            style={{ width: `${pct}%` }}
                            aria-hidden
                          />
                        ) : null}
                        <span className="relative flex items-center justify-between gap-3">
                          <span className="font-medium">{option.label}</span>
                          {showBars ? (
                            <span className="shrink-0 tabular-nums text-xs font-semibold text-slate-600">
                              {count} · {pct}%
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {!user ? (
          <p className="text-xs text-muted-foreground">
            Need an account?{" "}
            <Link to="/auth" search={{ mode: "signup" }} className="font-semibold text-blue-700 underline">
              Create one
            </Link>
            .
          </p>
        ) : null}
      </div>

      <AuthDialog open={authOpen} mode="signin" onOpenChange={setAuthOpen} />
    </section>
  );
}
