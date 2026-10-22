import { createFileRoute } from "@tanstack/react-router";

import { MobileMockDraftSetupPage } from "@/components/mobile/mock-draft/MobileMockDraftSetupPage";

export const Route = createFileRoute("/m/mock-draft_/setup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Mock Draft Setup — The League Office" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MobileMockDraftSetupRoute,
});

function MobileMockDraftSetupRoute() {
  return <MobileMockDraftSetupPage />;
}
