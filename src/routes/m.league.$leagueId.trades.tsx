import { createFileRoute } from "@tanstack/react-router";

import { MobileTradesView } from "@/components/mobile/league/MobileTransactionPages";

export const Route = createFileRoute("/m/league/$leagueId/trades")({
  component: MobileTradesView,
});
