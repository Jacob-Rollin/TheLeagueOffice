import { Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { LeagueOfficeChatRail } from "@/components/native/LeagueOfficeChatRail";
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
                  {board.summary.seasonYear} · {board.summary.teamCount}-Team{" "}
                  {board.summary.scoringPreset} ·{" "}
                  {board.summary.status.replace("_", " ")} ·{" "}
                  {board.summary.draftStatus.replace("_", " ")} draft
                </p>
              </div>
              <Link
                to="/account/leagues/native/$linkId"
                params={{ linkId }}
                className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-foreground hover:bg-slate-50"
              >
                League Settings
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="min-w-0 lg:col-span-2">
                <Outlet />
              </div>
              <aside className="flex min-w-0 flex-col lg:sticky lg:top-20 lg:col-span-1 lg:h-[calc(100vh-5.5rem)] lg:self-start">
                <LeagueOfficeChatRail
                  linkId={linkId}
                  nativeLeagueId={board.summary.leagueId}
                  className="min-h-0 flex-1"
                />
              </aside>
            </div>
          </>
        )}
      </main>
    </>
  );
}
