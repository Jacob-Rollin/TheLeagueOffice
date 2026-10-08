import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { getNativeLeagueBoard } from "@/lib/native-league.functions";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/league/$linkId", label: "Dashboard", end: true },
  { to: "/league/$linkId/my-team", label: "My Team", end: false },
  { to: "/league/$linkId/matchup", label: "Matchup", end: false },
  { to: "/league/$linkId/standings", label: "Standings", end: false },
  { to: "/league/$linkId/players", label: "Players", end: false },
  { to: "/league/$linkId/transactions", label: "Transactions", end: false },
  { to: "/league/$linkId/draft", label: "Draft", end: false },
  { to: "/league/$linkId/settings", label: "Settings", end: false },
] as const;

export function NativeLeagueShell({ linkId }: { linkId: string }) {
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const userId = user?.id ?? null;

  const { data: board, isLoading, error } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(userId && linkId),
    staleTime: 60_000,
    retry: false,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });

  if (!userId) {
    return (
      <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
        <p className="text-sm text-muted-foreground">Sign in to open this league.</p>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
        <p className="text-sm text-muted-foreground">Loading league…</p>
      </main>
    );
  }

  if (error || !board) {
    return (
      <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "League not found or you are not a member."}
        </p>
        <Link to="/account/leagues" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
          Back to My Leagues
        </Link>
      </main>
    );
  }

  const { summary } = board;

  return (
    <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Native League</p>
          <h1 className="display-title text-3xl text-slate-900">
            {(() => {
              const parts = summary.name.trim().split(/\s+/);
              if (parts.length < 2) return <span className="text-primary">{summary.name}</span>;
              const last = parts.pop()!;
              return (
                <>
                  {parts.join(" ")} <span className="text-primary">{last}</span>
                </>
              );
            })()}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground capitalize">
            {summary.status.replace("_", " ")} · {summary.draftStatus.replace("_", " ")} draft ·{" "}
            {summary.filledTeams}/{summary.teamCount} teams
          </p>
        </div>
        <Link
          to="/account/leagues"
          className="rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground"
        >
          My Leagues
        </Link>
      </div>

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-border">
        {NAV.map((item) => {
          const href =
            item.to === "/league/$linkId" ? `/league/${linkId}` : item.to.replace("$linkId", linkId);
          const active = item.end ? pathname === href || pathname === `${href}/` : pathname.startsWith(href);
          return (
            <Link
              key={item.to}
              to={item.to}
              params={{ linkId }}
              className={cn(
                "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <Outlet />
    </main>
  );
}
