import { createFileRoute } from "@tanstack/react-router";

import { MobileTradesView } from "@/components/mobile/league/MobileTransactionPages";

export const Route = createFileRoute("/m/league/$leagueId/trades")({
  component: MobileTradesPage,
});

function MobileTradesPage() {
  const { leagueId } = Route.useParams();
  return <MobileTradesView leagueId={leagueId} />;
}
