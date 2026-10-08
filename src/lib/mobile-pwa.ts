/**
 * Register a /m/-scoped service worker for installability only.
 * Safe no-op outside browsers / unsupported environments.
 */
export function registerMobilePwa(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  const path = window.location.pathname;
  if (path !== "/m" && !path.startsWith("/m/")) return;

  void navigator.serviceWorker.register("/m/sw.js", { scope: "/m/" }).catch(() => {
    /* installability is optional — never block the app */
  });
}
