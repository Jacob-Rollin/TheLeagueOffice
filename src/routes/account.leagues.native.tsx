import { createFileRoute, Navigate } from "@tanstack/react-router";

/** Legacy URL — create lives at /account/leagues/setup. */
export const Route = createFileRoute("/account/leagues/native")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Create League — The League Office" }, { name: "robots", content: "noindex" }],
  }),
  component: () => <Navigate to="/account/leagues/setup" replace />,
});
