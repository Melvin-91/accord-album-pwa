import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { LIBRARY_CHOICES_KEY, associationCaptions, readLibraryChoices, validateLibraryChoices,
  choiceSource, libraryChoice, manuallyUnavailable, albumDeferred, deferredSuggestion,
  libraryAssociationState, changeLibraryChoice, groupEditionRows, localDay } from "./music-library-choices.mjs";
import { duplicateAlbumGroups } from "./ui.mjs";
import { prepareAssociations, openPlaybackServiceDialog } from "./album-association.mjs";
import { sourceIdentity } from "./music-continuity.mjs";

const album = { id: "local:1", artist: "Band", name: "Album", year: "2024" };
const app = readFileSync(new URL("./app.mjs", import.meta.url), "utf8");
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test("manual availability is service-specific and independent of a native or linked identity", () => {
  let values = changeLibraryChoice({}, album, { provider: "tidal", unavailable: true });
  assert.equal(manuallyUnavailable(values, album, "tidal"), true);
  assert.equal(manuallyUnavailable(values, album, "qobuz"), false);
  assert.equal(libraryAssociationState(values, album, "tidal", { native: true }), "unavailable");
  values = changeLibraryChoice(values, album, { provider: "tidal", unavailable: false, state: "missing" });
  assert.equal(libraryAssociationState(values, album, "tidal"), "missing");
  assert.equal(libraryAssociationState(values, album, "tidal", { linked: true }), "linked");
  assert.equal(libraryAssociationState(values, { ...album, name: "Changed" }, "tidal"), "never");
});

test("deferral uses the local calendar and ends on the selected day across catalogue identities", () => {
  const values = changeLibraryChoice({}, album, { snoozedUntil: "2027-01-03" }, "2027-01-01");
  assert.equal(albumDeferred(values, album, "2027-01-02"), true);
  assert.equal(albumDeferred(values, album, "2027-01-03"), false);
  assert.equal(deferredSuggestion(values, { ...album, id: "qobuz:other", artist: " BAND " }, "2027-01-02"), true);
  assert.equal(deferredSuggestion(values, { ...album, name: "Different" }, "2027-01-02"), false);
  assert.equal(albumDeferred(values, { ...album, year: "2025" }, "2027-01-02"), false);
  assert.equal(albumDeferred(changeLibraryChoice(values, album, { snoozedUntil: "" }), album, "2027-01-02"), false);
  for (const date of ["2027-01-01", "2027-02-30", "", null]) {
    if (date === "") continue;
    assert.throws(() => changeLibraryChoice({}, album, { snoozedUntil: date }, "2027-01-01"), /futura/);
  }
  assert.equal(localDay(new Date(2027, 0, 3, 0, 5)), "2027-01-03");
});

test("invalid storage never resets decisions and special IDs cannot mutate prototypes", () => {
  for (const value of [null, [], { x: {} }, { x: { source: ["x", {}, "Album", null] } },
    { [album.id]: { source: choiceSource(album), unavailable: { tidal: "yes" } } }]) {
    assert.throws(() => validateLibraryChoices(value));
  }
  const saved = storage(); saved.setItem(LIBRARY_CHOICES_KEY, "{bad");
  assert.throws(() => readLibraryChoices(saved));
  assert.equal(saved.getItem(LIBRARY_CHOICES_KEY), "{bad");
  const values = changeLibraryChoice({}, { ...album, id: "__proto__" }, { preferred: "qobuz" });
  assert.equal(Object.getPrototypeOf(values), Object.prototype);
  assert.equal(Object.hasOwn(values, "__proto__"), true);
  assert.equal(libraryChoice(values, { ...album, id: "__proto__" }).preferred, "qobuz");
});

test("grouping follows the filtered order, retains all data and never includes hidden editions", () => {
  const deluxe = { ...album, id: "deluxe", name: "Album (Deluxe Edition)", rating: 5 };
  const other = { ...album, id: "other", name: "Another" };
  const rows = [deluxe, other, album], before = structuredClone(rows);
  assert.deepEqual(groupEditionRows(rows, duplicateAlbumGroups(rows)), [deluxe, album, other]);
  assert.deepEqual(groupEditionRows([other, album], duplicateAlbumGroups([other, album])), [other, album]);
  assert.deepEqual(rows, before);
});

test("bulk association skips unavailable albums without issuing a catalogue read", async () => {
  const plan = await prepareAssociations([album], {}, "tidal", () => assert.fail("Catalogue read"),
    () => {}, () => {}, null, [album.id]);
  assert.deepEqual(plan.rows.map(row => row.state), ["unavailable"]);
});

