import { createFileRoute } from "@tanstack/react-router";

import { TruePowerRankingsPanel } from "@/components/playbook/panels";

export const Route = createFileRoute("/playbook/rankings")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Power Rankings — Playbook" }],
  }),
  component: PlaybookRankingsPage,
});

function PlaybookRankingsPage() {
  return <TruePowerRankingsPanel />;
}
