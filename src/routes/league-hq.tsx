import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/league-hq")({
  ssr: false,
  component: () => <Navigate to="/playbook" replace />,
});
