// famcal service worker: keeps the display useful through Wi-Fi drops.
// - App shell and Next static assets: cache first.
// - Our JSON APIs (events, weather, photos, config): network first, fall back to the last response.
// - SmugMug photos: cache first, capped.
const VERSION = "famcal-v2"; // bump to drop every old cache on the next visit
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const PHOTOS = `${VERSION}-photos`;
const MAX_PHOTOS = 60;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/icon.svg"]).catch(() => undefined)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName, cacheKey) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(cacheKey ?? request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(cacheKey ?? request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone());
    if (limit) {
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
    }
  }
  return response;
}

// Development builds reuse file names, so cache-first would serve stale code: don't cache at all.
const DEV = ["localhost", "127.0.0.1"].includes(self.location.hostname);

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (DEV || request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.hostname.endsWith("smugmug.com")) {
    event.respondWith(cacheFirst(request, PHOTOS, MAX_PHOTOS));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (url.pathname === "/api/events") {
    // One cache slot for events: the last 4+ weeks the display fetched.
    event.respondWith(networkFirst(request, DATA, "/api/events"));
    return;
  }
  if (["/api/weather", "/api/photos", "/api/config"].includes(url.pathname)) {
    event.respondWith(networkFirst(request, DATA));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg") {
    event.respondWith(cacheFirst(request, SHELL));
    return;
  }
  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(networkFirst(request, SHELL, "/"));
  }
});
