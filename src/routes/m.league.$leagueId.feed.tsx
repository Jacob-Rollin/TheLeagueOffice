import { createFileRoute } from "@tanstack/react-router";

import { MobileFeedView } from "@/components/mobile/league/MobileFeedView";

export const Route = createFileRoute("/m/league/$leagueId/feed")({
  component: MobileFeedView,
});
