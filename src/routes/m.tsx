import { Outlet, createFileRoute } from "@tanstack/react-router";

import { MobileShell } from "@/components/mobile/MobileShell";

export const Route = createFileRoute("/m")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "The League Office — Mobile" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MobileLayout,
});

function MobileLayout() {
  return (
    <MobileShell>
      <Outlet />
    </MobileShell>
  );
}
