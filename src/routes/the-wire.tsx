import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/the-wire")({
  component: () => <Navigate to="/waiver" replace />,
});
