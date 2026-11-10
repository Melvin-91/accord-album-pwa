import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { nativeMusicLink } from "./music-app-links.mjs";
import { tidalAlbumId } from "./tidal.mjs";
import { associationUpdates, openAssociationDialog, openEditionAssociationDialog, openEditionChooser,
  playbackEditions, openPlaybackServiceDialog,
  associationLinkId, prepareAssociations } from "./album-association.mjs";
import { editionLink, setEditionLink, sourceIdentity } from "./music-continuity.mjs";
import { localCollectionMatch } from "./music-qol.mjs";
import { LIBRARY_CHOICES_KEY, readLibraryChoices, manuallyUnavailable } from "./music-library-choices.mjs";
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

test("alternate playback uses only known native/current editions and never switches the main service", () => {
  const saved = storage();
  saved.setItem("accord-music-service-v1", "qobuz");
  saved.setItem(linkKey, JSON.stringify({ [source.id]: {
    tidal: { id: candidate.id, name: candidate.name, source: sourceIdentity(source) },
    qobuz: { id: "qobuz:old", name: source.name, source: "obsolete" },
  } }));
  assert.deepEqual(playbackEditions(saved, source).map(row => row.provider), ["spotify", "tidal"]);
  assert.deepEqual(playbackEditions(storage(), { ...source, id: "qobuz:native",
    url: "https://play.qobuz.com/album/native" }).map(row => row.provider), ["qobuz"]);
  const invalid = storage();
  invalid.setItem(linkKey, JSON.stringify({ [source.id]: {
    tidal: { id: "spotify:wrong", name: source.name, source: sourceIdentity(source) },
  } }));
  assert.throws(() => playbackEditions(invalid, source), /non valida/);
  const previous = globalThis.document;
  class Node {
    constructor() { this.children = []; this.events = {}; }
    setAttribute() {}
    append(...nodes) { this.children.push(...nodes); }
    addEventListener(name, callback) { this.events[name] = callback; }
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    remove() {}
  }
  globalThis.document = { createElement: () => new Node(), body: new Node() };
  try {
    const dialog = openPlaybackServiceDialog({ storage: saved, album: source, provider: "qobuz", report() {} });
    const spotify = dialog.children[2].children[0], tidal = dialog.children[3].children[0];
    assert.equal(spotify.href, `spotify:album:${source.id}`);
    assert.equal(tidal.href, "tidal://album/123");
    assert.equal(saved.getItem("accord-music-service-v1"), "qobuz");
    const links = JSON.parse(saved.getItem(linkKey)); delete links[source.id].tidal;
    saved.setItem(linkKey, JSON.stringify(links));
    let prevented = false;
    tidal.events.click({ preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
    assert.equal(prevented, true);
    assert.equal(dialog.open, true);
    dialog.children.at(-1).events.click();
    assert.equal(dialog.open, false);
    assert.equal(saved.getItem("accord-music-service-v1"), "qobuz");
    const empty = openPlaybackServiceDialog({ storage: storage(), album: source, provider: "spotify", report() {} });
    assert.match(empty.children[2].textContent, /Non ci sono altri servizi/);
    assert.equal(empty.children.some(node => node.href), false);
    empty.children.at(-1).events.click();
    assert.equal(empty.open, false);
  } finally { globalThis.document = previous; }
});

test("the reported TIDAL shared link is canonicalized for catalog reading and native opening", () => {
  for (const value of ["https://tidal.com/album/490869886/u",
    "https://tidal.com/browse/album/490869886/u/", "https://listen.tidal.com/album/490869886/u?shared=1"]) {
    assert.equal(tidalAlbumId(value), "490869886");
    assert.equal(nativeMusicLink(value), "tidal://album/490869886");
  }
  for (const value of ["https://tidal.com/album/490869886/u/extra",
    "https://tidal.com.evil.test/album/490869886/u", "https://evil@tidal.com/album/490869886/u",
    "https://tidal.com/track/490869886/u"]) assert.throws(() => tidalAlbumId(value));
});

test("album links must belong to the selected service, never tracks, playlists or lookalike hosts", () => {
  for (const [provider, value, id] of [
    ["spotify", `https://open.spotify.com/album/${source.id}?si=shared`, source.id],
    ["tidal", "https://listen.tidal.com/album/123?u=shared", "tidal:123"],
    ["tidal", "https://tidal.com/album/490869886/u", "tidal:490869886"],
    ["qobuz", "https://open.qobuz.com/album/demo", "qobuz:demo"],
  ]) {
    assert.equal(associationLinkId(provider, value), id);
    for (const other of ["spotify", "tidal", "qobuz"].filter(item => item !== provider)) {
      assert.throws(() => associationLinkId(other, value));
    }
  }
  for (const value of ["https://tidal.com/track/123", "https://tidal.com/playlist/123",
    "https://evil.test/album/123", "https://evil@tidal.com/album/123",
    "https://tidal.com/album/123/unknown", "https://tidal.com.evil.test/album/123/u"]) {
    assert.throws(() => associationLinkId("tidal", value));
  }
});

test("link chooser reads exact album metadata before confirmation and ignores cancelled reads", async () => {
  const previous = globalThis.document;
  class Node {
    constructor() { this.children = []; this.events = {}; }
    setAttribute() {}
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    addEventListener(name, callback) { this.events[name] = callback; }
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    remove() {}
  }
  globalThis.document = { createElement: () => new Node(), body: new Node() };
  try {
    for (const [provider, id, url] of [["spotify", source.id, source.url],
      ["tidal", candidate.id, candidate.url], ["qobuz", "qobuz:demo", "https://play.qobuz.com/album/demo"]]) {
      let reads = 0, selected = 0;
      const dialog = openEditionChooser({ provider,
        load: async value => { reads++; assert.equal(value, id); return { ...source, id }; },
        selected: record => { selected++; assert.equal(record.id, id); } });
      dialog.children[4].children[0].value = url;
      const read = dialog.children[4].children[1];
      assert.equal(reads, 0); assert.equal(selected, 0);
      await read.events.click();
      assert.equal(reads, 1); assert.equal(selected, 0); assert.equal(dialog.open, true);
      dialog.children[6].children[0].children[1].events.click();
      assert.equal(selected, 1); assert.equal(dialog.open, false);
    }
    let release, selected = 0;
    const dialog = openEditionChooser({ provider: "tidal",
      load: () => new Promise(resolve => { release = resolve; }), selected: () => { selected++; } });
    const [input, read] = dialog.children[4].children, [compare, cancel] = dialog.children.at(-1).children;
    input.value = source.url;
    await read.events.click();
    assert.match(dialog.children[5].textContent, /servizio scelto/);
    input.value = candidate.url;
    const pending = read.events.click();
    cancel.events.click(); release(candidate); await pending;
    assert.equal(selected, 0);
  } finally { globalThis.document = previous; }
});

test("manual association saves without opening by default and opens only with explicit consent", () => {
  const previous = globalThis.document;
  class Node {
    constructor() { this.children = []; this.events = {}; }
    setAttribute() {}
    append(...nodes) { this.children.push(...nodes); }
    addEventListener(name, callback) { this.events[name] = callback; }
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    remove() {}
  }
  globalThis.document = { createElement: () => new Node(), body: new Node() };
  try {
    for (const provider of ["tidal", "qobuz"]) for (const action of ["save", "open", "cancel", "failed"]) {
      const calls = [], errors = [];
      const dialog = openEditionAssociationDialog({
        album: source, edition: candidate, provider,
        save() { if (action === "failed") throw new Error("Storage full"); calls.push("save"); },
        open() { calls.push("open"); }, report(message, error) { if (error) errors.push(message); },
      });
      const check = dialog.children[2].children[0];
      assert.equal(check.checked, false);
      check.checked = action !== "save";
      const [confirm, cancel] = dialog.children.at(-1).children;
      if (action === "cancel") cancel.events.click();
      else { confirm.events.click(); if (action !== "failed") confirm.events.click(); }
      assert.deepEqual(calls, action === "open" ? ["save", "open"] : action === "save" ? ["save"] : []);
      assert.equal(dialog.open, action === "failed");
      assert.equal(errors.length, action === "failed" ? 1 : 0);
    }
  } finally { globalThis.document = previous; }
});

test("one chooser keeps catalog search and shared album links together for all three services", async () => {
  const previous = globalThis.document;
  class Node {
    constructor() { this.children = []; this.events = {}; }
    setAttribute() {}
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    addEventListener(name, callback) { this.events[name] = callback; }
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    remove() {}
  }
  globalThis.document = { createElement: () => new Node(), body: new Node() };
  try {
    for (const [provider, id, url] of [["spotify", source.id, source.url],
      ["tidal", "tidal:490869886", "https://tidal.com/album/490869886/u"],
      ["qobuz", "qobuz:demo", "https://open.qobuz.com/album/demo"]]) {
      let searches = 0, reads = 0, selected = 0;
      const album = { ...source, id };
      const dialog = openEditionChooser({ provider, query: "Band Album",
        search: async query => {
          assert.equal(query, "Band Album"); searches++; return { albums: [album], complete: false };
        },
        load: async value => { reads++; assert.equal(value, id); return album; },
        selected: record => { selected++; assert.equal(record.id, id); } });
      assert.equal(dialog.children[2].children[0].value, "Band Album");
      assert.equal(dialog.children[4].children[0].type, "text");
      await dialog.children[3].events.click();
      assert.equal(searches, 1); assert.equal(dialog.open, true); assert.equal(selected, 0);
      assert.match(dialog.children[5].textContent, /parziali/);
      assert.equal(dialog.children[6].children.length, 1);
      dialog.children[4].children[0].value = url;
      await dialog.children[4].children[1].events.click();
      assert.equal(reads, 1); assert.equal(dialog.open, true); assert.equal(selected, 0);
      assert.equal(dialog.children[6].children.length, 1);
      dialog.children[6].children[0].children[1].events.click();
      assert.equal(selected, 1); assert.equal(dialog.open, false);
    }
    assert.equal(globalThis.document.body.children.length, 3);
  } finally { globalThis.document = previous; }
});

test("manual association app callback revalidates the service at confirmation and uses native opening", () => {
  const code = readFileSync(new URL("./app.mjs", import.meta.url), "utf8");
  const start = code.indexOf("function chooseCollectionEdition(");
  const end = code.indexOf("\nlet collectionAssociationOpen", start);
  let options, linkOptions, saved = 0, opened = 0, changed = false;
  const context = {
    musicService: { service: "tidal", epoch: 1, assert() { if (changed) throw new Error("Servizio cambiato"); } },
    state: { albums: [source] }, localStorage: storage(),
    tidalUI: { suggestionAPI: { revision: () => 1 } },
    openEditionChooser(value) { linkOptions = value; },
    openEditionAssociationDialog(value) { options = value; }, showFeedback() {},
    setEditionLink() { saved += 1; }, selectMusicView() {}, render() {},
    editionLink() { return candidate; },
    document: { createElement: () => ({ click() { opened += 1; } }) },
    configureMusicAppLink(link, url) { assert.equal(url, candidate.url); return link; },
  };
  runInNewContext(`${code.slice(start, end)}\nchooseCollectionEdition(state.albums[0]);`, context);
  linkOptions.selected(candidate);
  assert.equal(saved, 0); assert.equal(opened, 0);
  options.save(); assert.equal(saved, 1); assert.equal(opened, 0);
  options.open(); assert.equal(opened, 1);
  changed = true;
  assert.throws(() => options.save(), /Servizio cambiato/);
  assert.equal(saved, 1);
  assert.throws(() => options.open(), /Servizio cambiato/);
  assert.equal(opened, 1);
});

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
      LIBRARY_CHOICES_KEY, readLibraryChoices, manuallyUnavailable,
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

test("the app reads link metadata from the selected provider only, without saving before confirmation", async () => {
  const code = readFileSync(new URL("./app.mjs", import.meta.url), "utf8");
  const start = code.indexOf("function chooseCollectionEdition(");
  const end = code.indexOf("\nlet collectionAssociationOpen", start);
  for (const [provider, id] of [["spotify", source.id], ["tidal", candidate.id], ["qobuz", "qobuz:demo"]]) {
    let options, confirmation, reads = [], saves = 0;
    const record = { ...source, id };
    const api = name => ({ revision: () => 1,
      album: async value => { reads.push(name); assert.equal(value, id); return record; },
      search: async query => { reads.push(name); assert.equal(query, "Band Album"); return { rows: [{ album: record }], complete: true }; } });
    const context = {
      state: { albums: [source] }, localStorage: storage(),
      musicService: { service: provider, epoch: 1, assert() {} },
      tidalUI: { suggestionAPI: api("tidal") }, qobuzUI: { suggestionAPI: api("qobuz") },
      spotifyAccessToken: async () => "synthetic",
      spotifyRequest: async path => { reads.push("spotify"); assert.equal(path, `albums/${id}`); return record; },
      spotifyAlbumSearchRecords: values => [values[0].item.album],
      URLSearchParams,
      spotifySearchRequest: async parameters => {
        reads.push("spotify"); assert.equal(parameters.get("q"), "Band Album");
        return { albums: { items: [record], total: 1 } };
      },
      openEditionChooser: value => { options = value; },
      openEditionAssociationDialog: value => { confirmation = value; },
      setEditionLink() { saves++; }, selectMusicView() {}, render() {}, showFeedback() {},
    };
    runInNewContext(`${code.slice(start, end)}\nchooseCollectionEdition(state.albums[0]);`, context);
    const loaded = await options.load(id);
    options.selected(loaded);
    assert.deepEqual(reads, [provider]); assert.equal(saves, 0);
    const results = await options.search("Band Album");
    assert.equal(results.albums[0].id, id);
    assert.deepEqual(reads, [provider, provider]); assert.equal(saves, 0);
    assert.equal(confirmation.edition.id, id);
    confirmation.save();
    assert.equal(saves, 1);
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
  let calls = 0;
  const plan = await prepareAssociations([source, { ...source, id: "B".repeat(22) }], {}, "tidal", () => {
    calls++; throw new Error("HTTP 429");
  });
  assert.equal(calls, 1);
  assert.deepEqual(plan.rows.map(row => row.state), ["error"]);
  assert.equal(plan.rows[0].selected, null);
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
