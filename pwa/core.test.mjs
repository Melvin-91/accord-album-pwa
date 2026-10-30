import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  albumPrimaryGenre,
  albumSecondaryGenres,
  addPlaylistAlbums,
  aggregateDiscogsEditionRatings,
  bestSpotifyAlbumSuggestionMatch,
  createTimedJsonCache,
  decodeCoverArchive,
  encodeCoverArchive,
  createConditionalJsonCache,
  createSpotifyJsonReader,
  createSpotifyTransport,
  expandSimilarArtists,
  filterAlbums,
  filterUnheardArtists,
  filterListeningAlbumSuggestions,
  findSpotifyPlaylistMatches,
  lastFmAlbumCatalog,
  lastFmSuggestionRange,
  listeningAlbumSuggestions,
  listenBrainzRecommendations,
  musicBrainzCoverArtUrl,
  moveAlbumInManualOrder,
  normalizeAlbumStatus,
  NO_PRIMARY_GENRE_FILTER,
  NO_SECONDARY_GENRE_FILTER,
  playlistAlbumRecords,
  primaryAlbumGenres,
  readLastFmAllTimeArtists,
  readMusicBrainzCatalog,
  readSpotifyPlaylistItems,
  readSpotifySearchPages,
  rankDiscogsSuggestionAlbums,
  retryMusicBrainzRequest,
  sortAlbumsByManualOrder,
  spotifyAlbumId,
  spotifyCacheableRead,
  spotifyPlaylistId,
  spotifyRedirectUriForPage,
  shouldStopDiscogsSuggestionQueue,
  summarizeLastFmTracks,
  topTracksPerAlbum,
  topListenedAlbums,
  threeWayMerge,
  validateAlbum,
  validateDocument,
  validateLastFmHistoryDocument,
  writeSpotifyPlaylistItems,
} from "./core.mjs";
import {
  localCommandResults,
  normalizeCollectionPreferences,
  prepareAlbumUpdates,
  visibleSelection,
} from "./ui.mjs";

test("local view preferences reject malformed storage and never decorate album titles", () => {
  for (const value of [null, [], 42, "bad", { layout: "invalid", pinnedIds: false }]) {
    assert.deepEqual(normalizeCollectionPreferences(value), { layout: "comfortable", pinnedIds: [] });
  }
  assert.deepEqual(normalizeCollectionPreferences({
    layout: "compact", pinnedIds: ["abc", "abc", null, "../bad", "xyz"],
  }), { layout: "compact", pinnedIds: ["abc", "xyz"] });
  const record = { id: "abc", name: "Original album" };
  normalizeCollectionPreferences({ pinnedIds: [record.id] });
  assert.equal(record.name, "Original album");
});

test("selection is limited to visible albums and cannot retain filtered or deleted records", () => {
  const selected = new Set(["a", "b", "deleted"]);
  assert.deepEqual([...visibleSelection(selected, [{ id: "b" }, { id: "c" }])], ["b"]);
  assert.equal(selected.size, 3, "reconciliation does not mutate the caller");
  assert.equal(visibleSelection(selected, []).size, 0);
});

test("bulk updates preserve unselected albums, metadata and manual order, and validate atomically", () => {
  const records = [
    { id: "b", name: "One", status: "queued", collections: ["Favorites"] },
    { id: "a", name: "Two", status: "liked", collections: [] },
  ];
  const next = prepareAlbumUpdates(records, new Set(["b"]), { status: "listening" }, (value) => value);
  assert.deepEqual(next.map((record) => record.id), ["b", "a"]);
  assert.equal(next[0].status, "listening");
  assert.deepEqual(next[0].collections, ["Favorites"]);
  assert.equal(next[1], records[1]);
  assert.equal(records[0].status, "queued");
  assert.throws(() => prepareAlbumUpdates(records, new Set(["a", "b"]), {}, (value) => {
    if (value.id === "a") throw new Error("invalid");
    return value;
  }), /invalid/);
  assert.equal(records[0].status, "queued");
});

test("command search is local, bounded, multiword, and independent from collection filters", () => {
  const commands = [{ id: "collection", label: "Vai alla raccolta" }];
  const albums = [
    { id: "a", name: "Kind of Blue", artist: "Miles Davis", genres: ["Jazz"], tags: ["Night"], collections: ["Classics"] },
    { id: "b", name: "Blue Train", artist: "John Coltrane", genres: ["Jazz"] },
  ];
  assert.deepEqual(localCommandResults("", commands, albums), commands);
  assert.equal(localCommandResults("miles blue", commands, albums)[0].albumId, "a");
  assert.equal(localCommandResults("classics night", commands, albums)[0].albumId, "a");
  assert.equal(localCommandResults("jazz", commands, albums).length, 2);
  assert.equal(localCommandResults("raccolta", commands, albums)[0].id, "collection");
  assert.equal(localCommandResults("not present", commands, albums).length, 0);
  assert.equal(localCommandResults("jazz", commands, albums, 1).length, 1);
  assert.equal(localCommandResults("jazz", [], Array.from({ length: 60 }, (_, id) => ({
    id: String(id), name: "Jazz", artist: "Artist",
  }))).length, 30);
});

const uiAppSource = readFileSync(new URL("./app.mjs", import.meta.url), "utf8");
function appFunction(start, end) {
  const beginning = uiAppSource.indexOf(start);
  const ending = uiAppSource.indexOf(end, beginning + start.length);
  assert.ok(beginning >= 0 && ending > beginning, `${start} exists`);
  return uiAppSource.slice(beginning, ending);
}

test("album persistence rolls back the collection on storage failure", () => {
  const previous = [{ id: "a", status: "queued" }];
  const state = { albums: previous };
  const context = {
    state, prepareAlbumUpdates, validateAlbum: (album) => album,
    saveState: () => { throw new Error("storage full"); },
    setSyncState: () => assert.fail("must not announce a failed save"),
  };
  const body = appFunction("function commitAlbumChanges(", "\nfunction openAlbumDetails(");
  assert.throws(() => runInNewContext(`${body}\ncommitAlbumChanges(new Set(["a"]), {status: "liked"});`, context), /storage full/);
  assert.equal(state.albums, previous);
  assert.equal(state.albums[0].status, "queued");
  state.loadError = "corrupted";
  assert.throws(() => runInNewContext(`${body}\ncommitAlbumChanges(new Set(["a"]), {});`, context), /non leggibile/);
});

test("reset clears all local filters including pinned-only without changing saved sort or making requests", () => {
  const elements = new Map(["#searchInput", "#primaryGenreFilter", "#secondaryGenreFilter",
    "#statusFilter", "#collectionFilter", "#tagFilter"].map((id) => [id, { value: "active", focus() {} }]));
  elements.set("#pinnedOnlyInput", { checked: true });
  const state = { sortOrder: "manual", manualOrder: ["b", "a"] };
  let renders = 0;
  runInNewContext(`${appFunction("function resetCollectionFilters(", "\nfunction updateSelectionToolbar(")}\nresetCollectionFilters();`, {
    $: (id) => elements.get(id), state, render: () => { renders += 1; },
    fetch: () => assert.fail("filters must not fetch"),
  });
  assert.equal(renders, 1);
  assert.equal(elements.get("#pinnedOnlyInput").checked, false);
  assert.equal([...elements.values()].some((element) => element.value), false);
  assert.deepEqual(state, { sortOrder: "manual", manualOrder: ["b", "a"] });
});

test("contextual selection actions are hidden until an album is selected", () => {
  const elements = new Map(["#selectionToolbar", "#selectionCount", "#applyBulkStatus", "#bulkStatus"]
    .map((id) => [id, { value: "" }]));
  const context = { $: (id) => elements.get(id), selectedAlbumIds: new Set() };
  const body = appFunction("function updateSelectionToolbar(", "\nfunction commitAlbumChanges(");
  const update = () => runInNewContext(`${body}\nupdateSelectionToolbar();`, context);
  update();
  assert.equal(elements.get("#selectionToolbar").hidden, true);
  context.selectedAlbumIds.add("a");
  update();
  assert.equal(elements.get("#selectionToolbar").hidden, false);
  assert.equal(elements.get("#applyBulkStatus").disabled, true);
  elements.get("#bulkStatus").value = "liked";
  update();
  assert.equal(elements.get("#applyBulkStatus").disabled, false);
});

