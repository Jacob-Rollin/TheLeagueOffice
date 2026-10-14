import { Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { NativeLeagueSubNav } from "@/components/nav/NativeLeagueSubNav";
import { useAuth } from "@/hooks/useAuth";
import { getNativeLeagueBoard } from "@/lib/native-league.functions";

export function NativeLeagueShell({ linkId }: { linkId: string }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { data: board, isLoading, error } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(userId && linkId),
    staleTime: 60_000,
    retry: false,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });

  return (
    <>
      <NativeLeagueSubNav linkId={linkId} />
      <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
        {!userId ? (
          <p className="text-sm text-muted-foreground">Sign in to open this league.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading league…</p>
        ) : error || !board ? (
          <>
            <p className="text-sm text-destructive">
              {error instanceof Error
                ? error.message
                : "League not found or you are not a member."}
            </p>
            <Link
              to="/account/leagues"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              Back to My Leagues
            </Link>
          </>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Fantasy
                </p>
                <h1 className="display-title text-3xl text-slate-900">
                  {(() => {
                    const parts = board.summary.name.trim().split(/\s+/);
                    if (parts.length < 2) {
                      return <span className="text-primary">{board.summary.name}</span>;
                    }
                    const last = parts.pop()!;
                    return (
                      <>
                        {parts.join(" ")} <span className="text-primary">{last}</span>
                      </>
                    );
                  })()}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground capitalize">
                  {board.summary.status.replace("_", " ")} ·{" "}
                  {board.summary.draftStatus.replace("_", " ")} draft ·{" "}
                  {board.summary.filledTeams}/{board.summary.teamCount} teams
                </p>
              </div>
              <Link
                to="/account/leagues/native/$linkId"
                params={{ linkId }}
                className="rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground"
              >
                League Settings
              </Link>
            </div>
            <Outlet />
          </>
        )}
      </main>
    </>
  );
}
