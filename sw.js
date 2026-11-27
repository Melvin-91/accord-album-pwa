const CACHE = "accord-album-pwa-v6.4.4";
const FILES = [
  "./",
  "./index.html",
  "./collection.css?v=22",
  "./physical-collection.css?v=3",
  "./suite.css?v=8",
  "./suite-accessibility.mjs?v=1",
  "./physical-collection.mjs?v=2",
  "./physical-collection-ui.mjs?v=3",
  "./unified-library.mjs?v=1",
  "./core.mjs?v=54",
  "./core.mjs?v=51",
  "./collection-app.mjs?v=56",
  "./transfer-queue.mjs?v=2",
  "./suite-switch.mjs?v=3",
  "./album-qol-v2.mjs?v=4",
  "./credential-backup.mjs?v=1",
  "./tidal-preview.mjs?v=1",
  "./collection-qol.mjs?v=4",
  "./collection-qol.mjs?v=6",
  "./command-icons.mjs?v=4",
  "./collection-store.mjs?v=15",
  "./collection-sync.mjs?v=11",
  "./edition-links-sync.mjs?v=1",
  "./duration-sync.mjs?v=1",
  "./collection-services.mjs?v=22",
  "./edition-comparison.mjs?v=4",
  "./music-suggestion-filters.mjs?v=4",
  "./music-suggestion-recipes.mjs?v=2",
  "./music-completion.mjs?v=7",
  "./music-continuity.mjs?v=13",
  "./ui.mjs?v=25",
  "./tidal.mjs?v=17",
  "./tidal.mjs?v=18",
  "./qobuz.mjs?v=12",
  "./service-requests.mjs?v=4",
  "./music-app-links.mjs?v=5",
  "./music-app-links.mjs?v=7",
  "./album-association.mjs?v=15",
  "./music-library-choices.mjs?v=2",
  "./manifest.json?brand=album-1445",
  "./assets/malt_metal.ico",
  "./assets/accord-180.png?brand=album-1445",
  "./assets/accord-192.png?brand=album-1445",
  "./assets/accord-512.png?brand=album-1445",
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