test("local cover rendering never enqueues catalog work, while explicit loading retains the existing queue", async () => {
  const albums = [{ id: "a", cover_sha256: null }, { id: "b", cover_sha256: "hash" }];
  const cards = albums.map((album) => ({
    dataset: { albumId: album.id }, classList: { contains: () => false },
  }));
  const queued = [];
  const context = {
    $: () => ({ children: cards }), getCachedCover: async () => null,
    coverRenderGeneration: 1,
    enqueueCollectionCover: (task) => queued.push(task.album.id),
    collectionCoverFailures: new Map(), updateCollectionCoverNotice() {},
    setSyncState() {}, showMessage: (_title, message) => assert.fail(message),
  };
  const body = appFunction("async function renderCovers(", "\nfunction collectionCoverTaskIsCurrent(");
  context.albums = albums;
  await runInNewContext(`${body}\nrenderCovers(albums, 1, false);`, context);
  assert.deepEqual(queued, []);
  await runInNewContext(`${body}\nrenderCovers(albums, 1, true);`, context);
  assert.deepEqual(queued, ["a", "b"]);
});

test("offline shell versions include every local module and responsive dialogs keep native modality", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  for (const file of ["app.mjs?v=59", "style.css?v=22"]) {
    assert.ok(html.includes(file));
    assert.ok(sw.includes(file));
  }
  for (const file of ["core.mjs?v=34", "ui.mjs?v=1"]) {
    assert.ok(uiAppSource.includes(file));
    assert.ok(sw.includes(file));
  }
  assert.match(html, /<dialog id="albumDetailsDialog" aria-labelledby="albumDetailsTitle">/);
  assert.match(html, /id="selectionToolbar"[^>]+hidden/);
  assert.match(css, /#albumDetailsDialog[^}]+92dvh/);
  assert.match(uiAppSource, /albumDetailsDialog"\)\.showModal\(\)/);
});

test("Collection secondary menu requires a specific primary with subgenres", () => {
  class Select {
    value = "";
    options = [];
    disabled = false;
    replaceChildren(option) {
      this.options = [option];
      this.value = option.value;
    }
    add(option) { this.options.push(option); }
  }
  const primary = new Select();
  const secondary = new Select();
  const albums = [
    { primary_genre: "Metal", genres: ["Metal", "Power metal"] },
    { primary_genre: "Jazz", genres: ["Jazz", "Bebop"] },
    { primary_genre: "Rock", genres: ["Rock"] },
    { genres: [] },
  ];
  const source = readFileSync(new URL("./app.mjs", import.meta.url), "utf8");
  const beginning = source.indexOf("function refreshGenreFilters()");
  const ending = source.indexOf("\nfunction render(", beginning);
  assert.ok(beginning >= 0 && ending > beginning);
  const context = {
    $: (selector) => selector === "#primaryGenreFilter" ? primary : secondary,
    state: { albums }, albumPrimaryGenre, albumSecondaryGenres,
    NO_PRIMARY_GENRE_FILTER, NO_SECONDARY_GENRE_FILTER,
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
  };
  const refresh = () => runInNewContext(`${source.slice(beginning, ending)}\nrefreshGenreFilters();`, context);
  const values = () => secondary.options.map((option) => option.value);
  refresh();
  assert.equal(secondary.disabled, true);
  assert.equal(secondary.value, "");
  assert.equal(values().includes("power metal"), false);
  primary.value = "metal";
  refresh();
  assert.equal(secondary.disabled, false);
  assert.equal(values().includes("power metal"), true);
  assert.equal(values().includes("bebop"), false);
  secondary.value = "power metal";
  primary.value = "jazz";
  refresh();
  assert.equal(secondary.value, "");
  assert.equal(values().includes("power metal"), false);
  assert.equal(values().includes("bebop"), true);
  secondary.value = "bebop";
  primary.value = "";
  refresh();
  assert.equal(secondary.disabled, true);
  assert.equal(secondary.value, "");
  for (const value of ["rock", NO_PRIMARY_GENRE_FILTER]) {
    primary.value = value;
    refresh();
    assert.equal(secondary.disabled, true);
    assert.equal(secondary.value, "");
  }
});

const spotifyResponse = (value, headers = {}, status = 200) => ({
  status, headers, json: async () => value,
});

const spotifyCooldownKey = "accord-spotify-rate-limit-until-v1";
function spotifyTransportFixture(handler, overrides = {}) {
  let time = Date.UTC(2026, 9, 28);
  const values = new Map();
  const calls = [];
  const waits = [];
  const options = {
    storage: { getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value) },
    now: () => time,
    wait: async (delay) => { waits.push(delay); time += delay; },
    random: () => 0,
    fetch: async (url, init) => {
      calls.push({ url, init, time });
      return handler(url, init, calls.length);
    },
    ...overrides,
  };
  return { transport: createSpotifyTransport(options), options, values, calls, waits,
    now: () => time };
}
const spotifyHttpResponse = (status, retryAfter, error = {}) => ({
  status,
  headers: new Headers(retryAfter === undefined ? {} : { "Retry-After": retryAfter }),
  clone: () => ({ json: async () => ({ error }) }),
});

test("Spotify OAuth 429 publishes a cooldown consumed by catalog reads and token exchanges", async () => {
  const tokenUrl = "https://accounts.spotify.com/api/token";
  const fixture = spotifyTransportFixture((_url, _init, count) =>
    spotifyHttpResponse(count === 1 ? 429 : 200, "3"));
  await assert.rejects(fixture.transport.fetch(tokenUrl, { method: "POST" }), /Limite richieste/);
  assert.equal(fixture.calls.length, 1, "token grants must not be replayed automatically");
  await assert.rejects(fixture.transport.fetch(tokenUrl, { method: "POST" }), /Limite richieste/);
  assert.equal(fixture.calls.length, 1, "refresh and authorization-code exchange obey the cooldown");
  await fixture.transport.fetch("https://api.spotify.com/v1/search", {}, true);
  assert.deepEqual(fixture.waits, [3000]);
  assert.equal(fixture.calls[1].time - fixture.calls[0].time, 3000);
});

test("Spotify Web API 429 blocks refresh and playlist writes without sending them", async () => {
  const fixture = spotifyTransportFixture(() => spotifyHttpResponse(429, "31"));
  await assert.rejects(fixture.transport.fetch("catalog", {}, true), /31 secondi/);
  for (const url of ["https://accounts.spotify.com/api/token", "playlist"]) {
    await assert.rejects(fixture.transport.fetch(url, { method: "POST" }), /31 secondi/);
  }
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(fixture.waits, []);
});

test("Spotify Retry-After accepts seconds, HTTP dates and a conservative missing-header fallback", async () => {
  for (const [value, delay] of [["2.5", 2500], ["0", 1000], [undefined, 5000],
    ["invalid", 5000], ["Wed, 28 Oct 2026 00:00:07 GMT", 7000]]) {
    const fixture = spotifyTransportFixture((_url, _init, count) =>
      spotifyHttpResponse(count === 1 ? 429 : 200, value));
    await fixture.transport.fetch("catalog", {}, true);
    assert.deepEqual(fixture.waits, [delay]);
    assert.equal(fixture.calls.length, 2);
  }
});

test("Spotify read retries are bounded, quota errors are not retried, and cooldown survives exhaustion", async () => {
  const fixture = spotifyTransportFixture(() => spotifyHttpResponse(429, "1"));
  await assert.rejects(fixture.transport.fetch("catalog", {}, true), /Limite richieste/);
  assert.equal(fixture.calls.length, 3);
  assert.deepEqual(fixture.waits, [1000, 1000]);
  assert.equal(Number(fixture.values.get(spotifyCooldownKey)), fixture.now() + 1000);
  const quota = spotifyTransportFixture(() =>
    spotifyHttpResponse(429, "2", { reason: "quota_exceeded" }));
  await assert.rejects(quota.transport.fetch("catalog", {}, true), /Developer Dashboard/);
  assert.equal(quota.calls.length, 1);
  assert.deepEqual(quota.waits, []);
});

test("Spotify 429 never shortens a cooldown extended by another client while its request was in flight", async () => {
  let fixture;
  fixture = spotifyTransportFixture(() => {
    fixture.values.set(spotifyCooldownKey, String(fixture.now() + 60_000));
    return spotifyHttpResponse(429, "1");
  });
  const started = fixture.now();
  await assert.rejects(fixture.transport.fetch("catalog", {}, true), /59 secondi/);
  assert.equal(Number(fixture.values.get(spotifyCooldownKey)), started + 60_000);
  assert.equal(fixture.calls.length, 1);
});

