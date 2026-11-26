import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import { ALBUM_STATES, validateAlbum, findCollectionAlbum, addPlaylistAlbums, threeWayMerge, encodeCoverArchive } from "./core.mjs";
import { createCollectionStore, duplicateCollectionGroups, suggestDuplicateMerge, COLLECTION_KEY } from "./collection-store.mjs";
import { recentCatalogSearches, rememberCatalogSearch, clearCatalogSearches, catalogSearchCorrections,
  filteredCollection, collectionGenres, collectionRows, collectionAnomalies, catalogSearchInput, catalogSearchFields } from "./collection-qol.mjs";
import { createCollectionSync } from "./collection-sync.mjs";
import { createCollectionServices } from "./collection-services.mjs";
import { createTidalAuth, tidalAlbumRecords } from "./tidal.mjs";
import { albumSearchMatch, shortReleaseKind } from "./music-suggestion-filters.mjs";
import { setEditionLink } from "./music-continuity.mjs";
import { durationProvenanceText, COMPLETION_PROVENANCE_KEY } from "./music-completion.mjs";
import { createPhysicalStore, PHYSICAL_KEY } from "./physical-collection.mjs";
globalThis.crypto ||= webcrypto;

test("album search keeps separate criteria, accepts either text field and recalls legacy queries", () => {
  const empty = { artist: "", title: "", reference: "" };
  const disk = storage();
  rememberCatalogSearch(disk, "tidal", "Artist Title");
  rememberCatalogSearch(disk, "tidal", "https://tidal.com/browse/album/123");
  const separate = { ...empty, artist: " Artist ", title: "Title" };
  const { criteria, query, reference } = catalogSearchInput("tidal", separate);
  assert.equal(query, "Artist Title");
  assert.equal(reference, false);
  rememberCatalogSearch(disk, "tidal", criteria);
  assert.deepEqual(recentCatalogSearches(disk, "tidal").map((value) => catalogSearchFields("tidal", value)),
    [{ ...empty, artist: "Artist", title: "Title" }, { ...empty, reference: "https://tidal.com/browse/album/123" },
      { ...empty, title: "Artist Title" }]);
  assert.equal(catalogSearchInput("spotify", { ...empty, artist: "Artist" }).query, "Artist");
  assert.deepEqual(catalogSearchInput("tidal", { ...empty, title: "1989" }),
    { criteria: { ...empty, title: "1989" }, query: "1989", reference: false });
  assert.equal(catalogSearchInput("qobuz", { ...empty, reference: "00123" }).reference, true);
  assert.throws(() => catalogSearchInput("qobuz", { ...empty, reference: "not a link" }), /catalogo selezionato/);
  assert.throws(() => catalogSearchInput("tidal", { ...empty, artist: "Artist", reference: "123" }), /non entrambi/);
  assert.throws(() => catalogSearchInput("spotify", empty), /Inserisci/);
});
test("catalog recall is isolated, bounded and never changes collection or credentials", () => {
  const disk = storage({ [COLLECTION_KEY]: "unchanged", token: "synthetic-only" });
  for (let index = 0; index < 25; index++) rememberCatalogSearch(disk, "tidal", `Album ${index}`);
  rememberCatalogSearch(disk, "spotify", "Another");
  rememberCatalogSearch(disk, "tidal", "album 24");
  assert.equal(recentCatalogSearches(disk, "tidal").length, 20);
  assert.equal(recentCatalogSearches(disk, "tidal")[0], "album 24");
  assert.deepEqual(recentCatalogSearches(disk, "spotify"), ["Another"]);
  clearCatalogSearches(disk, "tidal");
  assert.deepEqual(recentCatalogSearches(disk, "tidal"), []);
  assert.deepEqual(recentCatalogSearches(disk, "spotify"), ["Another"]);
  assert.equal(disk.getItem(COLLECTION_KEY), "unchanged");
  assert.equal(disk.getItem("token"), "synthetic-only");
  disk.setItem("accord-catalog-searches-v1", "{bad");
  assert.throws(() => rememberCatalogSearch(disk, "tidal", "Do not overwrite"));
  assert.equal(disk.getItem("accord-catalog-searches-v1"), "{bad");
});
test("corrections only propose close local names and ignore URLs and identifiers", () => {
  assert.deepEqual(catalogSearchCorrections("Master of Pupets", ["Master of Puppets", "Unrelated"]), ["Master of Puppets"]);
  assert.deepEqual(catalogSearchCorrections("https://example.test/album", ["Another"]), []);
  assert.deepEqual(catalogSearchCorrections("A".repeat(22), ["A".repeat(21) + "B"]), []);
  assert.deepEqual(catalogSearchCorrections("Master of Puppets", ["Master of Puppets"]), []);
});
test("review snapshots retain original filtered IDs and anomalies do not modify metadata", () => {
  const records = [album("A".repeat(22), { name: "One" }), album("B".repeat(22), { name: "Two", year: "", genres: ["Rock"] }),
    album("C".repeat(22), { name: "Three", status: "liked" })];
  const before = structuredClone(records), ids = filteredCollection(records, { status: "queued" }).map(({ id }) => id);
  const issues = collectionAnomalies(records, { [records[0].id]: 999999999, [records[1].id]: 180000 });
  assert.ok(issues.some(({ id, reason }) => id === records[0].id && reason.includes("insolita")));
  assert.ok(issues.some(({ id, reason }) => id === records[1].id && reason.includes("Anno")));
  assert.deepEqual(records, before);
  records[0].status = "liked";
  assert.deepEqual(ids, [records[0].id, records[1].id]);
  assert.deepEqual(filteredCollection(records, { status: "queued", favoritesOnly: true, favoriteIds: [records[1].id] })
    .map(({ id }) => id), [records[1].id]);
});
test("genre choices and filters include all saved genres and combine with listening state and favorites", () => {
  const records = [
    album("A".repeat(22), { genres: ["Metal", "Progressive"], status: "liked" }),
    album("B".repeat(22), { genres: ["metal", "Rock"], status: "queued" }),
    album("C".repeat(22), { genres: [], status: "liked" }),
  ];
  assert.deepEqual(collectionGenres(records).map(([key]) => key), ["metal", "progressive", "rock"]);
  const ids = (filters) => filteredCollection(records, filters).map(({ id }) => id);
  assert.deepEqual(ids({ genre: "g:metal" }), [records[0].id, records[1].id]);
  assert.deepEqual(ids({ genre: "g:progressive", query: "Debut", status: "liked", favoritesOnly: true,
    favoriteIds: [records[0].id] }), [records[0].id]);
  assert.deepEqual(ids({ genre: "g:metal", status: "queued", favoritesOnly: true,
    favoriteIds: [records[0].id] }), []);
  assert.deepEqual(ids({ genre: "none" }), [records[2].id]);
  assert.deepEqual(ids({ genre: "g:missing" }), []);
});

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

test("unified collection joins owned albums before filtering and includes physical-only titles once", () => {
  const music = album(undefined, { genres: ["Pop", "Electronic"], rating: 4 });
  const owned = [
    { artist: "Björk", title: "Debut (Deluxe Edition)", cd: true, vinyl: true },
    { artist: "Nina Simone", title: "Pastel Blues", cd: false, vinyl: true },
    { artist: "Other", title: "Previously Owned", cd: false, vinyl: false },
  ];
  const names = (filters) => collectionRows([music], owned, filters).visible.map(({ name }) => name);
  assert.equal(collectionRows([music], owned).total, 2);
  assert.deepEqual(names({ format: "both", genre: "g:electronic", query: "debut", favoritesOnly: true, favoriteIds: [music.id] }), ["Debut"]);
  assert.deepEqual(names({ format: "vinyl", genre: "none" }), ["Pastel Blues"]);
  assert.deepEqual(names({ format: "vinyl", status: "queued" }), ["Debut"]);
  assert.deepEqual(names({ format: "none" }), []);
  assert.deepEqual(collectionRows([], owned, { format: "cd" }).visible.map(({ name }) => name), ["Debut (Deluxe Edition)"]);
  assert.equal(music.rating, 4);
});

