import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * Legacy individual team URLs now land on Playbook Rosters with the
 * matching manager pre-selected via ?scout=.
 */
export const Route = createFileRoute("/team/$teamId")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Rosters — Playbook" }],
  }),
  component: LegacyTeamRedirect,
});

function LegacyTeamRedirect() {
  const { teamId } = Route.useParams();
  const scout = teamId?.trim();
  return (
    <Navigate
      to="/playbook/rosters"
      search={scout ? { scout } : {}}
      replace
    />
  );
}