test("Spotify 429 without a JSON error body still persists and enforces Retry-After", async () => {
  const fixture = spotifyTransportFixture(() => ({
    status: 429,
    headers: new Headers({ "Retry-After": "9" }),
    clone: () => ({ json: async () => { throw new SyntaxError("not JSON"); } }),
  }));
  await assert.rejects(fixture.transport.fetch("token", { method: "POST" }), /9 secondi/);
  await assert.rejects(fixture.transport.fetch("playlist", { method: "POST" }), /9 secondi/);
  assert.equal(fixture.calls.length, 1);
  assert.equal(Number(fixture.values.get(spotifyCooldownKey)), fixture.now() + 9000);
});

test("Spotify aborted 429 body preserves cooldown and blocks the next POST without fetching", async () => {
  const fixture = spotifyTransportFixture(() => ({
    status: 429,
    headers: new Headers({ "Retry-After": "9" }),
    clone: () => ({ json: async () => {
      throw new DOMException("Body reading aborted", "AbortError");
    } }),
  }));
  await assert.rejects(fixture.transport.fetch("token", { method: "POST" }), /9 secondi/);
  assert.equal(Number(fixture.values.get(spotifyCooldownKey)), fixture.now() + 9000);
  await assert.rejects(fixture.transport.fetch("playlist", { method: "POST" }), /9 secondi/);
  assert.equal(fixture.calls.length, 1);
  assert.equal(Number(fixture.values.get(spotifyCooldownKey)), fixture.now() + 9000);
});

test("Spotify uncertain OAuth/playlist writes are never retried for network errors or 5xx", async () => {
  for (const url of ["https://accounts.spotify.com/api/token", "playlist"]) {
    for (const status of [0, 500, 503]) {
      const fixture = spotifyTransportFixture(() => {
        if (!status) throw new TypeError("offline");
        return spotifyHttpResponse(status);
      });
      if (!status) await assert.rejects(fixture.transport.fetch(url, { method: "POST" }), /offline/);
      else assert.equal((await fixture.transport.fetch(url, { method: "POST" })).status, status);
      assert.equal(fixture.calls.length, 1);
      assert.deepEqual(fixture.waits, []);
    }
  }
});

test("Spotify transient GET retries back off and recheck a newly extended shared cooldown", async () => {
  let fixture;
  fixture = spotifyTransportFixture((_url, _init, count) => {
    if (count === 1) {
      fixture.values.set(spotifyCooldownKey, String(fixture.now() + 2000));
      throw new TypeError("offline");
    }
    return spotifyHttpResponse(count === 2 ? 503 : 200);
  });
  await fixture.transport.fetch("catalog", {}, true);
  assert.deepEqual(fixture.waits, [500, 1500, 1000]);
  assert.equal(fixture.calls.length, 3);
  assert.equal(fixture.calls[1].time - fixture.calls[0].time, 2000);
});

test("Spotify transports in separate tabs serialize through the same Web Lock and share OAuth cooldown", async () => {
  let sharedQueue = Promise.resolve();
  const lockNames = [];
  const lock = (name, task) => {
    lockNames.push(name);
    const result = sharedQueue.then(task);
    sharedQueue = result.catch(() => {});
    return result;
  };
  const fixture = spotifyTransportFixture((_url, _init, count) =>
    spotifyHttpResponse(count === 1 ? 429 : 200, "4"), { lock });
  const secondTab = createSpotifyTransport(fixture.options);
  const results = await Promise.allSettled([
    fixture.transport.fetch("https://accounts.spotify.com/api/token", { method: "POST" }),
    secondTab.fetch("playlist", { method: "POST" }),
  ]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(lockNames, ["accord-spotify-api", "accord-spotify-api"]);
  await secondTab.fetch("catalog", {}, true);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[1].time - fixture.calls[0].time, 4000);
});

