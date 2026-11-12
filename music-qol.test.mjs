import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { suggestDurationQueue, localCollectionMatch, listeningStep, selectionVisibility, reviewManualGenres,
  appendListeningActions } from "./music-qol.mjs";
import { filterAlbums, validateAlbum } from "./core.mjs";
import {
  visibleSelection, prepareAlbumReview, batchAlbumChanges, appendCollectionHistory,
  collectionHealthSummary, commitLocalRestore, createCollectionHistoryEntry,
  prepareCollectionHistoryRestore,
  selectCollectionAlbum,
  runPlatformAccessChecks,
  userFacingStatus,
  installDialogLayout,
  installCollectionLayout,
} from "./ui.mjs";

const app = readFileSync(new URL("./app.mjs", import.meta.url), "utf8");

test("collection options keep every control connected and only one panel open", () => {
  const observers = [];
  class Node {
    constructor(tag, id = "", className = "") {
      this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.dataset = {};
      this.events = {}; this.attributes = {}; this.hidden = false; this.open = false;
      const classes = new Set(className.split(/\s+/));
      this.classList = { add: (name) => classes.add(name), contains: (name) => classes.has(name) };
      Object.defineProperty(this, "className", { set: (value) => {
        classes.clear(); value.split(/\s+/).forEach((name) => classes.add(name));
      } });
    }
    matches(selector) {
      return selector.startsWith(".") ? this.classList.contains(selector.slice(1))
        : selector.startsWith("#") ? this.id === selector.slice(1) : this.tagName === selector.toUpperCase();
    }
    querySelector(selector) {
      const selectors = selector.split(",").map((value) => value.trim());
      for (const child of this.children) {
        if (selectors.some((value) => child.matches(value))) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    }
    detach(node) {
      if (node.parentElement) node.parentElement.children =
        node.parentElement.children.filter((child) => child !== node);
      node.parentElement = this;
    }
    append(...nodes) { nodes.forEach((node) => { this.detach(node); this.children.push(node); }); }
    prepend(...nodes) { nodes.forEach((node) => this.detach(node)); this.children.unshift(...nodes); }
    before(node) {
      const parent = this.parentElement; parent.detach(node);
      parent.children.splice(parent.children.indexOf(this), 0, node);
    }
    after(node) {
      const parent = this.parentElement; parent.detach(node);
      parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.events[name] = callback; }
    focus() { document.activeElement = this; }
  }
  const root = new Node("main"), panel = new Node("section", "collectionPanel");
  const service = new Node("section", "", "music-service-picker");
  root.append(service, panel);
  const document = {
    createElement: (tag) => new Node(tag), createComment: () => new Node("comment"),
    getElementById: (id) => root.querySelector(`#${id}`), querySelector: (selector) => root.querySelector(selector),
    addEventListener(name, callback) { this[name] = callback; },
    defaultView: { MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target) { this.target = target; }
    } },
  };
  const toolbar = new Node("section", "", "playlist-import");
  const quickFilters = new Node("div", "quickCollectionFilters");
  const actions = new Node("div", "", "playlist-import-actions");
  const manual = new Node("button", "manualAlbumButton"); actions.append(manual);
  toolbar.append(new Node("div"), actions);
  const filters = new Node("details", "collectionFilters");
  const reviewAssociations = new Node("button", "reviewMusicAssociations");
  const count = new Node("span", "activeFilterCount");
  filters.append(count, reviewAssociations);
  const view = new Node("details", "viewMenu"), content = new Node("div", "", "view-menu-content");
  const playlist = new Node("button", "playlistImportButton");
  const saved = new Node("label"), savedSelect = new Node("select", "savedCollectionView");
  saved.append(savedSelect); content.append(playlist, saved); view.append(content);
  const storage = new Node("details", "", "collection-storage-details");
  const selection = new Node("section", "selectionToolbar");
  const selectionSummary = new Node("div", "", "selection-summary");
  const selectedCount = new Node("strong", "selectionCount"), clear = new Node("button", "clearSelectionButton");
  selectionSummary.append(selectedCount, clear);
  const primary = new Node("div", "", "selection-primary");
  const genres = new Node("button", "bulkGenresButton"), bulk = new Node("button", "bulkEditButton");
  primary.append(genres, bulk);
  const secondary = new Node("details", "", "selection-secondary");
  const options = new Node("div", "", "selection-options");
  const apply = new Node("button", "applyBulkStatus"); options.append(apply); secondary.append(options);
  selection.append(selectionSummary, primary, secondary);
  panel.append(toolbar, quickFilters, new Node("div", "", "collection-search"), filters, view, storage, selection,
    new Node("p", "", "selection-help"));
  const records = new Map([manual, playlist, count, savedSelect, genres, bulk, clear, selectedCount, apply].map((node) => [node.id, node]));
  for (const id of ["collectionFilterChips", "tidalCollectionMount", "unratedSummary", "manualOrderHint",
    "coverSyncNotice", "albumList", "emptyState", "collectionSummary"]) {
    const node = new Node("section", id); records.set(id, node); panel.append(node);
  }
  const controller = installCollectionLayout(document);
  assert.equal(quickFilters.parentElement, toolbar);
  assert.equal(reviewAssociations.parentElement.id, "collectionCatalogTools");
  assert.equal(playlist.parentElement.tagName, "DETAILS");
  assert.deepEqual(root.querySelector(".collection-tools-content").children
    .map(group => group.children[0].textContent), ["Ascolto", "Catalogo e dati", "Salvataggio"]);
  for (const [id, node] of records) assert.equal(document.getElementById(id), node, id);
  const aside = document.getElementById("collectionOptions");
  assert.equal(aside.hidden, true);
  assert.equal(selection.parentElement.classList.contains("collection-results-footer"), true);
  assert.deepEqual(primary.children.map((node) => node.id), ["bulkGenresButton", "collectionSelectionToggle"]);
  assert.equal(bulk.parentElement, options);
  assert.equal(clear.parentElement, options);
  for (const key of ["filters", "view", "import", "state", "selection"]) {
    controller.show(key);
    assert.equal(aside.hidden, false);
    const pages = aside.querySelector(".collection-options-scroll").children;
    assert.equal(pages.filter((node) => node.open && !node.hidden).length, 1);
    assert.equal(document.getElementById("albumList").parentElement.classList.contains("collection-results"), true);
  }
  selection.hidden = true; observers.find((observer) => observer.target === selection).callback();
  assert.equal(aside.hidden, true);
  filters.open = true; filters.events.toggle();
  assert.equal(aside.hidden, false);
  document.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(aside.hidden, true);
  assert.equal(document.activeElement.id, "collectionFiltersToggle");
  controller.show("import");
  controller.close();
  assert.equal(document.activeElement.id, "collectionViewToggle");
  panel.hidden = true; controller.updateView();
  assert.equal(service.parentElement, root);
  panel.hidden = false; controller.updateView();
  assert.equal(service.parentElement, actions);
});

