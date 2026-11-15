import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { ALBUM_STATES, validateAlbum, findCollectionAlbum, addPlaylistAlbums, threeWayMerge, encodeCoverArchive } from "./core.mjs";
import { createCollectionStore, duplicateCollectionGroups, suggestDuplicateMerge, COLLECTION_KEY } from "./collection-store.mjs";
import { createCollectionSync } from "./collection-sync.mjs";
import { createCollectionServices } from "./collection-services.mjs";
import { createTidalAuth, tidalAlbumRecords } from "./tidal.mjs";
globalThis.crypto ||= webcrypto;

const album = (id = "A".repeat(22), changes = {}) => validateAlbum({
  id, artist: "Bjork", name: "Debut", year: "1993", status: "queued", rating: null,
  genres: [], primary_genre: "", collections: [], tags: [], cover_sha256: null, notes: "",
  url: id.startsWith("tidal:") ? `https://tidal.com/browse/album/${id.slice(6)}`
    : id.startsWith("qobuz:") ? `https://play.qobuz.com/album/${id.slice(6)}` : `https://open.spotify.com/album/${id}`,
  ...changes,
});
const storage = (values = {}) => {
  const data = new Map(Object.entries(values));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key), data };
};
const local = (records, base = records, extras = {}) => storage({ [COLLECTION_KEY]: JSON.stringify({ albums: records, base, ...extras }),
  "accord-album-owner": "owner", "accord-album-token": "synthetic-test-token" });
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status });
function github(records, { failPut = false, mutateBeforePut, coverArchive, deletedAlbums = [], deletionHistory = true } = {}) {
  const writes = [], reads = [];
  const request = async (url, options = {}) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    if (options.method === "PUT") {
      writes.push({ url, payload: JSON.parse(options.body) });
      if (mutateBeforePut) mutateBeforePut();
      if (failPut) throw new Error("Disconnected");
      if (new URL(url).pathname.endsWith("/albums.json")) {
        const document = JSON.parse(Buffer.from(writes.at(-1).payload.content, "base64").toString());
        records = document.albums;
        deletedAlbums = document.deleted_albums || [];
        deletionHistory = document.deletion_history === true;
      }
      return reply({ content: { sha: "next" }, commit: { sha: "commit" } });
    }
    reads.push(url);
    if (/covers\.bin/.test(url)) {
      if (!coverArchive) return reply({}, 404);
      return options.headers.Accept.includes("raw") ? new Response(coverArchive) : reply({ type: "file", sha: "covers" });
    }
    if (/albums\.json/.test(url)) return reply({ type: "file", sha: "albums",
      content: Buffer.from(JSON.stringify({ format: "accord-album-collection", version: 4, albums: records,
        deletion_sync: true, deletion_history: deletionHistory, deleted_albums: deletedAlbums })).toString("base64") });
    return reply({ private: true, default_branch: "main" });
  };
  return { request, writes, reads };
}
const coverCache = { get: async () => null, put: async () => {} };

