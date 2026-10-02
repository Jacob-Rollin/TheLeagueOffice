import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  MobileLeagueActivitySheet,
  MobileLeagueBottomNav,
  mobileLeagueContentPad,
} from "@/components/mobile/league/MobileLeagueChrome";
import { useWaiverActivityWindow } from "@/components/mobile/league/useMobileLeague";
import { useActiveLeague } from "@/context/ActiveLeagueContext";

export const Route = createFileRoute("/m/league/$leagueId")({
  component: MobileLeagueLayout,
});

function MobileLeagueLayout() {
  const { leagueId } = Route.useParams();
  const { leagues, loading, activeLeague, setActiveLeagueId } = useActiveLeague();
  const exists = leagues.some((l) => l.id === leagueId);
  const showActivity = useWaiverActivityWindow();

  useEffect(() => {
    if (exists && activeLeague?.id !== leagueId) setActiveLeagueId(leagueId);
  }, [exists, activeLeague?.id, leagueId, setActiveLeagueId]);

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
        <p className="font-display text-sm font-semibold uppercase tracking-widest text-m-muted">League not found</p>
        <Link to="/m" className="mt-4 inline-block font-semibold text-m-accent">
          Back to My Leagues
        </Link>
      </div>
    );
  }

  return (
    <>
      <div style={{ paddingBottom: mobileLeagueContentPad(showActivity) }}>
        <Outlet />
      </div>
      {showActivity ? <MobileLeagueActivitySheet /> : null}
      <MobileLeagueBottomNav leagueId={leagueId} />
    </>
  );
}
