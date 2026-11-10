import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { associationUpdates, openAssociationDialog, prepareAssociations } from "./album-association.mjs";
import { editionLink, setEditionLink, sourceIdentity } from "./music-continuity.mjs";
import { localCollectionMatch } from "./music-qol.mjs";
import { collectionHealthSummary, commitLocalRestore, prepareCollectionHistoryRestore } from "./ui.mjs";

const source = { id: "A".repeat(22), artist: "Band", name: "Album", year: "2024",
  url: `https://open.spotify.com/album/${"A".repeat(22)}` };
const candidate = { ...source, id: "tidal:123", url: "https://tidal.com/browse/album/123" };
const page = (albums = [candidate], complete = true) => ({ albums, complete });
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key) };
};
const key = "accord-album-pwa-v1", linkKey = "accord-music-edition-links-v1";

test("the app freezes the actual filtered list at click and refuses zero results", () => {
  const sourceCode = readFileSync(new URL("./app.mjs", import.meta.url), "utf8");
  const start = sourceCode.indexOf("function associateFilteredCollection()");
  const end = sourceCode.indexOf("\nasync function spotifyPlaylistIdentity", start);
  assert.ok(start >= 0 && end > start);
  for (const empty of [false, true]) {
    const hidden = { ...source, id: "B".repeat(22), name: "Excluded" };
    const visible = empty ? [] : [source], dialogs = [], errors = [];
    const context = {
      collectionAssociationOpen: false, state: { albums: [source, hidden] }, visibleAlbums: visible,
      musicService: { service: "tidal", epoch: 1, assert() {} },
      tidalUI: { suggestionAPI: { revision: () => 1 } }, spotifySettings: () => ({ clientId: "" }),
      sessionStorage: storage(), localStorage: storage(), STORAGE_KEY: key,
      openAssociationDialog: options => dialogs.push(options),
      showFeedback: message => errors.push(message),
    };
    runInNewContext(`${sourceCode.slice(start, end)}\nassociateFilteredCollection();`, context);
    if (empty) {
      assert.equal(dialogs.length, 0);
      assert.match(errors[0], /Nessun album nei filtri attivi/);
    } else {
      assert.equal(dialogs.length, 1);
      assert.deepEqual(Array.from(dialogs[0].targetIds), [source.id]);
      visible.push(hidden);
      assert.deepEqual(Array.from(dialogs[0].targetIds), [source.id]);
      assert.equal(dialogs[0].albums.length, 2);
      assert.deepEqual(errors, []);
    }
  }
});

test("the entire supplied library is searched, without writing or mutating input", async () => {
  const albums = [source, { ...source, id: "B".repeat(22), name: "Hidden by filters" }];
  const before = structuredClone(albums), calls = [];
  const plan = await prepareAssociations(albums, {}, "tidal", async album => { calls.push(album.id); return page(); });
  assert.equal(plan.rows.length, 2);
  assert.deepEqual(calls, albums.map(album => album.id));
  assert.deepEqual(albums, before);
});

test("only unique exact names and compatible years are proposed", async () => {
  for (const [changes, state] of [[{ artist: "Other" }, "missing"], [{ name: "Album (Deluxe)" }, "missing"],
    [{ year: "2023" }, "missing"], [{ artist: " BAND ", name: "Ａｌｂｕｍ" }, "found"]]) {
    const plan = await prepareAssociations([source], {}, "tidal", async () => page([{ ...candidate, ...changes }]));
    assert.equal(plan.rows[0].state, state);
  }
});

test("filtered targets alone are searched and saved while the complete library stays guarded", async () => {
  const hidden = { ...source, id: "B".repeat(22), name: "Excluded by filters" };
  const albums = [source, hidden], calls = [];
  const links = { [hidden.id]: { tidal: { id: "tidal:456", name: hidden.name, source: sourceIdentity(hidden) } } };
  const plan = await prepareAssociations(albums, links, "tidal", async album => {
    calls.push(album.id); return page();
  }, undefined, undefined, [source.id]);
  assert.deepEqual(calls, [source.id]);
  assert.deepEqual(plan.rows.map(row => row.album.id), [source.id]);
  const updated = associationUpdates(plan, albums, links);
  assert.deepEqual(updated[hidden.id], links[hidden.id]);
  assert.equal(updated[source.id].tidal.id, candidate.id);
  assert.throws(() => associationUpdates(plan, [source, { ...hidden, name: "Changed" }], links), /cambiate/);
  const empty = await prepareAssociations(albums, links, "tidal",
    () => assert.fail("Empty filters must not search"), undefined, undefined, []);
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(associationUpdates(empty, albums, links), links);
});

