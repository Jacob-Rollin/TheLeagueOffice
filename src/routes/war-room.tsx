import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/war-room")({
  component: () => <Navigate to="/draft" replace />,
});