test("cross-catalog checks normalize accents, punctuation and safe edition suffixes, not live recordings", () => {
  const saved = album(undefined, { artist: "Björk", name: "Debut", rating: 4.5, notes: "Keep this review" });
  const candidate = album("tidal:12", { name: "DEBUT (2011 Remastered)", year: "2011" });
  assert.equal(findCollectionAlbum([saved], candidate).album, saved);
  assert.equal(findCollectionAlbum([saved], album("tidal:13", { name: "Debut (Live)" })), null);
  assert.equal(findCollectionAlbum([saved], album("qobuz:abc", { artist: "Another Artist" })), null);
  assert.equal(findCollectionAlbum([saved], album("tidal:12", { year: "2011" })).confidence, "uncertain");
  assert.equal(addPlaylistAlbums([saved], [candidate, candidate]).added, 0);
  assert.equal(saved.rating, 4.5); assert.equal(saved.notes, "Keep this review");
});
test("explicit edition links are trusted only while their source identity is current", () => {
  const saved = album(), candidate = album("tidal:12", { name: "Different display title" });
  const links = { [saved.id]: { tidal: { id: candidate.id, source: JSON.stringify([saved.id, saved.artist, saved.name]) } } };
  assert.equal(findCollectionAlbum([saved], candidate, links).confidence, "verified");
  assert.equal(findCollectionAlbum([{ ...saved, name: "Edited identity" }], candidate, links), null);
});
test("duplicate review groups known edition aliases and does not group unrelated recordings", () => {
  const a = album(), b = album("tidal:12", { name: "Debut - Deluxe Edition" }), live = album("tidal:13", { name: "Debut (Live)" });
  assert.deepEqual(duplicateCollectionGroups([a, b, live]).map((group) => group.map((row) => row.id)), [[a.id, b.id]]);
});
test("local mutations preserve hidden data and reviews, reject stale storage and failed writes", () => {
  const saved = album(undefined, { notes: "Review", collections: ["Keep"], tags: ["Tag"] });
  const disk = local([saved], [saved], { collectionHistory: [{ before: "untouched" }], activity: { personal: "keep" } });
  const store = createCollectionStore(disk);
  store.update(saved.id, { rating: 4 });
  assert.equal(store.state.albums[0].notes, "Review");
  assert.deepEqual(store.state.activity, { personal: "keep" });
  assert.deepEqual(store.state.collectionHistory, [{ before: "untouched" }]);
  const before = store.state;
  disk.setItem(COLLECTION_KEY, JSON.stringify({ albums: [], base: [] }));
  assert.throws(() => store.remove([saved.id]), /altra scheda/);
  assert.equal(store.state, before);
  const full = local([saved]), failing = createCollectionStore(full);
  full.setItem = () => { throw new Error("Quota exceeded"); };
  assert.throws(() => failing.update(saved.id, { rating: 5 }), /Quota/);
  assert.equal(failing.state.albums[0].rating, null);
});
test("review choices remove only selected copies and preserve the keeper and pending deletion snapshot", () => {
  const a = album(undefined, { rating: 4, notes: "Keeper" }), b = album("tidal:12", { rating: 2, notes: "Other review" });
  const disk = local([a, b]), store = createCollectionStore(disk), before = store.state;
  store.remove([b.id], before);
  assert.deepEqual(store.state.albums, [a]);
  assert.deepEqual(store.state.pendingRemovals, [b]);
  assert.throws(() => store.remove([a.id], before), /Raccolta cambiata/);
  assert.equal(createCollectionStore(disk).state.pendingRemovals[0].notes, "Other review");
});
test("duplicate suggestions merge reviews, ratings, labels and favorites only after confirmation", () => {
  const a = album(undefined, { rating: 4, notes: "Keeper review", tags: ["Epic"], status: "liked" });
  const b = album("tidal:12", { rating: 2, notes: "Other review", tags: ["epic", "Rare"], status: "disliked" });
  const disk = local([a, b], [a, b], { preferences: { favoriteIds: [a.id, b.id] } });
  const store = createCollectionStore(disk), before = store.state, group = store.groups()[0];
  const proposal = store.suggestMerge(group);
  assert.equal(store.state, before);
  assert.equal(proposal.album.id, a.id);
  assert.deepEqual(suggestDuplicateMerge([b, a], [a.id, b.id]), proposal);
  store.merge(group, before);
  const merged = store.state.albums[0];
  assert.equal(store.state.albums.length, 1);
  assert.equal(merged.rating, 4);
  assert.match(merged.notes, /Keeper review/); assert.match(merged.notes, /Other review/);
  assert.match(merged.notes, /2\/5/); assert.match(merged.notes, /Non mi piace/);
  assert.deepEqual(merged.tags, ["Epic", "Rare"]);
  assert.deepEqual(store.state.preferences.favoriteIds, [a.id]);
  assert.deepEqual(store.state.pendingRemovals, [b]);
  assert.throws(() => store.merge(group, before), /Raccolta cambiata/);
});
test("a merge exceeding field limits or failing persistence leaves every original intact", () => {
  const a = album(undefined, { tags: Array.from({ length: 20 }, (_, i) => `Tag ${i}`) });
  const b = album("tidal:12", { tags: ["Additional"] }), disk = local([a, b]), store = createCollectionStore(disk);
  const before = store.state;
  assert.throws(() => store.merge([a, b]), /20/);
  assert.equal(store.state, before);
  const writable = local([album(), album("tidal:12")]), other = createCollectionStore(writable), expected = other.state;
  writable.setItem = () => { throw new Error("Quota exceeded"); };
  assert.throws(() => other.merge(expected.albums), /Quota/);
  assert.equal(other.state, expected);
});
test("replacement is atomic and distinct-album confirmation cannot add the same native ID twice", () => {
  const a = album(), b = album("tidal:12", { year: "2010" });
  const store = createCollectionStore(local([a]));
  assert.ok(store.add(b));
  store.add(b, { distinct: true });
  assert.equal(store.state.albums.length, 2);
  assert.ok(store.add(b, { distinct: true }));
  const replacement = createCollectionStore(local([a]));
  replacement.add(b, { replaceId: a.id });
  assert.deepEqual(replacement.state.albums, [b]);
  assert.deepEqual(replacement.state.pendingRemovals, [a]);
});
test("malformed local collections are not silently replaced", () => {
  const disk = storage({ [COLLECTION_KEY]: JSON.stringify({ albums: null, preferences: {} }) });
  assert.throws(() => createCollectionStore(disk), /non supportato/);
  assert.equal(JSON.parse(disk.getItem(COLLECTION_KEY)).albums, null);
});
test("shared deletions are opt-in, conflict with concurrent edits, and never delete unknown remote additions", () => {
  const a = album(), edited = { ...a, rating: 5 }, extra = album("tidal:20", { name: "Other album" });
  assert.equal(threeWayMerge([a], [], [a]).albums.length, 1);
  assert.deepEqual(threeWayMerge([a], [], [a, extra], {}, { propagateDeletions: true }).albums, [extra]);
  const conflict = threeWayMerge([a], [], [edited], {}, { propagateDeletions: true });
  assert.equal(conflict.conflicts[0].fields[0].field, "album");
  assert.deepEqual(threeWayMerge([a], [], [edited], { [a.id]: { album: "local" } }, { propagateDeletions: true }).albums, []);
});
test("sync confirms removals, keeps remote additions, then advances the local base", async () => {
  const a = album(), extra = album("tidal:20", { name: "Other album" });
  const disk = local([a]), store = createCollectionStore(disk), remote = github([a, extra]);
  store.remove([a.id]);
  let confirmed = false;
  const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request });
  await sync.sync({ chooseConflicts: () => assert.fail("No conflict expected"), confirm: async ({ albums }) => {
    assert.deepEqual(albums, [extra]); confirmed = true; return true;
  } });
  assert.ok(confirmed);
  assert.equal(remote.writes.length, 1);
  const document = JSON.parse(Buffer.from(remote.writes[0].payload.content, "base64").toString());
  assert.deepEqual(document.albums, [extra]); assert.equal(document.deletion_sync, true);
  assert.deepEqual(store.state.base, [extra]); assert.deepEqual(store.state.pendingRemovals, []);
});
test("shared removal history prevents an old offline copy returning on repeated synchronizations", async () => {
  const keeper = album(), removed = album("tidal:12");
  const remote = github([keeper], { deletedAlbums: [removed] });
  const disk = local([keeper, removed], []), store = createCollectionStore(disk);
  const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request });
  const options = { chooseConflicts: () => assert.fail("Unchanged removed copy is not a new album"), confirm: async () => true };
  await sync.sync(options);
  await sync.sync(options);
  assert.deepEqual(store.state.albums, [keeper]);
  assert.deepEqual(store.state.deletedAlbums, [removed]);
  assert.equal(remote.writes.length, 0);
  const observerDisk = local([keeper], [], { deletedAlbums: [removed] });
  const observer = createCollectionStore(observerDisk);
  const observerSync = createCollectionSync({ storage: observerDisk, store: observer, covers: coverCache, fetch: remote.request });
  await observerSync.sync(options);
  store.add(removed, { distinct: true });
  await sync.sync(options);
  assert.equal(store.state.albums.length, 2);
  assert.deepEqual(store.state.deletedAlbums, []);
  await sync.sync(options);
  await observerSync.sync(options);
  await sync.sync(options);
  assert.equal(observer.state.albums.length, 2);
  assert.deepEqual(observer.state.deletedAlbums, []);
  assert.equal(remote.writes.length, 1);
});
test("a legacy writer cannot erase the local removal history or reintroduce an unchanged duplicate", async () => {
  const a = album(), b = album("tidal:12");
  const disk = local([a], [a], { deletedAlbums: [b] }), store = createCollectionStore(disk);
  const remote = github([a, b], { deletionHistory: false });
  const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request });
  const options = { chooseConflicts: () => assert.fail("Unchanged deleted copy"), confirm: async () => true };
  await sync.sync(options); await sync.sync(options);
  assert.deepEqual(store.state.albums, [a]);
  assert.deepEqual(store.state.deletedAlbums, [b]);
  assert.equal(remote.writes.length, 1);
});
test("offline edits to a removed duplicate require a decision and cancellation changes nothing", async () => {
  const a = album(), removed = album("tidal:12"), edited = { ...removed, notes: "Offline review", rating: 5 };
  const disk = local([a, edited], []), store = createCollectionStore(disk), before = store.state;
  const remote = github([a], { deletedAlbums: [removed] });
  const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request });
  assert.equal(await sync.sync({ chooseConflicts: async (conflicts) => {
    assert.equal(conflicts[0].fields[0].field, "album");
    assert.equal(conflicts[0].local.notes, "Offline review"); return null;
  }, confirm: () => assert.fail("Cancelled before confirmation") }), false);
  assert.equal(store.state, before); assert.equal(remote.writes.length, 0);
});
test("malformed or overlapping removal archives fail before any local or shared mutation", async () => {
  const a = album(), b = album("tidal:12");
  for (const deletedAlbums of [[a], [b, b], { invalid: true }]) {
    const disk = local([a]), store = createCollectionStore(disk), before = store.state;
    const remote = github([a], { deletedAlbums });
    const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request });
    await assert.rejects(sync.sync({ chooseConflicts: () => assert.fail(), confirm: () => assert.fail() }));
    assert.equal(store.state, before); assert.equal(remote.writes.length, 0);
  }
});
test("cancel and an uncertain write leave the base and pending removals unchanged, without retry", async () => {
  const a = album(), disk = local([a]), store = createCollectionStore(disk);
  store.remove([a.id]);
  const before = store.state, remote = github([a], { failPut: true });
  const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request });
  assert.equal(await sync.sync({ chooseConflicts: async () => null, confirm: async () => false }), false);
  assert.equal(remote.writes.length, 0);
  await assert.rejects(sync.sync({ chooseConflicts: async () => null, confirm: async () => true }), /incerto/);
  assert.equal(remote.writes.length, 1); assert.equal(store.state, before);
});
test("sync rejects a cross-catalog copy already remote, but permits an explicitly confirmed replacement", async () => {
  const a = album(), b = album("tidal:12", { name: "Debut (Deluxe Edition)" });
  const disk = local([b], []), store = createCollectionStore(disk), remote = github([a]), before = store.state;
  const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request });
  assert.equal((await sync.checkAddition(b)).album.id, a.id);
  await assert.rejects(sync.sync({ chooseConflicts: () => assert.fail("Duplicate rejected before choices"),
    confirm: () => assert.fail("Duplicate rejected before confirmation") }), /gia' nella raccolta condivisa/);
  assert.equal(remote.writes.length, 0);
  assert.equal(store.state, before);
  const replacementDisk = local([a]), replacement = createCollectionStore(replacementDisk);
  replacement.add(b, { replaceId: a.id });
  const replacementSync = createCollectionSync({ storage: replacementDisk, store: replacement,
    covers: coverCache, fetch: remote.request });
  await replacementSync.sync({ chooseConflicts: () => assert.fail("No conflict expected"), confirm: async () => true });
  assert.deepEqual(replacement.state.albums, [b]);
  assert.deepEqual(replacement.state.pendingRemovals, []);
  assert.equal(remote.writes.length, 1);
});
test("cover hashes must be verifiable before writing any album data", async () => {
  const a = album(undefined, { cover_sha256: "1".repeat(64) }), disk = local([a]), store = createCollectionStore(disk);
  const remote = github([a]);
  const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request });
  await assert.rejects(sync.sync({ chooseConflicts: async () => null, confirm: async () => true }), /Copertina non verificabile/);
  assert.equal(remote.writes.length, 0);
});
test("a valid TIDAL OAuth session recovers its public Client ID without login or token requests", () => {
  const disk = storage(), session = storage({ "accord-tidal-token-v1": JSON.stringify({
    access_token: "synthetic", clientId: "my-client", expires: Date.now() + 3600000 }) });
  const services = createCollectionServices({ storage: disk, session, pageUrl: "https://example.test/pwa/",
    fetch: () => assert.fail("No network needed for a connected session") });
  assert.equal(services.settings("tidal").connected, true);
  assert.equal(disk.getItem("accord-tidal-client-id-v1"), "my-client");
  disk.setItem("accord-tidal-client-id-v1", "different-client");
  assert.equal(services.settings("tidal").connected, false);
  assert.match(services.settings("tidal").text, /diverso/);
});
test("configured Client ID alone is never described as a connected TIDAL account", () => {
  const services = createCollectionServices({ storage: storage({ "accord-tidal-client-id-v1": "my-client" }),
    session: storage(), pageUrl: "https://example.test/" });
  assert.equal(services.settings("tidal").connected, false);
  assert.match(services.settings("tidal").text, /Client ID salvato/);
});
test("music credentials migrate to persistent storage and survive a new browser session", () => {
  const credentials = {
    "accord-tidal-token-v1": JSON.stringify({ clientId: "tidal-client", access_token: "tidal-token",
      refresh_token: "tidal-refresh", expires: Date.now() + 3600000 }),
    "accord-qobuz-session-v1": JSON.stringify({ appId: "qobuz-app", token: "qobuz-token" }),
    "accord-spotify-access-token": "spotify-token", "accord-spotify-refresh-token": "spotify-refresh",
    "accord-spotify-token-expires": String(Date.now() + 3600000),
    "accord-spotify-token-client-id": "spotify-client",
  };
  const disk = storage({ "accord-spotify-client-id": "spotify-client" }), tab = storage(credentials);
  const options = { storage: disk, pageUrl: "https://example.test/pwa/",
    fetch: () => assert.fail("Restoring a connected account must not require a login request") };
  createCollectionServices({ ...options, session: tab });
  for (const [key, value] of Object.entries(credentials)) {
    assert.equal(disk.getItem(key), value);
    assert.equal(tab.getItem(key), null);
  }
  const reopened = createCollectionServices({ ...options, session: storage() });
  for (const provider of ["tidal", "spotify", "qobuz"]) {
    assert.equal(reopened.settings(provider).connected, true, provider);
    reopened.disconnect(provider);
    assert.equal(createCollectionServices({ ...options, session: storage() }).settings(provider).connected, false, provider);
  }
  for (const key of Object.keys(credentials)) assert.equal(disk.getItem(key), null);
});
test("an existing persistent credential takes precedence over a stale tab credential", () => {
  const key = "accord-tidal-token-v1";
  const token = (access_token) => JSON.stringify({ clientId: "client", access_token, expires: Date.now() + 3600000 });
  const saved = token("current"), disk = storage({ [key]: saved }), tab = storage({ [key]: token("stale") });
  createCollectionServices({ storage: disk, session: tab, pageUrl: "https://example.test/pwa/" });
  assert.equal(disk.getItem(key), saved);
  assert.equal(tab.getItem(key), null);
});
test("OAuth PKCE state stays tab-bound while completed TIDAL and Spotify logins persist", async () => {
  for (const provider of ["tidal", "spotify"]) {
    const disk = storage(), tab = storage(), pageUrl = "https://example.test/pwa/";
    const options = { storage: disk, pageUrl, fetch: async (url) => {
      assert.match(url, /\/token$/);
      return reply({ access_token: `${provider}-token`, refresh_token: `${provider}-refresh`, expires_in: 3600 });
    } };
    const services = createCollectionServices({ ...options, session: tab });
    const authorization = new URL(await services.connect(provider, { clientId: `${provider}-client` }));
    const callback = new URL(pageUrl);
    callback.searchParams.set("state", authorization.searchParams.get("state"));
    callback.searchParams.set("code", "test-code");
    const foreignTab = createCollectionServices({ ...options, session: storage(),
      fetch: () => assert.fail("No token exchange without matching tab state") });
    await assert.rejects(foreignTab.finish(callback.href), /OAuth/);
    assert.equal([...disk.data.keys()].some((key) => /pkce|oauth-state|code-verifier/.test(key)), false);
    assert.equal(await services.finish(callback.href), true);
    assert.equal(createCollectionServices({ ...options, session: storage() }).settings(provider).connected, true);
    assert.equal([...tab.data.keys()].some((key) => /token|pkce|oauth|verifier/.test(key)), false);
  }
});
test("a verified Qobuz connection survives closing the tab and can be disconnected later", async () => {
  const disk = storage(), tab = storage(), options = { storage: disk, pageUrl: "https://example.test/pwa/",
    fetch: async () => reply({ albums: { items: [], total: 0 } }) };
  const services = createCollectionServices({ ...options, session: tab });
  await services.connect("qobuz", { appId: "test-app", token: "test-token" });
  assert.equal(tab.getItem("accord-qobuz-session-v1"), null);
  const reopened = createCollectionServices({ ...options, session: storage() });
  assert.equal(reopened.settings("qobuz").connected, true);
  reopened.disconnect("qobuz");
  assert.equal(services.settings("qobuz").connected, false);
});
test("an expired persistent Spotify login refreshes and retains rotated credentials", async () => {
  const disk = storage({ "accord-spotify-client-id": "spotify-client",
    "accord-spotify-token-client-id": "spotify-client", "accord-spotify-access-token": "old-token",
    "accord-spotify-refresh-token": "old-refresh", "accord-spotify-token-expires": "1" });
  const services = createCollectionServices({ storage: disk, session: storage(), pageUrl: "https://example.test/pwa/",
    fetch: async (url, options) => {
      if (url.endsWith("/token")) {
        assert.equal(options.body.get("refresh_token"), "old-refresh");
        return reply({ access_token: "new-token", refresh_token: "new-refresh", expires_in: 3600 });
      }
      assert.equal(options.headers.Authorization, "Bearer new-token");
      return reply({ albums: { items: [] } });
    } });
  assert.deepEqual(await services.search("Test album"), []);
  assert.equal(disk.getItem("accord-spotify-refresh-token"), "new-refresh");
  assert.equal(createCollectionServices({ storage: disk, session: storage(),
    pageUrl: "https://example.test/pwa/" }).settings("spotify").connected, true);
});
test("disconnect in another tab prevents a late TIDAL or Spotify refresh from restoring access", async () => {
  for (const provider of ["tidal", "spotify"]) {
    const disk = storage({ "accord-music-service-v1": provider, "accord-spotify-client-id": "test-client",
      "accord-spotify-token-client-id": "test-client", "accord-spotify-access-token": "old-token",
      "accord-spotify-refresh-token": "old-refresh", "accord-spotify-token-expires": "1",
      "accord-tidal-token-v1": JSON.stringify({ clientId: "test-client", access_token: "old-token",
        refresh_token: "old-refresh", expires: 1 }) });
    let release;
    const options = { storage: disk, pageUrl: "https://example.test/pwa/", fetch: async (url) => {
      assert.match(url, /\/token$/);
      return new Promise((resolve) => { release = resolve; });
    } };
    const services = createCollectionServices({ ...options, session: storage() });
    const pending = services.search("Test album");
    await new Promise((resolve) => setImmediate(resolve));
    createCollectionServices({ ...options, session: storage() }).disconnect(provider);
    release(reply({ access_token: "late-token", refresh_token: "late-refresh", expires_in: 3600 }));
    await assert.rejects(pending, /cambiato/);
    assert.equal(services.settings(provider).connected, false);
    assert.equal(disk.getItem(provider === "tidal" ? "accord-tidal-token-v1" : "accord-spotify-access-token"), null);
  }
});
test("a reopened TIDAL login refreshes automatically and preserves the refresh token", async () => {
  const disk = storage({ "accord-music-service-v1": "tidal",
    "accord-tidal-token-v1": JSON.stringify({ clientId: "test-client", access_token: "expired-token",
      refresh_token: "saved-refresh", expires: 1 }) });
  let refreshes = 0;
  const options = { storage: disk, pageUrl: "https://example.test/pwa/", fetch: async (url, options) => {
    if (url.endsWith("/token")) {
      refreshes++;
      assert.equal(options.body.get("refresh_token"), "saved-refresh");
      return reply({ access_token: "renewed-token", expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, "Bearer renewed-token");
    return url.includes("/users/me") ? reply({ data: { attributes: { country: "IT" } } }) : reply({ data: [] });
  } };
  const services = createCollectionServices({ ...options, session: storage() });
  assert.deepEqual(await services.search("tidal:12"), []);
  assert.equal(refreshes, 1);
  const saved = JSON.parse(disk.getItem("accord-tidal-token-v1"));
  assert.equal(saved.refresh_token, "saved-refresh");
  assert.equal(saved.access_token, "renewed-token");
  assert.equal(createCollectionServices({ ...options, session: storage() }).settings("tidal").connected, true);
});
const tidalSearchFixture = (respond) => {
  const disk = storage({ "accord-music-service-v1": "tidal" });
  const session = storage({ "accord-tidal-token-v1": JSON.stringify({
    clientId: "search-test-client", access_token: "search-test-token", expires: Date.now() + 3600000 }) });
  const calls = [];
  const document = { data: [{ type: "albums", id: "12",
    attributes: { title: "Search Album", releaseDate: "2020-01-01" },
    relationships: { artists: { data: [{ type: "artists", id: "1" }] },
      coverArt: { data: [{ type: "artworks", id: "cover-1" }] } } }],
    included: [{ type: "artists", id: "1", attributes: { name: "Test Artist" } },
      { type: "artworks", id: "cover-1", attributes: { files: [
        { href: "https://resources.tidal.com/images/cover/320x320.jpg", meta: { width: 320 } },
      ] } }] };
  const services = createCollectionServices({ storage: disk, session, pageUrl: "https://example.test/pwa/",
    fetch: async (url, options) => {
      calls.push({ url: new URL(url), options });
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer search-test-token");
      if (respond) {
        const response = respond(calls.at(-1), document);
        if (response) return response;
      }
      const path = new URL(url).pathname;
      if (path.endsWith("/users/me")) return reply({ data: { attributes: { country: "IT" } } });
      if (path.endsWith("/searchResults")) return reply({ data: [{ type: "searchResults", id: "opaque-result" }] });
      return reply(document);
    } });
  return { services, disk, session, calls, document };
};
test("TIDAL collection search resolves the official search identifier and returns addable albums", async () => {
  const f = tidalSearchFixture();
  const records = await f.services.search("Search Album");
  assert.equal(validateAlbum(records[0]).id, "tidal:12");
  assert.equal(f.services.coverUrl(records[0]), "https://resources.tidal.com/images/cover/320x320.jpg");
  assert.deepEqual(f.calls.map(({ url }) => url.pathname),
    ["/v2/users/me", "/v2/searchResults", "/v2/searchResults/opaque-result/relationships/albums"]);
  assert.equal(f.calls[2].url.searchParams.get("include"), "albums.artists,albums.coverArt");
  assert.equal(f.calls[2].url.searchParams.get("countryCode"), "IT");
});
test("TIDAL search hydrates identifier-only results instead of silently dropping albums", async () => {
  const f = tidalSearchFixture(({ url }) => url.pathname.endsWith("/relationships/albums")
    ? reply({ data: [{ type: "albums", id: "12" }] }) : null);
  const records = await f.services.search("Search Album");
  assert.equal(records[0].artist, "Test Artist");
  assert.equal(f.calls.at(-1).url.pathname, "/v2/albums");
  assert.equal(f.calls.at(-1).url.searchParams.get("filter[id]"), "12");
  assert.equal(f.calls.at(-1).url.searchParams.get("include"), "artists,coverArt");
});
test("Spotify and Qobuz collection search retain approved catalog cover URLs", async () => {
  const spotifyId = "S".repeat(22), spotifyDisk = storage({
    "accord-music-service-v1": "spotify", "accord-spotify-client-id": "spotify-client",
    "accord-spotify-token-client-id": "spotify-client", "accord-spotify-access-token": "spotify-token",
    "accord-spotify-token-expires": String(Date.now() + 3600000),
  });
  const spotify = createCollectionServices({ storage: spotifyDisk, session: storage(), pageUrl: "https://example.test/pwa/",
    fetch: async (url) => {
      assert.match(url, /api\.spotify\.com\/v1\/search/);
      return reply({ albums: { items: [{ id: spotifyId, name: "Search Album", album_type: "album",
        artists: [{ name: "Test Artist" }], release_date: "2020-01-01",
        external_urls: { spotify: `https://open.spotify.com/album/${spotifyId}` },
        images: [{ url: "https://i.scdn.co/image/cover", width: 640 }] }] } });
    } });
  const spotifyAlbums = await spotify.search("Search Album");
  assert.equal(spotify.coverUrl(spotifyAlbums[0]), "https://i.scdn.co/image/cover");

  const qobuzDisk = storage({ "accord-music-service-v1": "qobuz",
    "accord-qobuz-session-v1": JSON.stringify({ appId: "qobuz-app", token: "qobuz-token" }) });
  const qobuz = createCollectionServices({ storage: qobuzDisk, session: storage(), pageUrl: "https://example.test/pwa/",
    fetch: async (url) => {
      assert.match(url, /www\.qobuz\.com\/api\.json\/0\.2\/album\/search/);
      return reply({ albums: { items: [{ id: 123, title: "Search Album", artist: { name: "Test Artist" },
        image: { large: "https://static.qobuz.com/images/cover.jpg" }, release_date_original: "2020-01-01" }],
      total: 1, offset: 0 } });
    } });
  const qobuzAlbums = await qobuz.search("Search Album");
  assert.equal(qobuz.coverUrl(qobuzAlbums[0]), "https://static.qobuz.com/images/cover.jpg");
});
test("TIDAL search authentication failures stop without extra calls or collection changes", async () => {
  const f = tidalSearchFixture(() => reply({}, 401));
  await assert.rejects(f.services.search("Search Album"), /TIDAL HTTP 401/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.disk.getItem(COLLECTION_KEY), null);
});
test("cancelling a TIDAL refresh does not save a late token or start a catalog request", async () => {
  const disk = storage({ "accord-music-service-v1": "tidal" });
  const saved = JSON.stringify({ clientId: "search-test-client", access_token: "expired-test-token",
    refresh_token: "test-refresh-token", expires: 1 });
  const session = storage({ "accord-tidal-token-v1": saved }), controller = new AbortController();
  let release, calls = 0;
  const services = createCollectionServices({ storage: disk, session, pageUrl: "https://example.test/pwa/",
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, "https://auth.tidal.com/v1/oauth2/token");
      assert.equal(options.method, "POST");
      return new Promise((resolve) => { release = resolve; });
    } });
  const pending = services.search("Search Album", { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  release(reply({ access_token: "late-test-token", expires_in: 3600 }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(disk.getItem("accord-tidal-token-v1"), saved);
  assert.equal(session.getItem("accord-tidal-token-v1"), null);
});
test("TIDAL search cancellation releases a queued browser lock and a subsequent search succeeds", async (t) => {
  const saved = Object.getOwnPropertyDescriptor(navigator, "locks");
  let blocked = true;
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: (_name, options, run) => blocked ? new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }) : run(),
  } });
  t.after(() => saved ? Object.defineProperty(navigator, "locks", saved) : delete navigator.locks);
  const f = tidalSearchFixture(), controller = new AbortController();
  const pending = f.services.search("Search Album", { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(f.calls.length, 0);
  blocked = false;
  assert.equal((await f.services.search("Search Album"))[0].id, "tidal:12");
});
test("the 45-second search deadline covers both a stalled fetch and a stalled JSON body", async (t) => {
  const originalTimeout = AbortSignal.timeout;
  for (const stage of ["fetch", "body"]) {
    const deadline = new AbortController(), durations = [];
    const mock = t.mock.method(AbortSignal, "timeout", (duration) => {
      if (duration !== 45_000) return originalTimeout(duration);
      durations.push(duration); return deadline.signal;
    });
    let release;
    const f = tidalSearchFixture((_call, document) => stage === "fetch"
      ? new Promise((resolve) => { release = () => resolve(reply(document)); })
      : { ok: true, status: 200, headers: new Headers(), json: () => new Promise((resolve) => { release = () => resolve(document); }) });
    const before = f.disk.getItem("accord-tidal-token-v1");
    const pending = f.services.search("Search Album");
    await new Promise((resolve) => setImmediate(resolve));
    deadline.abort(new DOMException("Search deadline", "TimeoutError"));
    await assert.rejects(pending, { name: "TimeoutError" });
    release();
    assert.deepEqual(durations, [45_000]);
    assert.equal(f.calls.length, 1);
    assert.equal(f.disk.getItem("accord-tidal-token-v1"), before);
    assert.equal(f.disk.getItem(COLLECTION_KEY), null);
    mock.mock.restore();
  }
});
test("TIDAL version distinguishes live recordings even when Live is part of the studio title", () => {
  const records = tidalAlbumRecords([{ data: { type: "albums", id: "12",
    attributes: { title: "Live It Up", version: "Live", releaseDate: "1993-01-01" },
    relationships: { artists: { data: [{ type: "artists", id: "1" }] } } },
    included: [{ type: "artists", id: "1", attributes: { name: "Bjork" } }] }]);
  assert.equal(records[0].name, "Live It Up (Live)");
  assert.equal(findCollectionAlbum([album(undefined, { name: "Live It Up" })], records[0]), null);
});
test("TIDAL callback rejects a changed Client ID before exchanging or saving a token", async () => {
  const session = storage(), auth = createTidalAuth({ session, transport: {
    token: () => assert.fail("No token exchange for a changed Client ID") } });
  const redirect = "https://example.test/pwa/", authorization = new URL(await auth.authorize("first-client", redirect));
  const callback = new URL(redirect);
  callback.searchParams.set("state", authorization.searchParams.get("state"));
  callback.searchParams.set("code", "synthetic-code");
  await assert.rejects(auth.finish(callback.href, "changed-client"), /OAuth/);
  assert.equal(session.getItem("accord-tidal-token-v1"), null);
  assert.equal(session.getItem("accord-tidal-pkce-v1"), null);
});
test("disconnect during TIDAL refresh cannot resurrect tokens", async () => {
  const session = storage({ "accord-tidal-token-v1": JSON.stringify({ clientId: "client",
    access_token: "old", refresh_token: "refresh", expires: 1 }) });
  let resolve;
  const auth = createTidalAuth({ session, transport: { clear() {}, token: () => new Promise((done) => { resolve = done; }) } });
  const pending = auth.access("client"); auth.disconnect();
  resolve({ access_token: "new", expires_in: 3600 });
  await assert.rejects(pending, /Accesso TIDAL cambiato/);
  assert.equal(session.getItem("accord-tidal-token-v1"), null);
});
test("large GitHub collections use authenticated raw reads and reject a changed revision", async () => {
  const a = album(), disk = local([a]), store = createCollectionStore(disk);
  let revision = "first", rawReads = 0;
  const request = async (url, options) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer synthetic-test-token");
    if (!url.includes("albums.json")) return reply({ private: true, default_branch: "main" });
    if (options.headers.Accept.includes("raw")) {
      rawReads++;
      return reply({ format: "accord-album-collection", version: 4, albums: [a] });
    }
    return reply({ type: "file", sha: revision, encoding: "none", content: "" });
  };
  const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: request });
  assert.equal((await sync.checkAddition(a)).album.id, a.id);
  assert.equal(rawReads, 1);
  const changed = createCollectionSync({ storage: disk, store, covers: coverCache,
    fetch: async (url, options) => {
      const response = await request(url, options);
      if (options.headers.Accept.includes("raw")) revision = "changed";
      return response;
    } });
  await assert.rejects(changed.checkAddition(a), /cambiato durante la lettura/);
});
test("note conflicts are archived before a cancelled choice and failed archival prevents writes", async () => {
  const base = album(undefined, { notes: "Base review" }), device = { ...base, notes: "Device review" };
  const disk = local([device], [base]), store = createCollectionStore(disk), before = store.state;
  const remote = github([{ ...base, notes: "GitHub review" }]);
  const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request });
  assert.equal(await sync.sync({ chooseConflicts: async () => {
    const versions = JSON.parse(disk.getItem("accord-album-note-conflicts-v1"));
    assert.equal(versions[0].device.value, "Device review");
    assert.equal(versions[0].github.value, "GitHub review");
    return null;
  }, confirm: () => assert.fail("Cancelled before confirmation") }), false);
  assert.equal(store.state, before);
  assert.equal(remote.writes.length, 0);
  disk.removeItem("accord-album-note-conflicts-v1");
  disk.setItem = () => { throw new Error("Quota exceeded"); };
  await assert.rejects(sync.sync({ chooseConflicts: () => assert.fail("Archive must succeed first"),
    confirm: () => assert.fail("No confirmation after archive failure") }), /Quota/);
  assert.equal(remote.writes.length, 0);
});
test("the collection exposes exactly the canonical listening states", () => {
  const app = readFileSync(new URL("collection-app.mjs", import.meta.url), "utf8");
  const states = app.match(/const states = \{([\s\S]*?)\};/)[1];
  assert.deepEqual([...states.matchAll(/(\w+):/g)].map((match) => match[1]).sort(), [...ALBUM_STATES].sort());
  const html = readFileSync(new URL("index.html", import.meta.url), "utf8");
  const filter = html.match(/id="statusFilter"([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...filter.matchAll(/value="([^"]+)"/g)].map((match) => match[1]).sort(), [...ALBUM_STATES].sort());
  for (const status of ALBUM_STATES) {
    const a = album(), store = createCollectionStore(local([a]));
    store.update(a.id, { status });
    assert.equal(store.state.albums[0].status, status);
  }
});
test("the active shell contains only collection workflows and precaches its complete module graph", () => {
  const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
  const html = read("index.html"), app = read("collection-app.mjs"), sw = read("sw.js");
  assert.match(html, /collection-app\.mjs\?v=5/);
  assert.doesNotMatch(html, /suggestionsPanel|playlistBuilderPanel|backupDialog|auditDialog|app\.mjs\?v=124/);
  assert.match(html, /id="duplicates"/); assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html.match(/<header[\s\S]*?<\/header>/)[0], /id="duplicates"/);
  assert.match(html, /class="brand"[\s\S]*accord-192\.png/);
  assert.match(html, /class="app-version" id="version">App attiva v1\.29\.4/);
  assert.match(read("collection.css"), /--accent: #c3b0ff/);
  for (const [, id] of app.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(html.includes(`id="${id}"`), `Missing active control ${id}`);
  const modules = ["collection-app.mjs", "collection-store.mjs", "collection-sync.mjs", "collection-services.mjs", "core.mjs", "tidal.mjs", "qobuz.mjs", "music-app-links.mjs", "service-requests.mjs"];
  for (const file of modules) for (const [, dependency] of read(file).matchAll(/(?:from\s+|import\()["']\.\/([^"']+)["']/g)) {
    assert.ok(sw.includes(`"./${dependency}"`), `Offline dependency missing: ${dependency}`);
  }
  assert.doesNotMatch(sw, /tidal-ui\.mjs|playlist-ui\.mjs|suggestions-ui\.mjs|music-completion-ui\.mjs/);
});
