import { createFileRoute, Navigate } from "@tanstack/react-router";

/** Legacy URL — create/join lives on My Leagues as the League Office section. */
export const Route = createFileRoute("/account/leagues/native")({
  ssr: false,
  head: () => ({
    meta: [{ title: "My Leagues — The League Office" }, { name: "robots", content: "noindex" }],
  }),
  component: () => <Navigate to="/account/leagues" replace />,
});
