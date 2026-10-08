import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { MobileShell } from "@/components/mobile/MobileShell";
import { registerMobilePwa } from "@/lib/mobile-pwa";

export const Route = createFileRoute("/m")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "The League Office — Mobile" },
      { name: "robots", content: "noindex" },
      { name: "theme-color", content: "#1ba3c6" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "League Office" },
    ],
    links: [
      { rel: "manifest", href: "/m/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/m/icons/apple-touch-icon.png" },
    ],
  }),
  component: MobileLayout,
});

function MobileLayout() {
  useEffect(() => {
    registerMobilePwa();
  }, []);

  return (
    <MobileShell>
      <Outlet />
    </MobileShell>
  );
}