test("quick collection filters use the standard controls and discard retired saved filter flags", () => {
  const selectors = ["#favoritesOnlyFilter", "#statusFilter", "#unratedFilter", "#missingDurationFilter",
    "#unavailableOnlyFilter", "#deferredOnlyFilter", "#quickFavoritesFilter", "#quickQueuedFilter", "#quickUnratedFilter"];
  const nodes = Object.fromEntries(selectors.map(selector => [selector, {
    checked: selector.includes("OnlyFilter") || selector === "#missingDurationFilter",
    value: "", attributes: {}, listeners: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
  }]));
  const context = { $: selector => nodes[selector] };
  const source = app.slice(app.indexOf("function updateQuickCollectionFilters("), app.indexOf("function render(options"));
  const functions = runInNewContext(`${source}\n({ updateQuickCollectionFilters, bindQuickCollectionFilters })`, context);
  context.render = () => functions.updateQuickCollectionFilters();
  functions.bindQuickCollectionFilters();
  functions.updateQuickCollectionFilters();
  for (const selector of ["#missingDurationFilter", "#unavailableOnlyFilter", "#deferredOnlyFilter"]) {
    assert.equal(nodes[selector].checked, false);
  }
  assert.equal(nodes["#quickFavoritesFilter"].attributes["aria-pressed"], "true");
  nodes["#quickFavoritesFilter"].listeners.click();
  assert.equal(nodes["#favoritesOnlyFilter"].checked, false);
  nodes["#quickQueuedFilter"].listeners.click();
  assert.equal(nodes["#statusFilter"].value, "queued");
  assert.equal(nodes["#quickQueuedFilter"].attributes["aria-pressed"], "true");
  nodes["#statusFilter"].value = "liked";
  functions.updateQuickCollectionFilters();
  assert.equal(nodes["#quickQueuedFilter"].attributes["aria-pressed"], "false");
});

