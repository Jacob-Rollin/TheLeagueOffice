/* Mobile PWA service worker — installability + offline splash only.
 *
 * Scope is /m/ (script lives under /m/).
 * - Precaches a tiny branded offline shell (HTML + logo).
 * - Fetch handler is navigation-only under /m: network-first, then offline.html.
 * - Never caches APIs, auth cookies, or desktop routes.
 */
const CACHE = "m-offline-v1";
const OFFLINE_URL = "/m/offline.html";
const PRECACHE = [OFFLINE_URL, "/m/icons/the-league-logo.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("m-offline-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Navigation documents only — never intercept XHR/fetch/API/asset traffic.
  if (req.mode !== "navigate") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname !== "/m" && !url.pathname.startsWith("/m/")) return;

  event.respondWith(
    fetch(req)
      .then((res) => res)
      .catch(async () => {
        const cache = await caches.open(CACHE);
        const offline = await cache.match(OFFLINE_URL);
        return (
          offline ||
          new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }),
  );
});
