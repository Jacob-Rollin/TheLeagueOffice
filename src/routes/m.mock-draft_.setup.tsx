import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy setup URL — lobby lives at `/m/mock-draft` with settings behind the gear.
 * Keep this route so old bookmarks land on the lobby.
 */
export const Route = createFileRoute("/m/mock-draft_/setup")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/m/mock-draft" });
  },
  component: () => null,
});
