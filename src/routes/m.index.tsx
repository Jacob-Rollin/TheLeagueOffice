import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  MobileJoinHero,
  MobileMockDraftCard,
  MobileMyLeagues,
  MobileTrending,
} from "@/components/mobile/MobileHomeSections";
import { MobilePullToRefresh } from "@/components/mobile/MobilePullToRefresh";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { refreshMobileHomeSurface } from "@/lib/mobile-pull-refresh";

export const Route = createFileRoute("/m/")({
  component: MobileHome,
});

function MobileHome() {
  const { leagues, loading } = useActiveLeague();
  const queryClient = useQueryClient();

  const onRefresh = useCallback(async () => {
    await refreshMobileHomeSurface(queryClient);
  }, [queryClient]);

  if (loading) {
    return (
      <p className="px-5 py-16 text-center font-display text-sm font-semibold uppercase tracking-widest text-m-muted">
        Loading your leagues...
      </p>
    );
  }

  return (
    <MobilePullToRefresh onRefresh={onRefresh}>
      <main>
        {leagues.length > 0 ? <MobileMyLeagues leagues={leagues} /> : <MobileJoinHero />}
        <div className="h-3" />
        <MobileMockDraftCard />
        <MobileTrending />
      </main>
    </MobilePullToRefresh>
  );
}