test("dynamic dialogs preserve their form and actions outside the scrollable content", () => {
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {};
      const classes = new Set();
      this.classList = { add: (value) => classes.add(value), contains: (value) => classes.has(value) };
      Object.defineProperty(this, "className", { set: (value) => {
        classes.clear(); value.split(/\s+/).forEach((entry) => classes.add(entry));
      } });
    }
    append(...nodes) {
      for (const node of nodes) {
        if (node.parentElement) node.parentElement.children = node.parentElement.children.filter((child) => child !== node);
        node.parentElement = this; this.children.push(node);
      }
    }
    replaceChildren(...nodes) {
      this.children.forEach((node) => { node.parentElement = null; });
      this.children = []; this.append(...nodes);
    }
    querySelector() { return this.children.find((node) => node.classList.contains("dialog-scroll")); }
  }
  let observer;
  const document = { createElement: (tag) => new Node(tag), defaultView: { MutationObserver: class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {} disconnect() { this.disconnected = true; }
  } } };
  const dialog = new Node("dialog"), form = new Node("form"), title = new Node("h2");
  const input = new Node("input"), preview = new Node("pre"), prepare = new Node("button");
  const confirm = new Node("button"), cancel = new Node("button");
  form.append(input, prepare, preview, confirm);
  dialog.append(title, form, cancel);
  const root = { ownerDocument: document, querySelectorAll: () => [dialog] };
  const stop = installDialogLayout(root);
  assert.equal(dialog.children[0], form);
  assert.deepEqual(form.children[0].children, [title, input, preview]);
  assert.deepEqual(form.children[1].children, [prepare, confirm, cancel]);
  observer.callback([{ addedNodes: [preview] }]);
  assert.equal(form.children.length, 2);
  stop();
  assert.equal(observer.disconnected, true);
});

test("technical presentation keeps useful results and actions while hiding SQL and HTTP diagnostics", () => {
  assert.equal(userFacingStatus("3 album salvati\nUPDATE albums SET title='x'\nDettagli tecnici: Error; HTTP 503"), "3 album salvati");
  const failed = userFacingStatus("Accesso rifiutato (HTTP 403).\nVerifica il collegamento prima di ripetere.");
  assert.match(failed, /Accesso rifiutato/);
  assert.match(failed, /Verifica il collegamento/);
  assert.doesNotMatch(failed, /HTTP/);
});

test("startup checks skip missing connections, retain failures, and reject changed accounts", async () => {
  let identity = "account-a";
  const results = new Map();
  let missingReads = 0;
  await runPlatformAccessChecks([
    { key: "missing", identity: () => "", configured: () => false, check: () => missingReads++ },
    { key: "failure", identity: () => "a", configured: () => true, check: async () => { throw new Error("Refused"); } },
    { key: "changed", identity: () => identity, configured: () => true, check: async () => {
      identity = "account-b"; return { account: "old account" };
    } },
    { key: "ok", identity: () => "a", configured: () => true, check: async () => ({ account: "verified" }) },
  ], (key, result) => results.set(key, result));
  assert.equal(missingReads, 0);
  assert.match(results.get("missing").state, /non eseguita/);
  assert.equal(results.get("failure").state, "Verifica non riuscita");
  assert.match(results.get("changed").detail, /Configurazione cambiata/);
  assert.equal(results.get("changed").account, undefined);
  assert.equal(results.get("ok").account, "verified");
});
function appSection(start, end) {
  const index = app.indexOf(start);
  assert.notEqual(index, -1);
  return app.slice(index, app.indexOf(end, index));
}

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.value = ""; this.checked = false; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, fn) { this.events[name] = fn; }
  add(option) { this.children.push(option); if (!this.value) this.value = option.value; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() {}
  focus() {}
}

