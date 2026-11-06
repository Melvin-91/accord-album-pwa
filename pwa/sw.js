const CACHE = "accord-album-pwa-v1.15.4";
const FILES = [
  "./",
  "./index.html",
  "./style.css?v=36",
  "./core.mjs?v=46",
  "./ui.mjs?v=10",
  "./app.mjs?v=99",
  "./tidal.mjs?v=7",
  "./tidal-ui.mjs?v=18",
  "./qobuz.mjs?v=6",
  "./qobuz-playback.mjs?v=5",
  "./qobuz-ui.mjs?v=14",
  "./service-requests.mjs?v=2",
  "./catalog-suggestions.mjs?v=2",
  "./suggestions-ui.mjs?v=3",
  "./catalog-playlist.mjs?v=2",
  "./playlist-ui.mjs?v=2",
  "./music-app-links.mjs?v=1",
  "./music-suggestion-filters.mjs?v=1",
  "./manifest.json",
  "../assets/malt_metal.ico",
  "../assets/accord-192.png",
  "../assets/accord-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(
    FILES.map((file) => new Request(new URL(file, self.location.href), { cache: "reload" })),
  )));
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