test("Spotify one-tab queue serializes different endpoints even without Web Locks", async () => {
  let release;
  const fixture = spotifyTransportFixture((_url, _init, count) => count === 1
    ? new Promise((resolve) => { release = resolve; }) : spotifyHttpResponse(200));
  const first = fixture.transport.fetch("catalog", {}, true);
  const second = fixture.transport.fetch("https://accounts.spotify.com/api/token", { method: "POST" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof release, "function");
  assert.equal(fixture.calls.length, 1);
  release(spotifyHttpResponse(200));
  await Promise.all([first, second]);
  assert.equal(fixture.calls.length, 2);
});

test("Spotify cache subtracts intermediary Age and apparent Date age, including revalidation", () => {
  const now = Date.UTC(2026, 9, 28);
  const cache = createConditionalJsonCache({ now: () => now });
  for (const headers of [{ Age: "60" }, { Date: new Date(now - 60_000).toUTCString() }]) {
    cache.set("old", { value: 1 }, { "Cache-Control": "max-age=60", ETag: '"v1"', ...headers });
    assert.equal(cache.get("old"), undefined);
    assert.equal(cache.stale("old").etag, '"v1"');
  }
  cache.revalidate("old", { Age: "61", "Cache-Control": "max-age=60" });
  assert.equal(cache.get("old"), undefined);
  cache.revalidate("old", { Date: new Date(now).toUTCString(), "Cache-Control": "max-age=60" });
  assert.deepEqual(cache.get("old"), { value: 1 });
});

test("Spotify concurrent equivalent GETs use one request and independent JSON copies", async () => {
  const reader = createSpotifyJsonReader();
  let requests = 0;
  const request = async () => {
    requests += 1;
    return spotifyResponse({ items: [{ name: "Original" }] });
  };
  const [first, second] = await Promise.all([
    reader.read("https://api.spotify.com/v1/search?q=test&type=album", "token", request),
    reader.read("https://api.spotify.com/v1/search?type=album&q=test", "token", request),
  ]);
  assert.equal(requests, 1);
  first.items[0].name = "Changed";
  assert.equal(second.items[0].name, "Original");
  await reader.read("https://api.spotify.com/v1/search?q=test&type=album", "token", request);
  assert.equal(requests, 2, "responses without cache headers must not become a TTL cache");
});

test("Spotify GET coalescing is token scoped and failures can be retried", async () => {
  const reader = createSpotifyJsonReader();
  const url = "https://api.spotify.com/v1/albums/album";
  let requests = 0;
  const request = async () => {
    requests += 1;
    throw new Error("offline");
  };
  const results = await Promise.allSettled([
    reader.read(url, "first", request), reader.read(url, "first", request),
    reader.read(url, "second", request),
  ]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(requests, 2);
  await assert.rejects(reader.read(url, "first", request), /offline/);
  assert.equal(requests, 3);
});

test("Spotify reader caches and revalidates once per concurrent read, never across tokens", async () => {
  let now = 0;
  const reader = createSpotifyJsonReader({ cache: createConditionalJsonCache({ now: () => now }) });
  const url = "https://api.spotify.com/v1/me/top/artists";
  let requests = 0;
  const request = async (etag) => {
    requests += 1;
    assert.equal(etag, requests === 2 ? '"v1"' : "");
    return spotifyResponse({ items: [requests] },
      { "Cache-Control": "max-age=1", ETag: '"v1"' }, requests === 2 ? 304 : 200);
  };
  assert.deepEqual(await reader.read(url, "first", request), { items: [1] });
  await reader.read(url, "first", request);
  assert.equal(requests, 1);
  now = 1001;
  assert.deepEqual(await Promise.all([
    reader.read(url, "first", request), reader.read(url, "first", request),
  ]), [{ items: [1] }, { items: [1] }]);
  assert.equal(requests, 2);
  assert.deepEqual(await reader.read(url, "second", request), { items: [3] });
  reader.clear();
  await reader.read(url, "second", request);
  assert.equal(requests, 4);
});

test("Spotify clear prevents an old in-flight read from repopulating the new session cache", async () => {
  const reader = createSpotifyJsonReader();
  const url = "https://api.spotify.com/v1/albums/album";
  let finish;
  let requests = 0;
  const old = reader.read(url, "token", () => {
    requests += 1;
    return new Promise((resolve) => { finish = resolve; });
  });
  await Promise.resolve();
  reader.clear();
  const request = async () => {
    requests += 1;
    return spotifyResponse({ value: "new" }, { "Cache-Control": "max-age=60" });
  };
  await reader.read(url, "token", request);
  finish(spotifyResponse({ value: "old" }, { "Cache-Control": "max-age=60" }));
  await old;
  assert.deepEqual(await reader.read(url, "token", request), { value: "new" });
  assert.equal(requests, 2);
});

test("Spotify write invalidation detaches stale playlist reads without deleting new pending reads", async () => {
  const reader = createSpotifyJsonReader();
  const url = "https://api.spotify.com/v1/playlists/playlist/items";
  let finishOld;
  let finishFresh;
  let requests = 0;
  const old = reader.read(url, "token", () => {
    requests += 1;
    return new Promise((resolve) => { finishOld = resolve; });
  });
  await Promise.resolve();
  reader.clear();
  const request = () => {
    requests += 1;
    return new Promise((resolve) => { finishFresh = resolve; });
  };
  const fresh = reader.read(url, "token", request);
  await Promise.resolve();
  finishOld(spotifyResponse({ version: "old" }));
  await old;
  const concurrent = reader.read(url, "token", request);
  finishFresh(spotifyResponse({ version: "fresh" }));
  assert.deepEqual(await Promise.all([fresh, concurrent]),
    [{ version: "fresh" }, { version: "fresh" }]);
  assert.equal(requests, 2);
});

test("Spotify mutable reads coalesce only while pending and are never cached", async () => {
  for (const path of ["me/player", "playlists/playlist/items", "playlists/playlist"]) {
    const reader = createSpotifyJsonReader();
    const url = `https://api.spotify.com/v1/${path}`;
    let requests = 0;
    const request = async () => spotifyResponse({ version: ++requests }, { "Cache-Control": "max-age=600" });
    await Promise.all([reader.read(url, "token", request), reader.read(url, "token", request)]);
    assert.equal(requests, 1);
    await reader.read(url, "token", request);
    assert.equal(requests, 2);
  }
});

test("Spotify no-store and no-cache reads do not become a fresh response cache", async () => {
  for (const directive of ["no-store", "no-cache"]) {
    const reader = createSpotifyJsonReader();
    const url = "https://api.spotify.com/v1/search?q=test&type=album";
    let requests = 0;
    const request = async (etag) => {
      requests += 1;
      assert.equal(etag, directive === "no-cache" && requests > 1 ? '"v1"' : "");
      return spotifyResponse({ items: [requests] },
        { "Cache-Control": directive, ETag: '"v1"' });
    };
    await Promise.all([reader.read(url, "token", request), reader.read(url, "token", request)]);
    await reader.read(url, "token", request);
    assert.equal(requests, 2);
  }
});

test("Spotify search uses ten-item pages without reducing the original fifty-result sample", async () => {
  const offsets = [];
  const result = await readSpotifySearchPages({ q: "artist:test", type: "track", limit: "50" }, async (path) => {
    const url = new URL(path, "https://api.spotify.com/v1/");
    assert.equal(url.searchParams.get("limit"), "10");
    const offset = Number(url.searchParams.get("offset"));
    offsets.push(offset);
    return { tracks: { offset, next: "next", items: Array.from({ length: 10 }, (_, index) => offset + index) } };
  });
  assert.deepEqual(offsets, [0, 10, 20, 30, 40]);
  assert.deepEqual(result.tracks.items, Array.from({ length: 50 }, (_, index) => index));
});

test("Spotify search stops at the last page and coalesces shared suggestion/playlist searches", async () => {
  const reader = createSpotifyJsonReader();
  let requests = 0;
  const parameters = { q: "artist:test", type: "track", limit: "50" };
  const request = (path) => reader.read(new URL(path, "https://api.spotify.com/v1/"), "token", async () => {
    requests += 1;
    return spotifyResponse({ tracks: { items: [1, 2], next: null } });
  });
  const results = await Promise.all([
    readSpotifySearchPages(parameters, request), readSpotifySearchPages(parameters, request),
  ]);
  assert.equal(requests, 1);
  assert.deepEqual(results[0].tracks.items, [1, 2]);
});

test("Spotify playlist imports read fifty-item pages and stop without a terminal empty request", async () => {
  const base = "https://api.spotify.com/v1/playlists/0123456789012345678901/items";
  const offsets = [];
  const result = await readSpotifyPlaylistItems(`${base}?limit=50&offset=0`, async (path) => {
    const offset = Number(new URL(path).searchParams.get("offset"));
    offsets.push(offset);
    return { offset, total: 51, items: Array(offset === 0 ? 50 : 1).fill({ item: {} }),
      next: offset === 0 ? `${base}?limit=50&offset=50` : null };
  });
  assert.equal(result.length, 51);
  assert.deepEqual(offsets, [0, 50]);
});

test("Spotify playlist imports reject repeated or unrelated next pages before another request", async () => {
  const base = "https://api.spotify.com/v1/playlists/0123456789012345678901/items";
  for (const next of [`${base}?limit=50&offset=0`,
    `${base.replace("0123456789012345678901", "1123456789012345678901")}?limit=50&offset=1`,
    "https://example.test/items?limit=50&offset=1"]) {
    let requests = 0;
    await assert.rejects(readSpotifyPlaylistItems(`${base}?limit=50&offset=0`, async () => {
      requests += 1;
      return { items: [{}], next };
    }), /paginazione non valido/);
    assert.equal(requests, 1);
  }
});

test("Spotify playlist writes batch at most 100 URIs, retain order, and never retry failed writes", async () => {
  const uris = Array.from({ length: 200 }, (_, index) => `spotify:track:${index}`);
  const batches = [];
  await writeSpotifyPlaylistItems("playlist", uris, async (path, body) => {
    assert.equal(path, "playlists/playlist/items");
    batches.push(body.uris);
  });
  assert.deepEqual(batches.map((batch) => batch.length), [100, 100]);
  assert.deepEqual(batches.flat(), uris);
  const partial = [];
  await writeSpotifyPlaylistItems("playlist", uris.slice(0, 101), async (_path, body) => {
    partial.push(body.uris.length);
  });
  assert.deepEqual(partial, [100, 1]);
  let requests = 0;
  await assert.rejects(writeSpotifyPlaylistItems("playlist", uris, async () => {
    requests += 1;
    throw new Error("429");
  }), /429/);
  assert.equal(requests, 1);
});

test("Spotify cache honors Cache-Control, ETag, 304 revalidation and no-store", () => {
  let now = 100;
  const cache = createConditionalJsonCache({ now: () => now });
  cache.set("catalog", { items: [{ name: "Original" }] }, {
    "Cache-Control": "public, max-age=2",
    ETag: '"v1"',
  });
  assert.deepEqual(cache.get("catalog"), { items: [{ name: "Original" }] });
  now += 2_000;
  assert.equal(cache.get("catalog"), undefined);
  assert.deepEqual(cache.stale("catalog"), {
    value: { items: [{ name: "Original" }] },
    etag: '"v1"',
  });
  assert.deepEqual(cache.revalidate("catalog", { ETag: '"v2"', "Cache-Control": "max-age=3" }), {
    items: [{ name: "Original" }],
  });
  assert.deepEqual(cache.get("catalog"), { items: [{ name: "Original" }] });

  cache.set("live", { playing: true }, { "Cache-Control": "no-store", ETag: '"live"' });
  assert.equal(cache.get("live"), undefined);
  assert.equal(cache.stale("live"), null);
});

test("Spotify cache revalidates no-cache responses and returns defensive copies", () => {
  const cache = createConditionalJsonCache({ now: () => 100 });
  cache.set("search", { items: [{ name: "Original" }] }, {
    "Cache-Control": "no-cache",
    ETag: '"search-v1"',
  });
  const stale = cache.stale("search");
  stale.value.items[0].name = "Changed";
  assert.equal(cache.get("search"), undefined);
  assert.deepEqual(cache.revalidate("search", {}), { items: [{ name: "Original" }] });
  assert.equal(cache.get("search"), undefined);
  cache.set("uncacheable", { value: 1 }, {});
  assert.equal(cache.stale("uncacheable"), null);
});

test("Spotify cache excludes live playback and mutable playlist reads", () => {
  assert.equal(spotifyCacheableRead(new URL("https://api.spotify.com/v1/search?q=artist")), true);
  assert.equal(spotifyCacheableRead(new URL("https://api.spotify.com/v1/albums/album")), true);
  assert.equal(spotifyCacheableRead(new URL("https://api.spotify.com/v1/me/player")), false);
  assert.equal(spotifyCacheableRead(new URL("https://api.spotify.com/v1/playlists/playlist/items")), false);
});

test("Spotify response cache expires entries, bounds memory and returns defensive copies", () => {
  let now = 100;
  const cache = createTimedJsonCache({ maxEntries: 2, now: () => now });
  cache.set("first", { items: [{ name: "Original" }] }, 10);
  const copy = cache.get("first");
  copy.items[0].name = "Changed";
  assert.equal(cache.get("first").items[0].name, "Original");

  cache.set("second", { value: 2 }, 100);
  cache.set("third", { value: 3 }, 100);
  assert.equal(cache.get("first"), undefined);
  assert.deepEqual(cache.get("second"), { value: 2 });
  assert.deepEqual(cache.get("third"), { value: 3 });
  now += 100;
  assert.equal(cache.get("third"), undefined);
});

const album = (id, overrides = {}) => ({
  id,
  name: `Album ${id}`,
  artist: "Artist",
  url: `https://open.spotify.com/album/${id}`,
  year: "2020",
  status: "queued",
  rating: null,
  genres: [],
  collections: [],
  tags: [],
  cover_sha256: null,
  ...overrides,
});

test("builds a safe Cover Art Archive URL from a MusicBrainz release-group ID", () => {
  const mbid = "ABCDEF12-3456-7890-abcd-ef1234567890";
  assert.equal(
    musicBrainzCoverArtUrl(mbid),
    "https://coverartarchive.org/release-group/abcdef12-3456-7890-abcd-ef1234567890/front-250",
  );
  assert.equal(musicBrainzCoverArtUrl("https://example.com"), null);
  assert.equal(musicBrainzCoverArtUrl(""), null);
});

test("migrates legacy album states to the current collection states", () => {
  assert.equal(normalizeAlbumStatus("heard"), "liked");
  assert.equal(normalizeAlbumStatus("hidden"), "disliked");
  assert.equal(validateAlbum(album("heard", { status: "heard" })).status, "liked");
  assert.equal(validateAlbum(album("hidden", { status: "hidden" })).status, "disliked");
  assert.equal(validateAlbum(album("disliked", { status: "disliked" })).status, "disliked");
});

test("selects up to three distinct album genres in catalog order", () => {
  assert.deepEqual(
    primaryAlbumGenres([" Rock ", "rock", "Jazz", "", "Metal", "Pop"]),
    ["Rock", "Jazz", "Metal"],
  );
  assert.deepEqual(primaryAlbumGenres([]), []);
  assert.deepEqual(primaryAlbumGenres(null), []);
});

test("selects the closest Spotify album by title, artist, and release year", () => {
  const source = { name: "OK Computer", artist: "Radiohead", artist_names: ["Radiohead"], year: "1997" };
  const candidates = [
    { id: "wrong-artist", name: "OK Computer", artist: "Other Band", year: "1997" },
    { id: "wrong-year", name: "OK Computer", artist: "Radiohead", year: "2007" },
    { id: "best", name: "OK Computer (Remastered)", artist: "Radiohead", year: "1997" },
  ];
  assert.equal(bestSpotifyAlbumSuggestionMatch(source, candidates)?.id, "best");
  assert.equal(bestSpotifyAlbumSuggestionMatch(source, [{ name: "Different Album", artist: "Radiohead" }]), null);
});

test("validates only the supported Spotify album fields and rating range", () => {
  assert.equal(validateAlbum(album("abc")).id, "abc");
  assert.throws(() => validateAlbum({ ...album("abc"), extra: "private data" }), /Record album non valido/);
  assert.throws(() => validateAlbum(album("abc", { url: "https://example.com/album/abc" })), /link Spotify non valido/);
  assert.throws(() => validateAlbum(album("abc", { rating: 4.2 })), /voto/);
});

test("requires an explicit choice for divergent edits to the same album", () => {
  const base = album("abc");
  const local = album("abc", { rating: 4 });
  const remote = album("abc", { genres: ["Jazz"] });
  const merged = threeWayMerge([base], [local], [remote]);
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.albums.length, 0);
  assert.equal(threeWayMerge([base], [local], [remote], { abc: "local" }).albums[0].rating, 4);
  assert.deepEqual(threeWayMerge([base], [local], [remote], { abc: "remote" }).albums[0].genres, ["Jazz"]);

  const conflict = threeWayMerge([base], [local], [album("abc", { rating: 3 })]);
  assert.equal(conflict.albums.length, 0);
  assert.equal(conflict.conflicts[0].id, "abc");
  assert.equal(threeWayMerge([base], [local], [album("abc", { rating: 3 })], { abc: "local" }).albums[0].rating, 4);
  assert.equal(threeWayMerge([base], [local], [album("abc", { rating: 3 })], { abc: "remote" }).albums[0].rating, 3);
});

test("merges independent additions without propagating deletions", () => {
  const merged = threeWayMerge([], [album("local")], [album("remote")]);
  assert.deepEqual(merged.albums.map((item) => item.id), ["local", "remote"]);
  const retained = threeWayMerge([album("gone")], [], [album("gone")]);
  assert.deepEqual(retained.albums.map((item) => item.id), ["gone"]);
});

test("searches genres and filters state while sorting ratings and names", () => {
  const albums = [
    album("a", { name: "Beta", artist: "Zed", rating: 3, genres: ["Jazz"] }),
    album("b", { name: "Alpha", artist: "Ada", rating: 4, genres: ["Rock"], status: "liked" }),
  ];
  assert.deepEqual(filterAlbums(albums, { search: "jazz" }).map((item) => item.id), ["a"]);
  assert.deepEqual(filterAlbums(albums, { search: "JAZZ" }).map((item) => item.id), ["a"]);
  assert.deepEqual(filterAlbums(albums, { search: "bEtA" }).map((item) => item.id), ["a"]);
  assert.deepEqual(filterAlbums(albums, { status: "liked", genre: "rock" }).map((item) => item.id), ["b"]);
  assert.deepEqual(filterAlbums(albums, { order: "name" }).map((item) => item.id), ["b", "a"]);
  assert.deepEqual(filterAlbums(albums, { order: "rating" }).map((item) => item.id), ["b", "a"]);
  assert.deepEqual(filterAlbums(albums, { order: "genre" }).map((item) => item.id), ["a", "b"]);
  assert.deepEqual(filterAlbums(albums, { order: "manual" }).map((item) => item.id), ["a", "b"]);
});

test("filters primary and secondary genres independently, including albums without subgenres", () => {
  const albums = [
    album("a", { genres: ["Metal", "Death metal"], primary_genre: "Metal" }),
    album("b", { genres: ["Metal"], primary_genre: "Metal" }),
    album("c", { genres: ["Metal", "Black metal"], primary_genre: "Metal" }),
    album("d", { genres: ["Rock", "Alternative rock"], primary_genre: "Rock" }),
    album("e", { genres: [] }),
  ];
  assert.equal(albumPrimaryGenre(albums[0]), "Metal");
  assert.deepEqual(albumSecondaryGenres(albums[0]), ["Death metal"]);
  assert.deepEqual(filterAlbums(albums, { primaryGenre: "metal" }).map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(filterAlbums(albums, { primaryGenre: "metal", secondaryGenre: "death metal" })
    .map((item) => item.id), ["a"]);
  assert.deepEqual(filterAlbums(albums, { primaryGenre: "metal", secondaryGenre: NO_SECONDARY_GENRE_FILTER })
    .map((item) => item.id), ["b"]);
  assert.deepEqual(filterAlbums(albums, { secondaryGenre: "black metal" }).map((item) => item.id), ["c"]);
  assert.deepEqual(filterAlbums(albums, { primaryGenre: NO_PRIMARY_GENRE_FILTER }).map((item) => item.id), ["e"]);
});

test("sorts by collection and keeps a local manual order while reordering filtered albums", () => {
  const albums = [
    album("a", { collections: ["Zeta"] }),
    album("b", { collections: ["Alpha"] }),
    album("c", { collections: ["Beta"] }),
  ];
  assert.deepEqual(filterAlbums(albums, { order: "collection" }).map((item) => item.id), ["b", "c", "a"]);
  assert.deepEqual(sortAlbumsByManualOrder(albums, ["c", "a", "b"]).map((item) => item.id), ["c", "a", "b"]);
  assert.deepEqual(
    moveAlbumInManualOrder(["a", "hidden", "b", "c"], ["a", "b", "c"], "a", 2),
    ["b", "hidden", "c", "a"],
  );
});

test("rejects invalid or duplicate repository documents", () => {
  assert.deepEqual(validateDocument({ format: "accord-album-collection", version: 1, albums: [] }), []);
  assert.throws(() => validateDocument({ format: "accord-album-collection", version: 1, albums: [album("a"), album("a")] }), /duplicati/);
});

test("migrates v1 records and validates synced collections, tags, and cover hashes", () => {
  const { collections, tags, cover_sha256, ...legacy } = album("a");
  const migrated = validateDocument({ format: "accord-album-collection", version: 1, albums: [legacy] });
  assert.deepEqual(migrated[0].collections, []);
  assert.deepEqual(migrated[0].tags, []);
  assert.equal(migrated[0].cover_sha256, null);
  assert.equal(migrated[0].primary_genre, "");
  assert.throws(() => validateAlbum(album("a", { tags: ["x".repeat(81)] })), /80 caratteri/);
});

test("migrates older genre lists by assigning their first genre as primary", () => {
  const legacy = album("a", { genres: ["Death metal", "Progressive death metal"] });
  delete legacy.primary_genre;
  assert.equal(validateAlbum(legacy).primary_genre, "Death metal");
  assert.equal(validateAlbum(album("b", {
    genres: ["Death metal", "Progressive death metal"],
    primary_genre: "death metal",
  })).primary_genre, "Death metal");
  assert.throws(() => validateAlbum(album("c", {
    genres: ["Death metal"],
    primary_genre: "Rock",
  })), /deve essere assegnato/);
  assert.deepEqual(validateDocument({
    format: "accord-album-collection", version: 3,
    albums: [album("current", { genres: ["Metal"], primary_genre: "Metal" })],
  })[0].primary_genre, "Metal");
});

test("filters albums by collection and tag and searches both fields", () => {
  const record = album("a", { collections: ["Favorites"], tags: ["mobile"] });
  assert.deepEqual(filterAlbums([record], { collection: "favorites", tag: "mobile" }), [record]);
  assert.deepEqual(filterAlbums([record], { search: "favorites" }), [record]);
  assert.deepEqual(filterAlbums([record], { search: "mobile" }), [record]);
});

test("round-trips verified JPEG cover thumbnails in the desktop archive format", async () => {
  const data = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]);
  const archive = await encodeCoverArchive(new Map([["abc123", data]]));
  const decoded = await decodeCoverArchive(archive);
  assert.deepEqual(decoded.get("abc123").data, data);
  assert.equal(decoded.get("abc123").hash.length, 64);
  const corrupted = archive.slice();
  corrupted[corrupted.length - 1] ^= 1;
  await assert.rejects(decodeCoverArchive(corrupted), /Verifica copertina/);
});