test("plain selection replaces hidden or visible members; only control-click toggles membership", () => {
  let selected = new Set(["hidden", "a"]);
  selected = selectCollectionAlbum(selected, "b");
  assert.deepEqual([...selected], ["b"]);
  selected = selectCollectionAlbum(selected, "a", true);
  assert.deepEqual([...selected], ["b", "a"]);
  selected = selectCollectionAlbum(selected, "b", true);
  assert.deepEqual([...selected], ["a"]);
  assert.deepEqual([...selectCollectionAlbum(selected, "a")], ["a"]);
  const checkbox = new Element("input");
  const card = { dataset: { albumId: "b" }, querySelector: () => checkbox };
  const context = { selectedAlbumIds: new Set(["hidden"]), collectionSelectionAnchor: null,
    visibleAlbums: [{ id: "a" }, { id: "b" }, { id: "c" }], selectCollectionAlbum,
    $: () => ({ children: [card] }), updateSelectionToolbar: () => {} };
  runInNewContext(appSection("function selectAlbumCard(", "\n$(\"#showSelectionButton\")")
    + '\nselectAlbumCard("b", { ctrlKey: false })', context);
  assert.deepEqual([...context.selectedAlbumIds], ["b"]);
  assert.equal(checkbox.checked, true);
  runInNewContext(appSection("function selectAlbumCard(", "\n$(\"#showSelectionButton\")")
    + '\nselectAlbumCard("c", { shiftKey: true });', context);
  assert.deepEqual([...context.selectedAlbumIds], ["b", "c"]);
  runInNewContext(appSection("function selectAlbumCard(", "\n$(\"#showSelectionButton\")")
    + '\nselectAlbumCard("a", { shiftKey: true, ctrlKey: true });', context);
  assert.deepEqual(new Set(context.selectedAlbumIds), new Set(["a", "b", "c"]));
  context.visibleAlbums = [{ id: "c" }, { id: "a" }, { id: "b" }];
  runInNewContext(appSection("function selectAlbumCard(", "\n$(\"#showSelectionButton\")")
    + '\nselectAlbumCard("a", { shiftKey: true });', context);
  assert.deepEqual([...context.selectedAlbumIds], ["a", "b"]);
  context.visibleAlbums = [{ id: "c" }, { id: "a" }];
  runInNewContext(appSection("function selectAlbumCard(", "\n$(\"#showSelectionButton\")")
    + '\nselectAlbumCard("c", { shiftKey: true });', context);
  assert.deepEqual([...context.selectedAlbumIds], ["c"]);
  assert.equal(context.collectionSelectionAnchor, "c");
  assert.deepEqual([...selectCollectionAlbum(new Set(["hidden"]), "c", false, ["a", "b", "c"])], ["a", "b", "c"]);
});

test("dedicated multiple genre editor uses the existing guarded preview without changing other fields", () => {
  const albums = ["a", "b"].map((id) => validateAlbum({
    id, name: id, artist: "Band", url: `https://open.spotify.com/album/${id}`,
    year: "", status: "liked", rating: 4, genres: id === "a" ? ["Rock"] : [],
    collections: [], tags: ["Keep"], notes: "", primary_genre: id === "a" ? "Rock" : "", cover_sha256: null,
  }));
  let form, build;
  const body = new Element("body");
  const context = { document: { body, createElement: (tag) => new Element(tag) },
    Option: class { constructor(text, value) { this.textContent = text; this.value = value; } },
    selectedAlbumIds: new Set(["a", "b"]), visibleAlbums: albums, state: { albums },
    labels: { liked: "Piaciuto" }, selectionVisibility, prepareAlbumReview, batchAlbumChanges, validateAlbum,
    reviewManualGenres, localStorage: { getItem: () => null }, COMPLETION_PROVENANCE_KEY: "provenance",
    appendAlbumReview: (target, _dialog, builder) => { form = target; build = builder; } };
  runInNewContext(appSection("function openBulkEditor(", "\nfunction appendAlbumReview(")
    + "\nopenBulkEditor({}, { genresOnly: true })", context);
  assert.equal(body.children[0].children[0].textContent, "Generi di 2 album");
  const rows = form.children.filter((child) => child.className === "qol-bulk-row");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].children[1].checked, true);
  rows[0].children[2].value = "Jazz";
  const review = build();
  assert.deepEqual(review.next[0].genres, ["Rock", "Jazz"]);
  assert.deepEqual(review.next[1].genres, ["Jazz"]);
  assert.equal(review.next[0].rating, 4);
  assert.deepEqual(review.next[0].tags, ["Keep"]);
  assert.equal(review.related.provenance.a.genres.source, "manual");
  context.selectedAlbumIds.delete("b");
  assert.throws(build, /Selezione cambiata/);
});

