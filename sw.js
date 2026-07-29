const CACHE_PREFIX = "paperuss-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v16`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/css/core.css",
  "./assets/css/features.css",
  "./assets/css/responsive.css",
  "./assets/css/settings.css",
  "./assets/icons/paperuss-logo.png",
  "./assets/icons/paperuss-192.png",
  "./assets/icons/paperuss-512.png",
  "./js/core.js",
  "./js/productivity.js",
  "./js/editor-ui.js",
  "./js/tasks-settings.js",
  "./js/cloud-notifications.js",
  "./js/actions.js",
  "./js/formatting.js",
  "./js/media.js",
  "./js/data-transfer.js",
  "./js/responsive-images.js",
  "./js/tables.js",
  "./js/bootstrap.js"
];
const STATIC_CDN_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "unpkg.com",
  "www.gstatic.com"
]);

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(request)) ||
          (await caches.match("./index.html"))
        )
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached =>
        cached ||
        fetch(request).then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
      )
    );
    return;
  }

  if (STATIC_CDN_HOSTS.has(url.hostname)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok || response.type === "opaque") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});
