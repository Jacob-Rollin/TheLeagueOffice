import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Settings live under Account (My Leagues → Settings), matching synced leagues.
 * Keep this path as a redirect so old bookmarks still work.
 */
export const Route = createFileRoute("/league/$linkId/settings")({
  ssr: false,
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/account/leagues/native/$linkId",
      params: { linkId: params.linkId },
      replace: true,
    });
  },
});
