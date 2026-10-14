import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { navLinkClass } from "@/components/nav/NavMenus";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { listNativeLeagueSummaries } from "@/lib/native-league.functions";
import { cn } from "@/lib/utils";

/**
 * Top-nav entry into desktop native Fantasy (left of GlobalSearch).
 * Search expands leftward and covers this control when open.
 */
export function FantasyNavLink() {
  const { user, ready } = useAuth();
  const { leagues, activeLeague, setActiveLeagueId } = useActiveLeague();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = pathname.startsWith("/league/");

  const nativeFromContext = useMemo(
    () => leagues.filter((l) => (l.platform ?? "").toLowerCase() === "native"),
    [leagues],
  );

  const { data: summaries = [] } = useQuery({
    queryKey: ["native-league-summaries"],
    enabled: Boolean(ready && user?.id),
    staleTime: 60_000,
    retry: false,
    queryFn: () => listNativeLeagueSummaries(),
  });

  const targetLinkId = useMemo(() => {
    if (activeLeague && (activeLeague.platform ?? "").toLowerCase() === "native") {
      return activeLeague.id;
    }
    if (nativeFromContext[0]?.id) return nativeFromContext[0].id;
    return summaries[0]?.linkId ?? null;
  }, [activeLeague, nativeFromContext, summaries]);

  if (!ready) return null;

  if (!user || !targetLinkId) {
    return (
      <Link
        to="/account/leagues"
        className={cn(navLinkClass, "relative z-0")}
        data-status={active ? "active" : undefined}
      >
        Fantasy
      </Link>
    );
  }

  return (
    <Link
      to="/league/$linkId"
      params={{ linkId: targetLinkId }}
      preload="intent"
      className={cn(navLinkClass, "relative z-0")}
      data-status={active ? "active" : undefined}
      onClick={() => setActiveLeagueId(targetLinkId)}
    >
      Fantasy
    </Link>
  );
}