test("local criteria combine with title/artist and distinguish missing durations, empty notes and catalog identity", () => {
  const albums = [
    { id: "tidal:12", url: "https://tidal.com/album/12", name: "Moon", artist: "Band", rating: null,
      genres: [], collections: [], tags: [], notes: "My note" },
    { id: "qobuz:12", url: "https://play.qobuz.com/album/12", name: "Moon", artist: "Band", rating: null,
      genres: [], collections: [], tags: [], notes: "My note" },
  ];
  const criteria = { unrated: true, missingDuration: true, notesPresent: true, service: "tidal" };
  const result = filterAlbums(albums, { search: "Band Moon" }).filter((album) => localCollectionMatch(album, criteria));
  assert.deepEqual(result.map((album) => album.id), ["tidal:12"]);
  assert.deepEqual(filterAlbums(albums, { search: "Moon" }).filter((album) =>
    localCollectionMatch(album, criteria)).map((album) => album.id), ["tidal:12"]);
  assert.equal(localCollectionMatch(albums[0], { ...criteria, durations: { "tidal:12": 100 } }), false);
  assert.equal(localCollectionMatch({ ...albums[0], notes: " " }, criteria), false);
  assert.equal(localCollectionMatch({ ...albums[0], rating: 0.5 }, criteria), false);
  assert.equal(localCollectionMatch({ ...albums[0], id: "mb:12", url: "https://musicbrainz.org/release/12" },
    { service: "other" }), true);
});

test("listening progress never deduces status from a personal rating or player", () => {
  assert.equal(listeningStep({ status: "queued", rating: 5 }), "Da ascoltare");
  assert.equal(listeningStep({ status: "neutral", rating: null }), "Ascoltato");
  assert.equal(listeningStep({ status: "disliked", rating: 0.5 }), "Valutato");
  assert.equal(listeningStep({ status: "listening", rating: null }), "In ascolto");
});

test("card and details listening controls are local, explicit, target stable IDs and preserve existing opinions", () => {
  const doc = { createElement: (tag) => new Element(tag) };
  for (const status of ["queued", "neutral", "liked", "disliked"]) {
    const calls = [], container = new Element("div");
    const album = { id: "tidal:12", name: "Album", status, rating: null };
    const actions = appendListeningActions(container, album, {
      document: doc, markListened: (id) => calls.push(["listened", id]), rate: (id) => calls.push(["rate", id]),
    });
    assert.deepEqual(calls, []);
    assert.equal(actions.children[1].disabled, status !== "queued");
    if (!actions.children[1].disabled) actions.children[1].events.click();
    actions.children[2].events.click();
    assert.deepEqual(calls.at(-1), ["rate", "tidal:12"]);
    assert.equal(album.status, status);
    assert.equal(album.rating, null);
  }
});

