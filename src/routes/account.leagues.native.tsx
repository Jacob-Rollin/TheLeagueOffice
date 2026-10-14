import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout for `/account/leagues/native/*`.
 * Exact `/account/leagues/native` redirects from the index child — do not Navigate
 * here or `$linkId` settings will never render.
 */
export const Route = createFileRoute("/account/leagues/native")({
  ssr: false,
  component: () => <Outlet />,
});