test("unified local state adopts legacy support bases and keeps the recovery copy intact", () => {
  const disk = storage();
  const old = createPhysicalStore(disk);
  old.addMany([{ artist: "Björk", title: "Debut", cd: true, vinyl: true }]);
  old.commitSync(old.state.records, "owner", "saved-sha");
  const previous = disk.getItem(PHYSICAL_KEY);
  const store = createCollectionStore(disk);
  assert.equal(store.state.physicalSha, "saved-sha");
  assert.equal(store.state.physicalOwner, "owner");
  assert.equal(store.pendingChanges(), 0);
  store.setPhysicalFormat("Bjork", "Debut", "cd", false);
  assert.equal(store.pendingChanges(), 1);
  assert.equal(disk.getItem(PHYSICAL_KEY), previous);
  assert.deepEqual(createCollectionStore(disk).state.physical, [{ artist: "Björk", title: "Debut", cd: false, vinyl: true }]);
  assert.equal(createCollectionStore(disk).state.physicalBase[0].cd, true);
  disk.setItem("accord-library-sync-pending-v1", "{}");
  assert.throws(() => store.setPhysicalFormat("Bjork", "Debut", "cd", true), /Completa la verifica/);
  assert.equal(store.state.physical[0].cd, false);
});
const local = (records, base = records, extras = {}) => storage({ [COLLECTION_KEY]: JSON.stringify({ albums: records, base, ...extras }),
  "accord-album-owner": "owner", "accord-album-token": "synthetic-test-token" });
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status });
test("duplicate evidence distinguishes native IDs, verified links and normalized title matches", () => {
  const saved = album(), alias = album("tidal:42", { artist: "BJÖRK", name: "Debut (Deluxe Edition)" });
  assert.match(findCollectionAlbum([saved], saved).reason, /Stesso ID/);
  assert.match(findCollectionAlbum([saved], alias).reason, /normalizzazione/);
  const links = { [saved.id]: { tidal: { id: alias.id, source: JSON.stringify([saved.id, saved.artist, saved.name]) } } };
  assert.match(findCollectionAlbum([saved], alias, links).reason, /Associazione/);
  links[saved.id].tidal.source = "stale";
  assert.match(findCollectionAlbum([saved], alias, links).reason, /normalizzazione/);
});

test("collection duration provenance is saved atomically, is readable, and cannot survive a changed synced value", () => {
  const saved = album(), disk = local([saved]), store = createCollectionStore(disk);
  const duration = 180001, provenance = { source: "spotify", target: saved.id,
    identity: [saved.id, saved.artist, saved.name], duration_ms: duration, complete_tracks: 12, updated: "2026-11-17T10:00:00" };
  assert.equal(store.saveMissingDuration(saved, duration, provenance), true);
  const text = durationProvenanceText(disk, saved, duration);
  assert.match(text, /Spotify/); assert.match(text, /3:00/); assert.match(text, /12/);
  assert.match(durationProvenanceText(disk, { ...saved, name: "Changed" }, duration), /storica/);
  assert.equal(store.saveMissingDuration(saved, 999999, { ...provenance, duration_ms: 999999 }), false);
  const snapshot = store.durationSnapshot();
  store.commitSync(store.state, snapshot, [{ id: saved.id, duration_ms: 200000 }]);
  assert.equal(JSON.parse(disk.getItem(COMPLETION_PROVENANCE_KEY))[saved.id].duration, undefined);
  assert.match(durationProvenanceText(disk, saved, 200000), /non disponibile/);
});

test("failure saving provenance rolls back the duration without mutating album data", () => {
  const saved = album(), disk = local([saved]), store = createCollectionStore(disk);
  const previous = disk.getItem(COLLECTION_KEY), write = disk.setItem;
  disk.setItem = (key, value) => {
    if (key === COMPLETION_PROVENANCE_KEY) throw new Error("quota");
    write(key, value);
  };
  assert.throws(() => store.saveMissingDuration(saved, 12345), /quota/);
  assert.deepEqual(store.durations(), {});
  assert.equal(disk.getItem(COLLECTION_KEY), previous);
  assert.equal(disk.getItem(COMPLETION_PROVENANCE_KEY), null);
});

function github(records, { failPut = false, putReply, mutateBeforePut, coverArchive, deletedAlbums = [], deletionHistory = true, durations = null } = {}) {
  const writes = [], reads = [], committed = new Map();
  const request = async (url, options = {}) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
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
      if (new URL(url).pathname.endsWith("/durations.json")) {
        durations = JSON.parse(Buffer.from(writes.at(-1).payload.content, "base64").toString()).albums;
      }
      const file = new URL(url).pathname.split("/").at(-1);
      const bytes = Buffer.from(writes.at(-1).payload.content, "base64");
      const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      committed.set(file, { bytes, sha });
      if (putReply) return putReply(file);
      return reply({ content: { sha: "next" }, commit: { sha: "commit" } });
    }
    reads.push(url);
    const stored = committed.get(new URL(url).pathname.split("/").at(-1));
    if (stored) return options.headers.Accept.includes("raw") ? new Response(stored.bytes)
      : reply({ type: "file", sha: stored.sha, encoding: "base64", content: stored.bytes.toString("base64") });
    if (/durations\.json/.test(url)) {
      if (durations === null) return reply({}, 404);
      return reply({ type: "file", sha: "durations", content: Buffer.from(JSON.stringify(
        { format: "accord-album-durations", version: 1, albums: durations })).toString("base64") });
    }
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

