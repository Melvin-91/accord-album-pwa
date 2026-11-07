import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createUpdateLifecycle, localCollectionStatus, musicalChanges, serviceFailure } from "./runtime-status.mjs";
import { commitLocalRestore, createCollectionHistoryEntry, appendCollectionHistory, albumChanges, formatSyncSummary } from "./ui.mjs";
import { validateDocument } from "./core.mjs";

const key = "accord-album-pwa-v1";
const album = { id: "a", name: "One", artist: "Band", url: "https://open.spotify.com/album/a",
  year: "2026", status: "queued", rating: null, genres: [], primary_genre: "", collections: [], tags: [], notes: "",
  cover_sha256: null };
const initial = () => ({ albums: [album], base: [album], manualOrder: ["a"], sortOrder: "artist" });
const memoryStorage = (state = initial()) => {
  const records = new Map([[key, JSON.stringify(state)]]);
  return { records, getItem: (name) => records.get(name) ?? null,
    setItem: (name, value) => records.set(name, value), removeItem: (name) => records.delete(name) };
};

function lifecycle() {
  const events = [], callbacks = new Map();
  let blocked = false, accepted = true, failed = false, reloads = 0, writes = 0;
  const worker = { state: "installed", postMessage(message) { events.push(message.type); } };
  const update = createUpdateLifecycle({
    hasWork: () => blocked,
    confirm: () => accepted,
    prepare: () => { if (failed) throw new Error("quota"); writes += 1; },
    reload: () => { reloads += 1; },
    present: () => events.push("present"),
    status: (text, chosen) => events.push({ text, chosen }),
    schedule: (fn) => { callbacks.set(1, fn); return 1; },
    cancel: (id) => callbacks.delete(id),
  });
  update.ready(worker);
  return { update, worker, events, callbacks,
    block: (value) => { blocked = value; }, accept: (value) => { accepted = value; },
    fail: (value) => { failed = value; },
    get reloads() { return reloads; }, get writes() { return writes; } };
}

test("installation and first control never activate or reload automatically", () => {
  const h = lifecycle();
  h.update.controllerChanged(h.worker, false);
  assert.equal(h.reloads, 0);
  assert.equal(h.events.includes("accord-activate-update"), false);
});

test("dirty work, confirmation cancellation and storage failure never request activation", () => {
  const h = lifecycle();
  h.block(true); h.update.apply();
  h.block(false); h.accept(false); h.update.apply();
  h.accept(true); h.fail(true); h.update.apply();
  assert.equal(h.events.includes("accord-activate-update"), false);
  assert.equal(h.reloads, 0);
  assert.equal(h.writes, 0);
  assert.match(h.events.at(-1).text, /quota/);
});

test("explicit activation snapshots state then reloads once despite repeated controllerchange", () => {
  const h = lifecycle();
  h.update.apply(); h.update.apply();
  assert.equal(h.writes, 1);
  assert.equal(h.events.filter((event) => event === "accord-activate-update").length, 1);
  h.update.controllerChanged(h.worker);
  h.update.controllerChanged(h.worker);
  h.update.apply();
  assert.equal(h.reloads, 1);
  assert.equal(h.writes, 2, "capture the latest view at the actual safe restart");
  assert.equal(h.callbacks.size, 0);
});

test("work started during activation blocks reload until a fresh explicit confirmation", () => {
  const h = lifecycle();
  h.update.apply(); h.block(true);
  h.update.controllerChanged(h.worker);
  assert.equal(h.reloads, 0);
  assert.match(h.events.at(-1), /present/);
  h.block(false);
  assert.equal(h.reloads, 0);
  h.update.apply();
  assert.equal(h.reloads, 1);
});

test("another tab changing controller keeps this tab alive even when idle", () => {
  const h = lifecycle();
  h.update.controllerChanged(h.worker);
  assert.equal(h.reloads, 0);
  assert.match(h.events.at(-1).text, /altra scheda/);
  h.update.apply();
  assert.equal(h.reloads, 1);
  assert.equal(h.events.includes("accord-activate-update"), false);
});

test("a later waiting version requires activation even if a previous version was activated externally", () => {
  const h = lifecycle();
  h.update.controllerChanged(h.worker);
  const next = { state: "installed", postMessage: (message) => h.events.push(message.type) };
  h.update.ready(next);
  h.update.apply();
  assert.equal(h.reloads, 0);
  assert.equal(h.events.filter((event) => event === "accord-activate-update").length, 1);
  h.update.controllerChanged(next);
  assert.equal(h.reloads, 1);
});

