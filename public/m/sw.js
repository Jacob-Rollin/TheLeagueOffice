/* Mobile PWA service worker — installability + offline splash only.
 *
 * Scope is /m/ (script lives under /m/).
 * - Precaches a tiny branded offline shell (HTML + logo).
 * - Serves those precached assets cache-first (so the logo paints offline).
 * - Other /m navigations are network-first, then offline.html.
 * - Never caches APIs, auth cookies, or desktop routes.
 */
const CACHE = "m-offline-v2";
const OFFLINE_URL = "/m/offline.html";
const LOGO_URL = "/m/icons/the-league-logo.png";
const PRECACHE = [OFFLINE_URL, LOGO_URL];
const PRECACHE_SET = new Set(PRECACHE);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Cache each asset individually so a logo miss does not skip the HTML shell.
      await Promise.all(
        PRECACHE.map(async (path) => {
          try {
            const res = await fetch(path, { cache: "reload" });
            if (res && res.ok) await cache.put(path, res.clone());
          } catch {
            /* keep installing */
          }
        }),
      );
      await self.skipWaiting();
    })(),
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

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Splash shell assets: cache-first so airplane mode can show the logo.
  if (PRECACHE_SET.has(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.ok) await cache.put(url.pathname, res.clone());
          return res;
        } catch {
          return (
            cached ||
            new Response("", { status: 504, statusText: "Offline" })
          );
        }
      })(),
    );
    return;
  }

  // Navigation documents only beyond the splash assets.
  if (req.mode !== "navigate") return;
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