test("short releases use provider types and mark Spotify track-count estimates", () => {
  const spotify = { id: "A".repeat(22), album_type: "single", total_tracks: 4 };
  assert.deepEqual(shortReleaseKind(spotify), { kind: "ep", estimated: true });
  assert.equal(albumSearchMatch(spotify, { includeEp: false }), false);
  assert.deepEqual(shortReleaseKind({ ...spotify, total_tracks: 2 }), { kind: "single", estimated: true });
  assert.deepEqual(shortReleaseKind({ id: "tidal:1", album_type: "single" }), { kind: "single", estimated: false });
  assert.equal(albumSearchMatch({ ...spotify, total_tracks: 0 }, { includeSingle: false, includeEp: true }), true);
});

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
test("duration reads preserve existing values and refuse a changed or removed album", () => {
  const saved = album(), disk = local([saved]), store = createCollectionStore(disk);
  assert.equal(store.saveMissingDuration(saved, 120001), true);
  assert.equal(store.durations()[saved.id], 120001);
  assert.equal(store.saveMissingDuration(saved, 42), false);
  assert.equal(store.durations()[saved.id], 120001);
  store.remove([saved.id]);
  assert.throws(() => store.saveMissingDuration(saved, 30), /cambiato/);
});
test("pending sync count deduplicates album and duration changes by album", () => {
  const saved = album(), added = album("B".repeat(22), { name: "Another" });
  const disk = local([saved]), store = createCollectionStore(disk);
  assert.equal(store.pendingChanges(), 0);
  store.saveMissingDuration(saved, 120001);
  assert.equal(store.pendingChanges(), 1);
  store.update(saved.id, { rating: 4 });
  assert.equal(store.pendingChanges(), 1);
  store.add(added);
  assert.equal(store.pendingChanges(), 2);
  store.remove([saved.id]);
  assert.equal(store.pendingChanges(), 2);
});
test("adding a catalog album saves physical formats atomically and duplicate detection does not write", () => {
  const disk = local([]), store = createCollectionStore(disk);
  const saved = album();
  assert.equal(store.add(saved, { physical: { cd: true, vinyl: false } }), null);
  assert.deepEqual(store.state.albums, [saved]);
  assert.deepEqual(store.state.physical, [{ artist: saved.artist, title: saved.name, cd: true, vinyl: false }]);

  const edition = album("tidal:42", { artist: "Björk", name: "Debut (Deluxe Edition)" });
  const before = store.state;
  const found = store.add(edition, { physical: { cd: false, vinyl: true } });
  assert.equal(found.album.id, saved.id);
  assert.equal(store.state, before);
  assert.equal(store.state.albums.length, 1);
  assert.equal(store.state.albums[0].year, saved.year);
  assert.deepEqual(store.state.physical, [{ artist: saved.artist, title: saved.name, cd: true, vinyl: false }]);
});
test("explicitly keeping a verified duplicate records formats on the existing album identity", () => {
  const saved = album(), candidate = album(saved.id, { name: "Debut (Deluxe Edition)" });
  const store = createCollectionStore(local([saved])), before = store.state;
  const found = store.duplicate(candidate);
  assert.equal(found.confidence, "verified");
  assert.equal(found.album.name, saved.name);
  assert.equal(store.add(candidate, { physical: { cd: true, vinyl: true } }).album.id, saved.id);
  assert.equal(store.state, before);
  assert.deepEqual(store.state.physical, []);

  store.addPhysical([{ artist: found.album.artist, title: found.album.name, cd: true, vinyl: true }]);
  assert.deepEqual(store.state.physical, [
    { artist: saved.artist, title: saved.name, cd: true, vinyl: true },
  ]);
});
test("uncertain duplicate cancellation leaves formats unchanged; confirming a distinct edition applies them", () => {
  const saved = album(), candidate = album("tidal:42", { year: "2011" });
  const store = createCollectionStore(local([saved])), before = store.state;
  assert.equal(store.duplicate(candidate).confidence, "uncertain");
  assert.equal(store.add(candidate, { physical: { cd: true, vinyl: false } }).confidence, "uncertain");
  assert.equal(store.state, before);
  assert.deepEqual(store.state.physical, []);

  assert.equal(store.add(candidate, { distinct: true, physical: { cd: true, vinyl: false } }), null);
  assert.equal(store.state.albums.length, 2);
  assert.deepEqual(store.state.physical, [{ artist: candidate.artist, title: candidate.name, cd: true, vinyl: false }]);
});
test("confirmed replacement applies physical formats only to the replacement", () => {
  const saved = album(), replacement = album("tidal:42", { name: "Debut (Deluxe Edition)" });
  const store = createCollectionStore(local([saved]));
  assert.equal(store.add(replacement, { replaceId: saved.id, physical: { cd: false, vinyl: true } }), null);
  assert.deepEqual(store.state.albums, [replacement]);
  assert.deepEqual(store.state.pendingRemovals, [saved]);
  assert.deepEqual(store.state.physical, [{ artist: replacement.artist, title: replacement.name, cd: false, vinyl: true }]);
});
test("catalog duplicate comparison gates format writes on explicit resolution", () => {
  const app = readFileSync(new URL("collection-app.mjs", import.meta.url), "utf8");
  const start = app.indexOf("async function compareCandidate("), end = app.indexOf("\nfunction showDuplicates", start);
  assert.ok(start >= 0 && end > start);
  const compare = app.slice(start, end);
  const decision = compare.indexOf('const answer = await choice("Confronta prima di aggiungere"');
  const keepGate = compare.indexOf('actions.push(["keep", keepLabel])');
  const keepWrite = compare.indexOf("store.addPhysical([{ artist: found.album.artist");
  const cancelGate = compare.indexOf('actions.push(["cancel", "Annulla senza modifiche"])');
  const coverWrite = compare.indexOf("await cacheCatalogCover(found.album.id, candidate.id)");
  const replaceGate = compare.indexOf('if (confirmed === "replace")');
  const replaceWrite = compare.indexOf("store.add(candidate, { replaceId: found.album.id, physical })");
  const distinctGate = compare.indexOf('else if (answer === "distinct")');
  const distinctWrite = compare.indexOf("store.add(candidate, { distinct: true, physical })");
  assert.ok(decision >= 0 && keepGate >= 0 && keepGate < decision && decision < keepWrite && decision < coverWrite);
  assert.ok(cancelGate >= 0 && cancelGate < decision);
  assert.match(compare, /if \(found\.confidence !== "uncertain"\)/);
  assert.ok(decision < replaceGate && replaceGate < replaceWrite);
  assert.ok(distinctGate > decision && distinctGate < distinctWrite);
  assert.match(compare, /Confronto annullato senza modifiche: i formati selezionati non sono stati registrati/);
});
test("failed combined album and physical-format persistence leaves both unchanged", () => {
  const disk = local([]), store = createCollectionStore(disk), before = store.state;
  disk.setItem = () => { throw new Error("Quota exceeded"); };
  assert.throws(() => store.add(album(), { physical: { cd: true, vinyl: false } }), /Quota/);
  assert.equal(store.state, before);
  assert.deepEqual(store.state.albums, []);
  assert.deepEqual(store.state.physical, []);
});
test("durations synchronize across devices and include legacy queue values", async () => {
  const saved = album(), disk = local([saved]), first = createCollectionStore(disk), remote = github([saved]);
  disk.setItem("accord-listening-queue-v1", JSON.stringify({ durations: { [saved.id]: 123000 } }));
  const options = { chooseConflicts: () => assert.fail("Unexpected conflict"), confirm: async (preview) => {
    assert.ok(preview.durationOutgoing.length || preview.durationIncoming.length); return true;
  } };
  await createCollectionSync({ storage: disk, store: first, covers: coverCache, fetch: remote.request }).sync(options);
  const secondDisk = local([saved]), second = createCollectionStore(secondDisk);
  await createCollectionSync({ storage: secondDisk, store: second, covers: coverCache, fetch: remote.request }).sync(options);
  assert.equal(second.durations()[saved.id], 123000);
  secondDisk.setItem("accord-listening-album-durations-v1", JSON.stringify({ [saved.id]: 222000 }));
  await createCollectionSync({ storage: secondDisk, store: second, covers: coverCache, fetch: remote.request }).sync(options);
  await createCollectionSync({ storage: disk, store: first, covers: coverCache, fetch: remote.request }).sync(options);
  assert.equal(first.durations()[saved.id], 222000);
});
test("different durations require a choice and never overwrite a concurrent local change", async () => {
  const saved = album(), disk = local([saved]);
  disk.setItem("accord-listening-album-durations-v1", JSON.stringify({ [saved.id]: 100000 }));
  const store = createCollectionStore(disk);
  const remoteRow = Object.fromEntries(["id", "artist", "name", "url", "year"].map((key) => [key, saved[key]]));
  const remote = github([saved], { durations: [{ ...remoteRow, duration_ms: 200000 }] });
  const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request });
  assert.equal(await sync.sync({ chooseConflicts: async (conflicts) => {
    assert.equal(conflicts[0].fields[0].field, "duration_ms"); return null;
  }, confirm: () => assert.fail("Cancelled") }), false);
  assert.equal(store.durations()[saved.id], 100000);
  await assert.rejects(sync.sync({ chooseConflicts: async () => ({ [saved.id]: { duration_ms: "remote" } }),
    confirm: async () => { disk.setItem("accord-listening-album-durations-v1", JSON.stringify({ [saved.id]: 300000 })); return true; } }),
  /durate o la coda sono cambiate/);
  assert.equal(store.durations()[saved.id], 300000);
  assert.equal(remote.writes.length, 0);
  await sync.sync({ chooseConflicts: async () => ({ [saved.id]: { duration_ms: "remote" } }), confirm: async () => true });
  assert.equal(store.durations()[saved.id], 200000);
});
test("duration sidecar survives album removal and restoring the same edition", async () => {
  const saved = album(), disk = local([saved]), store = createCollectionStore(disk), remote = github([saved]);
  store.saveMissingDuration(saved, 123000);
  const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request });
  const options = { chooseConflicts: () => assert.fail("Unexpected conflict"), confirm: async () => true };
  await sync.sync(options);
  store.remove([saved.id]);
  await sync.sync(options);
  store.add(saved);
  await sync.sync(options);
  assert.equal(store.durations()[saved.id], 123000);
});
test("duration write failure leaves the local base and values unchanged", async () => {
  const saved = album(), disk = local([saved]), store = createCollectionStore(disk), remote = github([saved], { failPut: true });
  store.saveMissingDuration(saved, 123000);
  await assert.rejects(createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request })
    .sync({ chooseConflicts: () => assert.fail(), confirm: async () => true }), /incerto/);
  assert.equal(store.durations()[saved.id], 123000);
  assert.equal(store.state.durationBase, undefined);
  assert.equal(remote.writes.length, 1);
});
test("lost responses to cover, album and duration uploads are verified without another PUT", async (t) => {
  const image = new Uint8Array([0xff, 0xd8, 0xff, 1]);
  const saved = album(undefined, { cover_sha256: createHash("sha256").update(image).digest("hex") });
  const disk = local([saved], []), store = createCollectionStore(disk), messages = [], timeouts = [];
  store.saveMissingDuration(saved, 123000);
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (milliseconds) => { timeouts.push(milliseconds); return timeout(milliseconds); });
  const remote = github([], { putReply: () => { throw new DOMException("Synthetic timeout", "TimeoutError"); } });
  const sync = createCollectionSync({ storage: disk, store,
    covers: { get: async () => image, put: async () => {} }, fetch: remote.request });
  const options = { chooseConflicts: () => assert.fail("Unexpected conflict"), confirm: async () => true,
    onProgress: (message) => messages.push(message) };
  assert.equal(await sync.sync(options), true);
  assert.deepEqual(remote.writes.map(({ url }) => new URL(url).pathname.split("/").at(-1)),
    ["covers.bin", "albums.json", "durations.json"]);
  assert.deepEqual(store.state.base, [saved]);
  assert.equal(store.state.durationBase.albums[0].duration_ms, 123000);
  assert.equal(timeouts.filter((value) => value === 120000).length, 3);
  assert.ok(timeouts.filter((value) => value === 30000).length > 3);
  assert.equal(messages.filter((message) => message.includes("sola lettura")).length, 3);
  await sync.sync(options);
  assert.equal(remote.writes.length, 3);
});
test("5xx, unreadable and incomplete upload responses recover only through matching remote content", async () => {
  for (const putReply of [() => reply({}, 503), () => new Response("{"), () => reply({ content: {} }),
    () => ({ ok: true, status: 200, json: async () => { throw new DOMException("Fetch is aborted", "AbortError"); } })]) {
    const saved = album(), disk = local([saved], []), store = createCollectionStore(disk);
    const remote = github([], { putReply });
    const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request });
    assert.equal(await sync.sync({ chooseConflicts: () => assert.fail(), confirm: async () => true }), true);
    assert.deepEqual(store.state.base, [saved]);
    assert.equal(remote.writes.length, 1);
  }
});
test("a download interrupted after response headers identifies the file without writing", async (t) => {
  const timeouts = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (ms) => { timeouts.push(ms); return timeout(ms); });
  for (const raw of [false, true]) {
    const saved = album(), disk = local([saved]), store = createCollectionStore(disk), before = store.state;
    const remote = github([saved], { coverArchive: new Uint8Array() }), messages = [];
    const request = async (url, options) => {
      if (url.includes("covers.bin") && options.headers.Accept.includes("raw") === raw) {
        const abort = async () => { throw new DOMException("Fetch is aborted", "AbortError"); };
        return { ok: true, status: 200, json: abort, arrayBuffer: abort };
      }
      return remote.request(url, options);
    };
    await assert.rejects(createCollectionSync({ storage: disk, store, covers: coverCache, fetch: request })
      .sync({ chooseConflicts: () => assert.fail(), confirm: () => assert.fail(), onProgress: (msg) => messages.push(msg) }),
    /Lettura GitHub di covers\.bin non completata.*Riprova Sincronizza/);
    assert.equal(timeouts.at(-1), raw ? 120_000 : 30_000);
    assert.equal(messages.some((msg) => msg.includes("Download GitHub: covers.bin")), raw);
    assert.equal(store.state, before);
    assert.equal(remote.writes.length, 0);
  }
});
test("a lost response never accepts a different remote blob or resends the upload", async () => {
  const saved = album(), disk = local([saved], []), store = createCollectionStore(disk), before = store.state;
  const remote = github([], { putReply: () => { throw new TypeError("Synthetic lost response"); } });
  const request = async (url, options) => {
    const response = await remote.request(url, options);
    if (options.method !== "PUT" && remote.writes.length && /albums\.json/.test(url)) {
      return reply({ ...(await response.json()), sha: "0".repeat(40) });
    }
    return response;
  };
  await assert.rejects(createCollectionSync({ storage: disk, store, covers: coverCache, fetch: request })
    .sync({ chooseConflicts: () => assert.fail(), confirm: async () => true }),
  (error) => /albums\.json/.test(error.message) && /non conferma/.test(error.message) && /Nessun invio ripetuto/.test(error.message));
  assert.equal(store.state, before);
  assert.equal(remote.writes.length, 1);
});
test("failed read-back or a changed account cannot confirm an uncertain upload", async () => {
  for (const changeAccount of [false, true]) {
    const saved = album(), disk = local([saved], []), store = createCollectionStore(disk), before = store.state;
    const remote = github([], { putReply: () => {
      if (changeAccount) disk.setItem("accord-album-owner", "different-owner");
      throw new TypeError("Synthetic lost response");
    } });
    let verificationReads = 0;
    const request = async (url, options) => {
      if (remote.writes.length) {
        verificationReads += 1;
        throw new TypeError("Synthetic read-back offline");
      }
      return remote.request(url, options);
    };
    await assert.rejects(createCollectionSync({ storage: disk, store, covers: coverCache, fetch: request })
      .sync({ chooseConflicts: () => assert.fail(), confirm: async () => true }), /Verifica in sola lettura non riuscita/);
    assert.equal(store.state, before);
    assert.equal(remote.writes.length, 1);
    assert.equal(verificationReads, changeAccount ? 0 : 1);
  }
});
test("uncertain upload marker survives reopening and verification is read-only", async () => {
  const saved = album(), disk = local([saved], []), store = createCollectionStore(disk), remote = github([]);
  let loseVerification = false;
  const request = async (url, options) => {
    if (options.method === "PUT") {
      const response = await remote.request(url, options);
      loseVerification = true;
      throw new TypeError("Synthetic lost response");
    }
    if (loseVerification && /albums\.json/.test(url)) {
      loseVerification = false;
      throw new TypeError("Synthetic read-back offline");
    }
    return remote.request(url, options);
  };
  const first = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: request });
  await assert.rejects(first.sync({ chooseConflicts: () => assert.fail(), confirm: async () => true }),
    /Verifica in sola lettura non riuscita/);
  assert.equal(remote.writes.length, 1);
  const marker = JSON.parse(disk.getItem("accord-album-sync-uncertain-v1"));
  assert.equal(marker.file, "albums.json");

  const reopened = createCollectionSync({ storage: disk, store: createCollectionStore(disk),
    covers: coverCache, fetch: request });
  assert.equal(reopened.uncertainWrite().blobSha, marker.blobSha);
  const writesBefore = remote.writes.length;
  const result = await reopened.verifyUncertainWrite();
  assert.deepEqual(result, { pending: true, verified: true, missing: false, file: "albums.json" });
  assert.equal(remote.writes.length, writesBefore);
  assert.equal(disk.getItem("accord-album-sync-uncertain-v1"), null);
});
test("a missing or different GitHub file unlocks a fresh sync without replaying the upload", async () => {
  for (const missing of [true, false]) {
    const saved = album(), disk = local([saved], []), store = createCollectionStore(disk), remote = github([]);
    const key = "accord-album-sync-uncertain-v1", before = store.state;
    disk.setItem(key, JSON.stringify({ owner: store.state.syncOwner || disk.getItem("accord-album-owner"),
      branch: "main", file: "albums.json", blobSha: "a".repeat(40) }));
    let checking = true;
    const methods = [];
    const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: (url, options) => {
      methods.push(options.method);
      if (checking) return reply(missing ? {} : { type: "file", sha: "b".repeat(40) }, missing ? 404 : 200);
      return remote.request(url, options);
    } });
    const callbacks = { chooseConflicts: () => assert.fail(), confirm: () => assert.fail() };
    await assert.rejects(sync.sync(callbacks), /Verifica su GitHub/);
    assert.deepEqual(await sync.verifyUncertainWrite(), { pending: true, verified: false, missing, file: "albums.json" });
    assert.deepEqual(methods, ["GET"]);
    assert.equal(disk.getItem(key), null);
    assert.equal(store.state, before);
    checking = false;
    assert.equal(await sync.sync({ ...callbacks, confirm: ({ albums, remote }) => {
      assert.deepEqual(albums, [saved]); assert.deepEqual(remote, []); return false;
    } }), false);
    assert.equal(remote.writes.length, 0);
    assert.equal(store.state, before);
  }
});
test("sync asks for confirmation even if only the cover archive needs uploading", async () => {
  const image = new Uint8Array([0xff, 0xd8, 0xff, 1]);
  const saved = album(undefined, { cover_sha256: createHash("sha256").update(image).digest("hex") });
  const disk = local([saved], [saved]), store = createCollectionStore(disk), remote = github([saved]);
  const sync = createCollectionSync({ storage: disk, store,
    covers: { get: async () => image, put: () => assert.fail("Cancelled") }, fetch: remote.request });
  let confirmed = false;
  assert.equal(await sync.sync({ chooseConflicts: () => assert.fail(), confirm: ({ coversOutgoing }) => {
    confirmed = true;
    assert.equal(coversOutgoing, true);
    return false;
  } }), false);
  assert.equal(confirmed, true);
  assert.equal(remote.writes.length, 0);
});
test("failed or invalid GitHub verification keeps the pending upload marker", async () => {
  const disk = local([album()], []), store = createCollectionStore(disk), key = "accord-album-sync-uncertain-v1";
  const marker = JSON.stringify({ owner: disk.getItem("accord-album-owner"),
    branch: "main", file: "albums.json", blobSha: "a".repeat(40) });
  disk.setItem(key, marker);
  for (const [status, message] of [[503, /HTTP 503/], [200, /metadati GitHub non validi/]]) {
    const sync = createCollectionSync({ storage: disk, store, covers: coverCache, fetch: (url, options) => {
      assert.equal(options.method, "GET"); return reply({}, status);
    } });
    await assert.rejects(sync.verifyUncertainWrite(), message);
    assert.equal(disk.getItem(key), marker);
  }
});
test("conflicts and server-imposed waits never trigger recovery reads or retries", async () => {
  for (const [status, headers] of [[409, {}], [503, { "Retry-After": "60" }], [502, { "X-RateLimit-Remaining": "0" }]]) {
    const saved = album(), disk = local([saved], []), store = createCollectionStore(disk), before = store.state;
    const remote = github([]), calls = [];
    let recoveryReads = 0;
    const request = async (url, options) => {
      if (calls.length) { recoveryReads += 1; throw new TypeError("Unexpected recovery request"); }
      if (options.method === "PUT") { calls.push(url); return new Response("{}", { status, headers }); }
      return remote.request(url, options);
    };
    await assert.rejects(createCollectionSync({ storage: disk, store, covers: coverCache, fetch: request })
      .sync({ chooseConflicts: () => assert.fail(), confirm: async () => true }),
    new RegExp(`albums\\.json: GitHub HTTP ${status}`));
    assert.equal(store.state, before);
    assert.equal(calls.length, 1);
    assert.equal(recoveryReads, 0);
  }
});
test("an edit in the same tab during a lost response is preserved without advancing the sync base", async () => {
  const saved = album(), disk = local([saved], []), store = createCollectionStore(disk);
  const remote = github([], { putReply: () => {
    store.update(saved.id, { notes: "Changed while sending" });
    throw new TypeError("Synthetic lost response");
  } });
  let recoveryReads = 0;
  const request = async (url, options) => {
    if (remote.writes.length) { recoveryReads += 1; throw new TypeError("Unexpected recovery request"); }
    return remote.request(url, options);
  };
  await assert.rejects(createCollectionSync({ storage: disk, store, covers: coverCache, fetch: request })
    .sync({ chooseConflicts: () => assert.fail(), confirm: async () => true }), /Raccolta cambiata/);
  assert.equal(store.state.albums[0].notes, "Changed while sending");
  assert.deepEqual(store.state.base, []);
  assert.equal(recoveryReads, 0);
  assert.equal(remote.writes.length, 1);
});
test("updated album metadata keeps the duration for the same catalog edition", async () => {
  const saved = album(), edited = album(undefined, { name: "Corrected title", year: "2021" });
  const disk = local([edited], [edited]), store = createCollectionStore(disk);
  const row = Object.fromEntries(["id", "artist", "name", "url", "year"].map((key) => [key, saved[key]]));
  const remote = github([edited], { durations: [{ ...row, duration_ms: 123000 }] });
  await createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request })
    .sync({ chooseConflicts: () => assert.fail(), confirm: async () => true });
  assert.equal(store.durations()[saved.id], 123000);
  const write = remote.writes.find((entry) => entry.url.includes("durations.json"));
  assert.equal(JSON.parse(Buffer.from(write.payload.content, "base64").toString()).albums[0].name, edited.name);
});
test("malformed duration archives do not change collection or durations", async () => {
  const saved = album(), disk = local([saved]), store = createCollectionStore(disk);
  store.saveMissingDuration(saved, 123000);
  const remote = github([saved], { durations: [{ id: saved.id, duration_ms: -1 }] });
  await assert.rejects(createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request })
    .sync({ chooseConflicts: () => assert.fail(), confirm: () => assert.fail() }), /non valido/);
  assert.equal(store.durations()[saved.id], 123000);
  assert.equal(remote.writes.length, 0);
});
test("a local persistence failure rolls back received durations and leaves the base unchanged", async () => {
  const saved = album(), disk = local([saved]), store = createCollectionStore(disk), before = store.state;
  const row = Object.fromEntries(["id", "artist", "name", "url", "year"].map((key) => [key, saved[key]]));
  const remote = github([saved], { durations: [{ ...row, duration_ms: 123000 }] });
  const setItem = disk.setItem;
  disk.setItem = (key, value) => {
    if (key === COLLECTION_KEY) throw new Error("Quota exceeded");
    setItem(key, value);
  };
  await assert.rejects(createCollectionSync({ storage: disk, store, covers: coverCache, fetch: remote.request })
    .sync({ chooseConflicts: () => assert.fail(), confirm: async () => true }), /Quota exceeded/);
  assert.equal(disk.getItem("accord-listening-album-durations-v1"), null);
  assert.equal(store.state, before);
});
test("collection services read complete Spotify album duration and reject an incomplete list", async () => {
  const saved = album(), disk = storage({ "accord-spotify-client-id": "client",
    "accord-spotify-token-client-id": "client", "accord-spotify-access-token": "token",
    "accord-spotify-token-expires": String(Date.now() + 3600000) });
  let bad = false, calls = 0, clock = Date.now();
  const services = createCollectionServices({ storage: disk, session: storage(), pageUrl: "https://example.test/pwa/",
    spotifyTiming: { now: () => clock, wait: async (delay) => { clock += delay; } },
    fetch: async (url) => {
      calls += 1;
      const offset = new URL(url).searchParams.get("offset");
      if (offset) return new Response(JSON.stringify({ total: 2, offset: 1, items: [{ id: "two", duration_ms: bad ? 0 : 200 }], next: null }),
        { headers: { "Cache-Control": "no-store" } });
      return new Response(JSON.stringify({ id: saved.id, total_tracks: 2, tracks: { total: 2, offset: 0,
        items: [{ id: "one", duration_ms: 100 }],
        next: `https://api.spotify.com/v1/albums/${saved.id}/tracks?offset=1&limit=1` } }),
        { headers: { "Cache-Control": "no-store" } });
    } });
  assert.equal(await services.albumDuration(saved), 300);
  bad = true;
  await assert.rejects(services.albumDuration(saved), /durate non valide/);
  assert.equal(calls, 4);
});
test("Spotify duration reuses the full album response fetched from an album link", async () => {
  const saved = album(), disk = storage({ "accord-music-service-v1": "spotify",
    "accord-spotify-client-id": "client", "accord-spotify-token-client-id": "client",
    "accord-spotify-access-token": "token", "accord-spotify-token-expires": String(Date.now() + 3600000) });
  let calls = 0, clock = Date.now();
  const services = createCollectionServices({ storage: disk, session: storage(), pageUrl: "https://example.test/pwa/",
    spotifyTiming: { now: () => clock, wait: async (delay) => { clock += delay; } },
    fetch: async () => {
      calls += 1;
      return reply({ id: saved.id, name: saved.name, album_type: "album", artists: [{ name: saved.artist }],
        release_date: "1993-01-01", external_urls: { spotify: saved.url }, total_tracks: 1,
        tracks: { total: 1, offset: 0, items: [{ id: "track", duration_ms: 123000 }], next: null } });
    } });
  assert.equal((await services.search(saved.url))[0].id, saved.id);
  assert.equal(await services.albumDuration(saved), 123000);
  assert.equal(calls, 1);
});
test("collection services read the exact TIDAL and Qobuz editions", async () => {
  const tidalDisk = storage({ "accord-music-service-v1": "tidal",
    "accord-tidal-client-id-v1": "client",
    "accord-tidal-token-v1": JSON.stringify({ clientId: "client", access_token: "token", expires: Date.now() + 3600000 }) });
  const tidal = createCollectionServices({ storage: tidalDisk, session: storage(), pageUrl: "https://example.test/pwa/",
    fetch: async (value) => {
      const url = new URL(value);
      if (url.pathname.endsWith("/users/me")) return reply({ data: { attributes: { country: "IT" } } });
      assert.equal(url.searchParams.get("countryCode"), "IT");
      if (url.pathname.endsWith("/albums/12")) return reply({ data: { type: "albums", id: "12",
        attributes: { numberOfItems: 1 } } });
      return reply({ data: [{ type: "tracks", id: "1" }],
        included: [{ type: "tracks", id: "1", attributes: { duration: "PT2M3S" } }] });
    } });
  assert.equal(await tidal.albumDuration(album("tidal:12")), 123000);
  assert.equal(tidal.provider, "tidal");
  await assert.rejects(tidal.albumDuration(album()), /Accesso Spotify non attivo/);
  setEditionLink(tidalDisk, album(), "tidal", { id: "tidal:12", name: "Chosen edition" });
  assert.equal(await tidal.albumDuration(album()), 123000);
  assert.equal(tidal.provider, "tidal");
  const disk = storage({ "accord-music-service-v1": "qobuz",
    "accord-qobuz-session-v1": JSON.stringify({ appId: "app", token: "token" }) });
  const qobuz = createCollectionServices({ storage: disk, session: storage(), pageUrl: "https://example.test/pwa/",
    fetch: async (value) => {
      const url = new URL(value);
      assert.equal(url.searchParams.get("album_id"), "abc");
      return reply({ id: "abc", title: "Album", artist: { name: "Artist" },
        tracks: { total: 1, offset: 0, items: [{ id: 1, title: "Track", duration: 123 }] } });
    } });
  assert.equal(await qobuz.albumDuration(album("qobuz:abc")), 123000);
});
test("duration lookup makes no requests when the alternate catalog is disconnected", async () => {
  const calls = [];
  const services = createCollectionServices({
    storage: storage({ "accord-music-service-v1": "tidal" }), session: storage(),
    pageUrl: "https://example.test/pwa/", fetch: async (url) => { calls.push(url); throw new Error("Unexpected request"); },
  });
  await assert.rejects(services.albumDuration(album()), /Accesso Spotify non attivo/);
  assert.deepEqual(calls, []);
  assert.equal(services.provider, "tidal");
});
test("duration lookup uses only the selected edition except on an explicit not-found response", async () => {
  const saved = album("tidal:12"), calls = [];
  const disk = storage({ "accord-music-service-v1": "qobuz",
    "accord-qobuz-session-v1": JSON.stringify({ appId: "app", token: "token" }),
    "accord-tidal-client-id-v1": "client",
    "accord-tidal-token-v1": JSON.stringify({ clientId: "client", access_token: "token", expires: Date.now() + 3600000 }) });
  let qobuzStatus = 403;
  const services = createCollectionServices({ storage: disk, session: storage(), pageUrl: "https://example.test/pwa/",
    fetch: async (value) => {
      const url = new URL(value); calls.push(url.hostname);
      if (url.hostname.endsWith("qobuz.com")) return new Response("{}", { status: qobuzStatus });
      if (url.pathname.endsWith("/users/me")) return reply({ data: { attributes: { country: "IT" } } });
      if (url.pathname.endsWith("/albums/12")) return reply({ data: { type: "albums", id: "12", attributes: { numberOfItems: 1 } } });
      return reply({ data: [{ type: "tracks", id: "1", attributes: { duration: "PT2M" } }] });
    } });
  setEditionLink(disk, saved, "qobuz", { id: "qobuz:abc", name: "Chosen" });
  await assert.rejects(services.albumDuration(saved), /HTTP 403/);
  assert.equal(calls.length, 1);
  qobuzStatus = 404;
  calls.length = 0;
  const result = await services.albumDuration(saved, { withProvenance: true });
  assert.equal(result.duration, 120000);
  assert.equal(result.provenance.source, "tidal");
  assert.equal(services.provider, "qobuz");
  assert.deepEqual(calls.slice(1), Array(3).fill("openapi.tidal.com"));
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
test("TIDAL album opening checks account country and resolves a playable edition", async () => {
  const document = (ids, playable) => ({
    data: ids.map(id => ({ type: "albums", id, attributes: { title: "Synthetic Album" },
      relationships: { artists: { data: [{ type: "artists", id: "1" }] },
        usageRules: { data: { type: "usageRules", id: `rules-${id}` } } } })),
    included: [{ type: "artists", id: "1", attributes: { name: "Synthetic Artist" } },
      ...ids.map(id => ({ type: "usageRules", id: `rules-${id}`,
        attributes: { countryCode: "IT", subscription: playable.includes(id) ? ["STREAM"] : [], free: [] } }))],
  });
  const f = tidalSearchFixture(({ url }) => {
    if (url.pathname === "/v2/albums") return reply(document(["42"], []));
    if (url.pathname.endsWith("/relationships/albums")) return reply(document(["42", "43"], ["43"]));
    return null;
  });
  const result = await f.services.resolveTidalAlbum("https://tidal.com/browse/album/42");
  assert.equal(result.original.id, "tidal:42");
  assert.equal(result.album.id, "tidal:43");
  assert.equal(result.country, "IT");
  assert.deepEqual(f.calls.map(({ url }) => url.pathname),
    ["/v2/users/me", "/v2/albums", "/v2/searchResults", "/v2/searchResults/opaque-result/relationships/albums"]);
  assert.ok(f.calls.slice(1).every(({ url }) => url.searchParams.get("countryCode") === "IT"));
});
test("TIDAL album verification rejects an account change while a request is pending", async () => {
  const disk = storage({ "accord-music-service-v1": "tidal", "accord-tidal-client-id-v1": "test-client",
    "accord-tidal-token-v1": JSON.stringify({ clientId: "test-client", access_token: "test-token",
      expires: Date.now() + 3600000 }) });
  let release;
  const services = createCollectionServices({ storage: disk, session: storage(), pageUrl: "https://example.test/",
    fetch: async () => new Promise(resolve => { release = resolve; }) });
  const pending = services.resolveTidalAlbum("42");
  await new Promise(resolve => setImmediate(resolve));
  services.disconnect("tidal");
  release(reply({ data: { attributes: { country: "IT" } } }));
  await assert.rejects(pending, /cambiato|scartat/i);
});
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
test("catalog completeness is exposed for association checks without changing the existing search result shape", async () => {
  const complete = tidalSearchFixture();
  assert.ok(Array.isArray(await complete.services.search("Search Album")));
  const page = await tidalSearchFixture().services.search("Search Album", { withCompleteness: true });
  assert.equal(page.albums[0].id, "tidal:12");
  assert.equal(page.complete, true);

  const partial = tidalSearchFixture(({ url }, document) => url.pathname.endsWith("/relationships/albums")
    ? reply({ ...document, links: { next: "https://openapi.tidal.com/v2/searchResults/opaque-result/relationships/albums?cursor=more" } })
    : null);
  const incomplete = await partial.services.search("Search Album", { withCompleteness: true });
  assert.equal(incomplete.albums[0].id, "tidal:12");
  assert.equal(incomplete.complete, false);
});
test("TIDAL uses exact lookup only for the reference field, not a numeric title", async () => {
  const f = tidalSearchFixture();
  await assert.rejects(f.services.search("https://example.test/album/12", { reference: true }), /non valido/i);
  assert.equal(f.calls.length, 0);
  const records = await f.services.search("https://tidal.com/browse/album/12", { reference: true });
  assert.equal(records[0].id, "tidal:12");
  assert.equal(f.calls.at(-1).url.pathname, "/v2/albums");
  assert.equal(f.calls.at(-1).url.searchParams.get("filter[id]"), "12");
  await f.services.search("1989", { reference: false });
  assert.equal(f.calls.at(-2).url.pathname, "/v2/searchResults");
  assert.equal(f.calls.at(-2).url.searchParams.get("filter[query]"), "1989");
});
test("TIDAL finds artists and follows their discography past 50 albums without leaking title-only matches", async () => {
  const f = tidalSearchFixture(({ url }, doc) => {
    const path = url.pathname;
    if (path.endsWith("opaque-result/relationships/artists")) {
      return reply({ data: [{ type: "artists", id: "2" }],
        included: [{ type: "artists", id: "2", attributes: { name: "Rebellion" } }] });
    }
    if (path.endsWith("/artists/2/relationships/albums")) {
      const later = url.searchParams.has("cursor");
      return reply({ ...doc, data: later
        ? [{ ...doc.data[0], id: "99", attributes: { title: "Métal Days (Deluxe)" } }]
        : Array.from({ length: 50 }, (_, i) => ({ ...doc.data[0], id: String(20 + i) })),
      ...(later ? {} : { links: { next: "?cursor=next" } }) });
    }
    if (path.endsWith("opaque-result/relationships/albums")) {
      return reply({ ...doc, data: [{ ...doc.data[0], attributes: { title: "Rebellion" } }] });
    }
    return null;
  });
  for (const [artist, title, expected] of [
    ["Rebellion", "", [...Array.from({ length: 50 }, (_, i) => `tidal:${20 + i}`), "tidal:99"]],
    ["", "Rebellion", ["tidal:12"]],
    ["rebellion", "metal   days", ["tidal:99"]],
    ["Rebellion", "Rebellion", []],
  ]) {
    const options = catalogSearchInput("tidal", { artist, title, reference: "" });
    assert.deepEqual((await f.services.search(options.query, options)).map((row) => row.id), expected);
  }
});
test("TIDAL broad and truncated artist results wait for a selection and read only the chosen discographies", async () => {
  for (const partial of [false, true]) {
    const f = tidalSearchFixture(({ url }, doc) => {
      if (url.pathname.endsWith("/relationships/artists")) {
        const page = Number(url.searchParams.get("cursor") || 1);
        const count = partial ? 1 : 6;
        if (page === 1) assert.match(url.searchParams.get("include"), /artists\.profileArt/);
        return reply({ data: Array.from({ length: count }, (_, i) => ({
          type: "artists", id: String(page + i), attributes: { name: "Rebellion" },
          ...((page + i === 1) ? { relationships: { profileArt: { data: [{ type: "artworks", id: "profile" }] } } } : {}),
        })),
        ...(page === 1 ? { included: [{ type: "artworks", id: "profile", attributes: { files: [
          { href: "https://other.invalid/images/artist.jpg" },
          { href: "https://resources.tidal.com/images/artists/rebellion.jpg" },
        ] } }] } : {}),
        ...(partial ? { links: { next: `?cursor=${page + 1}` } } : {}) });
      }
      if (url.pathname.includes("/artists/")) return reply(doc);
      return null;
    });
    const options = catalogSearchInput("tidal", { artist: "Rebellion", title: "Search Album", reference: "" });
    const controller = new AbortController();
    const paths = () => f.calls.map(({ url }) => url.pathname).filter((path) => path.startsWith("/v2/artists/"));
    await assert.rejects(f.services.search(options.query, { ...options, signal: controller.signal,
      chooseArtists: () => { controller.abort(); return ["1"]; } }), { name: "AbortError" });
    assert.deepEqual(paths(), []);
    const results = await f.services.search(options.query, { ...options, chooseArtists: (artists, { complete }) => {
      assert.equal(complete, !partial);
      assert.equal(artists.length, partial ? 12 : 6);
      assert.equal(artists.find(({ id }) => id === "1").photoUrl, "https://resources.tidal.com/images/artists/rebellion.jpg");
      assert.equal(artists.find(({ id }) => id === "2").photoUrl, null);
      assert.deepEqual(paths(), []);
      return ["2", "6"];
    } });
    assert.deepEqual(paths(), ["/v2/artists/2/relationships/albums", "/v2/artists/6/relationships/albums"]);
    assert.deepEqual(results.map(({ id }) => id), ["tidal:12"]);
  }
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
      assert.equal(new URL(url).searchParams.get("q"), 'artist:"Test Artist" album:"Search Album"');
      return reply({ albums: { items: [{ id: spotifyId, name: "Search Album", album_type: "album",
        artists: [{ name: "Test Artist" }], release_date: "2020-01-01",
        external_urls: { spotify: `https://open.spotify.com/album/${spotifyId}` },
        images: [{ url: "https://i.scdn.co/image/cover", width: 640 }] }], total: 1, next: null } });
    } });
  const spotifyAlbums = await spotify.search("Test Artist Search Album",
    { criteria: { artist: "Test Artist", title: "Search Album" } });
  assert.equal(spotify.coverUrl(spotifyAlbums[0]), "https://i.scdn.co/image/cover");
  assert.equal((await spotify.search("Test Artist Search Album", {
    criteria: { artist: "Test Artist", title: "Search Album" }, withCompleteness: true,
  })).complete, true);

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
  assert.equal((await qobuz.search("Search Album", { withCompleteness: true })).complete, true);
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
  assert.match(html, /collection-app\.mjs\?v=46/);
  assert.match(html, /<link rel="stylesheet" href="\.\/collection\.css\?v=19">/);
  assert.match(html, /<link rel="stylesheet" href="\.\/physical-collection\.css\?v=3">/);
  assert.doesNotMatch(html, /suggestionsPanel|playlistBuilderPanel|backupDialog|auditDialog|physicalOpen|app\.mjs\?v=124/);
  assert.match(html, /id="duplicates"/); assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html.match(/<header[\s\S]*?<\/header>/)[0], /id="duplicates"/);
  assert.match(html, /class="brand"[\s\S]*<img src="[^"]*accord-180\.png\?brand=album-1445" width="48" height="48" alt="" aria-hidden="true">/);
  assert.match(html, /class="app-version" id="version">App attiva v6\.0\.0/);
  assert.match(html, /id="openPhysicalTools"[^>]*>Aggiungi album non presente nei servizi/);
  assert.match(read("physical-collection-ui.mjs"), /id = 'physicalToolsPanel'/);
  assert.doesNotMatch(read("physical-collection-ui.mjs"), /createElement\('dialog'\)/);
  for (const id of ["catalogArtist", "catalogTitle", "catalogReference", "formatFilter", "openPhysicalTools"]) {
    assert.ok(html.includes(`id="${id}"`));
  }
  assert.match(html, /<details class="filter-disclosure">[\s\S]*id="statusFilter"[\s\S]*id="favoritesFilter"[\s\S]*<\/details>/);
  assert.doesNotMatch(html, /id="quickListeningFilter"/);
  assert.match(html, /id="statusFilter"[\s\S]*<option value="listening">In ascolto<\/option>/);
  assert.match(read("collection.css"), /--accent: #dfaa80/);
  for (const [, id] of app.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(html.includes(`id="${id}"`), `Missing active control ${id}`);
  const modules = ["collection-app.mjs", "collection-store.mjs", "collection-sync.mjs", "edition-links-sync.mjs", "duration-sync.mjs", "collection-services.mjs", "core.mjs", "tidal.mjs", "qobuz.mjs", "music-app-links.mjs", "album-association.mjs", "music-library-choices.mjs", "service-requests.mjs",
    "collection-qol.mjs", "unified-library.mjs", "physical-collection-ui.mjs", "physical-collection.mjs"];
  for (const file of modules) for (const [, dependency] of read(file).matchAll(/(?:from\s+|import\()["']\.\/([^"']+)["']/g)) {
    assert.ok(sw.includes(`"./${dependency}"`), `Offline dependency missing: ${dependency}`);
  }
  assert.doesNotMatch(sw, /tidal-ui\.mjs|playlist-ui\.mjs|suggestions-ui\.mjs|music-completion-ui\.mjs/);
  assert.match(html, /id="checkAlbumLinks"/);
  assert.match(app, /openAssociationDialog\(\{[\s\S]*?albums: store\.state\.albums, links, provider/);
  assert.match(app, /withCompleteness: true/);
});
test("lazy cover images stay observable until their image has loaded", () => {
  const app = readFileSync(new URL("collection-app.mjs", import.meta.url), "utf8");
  const styles = readFileSync(new URL("collection.css", import.meta.url), "utf8");
  const image = app.match(/const image = node\("img"[\s\S]*?\);/)[0];
  assert.doesNotMatch(image, /\bhidden:/);
  assert.match(app, /image\.classList\.add\("loaded"\)/);
  assert.match(styles, /\.artwork img \{[^}]*visibility:\s*hidden/);
  assert.match(styles, /\.artwork img\.loaded \{[^}]*visibility:\s*visible/);
});

test("TIDAL settings and authorization use the same canonical directory redirect", async () => {
  for (const base of ["https://melvin-91.github.io/accord-album-pwa/", "https://melvin-91.github.io/accord-album-pwa/pwa/"]) {
    for (const suffix of ["", "index.html?old=true#fragment"]) {
      const tab = storage(), disk = storage();
      const services = createCollectionServices({ storage: disk, session: tab, pageUrl: base+suffix,
        fetch: async () => { throw Error("Unexpected network request"); } });
      assert.equal(services.settings("tidal").redirectUri, base);
      const url = new URL(await services.connect("tidal", {clientId:"synthetic-client"}));
      assert.equal(url.searchParams.get("redirect_uri"),base);
      assert.equal(JSON.parse(tab.getItem("accord-tidal-pkce-v1")).redirect,base);
      assert.equal(url.searchParams.get("code_challenge_method"),"S256");
    }
  }
});

test("TIDAL redirect control is visible and changed modules use fresh precache URLs", () => {
  const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
  const html = read("index.html"), app = read("collection-app.mjs"), sw = read("sw.js");
  assert.match(html, /id="redirectUri" readonly/);
  assert.match(html, /id="copyRedirectUri"/);
  assert.ok(app.includes('$("redirectField").hidden = provider === "qobuz"'));
  assert.ok(app.includes('new URL("./", location.href).href'));
  assert.ok(html.includes("collection-app.mjs?v=46"));
  assert.ok(app.includes("collection-services.mjs?v=22"));
  for (const resource of ["collection-app.mjs?v=46","collection-services.mjs?v=22"]) assert.ok(sw.includes(resource));
});