test("defer cancels the requested restart, and an activation timeout permits an explicit retry", () => {
  const h = lifecycle();
  h.update.apply(); h.update.defer(); h.update.controllerChanged(h.worker);
  assert.equal(h.reloads, 0);
  const stalled = lifecycle();
  stalled.update.apply();
  stalled.callbacks.get(1)();
  assert.equal(stalled.reloads, 0);
  assert.match(stalled.events.at(-1).text, /non confermata/);
  stalled.update.apply();
  assert.equal(stalled.events.filter((event) => event === "accord-activate-update").length, 2);
});

test("storage failure at controllerchange or unreadable work state never reloads", () => {
  const h = lifecycle();
  h.update.apply(); h.fail(true); h.update.controllerChanged(h.worker);
  assert.equal(h.reloads, 0);
  assert.match(h.events.at(-1).text, /quota/);
  let failed = false, reloads = 0, message;
  const update = createUpdateLifecycle({ hasWork: () => {
    if (failed) throw new Error("Archivio illeggibile");
    return false;
  }, prepare() {}, confirm: () => true, reload: () => { reloads += 1; }, present() {},
  status: (text) => { message = text; }, schedule: () => 1, cancel() {} });
  update.ready({ state: "installed", postMessage() {} }); update.apply(); failed = true;
  update.controllerChanged({});
  assert.equal(reloads, 0);
  assert.match(message, /illeggibile/);
});

test("musical dirty state uses current base, not timestamps, covers, order, cache or journal", () => {
  const state = initial(), storage = memoryStorage(state);
  assert.deepEqual(localCollectionStatus(storage, key, state), { exists: true, pending: 0, unsaved: false });
  state.albums = [{ ...album, notes: "New" }];
  assert.equal(localCollectionStatus(storage, key, state).unsaved, true);
  assert.equal(localCollectionStatus(storage, key, state).pending, 0, "unsaved changes cannot claim local persistence");
  storage.setItem(key, JSON.stringify({ ...state, collectionHistory: [{ id: "technical" }], lastSync: "today" }));
  assert.equal(localCollectionStatus(storage, key, state).pending, 1);
  state.base = state.albums;
  storage.setItem(key, JSON.stringify(state));
  assert.equal(localCollectionStatus(storage, key, state).pending, 0);
  assert.equal(musicalChanges([{ ...album, cover_sha256: "old" }],
    [{ ...album, cover_sha256: "new", updated_at: "today" }]), 0);
  assert.equal(musicalChanges([album], [{ ...album, rating: 4 }]), 1);
  assert.equal(musicalChanges([album], []), 1);
  assert.equal(musicalChanges([], [album]), 1);
});

test("unreadable storage and failed atomic local persistence preserve the real base", () => {
  const state = initial(), storage = memoryStorage(state);
  const original = storage.getItem(key);
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.throws(() => commitLocalRestore(storage, key, state,
    { ...state, albums: [{ ...album, notes: "Incoming" }], base: [{ ...album, notes: "Incoming" }] }), /Quota/);
  assert.equal(storage.getItem(key), original);
  assert.deepEqual(state, initial());
  storage.records.set(key, "{broken");
  assert.throws(() => localCollectionStatus(storage, key, state), SyntaxError);
});

test("base or collection changes in another tab reject commit without overwriting either intent", () => {
  for (const changed of ["albums", "base"]) {
    const state = initial(), storage = memoryStorage(state);
    const external = { ...state, [changed]: [{ ...album, notes: "Other tab" }] };
    storage.setItem(key, JSON.stringify(external));
    assert.throws(() => commitLocalRestore(storage, key, state,
      { ...state, albums: [{ ...album, notes: "My tab" }] }), /base salvata/);
    assert.deepEqual(JSON.parse(storage.getItem(key)), external);
    assert.deepEqual(state, initial());
  }
});

test("applying a synchronized base preserves local journal without adding a synchronization entry", () => {
  const state = { ...initial(), collectionHistory: [{ id: "local-history" }] }, storage = memoryStorage(state);
  const incoming = [{ ...album, notes: "Incoming" }];
  commitLocalRestore(storage, key, state, { ...state, albums: incoming, base: incoming }, {}, null);
  assert.deepEqual(state.collectionHistory, [{ id: "local-history" }]);
  assert.deepEqual(JSON.parse(storage.getItem(key)).collectionHistory, state.collectionHistory);
});

