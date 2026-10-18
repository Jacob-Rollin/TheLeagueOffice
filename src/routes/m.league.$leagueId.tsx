import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import { MobilePullToRefresh } from "@/components/mobile/MobilePullToRefresh";
import {
  MobileLeagueActivitySheet,
  MobileLeagueBottomNav,
  mobileLeagueContentPad,
} from "@/components/mobile/league/MobileLeagueChrome";
import { useWaiverActivityWindow } from "@/components/mobile/league/useMobileLeague";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useNflState } from "@/hooks/useLeagueProjections";
import { refreshMobileLeagueSurface } from "@/lib/mobile-pull-refresh";

export const Route = createFileRoute("/m/league/$leagueId")({
  component: MobileLeagueLayout,
});

function MobileLeagueLayout() {
  const { leagueId } = Route.useParams();
  const { leagues, loading, activeLeague, setActiveLeagueId } = useActiveLeague();
  const exists = leagues.some((l) => l.id === leagueId);
  const showActivity = useWaiverActivityWindow();
  const queryClient = useQueryClient();
  const nflState = useNflState();
  const week = nflState.data?.week ?? null;

  useEffect(() => {
    if (exists && activeLeague?.id !== leagueId) setActiveLeagueId(leagueId);
  }, [exists, activeLeague?.id, leagueId, setActiveLeagueId]);

  const onRefresh = useCallback(async () => {
    if (!activeLeague) return;
    await refreshMobileLeagueSurface(queryClient, {
      id: activeLeague.id,
      leagueId: activeLeague.leagueId,
      platform: activeLeague.platform,
      week,
    });
  }, [activeLeague, queryClient, week]);

  if (loading || (exists && activeLeague?.id !== leagueId)) {
    return (
      <p className="px-5 py-16 text-center font-display text-sm font-semibold uppercase tracking-widest text-m-muted">
        Loading league...
      </p>
    );
  }

  if (!exists) {
    return (
      <div className="px-5 py-16 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-widest text-m-muted">
          League not found
        </p>
        <Link to="/m" className="mt-4 inline-block font-semibold text-m-accent">
          Back to My Leagues
        </Link>
      </div>
    );
  }

  return (
    <>
      <MobilePullToRefresh onRefresh={onRefresh}>
        <div style={{ paddingBottom: mobileLeagueContentPad(showActivity) }}>
          <Outlet />
        </div>
      </MobilePullToRefresh>
      {showActivity ? <MobileLeagueActivitySheet /> : null}
      <MobileLeagueBottomNav leagueId={leagueId} />
    </>
  );
}
