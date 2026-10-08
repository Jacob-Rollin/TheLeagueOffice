import { createFileRoute } from "@tanstack/react-router";

import { NativeLeagueShell } from "@/components/native/NativeLeagueShell";

export const Route = createFileRoute("/league/$linkId")({
  ssr: false,
  head: () => ({
    meta: [{ title: "League — The League Office" }, { name: "robots", content: "noindex" }],
  }),
  component: NativeLeagueLayout,
});

function NativeLeagueLayout() {
  const { linkId } = Route.useParams();
  return <NativeLeagueShell linkId={linkId} />;
}