test("network absence does not turn auth, cooldown, service errors or data errors into offline errors", () => {
  assert.match(serviceFailure(new TypeError("fetch failed"), false), /Offline/);
  assert.match(serviceFailure(new TypeError("fetch failed"), true), /CORS/);
  for (const online of [true, false]) {
    assert.match(serviceFailure({ status: 401 }, online), /Accesso/);
    assert.match(serviceFailure({ status: 429 }, online), /cooldown/);
    assert.match(serviceFailure({ status: 503 }, online), /Servizio non disponibile/);
    assert.match(serviceFailure(new SyntaxError("bad JSON"), online), /dettagli/);
    assert.match(serviceFailure({ response: { status: 403,
      headers: new Headers({ "x-ratelimit-remaining": "0" }) } }, online), /cooldown/);
  }
});

const source = readFileSync(new URL("./app.mjs", import.meta.url), "utf8");
const section = (start, end) => {
  const offset = source.indexOf(start);
  assert.notEqual(offset, -1);
  return source.slice(offset, source.indexOf(end, offset));
};

test("real saveState reports quota failure and preserves persisted identity until successful storage", () => {
  const state = initial(), storage = memoryStorage(state), messages = [];
  const context = { state, localStorage: storage, STORAGE_KEY: key, localSaveError: "",
    persistedCollectionIdentity: JSON.stringify([state.albums, state.base]),
    normalizeLocalAlbums: (albums) => albums,
    appendCollectionHistory, createCollectionHistoryEntry, updateLocalSyncSummary() {},
    showFeedback: (message) => messages.push(message) };
  const save = runInNewContext(`${section("function saveState(", "\nfunction ensureManualOrder(")}\nsaveState`, context);
  state.albums = [{ ...album, notes: "New" }];
  storage.setItem = () => { throw new Error("quota"); };
  assert.throws(save, /quota/);
  assert.match(messages[0], /non salvata nel browser/);
  assert.equal(JSON.parse(storage.getItem(key)).albums[0].notes, "");
  assert.equal(context.localSaveError, "quota");
  storage.setItem = (name, value) => storage.records.set(name, value);
  save();
  assert.equal(JSON.parse(storage.getItem(key)).albums[0].notes, "New");
  assert.equal(context.localSaveError, "");
});

test("DOM update guard blocks inline edits, dialogs, pending cancel, provider jobs and failed draft persistence", () => {
  const state = initial(), storage = memoryStorage(state);
  let dialogs = [], pending = false, inlineValue = "", persistenceError = false, providerBusy = false;
  const context = { state, localStorage: storage, STORAGE_KEY: key, localSaveError: "",
    localCollectionStatus, commandGuard: { isBusy: () => pending }, qol: { drafts: {} },
    normalizeLocalAlbums: (albums) => albums,
    busyActivitySelectors: ["#syncButton"], catalogSuggestionsUI: { isBusy: () => providerBusy },
    catalogPlaylistUI: { isBusy: () => false }, tidalUI: { isBusy: () => false }, qobuzUI: { isBusy: () => false },
    document: { querySelector: () => null,
      querySelectorAll: (selector) => selector === "dialog" ? dialogs : [] },
    $: (selector) => selector === "#qolStorageError" ? { hidden: !persistenceError }
      : selector === "#albumList" ? { querySelectorAll: () => [{
        dataset: { albumId: "a" }, querySelector: () => ({ value: inlineValue }),
      }] } : { disabled: false } };
  const guard = runInNewContext(`${section("function updateHasUnsavedWork(", "\nconst updateLifecycle =")}\nupdateHasUnsavedWork`, context);
  assert.equal(guard(), false);
  inlineValue = "Draft"; assert.equal(guard(), true); inlineValue = "";
  dialogs = [{ id: "completion", open: true }]; assert.equal(guard(), true); dialogs = [];
  pending = true; assert.equal(guard(), true, "Stop/cancel does not finish an in-flight request");
  pending = false; providerBusy = true; assert.equal(guard(), true); providerBusy = false;
  persistenceError = true; assert.equal(guard(), true); persistenceError = false;
  assert.equal(guard(), false);
});