test("accepts Spotify playlist names, IDs, links, and URIs without accepting other hosts", () => {
  const id = "0123456789012345678901";
  assert.equal(spotifyPlaylistId(id), id);
  assert.equal(spotifyPlaylistId(`spotify:playlist:${id}`), id);
  assert.equal(spotifyPlaylistId(`https://open.spotify.com/intl-it/playlist/${id}?si=example`), id);
  assert.equal(spotifyPlaylistId("La mia playlist"), null);
  assert.throws(() => spotifyPlaylistId(`https://example.com/playlist/${id}`), /link Spotify valido/);
});

test("searches playlist pages only until the first page containing matching names", async () => {
  const playlists = (start, matchingIndex = -1) => Array.from({ length: 50 }, (_, index) => ({
    id: String(start + index).padStart(22, "0"),
    name: start + index === matchingIndex ? "dIsCoVeRy" : `Playlist ${start + index}`,
  }));
  const pages = new Map([
    [0, {
      offset: 0,
      total: 150,
      items: playlists(0),
      next: "https://api.spotify.com/v1/me/playlists?offset=50&limit=50",
    }],
    [50, {
      offset: 50,
      total: 150,
      items: playlists(50, 63),
      next: "https://api.spotify.com/v1/me/playlists?offset=100&limit=50",
    }],
  ]);
  const requestedOffsets = [];
  const matches = await findSpotifyPlaylistMatches(" DISCOVERY ", async (offset) => {
    requestedOffsets.push(offset);
    const page = pages.get(offset);
    assert.ok(page, `unexpected playlist page request at offset ${offset}`);
    return page;
  });
  assert.deepEqual(requestedOffsets, [0, 50]);
  assert.deepEqual(matches.map((playlist) => playlist.id), ["0000000000000000000063"]);
});

