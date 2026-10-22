import { createFileRoute } from "@tanstack/react-router";

import { MobileMockDraftArena } from "@/components/mobile/mock-draft/MobileMockDraftArena";

export const Route = createFileRoute("/m/mock-draft")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Mock Draft — The League Office" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MobileMockDraftRoute,
});

function MobileMockDraftRoute() {
  return <MobileMockDraftArena />;
}
