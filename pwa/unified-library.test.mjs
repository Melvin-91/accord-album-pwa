import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCollectionSync } from "./collection-sync.mjs";
import { COLLECTION_KEY, createCollectionStore } from "./collection-store.mjs";
import { createSyncDocument, validateAlbum } from "./core.mjs";
import { durationDocument } from "./duration-sync.mjs";
import { PHYSICAL_KEY, physicalDocument } from "./physical-collection.mjs";
import { createUnifiedLibrary, readUnifiedLibrary } from "./unified-library.mjs";
import { EDITION_LINKS_KEY, editionLinksDocument, localEditionLinks, mergeEditionLinks,
  readEditionLinksDocument, validateEditionLinks } from "./edition-links-sync.mjs";

const album = (id, name, changes = {}) => validateAlbum({ id, name, artist: "Björk", year: "1993",
  url: `https://open.spotify.com/album/${id}`, status: "liked", rating: 4.5, genres: ["Art Pop"],
  primary_genre: "Art Pop", collections: [], tags: [], cover_sha256: null, ...changes });
const debut = album("A".repeat(22), "Debut", { notes: "Da conservare" });
const post = album("B".repeat(22), "Post");
const cd = { artist: debut.artist, title: debut.name, cd: true, vinyl: false };
const vinyl = { ...cd, cd: false, vinyl: true };
const both = { ...cd, vinyl: true };
const tombstone = { artist: "Björk", title: "Post", cd: false, vinyl: false };
const duration = { ...Object.fromEntries(["id", "artist", "name", "url", "year"].map((key) => [key, debut[key]])),
  duration_ms: 300_000 };
const legacyMusic = (albums, deletedAlbums = []) => ({ ...createSyncDocument(albums), deletion_sync: true,
  deletion_history: true, deleted_albums: deletedAlbums });
const noLegacy = { albums_sha: null, physical_sha: null, durations_sha: null };
const oldPhysicalPending = "accord-physical-sync-pending-v1";
const writePending = "accord-album-sync-uncertain-v1";
const libraryPending = "accord-library-sync-pending-v1";
const covers = { async get() { return null; }, async put() {} };

