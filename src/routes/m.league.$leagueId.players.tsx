import { createFileRoute } from "@tanstack/react-router";

import { MobilePlayersView } from "@/components/mobile/league/MobilePlayersView";

export const Route = createFileRoute("/m/league/$leagueId/players")({
  component: MobilePlayersView,
});
