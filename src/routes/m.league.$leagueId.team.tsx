import { createFileRoute } from "@tanstack/react-router";

import { MobileTeamView } from "@/components/mobile/league/MobileTeamView";

export const Route = createFileRoute("/m/league/$leagueId/team")({
  component: MobileTeamPage,
});

function MobileTeamPage() {
  const { leagueId } = Route.useParams();
  return <MobileTeamView leagueId={leagueId} />;
}