function disk({ music, physical, owner = "MELVIN" } = {}) {
  const data = new Map([["accord-album-owner", owner], ["accord-album-token", "synthetic-token"]]);
  if (music) data.set(COLLECTION_KEY, JSON.stringify(music));
  if (physical) data.set(PHYSICAL_KEY, JSON.stringify(physical));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

function gitBlobSha(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function github(initial = {}, { afterPut } = {}) {
  const files = new Map(), writes = [], reads = [], rawFiles = new Set();
  function set(file, object) {
    const bytes = Buffer.isBuffer(object) ? object : Buffer.from(JSON.stringify(object));
    files.set(file, { bytes, sha: gitBlobSha(bytes) });
  }
  for (const [file, object] of Object.entries(initial)) set(file, object);
  const reply = (body, status = 200) => Response.json(body, { status });
  async function request(url, options) {
    const remote = new URL(url);
    assert.equal(remote.origin, "https://api.github.com");
    assert.match(remote.pathname, /^\/repos\/melvin\/accord-music-data(?:\/|$)/);
    assert.equal(options.headers.Authorization, "Bearer synthetic-token");
    assert.equal(options.credentials, "omit");
    const name = remote.pathname.split("/").at(-1);
    if (name === "accord-music-data") return reply({ private: true, default_branch: "main" });
    if (options.method === "PUT") {
      const payload = JSON.parse(options.body), expected = files.get(name)?.sha;
      assert.equal(payload.branch, "main");
      if (payload.sha !== expected) return reply({}, 409);
      writes.push(name);
      set(name, Buffer.from(payload.content, "base64"));
      if (afterPut) await afterPut({ name, files, set });
      return reply({ content: { sha: files.get(name).sha }, commit: { sha: "commit" } });
    }
    reads.push(name);
    assert.equal(remote.searchParams.get("ref"), "main");
    const current = files.get(name);
    if (!current) return reply({}, 404);
    if (options.headers.Accept.includes(".raw+")) return new Response(current.bytes);
    return reply({ type: "file", sha: current.sha, ...(rawFiles.has(name)
      ? { encoding: "none", content: "" } : { encoding: "base64", content: current.bytes.toString("base64") }) });
  }
  return { request, files, set, writes, reads, rawFiles,
    document(file = "library.json") { return JSON.parse(files.get(file).bytes.toString()); } };
}

const agree = { chooseConflicts: () => assert.fail("Conflitto inatteso"), confirm: async () => true };
function synchronize(storage, remote) {
  const store = createCollectionStore(storage);
  return { store, sync: createCollectionSync({ storage, store, covers, fetch: remote.request, unified: true }) };
}

test("le associazioni dei peer conservano identità storiche e chiavi non standard", () => {
  for (const id of ["mb:synthetic", "ann:synthetic", "__proto__", "constructor"]) {
    const link = { id: "tidal:1", name: "Edizione", source: [id, "", ""] };
    const original = Object.fromEntries([[id, { tidal: link }]]);
    assert.deepEqual(readEditionLinksDocument(editionLinksDocument(original)), original);
    assert.deepEqual(validateEditionLinks(localEditionLinks(original), true), original);
    const changed = Object.fromEntries([[id, { tidal: { ...link, id: "tidal:2" } }]]);
    const conflict = mergeEditionLinks(original, changed, {});
    assert.equal(conflict.conflicts[0].fields[0].field, "edition_link:tidal");
    const choices = Object.fromEntries([[id, { "edition_link:tidal": "local" }]]);
    assert.deepEqual(mergeEditionLinks(original, changed, {}, choices).links, changed);
  }
});

test("sincronizza associazioni bidirezionali senza riattivare sorgenti obsolete", async () => {
  const stale = { id: "tidal:123", name: "Edizione", source: [debut.id, debut.artist, "Titolo precedente"] };
  const other = { id: "qobuz:abc", name: "Altra", source: [debut.id, debut.artist, debut.name] };
  const document = createUnifiedLibrary({ albums: [debut], physical: [], deletedAlbums: [], durations: [],
    migration: noLegacy, extensions: { edition_links: editionLinksDocument({ [debut.id]: { tidal: stale } }), extra: { a: 1 } } });
  const remote = github({ "library.json": document });
  const storage = disk({ music: { albums: [debut], base: [debut] } });
  storage.setItem(EDITION_LINKS_KEY, JSON.stringify(localEditionLinks({ [debut.id]: { qobuz: other } })));
  const { store, sync } = synchronize(storage, remote);
  await sync.sync({ ...agree, confirm: async (preview) => {
    assert.equal(preview.linkChangesIncoming.length, 1);
    assert.equal(preview.linkChangesOutgoing.length, 1);
    return true;
  } });
  const merged = { [debut.id]: { qobuz: other, tidal: stale } };
  assert.deepEqual(remote.document().extensions.edition_links.links, merged);
  assert.deepEqual(remote.document().extensions.extra, { a: 1 });
  assert.deepEqual(JSON.parse(storage.getItem(EDITION_LINKS_KEY)), localEditionLinks(merged));
  assert.deepEqual(store.state.editionLinksBase, { owner: "melvin", links: merged });
  await sync.sync({ ...agree, confirm: () => assert.fail("Nessuna modifica dopo la sincronizzazione") });
  assert.deepEqual(remote.writes, ["library.json"]);
});

test("conflitto cancellazione modifica richiede scelta e propaga la cancellazione", async () => {
  const link = { id: "tidal:123", name: "Uno", source: [debut.id, debut.artist, debut.name] };
  const document = createUnifiedLibrary({ albums: [debut], physical: [], deletedAlbums: [], durations: [],
    migration: noLegacy, extensions: { edition_links: editionLinksDocument({ [debut.id]: { tidal: link } }) } });
  const remote = github({ "library.json": document }), storage = disk();
  const { sync } = synchronize(storage, remote);
  await sync.sync(agree);
  storage.setItem(EDITION_LINKS_KEY, "{}");
  document.extensions.edition_links.links[debut.id].tidal.name = "Diverso";
  remote.set("library.json", document);
  const before = remote.writes.length;
  assert.equal(await sync.sync({ chooseConflicts: async (conflicts) => {
    assert.equal(conflicts[0].fields[0].field, "edition_link:tidal");
    assert.equal(conflicts[0].fields[0].local, null);
    return null;
  }, confirm: () => assert.fail() }), false);
  assert.equal(remote.writes.length, before);
  await sync.sync({ chooseConflicts: async () => ({ [debut.id]: { "edition_link:tidal": "local" } }), confirm: async () => true });
  assert.deepEqual(remote.document().extensions.edition_links.links, {});
  assert.deepEqual(JSON.parse(storage.getItem(EDITION_LINKS_KEY)), {});
});

test("estensione mancante non equivale a cancellazione; estensione invalida blocca", async () => {
  const link = { id: "qobuz:abc", name: "Album", source: [debut.id, debut.artist, debut.name] };
  const links = { [debut.id]: { qobuz: link } };
  const document = createUnifiedLibrary({ albums: [debut], physical: [], deletedAlbums: [], durations: [],
    migration: noLegacy, extensions: { edition_links: editionLinksDocument(links) } });
  const remote = github({ "library.json": document }), storage = disk();
  const { store, sync } = synchronize(storage, remote);
  await sync.sync(agree);
  delete document.extensions.edition_links;
  remote.set("library.json", document);
  await sync.sync(agree);
  assert.deepEqual(remote.document().extensions.edition_links.links, links);
  const state = store.state, saved = storage.getItem(EDITION_LINKS_KEY), writes = remote.writes.length;
  document.extensions.edition_links = { format: "accord-edition-links", version: 99, links: {} };
  remote.set("library.json", document);
  await assert.rejects(sync.sync(agree), /Formato associazioni/);
  assert.equal(store.state, state);
  assert.equal(storage.getItem(EDITION_LINKS_KEY), saved);
  assert.equal(remote.writes.length, writes);
});

test("l'ultima cancellazione locale viene pubblicata anche se l'estensione è assente", async () => {
  const link = { id: "tidal:123", name: "Album", source: [debut.id, debut.artist, debut.name] };
  const document = createUnifiedLibrary({ albums: [debut], physical: [], deletedAlbums: [], durations: [],
    migration: noLegacy, extensions: { edition_links: editionLinksDocument({ [debut.id]: { tidal: link } }) } });
  const remote = github({ "library.json": document }), storage = disk();
  const { sync } = synchronize(storage, remote);
  await sync.sync(agree);
  storage.setItem(EDITION_LINKS_KEY, "{}");
  delete document.extensions.edition_links;
  remote.set("library.json", document);
  await sync.sync(agree);
  assert.deepEqual(remote.document().extensions.edition_links, editionLinksDocument({}));
});

test("associazioni orfane restano disponibili anche quando l'album è stato rimosso", async () => {
  const link = { id: "tidal:123", name: "Album", source: [debut.id, debut.artist, debut.name] };
  const document = createUnifiedLibrary({ albums: [], physical: [], deletedAlbums: [debut], durations: [],
    migration: noLegacy, extensions: { edition_links: editionLinksDocument({ [debut.id]: { tidal: link } }) } });
  const remote = github({ "library.json": document }), storage = disk();
  const { store, sync } = synchronize(storage, remote);
  await sync.sync(agree);
  assert.deepEqual(store.state.albums, []);
  assert.deepEqual(JSON.parse(storage.getItem(EDITION_LINKS_KEY)),
    localEditionLinks({ [debut.id]: { tidal: link } }));
  assert.deepEqual(remote.document().extensions.edition_links.links[debut.id].tidal, link);
});

test("valori discordanti alla prima sincronizzazione e sorgenti locali invalide non si perdono", async () => {
  const link = { id: "tidal:123", name: "Remoto", source: [debut.id, debut.artist, debut.name] };
  const document = createUnifiedLibrary({ albums: [debut], physical: [], deletedAlbums: [], durations: [],
    migration: noLegacy, extensions: { edition_links: editionLinksDocument({ [debut.id]: { tidal: link } }) } });
  const remote = github({ "library.json": document }), storage = disk({ music: { albums: [debut], base: [debut] } });
  const local = { [debut.id]: { tidal: { ...link, name: "Locale" } } };
  storage.setItem(EDITION_LINKS_KEY, JSON.stringify(localEditionLinks(local)));
  const { store, sync } = synchronize(storage, remote);
  assert.equal(await sync.sync({ chooseConflicts: async (conflicts) => {
    assert.equal(conflicts[0].fields[0].field, "edition_link:tidal");
    return null;
  }, confirm: () => assert.fail() }), false);
  assert.equal(store.pendingChanges(), 1);
  local[debut.id].tidal.source = "non-decodificabile";
  storage.setItem(EDITION_LINKS_KEY, JSON.stringify(local));
  assert.equal(store.pendingChanges(), 1);
  await assert.rejects(sync.sync(agree), /Identita dell'associazione locale/);
  assert.deepEqual(remote.writes, []);
  assert.equal(JSON.parse(storage.getItem(EDITION_LINKS_KEY))[debut.id].tidal.source, "non-decodificabile");
});

test("modifica concorrente e salvataggio locale fallito non sovrascrivono associazioni", async () => {
  const link = { id: "tidal:123", name: "Uno", source: [debut.id, debut.artist, debut.name] };
  const document = createUnifiedLibrary({ albums: [debut], physical: [], deletedAlbums: [], durations: [],
    migration: noLegacy, extensions: { edition_links: editionLinksDocument({ [debut.id]: { tidal: link } }) } });
  const remote = github({ "library.json": document }), storage = disk();
  const { store, sync } = synchronize(storage, remote);
  await assert.rejects(sync.sync({ ...agree, confirm: async () => {
    storage.setItem(EDITION_LINKS_KEY, "{}"); return true;
  } }), /associazioni sono cambiate/);
  assert.deepEqual(remote.writes, []);
  const previous = storage.getItem(EDITION_LINKS_KEY), set = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === COLLECTION_KEY) throw new Error("Quota exceeded");
    set(key, value);
  };
  await assert.rejects(sync.sync(agree), /Quota exceeded/);
  assert.equal(storage.getItem(EDITION_LINKS_KEY), previous);
  assert.equal(store.state.editionLinksBase, undefined);
});

test("migra le raccolte nella stessa scrittura conservando metadati, rimozioni e supporti", async () => {
  const remote = github({ "albums.json": legacyMusic([debut], [post]),
    "physical-library.json": physicalDocument([vinyl, tombstone]), "durations.json": durationDocument([duration]) });
  const previous = new Map(remote.files);
  const storage = disk({ music: { albums: [debut], base: [debut], syncOwner: "MELVIN",
    preferences: { favoriteIds: [debut.id] } }, physical: { records: [cd], base: [], owner: "" } });
  const oldLocal = storage.getItem(PHYSICAL_KEY);
  const { store, sync } = synchronize(storage, remote);
  assert.equal(await sync.sync({ ...agree, confirm: async (preview) => {
    assert.equal(preview.migrating, true);
    assert.equal(preview.physicalIncoming, true);
    assert.equal(preview.physicalOutgoing, true);
    return true;
  } }), true);
  const document = remote.document();
  assert.deepEqual(remote.writes, ["library.json"]);
  assert.deepEqual(document.migration, { albums_sha: previous.get("albums.json").sha,
    physical_sha: previous.get("physical-library.json").sha, durations_sha: previous.get("durations.json").sha });
  assert.deepEqual(document.music.albums, [debut]);
  assert.deepEqual(document.music.deleted_albums, [post]);
  assert.deepEqual(document.physical.albums, [both, tombstone]);
  assert.deepEqual(document.durations.albums, [duration]);
  for (const [file, content] of previous) assert.equal(remote.files.get(file), content);
  assert.equal(storage.getItem(PHYSICAL_KEY), oldLocal);
  assert.deepEqual(store.state.preferences.favoriteIds, [debut.id]);
  assert.deepEqual(store.state.physicalBase, [both, tombstone]);
  assert.equal(store.state.libraryOwner, "melvin");
  await sync.sync({ ...agree, confirm: () => assert.fail("Archivio già sincronizzato") });
  assert.deepEqual(remote.writes, ["library.json"]);
});

test("riceve il catalogo senza scrivere e conserva le estensioni del desktop", async () => {
  const extensions = { "desktop.accord": { version: 1, value: ["accento"] } };
  const document = createUnifiedLibrary({ albums: [debut], physical: [both], deletedAlbums: [],
    durations: [duration], migration: noLegacy, extensions });
  const remote = github({ "library.json": document });
  const storage = disk();
  const { store, sync } = synchronize(storage, remote);
  await sync.sync(agree);
  assert.deepEqual(remote.writes, []);
  assert.deepEqual(store.state.albums, [debut]);
  assert.deepEqual(store.state.physical, [both]);
  store.update(debut.id, { rating: 5 });
  await sync.sync(agree);
  assert.deepEqual(remote.writes, ["library.json"]);
  assert.deepEqual(remote.document().extensions, extensions);
  assert.equal(remote.document().music.albums[0].rating, 5);
  assert.deepEqual(remote.document().physical.albums, [both]);
});

test("blocca una modifica del file precedente sia durante la migrazione sia dopo", async () => {
  const remote = github({ "albums.json": legacyMusic([debut]) });
  const { store, sync } = synchronize(disk(), remote);
  const before = store.state;
  await assert.rejects(sync.sync({ ...agree, confirm: async () => {
    remote.set("physical-library.json", physicalDocument([cd]));
    return true;
  } }), /archivi precedenti sono cambiati: physical-library\.json/);
  assert.equal(store.state, before);
  assert.deepEqual(remote.writes, []);
  await sync.sync(agree);
  const after = store.state;
  remote.set("albums.json", legacyMusic([post]));
  await assert.rejects(sync.sync(agree), /archivi precedenti sono cambiati: albums\.json/);
  assert.equal(store.state, after);
  assert.deepEqual(remote.writes, ["library.json"]);
});

test("la scomparsa del file canonico non ripristina automaticamente le copie precedenti", async () => {
  const remote = github({ "albums.json": legacyMusic([debut]) });
  const { store, sync } = synchronize(disk(), remote);
  await sync.sync(agree);
  const before = store.state;
  remote.files.delete("library.json");
  remote.reads.length = 0;
  await assert.rejects(sync.sync(agree), /library\.json e' assente/);
  assert.deepEqual(remote.reads, ["library.json"]);
  assert.equal(store.state, before);
});

test("conferma per impronta il precedente invio dei supporti e conserva il registro fino al commit", async () => {
  const remote = github({ "physical-library.json": physicalDocument([both]) });
  const storage = disk({ physical: { records: [cd], base: [], owner: "" } });
  storage.setItem(oldPhysicalPending, JSON.stringify({ owner: "MELVIN", branch: "main",
    blobSha: remote.files.get("physical-library.json").sha }));
  const { store, sync } = synchronize(storage, remote);
  assert.equal(await sync.sync({ ...agree, confirm: async () => {
    assert.notEqual(storage.getItem(oldPhysicalPending), null);
    return false;
  } }), false);
  assert.notEqual(storage.getItem(oldPhysicalPending), null);
  assert.deepEqual(remote.writes, []);
  await sync.sync(agree);
  assert.deepEqual(store.state.physical, [both]);
  assert.equal(storage.getItem(oldPhysicalPending), null);
});

test("un precedente invio dei supporti non confermato blocca la migrazione", async () => {
  const storage = disk();
  const marker = JSON.stringify({ owner: "melvin", branch: "main", blobSha: "a".repeat(40) });
  storage.setItem(oldPhysicalPending, marker);
  const remote = github();
  const { sync } = synchronize(storage, remote);
  await assert.rejects(sync.sync(agree), /Non è possibile confermare l’ultimo invio dei supporti/);
  assert.equal(storage.getItem(oldPhysicalPending), marker);
  assert.deepEqual(remote.writes, []);
});

test("l’esito incerto dell’invio è verificato senza ripetere la scrittura", async () => {
  const storage = disk({ music: { albums: [debut], base: [] } });
  const remote = github({}, { afterPut() { throw new TypeError("Risposta persa"); } });
  const { store, sync } = synchronize(storage, remote);
  assert.equal(await sync.sync(agree), true);
  assert.deepEqual(remote.writes, ["library.json"]);
  assert.deepEqual(store.state.albums, [debut]);
  assert.equal(storage.getItem(writePending), null);
  assert.equal(storage.getItem(libraryPending), null);
});

test("la verifica dell’invio mantiene bloccate le modifiche fino al commit locale", async () => {
  let disconnected = false;
  const remote = github({}, { afterPut() { disconnected = true; throw new TypeError("Risposta persa"); } });
  const request = remote.request;
  remote.request = (url, options) => {
    if (disconnected) throw new TypeError("Connessione assente");
    return request(url, options);
  };
  const storage = disk({ physical: { records: [cd], base: [], owner: "" } });
  const { store, sync } = synchronize(storage, remote);
  const before = store.state;
  await assert.rejects(sync.sync(agree), /Verifica in sola lettura non riuscita/);
  assert.notEqual(storage.getItem(writePending), null);
  assert.notEqual(storage.getItem(libraryPending), null);
  assert.equal(store.state, before);
  disconnected = false;
  const verification = await sync.verifyUncertainWrite();
  assert.equal(verification.verified, true);
  assert.equal(storage.getItem(writePending), null);
  assert.equal(JSON.parse(storage.getItem(libraryPending)).confirmed, true);
  const savedRemote = remote.files.get("library.json");
  remote.files.delete("library.json");
  await assert.rejects(sync.sync(agree), /library\.json e' assente/);
  remote.files.set("library.json", savedRemote);
  assert.throws(() => store.setPhysicalFormat(cd.artist, cd.title, "cd", false), /sincronizza/i);
  await sync.sync(agree);
  assert.equal(storage.getItem(libraryPending), null);
  assert.deepEqual(remote.writes, ["library.json"]);
  store.setPhysicalFormat(cd.artist, cd.title, "cd", false);
  assert.equal(store.state.physical[0].cd, false);
});

test("un conflitto GitHub definitivo non blocca le successive modifiche locali", async () => {
  const remote = github();
  const request = remote.request;
  remote.request = (url, options) => options.method === "PUT" ? Response.json({}, { status: 409 }) : request(url, options);
  const storage = disk({ physical: { records: [cd], base: [], owner: "" } });
  const { store, sync } = synchronize(storage, remote);
  await assert.rejects(sync.sync(agree), /library\.json: GitHub HTTP 409/);
  assert.equal(storage.getItem(writePending), null);
  assert.equal(storage.getItem(libraryPending), null);
  store.setPhysicalFormat(cd.artist, cd.title, "cd", false);
  assert.equal(store.state.physical[0].cd, false);
});

test("un catalogo locale collegato a un altro account non viene letto né inviato", async () => {
  const storage = disk({ physical: { records: [cd], base: [cd], owner: "altro-proprietario" } });
  const remote = github(), { sync } = synchronize(storage, remote);
  await assert.rejects(sync.sync(agree), /associato a un altro proprietario/);
  assert.deepEqual(remote.reads, []);
  assert.deepEqual(remote.writes, []);
});

test("un catalogo grande viene letto per intero e confrontato con l’impronta Git", async () => {
  const document = createUnifiedLibrary({ albums: [debut], physical: [both], deletedAlbums: [],
    durations: [duration], migration: noLegacy });
  const bytes = Buffer.from(JSON.stringify(document) + " ".repeat(1024 * 1024));
  const remote = github({ "library.json": bytes });
  remote.rawFiles.add("library.json");
  const { store, sync } = synchronize(disk(), remote);
  await sync.sync(agree);
  assert.deepEqual(store.state.physical, [both]);
  assert.deepEqual(remote.writes, []);
});

test("il catalogo rifiuta una migrazione malformata e album presenti anche tra le rimozioni", () => {
  const document = createUnifiedLibrary({ albums: [debut], physical: [both], deletedAlbums: [],
    durations: [duration], migration: noLegacy });
  assert.throws(() => readUnifiedLibrary({ ...document, migration: { ...noLegacy, albums_sha: "invalid" } }), /migrazione/);
  assert.throws(() => readUnifiedLibrary({ ...document, music: { ...document.music, deleted_albums: [debut] } }), /rimozioni/);
});
