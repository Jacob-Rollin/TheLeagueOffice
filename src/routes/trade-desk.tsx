import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/trade-desk")({
  component: () => <Navigate to="/trade" replace />,
});