test("selection toolbar keeps hidden IDs, shows counts, reveals selection and removes only hidden members", () => {
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, new Element("div"));
    return elements.get(id);
  };
  let renders = 0;
  const localChecks = ["#unratedFilter", "#missingDurationFilter", "#notesPresentFilter", "#missingAssociationFilter"];
  const context = { $, document: { createElement: (tag) => new Element(tag) }, selectedAlbumIds: new Set(["a", "b"]),
    visibleAlbums: [{ id: "b" }], visibleSelection, selectionVisibility, collectionSelectionOnly: false,
    localCollectionChecks: localChecks, localFacet: null, appliedCollectionSearch: "Album",
    render: () => { renders += 1; }, fetch: () => assert.fail("Unexpected network") };
  runInNewContext(appSection("function resetCollectionFilters(", "\nfunction openLocalFacet("), context);
  runInNewContext(appSection("function updateSelectionToolbar(", "\nfunction removeSelectedAlbums("), context);
  runInNewContext("updateSelectionToolbar()", context);
  assert.match($("#selectionCount").textContent, /2 selezionati, 1 nascosti/);
  assert.deepEqual([...context.selectedAlbumIds], ["a", "b"]);
  $("#showSelectionButton").events.click();
  assert.equal(context.collectionSelectionOnly, true);
  assert.deepEqual([...context.selectedAlbumIds], ["a", "b"]);
  $("#dropHiddenSelectionButton").events.click();
  assert.deepEqual([...context.selectedAlbumIds], ["b"]);
  assert.equal(renders, 2);
  context.selectedAlbumIds = visibleSelection(context.selectedAlbumIds, []);
  runInNewContext("updateSelectionToolbar()", context);
  assert.equal($("#selectionToolbar").hidden, true);
});

test("active criteria render removable chips even when the filter disclosure is collapsed", () => {
  const nodes = new Map();
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Element("div"));
    return nodes.get(id);
  };
  $("#notesPresentFilter").checked = true;
  $("#missingAssociationFilter").checked = true;
  let renders = 0;
  const context = { $, document: { createElement: (tag) => new Element(tag) },
    appliedCollectionSearch: "Moon", localFacet: null, collectionSelectionOnly: true,
    render: () => { renders += 1; }, fetch: () => assert.fail("Unexpected network") };
  runInNewContext(appSection("function renderCollectionFilterChips(", "\nfunction removeSelectedAlbums(")
    + "\nrenderCollectionFilterChips()", context);
  const chips = $("#collectionFilterChips").children;
  assert.equal(chips.length, 4);
  chips.find((chip) => chip.textContent.startsWith("Note presenti")).events.click();
  assert.equal($("#notesPresentFilter").checked, false);
  assert.equal($("#missingAssociationFilter").checked, true);
  chips.find((chip) => chip.textContent.startsWith("Solo selezionati")).events.click();
  assert.equal(context.collectionSelectionOnly, false);
  assert.equal(renders, 2);
});

test("bulk dialog distinguishes add, replace and clear, preserves unchecked fields and rejects changed selection", () => {
  const albums = ["a", "b"].map((id) => validateAlbum({
    id, name: `Album ${id}`, artist: "Band", url: `https://open.spotify.com/album/${id}`, year: "",
    status: "queued", rating: null, genres: [], collections: [], tags: id === "a" ? ["Keep"] : [],
    notes: "Personal note", primary_genre: "", cover_sha256: null,
  }));
  let form, build;
  const body = new Element("body");
  const context = { document: { body, createElement: (tag) => new Element(tag) },
    Option: class { constructor(text, value) { this.textContent = text; this.value = value; } },
    selectedAlbumIds: new Set(["a", "b"]), visibleAlbums: [albums[0]], state: { albums },
    labels: { queued: "Da ascoltare", neutral: "Neutro" },
    selectionVisibility, prepareAlbumReview, batchAlbumChanges, validateAlbum,
    appendAlbumReview: (target, _dialog, builder) => { form = target; build = builder; },
    fetch: () => assert.fail("Unexpected network") };
  runInNewContext(appSection("function openBulkEditor(", "\nfunction appendAlbumReview(")
    + "\nopenBulkEditor()", context);
  assert.match(body.children[0].children[1].textContent, /1 nascosti.*Sostituisci con elenco vuoto/);
  const row = form.children.find((child) => child.children[0]?.textContent === "Tag");
  const checkbox = row.children[1], input = row.children[2];
  checkbox.checked = true;
  input.value = "Keep";
  const mode = form.children.find((child) => child.tag === "select");
  const review = build();
  assert.equal(review.changed, 1);
  assert.equal(review.unchanged, 1);
  assert.deepEqual(review.changes[0].before.tags, []);
  assert.deepEqual(review.changes[0].after.tags, ["Keep"]);
  assert.equal(review.next[0].notes, "Personal note");
  mode.value = "replace"; input.value = "";
  const cleared = build();
  assert.deepEqual(cleared.changes[0].before.tags, ["Keep"]);
  assert.deepEqual(cleared.changes[0].after.tags, []);
  assert.equal(cleared.next[0].notes, "Personal note");
  context.selectedAlbumIds.delete("b");
  assert.throws(() => build(), /Selezione cambiata/);
  assert.deepEqual(albums[0].tags, ["Keep"]);
});

