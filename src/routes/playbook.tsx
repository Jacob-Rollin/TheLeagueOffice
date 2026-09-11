import { Outlet, createFileRoute } from "@tanstack/react-router";

import { PlaybookShell } from "@/components/playbook/PlaybookShell";

export const Route = createFileRoute("/playbook")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Playbook — The League Office" },
      {
        name: "description",
        content: "League power rankings, roster matrix, and activity for your active synced league.",
      },
      { property: "og:title", content: "Playbook — The League Office" },
      { property: "og:description", content: "Your centralized fantasy league dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlaybookLayout,
});

function PlaybookLayout() {
  return (
    <PlaybookShell>
      <Outlet />
    </PlaybookShell>
  );
}
