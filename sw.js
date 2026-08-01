const CACHE_PREFIX = "paperuss-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v20`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./changelog.json",
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
  const url = new URL(request.url);

  // Web Share Target POST Handler
  if (request.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith(
      (async () => {
        try {
          const formData = await request.formData();
          const title = formData.get("title") || "";
          const text = formData.get("text") || "";
          const sharedUrl = formData.get("url") || "";
          const mediaFiles = formData.getAll("media");

          const filesData = [];
          for (const file of mediaFiles) {
            if (file && typeof file === "object" && file.name) {
              const buffer = await file.arrayBuffer();
              filesData.push({
                name: file.name,
                type: file.type,
                buffer: Array.from(new Uint8Array(buffer))
              });
            }
          }

          const cache = await caches.open(CACHE_NAME);
          const payloadResponse = new Response(JSON.stringify({
            title, text, url: sharedUrl, files: filesData, timestamp: Date.now()
          }), { headers: { "Content-Type": "application/json" } });
          await cache.put("./__pending_shared_payload__", payloadResponse);

          return Response.redirect("./index.html?shared=1", 303);
        } catch (err) {
          return Response.redirect("./index.html", 303);
        }
      })()
    );
    return;
  }

  if (request.method !== "GET") return;

  // Release notes change independently from the app shell. Always attempt a
  // fresh request first, then fall back to the most recently cached document.
  if (url.origin === self.location.origin && url.pathname.endsWith("/changelog.json")) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(request)) ||
          new Response(JSON.stringify({ generatedAt: null, releases: [] }), {
            headers: { "Content-Type": "application/json" }, status: 503
          })
        )
    );
    return;
  }

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
