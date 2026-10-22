import { createFileRoute } from "@tanstack/react-router";

import { MobileMockDraftArena } from "@/components/mobile/mock-draft/MobileMockDraftArena";
import { prefetchMockDraftClientCaches } from "@/lib/mock-draft-warm";
import { loadPlayersCatalog } from "@/lib/players-catalog";

export const Route = createFileRoute("/m/mock-draft")({
  ssr: false,
  // Kick the day-cached Sleeper catalog (and board extras) before the splash
  // paints — same client path as desktop; no Fluid.
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData({
      queryKey: ["players-catalog"],
      queryFn: () => loadPlayersCatalog(),
      staleTime: 1000 * 60 * 30,
    });
    prefetchMockDraftClientCaches();
  },
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
