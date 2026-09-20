import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/playbook/rankings")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Power Rankings — Playbook" }],
  }),
  component: PlaybookRankingsPage,
});

function PlaybookRankingsPage() {
  return <Navigate to="/standings" search={{ tab: "power" }} replace />;
}
