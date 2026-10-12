/**
 * Register the /m/-scoped service worker (installability + offline splash).
 * The SW only precaches /m/offline.html + logo and falls back on failed
 * navigations — it does not cache APIs or desktop routes.
 * Safe no-op outside browsers / unsupported environments.
 */
export function registerMobilePwa(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  const path = window.location.pathname;
  if (path !== "/m" && !path.startsWith("/m/")) return;

  void navigator.serviceWorker.register("/m/sw.js", { scope: "/m/" }).catch(() => {
    /* installability / offline splash is optional — never block the app */
  });
}
