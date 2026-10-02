import { createFileRoute } from "@tanstack/react-router";

import {
  MobileJoinHero,
  MobileMockDraftCard,
  MobileMyLeagues,
  MobileTrending,
} from "@/components/mobile/MobileHomeSections";
import { useActiveLeague } from "@/context/ActiveLeagueContext";

export const Route = createFileRoute("/m/")({
  component: MobileHome,
});

function MobileHome() {
  const { leagues, loading } = useActiveLeague();

  if (loading) {
    return (
      <p className="px-5 py-16 text-center font-display text-sm font-semibold uppercase tracking-widest text-m-muted">
        Loading your leagues...
      </p>
    );
  }

  return (
    <main>
      {leagues.length > 0 ? <MobileMyLeagues leagues={leagues} /> : <MobileJoinHero />}
      <div className="h-3" />
      <MobileMockDraftCard />
      <MobileTrending />
    </main>
  );
}
