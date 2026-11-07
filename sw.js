const CACHE = "accord-album-pwa-v1.18.0";
const FILES = [
  "./",
  "./index.html",
  "./style.css?v=37",
  "./core.mjs?v=48",
  "./ui.mjs?v=15",
  "./app.mjs?v=108",
  "./runtime-status.mjs?v=1",
  "./tidal.mjs?v=9",
  "./tidal-ui.mjs?v=24",
  "./qobuz.mjs?v=8",
  "./qobuz-playback.mjs?v=7",
  "./qobuz-ui.mjs?v=19",
  "./service-requests.mjs?v=2",
  "./catalog-suggestions.mjs?v=4",
  "./suggestions-ui.mjs?v=9",
  "./music-suggestion-recipes.mjs?v=1",
  "./edition-comparison.mjs?v=1",
  "./music-qol.mjs?v=2",
  "./music-completion.mjs?v=5",
  "./music-completion-ui.mjs?v=5",
  "./catalog-playlist.mjs?v=4",
  "./playlist-ui.mjs?v=6",
  "./music-continuity.mjs?v=3",
  "./music-app-links.mjs?v=1",
  "./music-suggestion-filters.mjs?v=1",
  "./manifest.json",
  "./assets/malt_metal.ico",
  "./assets/accord-192.png",
  "./assets/accord-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(
    FILES.map((file) => new Request(new URL(file, self.location.href), { cache: "reload" })),
  )));
});

self.addEventListener("activate", (event) => {
  // Other tabs keep their loaded app until they explicitly confirm a restart.
  event.waitUntil(self.clients.claim());
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

async function previousAsset(request) {
  for (const key of await caches.keys()) {
    if (!key.startsWith("accord-album-pwa-") || key === CACHE) continue;
    const asset = await (await caches.open(key)).match(request);
    if (asset) return asset;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const shellNavigation = request.mode === "navigate"
      && [new URL("./", self.location.href).pathname, new URL("./index.html", self.location.href).pathname].includes(url.pathname);
    const cached = await cache.match(request)
      || (request.mode !== "navigate" ? await previousAsset(request) : null)
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
