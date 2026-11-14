import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { ALBUM_STATES, validateAlbum, findCollectionAlbum, addPlaylistAlbums, threeWayMerge, encodeCoverArchive } from "./core.mjs";
import { createCollectionStore, duplicateCollectionGroups, COLLECTION_KEY } from "./collection-store.mjs";
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
function github(records, { failPut = false, mutateBeforePut, coverArchive } = {}) {
  const writes = [], reads = [];
  const request = async (url, options = {}) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    if (options.method === "PUT") {
      writes.push({ url, payload: JSON.parse(options.body) });
      if (mutateBeforePut) mutateBeforePut();
      if (failPut) throw new Error("Disconnected");
      return reply({ content: { sha: "next" }, commit: { sha: "commit" } });
    }
    reads.push(url);
    if (/covers\.bin/.test(url)) {
      if (!coverArchive) return reply({}, 404);
      return options.headers.Accept.includes("raw") ? new Response(coverArchive) : reply({ type: "file", sha: "covers" });
    }
    if (/albums\.json/.test(url)) return reply({ type: "file", sha: "albums",
      content: Buffer.from(JSON.stringify({ format: "accord-album-collection", version: 4, albums: records, deletion_sync: true })).toString("base64") });
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
  assert.match(html, /collection-app\.mjs\?v=1/);
  assert.doesNotMatch(html, /suggestionsPanel|playlistBuilderPanel|backupDialog|auditDialog|app\.mjs\?v=124/);
  assert.match(html, /id="duplicates"/); assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html.match(/<header[\s\S]*?<\/header>/)[0], /id="duplicates"/);
  assert.match(html, /class="brand"[\s\S]*accord-192\.png/);
  assert.match(html, /class="app-version" id="version">App attiva v1\.29\.0/);
  assert.match(read("collection.css"), /--accent: #c3b0ff/);
  for (const [, id] of app.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(html.includes(`id="${id}"`), `Missing active control ${id}`);
  const modules = ["collection-app.mjs", "collection-store.mjs", "collection-sync.mjs", "collection-services.mjs", "core.mjs", "tidal.mjs", "qobuz.mjs", "music-app-links.mjs", "service-requests.mjs"];
  for (const file of modules) for (const [, dependency] of read(file).matchAll(/(?:from\s+|import\()["']\.\/([^"']+)["']/g)) {
    assert.ok(sw.includes(`"./${dependency}"`), `Offline dependency missing: ${dependency}`);
  }
  assert.doesNotMatch(sw, /tidal-ui\.mjs|playlist-ui\.mjs|suggestions-ui\.mjs|music-completion-ui\.mjs/);
});
