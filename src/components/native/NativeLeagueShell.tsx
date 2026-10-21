import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { LeagueOfficeChatRail } from "@/components/native/LeagueOfficeChatRail";
import {
  isNativeLeagueToolsPath,
  NativeLeagueToolsNav,
} from "@/components/native/NativeLeagueToolsNav";
import { NativeLeagueSubNav } from "@/components/nav/NativeLeagueSubNav";
import { useAuth } from "@/hooks/useAuth";
import { getNativeLeagueBoard } from "@/lib/native-league.functions";

export function NativeLeagueShell({ linkId }: { linkId: string }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const showToolsNav = isNativeLeagueToolsPath(pathname, linkId);

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
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              {showToolsNav ? <NativeLeagueToolsNav linkId={linkId} /> : null}
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
        )}
      </main>
    </>
  );
}
