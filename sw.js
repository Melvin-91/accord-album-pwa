const CACHE = "accord-album-pwa-v1.7.2";
const FILES = [
  "./",
  "./index.html",
  "./style.css?v=26",
  "./core.mjs?v=39",
  "./ui.mjs?v=6",
  "./app.mjs?v=70",
  "./manifest.json",
  "./assets/malt_metal.ico",
  "./assets/accord-192.png",
  "./assets/accord-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("accord-album-pwa-") && key !== CACHE)
      .map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "accord-activate-update") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type !== "accord-offline-status" || !event.ports?.[0]) return;
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    const ready = (await Promise.all(FILES.map((file) => cache.match(file)))).every(Boolean);
    event.ports[0].postMessage({ cache: CACHE, ready });
  }).catch((error) => event.ports[0].postMessage({ error: error.message })));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const shellNavigation = request.mode === "navigate"
      && [new URL("./", self.location.href).pathname, new URL("./index.html", self.location.href).pathname].includes(url.pathname);
    const cached = await cache.match(request)
      || (shellNavigation ? await cache.match("./index.html") : null);
    return cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  }));
});