test("manual empty genres remain distinct from missing without adding unsupported fields to albums", () => {
  const album = validateAlbum({ id: "a", name: "Album", artist: "Band",
    url: "https://open.spotify.com/album/a", year: "", status: "queued", rating: null, genres: [] });
  const records = new Map();
  const storage = { getItem: (key) => records.get(key) ?? null };
  const base = prepareAlbumReview([album], new Set(["a"]), (record) => record);
  const review = reviewManualGenres(base, new Set(["a"]), storage, "provenance", "2026-11-07T20:00:00Z");
  assert.equal(records.size, 0, "preview does not write");
  assert.equal(review.changed, 1);
  assert.equal(review.unchanged, 0);
  assert.equal(review.changes[0].after.genre_source, "manual");
  assert.equal(review.next[0].genre_source, undefined, "metadata must not corrupt the portable album schema");
  assert.doesNotThrow(() => validateAlbum(review.next[0]));
  records.set("provenance", JSON.stringify(review.related.provenance));
  const noop = reviewManualGenres(base, new Set(["a"]), storage, "provenance", "2026-11-08T20:00:00Z");
  assert.equal(noop.changed, 0);
  assert.equal(noop.related.provenance.a.genres.updated, "2026-11-07T20:00:00Z");
});

test("duration queue uses known runtimes, deterministic order, and skips duplicate editions", () => {
  const albums = [
    { id: "queued", name: "Album", artist: "Band", status: "queued", rating: 2 },
    { id: "favorite", name: "Favorite", artist: "Artist", status: "liked", rating: 5 },
    { id: "edition", name: "Album (Deluxe Edition)", artist: "Band", status: "queued", rating: null },
    { id: "unknown", name: "Unknown", artist: "Other", status: "queued", rating: null },
    { id: "disliked", name: "Disliked", artist: "Other", status: "disliked", rating: null },
  ];
  const result = suggestDurationQueue(albums,
    { queued: 1_500_000, favorite: 1_200_000, edition: 900_000 }, 2_700_000);
  assert.deepEqual(result.ids, ["queued", "favorite"]);
  assert.equal(result.durationMs, 2_700_000);
  assert.deepEqual(result.missingDurationIds, ["unknown"]);
  assert.deepEqual(result.duplicateSkippedIds, ["edition"]);
});

test("duration queue rejects invalid or missing budgets and durations", () => {
  const albums = [{ id: "a", name: "Album", artist: "Band", status: "queued" }];
  assert.throws(() => suggestDurationQueue(albums, { a: 10 }, 0));
  assert.throws(() => suggestDurationQueue(albums, { a: true }, 100));
});

const historyAlbum = (id, changes = {}) => validateAlbum({
  id, name: `Album ${id}`, artist: "Band", url: `https://open.spotify.com/album/${id}`,
  year: "", status: "queued", rating: null, genres: [], primary_genre: "",
  collections: [], tags: [], notes: "", cover_sha256: null, ...changes,
});

test("local collection history restores only changed fields and preserves independent edits", () => {
  const before = [historyAlbum("a"), historyAlbum("b")];
  const after = [historyAlbum("a", { status: "liked" }), before[1]];
  const entry = createCollectionHistoryEntry(before, after, "Modifica album", "2026-11-07T10:00:00Z");
  const current = [historyAlbum("a", { status: "liked", notes: "Independent note" }),
    historyAlbum("b", { year: "2001" })];
  const restored = prepareCollectionHistoryRestore(current, entry).albums;
  assert.equal(restored[0].status, "queued");
  assert.equal(restored[0].notes, "Independent note");
  assert.equal(restored[1].year, "2001");
  assert.throws(() => prepareCollectionHistoryRestore(
    [historyAlbum("a", { status: "neutral" }), current[1]], entry), /cambiato/);
});