test("keeps only the most listened suggested album per artist", () => {
  const albums = Array.from({ length: 5 }, (_, index) => ({
    name: `Album ${index + 1}`,
    artist: "Artist",
    artist_names: ["Artist"],
  }));
  const rankings = albums.map((album, index) => ({
    artist: album.artist,
    name: album.name,
    playcount: [3, 12, 8, 4, 1][index],
  }));
  assert.deepEqual(topListenedAlbums(albums, rankings).map((album) => album.name), [
    "Album 2",
  ]);
});

test("stops Discogs suggestions only for queue-wide API failures", () => {
  for (const status of [null, undefined, 0, 401, 403, 429, 500, 503]) {
    assert.equal(shouldStopDiscogsSuggestionQueue(status), true, `status ${status}`);
  }
  for (const status of [200, 400, 404]) {
    assert.equal(shouldStopDiscogsSuggestionQueue(status), false, `status ${status}`);
  }
});

test("aggregates the most collected Discogs editions weighted by their vote counts", () => {
  const versions = [
    { id: 11, stats: { community: { in_collection: 10, in_wantlist: 20 } } },
    { id: 12, stats: { community: { in_collection: 80, in_wantlist: 2 } } },
    { id: 13, stats: { community: { in_collection: 40, in_wantlist: 30 } } },
    { id: 14, stats: { community: { in_collection: 60, in_wantlist: 1 } } },
  ];
  const ratings = new Map([
    [12, { average: 4.5, count: 100 }],
    [14, { average: 2, count: 10 }],
  ]);
  assert.deepEqual(aggregateDiscogsEditionRatings(versions, ratings, 2), {
    discogs: 4.27,
    discogs_votes: 110,
    discogs_editions: 2,
    discogs_versions: 4,
    discogs_sampled_versions: 2,
    discogs_sampled: true,
  });
  assert.throws(() => aggregateDiscogsEditionRatings(versions, ratings, 0), /Campione versioni Discogs/);
});

test("chooses one Discogs-ranked album per artist and falls back to Last.fm order without votes", () => {
  const candidates = [
    { id: "a-listened", name: "Last.fm favorite", artist: "Artist A", artist_names: ["Artist A"],
      artist_mbids: ["83d91898-7763-47d7-b03b-b92132375c47"] },
    { id: "a-rated", name: "Discogs favorite", artist: "Artist A", artist_names: ["Artist A"],
      artist_mbids: ["83d91898-7763-47d7-b03b-b92132375c47"], discogs: 4.5, discogs_votes: 100 },
    { id: "b-small-sample", name: "Small sample", artist: "Artist B", artist_names: ["Artist B"],
      discogs: 4.9, discogs_votes: 2 },
    { id: "b-fallback", name: "Fallback", artist: "Artist B", artist_names: ["Artist B"] },
  ];
  const ranked = rankDiscogsSuggestionAlbums(candidates);
  assert.deepEqual(ranked.map((album) => album.id), ["a-rated", "b-small-sample"]);
  assert.ok(ranked[0].discogs_rank_score > ranked[1].discogs_rank_score);
  assert.deepEqual(rankDiscogsSuggestionAlbums(candidates.slice(0, 2)).map((album) => album.id), ["a-rated"]);
  assert.throws(() => rankDiscogsSuggestionAlbums(null), /Suggerimenti Discogs/);
});

test("expands similar-artist discovery to 30 candidates before exhausting seeds", async () => {
  const seeds = Array.from({ length: 8 }, (_, index) => ({ name: `Seed ${index + 1}` }));
  const requested = [];
  const result = await expandSimilarArtists(seeds, async (seed) => {
    requested.push(seed.name);
    const index = Number(seed.name.slice(-1));
    return Array.from({ length: 5 }, (_, offset) => ({
      name: `Related ${index}-${offset + 1}`,
      match: 0.9 - offset / 100,
    }));
  });
  assert.equal(requested.length, 6);
  assert.equal(result.seedsUsed, 6);
  assert.equal(result.artists.length, 30);
  assert.equal(result.exhausted, false);

  const exhausted = await expandSimilarArtists(seeds.slice(0, 2),
    async (seed) => [{ name: `Related ${seed.name}`, match: 0.5 }]);
  assert.equal(exhausted.artists.length, 2);
  assert.equal(exhausted.exhausted, true);
});