test("ambiguous, empty, incomplete and duplicate catalogue rows are distinct", async () => {
  for (const [result, state] of [[page([]), "missing"],
    [page([candidate, { ...candidate, id: "tidal:456" }]), "ambiguous"],
    [page([candidate], false), "incomplete"], [page([candidate, candidate]), "found"]]) {
    const plan = await prepareAssociations([source], {}, "tidal", async () => result);
    assert.equal(plan.rows[0].state, state);
    if (state !== "found") assert.deepEqual(associationUpdates(plan, [source], {}), {});
  }
});

test("native and existing or stale links never initiate searches", async () => {
  const search = () => assert.fail("Unnecessary read");
  assert.equal((await prepareAssociations([source], {}, "spotify", search)).rows[0].state, "native");
  for (const [identity, state] of [[sourceIdentity(source), "linked"], ["old", "stale"]]) {
    const links = { [source.id]: { tidal: { id: candidate.id, name: candidate.name, source: identity } } };
    const plan = await prepareAssociations([source], links, "tidal", search);
    assert.equal(plan.rows[0].state, state);
    assert.deepEqual(associationUpdates(plan, [source], links), links);
  }
});

test("library or links changed while searching reject all local writes", async () => {
  const plan = await prepareAssociations([source], {}, "tidal", async () => page());
  for (const albums of [[], [source, { ...source, id: "B".repeat(22) }], [{ ...source, name: "Other" }]]) {
    assert.throws(() => associationUpdates(plan, albums, {}), /cambiate/);
  }
  assert.throws(() => associationUpdates(plan, [source], { [source.id]: { tidal: candidate } }), /cambiate/);
});

test("API errors and cancellation stop the batch before local writes", async () => {
  await assert.rejects(prepareAssociations([source], {}, "tidal", () => { throw new Error("HTTP 429"); }), /429/);
  let cancelled = false;
  await assert.rejects(prepareAssociations([source], {}, "tidal", async () => { cancelled = true; return page(); },
    () => { if (cancelled) throw new Error("Cancelled"); }), /Cancelled/);
  await assert.rejects(prepareAssociations([source], {}, "tidal", async () => page([{ ...candidate, id: "qobuz:abc" }])), /Identita/);
});

test("malformed local per-album links fail before any catalogue read", async () => {
  for (const value of [null, [], "bad"]) {
    await assert.rejects(prepareAssociations([source], { [source.id]: value }, "tidal",
      () => assert.fail("Malformed links")), /leggibili/);
  }
});

test("the collection can reuse a single parsed association snapshot for every album", () => {
  const links = { [source.id]: { tidal: { id: candidate.id, name: candidate.name, source: sourceIdentity(source) } } };
  const unreadable = { getItem() { assert.fail("Snapshot must not be reread for each album"); } };
  assert.equal(editionLink(unreadable, source, "tidal", links).id, candidate.id);
});

test("missing association follows the one selected music service, excluding native and current links only", () => {
  for (const [provider, id] of [["spotify", "B".repeat(22)], ["tidal", "tidal:123"], ["qobuz", "qobuz:demo"]]) {
    const album = { ...source, id: "external", url: "https://musicbrainz.org/release/external" };
    const options = { missingAssociation: true, musicProvider: provider };
    assert.equal(localCollectionMatch(album, options), true);
    assert.equal(localCollectionMatch({ ...album, id }, options), false);
    const saved = storage();
    const links = { [album.id]: { [provider]: { id, name: album.name, source: sourceIdentity(album) } } };
    const associated = Boolean(editionLink(saved, album, provider, links));
    assert.equal(localCollectionMatch(album, { ...options, associated }), false);
    links[album.id][provider].source = "old";
    assert.equal(localCollectionMatch(album, { ...options,
      associated: Boolean(editionLink(saved, album, provider, links)) }), true);
    assert.equal(localCollectionMatch({ ...album, rating: 4 }, { ...options, unrated: true }), false);
    assert.equal(localCollectionMatch(album, { ...options, missingAssociation: false, associated }), true);
  }
});

