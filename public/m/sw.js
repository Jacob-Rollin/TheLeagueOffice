/* Mobile PWA service worker — installability only.
 *
 * Scope is /m/ (script lives under /m/). No fetch handler and no Cache Storage
 * so desktop routes, APIs, and auth cookies are never intercepted or stale-cached.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