test("falls back to one related catalog alternative per artist only when no direct album matches", () => {
  const albums = [
    { id: "other-1", name: "Other 1", artist: "Other", artist_names: ["Other"] },
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `artist-${index + 1}`,
      name: `Artist ${index + 1}`,
      artist: "Artist",
      artist_names: ["Artist"],
    })),
  ];
  const artists = [
    { name: "Artist" },
    { name: "Other" },
  ];
  const alternatives = listeningAlbumSuggestions(albums, [], artists);
  assert.deepEqual(alternatives.map((album) => album.id), ["artist-1", "other-1"]);
  assert.ok(alternatives.every((album) => album.matchConfidence === "related"));
  assert.ok(alternatives.every((album) => /non e' una corrispondenza Last\.fm/.test(album.matchReason)));
  const direct = listeningAlbumSuggestions(albums, [
    { artist: "Artist", name: "Artist 2", playcount: 20 },
  ], artists);
  assert.deepEqual(direct.map((album) => album.id), ["artist-2"]);
  assert.equal(direct[0].matchConfidence, "high");
  assert.throws(() => listeningAlbumSuggestions(albums, [], artists, 0), /Classifica album non valida/);
});

test("builds album candidates from Last.fm rankings when the MusicBrainz catalog is unavailable", () => {
  const rankings = [
    { artist: "Artist", name: "Most Played", playcount: 40 },
    { artist: "Artist", name: "Next Played", playcount: 25 },
    { artist: "Artist", name: "Most Played", playcount: 42 },
    { artist: "Other", name: "Other Album", playcount: 30 },
    { artist: "Unknown", name: "Ignored Album", playcount: 100 },
  ];
  const albums = lastFmAlbumCatalog(rankings, [{ name: "Artist" }, { name: "Other" }]);
  assert.deepEqual(albums.map(({ artist, name, playcount }) => [artist, name, playcount]), [
    ["Artist", "Most Played", 42],
    ["Artist", "Next Played", 25],
    ["Other", "Other Album", 30],
  ]);
  assert.ok(albums.every((album) => album.source === "Last.fm" && album.genres.length === 0));
  assert.deepEqual(topListenedAlbums(albums, rankings, 1).map((album) => album.name), [
    "Most Played",
    "Other Album",
  ]);
});

test("retries temporary MusicBrainz failures and immediately returns permanent failures", async () => {
  let attempts = 0;
  const waits = [];
  const result = await retryMusicBrainzRequest(async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error("MusicBrainz unavailable");
      error.status = 503;
      throw error;
    }
    return "catalog";
  }, async (milliseconds) => waits.push(milliseconds));
  assert.equal(result, "catalog");
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [1000, 2000]);

  let permanentAttempts = 0;
  await assert.rejects(retryMusicBrainzRequest(async () => {
    permanentAttempts += 1;
    const error = new Error("Bad request");
    error.status = 400;
    throw error;
  }, async () => {}), /Bad request/);
  assert.equal(permanentAttempts, 1);
});