test("real sync distinguishes offline and stale base; failed persistence never updates the in-memory base", async () => {
  for (const outcome of ["offline", "stale-base", "local-quota"]) {
    const state = initial();
    if (outcome === "local-quota") state.albums = [{ ...album, notes: "My local edit" }];
    const storage = memoryStorage(state), messages = [], statuses = [], writes = [];
    const originalBase = structuredClone(state.base);
    const merged = outcome === "local-quota" ? state.albums : [{ ...album, notes: "Incoming" }];
    const context = { state, localStorage: storage, STORAGE_KEY: key, localCollectionStatus,
      navigator: { onLine: outcome !== "offline" }, serviceFailure, albumChanges, formatSyncSummary,
      normalizeLocalAlbums: (albums) => albums,
      $: () => ({ disabled: false }), credentials: () => ({ owner: "synthetic", token: "synthetic" }),
      readRemote: async () => {
        if (outcome === "offline") throw new TypeError("Network unavailable");
        return { albums: [album], covers: new Map(), coverArchive: new Uint8Array(), branch: "main" };
      },
      threeWayMerge: () => ({ albums: merged, conflicts: [] }),
      confirmSyncChanges: async () => {
        if (outcome === "stale-base") storage.setItem(key, JSON.stringify({ ...state, base: [{ ...album, notes: "Other tab" }] }));
        return true;
      },
      writeRemote: async () => {
        writes.push("albums");
        if (outcome === "local-quota") storage.setItem = () => { throw new Error("quota"); };
      },
      commitLocalRestore, showMessage: (title, text) => messages.push({ title, text }),
      showFeedback() {}, setSyncState: (text) => statuses.push(text),
      updateLocalSyncSummary() {}, render() {}, saveCollectionQol: () => true, qol: {},
      automaticSyncQueued: false, Uint8Array, Map, Date,
    };
    const run = runInNewContext(`${section("async function performSync(", '\n$("#syncButton").addEventListener')}\nperformSync`, context);
    await run();
    assert.deepEqual(state.base, originalBase);
    assert.equal(writes.length, outcome === "local-quota" ? 1 : 0);
    assert.equal(messages.length, 1);
    if (outcome === "offline") assert.match(statuses.at(-1), /Offline/);
    if (outcome === "stale-base") assert.match(messages[0].text, /base sono cambiate/);
    if (outcome === "local-quota") {
      assert.match(messages[0].title, /parziale/);
      assert.match(messages[0].text, /quota/);
      assert.equal(localCollectionStatus(storage, key, state).pending, 1);
    }
  }
});

test("legacy shapes, JSON key order and unsorted albums do not masquerade as another tab or failed persistence", () => {
  const normalize = runInNewContext(`${section("function normalizeLocalAlbums(", "\nfunction commitLocalRestore(")}\nnormalizeLocalAlbums`,
    { validateDocument });
  const fields = ["id", "name", "artist", "url", "year", "status", "rating", "genres"];
  const legacy = Object.fromEntries(fields.map((field) => [field, album[field]]));
  const another = { ...legacy, id: "b", url: "https://open.spotify.com/album/b" };
  const stored = { albums: [another, legacy], base: [legacy, another], manualOrder: ["b", "a"], sortOrder: "artist" };
  const storage = memoryStorage(stored);
  const state = { ...stored, albums: normalize(stored.albums), base: normalize(stored.base) };
  assert.equal(localCollectionStatus(storage, key, state, normalize).unsaved, false);
  const next = { ...state, albums: [{ ...state.albums[0], notes: "New" }, state.albums[1]] };
  commitLocalRestore(storage, key, state, next, {}, "Local edit", normalize);
  assert.equal(localCollectionStatus(storage, key, state, normalize).pending, 1);
  assert.equal(localCollectionStatus(storage, key, state, normalize).unsaved, false);
});

test("SW activation retains old tabs' assets, with no implicit skipWaiting or reload", async () => {
  const handlers = {}, oldAsset = { body: "old asset" };
  let promise, claims = 0, deletes = 0, fetches = 0;
  runInNewContext(readFileSync(new URL("./sw.js", import.meta.url), "utf8"), {
    URL, self: { location: { href: "https://example.test/pwa/sw.js", origin: "https://example.test" },
      addEventListener: (name, fn) => { handlers[name] = fn; },
      clients: { claim: async () => { claims += 1; } },
      skipWaiting: () => { throw new Error("Implicit activation"); } },
    caches: { open: async (key) => ({ match: async () => key.endsWith("-old") ? oldAsset : undefined }),
      keys: async () => ["unrelated-private-cache", "accord-album-pwa-old"],
      delete: () => { deletes += 1; } },
    fetch: () => { fetches += 1; throw new Error("Unexpected request"); },
  });
  handlers.activate({ waitUntil: (value) => { promise = value; } }); await promise;
  assert.equal(claims, 1); assert.equal(deletes, 0);
  handlers.fetch({ request: { url: "https://example.test/pwa/app.mjs?v=old", method: "GET" },
    respondWith: (value) => { promise = value; } });
  assert.equal(await promise, oldAsset);
  assert.equal(fetches, 0);
});
