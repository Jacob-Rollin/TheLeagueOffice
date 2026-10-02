import { createFileRoute } from "@tanstack/react-router";

import { MobileMatchupView } from "@/components/mobile/league/MobileMatchupView";

export const Route = createFileRoute("/m/league/$leagueId/matchup")({
  component: MobileMatchupView,
});