test("new Spotify and Qobuz associations open native targets and pass the service filter", async () => {
  const album = { ...source, id: "tidal:12", url: "https://tidal.com/browse/album/12" };
  for (const [provider, id, url] of [["spotify", "B".repeat(22), `https://open.spotify.com/album/${"B".repeat(22)}`],
    ["qobuz", "qobuz:abc123", "https://play.qobuz.com/album/abc123"]]) {
    const saved = storage(); saved.setItem(key, JSON.stringify({ albums: [album], base: [] }));
    const plan = await prepareAssociations([album], {}, provider, async () => page([{ ...source, id }]));
    saved.setItem(linkKey, JSON.stringify(associationUpdates(plan, [album], {})));
    const linked = editionLink(saved, album, provider);
    assert.equal(linked.id, id); assert.equal(linked.url, url);
    assert.equal(localCollectionMatch(album, { service: provider, associated: Boolean(linked) }), true);
    assert.deepEqual(collectionHealthSummary([album], {
      editionLinks: JSON.parse(saved.getItem(linkKey)),
    }).malformedEditionIds, []);
    setEditionLink(saved, album, provider);
    assert.equal(editionLink(saved, album, provider), null);
  }
});

test("bulk links are one undoable history operation and album values stay unchanged", async () => {
  const saved = storage(), collection = { albums: [source], base: [] };
  saved.setItem(key, JSON.stringify(collection));
  const plan = await prepareAssociations([source], {}, "tidal", async () => page());
  const updates = associationUpdates(plan, [source], {});
  commitLocalRestore(saved, key, collection, collection, { [linkKey]: updates }, "Associazioni TIDAL");
  const after = JSON.parse(saved.getItem(key));
  assert.deepEqual(after.albums, [source]);
  assert.equal(after.collectionHistory.length, 1);
  const restored = prepareCollectionHistoryRestore(after.albums, after.collectionHistory[0], updates, { [linkKey]: updates });
  assert.deepEqual(restored.storageUpdates[linkKey], {});
  assert.deepEqual(restored.albums, [source]);
});

test("failed local persistence rolls back the complete batch", async () => {
  const saved = storage(), collection = { albums: [source], base: [] };
  saved.setItem(key, JSON.stringify(collection));
  const before = saved.getItem(key), originalSet = saved.setItem;
  saved.setItem = (name, value) => { if (name === linkKey) throw new Error("Storage full"); originalSet(name, value); };
  const plan = await prepareAssociations([source], {}, "tidal", async () => page());
  assert.throws(() => commitLocalRestore(saved, key, collection, collection,
    { [linkKey]: associationUpdates(plan, [source], {}) }), /Storage full/);
  assert.equal(saved.getItem(key), before);
  assert.equal(saved.getItem(linkKey), null);
});

test("dialog defers writes until explicit apply and waits for an in-flight read when cancelled", async () => {
  const previous = globalThis.document;
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.open = false; }
    setAttribute() {}
    append(...nodes) { this.children.push(...nodes); }
    addEventListener(name, callback) { this.events[name] = callback; }
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    remove() {}
  }
  globalThis.document = { createElement: tag => new Node(tag), body: new Node("body") };
  try {
    let writes = 0, closed = 0, release;
    const dialog = openAssociationDialog({ albums: [source], links: {}, provider: "tidal",
      search: () => new Promise(resolve => { release = resolve; }), guard() {},
      save() { writes += 1; }, report() {}, closed() { closed += 1; } });
    const [start, apply, cancel] = dialog.children.at(-1).children;
    const task = start.events.click();
    assert.equal(start.disabled, true); assert.equal(apply.disabled, true);
    cancel.events.click(); assert.equal(dialog.open, true);
    release(page()); await task;
    assert.equal(dialog.open, false); assert.equal(closed, 1); assert.equal(writes, 0);

    const hidden = { ...source, id: "B".repeat(22), name: "Hidden" };
    const next = openAssociationDialog({ albums: [source, hidden], targetIds: [source.id],
      links: {}, provider: "tidal", search: async album => {
        assert.equal(album.id, source.id); return page();
      }, guard() {}, save(plan) {
        assert.deepEqual(plan.rows.map(row => row.album.id), [source.id]);
        assert.equal(plan.albums.length, 2);
        writes += 1;
      }, report() {}, closed() {} });
    assert.match(next.children[1].textContent, /1 album nei filtri attivi/);
    const [prepare, confirm] = next.children.at(-1).children;
    await prepare.events.click(); assert.equal(writes, 0); assert.equal(confirm.disabled, false);
    confirm.events.click(); confirm.events.click();
    assert.equal(writes, 1);
  } finally { globalThis.document = previous; }
});