test("history refuses to delete a later album or reinsert an already reused ID", () => {
  const before = [historyAlbum("a")], after = [historyAlbum("a"), historyAlbum("b")];
  const added = createCollectionHistoryEntry(before, after, "Aggiunta album");
  assert.deepEqual(prepareCollectionHistoryRestore(after, added).albums.map((album) => album.id), ["a"]);
  assert.throws(() => prepareCollectionHistoryRestore(
    [before[0], historyAlbum("b", { notes: "Edited later" })], added), /cambiato/);

  const removed = createCollectionHistoryEntry(after, before, "Rimozione album");
  assert.deepEqual(prepareCollectionHistoryRestore(before, removed).albums.map((album) => album.id), ["a", "b"]);
  assert.throws(() => prepareCollectionHistoryRestore(after, removed), /già presente/);
});

test("metadata history is atomic, stale-guarded, and association restore validates identity", () => {
  class Storage {
    values = new Map();
    failKey = "";
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { if (key === this.failKey) throw new Error("quota"); this.values.set(key, value); }
    removeItem(key) { this.values.delete(key); }
  }
  const storage = new Storage(), album = historyAlbum("a");
  storage.setItem("accord-album-pwa-v1", JSON.stringify({ albums: [album], collectionHistory: [] }));
  storage.setItem("accord-listening-album-durations-v1", "{}");
  commitLocalRestore(storage, "accord-listening-album-durations-v1", {}, { a: 2400000 },
    {}, "Durata manuale");
  const collection = JSON.parse(storage.getItem("accord-album-pwa-v1"));
  const entry = collection.collectionHistory[0];
  assert.equal(entry.storageChanges[0].field, "durata");
  const records = { "accord-listening-album-durations-v1": { a: 2400000 } };
  const restored = prepareCollectionHistoryRestore([album], entry, {}, records);
  assert.deepEqual(restored.storageUpdates["accord-listening-album-durations-v1"], {});
  assert.throws(() => prepareCollectionHistoryRestore([album], entry, {}, {
    "accord-listening-album-durations-v1": { a: 2500000 },
  }), /cambiato/);

  storage.failKey = "accord-album-pwa-v1";
  assert.throws(() => commitLocalRestore(storage, "accord-listening-album-durations-v1", {},
    { a: 3000000 }, {}, "Durata manuale"), /quota/);
  assert.equal(JSON.parse(storage.getItem("accord-listening-album-durations-v1")).a, 2400000,
    "a failed journal write rolls back the duration write");

  const link = { a: { tidal: { id: "tidal:9", name: "Edition",
    source: JSON.stringify(["a", album.artist, album.name]) } } };
  const linkEntry = createCollectionHistoryEntry([album], [album], "Rimozione associazione",
    "2026-11-07T10:00:00Z", [{ storageKey: "accord-music-edition-links-v1", id: "a",
      field: "associazione edizione", beforePresent: true, before: link.a, afterPresent: false, after: null }]);
  assert.throws(() => prepareCollectionHistoryRestore([historyAlbum("a", { name: "Renamed" })], linkEntry,
    {}, { "accord-music-edition-links-v1": {} }), /obsoleta/);
});

test("collection health uses local evidence and reports malformed links, stale associations, durations and derived records", () => {
  const album = { ...historyAlbum("a"), id: "tidal:7", url: "https://example.test/album/7" };
  const health = collectionHealthSummary([album], {
    rawAlbums: [album], durations: {},
    editionLinks: { "tidal:7": { qobuz: { id: "qobuz:123", source: "old" } } },
    completionProvenance: { "tidal:7": { duration: { source: "qobuz", target: "qobuz:123",
      identity: ["tidal:7", "Other", "Album"] } }, gone: { genres: {} } },
    completionEvidence: { gone: { source: "Discogs" } },
  });
  assert.deepEqual(health.malformedLinkIds, ["tidal:7"]);
  assert.deepEqual(health.incoherentEditionIds, ["tidal:7"]);
  assert.deepEqual(health.missingDurationIds, ["tidal:7"]);
  assert.deepEqual(health.staleDerivedIds, ["gone", "tidal:7"]);
});