class Node {
  constructor(tag = "") { this.tag = tag; this.children = []; this.events = {}; this.value = ""; }
  setAttribute() {}
  removeAttribute(name) { delete this[name]; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  add(option) { this.children.push(option); }
  addEventListener(name, callback) { this.events[name] = callback; }
  showModal() { this.open = true; }
  close() { this.open = false; this.events.close?.(); }
  remove() {}
  focus() {}
}
function context() {
  const saved = storage(), body = new Node("body"), feedback = [], chosen = [];
  return { document: { createElement: tag => new Node(tag), body },
    Option: function(text, value) { return { text, value }; },
    state: { albums: [album] }, visibleAlbums: [album], localStorage: saved, STORAGE_KEY: "albums",
    musicService: { service: "tidal", epoch: 1, assert() {} },
    LIBRARY_CHOICES_KEY, associationCaptions, readLibraryChoices, libraryChoice, choiceSource,
    changeLibraryChoice, manuallyUnavailable, albumDeferred, localDay, libraryAssociationState,
    validEdition: () => false, editionLink: () => null, render() {},
    chooseCollectionEdition: (row, options) => chosen.push({ row, options }),
    showFeedback: message => feedback.push(message), feedback, chosen };
}
test("the last alternative is first and manually unavailable alternatives remain excluded", () => {
  const saved = storage(), source = { ...album, id: "A".repeat(22), url: `https://open.spotify.com/album/${"A".repeat(22)}` };
  saved.setItem("accord-music-edition-links-v1", JSON.stringify({ [source.id]: {
    qobuz: { id: "qobuz:demo", name: source.name, source: sourceIdentity(source) },
  } }));
  let choices = changeLibraryChoice({}, source, { preferred: "qobuz" });
  saved.setItem(LIBRARY_CHOICES_KEY, JSON.stringify(choices));
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Node(tag), body: new Node("body") };
  try {
    let dialog = openPlaybackServiceDialog({ storage: saved, album: source, provider: "tidal", report() {} });
    assert.match(dialog.children[2].children[0].textContent, /Qobuz.*ultima scelta/);
    assert.equal(dialog.children[3].children[0].href, `spotify:album:${source.id}`);
    choices = changeLibraryChoice(choices, source, { provider: "qobuz", unavailable: true });
    saved.setItem(LIBRARY_CHOICES_KEY, JSON.stringify(choices));
    dialog = openPlaybackServiceDialog({ storage: saved, album: source, provider: "tidal", report() {} });
    assert.match(dialog.children[2].children[0].textContent, /Spotify/);
    assert.equal(dialog.children.length, 4);
  } finally { globalThis.document = previous; }
});

test("the workbench saves availability and deferral locally and routes explicit retry/link choices", () => {
  const source = app.slice(app.indexOf("function albumAssociationState("), app.indexOf("\nfunction pickLocalAlbum("));
  const ctx = context();
  runInNewContext(`${source}\nopenMusicChoices();`, ctx);
  let dialog = ctx.document.body.children.at(-1), controls = dialog.children[5];
  const click = text => controls.children.find(node => node.textContent === text).events.click();
  click("Segna non disponibile");
  assert.equal(manuallyUnavailable(readLibraryChoices(ctx.localStorage), album, "tidal"), true);
  click("Rimuovi indicazione non disponibile");
  assert.equal(manuallyUnavailable(readLibraryChoices(ctx.localStorage), album, "tidal"), false);
  click("Rimanda album");
  assert.equal(albumDeferred(readLibraryChoices(ctx.localStorage), album), true);
  click("Rimuovi rinvio");
  assert.equal(albumDeferred(readLibraryChoices(ctx.localStorage), album), false);
  click("Riprova");
  assert.equal(ctx.chosen.at(-1).options.searchNow, true);
  runInNewContext("openMusicChoices();", ctx);
  dialog = ctx.document.body.children.at(-1); controls = dialog.children[5];
  click("Incolla link");
  assert.equal(ctx.chosen.at(-1).options.focusLink, true);
  assert.deepEqual(ctx.state.albums, [album]);
});

test("choice writes reject another tab's changed album without losing existing decisions", () => {
  const source = app.slice(app.indexOf("function saveMusicChoice("), app.indexOf("\nfunction openMusicChoices("));
  const ctx = context();
  ctx.localStorage.setItem(ctx.STORAGE_KEY, JSON.stringify({ albums: [{ ...album, name: "Renamed" }] }));
  runInNewContext(source, ctx);
  assert.throws(() => runInNewContext("saveMusicChoice(state.albums[0], {preferred: 'qobuz'});", ctx), /cambiato/);
  assert.equal(ctx.localStorage.getItem(LIBRARY_CHOICES_KEY), null);
});

test("random proposals use only the filtered non-deferred list and never autoplay or reset filters", () => {
  const ctx = context(), opened = [];
  const snoozed = { ...album, id: "local:deferred", name: "Deferred" };
  ctx.state.albums.push(snoozed, { ...album, id: "hidden", name: "Not in filters" });
  ctx.visibleAlbums = [snoozed, album];
  ctx.labels = {}; ctx.openAlbumDetails = id => opened.push(id);
  const date = new Date(); date.setDate(date.getDate() + 1);
  ctx.localStorage.setItem(LIBRARY_CHOICES_KEY, JSON.stringify(changeLibraryChoice({}, snoozed, { snoozedUntil: localDay(date) })));
  const source = app.slice(app.indexOf("function pickLocalAlbum("), app.indexOf("\nfunction completeSelectedMusic("));
  runInNewContext(`${source}\npickLocalAlbum();`, ctx);
  const dialog = ctx.document.body.children.at(-1), pick = dialog.children[2], open = dialog.children[4];
  pick.events.click();
  assert.equal(open.hidden, false);
  assert.deepEqual(opened, []);
  open.onclick();
  assert.deepEqual(opened, [album.id]);
  ctx.visibleAlbums = [snoozed];
  pick.events.click();
  assert.equal(open.hidden, true);
  assert.match(dialog.children[3].textContent, /Nessun album/);
});