test("selects up to three most popular tracks per album without duplicate tracks", () => {
  const ids = Array.from({ length: 7 }, (_, index) => String(index + 1).repeat(22));
  const albumGroups = [
    { tracks: ids.slice(0, 4).map((id) => ({ type: "track", uri: `spotify:track:${id}` })) },
    { tracks: ids.slice(3).map((id) => ({ type: "track", uri: `spotify:track:${id}` })) },
  ];
  const popularity = new Map(ids.map((id, index) => [id, [10, 100, 80, 90, 95, 85, 70][index]]));
  assert.deepEqual(topTracksPerAlbum(albumGroups, popularity), [
    `spotify:track:${ids[1]}`,
    `spotify:track:${ids[3]}`,
    `spotify:track:${ids[2]}`,
    `spotify:track:${ids[4]}`,
    `spotify:track:${ids[5]}`,
    `spotify:track:${ids[6]}`,
  ]);
  assert.throws(() => topTracksPerAlbum(albumGroups, new Map([[ids[0], 101]])), /Popolarita'/);
});

test("excludes suggested albums already scrobbled by any credited artist", () => {
  const history = summarizeLastFmTracks([{
    artist: { name: "Guest Artist" },
    album: { name: "Already Heard" },
    date: { uts: "1700000000" },
  }]);
  const albums = [
    { id: "heard", name: "Already Heard", artist: "Lead Artist feat. Guest Artist",
      artist_names: ["Lead Artist", "Guest Artist"], genres: [] },
    { id: "fresh", name: "Fresh Record", artist: "Lead Artist",
      artist_names: ["Lead Artist"], genres: [] },
  ];
  assert.deepEqual(filterListeningAlbumSuggestions(albums, { knownAlbums: history.knownAlbums }), [albums[1]]);
});

test("validates complete minimal Last.fm archives and deduplicates scrobbles", () => {
  const document = {
    format: "accord-lastfm-history",
    version: 1,
    account: "HistoryUser",
    complete: true,
    updated_at: "2026-10-28T10:00:00+00:00",
    coverage: [[100, 150], [151, 200]],
    scrobbles: [
      { stamp: 120, artist: "Artist", name: "Track", album: "" },
      { stamp: 120, artist: "Artist", name: "Track", album: "Album" },
    ],
  };
  assert.deepEqual(validateLastFmHistoryDocument(document), {
    ...document,
    coverage: [[100, 200]],
    scrobbles: [{ stamp: 120, artist: "Artist", name: "Track", album: "Album" }],
  });
  assert.throws(() => validateLastFmHistoryDocument({ ...document, api_key: "secret" }), /Archivio Last.fm/);
  assert.throws(() => validateLastFmHistoryDocument({
    ...document,
    coverage: [[100, 150], [152, 200]],
  }), /non è continua/);
  assert.throws(() => validateLastFmHistoryDocument({
    ...document,
    coverage: [[100, 200]],
    scrobbles: [{ ...document.scrobbles[0], stamp: 50 }],
  }), /Record dell’archivio/);
  assert.throws(() => validateLastFmHistoryDocument({
    ...document,
    scrobbles: [{ ...document.scrobbles[0], spotify_token: "secret" }],
  }), /Record dell’archivio/);
});

test("matches included and excluded genres by exact value or contained text", () => {
  const albums = [
    { id: "technical", name: "Technical", artist: "Artist", genres: ["technical symphonic black metal"] },
    { id: "black", name: "Black", artist: "Artist", genres: ["black metal"] },
    { id: "thrash", name: "Thrash", artist: "Artist", genres: ["thrash metal"] },
    { id: "jazz", name: "Jazz", artist: "Artist", genres: ["jazz"] },
  ];
  assert.deepEqual(filterListeningAlbumSuggestions(albums, {
    includedGenres: ["metal"],
    includedGenresMatch: "contains",
    excludedGenres: ["thrash"],
    excludedGenresMatch: "contains",
  }).map((album) => album.id), ["technical", "black"]);
  assert.deepEqual(filterListeningAlbumSuggestions(albums, {
    includedGenres: ["technical symphonic black metal"],
    includedGenresMatch: "exact",
  }).map((album) => album.id), ["technical"]);
});

test("excludes all-time heard artists from artist and album suggestions", () => {
  const heard = ["  Old Artist "];
  const suggested = [
    { name: "Old Artist", mbid: "heard" },
    { name: "New Artist", mbid: "new" },
  ];
  assert.deepEqual(filterUnheardArtists(suggested, heard), [suggested[1]]);
  const albums = [
    { id: "heard-artist", name: "New Album", artist: "Old Artist", artist_names: ["Old Artist"] },
    { id: "fresh", name: "Fresh Album", artist: "New Artist", artist_names: ["New Artist"] },
  ];
  assert.deepEqual(filterListeningAlbumSuggestions(albums, { heardArtists: heard }), [albums[1]]);
});

test("reads every paginated page of Last.fm overall artists", async () => {
  const pages = [];
  const artists = await readLastFmAllTimeArtists(async (page, limit) => {
    pages.push([page, limit]);
    return {
      topartists: {
        "@attr": { totalPages: "2" },
        artist: [{ name: page === 1 ? "Artist One" : "Artist Two" }],
      },
    };
  });
  assert.deepEqual(pages, [[1, 1000], [2, 1000]]);
  assert.deepEqual(artists, ["Artist One", "Artist Two"]);
  await assert.rejects(readLastFmAllTimeArtists(async (page) => ({
    topartists: { "@attr": { totalPages: page === 1 ? "2" : "1" }, artist: [] },
  })), /Last.fm è cambiata/);
});

test("builds bounded rolling and custom Last.fm date ranges", () => {
  const now = new Date(2026, 0, 15, 12, 0, 0);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  assert.deepEqual(lastFmSuggestionRange("all", "", "", now), { from: null, to: nowSeconds });
  assert.deepEqual(lastFmSuggestionRange("30", "", "", now), {
    from: nowSeconds - 30 * 86400,
    to: nowSeconds,
  });
  const start = new Date(2026, 0, 1);
  const nextDay = new Date(2026, 0, 3);
  assert.deepEqual(lastFmSuggestionRange("custom", "2026-01-01", "2026-01-02", now), {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(nextDay.getTime() / 1000) - 1,
  });
  assert.throws(() => lastFmSuggestionRange("custom", "2026-01-03", "2026-01-02", now), /futuro|data iniziale/);
  assert.throws(() => lastFmSuggestionRange("14", "", "", now), /intervallo/);
});

test("caps aliases and collaborations by canonical credited artist", () => {
  const artistMbid = "83d91898-7763-47d7-b03b-b92132375c47";
  const rows = [
    ["a1", "Artist", "Album 1", 30],
    ["a2", "Artist", "Album 2", 20],
    ["a3", "Artist", "Album 3", 10],
    ["b1", "Artist, The", "Album 4", 25],
    ["b2", "Artist, The", "Album 5", 15],
    ["b3", "Artist, The", "Album 6", 5],
  ];
  const albums = rows.map(([id, artist, name]) => ({
    id, name, artist, artist_names: [artist, "Guest"], artist_mbids: [artistMbid, "83d91898-7763-47d7-b03b-b92132375c48"],
  }));
  const rankings = rows.map(([, artist, name, playcount]) => ({ artist, name, playcount }));

  assert.deepEqual(topListenedAlbums(albums, rankings).map((album) => album.name), [
    "Album 1",
  ]);
});

test("paginates MusicBrainz in bounded pages, deduplicates, and reports incomplete samples", async () => {
  const offsets = [];
  const full = await readMusicBrainzCatalog(async (offset, limit) => {
    offsets.push([offset, limit]);
    const count = 205;
    const start = offset;
    const end = Math.min(offset + limit, count);
    return { count, "release-groups": Array.from({ length: end - start }, (_, index) => ({
      id: `group-${start + index}`,
    })) };
  });
  assert.deepEqual(offsets, [[0, 100], [100, 100], [200, 100]]);
  assert.equal(full.pages, 3);
  assert.equal(full.fetched, 205);
  assert.equal(full.total, 205);
  assert.equal(full.truncated, false);
  assert.equal(full.groups.length, 205);
  const duplicate = await readMusicBrainzCatalog(async () => ({
    count: 2,
    "release-groups": [{ id: "duplicate" }, { id: "duplicate" }],
  }), 2);
  assert.equal(duplicate.fetched, 2);
  assert.equal(duplicate.groups.length, 1);
  assert.equal(duplicate.truncated, true);

  const limited = await readMusicBrainzCatalog(async (offset, limit) => ({
    count: 401,
    "release-groups": Array.from({ length: limit }, (_, index) => ({ id: `limited-${offset + index}` })),
  }));
  assert.equal(limited.fetched, 300);
  assert.equal(limited.truncated, true);
  const unstable = await readMusicBrainzCatalog(async (offset, limit) => ({
    count: offset ? 201 : 200,
    "release-groups": Array.from({ length: limit }, (_, index) => ({ id: `unstable-${offset + index}` })),
  }));
  assert.equal(unstable.pages, 1);
  assert.equal(unstable.truncated, true);
  assert.equal(unstable.groups.length, 100);
  await assert.rejects(readMusicBrainzCatalog(async () => ({}), 301), /Limite o richiesta/);
});

test("uses MusicBrainz IDs and flags duplicate title matches for explicit selection", () => {
  const mbid = "83d91898-7763-47d7-b03b-b92132375c47";
  const albums = [
    { id: "exact", name: "Blue", artist: "Artist", artist_names: ["Artist"], mbid },
    { id: "other", name: "Blue", artist: "Artist", artist_names: ["Artist"],
      mbid: "83d91898-7763-47d7-b03b-b92132375c48" },
  ];
  const byId = topListenedAlbums(albums, [{ artist: "Artist", name: "Different title", mbid, playcount: 20 }]);
  assert.deepEqual(byId.map((album) => album.id), ["exact"]);
  assert.equal(byId[0].matchConfidence, "high");
  assert.match(byId[0].matchReason, /identificativo MusicBrainz/);

  const conflict = topListenedAlbums([
    { id: "conflict", name: "Blue", artist: "Artist", artist_names: ["Artist"],
      mbid: "83d91898-7763-47d7-b03b-b92132375c48" },
  ], [{ artist: "Artist", name: "Blue", mbid, playcount: 10 }]);
  assert.equal(conflict[0].matchConfidence, "ambiguous");
  assert.match(conflict[0].matchReason, /identificativi MusicBrainz non concordano/);

  const ambiguous = topListenedAlbums(albums.map((album) => ({ ...album, mbid: undefined })),
    [{ artist: "Artist", name: "Blue", playcount: 10 }]);
  assert.deepEqual(ambiguous.map((album) => album.matchConfidence), ["ambiguous", "ambiguous"]);
  assert.ok(ambiguous.every((album) => /scegli la corrispondenza Spotify/.test(album.matchReason)));
});

test("uses one canonical Spotify redirect URI for browser and installed PWA paths", () => {
  const canonical = "https://melvin-91.github.io/accord-album-pwa/";
  assert.equal(spotifyRedirectUriForPage(canonical), canonical);
  assert.equal(spotifyRedirectUriForPage(`${canonical}index.html`), canonical);
  assert.equal(spotifyRedirectUriForPage(`${canonical}index.html?source=installed`), canonical);
  assert.equal(spotifyRedirectUriForPage("https://example.test/pwa/index.html"), "https://example.test/pwa/");
});

test("accepts Spotify album IDs, links, and URIs without accepting other hosts", () => {
  const id = "0123456789012345678901";
  assert.equal(spotifyAlbumId(id), id);
  assert.equal(spotifyAlbumId(`spotify:album:${id}`), id);
  assert.equal(spotifyAlbumId(`https://open.spotify.com/intl-it/album/${id}?si=example`), id);
  assert.equal(spotifyAlbumId("Album e artista"), null);
  assert.throws(() => spotifyAlbumId(`https://example.com/album/${id}`), /link Spotify valido/);
});

test("extracts and deduplicates only valid full albums from playlist items", () => {
  const id = "0123456789012345678901";
  const albumItem = {
    type: "track",
    album: {
      id,
      name: "Record",
      album_type: "album",
      artists: [{ name: "Artist" }],
      external_urls: { spotify: `https://open.spotify.com/album/${id}` },
      release_date: "2024-01-02",
    },
  };
  const albums = playlistAlbumRecords([
    { item: albumItem },
    { track: albumItem },
    { item: { ...albumItem, album: { ...albumItem.album, album_type: "single" } } },
    { item: { ...albumItem, album: { ...albumItem.album, id: "bad" } } },
  ]);
  assert.deepEqual(albums, [album(id, {
    name: "Record", artist: "Artist", year: "2024", primary_genre: "",
  })]);

  const existing = album(id, { rating: 4, genres: ["Jazz"] });
  const result = addPlaylistAlbums([existing], albums);
  assert.equal(result.added, 0);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.albums, [existing]);
  const added = addPlaylistAlbums([], albums);
  assert.equal(added.added, 1);
  assert.deepEqual(added.albums, albums);
});

test("normalizes ListenBrainz recommendations and rejects unrelated or invalid rows", () => {
  const rows = [
    { reference_mbid: "seed", artist_mbid: "b", name: "Artist B", score: 2 },
    { reference_mbid: "seed", artist_mbid: "a", name: "Artist A", score: 4 },
    { reference_mbid: "seed", artist_mbid: "a", name: "Duplicate", score: 3 },
    { reference_mbid: "other", artist_mbid: "c", name: "Wrong seed", score: 10 },
    { reference_mbid: "seed", artist_mbid: "seed", name: "Seed", score: 10 },
    { reference_mbid: "seed", artist_mbid: "d", name: "Invalid score", score: Infinity },
  ];
  assert.deepEqual(listenBrainzRecommendations(rows, "seed"), [
    { name: "Artist A", mbid: "a", score: 4, match: 1 },
    { name: "Artist B", mbid: "b", score: 2, match: 0.5 },
  ]);
  assert.throws(() => listenBrainzRecommendations({}, "seed"), /ListenBrainz/);
});
