import { createFileRoute } from "@tanstack/react-router";

import { MobileMatchupView } from "@/components/mobile/league/MobileMatchupView";
import { REGULAR_SEASON_WEEKS } from "@/components/mobile/league/lineupShared";

type MatchupSearch = {
  week?: number;
};

function parseWeek(raw: unknown): number | undefined {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1 || n > REGULAR_SEASON_WEEKS) return undefined;
  return n;
}

export const Route = createFileRoute("/m/league/$leagueId/matchup")({
  validateSearch: (search: Record<string, unknown>): MatchupSearch => {
    const week = parseWeek(search["week"]);
    return week != null ? { week } : {};
  },
  component: MobileMatchupPage,
});

function MobileMatchupPage() {
  const { week } = Route.useSearch();
  return week != null ? <MobileMatchupView initialWeek={week} /> : <MobileMatchupView />;
}
