import { createFileRoute } from "@tanstack/react-router";

import { MobileWaiversView } from "@/components/mobile/league/MobileTransactionPages";

export const Route = createFileRoute("/m/league/$leagueId/waivers")({
  component: MobileWaiversPage,
});

function MobileWaiversPage() {
  const { leagueId } = Route.useParams();
  return <MobileWaiversView leagueId={leagueId} />;
}
