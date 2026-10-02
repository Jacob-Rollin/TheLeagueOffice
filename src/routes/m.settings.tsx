import { createFileRoute, useRouter } from "@tanstack/react-router";

import { MobileSettingsOverlay } from "@/components/mobile/MobileSettings";

export const Route = createFileRoute("/m/settings")({
  component: MobileSettingsRoute,
});

function MobileSettingsRoute() {
  const router = useRouter();
  return (
    <MobileSettingsOverlay
      onClose={() => (router.history.canGoBack() ? router.history.back() : void router.navigate({ to: "/m" }))}
    />
  );
}
