import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { tidalAlbumId } from "./tidal.mjs";
import { fingerprint } from "./music-continuity.mjs";
import { createUpdateLifecycle, localCollectionStatus, serviceFailure } from "./runtime-status.mjs";
import {
  buildSimilarityQueue,
  resolveArtistFromTracks,
  rankSimilarArtists,
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
  createSpotifyReadBudget,
  collectSpotifyDiscoveryAlbums,
  spotifyDiscoveryPlaylistPreview,
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
  playlistReleaseRecords,
  primaryAlbumGenres,
  readLastFmAllTimeArtists,
  readMusicBrainzCatalog,
  readSpotifyPlaylistItems,
  readSpotifySearchPages,
  rankDiscogsSuggestionAlbums,
  retryMusicBrainzRequest,
  sortAlbumsByManualOrder,
  spotifyAlbumSearchRecords,
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
  collectionAuditSummary,
  formatSyncSummary,
  normalizeCollectionPreferences,
  prepareAlbumRemoval,
  prepareAlbumUpdates,
  visibleSelection,
  editionTitle, duplicateAlbumGroups, albumFieldChanges, albumChanges, smartAlbumMatch,
  albumStatistics, suggestionIdentity, suggestionWhy, batchAlbumChanges,
  normalizeAccessibility, portablePreferences, adjacentAlbumIds, spotifyAlbumIntent,
  playlistPreviewStatistics, createLocalBackup, validateLocalBackup, prepareSelectiveRestore, commitLocalRestore,
  backupReminderItems,
  exactAlbumFacet, normalizeAlbumFacet, prepareAlbumReview, assertAlbumReviewCurrent, labelNormalizationProposals,
  normalizeAlbumLabels, coverStorageInventory, createCommandGuard, redactDiagnostics, technicalDiagnostics,
  updateAlbumActivity, sortAlbumsByActivity, installControlHelp, installSelectWheelGuard,
} from "./ui.mjs";

test("wheel over an unfocused select scrolls its container without changing the selection", () => {
  const listeners = new Map(), calls = [];
  const view = { innerHeight: 600, scrollBy: (...args) => calls.push(args),
    getComputedStyle: () => ({ overflowX: "hidden", overflowY: "auto" }) };
  const root = { activeElement: null, defaultView: view,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name) };
  const parent = { parentElement: null, scrollWidth: 100, clientWidth: 100,
    scrollHeight: 400, clientHeight: 100, scrollTop: 0 };
  const select = { multiple: false, size: 0, parentElement: parent };
  const makeEvent = (extra = {}) => ({ target: { closest: () => select },
    deltaX: 0, deltaY: 3, deltaMode: 1, preventDefault() { this.prevented = true; }, ...extra });
  const stop = installSelectWheelGuard(root);
  const event = makeEvent(); listeners.get("wheel")(event);
  assert.equal(event.prevented, true);
  assert.equal(parent.scrollTop, 48);
  root.activeElement = select;
  const focused = makeEvent(); listeners.get("wheel")(focused);
  assert.equal(focused.prevented, undefined);
  root.activeElement = null;
  const zoom = makeEvent({ ctrlKey: true }); listeners.get("wheel")(zoom);
  assert.equal(zoom.prevented, undefined);
  parent.scrollHeight = parent.clientHeight;
  const page = makeEvent(); listeners.get("wheel")(page);
  assert.deepEqual(calls, [[0, 48]]);
  stop();
  assert.equal(listeners.size, 0);
});

test("local activity keeps original additions, ignores noops and sorts unknown dates last", () => {
  const before = [qosAlbum("a"), qosAlbum("b")];
  const initial = { a: { added: "2020-01-01", modified: "2020-01-02" } };
  assert.deepEqual(updateAlbumActivity(before, before, initial, "2030-01-01"), initial);
  const edited = updateAlbumActivity(before, [{ ...before[0], notes: "Note" }, before[1], qosAlbum("c")],
    initial, "2030-01-01");
  assert.deepEqual(edited.a, { added: "2020-01-01", modified: "2030-01-01" });
  assert.deepEqual(edited.c, { added: "2030-01-01", modified: "2030-01-01" });
  assert.deepEqual(sortAlbumsByActivity([...before, qosAlbum("c")], edited, "added").map(album => album.id), ["c", "a", "b"]);
  const removed = updateAlbumActivity(before, [before[1]], initial, "2031-01-01");
  assert.deepEqual(updateAlbumActivity([before[1]], before, removed, "2032-01-01", true).a,
    { added: "2020-01-01", modified: "2032-01-01" });
  assert.throws(() => updateAlbumActivity(before, before, { a: { added: "not-a-date" } }), /Date locali/);
});

test("shared hover help explains dynamic commands and preserves explicit descriptions", () => {
  const listeners = new Map();
  const root = { addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name) };
  const stop = installControlHelp(root);
  const control = { title: "", tagName: "BUTTON", textContent: "Salva", getAttribute: () => null,
    closest() { return this; }, matches() { return false; } };
  listeners.get("pointerover")({ target: control });
  assert.match(control.title, /valori inseriti/);
  control.textContent = "Esporta backup";
  listeners.get("focusin")({ target: control });
  assert.match(control.title, /file/);
  control.title = "Salva solo una bozza locale.";
  listeners.get("pointerover")({ target: control });
  assert.equal(control.title, "Salva solo una bozza locale.");
  stop();
  assert.equal(listeners.size, 0);
});

const qosAlbum = (id, fields = {}) => validateAlbum({ id, name: `Album ${id}`, artist: "Band",
  url: `https://open.spotify.com/album/${id}`, year: "2026", status: "queued", rating: null,
  genres: [], primary_genre: "", tags: [], collections: [], cover_sha256: null, ...fields });

test("favorite flags survive local backup without changing pins or album records", () => {
  const preferences = portablePreferences({ pinnedIds: ["b"], favoriteIds: ["a", "a", "../bad", "tidal:123", null] });
  assert.deepEqual(preferences.pinnedIds, ["b"]);
  assert.deepEqual(preferences.favoriteIds, ["a", "tidal:123"]);
  const records = [qosAlbum("a"), qosAlbum("b")];
  const before = JSON.stringify(records);
  const backup = createLocalBackup(records, { ...preferences, favoriteIds: ["a"] }, validateAlbum);
  const restored = validateLocalBackup(backup, validateDocument);
  assert.deepEqual(restored.preferences.favoriteIds, ["a"]);
  assert.deepEqual(restored.preferences.pinnedIds, ["b"]);
  assert.equal(JSON.stringify(records), before);
  assert.throws(() => validateLocalBackup({ ...backup,
    preferences: { ...backup.preferences, favoriteIds: ["../bad"] } }, validateDocument), /Preferenze/);
});

test("favorite toggle persists before render, preserves pins and restores keyboard focus", () => {
  let renders = 0, focused = 0, saves = 0;
  const original = { pinnedIds: ["b"], favoriteIds: [] };
  const context = {
    Set, collectionPreferences: original,
    saveCollectionPreferences: (value) => { saves++; context.collectionPreferences = value; return true; },
    render: () => { renders++; },
    showFeedback: () => {},
    $: () => ({ children: [{ dataset: { albumId: "a" }, querySelector: () => ({ focus: () => focused++ }) }] }),
  };
  runInNewContext(appFunction("function toggleAlbumFavorite(id)", "\nfunction collectionHasFilters"), context);
  context.toggleAlbumFavorite("a");
  assert.deepEqual([...context.collectionPreferences.favoriteIds], ["a"]);
  assert.deepEqual([...context.collectionPreferences.pinnedIds], ["b"]);
  context.toggleAlbumFavorite("a");
  assert.deepEqual([...context.collectionPreferences.favoriteIds], []);
  assert.equal(renders, 2); assert.equal(focused, 2); assert.equal(saves, 2);
  context.saveCollectionPreferences = () => false;
  context.toggleAlbumFavorite("a");
  assert.equal(renders, 2);
  assert.equal(focused, 2);
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /class="album-actions"><button class="favorite-album"[^]*aria-pressed="false"/);
  assert.match(html, /id="favoritesOnlyFilter"/);
});

test("accessibility and portable preferences allow only local non-secret settings", () => {
  assert.deepEqual(normalizeAccessibility(null), { textScale: "normal", contrast: "standard", density: "touch" });
  assert.deepEqual(normalizeAccessibility({ textScale: "larger", contrast: "high", density: "compact" }),
    { textScale: "larger", contrast: "high", density: "compact" });
  const preferences = portablePreferences({ textScale: "large", contrast: "invalid", density: "invalid",
    token: "secret", drafts: { manual: "private" }, search: "private", layout: "compact", pinnedIds: ["a"] });
  assert.deepEqual(preferences, { textScale: "large", contrast: "standard", density: "touch", layout: "compact", pinnedIds: ["a"] });
});

test("dialogs fit the viewport, keep primary actions visible and avoid horizontal scrolling", () => {
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /dialog \{[^}]*max-height: calc\(100dvh - 24px\);[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/);
  assert.match(css, /dialog form \{[^}]*grid-template-rows: minmax\(0, 1fr\) auto;[^}]*overflow: hidden;/);
  assert.match(css, /\.dialog-scroll \{[^}]*overflow-x: hidden; overflow-y: auto;/);
  assert.match(css, /dialog :is\(\.restore-album-list, \.qol-details, \.conflict-list, \.command-results\) \{ max-height: none; overflow: visible; \}/);
  assert.match(css, /\.dialog-footer \{[^}]*border-top:/);
  assert.match(css, /\.qol-comparison-scroll \{[^}]*overflow-x: hidden;/);
  assert.doesNotMatch(css, /\.qol-conflict-table \{[^}]*min-width:/);
  assert.doesNotMatch(css, /dialog(?:\s[^{]+)?\s*\{[^}]*overflow-x:\s*auto/);
});

test("message dialogs use natural height with a single viewport overflow fallback", () => {
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.mjs", import.meta.url), "utf8");
  assert.match(css, /#messageDialog \{[^}]*width: min\(760px, calc\(100vw - 24px\)\);/);
  assert.match(css, /#messageDialog form \{[^}]*display: block;[^}]*max-height: none;[^}]*overflow: visible;/);
  assert.match(css, /#messageDialog \.dialog-scroll \{[^}]*overflow: visible;/);
  assert.match(css, /#messageBody \{[^}]*white-space: pre-wrap;/);
  assert.ok(app.includes('$("#messageDialog .dialog-footer").prepend(actions)'));
});

test("details neighbors follow only the supplied filtered sorted visible list, without wrapping", () => {
  const albums = ["c", "a", "b"].map((id) => ({ id }));
  assert.deepEqual(adjacentAlbumIds(albums, "a"), { previous: "c", next: "b" });
  assert.deepEqual(adjacentAlbumIds(albums, "c"), { previous: null, next: "a" });
  assert.deepEqual(adjacentAlbumIds(albums, "b"), { previous: "a", next: null });
  assert.deepEqual(adjacentAlbumIds(albums, "missing"), { previous: null, next: null });
  assert.deepEqual(adjacentAlbumIds([], "a"), { previous: null, next: null });
});

test("local collection audit summarizes duplicates, offline covers, and missing metadata", () => {
  const albums = [
    qosAlbum("a", { name: "Album", year: "", genres: [] }),
    qosAlbum("b", { name: "Album (Deluxe)", genres: [] }),
    qosAlbum("c", { name: "Other", genres: ["Metal"] }),
  ];
  assert.deepEqual(collectionAuditSummary(albums, new Set(["a", "c"])), {
    total: 3,
    duplicateGroups: [["a", "b"]],
    duplicateIds: ["a", "b"],
    missingCoverIds: ["b"],
    missingYearIds: ["a"],
    missingGenreIds: ["a", "b"],
  });
});

test("bulk removal validates the selected IDs and leaves unselected albums unchanged", () => {
  const albums = [qosAlbum("a"), qosAlbum("b"), qosAlbum("c")];
  assert.deepEqual(prepareAlbumRemoval(albums, new Set(["b"])), [albums[0], albums[2]]);
  assert.deepEqual(prepareAlbumRemoval(albums, new Set()), albums);
  assert.throws(() => prepareAlbumRemoval(albums, new Set(["missing"])), /selezione è cambiata/i);
});

test("sync summary reports both directions, unchanged albums, and resolved conflicts", () => {
  assert.equal(formatSyncSummary({ toGitHub: 2, toDevice: 1, unchanged: 7, conflictsResolved: 1 }),
    "Verso GitHub: 2 · verso questo dispositivo: 1 · invariati: 7 · conflitti risolti: 1");
});

test("detail draft persistence keeps albums separate, clears unchanged drafts, and exposes write failure", () => {
  const album = qosAlbum("a");
  const context = {
    detailsAlbumId: "a", detailsDraftSelectors: [".status-input", ".rating-input", ".genres-input", ".collections-input",
      ".tags-input", ".album-notes-input"],
    state: { albums: [album, qosAlbum("b")] }, qol: { drafts: {} },
    fields: { ".status-input": "liked", ".rating-input": "4.5", ".genres-input": "", ".collections-input": "",
      ".tags-input": "", ".album-notes-input": "" },
    $: () => ({ querySelector: (selector) => ({ value: context.fields[selector] }) }),
    saveAlbumDraft: (key, fields) => { context.qol.drafts[key] = fields; return true; },
    clearAlbumDraft: (key) => { delete context.qol.drafts[key]; return true; },
  };
  const source = appFunction("function persistDetailsDraft(", '\nfor (const [selector, direction]');
  const save = runInNewContext(`${source}\npersistDetailsDraft`, context);
  assert.equal(save(), true);
  context.detailsAlbumId = "b";
  context.fields[".rating-input"] = "2";
  assert.equal(save(), true);
  assert.equal(context.qol.drafts["edit:a"][".rating-input"], "4.5");
  assert.equal(context.qol.drafts["edit:b"][".rating-input"], "2");
  context.fields[".status-input"] = "queued";
  context.fields[".rating-input"] = "";
  save();
  assert.equal(context.qol.drafts["edit:b"], undefined);
  context.fields[".rating-input"] = "3";
  context.saveAlbumDraft = () => false;
  assert.equal(save(), false);
  assert.equal(context.qol.drafts["edit:a"][".rating-input"], "4.5");
});

test("detail navigation refuses to replace an editor when its draft cannot be persisted", () => {
  const callbacks = {};
  const opened = [];
  let canSave = false;
  const source = appFunction('for (const [selector, direction] of [["#previousAlbumButton"', '\n$("#albumDetailsDialog").addEventListener("cancel"');
  runInNewContext(source, {
    $: (selector) => ({ addEventListener: (_event, callback) => { callbacks[selector] = callback; }, focus() {} }),
    visibleAlbums: [{ id: "c" }, { id: "a" }, { id: "b" }], detailsAlbumId: "a", detailsReturnFocus: "original",
    adjacentAlbumIds, persistDetailsDraft: () => canSave,
    openAlbumDetails: (...args) => opened.push(args),
  });
  callbacks["#nextAlbumButton"]();
  assert.equal(opened.length, 0);
  canSave = true;
  callbacks["#previousAlbumButton"]();
  assert.deepEqual(opened, [["c", "original"]]);
});

test("Spotify album intent canonicalizes URLs and rejects unsupported, spoofed, or ambiguous shares", () => {
  const id = "a".repeat(22), other = "b".repeat(22);
  assert.deepEqual(spotifyAlbumIntent(`Album https://open.spotify.com/intl-it/album/${id}?si=private`),
    { id, url: `https://open.spotify.com/album/${id}` });
  assert.equal(spotifyAlbumIntent(`spotify:album:${id}`).id, id);
  assert.equal(spotifyAlbumIntent(`https://open.spotify.com/album/${id} https://open.spotify.com/album/${id}`).id, id);
  for (const input of [`https://evil.example/album/${id}`, `https://open.spotify.com.evil.example/album/${id}`,
    `https://open.spotify.com/track/${id}`, `https://open.spotify.com/album/short`,
    `https://open.spotify.com/album/${id} https://open.spotify.com/album/${other}`]) {
    assert.throws(() => spotifyAlbumIntent(input), /solo link album Spotify/);
  }
});

test("opening pasted albums uses local details or prepares explicit manual lookup, never network or insertion", () => {
  const id = "a".repeat(22), opened = [], saved = [];
  const nodes = Object.fromEntries(["#manualAlbumSource", "#manualAlbumQuery", "#manualAlbumArtist", "#manualAlbumGenre",
    "#manualAlbumYear", "#manualAlbumStatus"].map((selector) => [selector, { value: "old" }]));
  let manualOpens = 0, allowReplace = false;
  nodes["#manualAlbumButton"] = { click: () => { manualOpens += 1; } };
  const context = { spotifyAlbumIntent, state: { albums: [qosAlbum(id)] }, qol: { drafts: {} },
    $: (selector) => nodes[selector], activateViewTab() {}, openAlbumDetails: (value) => opened.push(value),
    manualDraftSelectors: ["#manualAlbumSource", "#manualAlbumQuery", "#manualAlbumArtist", "#manualAlbumGenre", "#manualAlbumYear"],
    updateManualAlbumSourceNotice() {}, saveAlbumDraft: (...args) => { saved.push(args); return true; },
    window: { confirm: () => allowReplace }, showFeedback() {},
    fetch: () => { throw new Error("Unexpected network"); } };
  const open = runInNewContext(`${appFunction("function openSpotifyAlbumIntent(", '\n$("#openSpotifyForm")')}\nopenSpotifyAlbumIntent`, context);
  open(`https://open.spotify.com/album/${id}`);
  assert.deepEqual(opened, [id]);
  assert.equal(manualOpens, 0);
  assert.equal(saved.length, 0);
  context.state.albums = [];
  context.qol.drafts.manual = { old: "keep me" };
  open(`spotify:album:${id}`);
  assert.equal(manualOpens, 0);
  allowReplace = true;
  open(`spotify:album:${id}`);
  assert.equal(manualOpens, 1);
  assert.equal(nodes["#manualAlbumSource"].value, "spotify");
  assert.equal(nodes["#manualAlbumQuery"].value, `https://open.spotify.com/album/${id}`);
  assert.equal(nodes["#manualAlbumArtist"].value, "");
  assert.equal(saved.length, 1);
  assert.deepEqual(context.state.albums, []);
});

test("incoming GET shares remove only share parameters, stage unknown albums, and cannot add or search", () => {
  const id = "a".repeat(22);
  const original = `https://example.test/accord/?share_url=${encodeURIComponent(`https://open.spotify.com/album/${id}?si=secret`)}&code=oauth`;
  let replacement;
  const nodes = { "#openSpotifyInput": { value: "", focus() {} } };
  let opens = 0;
  const context = { URL, location: { href: original }, history: { state: {}, replaceState: (_state, _unused, url) => { replacement = url; } },
    musicService: { service: "spotify" }, spotifyAlbumIntent, state: { albums: [] }, $: (selector) => nodes[selector], activateViewTab() {}, showFeedback() {},
    openSpotifyAlbumIntent: () => { opens += 1; } };
  const receive = runInNewContext(`${appFunction("function receiveSharedAlbum(", '\n$("#backupButton").addEventListener')}\nreceiveSharedAlbum`, context);
  receive();
  assert.equal(opens, 0);
  assert.equal(nodes["#openSpotifyInput"].value, `https://open.spotify.com/album/${id}`);
  assert.equal(replacement.searchParams.get("code"), "oauth");
  assert.equal(replacement.searchParams.has("share_url"), false);
  context.state.albums = [qosAlbum(id)];
  receive();
  assert.equal(opens, 1);
  const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.share_target.method, "GET");
  assert.equal(manifest.share_target.action, "./");
});

test("incoming TIDAL shares stage catalog lookup or open local details without any Spotify fallback", () => {
  const original = `https://example.test/accord/?share_text=${encodeURIComponent("Artist https://tidal.com/browse/album/42?u=share")}&code=oauth`;
  let replacement;
  const staged = [], opened = [];
  const context = {
    URL, location: { href: original }, history: { state: {}, replaceState: (_state, _unused, url) => { replacement = url; } },
    musicService: { service: "tidal" }, tidalAlbumId, state: { albums: [] },
    tidalUI: { openCatalog: (value) => staged.push(value) }, $() {}, activateViewTab() {}, showFeedback() {},
    openAlbumDetails: (id) => opened.push(id),
    openSpotifyAlbumIntent() { assert.fail("Spotify must not be used"); },
  };
  runInNewContext(`${appFunction("function openTidalAlbumIntent(", '\n$("#openSpotifyForm")')}\n${appFunction("function receiveSharedAlbum(", '\n$("#backupButton").addEventListener')}\nreceiveSharedAlbum()`, context);
  assert.deepEqual(staged, ["https://tidal.com/browse/album/42"]);
  assert.deepEqual(opened, []);
  assert.equal(replacement.searchParams.get("code"), "oauth");
  assert.equal(replacement.searchParams.has("share_text"), false);
  context.state.albums = [{ id: "tidal:42" }];
  runInNewContext("receiveSharedAlbum()", context);
  assert.deepEqual(opened, ["tidal:42"]);
  assert.equal(staged.length, 1);
});

test("playlist quality metrics use existing evidence, count repeats/collaborators, and retain unknowns", () => {
  const tracks = [{ uri: "t1" }, { uri: "t2" }, { uri: "t1" }, { uri: "t3" }];
  const available = [{ uri: "t1", duration_ms: 60000, artists: [{ id: "a" }, { id: "b" }], known: true },
    { uri: "t2", duration_ms: 120000, artists: [{ id: "a" }], known: false }];
  const summary = playlistPreviewStatistics(tracks, available);
  assert.deepEqual(summary, { total: 4, duration: 240000, timed: 3, uniqueArtists: 2, artistRows: 3,
    repeats: 1, identified: 4, known: 2, classified: 3 });
  assert.deepEqual(playlistPreviewStatistics([{}]), { total: 1, duration: 0, timed: 0, uniqueArtists: 0,
    artistRows: 0, repeats: 0, identified: 0, known: 0, classified: 0 });
  assert.equal(playlistPreviewStatistics([{ uri: "t1" }], available).duration, 60000);
  assert.equal(playlistPreviewStatistics([{ uri: "t1", duration_ms: -1 }], available).timed, 0);
});

test("backup exports the full local music set and explicit preference allowlist without credentials or caches", () => {
  const album = qosAlbum("a", { url: "https://open.spotify.com/album/a?si=private" });
  const backup = createLocalBackup([album], { token: "SECRET", search: "PRIVATE", drafts: {},
    density: "compact", textScale: "large", pinnedIds: ["a"] }, validateAlbum, {
    manualOrder: ["a"], listeningQueue: { ids: ["a"], resume: "a", durations: { a: 120000 } },
    durations: { a: 240000 },
  });
  assert.equal(JSON.stringify(backup).includes("SECRET"), false);
  assert.equal(JSON.stringify(backup).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(backup).includes("?si"), false);
  assert.deepEqual(Object.keys(backup), ["format", "version", "albums", "preferences", "manualOrder",
    "listeningQueue", "durations", "suggestionRecipes", "completionProvenance", "completionEvidence"]);
  assert.deepEqual(backup.listeningQueue, { ids: ["a"], resume: "a", durations: { a: 120000 } });
  assert.deepEqual(backup.durations, { a: 240000 });
  const validated = validateLocalBackup(backup, validateDocument);
  assert.equal(validated.albums.length, 1);
  assert.equal(validated.preferences.density, "compact");
  assert.deepEqual(validated.manualOrder, ["a"]);
  assert.deepEqual(validated.listeningQueue, backup.listeningQueue);
  assert.deepEqual(validated.durations, backup.durations);
  assert.deepEqual(validated.suggestionRecipes, []);
  assert.deepEqual(backupReminderItems(backup)["album:a"], JSON.stringify(backup.albums[0]));
  for (const changed of [{ ...backup, token: "secret" }, { ...backup, version: 99 },
    { ...backup, preferences: { ...backup.preferences, drafts: {} } },
    { ...backup, preferences: { density: "invalid" } }, { ...backup, preferences: [] },
    { ...backup, albums: [album, album] }, { ...backup, albums: [{ ...album, rating: 99 }] },
    { ...backup, listeningQueue: { ids: ["missing"], resume: "", durations: {} } },
    { ...backup, durations: { a: -1 } }]) {
    assert.throws(() => validateLocalBackup(changed, validateDocument));
  }
  assert.equal(album.url.includes("?si"), true, "export cannot mutate collection");
});

test("legacy collection backups remain importable without inventing queue data", () => {
  const album = qosAlbum("a");
  const legacy = { format: "accord-local-backup", version: 1, albums: [album], preferences: {} };
  const validated = validateLocalBackup(legacy, validateDocument);
  assert.deepEqual(validated.manualOrder, ["a"]);
  assert.deepEqual(validated.listeningQueue, { ids: [], resume: "", durations: {} });
  assert.deepEqual(validated.durations, {});
  assert.deepEqual(validated.suggestionRecipes, []);
});

test("backup version three validates and preserves recipes and local completion provenance only", () => {
  const album = qosAlbum("a");
  const music = {
    suggestionRecipes: [{ name: "Jazz", criteria: {
      tool: "lastfm", period: "30", start: "", end: "", exclusion: "none",
      artistFilter: "", included: "", excluded: "", includedMode: "exact",
      excludedMode: "exact", playlistArtists: 10, playlistTracks: 3,
    } }],
    completionProvenance: { a: { duration: { source: "manual", updated: "2026-11-06T10:00:00Z" } } },
    completionEvidence: { a: { source: "Discogs", updated: "2026-11-06T10:00:00Z",
      data: { discogs_votes: 5, discogs_sampled: true }, detail: "Campione fittizio" } },
  };
  const backup = createLocalBackup([album], {}, validateAlbum, music);
  const restored = validateLocalBackup(backup, validateDocument);
  assert.deepEqual(restored.suggestionRecipes, music.suggestionRecipes);
  assert.deepEqual(restored.completionProvenance, music.completionProvenance);
  assert.deepEqual(restored.completionEvidence, music.completionEvidence);
  assert.throws(() => validateLocalBackup({ ...backup, suggestionRecipes: [{ name: "X", criteria: {} }] }, validateDocument));
  assert.throws(() => validateLocalBackup({ ...backup, completionEvidence: { a: {
    source: "Discogs", updated: "now", detail: "no", data: { access_token: "secret" },
  } } }, validateDocument));
});

test("PWA backup records success only after an attested file close and verifies without writes", async () => {
  const handlers = {}, writes = [], feedback = [], status = { textContent: "" };
  const backup = { albums: [qosAlbum("a")], suggestionRecipes: [] };
  const nodes = {
    "#backupButton": { addEventListener: (_event, handler) => { handlers.backup = handler; } },
    "#verifyBackupButton": { addEventListener() {} },
    "#verifyBackupInput": { value: "", addEventListener: (_event, handler) => { handlers.verify = handler; } },
    "#backupStatus": status,
  };
  const context = {
    $: (selector) => nodes[selector],
    state: { loadError: "" },
    BACKUP_SUCCESS_KEY: "accord-backup-last-success-v1",
    localBackupDocument: () => backup,
    backupReminderHashes: async () => ({ "album:a": "digest" }),
    updateBackupStatus: async () => {},
    showFeedback: (message) => feedback.push(message),
    localStorage: { setItem: (...args) => writes.push(args) },
    window: {},
    URL: { createObjectURL: () => "blob:local", revokeObjectURL() {} },
    Blob,
    document: { createElement: () => ({ click() {} }) },
    setTimeout: (callback) => callback(),
  };
  runInNewContext(appFunction('$("#backupButton").addEventListener("click"', '\n$("#verifyBackupButton").addEventListener'), context);
  await handlers.backup();
  assert.match(status.textContent, /non può attestare il salvataggio/);
  assert.equal(writes.length, 0, "a browser download is not reported as a verified save");

  context.window.showSaveFilePicker = async () => ({
    createWritable: async () => ({
      write: async () => writes.push(["write"]),
      close: async () => writes.push(["close"]),
      abort: async () => {},
    }),
  });
  await handlers.backup();
  assert.deepEqual(writes.map(([key]) => key), ["write", "close", "accord-backup-last-success-v1"]);
  assert.match(feedback.at(-1), /Backup locale scritto e chiuso con successo/);
  assert.match(writes[2][1], /createdAt/);

  runInNewContext(appFunction('$("#verifyBackupInput").addEventListener("change"', "\nfunction previewLocalRestore("), {
    $: (selector) => nodes[selector],
    validateLocalBackup: () => ({ albums: [qosAlbum("a")], suggestionRecipes: [] }),
    validateDocument() {},
    showFeedback() { assert.fail("Successful verification should not prompt or write"); },
  });
  await handlers.verify({ currentTarget: {
    value: "backup.json", files: [{ size: 12, text: async () => JSON.stringify(backup) }],
  } });
  assert.equal(nodes["#verifyBackupInput"].value, "");
  assert.match(status.textContent, /sola lettura/);
  assert.equal(writes.length, 3, "file verification leaves the backup marker and local data untouched");
});

test("selective restore is a non-destructive ID merge and commits atomically only after successful storage", () => {
  const a = qosAlbum("a"), b = qosAlbum("b"), replacement = qosAlbum("a", { rating: 4 });
  const backup = { albums: [replacement, qosAlbum("c")] };
  const current = { albums: [a, b], base: [a], preferences: { density: "touch" } };
  const albums = prepareSelectiveRestore(current.albums, backup, new Set(["a", "c"]), validateAlbum);
  assert.deepEqual(albums.map((album) => [album.id, album.rating]), [["a", 4], ["b", null], ["c", null]]);
  assert.deepEqual(current.albums, [a, b]);
  assert.throws(() => prepareSelectiveRestore(current.albums, backup, new Set(["missing"]), validateAlbum));
  const next = { ...current, albums, preferences: { density: "compact" } };
  const failingStorage = {
    getItem: () => null,
    setItem() { throw new Error("quota"); },
    removeItem() {},
  };
  assert.throws(() => commitLocalRestore(failingStorage, "state", current, next), /quota/);
  assert.deepEqual(current.albums, [a, b]);
  assert.equal(current.preferences.density, "touch");
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  commitLocalRestore(storage, "state", current, next);
  assert.deepEqual(JSON.parse(values.get("state")), current);
  assert.deepEqual(current.base, [a], "restore must remain pending local changes, not pretend to sync");
});

function fakeQolElement(tag) {
  return { tag, children: [], listeners: {}, value: "", checked: false, disabled: false, textContent: "",
    append(...children) { this.children.push(...children); },
    addEventListener(event, listener) { this.listeners[event] = listener; },
    setAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; }, remove() {} };
}

test("restore dialog previews selective writes, refuses concurrent edits, and applies preferences in the same commit", () => {
  const state = { albums: [qosAlbum("a")], base: [], manualOrder: ["a"], preferences: portablePreferences() };
  let writes = 0, dialog;
  const nodes = { "#collectionLayout": {}, "#albumList": { dataset: {} } };
  const context = { state, qol: { drafts: {} }, collectionPreferences: state.preferences,
    document: { createElement: fakeQolElement, body: { append: (value) => { dialog = value; } } },
    prepareSelectiveRestore, validateAlbum, albumChanges, changesText: () => "preview", portablePreferences,
    commitLocalRestore, localStorage: { getItem() { return null; }, setItem() { writes += 1; } },
    LISTENING_QUEUE_KEY: "queue", ALBUM_DURATIONS_KEY: "durations", STORAGE_KEY: "state",
    SUGGESTION_RECIPES_KEY: "recipes", COMPLETION_PROVENANCE_KEY: "provenance",
    COMPLETION_EVIDENCE_KEY: "evidence",
    $: (selector) => nodes[selector], applyAccessibility() {}, updateLocalSyncSummary() {}, rememberLocalChanges() {}, render() {}, showFeedback() {} };
  const preview = runInNewContext(`${appFunction("function previewLocalRestore(", '\n$("#restoreBackupInput")')}\npreviewLocalRestore`, context);
  const backup = { albums: [qosAlbum("a", { rating: 4 }), qosAlbum("b")],
    manualOrder: ["a", "b"], listeningQueue: { ids: [], resume: "", durations: {} }, durations: {},
    preferences: portablePreferences({ contrast: "high" }) };
  preview(backup);
  dialog.children[8].listeners.click();
  assert.equal(writes, 0, "cancel leaves every local store untouched");
  preview(backup);
  const firstDialog = dialog;
  assert.equal(writes, 0);
  const firstCheckbox = dialog.children[2].children[0].children[0];
  firstCheckbox.checked = true;
  firstCheckbox.listeners.change();
  state.albums = [qosAlbum("a", { rating: 3 })];
  dialog.children[7].listeners.click();
  assert.equal(writes, 0);
  assert.match(firstDialog.children[6].textContent, /cambiate durante/);
  preview(backup);
  const secondCheckbox = dialog.children[2].children[1].children[0];
  secondCheckbox.checked = true;
  secondCheckbox.listeners.change();
  dialog.children[3].children[0].checked = true;
  dialog.children[7].listeners.click();
  assert.equal(writes, 1);
  assert.equal(state.albums.find((album) => album.id === "a").rating, 3, "unchecked replacement stays unchanged");
  assert.equal(state.albums.some((album) => album.id === "b"), true);
  assert.equal(state.preferences.contrast, "high");
});

test("multi-key local restore rolls back prior writes when a later storage write fails", () => {
  const data = new Map([["state", '{"albums":[]}'], ["queue", '{"ids":[]}']]);
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) {
      if (key === "queue") throw new Error("quota");
      data.set(key, value);
    },
    removeItem: (key) => data.delete(key),
  };
  const current = { albums: [] }, next = { albums: [qosAlbum("a")] };
  assert.throws(() => commitLocalRestore(storage, "state", current, next, { queue: { ids: ["a"] } }), /quota/);
  assert.deepEqual([...data], [["state", '{"albums":[]}'], ["queue", '{"ids":[]}']]);
  assert.deepEqual(current, { albums: [] });
});

test("service worker reloads static HTTP cache on install and activates only on explicit update", async () => {
  const handlers = {}, calls = [];
  runInNewContext(readFileSync(new URL("./sw.js", import.meta.url), "utf8"), {
    URL, Request,
    self: { location: { href: "https://example.test/accord/pwa/sw.js" },
      addEventListener: (event, listener) => { handlers[event] = listener; },
      skipWaiting: async () => { calls.push("activate"); } },
    caches: { open: async () => ({ addAll: async (files) => {
      assert.ok(files.some((file) => file.url === "https://example.test/accord/pwa/index.html"));
      for (const file of files) {
        assert.ok(file instanceof Request);
        assert.equal(file.cache, "reload", "a new release must not precache stale HTTP shell/assets");
        assert.equal(new URL(file.url).origin, "https://example.test");
      }
      calls.push(`cache:${files.length}`);
    } }) },
  });
  let pending;
  handlers.install({ waitUntil: (promise) => { pending = promise; } });
  await pending;
  assert.equal(calls.some((call) => call === "activate"), false);
  handlers.message({ data: { type: "unrelated" } });
  assert.equal(calls.includes("activate"), false);
  handlers.message({ data: { type: "accord-activate-update" }, waitUntil: (promise) => { pending = promise; } });
  await pending;
  assert.equal(calls.filter((call) => call === "activate").length, 1);
});

test("shared offline navigation uses only the active version shell without requests or caching share secrets", async () => {
  const handlers = {};
  let requests = 0, stored = 0, response;
  const shell = { body: "current shell" };
  const version = readFileSync(new URL("./index.html", import.meta.url), "utf8")
    .match(/<span class="app-version">App attiva v(\d+\.\d+\.\d+)<\/span>/)?.[1];
  assert.ok(version);
  runInNewContext(readFileSync(new URL("./sw.js", import.meta.url), "utf8"), {
    URL,
    self: { location: { origin: "https://example.test", href: "https://example.test/pwa/sw.js" },
      addEventListener: (event, listener) => { handlers[event] = listener; } },
    caches: { open: async (key) => {
      assert.equal(key, `accord-album-pwa-v${version}`);
      return { match: async (file) => file === "./index.html" ? shell : undefined, put: () => { stored += 1; } };
    } },
    fetch: async () => { requests += 1; return { ok: false }; },
  });
  handlers.fetch({ request: { url: "https://example.test/pwa/?share_url=private", method: "GET", mode: "navigate" },
    respondWith: (promise) => { response = promise; } });
  assert.equal(await response, shell);
  assert.equal(requests, 0);
  assert.equal(stored, 0);
  handlers.fetch({ request: { url: "https://example.test/other/", method: "GET", mode: "navigate" },
    respondWith: (promise) => { response = promise; } });
  await response;
  assert.equal(requests, 1, "other pages cannot be replaced with Accord shell");
});

test("update guard blocks drafts, open editing dialogs, and current work but permits already-persisted local albums", () => {
  const context = { commandGuard: createCommandGuard(), qol: { drafts: {} }, busyActivitySelectors: ["#syncButton"],
    document: { querySelectorAll: (selector) => selector === "dialog" ? context.dialogs : [],
      querySelector: () => null }, dialogs: [],
    busy: false, $: () => ({ disabled: context.busy, hidden: true, querySelectorAll: () => [] }),
    localSaveError: "", localCollectionStatus: () => ({ unsaved: false }), localStorage: {}, STORAGE_KEY: "",
    normalizeLocalAlbums: (albums) => albums,
    catalogSuggestionsUI: null, catalogPlaylistUI: null, tidalUI: { isBusy: () => false }, qobuzUI: { isBusy: () => false },
    state: { albums: [qosAlbum("a")], base: [] } };
  const guard = runInNewContext(`${appFunction("function updateHasUnsavedWork(", '\nconst updateLifecycle =')}\nupdateHasUnsavedWork`, context);
  assert.equal(guard(), false);
  context.qol.drafts["edit:a"] = {};
  assert.equal(guard(), true);
  context.qol.drafts = {};
  context.dialogs = [{ id: "settingsDialog", open: true }];
  assert.equal(guard(), true);
  context.dialogs = [{ id: "activityDialog", open: true }];
  assert.equal(guard(), false);
  context.busy = true;
  assert.equal(guard(), true);
  context.busy = false;
  context.commandGuard.acquire("playlist-write");
  assert.equal(guard(), true, "writes block reload even when another button is enabled");
});

test("quick edits refuse existing drafts and otherwise use one local commit without network", () => {
  const commits = [], messages = [];
  let renders = 0;
  const context = { document: {}, state: { albums: [qosAlbum("a")] }, qol: { drafts: { "edit:a": {} } },
    commitAlbumChanges: (ids, changes) => commits.push({ ids: [...ids], changes }),
    render: () => { renders += 1; }, showFeedback: (message) => messages.push(message),
    fetch: () => { throw new Error("Unexpected request"); } };
  const edit = runInNewContext(`${appFunction("function updateAlbum(", '\n$("#searchInput").addEventListener')}\nupdateAlbum`, context);
  edit("a", { rating: 4.5 });
  assert.equal(commits.length, 0);
  assert.match(messages[0], /bozza/);
  delete context.qol.drafts["edit:a"];
  edit("a", { status: "liked" });
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0], { ids: ["a"], changes: { status: "liked" } });
  assert.equal(renders, 2);
  assert.match(uiAppSource, /quick\.append\(card\.querySelector\("\.status-field"\), card\.querySelector\("\.rating-field"\)\)/);
  assert.match(uiAppSource, /quick\.setAttribute\("aria-label"/);
});

test("explicit update action persists view and preview before activation, never activates if work or storage fails", () => {
  const nodes = Object.fromEntries(["#applyUpdateButton", "#updateStatus", "#pinnedOnlyInput", "#playlistBuilderName",
    "#playlistArtistCount", "#playlistTracksPerArtist", "#openSpotifyInput", "#searchInput", "#sortOrder", "#albumList"]
    .map((selector) => [selector, { value: selector, checked: false, addEventListener(_name, listener) { this.listener = listener; } }]));
  let blocked = true, activations = 0, snapshot;
  nodes["#albumList"].scrollTop = 123;
  const worker = { state: "installed", postMessage: (message) => {
    assert.equal(message.type, "accord-activate-update"); activations += 1;
  } };
  const context = { $: (selector) => nodes[selector], createUpdateLifecycle: (options) => {
    const lifecycle = createUpdateLifecycle({ ...options, schedule: () => 1, cancel() {} });
    lifecycle.ready(worker);
    return lifecycle;
  }, presentUpdateBanner() {},
    localCollectionChecks: [], collectionSelectionOnly: false,
    persistDetailsDraft: () => true, updateHasUnsavedWork: () => blocked,
    collectionViewSelectors: ["#searchInput", "#sortOrder"],
    selectedAlbumIds: new Set(["a"]), window: { scrollY: 0, confirm: () => true },
    localFacet: { field: "artist", value: "Band" },
    appliedCollectionSearch: "committed",
    facetReturnViews: [{ fields: { "#searchInput": "before" }, scroll: 50, selected: ["a"], facet: null }],
    topArtistPlaylistPreview: { tracks: [{ uri: "t1" }] },
    sessionStorage: { setItem: (_key, value) => { snapshot = JSON.parse(value); } } };
  runInNewContext(appFunction("const updateLifecycle =", '\ninitializeCollectionQol();'), context);
  assert.equal(activations, 0);
  nodes["#applyUpdateButton"].listener();
  assert.equal(activations, 0);
  blocked = false;
  context.sessionStorage.setItem = () => { throw new Error("quota"); };
  nodes["#applyUpdateButton"].listener();
  assert.equal(activations, 0);
  assert.equal(nodes["#applyUpdateButton"].disabled, false);
  context.sessionStorage.setItem = (_key, value) => { snapshot = JSON.parse(value); };
  nodes["#applyUpdateButton"].listener();
  assert.equal(activations, 1);
  assert.equal(snapshot.scrollY, 123);
  assert.deepEqual(snapshot.selectedIds, ["a"]);
  assert.deepEqual(snapshot.playlist.preview, { tracks: [{ uri: "t1" }] });
  assert.deepEqual(snapshot.facet, { field: "artist", value: "Band" });
  assert.equal(snapshot.facetReturnViews[0].fields["#searchInput"], "before");
  assert.equal(snapshot.appliedSearch, "committed");
  assert.equal(nodes["#applyUpdateButton"].disabled, true);
});

test("activity center reads the shared Spotify deadline locally and bounds its in-memory event history", () => {
  const nodes = { "#activityCooldown": {}, "#activityCurrent": { replaceChildren() {} },
    "#activityHistory": { replaceChildren() {} }, "#activityDialog": { open: false }, "#syncButton": { disabled: true, textContent: "Sincronizza" } };
  const events = [];
  let reads = 0;
  const context = { localStorage: { getItem: (key) => {
    assert.equal(key, "accord-spotify-rate-limit-until-v1"); reads += 1; return Date.now() + 60000;
  } }, activityStatusNodes: [], busyActivitySelectors: ["#syncButton"], activityEntries: events,
    safeDiagnostics: (value) => value,
    document: { createElement: fakeQolElement }, $: (selector) => nodes[selector],
    fetch: () => { throw new Error("Unexpected network"); },
    setInterval: () => { throw new Error("Unexpected polling"); } };
  const functions = runInNewContext(`${appFunction("function renderActivity(", '\nconst activityObserver =')}\n({renderActivity,recordActivity})`, context);
  for (let index = 0; index < 35; index += 1) functions.recordActivity(`choice ${index}`);
  assert.equal(events.length, 30);
  assert.equal(reads, 0, "closed activity center must not poll storage");
  functions.renderActivity();
  assert.equal(reads, 1);
  assert.match(nodes["#activityCooldown"].textContent, /Spotify in attesa fino a/);
});

test("accessibility application updates controls and document attributes without network", () => {
  const nodes = Object.fromEntries(["#textScaleInput", "#contrastInput", "#densityInput"].map((id) => [id, {}]));
  const document = { documentElement: { dataset: {} } };
  runInNewContext(`${appFunction("function applyAccessibility(", '\nfor (const selector of ["#textScaleInput"')}\napplyAccessibility();`, {
    collectionPreferences: portablePreferences({ textScale: "larger", contrast: "high", density: "compact" }),
    normalizeAccessibility, document, $: (id) => nodes[id],
  });
  assert.deepEqual(document.documentElement.dataset, { textScale: "larger", contrast: "high", density: "compact" });
  assert.equal(nodes["#textScaleInput"].value, "larger");
});

test("local view preferences reject malformed storage and never decorate album titles", () => {
  for (const value of [null, [], 42, "bad", { layout: "invalid", pinnedIds: false }]) {
    assert.deepEqual(normalizeCollectionPreferences(value), { layout: "compact", pinnedIds: [] });
  }
  assert.deepEqual(normalizeCollectionPreferences({
    layout: "compact", pinnedIds: ["abc", "abc", null, "../bad", "xyz"],
  }), { layout: "compact", pinnedIds: ["abc", "xyz"] });
  const record = { id: "abc", name: "Original album" };
  normalizeCollectionPreferences({ pinnedIds: [record.id] });
  assert.equal(record.name, "Original album");
});

test("local QoL helpers detect editions without merging unrelated albums", () => {
  const make = (id, name, artist = "Band") => ({ id, name, artist });
  const groups = duplicateAlbumGroups([make("a", "Album"), make("b", "Album (Deluxe Edition)"),
    make("c", "Album - 2020 Remastered"), make("d", "Album (Part II)"), make("e", "Album", "Other")]);
  assert.deepEqual(groups.map((group) => group.map((album) => album.id)), [["a", "b", "c"]]);
  assert.equal(editionTitle("Live (Part II)"), "live (part ii)");
});

test("local sync changes show only changed fields and preserve additions and removals", () => {
  const before = [{ id: "a", name: "One", rating: null }, { id: "b", name: "Two" }];
  const after = [{ id: "a", name: "One", rating: 4.5 }, { id: "c", name: "Three" }];
  const changes = albumChanges(before, after);
  assert.deepEqual(changes.map((entry) => entry.kind), ["updated", "removed", "added"]);
  assert.deepEqual(changes[0].fields, ["rating"]);
  assert.deepEqual(albumChanges(before, before), []);
});

test("smart lists and statistics are local and do not invent missing change dates", () => {
  const now = Date.parse("2026-11-03T08:00:00Z");
  const album = { id: "a", status: "queued", rating: null, genres: ["Metal"] };
  assert.equal(smartAlbumMatch("stale_queue", album, {}, now), false);
  assert.equal(smartAlbumMatch("stale_queue", album, { a: "2026-09-01T00:00:00Z" }, now), true);
  assert.equal(smartAlbumMatch("recent", album, { a: "2026-11-02T00:00:00Z" }, now), true);
  assert.equal(smartAlbumMatch("unrated", { ...album, status: "neutral" }, {}, now), true);
  assert.equal(smartAlbumMatch("favorites_unrated", { ...album, status: "liked" }, {}, now), true);
  const stats = albumStatistics([album, { ...album, id: "b", status: "liked", rating: 4.5 }]);
  assert.equal(stats.total, 2);
  assert.equal(stats.average, 4.5);
  assert.equal(stats.genres.Metal, 2);
});

test("batch metadata edits are incremental and keep unselected fields intact", () => {
  const album = { genres: ["Metal", "Power"], primary_genre: "Metal", tags: ["Epic"], collections: [] };
  assert.deepEqual(batchAlbumChanges(album, { tags: ["epic", "New"] }, "add"), { tags: ["Epic", "New"] });
  assert.deepEqual(batchAlbumChanges(album, { genres: ["Metal"] }, "remove"),
    { genres: ["Power"], primary_genre: "Power" });
  assert.deepEqual(batchAlbumChanges(album, { rating: null }, "replace"), { rating: null });
  assert.deepEqual(album.tags, ["Epic"]);
  const withExplicitPrimary = { ...album, primary_genre: "Power" };
  assert.equal(batchAlbumChanges(withExplicitPrimary, { genres: ["Rock"] }, "add").primary_genre, "Power");
});

test("suggestion explanations preserve exact references and snooze identity ignores record IDs", () => {
  const album = { name: "Album", artist: "Band", spotifySimilarTo: ["Kamelot", "Epica"] };
  assert.match(suggestionWhy(album), /Last.fm con: Kamelot, Epica/);
  assert.equal(suggestionIdentity(album), suggestionIdentity({ ...album, id: "other", name: " ALBUM " }));
  assert.match(suggestionWhy({}), /non disponibili/);
});

test("offline readiness verifies every cached shell file, not just the cache name", async () => {
  const handlers = {};
  let missing = false;
  const messages = [];
  runInNewContext(readFileSync(new URL("./sw.js", import.meta.url), "utf8"), {
    self: { addEventListener: (name, handler) => { handlers[name] = handler; } },
    caches: { open: async () => ({ match: async (file) => !missing || !file.includes("app.mjs") }) },
  });
  let pending;
  const event = { data: { type: "accord-offline-status" }, ports: [{ postMessage: (value) => messages.push(value) }],
    waitUntil: (promise) => { pending = promise; } };
  handlers.message(event);
  await pending;
  assert.equal(messages[0].ready, true);
  missing = true;
  handlers.message(event);
  await pending;
  assert.equal(messages[1].ready, false);
});

test("sync changes show before and after values for each changed field", () => {
  const before = { id: "a", artist: "Band", name: "Album", rating: null };
  const after = { ...before, rating: 4.5 };
  const source = appFunction("function changesText(", "\nfunction confirmSyncChanges(");
  const text = runInNewContext(`${source}\nchangesText(changes)`, { changes: albumChanges([before], [after]) });
  assert.match(text, /Il tuo voto: Non impostato → 4.5/);
  assert.doesNotMatch(text, /rating:|null/);
  const details = runInNewContext(`${source}\nchangesText(changes, true)`, { changes: albumChanges([before], [after]) });
  assert.match(details, /rating: null -> 4.5/);
  const hash = "a".repeat(64);
  const cover = runInNewContext(`${source}\nchangesText(changes)`, {
    changes: albumChanges([before], [{ ...before, cover_sha256: hash }]),
  });
  assert.match(cover, /Copertina: aggiornata/);
  assert.equal(cover.includes(hash), false);
});

test("sync previews do not write before approval and reject local edits made during review", async () => {
  const record = { id: "a", name: "One", artist: "Band", cover_sha256: null };
  const source = appFunction("async function sync(", '\n$("#syncButton").addEventListener');
  for (const outcome of ["cancel", "accept", "changed"]) {
    let writes = 0, saves = 0, errors = [];
    const state = { albums: [record], base: [] };
    const context = {
      state, JSON, Uint8Array, Map, Date, albumChanges, formatSyncSummary, commandGuard: createCommandGuard(),
      localStorage: { getItem: () => JSON.stringify(state) }, STORAGE_KEY: "state",
      localCollectionStatus: () => ({ unsaved: false }), serviceFailure, navigator: { onLine: true },
      normalizeLocalAlbums: (albums) => albums,
      $: () => ({ disabled: false }),
      credentials: () => ({ owner: "owner", token: "not-a-real-token" }),
      readRemote: async () => ({ albums: [], covers: new Map(), coverArchive: new Uint8Array(), branch: "main" }),
      threeWayMerge: () => ({ albums: [record], conflicts: [] }),
      confirmSyncChanges: async (outgoing, incoming) => {
        assert.equal(writes, 0);
        assert.equal(outgoing.length, 1);
        assert.equal(incoming.length, 0);
        if (outcome === "changed") state.albums = [];
        return outcome !== "cancel";
      },
      writeRemote: async () => { writes += 1; },
      commitLocalRestore: (_storage, _key, current, next) => { saves += 1; Object.assign(current, next); },
      render() {}, setSyncState() {}, updateLocalSyncSummary() {},
      saveCollectionQol() { return true; }, qol: {}, automaticSyncQueued: false,
      showMessage: (_title, message) => errors.push(message),
    };
    await runInNewContext(`${source}\nsync();`, context);
    assert.equal(writes, outcome === "accept" ? 1 : 0);
    assert.equal(saves, outcome === "accept" ? 1 : 0);
    assert.equal(errors.length, outcome === "changed" ? 1 : 0);
  }
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

test("removing albums preserves desktop list and mobile document positions only after a successful save", () => {
  for (const outcome of ["saved", "cancelled", "failed"]) {
    const list = { scrollTop: 640, scrollLeft: 24 };
    const state = { albums: [{ id: "a" }, { id: "b" }], manualOrder: ["a", "b"] };
    const selectedAlbumIds = new Set(["a"]);
    let restored = null;
    let rendered = 0;
    const context = {
      state, selectedAlbumIds, Set,
      $: () => list,
      window: {
        confirm: () => outcome !== "cancelled", scrollX: 0, scrollY: 960,
        scrollTo: (position) => { restored = position; },
      },
      prepareAlbumRemoval,
      saveState: () => { if (outcome === "failed") throw new Error("storage full"); },
      showFeedback: () => {},
      render: (options) => {
        rendered++;
        assert.deepEqual([...options.changedAlbumIds], ["a"]);
        list.scrollTop = 0;
        list.scrollLeft = 0;
      },
    };
    runInNewContext(`${appFunction("function removeSelectedAlbums()", "function commitAlbumChanges(")}
      removeSelectedAlbums();`, context);
    assert.equal(rendered, outcome === "saved" ? 1 : 0);
    assert.equal(list.scrollTop, 640);
    assert.equal(list.scrollLeft, 24);
    assert.equal(selectedAlbumIds.size, outcome === "saved" ? 0 : 1);
    assert.equal(state.albums.length, outcome === "saved" ? 1 : 2);
    if (outcome === "saved") {
      assert.deepEqual(JSON.parse(JSON.stringify(restored)), { left: 0, top: 960, behavior: "instant" });
      assert.equal(state.albums[0].id, "b");
    } else assert.equal(restored, null);
  }
});

test("manual album dialog defaults to Last.fm and preserves the saved search source", () => {
  const nodes = new Map();
  let savedSource = null;
  const context = {
    musicService: { service: "spotify" },
    $: (id) => {
      if (!nodes.has(id)) nodes.set(id, {
        addEventListener(_type, callback) { this.click = callback; },
        replaceChildren() {}, showModal() {}, focus() {},
      });
      return nodes.get(id);
    },
    updateManualAlbumSourceNotice() {},
    restoreManualAlbumDraft() {
      if (savedSource) nodes.get("#manualAlbumSource").value = savedSource;
    },
  };
  runInNewContext(appFunction('$("#manualAlbumButton").addEventListener("click"',
    '\n$("#manualAlbumSource").addEventListener'), context);
  nodes.get("#manualAlbumButton").click();
  assert.equal(nodes.get("#manualAlbumSource").value, "lastfm");
  savedSource = "musicbrainz";
  nodes.get("#manualAlbumButton").click();
  assert.equal(nodes.get("#manualAlbumSource").value, "musicbrainz");
});

test("manual Spotify additions stay local until explicit GitHub synchronization", () => {
  const album = qosAlbum("new");
  const nodes = new Map();
  const node = () => ({
    children: [], listeners: {}, append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    addEventListener(type, callback) { this.listeners[type] = callback; },
    setAttribute() {},
  });
  const context = {
    state: { albums: [] }, spotifyAlbumMetadata: new Map(), suggestedMatchAlbumId: null,
    manualAlbumSearchMatch: () => true,
    suggestedSourceAlbums: new Map(), document: { createElement: node },
    $: (id) => {
      if (!nodes.has(id)) nodes.set(id, node());
      return nodes.get(id);
    },
    createAlbumCoverFrame: () => ({ frame: node() }), setAlbumCover: () => {},
    musicBrainzCoverArtUrl: () => "", addPlaylistAlbums, saveState: () => {},
    rememberLocalChanges: () => {}, clearAlbumDraft: () => {}, render: () => {},
    setSyncState: () => {}, requestAutomaticSync: () => assert.fail("Unexpected GitHub sync"),
  };
  runInNewContext(appFunction("function addAlbumToCollection(", "\nfunction createAlbumCoverFrame(")
    + appFunction("function renderManualAlbumResults(", "\nfunction manualAlbumSearchInput(")
    + "\nrenderManualAlbumResults([album]);", { ...context, album });
  const card = nodes.get("#manualAlbumResults").children[0];
  card.children.at(-1).listeners.click();
  assert.equal(context.state.albums[0].id, album.id);
  assert.match(nodes.get("#manualAlbumStatus").textContent, /aggiunto localmente.*Sincronizza GitHub/);
});

test("unambiguous external album matches do not request automatic GitHub synchronization", async () => {
  const album = { ...qosAlbum("external"), source: "Last.fm" };
  const match = qosAlbum("matched");
  let additions = 0;
  const nodes = new Map();
  const context = {
    state: { albums: [] }, suggestedSourceAlbums: new Map(), suggestedMatchAlbumId: null,
    manualAlbumSearchMatch: () => true,
    $: (id) => {
      if (!nodes.has(id)) nodes.set(id, { replaceChildren() {} });
      return nodes.get(id);
    },
    fetchSpotifyManualAlbums: async () => [match],
    addAlbumToCollection: (record, options) => {
      assert.equal(record.id, match.id);
      assert.notEqual(options?.syncAutomatically, true);
      additions += 1;
    },
  };
  const resolve = runInNewContext(appFunction("async function resolveManualAlbumToSpotify(",
    "\nfunction updateManualAlbumSourceNotice(") + "\nresolveManualAlbumToSpotify", context);
  await resolve(album, "test-token");
  assert.equal(additions, 1);
  assert.match(nodes.get("#manualAlbumStatus").textContent, /aggiunto localmente.*Sincronizza GitHub/);
});

test("each collection filter gesture has exactly one render listener", () => {
  const controls = new Map();
  let renders = 0;
  const context = { render: () => { renders += 1; }, state: {}, saveState: () => {},
    localCollectionChecks: ["#unratedFilter", "#missingDurationFilter", "#notesPresentFilter", "#missingAssociationFilter"],
    $: (id) => {
      if (!controls.has(id)) controls.set(id, new EventTarget());
      return controls.get(id);
    } };
  runInNewContext(appFunction('$("#searchInput").addEventListener', "\nfunction clearSpotifySession("), context);
  for (const [id, control] of controls) {
    if (id === "#searchInput") continue;
    const before = renders;
    control.dispatchEvent(new Event("input"));
    control.dispatchEvent(new Event("change"));
    assert.equal(renders - before, 1, `${id} renders once per gesture`);
  }
});

test("collection search applies only when Enter is pressed", () => {
  const search = new EventTarget();
  search.value = "Artist";
  let renders = 0;
  const context = { appliedCollectionSearch: "", render: () => { renders += 1; },
    $: () => search };
  const source = appFunction("function applyCollectionSearch()", "\nfor (const input of [$(\"#primaryGenreFilter\")");
  runInNewContext(source, context);
  search.dispatchEvent(new Event("input"));
  assert.equal(renders, 0);
  assert.equal(context.appliedCollectionSearch, "");
  const enter = new Event("keydown", { cancelable: true });
  Object.defineProperty(enter, "key", { value: "Enter" });
  search.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(renders, 1);
  assert.equal(context.appliedCollectionSearch, "Artist");
  search.value = "";
  search.dispatchEvent(new Event("input"));
  assert.equal(context.appliedCollectionSearch, "");
  assert.equal(renders, 2);
  search.dispatchEvent(new Event("search"));
  assert.equal(renders, 2);
  search.value = "Another artist";
  search.dispatchEvent(new Event("input"));
  assert.equal(renders, 2);
  search.dispatchEvent(enter);
  assert.equal(renders, 3);
  search.value = "";
  search.dispatchEvent(new Event("search"));
  assert.equal(context.appliedCollectionSearch, "");
  assert.equal(renders, 4);
  assert.match(appFunction("function render(options = {})", "\nasync function renderCovers"),
    /search: appliedCollectionSearch/);
});

test("exact local facets match whole artists and labels, never substrings or another label type", () => {
  const album = qosAlbum("a", { artist: "Power Metal Band", genres: ["Power Metal"],
    tags: ["power-metal"], collections: ["Favorites"] });
  assert.equal(normalizeAlbumFacet(undefined), null);
  assert.deepEqual(normalizeAlbumFacet({ field: "artist", value: album.artist, token: "not-portable" }),
    { field: "artist", value: album.artist });
  assert.throws(() => normalizeAlbumFacet({ field: "name", value: album.name }), /non valido/);
  assert.equal(exactAlbumFacet(album, null), true);
  for (const [field, value] of [["artist", album.artist], ["genres", "Power Metal"],
    ["tags", "power-metal"], ["collections", "Favorites"]]) {
    assert.equal(exactAlbumFacet(album, { field, value }), true);
  }
  for (const [field, value] of [["artist", "Metal"], ["genres", "Metal"], ["genres", "power metal"],
    ["tags", "Power Metal"], ["collections", "Favorite"], ["name", album.name]]) {
    assert.equal(exactAlbumFacet(album, { field, value }), false);
  }
});

test("detail facet navigation is local and Back restores search, filters, sort, layout, selection and scroll", () => {
  const selectors = ["#searchInput", "#primaryGenreFilter", "#secondaryGenreFilter",
    "#statusFilter", "#collectionFilter", "#tagFilter", "#sortOrder", "#smartCollectionList", "#collectionLayout"];
  const elements = new Map(selectors.map((selector, index) => [selector, { value: `value${index}`, focus() {} }]));
  const callbacks = {};
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, { dataset: {}, addEventListener: (event, fn) => { callbacks[`${selector}:${event}`] = fn; },
      focus() {}, close() {}, scrollIntoView() {} });
    return elements.get(selector);
  };
  element("#pinnedOnlyInput").checked = true;
  element("#collectionFilters").open = true;
  element("#albumList").scrollTop = 540;
  const localCollectionChecks = ["#unratedFilter", "#missingDurationFilter", "#notesPresentFilter", "#missingAssociationFilter"];
  for (const selector of localCollectionChecks) element(selector).checked = true;
  const original = Object.fromEntries(selectors.map((selector) => [selector, element(selector).value]));
  let renders = 0;
  const context = { $: element, collectionViewSelectors: selectors, facetReturnViews: [],
    localCollectionChecks, collectionSelectionOnly: true,
    selectedAlbumIds: new Set(["a", "b"]), localFacet: null, navigatingToFacet: false,
    appliedCollectionSearch: original["#searchInput"],
    collectionPreferences: { layout: original["#collectionLayout"] }, state: {},
    window: { scrollY: 0 },
    persistDetailsDraft: () => true, activateViewTab() {}, render: () => { renders += 1; },
    requestAnimationFrame: (fn) => fn(), refreshGenreFilters() {}, saveState() {},
    saveCollectionPreferences: (preferences) => { context.collectionPreferences = preferences; },
    fetch: () => assert.fail("local navigation must not fetch"),
  };
  const source = appFunction("function openLocalFacet(", "\nfunction updateSelectionToolbar(");
  const open = runInNewContext(`${source}\nopenLocalFacet`, context);
  open("artist", "Band");
  assert.equal(context.localFacet.value, "Band");
  assert.equal(context.facetReturnViews.length, 1);
  assert.equal(element("#searchInput").value, "");
  assert.equal(element("#pinnedOnlyInput").checked, false);
  element("#collectionLayout").value = "compact";
  context.collectionPreferences.layout = "compact";
  context.selectedAlbumIds.clear();
  element("#albumList").scrollTop = 0;
  callbacks["#facetBackButton:click"]();
  assert.deepEqual(Object.fromEntries(selectors.map((selector) => [selector, element(selector).value])), original);
  assert.equal(context.localFacet, null);
  assert.deepEqual([...context.selectedAlbumIds], ["a", "b"]);
  assert.equal(context.collectionPreferences.layout, original["#collectionLayout"]);
  assert.equal(element("#pinnedOnlyInput").checked, true);
  assert.ok(localCollectionChecks.every((selector) => element(selector).checked));
  assert.equal(context.collectionSelectionOnly, true);
  assert.equal(element("#collectionFilters").open, true);
  assert.equal(element("#albumList").scrollTop, 540);
  assert.equal(renders, 2);
  context.persistDetailsDraft = () => false;
  open("tags", "blocked");
  assert.equal(context.facetReturnViews.length, 0, "a failed draft save blocks leaving details");
});

test("batch review counts actual changes and preserves incremental lists and primary genre without mutating input", () => {
  const albums = [qosAlbum("a", { genres: ["Metal", "Power Metal"], primary_genre: "Power Metal", tags: ["New"] }),
    qosAlbum("b", { tags: ["Old"] }), qosAlbum("c")];
  const before = JSON.stringify(albums);
  const review = prepareAlbumReview(albums, new Set(["a", "b"]),
    (album) => validateAlbum({ ...album, ...batchAlbumChanges(album, { tags: ["New"] }, "add") }));
  assert.deepEqual({ selected: review.selected, changed: review.changed, unchanged: review.unchanged },
    { selected: 2, changed: 1, unchanged: 1 });
  assert.deepEqual(review.changes.map(({ id, fields }) => ({ id, fields })), [{ id: "b", fields: ["tags"] }]);
  assert.deepEqual(review.changes[0].before.tags, ["Old"]);
  assert.deepEqual(review.changes[0].after.tags, ["Old", "New"]);
  assert.equal(review.next[0].primary_genre, "Power Metal");
  assert.equal(review.next[2], albums[2]);
  assert.equal(JSON.stringify(albums), before);
  assert.doesNotThrow(() => assertAlbumReviewCurrent(review, albums));
  assert.throws(() => assertAlbumReviewCurrent(review, [...albums, qosAlbum("d")]), /cambiata/);
  assert.throws(() => assertAlbumReviewCurrent(review, albums,
    JSON.stringify({ albums: [...albums, qosAlbum("d")] })), /cambiata/);
  assert.throws(() => assertAlbumReviewCurrent(review, albums, null), /cambiata/);
  assert.throws(() => prepareAlbumReview(albums, new Set(["missing"]), (album) => album), /Selezione cambiata/);
  assert.throws(() => prepareAlbumReview(albums, new Set(["a", "b"]),
    (album) => validateAlbum({ ...album, rating: 7 })), /voto/);
  assert.equal(JSON.stringify(albums), before);
});

test("normalization proposes only equivalent variants per field and applies only selected albums preserving primary role", () => {
  const albums = [
    qosAlbum("a", { genres: ["Heavy Metal", "Power Metal"], primary_genre: "Heavy Metal", tags: ["power-metal"] }),
    qosAlbum("b", { genres: ["power-metal", "Rock"], primary_genre: "power-metal", tags: ["Power Metal"],
      collections: ["My_List"] }),
    qosAlbum("c", { genres: ["Power Metal"], collections: ["my list"] }),
  ];
  const before = JSON.stringify(albums);
  const proposals = labelNormalizationProposals(albums);
  assert.deepEqual(proposals.map((entry) => entry.field), ["genres", "tags", "collections"]);
  const proposal = proposals[0];
  assert.deepEqual(new Set(proposal.labels), new Set(["Power Metal", "power-metal"]));
  assert.deepEqual(proposal.albumIds, ["a", "b", "c"]);
  const review = prepareAlbumReview(albums, new Set(["a", "b"]),
    (album) => normalizeAlbumLabels(album, proposal.field, proposal.labels, "Power metal", validateAlbum));
  assert.equal(review.changed, 2);
  assert.equal(review.unchanged, 0);
  assert.equal(review.next[0].primary_genre, "Heavy Metal");
  assert.equal(review.next[1].primary_genre, "Power metal");
  assert.deepEqual(review.next[1].genres, ["Power metal", "Rock"]);
  assert.deepEqual(review.next[1].tags, ["Power Metal"], "other label types remain untouched");
  assert.equal(review.next[2], albums[2]);
  const deduped = normalizeAlbumLabels(qosAlbum("d", { genres: ["Power Metal", "power-metal"], primary_genre: "power-metal" }),
    "genres", proposal.labels, "Power Metal", validateAlbum);
  assert.deepEqual(deduped.genres, ["Power Metal"]);
  assert.equal(deduped.primary_genre, "Power Metal");
  const noop = prepareAlbumReview(albums, new Set(["a", "c"]),
    (album) => normalizeAlbumLabels(album, "genres", proposal.labels, "Power Metal", validateAlbum));
  assert.equal(noop.changed, 0);
  assert.equal(noop.unchanged, 2);
  assert.throws(() => normalizeAlbumLabels(albums[0], "genres", proposal.labels, "  ", validateAlbum), /etichetta finale/);
  assert.equal(JSON.stringify(albums), before);
});

function localUiElement(tag = "div") {
  return { tag, children: [], events: {}, textContent: "", disabled: false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {},
    addEventListener(event, callback) { this.events[event] = callback; },
    close() { this.closed = true; }, remove() { this.removed = true; }, showModal() { this.open = true; } };
}

test("review UI requires explicit confirmation, rejects stale albums or drafts, and prevents duplicate local commits", () => {
  const before = qosAlbum("a");
  const state = { albums: [before] }, qol = { drafts: {} };
  const form = localUiElement("form"), dialog = localUiElement("dialog"), error = localUiElement("p");
  let saves = 0, renders = 0;
  const ids = new Set(["a"]);
  const build = () => prepareAlbumReview(state.albums, ids, (album) => validateAlbum({ ...album, status: "liked" }));
  const context = { document: { createElement: localUiElement }, state, qol, assertAlbumReviewCurrent,
    changesText: (changes) => `${changes[0]?.before.status} -> ${changes[0]?.after.status}`,
    safeDiagnostics: (value) => value, appendErrorActions() {},
    commitLocalRestore: (_storage, _key, current, next) => { saves += 1; Object.assign(current, next); },
    localStorage: { getItem() { return JSON.stringify(state); } }, STORAGE_KEY: "collection", rememberLocalChanges() {},
    render: () => { renders += 1; }, showFeedback() {} };
  const attach = runInNewContext(`${appFunction("function appendAlbumReview(", "\nfunction openLabelNormalization(")}\nappendAlbumReview`, context);
  attach(form, dialog, build, error);
  const submit = () => form.events.submit({ preventDefault() {} });
  const confirm = form.children.find((node) => node.textContent === "Conferma queste modifiche locali");
  const preview = form.children.find((node) => node.tag === "pre");
  assert.equal(confirm.disabled, true);
  submit();
  assert.equal(saves, 0);
  assert.match(preview.textContent, /1 selezionati · 1 realmente modificati · 0 invariati/);
  assert.match(preview.textContent, /queued -> liked/);
  state.albums = [validateAlbum({ ...before, rating: 4 })];
  confirm.events.click();
  assert.equal(saves, 0);
  assert.match(error.textContent, /cambiata/);
  submit();
  qol.drafts["edit:a"] = {};
  confirm.events.click();
  assert.equal(saves, 0);
  assert.match(error.textContent, /bozze cambiati/);
  submit();
  assert.equal(confirm.disabled, true);
  assert.match(error.textContent, /bozze locali/);
  qol.drafts = {};
  submit();
  form.events.input();
  assert.equal(confirm.disabled, true);
  submit();
  confirm.events.click();
  confirm.events.click();
  assert.equal(saves, 1);
  assert.equal(renders, 1);
  assert.equal(dialog.closed, true);
  assert.equal(state.albums[0].status, "liked");
});

test("cover inventory measures exact payload bytes and refuses unknown sizes rather than estimating", () => {
  const buffer = new Uint8Array(13).buffer;
  assert.deepEqual(coverStorageInventory([{ id: "a", data: buffer }, { id: "b", data: new Uint8Array(buffer, 3, 5) },
    { id: "c", data: new Blob([new Uint8Array(7)]) }]),
  [{ id: "a", bytes: 13 }, { id: "b", bytes: 5 }, { id: "c", bytes: 7 }]);
  assert.throws(() => coverStorageInventory([{ id: "a", data: { size: 9000 } }]), /non verificabile/);
});

test("cover removal changes only covers and suppression, preserving albums, preferences, drafts and Last.fm history", async () => {
  const saved = new Map([["collection", "albums"], ["preferences", "prefs"], ["qol", "drafts"],
    ["spotify-cooldown", "9999999999999"]]);
  const covers = new Map([["a", new Uint8Array(7)], ["b", new Uint8Array(11)]]);
  const history = { scrobbles: [{ id: "kept" }] };
  const scopes = [];
  const localStorage = { getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) };
  const database = { transaction(storeName, mode) {
    scopes.push([storeName, mode]);
    const transaction = { objectStore: (name) => {
      assert.equal(name, "covers");
      return { delete: (id) => covers.delete(id) };
    } };
    queueMicrotask(() => transaction.oncomplete());
    return transaction;
  } };
  const context = { localStorage, COVER_REMOVALS_KEY: "removed", COVER_STORE: "covers",
    openCoverDatabase: async () => database, Set, JSON };
  const source = `${appFunction("function removedCoverIds(", "\nasync function getCoverInventory(")}
    ${appFunction("async function removeCachedCovers(", "\nasync function openCoverStorageManager(")}`;
  const remove = runInNewContext(`${source}\nremoveCachedCovers`, context);
  await remove(new Set(["a"]));
  assert.deepEqual([...covers.keys()], ["b"]);
  assert.deepEqual(JSON.parse(saved.get("removed")), ["a"]);
  await remove(new Set(["a", "b"]));
  assert.equal(covers.size, 0);
  assert.deepEqual(JSON.parse(saved.get("removed")), ["a", "b"]);
  assert.deepEqual([...saved].filter(([key]) => key !== "removed"), [
    ["collection", "albums"], ["preferences", "prefs"], ["qol", "drafts"], ["spotify-cooldown", "9999999999999"],
  ]);
  assert.deepEqual(history, { scrobbles: [{ id: "kept" }] });
  assert.deepEqual(scopes, [["covers", "readwrite"], ["covers", "readwrite"]]);
  context.removedCoverIds = () => new Set(["a"]);
  context.openCoverDatabase = () => assert.fail("removed covers must not be recached even by sync");
  const cache = runInNewContext(`${appFunction("async function cacheCover(", "\nasync function cacheLastFmHistory(")}\ncacheCover`, context);
  await cache("a", new Uint8Array(7));
});

test("removed covers are not downloaded by local renders or later automatic online renders", async () => {
  const placeholder = { textContent: "" };
  const card = { dataset: { albumId: "a" }, querySelector: () => placeholder };
  const context = { $: () => ({ children: [card] }), removedCoverIds: () => new Set(["a"]),
    getCachedCover: () => assert.fail("removed cover must not be read"),
    enqueueCollectionCover: () => assert.fail("removed cover must not cause network"),
    coverRenderGeneration: 1, updateCollectionCoverNotice() {}, setSyncState() {},
    showMessage: (_title, message) => assert.fail(message) };
  const render = runInNewContext(`${appFunction("async function renderCovers(", "\nfunction collectionCoverTaskIsCurrent(")}\nrenderCovers`, context);
  await render([{ id: "a", cover_sha256: "hash" }], 1, false);
  await render([{ id: "a", cover_sha256: "hash" }], 1, true);
  assert.match(placeholder.textContent, /rimossa/);
});

test("command guard is acquired synchronously, distinguishes commands, and releases explicitly", () => {
  const guard = createCommandGuard();
  assert.equal(guard.isBusy(), false);
  assert.equal(guard.acquire("import"), true);
  assert.equal(guard.acquire("import"), false);
  assert.equal(guard.acquire("write"), true);
  guard.release("import");
  assert.equal(guard.isBusy(), true);
  assert.equal(guard.acquire("import"), true);
  guard.release("import");
  guard.release("write");
  assert.equal(guard.isBusy(), false);
});

test("playlist import rejects concurrent invocation before token lookup and gives immediate status", async () => {
  let resolveToken, tokens = 0, imports = 0;
  const messages = [], button = { disabled: false };
  const context = { commandGuard: createCommandGuard(), $: () => button,
    spotifyAccessToken: () => { tokens += 1; return new Promise((resolve) => { resolveToken = resolve; }); },
    setSyncState: (message) => messages.push(message), showFeedback: (message) => messages.push(message),
    runPlaylistImport: async () => { imports += 1; }, showMessage: (_title, message) => assert.fail(message) };
  const run = runInNewContext(`${appFunction("async function importSpotifyPlaylist(", "\nasync function startSpotifyAuthorization(")}\nimportSpotifyPlaylist`, context);
  const first = run("playlist");
  assert.equal(button.disabled, true);
  assert.match(messages[0], /in corso/);
  await run("playlist");
  assert.equal(tokens, 1);
  assert.equal(imports, 0);
  assert.match(messages[1], /già in corso/);
  resolveToken("not-a-real-token");
  await first;
  assert.equal(imports, 1);
  assert.equal(button.disabled, false);
  assert.equal(context.commandGuard.isBusy(), false);
});

test("playlist creation submits once and consumes the preview on success or uncertain failure", async () => {
  for (const failure of [false, true]) {
    let resolveToken, writes = 0;
    const elements = new Map([["#playlistBuilderName", { value: "Discovery" }], ["#playlistBuilderStatus", { textContent: "" }]]);
    const context = { commandGuard: createCommandGuard(), topArtistPlaylistPreview: { tracks: [{ uri: "spotify:track:a" }] },
      playlistCheckpointContext: null, playlistHistorical: false, spotifyPlaylistUncertainKey: "uncertain",
      localStorage: { getItem: () => null }, confirm: () => true, saveSpotifyPlaylistCheckpoint() {},
      musicService: { service: "spotify", epoch: 0, assert() {} }, catalogPlaylistUI: null,
      $: (selector) => elements.get(selector), setPlaylistBuilderBusy() {}, showFeedback() {}, showMessage() {},
      safeDiagnostics: (value) => value, sessionStorage: { getItem: () => "1" },
      spotifyAccessToken: () => new Promise((resolve) => { resolveToken = resolve; }),
      createTopArtistPlaylist: async () => { writes += 1; if (failure) throw new Error("Network outcome unknown");
        return { playlist: { name: "Discovery" }, tracks: 1 }; } };
    const run = runInNewContext(`${appFunction("async function beginPlaylistBuilderCreation(", "\nasync function searchMusicBrainzAlbums(")}\nbeginPlaylistBuilderCreation`, context);
    const first = run();
    await run();
    resolveToken("token");
    await first;
    await run();
    assert.equal(writes, 1);
    assert.equal(context.topArtistPlaylistPreview, null);
    assert.equal(context.commandGuard.isBusy(), false);
    if (failure) assert.match(elements.get("#playlistBuilderStatus").textContent, /Nessun tentativo automatico/);
  }
});

test("returning from Spotify write authorization restores the preview and never resumes a creation", () => {
  const branch = uiAppSource.slice(uiAppSource.indexOf("else if (pendingPlaylistCreate)"),
    uiAppSource.indexOf("else if (pendingPlaylist) await importSpotifyPlaylist"));
  assert.match(branch, /topArtistPlaylistPreview = request\.preview/);
  assert.match(branch, /nessuna scrittura ripresa/);
  assert.doesNotMatch(branch, /createTopArtistPlaylist\s*\(/);
});

test("sync entry point blocks overlapping writes, releases on failure, and never retries uncertain work", async () => {
  let release, operations = 0, feedback = 0;
  const context = { commandGuard: createCommandGuard(), automaticSyncQueued: false,
    showFeedback: () => { feedback += 1; }, credentials: () => ({}),
    performSync: () => { operations += 1; return new Promise((_resolve, reject) => { release = reject; }); },
    queueMicrotask: () => assert.fail("uncertain writes must not be retried") };
  const run = runInNewContext(`${appFunction("async function sync(", "\nasync function performSync(")}\nsync`, context);
  const first = run();
  await run();
  assert.equal(operations, 1);
  assert.equal(feedback, 1);
  release(new Error("uncertain outcome"));
  await assert.rejects(first, /uncertain outcome/);
  assert.equal(operations, 1);
  assert.equal(context.commandGuard.isBusy(), false);
});

test("sync applies a directional summary and records the number of resolved conflicts", async () => {
  const local = qosAlbum("local");
  const remoteOnly = qosAlbum("remote");
  const button = { disabled: false };
  const statuses = [];
  let savedSummary;
  const context = {
    credentials: () => ({ owner: "owner", token: "token" }),
    $: () => button,
    setSyncState: (message) => statuses.push(message),
    showMessage: (_title, message) => assert.fail(message),
    showFeedback: () => assert.fail("Unexpected feedback"),
    state: { albums: [local], base: [local], loadError: null },
    localStorage: { getItem: () => "stable" }, STORAGE_KEY: "state",
    localCollectionStatus: () => ({ unsaved: false }), serviceFailure, navigator: { onLine: true },
    normalizeLocalAlbums: (albums) => albums,
    commitLocalRestore: (_storage, _key, current, next) => Object.assign(current, next),
    remote: { albums: [remoteOnly], covers: new Map(), coverArchive: new Uint8Array(),
      coversSha: null, sha: null, branch: "main", legacyStatusesFound: false },
    readRemote: async () => context.remote,
    threeWayMerge: () => ({ albums: [local, remoteOnly], conflicts: [] }),
    albumChanges,
    confirmSyncChanges: async () => true,
    getCachedCover: async () => null,
    cacheCover: async () => {},
    encodeCoverArchive: async () => new Uint8Array(),
    writeRemote: async () => {},
    writeRemoteCovers: async () => assert.fail("No cover write expected"),
    saveState() {},
    saveCollectionQol: (value) => { savedSummary = value.lastSyncSummary; return true; },
    qol: {},
    updateLocalSyncSummary() {},
    render() {},
    formatSyncSummary,
  };
  context.$ = (selector) => selector === "#syncButton" ? button : assert.fail(selector);
  const run = runInNewContext(`${appFunction("async function performSync(", '\n$("#syncButton")')}\nperformSync`, context);
  await run({}, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(savedSummary)), {
    toGitHub: 1, toDevice: 1, unchanged: 0, conflictsResolved: 2,
  });
  assert.match(statuses.at(-1), /Verso GitHub: 1 · verso questo dispositivo: 1 · invariati: 0 · conflitti risolti: 2/);
  assert.equal(button.disabled, false);
});

test("sync explicitly reports a confirmed partial write and does not retry it", async () => {
  const local = qosAlbum("local", { cover_sha256: "0".repeat(64) });
  const remote = { albums: [], covers: new Map(), coverArchive: new Uint8Array([2]),
    coversSha: null, sha: null, branch: "main", legacyStatusesFound: false };
  const button = { disabled: false };
  const messages = [], writes = [];
  let saved = 0;
  const context = {
    credentials: () => ({ owner: "owner", token: "token" }),
    $: (selector) => selector === "#syncButton" ? button : assert.fail(selector),
    setSyncState: () => {},
    showMessage: (title, message) => messages.push({ title, message }),
    state: { albums: [local], base: [local], loadError: null },
    localStorage: { getItem: () => "stable" }, STORAGE_KEY: "state",
    localCollectionStatus: () => ({ unsaved: false }), serviceFailure, navigator: { onLine: true },
    normalizeLocalAlbums: (albums) => albums,
    readRemote: async () => remote,
    threeWayMerge: () => ({ albums: [local], conflicts: [] }),
    albumChanges,
    confirmSyncChanges: async () => true,
    getCachedCover: async () => new Uint8Array([5]),
    cacheCover: async () => {},
    crypto: { subtle: { digest: async () => new Uint8Array(32).buffer } },
    encodeCoverArchive: async () => new Uint8Array([1]),
    writeRemoteCovers: async () => { writes.push("covers"); },
    writeRemote: async () => { writes.push("albums"); throw new Error("album write failed"); },
    saveState: () => { saved += 1; },
    saveCollectionQol: () => true,
    qol: {},
    updateLocalSyncSummary() {},
    render() {},
    automaticSyncQueued: true,
  };
  const run = runInNewContext(`${appFunction("async function performSync(", '\n$("#syncButton")')}\nperformSync`, context);
  await run();
  assert.deepEqual(writes, ["covers", "albums"]);
  assert.equal(saved, 0);
  assert.equal(context.automaticSyncQueued, false);
  assert.equal(messages[0].title, "Sincronizzazione parziale");
  assert.match(messages[0].message, /GitHub ha confermato: copertine/);
  assert.match(messages[0].message, /La raccolta locale non è stata aggiornata/);
  assert.match(messages[0].message, /Nessun nuovo invio automatico/);
  assert.equal(button.disabled, false);
});

test("draft badges and list identify each album; resume is local and discard requires confirmation", () => {
  const body = localUiElement("body");
  const indicators = [{ hidden: true }, { hidden: true }];
  const albumCards = ["a", "b"].map((id, index) => ({ dataset: { albumId: id }, querySelector: () => indicators[index] }));
  const draftButton = {}, resumed = [];
  let confirmed = false, writes = 0, manualResumes = 0;
  const qol = { drafts: { "edit:a": { ".rating-input": "4" }, manual: {}, "edit:removed": {} } };
  const context = { document: { createElement: localUiElement, body }, qol,
    state: { albums: [qosAlbum("a"), qosAlbum("b")] },
    $: (selector) => selector === "#draftListButton" ? draftButton
      : selector === "#albumList" ? { children: albumCards } : { click: () => { manualResumes += 1; } },
    window: { confirm: () => confirmed }, activateViewTab() {},
    openAlbumDetails: (id) => resumed.push(id),
    clearAlbumDraft: (key) => { writes += 1; delete qol.drafts[key]; return true; },
    fetch: () => assert.fail("draft list and resume must not fetch"),
  };
  const functions = runInNewContext(`${appFunction("function refreshDraftIndicators(", "\nfunction suggestionNotSnoozed(")}
    \n({refreshDraftIndicators, openDraftList})`, context);
  functions.refreshDraftIndicators();
  assert.equal(draftButton.textContent, "Bozze locali (3)");
  assert.deepEqual(indicators.map((entry) => entry.hidden), [false, true]);
  functions.openDraftList();
  const dialog = body.children[0], list = dialog.children[1];
  assert.equal(list.children.length, 3);
  assert.match(list.children[0].children[0].textContent, /Album a/);
  assert.equal(list.children[2].children[1].disabled, true, "removed albums cannot resume into another album");
  list.children[0].children[1].events.click();
  assert.deepEqual(resumed, ["a"]);
  assert.equal(writes, 0);
  list.children[0].children[2].events.click();
  assert.equal(writes, 0, "dismissed confirmation preserves draft");
  confirmed = true;
  list.children[0].children[2].events.click();
  assert.equal(writes, 1);
  assert.equal(qol.drafts["edit:a"], undefined);
  list.children[0].children[1].events.click();
  assert.equal(manualResumes, 1);
  functions.refreshDraftIndicators();
  assert.deepEqual(indicators.map((entry) => entry.hidden), [true, true]);
  assert.equal(context.state.albums[0].rating, null);
});

test("failed cover deletion restores suppression and never touches collection storage", async () => {
  const saved = new Map([["removed", '["kept"]'], ["collection", "unchanged"], ["qol", "drafts"]]);
  const context = { COVER_STORE: "covers", COVER_REMOVALS_KEY: "removed", Set, JSON,
    localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key) },
    openCoverDatabase: async () => ({ transaction: (name, mode) => {
      assert.equal(name, "covers");
      assert.equal(mode, "readwrite");
      throw new Error("storage unavailable");
    } }) };
  const source = `${appFunction("function removedCoverIds(", "\nasync function getCoverInventory(")}
    ${appFunction("async function removeCachedCovers(", "\nasync function openCoverStorageManager(")}`;
  const remove = runInNewContext(`${source}\nremoveCachedCovers`, context);
  await assert.rejects(remove(new Set(["a"])), /storage unavailable/);
  assert.deepEqual([...saved], [["removed", '["kept"]'], ["collection", "unchanged"], ["qol", "drafts"]]);
});

test("actionable errors offer redacted copy, settings and canonical playlist review without starting requests", async () => {
  const actions = localUiElement(), copied = [], opened = [];
  const context = { document: { createElement: localUiElement }, collectionCoverFailures: new Map(),
    safeDiagnostics: (value) => redactDiagnostics(value, ["saved-secret"]),
    technicalDiagnostics, state: { albums: [qosAlbum("a")] }, qol: { drafts: {} },
    navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
    showFeedback() {}, openSettings: () => opened.push("settings"), credentials: () => ({}),
    fetch: () => assert.fail("error actions must not fetch automatically") };
  const append = runInNewContext(`${appFunction("function appendErrorActions(", "\nfunction openSettings(")}\nappendErrorActions`, context);
  const id = "a".repeat(22);
  append(actions, `Sessione Spotify: playlist incompleta https://open.spotify.com/playlist/${id}?token=saved-secret`);
  assert.equal(actions.children.length, 3);
  assert.equal(actions.children[0].tag, "details");
  await actions.children[0].children[1].events.click();
  assert.equal(copied.length, 1);
  assert.equal(copied[0].includes("saved-secret"), false);
  actions.children[1].events.click();
  assert.deepEqual(opened, ["settings"]);
  assert.equal(actions.children[2].href, `spotify:playlist:${id}`);
  assert.equal(actions.children[2].target, "_self");
  assert.equal(actions.children[2].rel, "noopener noreferrer");
});

test("copied diagnostics allow only technical metadata, never album, artist, password URL, token or user text", async () => {
  const album = qosAlbum("a", { name: "Private Album Title", artist: "Private Artist Name" });
  const raw = `HTTP 403: ${album.artist} · ${album.name}; private personal notes `
    + "https://private-user:private-password@private.example/PrivateAlbum?token=private-token#private-fragment "
    + "access_token=private-token";
  const copied = [], actions = localUiElement();
  const context = { document: { createElement: localUiElement }, collectionCoverFailures: new Map(),
    safeDiagnostics: (value) => redactDiagnostics(value, ["private-token"]), technicalDiagnostics,
    state: { albums: [album] }, qol: { drafts: { "edit:a": { notes: "private draft content" } } },
    navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
    showFeedback() {}, credentials: () => ({}), openSettings() {},
  };
  const append = runInNewContext(`${appFunction("function appendErrorActions(", "\nfunction openSettings(")}\nappendErrorActions`, context);
  append(actions, raw);
  await actions.children[0].children[1].events.click();
  assert.deepEqual(JSON.parse(copied[0]), { product: "Accord PWA", version: "1.4.1",
    stage: "message", httpStatuses: [403], counts: { albums: 1, drafts: 1, failedCovers: 0 } });
  for (const secret of [album.name, album.artist, "private personal notes", "private-user", "private-password",
    "private.example", "PrivateAlbum", "private-token", "private-fragment", "private draft content", "https://"]) {
    assert.equal(copied[0].includes(secret), false, secret);
  }
  assert.ok(context.safeDiagnostics(raw).includes(album.name), "runtime display remains informative");
  assert.ok(context.safeDiagnostics(raw).includes(album.artist));
  assert.deepEqual(JSON.parse(technicalDiagnostics({ stage: "Private Album Title", httpStatuses: [403, "private-token", 403, 200],
    counts: { albums: 1, drafts: "private content", failedCovers: -1, notes: "private notes" },
    rawMessage: raw, token: "private-token" })),
  { product: "Accord PWA", version: "1.4.1", stage: "message", httpStatuses: [403], counts: { albums: 1 } });
});

test("diagnostics redact saved secrets, token shapes, authorization headers and URL credentials, queries and fragments", () => {
  const text = redactDiagnostics('HTTP 403 Bearer abc123\naccess_token="my-token" refresh_token=refresh-value '
    + 'api_key=api-secret client_secret=client-secret ghp_123456 github_pat_xyz '
    + 'https://user:pass@example.test/path?code=private#token private-saved-key',
  ["private-saved-key"]);
  for (const secret of ["abc123", "my-token", "refresh-value", "api-secret", "client-secret", "ghp_123456",
    "github_pat_xyz", "user:pass", "code=private", "#token", "private-saved-key"]) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.match(text, /HTTP 403/);
  assert.match(text, /https:\/\/example.test\/path\?\[redatto\]#\[redatto\]/);
  assert.equal(redactDiagnostics("Authorization: Basic very-private\nCookie: session=private").includes("very-private"), false);
  assert.equal(redactDiagnostics("Authorization: Basic very-private\nCookie: session=private").includes("session=private"), false);
});

test("album persistence rolls back the collection on storage failure", () => {
  const previous = [{ id: "a", status: "queued" }];
  const state = { albums: previous };
  const context = {
    state, prepareAlbumUpdates, prepareAlbumReview, assertAlbumReviewCurrent, validateAlbum: (album) => album,
    commitLocalRestore, localStorage: { getItem() { return JSON.stringify(state); }, setItem() { throw new Error("storage full"); } },
    STORAGE_KEY: "collection",
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
    "#statusFilter", "#collectionFilter", "#tagFilter", "#smartCollectionList"].map((id) => [id, { value: "active", focus() {} }]));
  const localCollectionChecks = ["#unratedFilter", "#missingDurationFilter", "#notesPresentFilter", "#missingAssociationFilter"];
  for (const selector of localCollectionChecks) elements.set(selector, { checked: true });
  elements.set("#pinnedOnlyInput", { checked: true });
  const state = { sortOrder: "manual", manualOrder: ["b", "a"] };
  let renders = 0;
  runInNewContext(`${appFunction("function resetCollectionFilters(", "\nfunction openLocalFacet(")}\nresetCollectionFilters();`, {
    $: (id) => elements.get(id), state, render: () => { renders += 1; }, localCollectionChecks,
    localFacet: { field: "artist", value: "Band" },
    fetch: () => assert.fail("filters must not fetch"),
  });

  assert.equal(renders, 1);
  assert.equal(elements.get("#pinnedOnlyInput").checked, false);
  assert.ok(localCollectionChecks.every((selector) => !elements.get(selector).checked));
  assert.equal([...elements.values()].some((element) => element.value), false);
  assert.deepEqual(state, { sortOrder: "manual", manualOrder: ["b", "a"] });
});

test("one music service controls the association button and the missing-association filter", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes('id="missingAssociationFilter"'));
  assert.ok(!html.includes('id="serviceFilter"'));
  assert.ok(!uiAppSource.includes("#serviceFilter"));
  const button = {};
  const musicService = { service: "tidal" };
  const update = runInNewContext(appFunction("function updateAssociationButton(", "\n$(\"#collectionCatalogTools\")")
    + "\nupdateAssociationButton", { $: id => id === "#associateCollection" ? button : null, musicService });
  for (const [provider, name] of [["tidal", "TIDAL"], ["spotify", "Spotify"], ["qobuz", "Qobuz"]]) {
    musicService.service = provider; update();
    assert.equal(button.textContent, `Associa tutti a ${name}`);
  }
  assert.ok(appFunction("function render(", "\nfunction ").includes("updateAssociationButton();"));
});

test("contextual selection actions are hidden until an album is selected", () => {
  const elements = new Map(["#selectionToolbar", "#selectionCount", "#removeSelectedButton", "#applyBulkStatus", "#bulkStatus", "#dropHiddenSelectionButton"]
    .map((id) => [id, { value: "" }]));
  const context = { $: (id) => elements.get(id), selectedAlbumIds: new Set(), visibleAlbums: [],
    selectionVisibility: (ids) => ({ hidden: ids.size }) };
  const body = appFunction("function updateSelectionToolbar(", '\n$("#showSelectionButton")');
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
    coverRenderGeneration: 1, removedCoverIds: () => new Set(),
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

test("PWA release version matches the title, visible badge and offline cache", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  const version = html.match(/<span class="app-version">App attiva v(\d+\.\d+\.\d+)<\/span>/)?.[1];
  assert.ok(version, "The header must show a semantic release version");
  assert.ok(html.includes(`<title>Accord v${version} · La mia raccolta</title>`));
  assert.ok(sw.includes(`const CACHE = "accord-album-pwa-v${version}";`));
});

test("installable shell links resolve locally and are present in the offline cache", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.mjs", import.meta.url), "utf8");
  const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
  const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  const stylesheet = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
  const manifestPath = html.match(/<link rel="manifest" href="([^"]+)"/)?.[1];
  const appPath = html.match(/<script type="module" src="([^"]+)"/)?.[1];
  const workerFiles = sw.match(/const FILES = \[([\s\S]*?)\];/)?.[1];
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">/);
  assert.ok(stylesheet, "The document must link its stylesheet");
  assert.ok(manifestPath, "The document must link its install manifest");
  assert.ok(appPath, "The document must load its application module");
  assert.ok(workerFiles, "The service worker must declare its offline shell");
  assert.match(app, /navigator\.serviceWorker\.register\(["']\.\/sw\.js["']\)/);

  const normalizePath = (path) => path.split("?")[0].replace(/^\.\//, "");
  const cachedPaths = new Set([...workerFiles.matchAll(/"([^"]+)"/g)].map((match) => normalizePath(match[1])));
  const resources = [stylesheet, manifestPath, appPath, ...manifest.icons.map((icon) => icon.src)];
  for (const resource of resources) {
    const path = normalizePath(resource);
    assert.doesNotThrow(() => readFileSync(new URL(path, import.meta.url)), `${resource} must exist`);
    assert.ok(cachedPaths.has(path), `${resource} must be available offline`);
  }
  for (const [, modulePath] of app.matchAll(/from\s+["'](\.\/[^"']+)["']/g)) {
    const path = normalizePath(modulePath);
    assert.doesNotThrow(() => readFileSync(new URL(path, import.meta.url)), `${modulePath} must exist`);
    assert.ok(cachedPaths.has(path), `${modulePath} must be available offline`);
  }
});

test("actual Last.fm completion reads count only HTTP sends, not fresh cache hits", async () => {
  const values = new Map(), cached = new Map();
  let requests = 0, budget = 0;
  const context = {
    LASTFM_KEY: "key", LASTFM_COOLDOWN_KEY: "cooldown", LASTFM_REQUEST_AT_KEY: "at",
    LASTFM_REQUEST_INTERVAL_MS: 1000, LASTFM_RESPONSE_CACHE_TTL: 60000,
    LASTFM_RESPONSE_CACHE_METHODS: new Set(["album.gettoptags"]), lastFmPendingRequests: new Map(),
    lastFmApiRequestQueue: Promise.resolve(), navigator: {}, URLSearchParams, Date,
    localStorage: { getItem: (key) => key === "key" ? "synthetic" : values.get(key) || null,
      setItem: (key, value) => values.set(key, value) },
    lastFmResponseCache: { get: (key) => cached.get(key), set: (key, value) => cached.set(key, value) },
    fetchLastFmResponse: async () => { requests += 1; return { toptags: { tag: [] } }; },
  };
  const request = runInNewContext(`${appFunction("async function lastFmRequest(", "\nasync function fetchLastFmResponse(")}\nlastFmRequest`, context);
  const parameters = { method: "album.gettoptags", artist: "Band", album: "Album" };
  await request(parameters, () => {}, () => { budget += 1; });
  await request(parameters, () => {}, () => { budget += 1; });
  assert.equal(requests, 1);
  assert.equal(budget, 1);
});

test("actual Last.fm completion rechecks shared cooldown after pacing before counting or sending", async () => {
  const values = new Map([["at", String(Date.now())]]);
  let requests = 0, budget = 0;
  const context = {
    LASTFM_KEY: "key", LASTFM_COOLDOWN_KEY: "cooldown", LASTFM_REQUEST_AT_KEY: "at",
    LASTFM_REQUEST_INTERVAL_MS: 1000, LASTFM_RESPONSE_CACHE_TTL: 60000,
    LASTFM_RESPONSE_CACHE_METHODS: new Set(["album.gettoptags"]), lastFmPendingRequests: new Map(),
    lastFmApiRequestQueue: Promise.resolve(), navigator: {}, URLSearchParams, Date,
    localStorage: { getItem: (key) => key === "key" ? "synthetic" : values.get(key) || null,
      setItem: (key, value) => values.set(key, value) },
    lastFmResponseCache: { get() {} },
    setTimeout: (callback) => { values.set("cooldown", String(Date.now() + 120000)); callback(); },
    fetchLastFmResponse: async () => { requests += 1; return {}; },
  };
  const request = runInNewContext(`${appFunction("async function lastFmRequest(", "\nasync function fetchLastFmResponse(")}\nlastFmRequest`, context);
  await assert.rejects(request({ method: "album.gettoptags" }, () => {}, () => { budget += 1; }), /Limite Last.fm attivo/);
  assert.equal(requests, 0);
  assert.equal(budget, 0);
});

test("offline shell versions include every local module and responsive dialogs keep native modality", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  for (const file of ["app.mjs?v=122", "style.css?v=43"]) {
    assert.ok(html.includes(file));
    assert.ok(sw.includes(file));
  }
  for (const file of ["core.mjs?v=49", "ui.mjs?v=24", "tidal.mjs?v=13", "tidal-ui.mjs?v=36", "qobuz-ui.mjs?v=30",
    "qobuz.mjs?v=11", "catalog-suggestions.mjs?v=5", "suggestions-ui.mjs?v=20",
    "music-qol.mjs?v=10", "playlist-ui.mjs?v=15",
    "music-app-links.mjs?v=4", "music-continuity.mjs?v=12", "album-association.mjs?v=11",
    "music-completion.mjs?v=14", "music-completion-ui.mjs?v=14"]) {
    assert.ok(uiAppSource.includes(file));
    assert.ok(sw.includes(file));
  }
  assert.ok(readFileSync(new URL("./playlist-ui.mjs", import.meta.url), "utf8").includes("catalog-playlist.mjs?v=5"));
  assert.ok(sw.includes("catalog-playlist.mjs?v=5"));
  for (const module of ["tidal-ui.mjs", "qobuz-ui.mjs"]) {
    assert.ok(readFileSync(new URL(module, import.meta.url), "utf8").includes("music-suggestion-filters.mjs?v=3"));
  }
  assert.ok(readFileSync(new URL("./qobuz-ui.mjs", import.meta.url), "utf8").includes("qobuz-playback.mjs?v=10"));
  assert.ok(readFileSync(new URL("./suggestions-ui.mjs", import.meta.url), "utf8")
    .includes("music-suggestion-recipes.mjs?v=2"));
  for (const module of ["tidal-ui.mjs", "qobuz-ui.mjs"]) {
    assert.ok(readFileSync(new URL(module, import.meta.url), "utf8").includes("edition-comparison.mjs?v=2"));
  }
  assert.ok(sw.includes("music-suggestion-filters.mjs?v=3"));
  assert.match(html, /<dialog id="albumDetailsDialog" aria-labelledby="albumDetailsTitle">/);
  assert.match(html, /id="selectionToolbar"[^>]+hidden/);
  assert.match(css, /#albumDetailsDialog[^}]+92dvh/);
  assert.match(uiAppSource, /albumDetailsDialog"\)\.showModal\(\)/);
});

test("Spotify playlist reuses the real Suggestions candidate, album and Discogs selection path", async () => {
  const id = (number) => String(number).padStart(22, "0");
  const heard = { id: id(1), name: "Heard", genres: ["rock"] };
  const fresh = { id: id(2), name: "Fresh", genres: ["rock"], popularity: 80 };
  const other = { id: id(3), name: "Other", genres: ["rock"], popularity: 70 };
  const album = (artist, number) => ({
    id: id(number), name: `Album ${number}`, artists: [artist], album_type: "album",
    external_urls: { spotify: `https://open.spotify.com/album/${id(number)}` },
    release_date: "2025-01-01",
  });
  const makeTrack = (artist, number, record) => ({
    id: id(number), uri: `spotify:track:${id(number)}`, name: `Track ${number}`,
    artists: [artist], album: record, popularity: 50,
  });
  const freshAlbum = album(fresh, 20);
  const preferredAlbum = album(fresh, 23);
  const otherAlbum = album(other, 30);
  const samples = new Map([
    ["Fresh", [makeTrack(fresh, 21, freshAlbum), makeTrack(heard, 22, freshAlbum),
      { ...makeTrack(fresh, 24, preferredAlbum), popularity: 1 }]],
    ["Other", [makeTrack(other, 31, otherAlbum)]],
  ]);
  let failedArtist = "";
  const calls = [];
  const elements = new Map();
  for (const [selector, value] of Object.entries({
    "#spotifySuggestionPeriod": "medium_term",
    "#spotifySuggestionExclusion": "medium_term",
    "#spotifyIncludeGenresMatch": "exact",
    "#spotifyExcludeGenresMatch": "exact",
  })) elements.set(selector, { value });
  const context = {
    URLSearchParams, createSpotifyReadBudget, collectSpotifyDiscoveryAlbums, fingerprint,
    musicService: { service: "spotify", epoch: 0, assert() {} }, spotifyPlaylistAccount: null,
    spotifySettings: () => ({ clientId: "test-client" }), sessionStorage: { getItem: () => "synthetic-token" },
    spotifyAccessToken: async () => "synthetic-token", saveCheckpoint() {},
    spotifySuggestionPreferences: {},
    playlistCheckpointContext: null, playlistHistorical: false,
    buildSimilarityQueue, localStorage: { getItem: () => null }, LASTFM_KEY: "lastfm",
    spotifyDiscoveryPlaylistPreview, playlistAlbumRecords, filterListeningAlbumSuggestions,
    rankDiscogsSuggestionAlbums, state: { albums: [{ artist: "Fresh", name: "Owned old album" }] },
    playlistDiscoveryContinuation: null,
    suggestionFilterValues: () => [],
    $: (selector) => elements.get(selector) || {},
    rateDiscogsSuggestionCandidates: async (albums) => ({
      albums: albums.map((record) => ({ ...record,
        discogs: record.spotifyArtistId === other.id ? 5 : record.id === preferredAlbum.id ? 4 : 3,
        discogs_votes: 20 })),
    }),
    spotifyRequest: async (path, _token, budget) => {
      budget.read();
      calls.push(path);
      if (path === "me") return { id: "verified-test-account" };
      if (path.startsWith("me/top/artists")) return { items: [heard] };
      if (path.startsWith("me/top/tracks")) return { items: [] };
      return { artists: { items: [heard, fresh, other] } };
    },
    spotifySearchRequest: async (parameters, _token, budget) => {
      budget.read();
      const name = JSON.parse(parameters.get("q").slice(7));
      calls.push(`tracks:${name}`);
      if (name === failedArtist) throw new Error("HTTP 403");
      return { tracks: { items: samples.get(name) } };
    },
  };
  const discoverySource = appFunction("const spotifyTimeRanges =", "\nfunction renderSpotifyAlbumSuggestions(");
  const previewSource = appFunction("async function loadTopArtistPlaylistPreview(", "\nfunction renderTopArtistPlaylistPreview(");
  const api = runInNewContext(`${discoverySource}\n${previewSource}
    ({ suggestions: () => buildSpotifyAlbumSuggestions({period:"medium_term", exclusion:"medium_term"}, "token", {}),
       preview: () => loadTopArtistPlaylistPreview({artistCount:5,tracksPerArtist:3}, "token") });`, context);
  const suggestions = await api.suggestions();
  const preview = await api.preview();
  assert.deepEqual(Array.from(preview.artists, (artist) => artist.id),
    Array.from(suggestions.albums, (record) => record.spotifyArtistId));
  assert.deepEqual(Array.from(preview.artists, (artist) => artist.name), ["Other", "Fresh"]);
  assert.equal(preview.tracks.length, 2);
  assert.equal(preview.tracks.find((track) => track.sourceArtistId === fresh.id).albumId, preferredAlbum.id);
  assert.equal(preview.tracks.some((track) => track.uri === `spotify:track:${id(21)}`), false);
  assert.ok(preview.tracks.every((track) => track.sourceArtistId !== heard.id));
  assert.ok(preview.tracks.every((track) => suggestions.albums.some((record) => record.id === track.albumId)));
  assert.equal(calls.filter((path) => path.startsWith("tracks:")).length, 4);
  assert.equal(calls.includes("tracks:Heard"), false);
  context.state.albums = [
    { artist: "Fresh", name: freshAlbum.name },
    { artist: "Fresh", name: preferredAlbum.name },
  ];
  const collectionSuggestions = await api.suggestions();
  assert.equal(collectionSuggestions.albums.some((record) => record.spotifyArtistId === fresh.id), false);
  const collectionPreview = await api.preview();
  assert.deepEqual(Array.from(collectionPreview.artists, (artist) => artist.id),
    Array.from(collectionSuggestions.albums, (record) => record.spotifyArtistId),
    "playlist and Suggestions must apply the same collection exclusions");
  assert.equal(collectionPreview.artists.some((artist) => artist.id === heard.id), false);
  context.state.albums = [];
  failedArtist = "Other";
  const partial = await api.preview();
  assert.equal(partial.artists.length, 1);
  assert.equal(partial.hasMore, true);
  assert.equal(partial.partialReason, "HTTP 403");
  const freshReads = calls.filter((path) => path === "tracks:Fresh").length;
  const topReads = calls.filter((path) => path.startsWith("me/top/")).length;
  failedArtist = "";
  const continued = await api.preview();
  assert.equal(continued.artists.length, 2);
  assert.equal(continued.hasMore, false);
  assert.equal(calls.filter((path) => path === "tracks:Fresh").length, freshReads);
  assert.equal(calls.filter((path) => path.startsWith("me/top/")).length, topReads);
  samples.set("Fresh", []);
  samples.set("Other", []);
  const empty = await api.preview();
  assert.equal(empty.tracks.length, 0);
  assert.equal(empty.artists.length, 0);
  assert.equal(calls.includes("tracks:Heard"), false);
});

function pagedDiscoveryFixture({ emptyAlbums = false, interruptGenre = false, exhausted = false, endless = false } = {}) {
  const id = (number) => String(number).padStart(22, "0");
  const seed = { id: id(1), name: "Seed", genres: ["rock"] };
  const first = { id: id(2), name: "First", genres: ["rock"], popularity: 80 };
  const later = { id: id(3), name: "Later", genres: ["rock"], popularity: 70 };
  const calls = [];
  let interrupted = false;
  const context = {
    URLSearchParams, createSpotifyReadBudget, collectSpotifyDiscoveryAlbums,
    buildSimilarityQueue, localStorage: { getItem: () => null }, LASTFM_KEY: "lastfm",
    spotifyDiscoveryPlaylistPreview, playlistAlbumRecords, filterListeningAlbumSuggestions,
    rankDiscogsSuggestionAlbums, state: { albums: [] },
    suggestionFilterValues: () => [],
    $: () => ({ value: "exact" }),
    rateDiscogsSuggestionCandidates: async (albums) => ({ albums }),
    spotifyRequest: async (path, _token, budget) => {
      budget.read();
      budget.attempt();
      calls.push(path);
      if (path.startsWith("me/top/artists")) return { items: [seed] };
      if (path.startsWith("me/top/tracks")) return { items: [] };
      const offset = Number(new URLSearchParams(path.slice(7)).get("offset"));
      if (interruptGenre && offset === 1 && !interrupted) {
        interrupted = true;
        while (budget.actual < 40) budget.attempt();
        budget.attempt();
      }
      return { artists: {
        offset, items: endless ? Array(10).fill(first) : offset === 0 ? [emptyAlbums ? first : seed] : [later],
        next: endless || !exhausted && offset === 0 ? "next" : null,
      } };
    },
    spotifySearchRequest: async (parameters, _token, budget) => {
      budget.read();
      budget.attempt();
      const name = JSON.parse(parameters.get("q").slice(7));
      calls.push(`tracks:${name}`);
      if (name === first.name) return { tracks: { items: [] } };
      const album = {
        id: id(20), name: "New album", artists: [later], album_type: "album",
        external_urls: { spotify: `https://open.spotify.com/album/${id(20)}` },
        release_date: "2025-01-01",
      };
      return { tracks: { items: [{
        id: id(21), uri: `spotify:track:${id(21)}`, name: "New track",
        artists: [later], album, popularity: 50,
      }] } };
    },
  };
  const source = appFunction("const spotifyTimeRanges =", "\nfunction renderSpotifyAlbumSuggestions(");
  const build = runInNewContext(`${source}\nbuildSpotifyAlbumSuggestions;`, context);
  return {
    calls,
    run: (continuation = null) => build({ period: "medium_term", exclusion: "medium_term" }, "token", {}, {
      maximum: 10, continuation, excludeCollectionAlbums: false,
      playlistRequest: { artistCount: 1, tracksPerArtist: 3, timeRange: "medium_term" },
    }),
  };
}

test("Spotify shared discovery refills later genre pages after filtered candidates or empty artist albums", async () => {
  for (const emptyAlbums of [false, true]) {
    const fixture = pagedDiscoveryFixture({ emptyAlbums });
    const result = await fixture.run();
    assert.equal(result.albums.length, 1);
    assert.equal(result.albums[0].spotifyRelatedArtist, "Later");
    const searches = fixture.calls.filter((path) => path.startsWith("search?"));
    assert.equal(searches.length, 2);
    assert.ok(searches[0].includes("offset=0"));
    assert.ok(searches[1].includes("offset=1"));
    assert.equal(result.continuation, null);
    assert.equal(result.partialReason, "");
  }
});

test("Spotify genre discovery budget interruption retains cursor and resumes without repeated completed pages", async () => {
  const fixture = pagedDiscoveryFixture({ interruptGenre: true, emptyAlbums: true });
  const first = await fixture.run();
  assert.ok(first.continuation);
  assert.equal(first.reads.actual, 40);
  assert.match(first.partialReason, /40 letture/);
  assert.equal(first.continuation.genrePages[0].offset, 1);
  assert.equal(first.continuation.candidates.size, 1);
  assert.equal(first.continuation.processedArtistIds.size, 1);
  const second = await fixture.run(first.continuation);
  assert.equal(second.albums.length, 1);
  assert.equal(second.continuation, null);
  assert.equal(fixture.calls.filter((path) => path.startsWith("me/top/")).length, 2);
  assert.equal(fixture.calls.filter((path) => path.startsWith("search?") && path.includes("offset=0")).length, 1);
  assert.equal(fixture.calls.filter((path) => path === "tracks:First").length, 1);
});

test("Spotify exhausted discovery stops finitely with no misleading continuation or heard fallback", async () => {
  for (const emptyAlbums of [false, true]) {
    const fixture = pagedDiscoveryFixture({ emptyAlbums, exhausted: true });
    const result = await fixture.run();
    assert.equal(result.albums.length, 0);
    assert.equal(result.continuation, null);
    assert.equal(result.partialReason, "");
    assert.equal(fixture.calls.filter((path) => path.startsWith("search?")).length, 1);
    assert.equal(fixture.calls.includes("tracks:Seed"), false);
  }
  const bounded = pagedDiscoveryFixture({ endless: true });
  const result = await bounded.run();
  assert.equal(result.continuation, null);
  assert.equal(result.albums.length, 0);
  assert.equal(bounded.calls.filter((path) => path.startsWith("search?")).length, 5);
  assert.equal(bounded.calls.filter((path) => path === "tracks:First").length, 1);
});

test("Spotify discovery preserves completed artists on errors and only continues on a manual pass", async () => {
  const discovery = { artists: [{ id: "a" }, { id: "b" }, { id: "c" }], albums: [], nextArtist: 0 };
  const calls = [];
  const first = await collectSpotifyDiscoveryAlbums(discovery, async (artist) => {
    calls.push(artist.id);
    if (artist.id === "b") throw new Error("HTTP 403");
    return [{ id: artist.id }];
  });
  assert.deepEqual(calls, ["a", "b"]);
  assert.deepEqual(first.albums, [{ id: "a" }]);
  assert.equal(first.hasMore, true);
  assert.equal(first.partialReason, "HTTP 403");
  const second = await collectSpotifyDiscoveryAlbums(discovery, async (artist) => {
    calls.push(artist.id);
    return [{ id: artist.id }];
  });
  assert.deepEqual(calls, ["a", "b", "b", "c"]);
  assert.deepEqual(second.albums.map((record) => record.id), ["a", "b", "c"]);
  assert.equal(second.hasMore, false);
});

test("Spotify playlist rejects wrong artist identities, album identities, forged URIs and unavailable tracks", () => {
  const id = (number) => String(number).padStart(22, "0");
  const artist = { id: id(1), name: "Artist" };
  const track = { id: id(3), uri: `spotify:track:${id(3)}`, name: "Valid", artists: [artist], album: { id: id(2) } };
  const record = {
    id: id(2), spotifyArtistId: artist.id, spotifyRelatedArtist: artist.name,
    spotifyTracks: [
      { ...track, artists: [{ id: id(9), name: "Artist" }] },
      { ...track, album: { id: id(8) } },
      { ...track, uri: `spotify:track:${id(4)}` },
      { ...track, is_playable: false }, { ...track, restrictions: { reason: "market" } },
      track, track,
    ],
  };
  const preview = spotifyDiscoveryPlaylistPreview([record], { artistCount: 50, tracksPerArtist: 10 });
  assert.equal(preview.tracks.length, 1);
  assert.equal(preview.tracks[0].uri, track.uri);
});

test("Spotify discovery caps logical reads and actual retry attempts at forty per manual pass", async () => {
  for (const limit of [0, -1, 41, 1.5, NaN]) {
    assert.throws(() => createSpotifyReadBudget(limit), /1 e 40/);
  }
  const budget = createSpotifyReadBudget();
  for (let index = 0; index < 40; index += 1) budget.read();
  assert.throws(() => budget.read(), /40 letture/);
  assert.equal(budget.logical, 40);
  const fixture = spotifyTransportFixture(() => spotifyHttpResponse(503));
  for (let index = 0; index < 13; index += 1) {
    await fixture.transport.fetch("search", {}, true, budget);
  }
  assert.equal(fixture.calls.length, 39);
  await assert.rejects(fixture.transport.fetch("search", {}, true, budget), /40 letture/);
  assert.equal(fixture.calls.length, 40);
  assert.equal(budget.actual, 40);
  await assert.rejects(fixture.transport.fetch("search", {}, true, budget), /40 letture/);
  assert.equal(fixture.calls.length, 40);
  const nextManualPass = createSpotifyReadBudget();
  assert.equal(nextManualPass.logical, 0);
  assert.equal(nextManualPass.actual, 0);
});

test("Spotify discovery counts cache hits as logical reads while reusing the normal transport", async () => {
  const fixture = spotifyTransportFixture(() =>
    ({ ...spotifyResponse({ items: [] }, { "Cache-Control": "max-age=600" }), ok: true }));
  const context = {
    URL, SPOTIFY_API: "https://api.spotify.com/v1",
    musicService: { epoch: 0, assert() {} },
    spotifyTransport: fixture.transport, spotifyJsonReader: createSpotifyJsonReader(),
    clearSpotifySession() { assert.fail("unexpected expired session"); },
    readSpotifySearchPages,
  };
  const source = appFunction("async function spotifyApiFetch(", "\nasync function spotifyWriteRequest(");
  const request = runInNewContext(`${source}\nspotifyRequest;`, context);
  const budget = createSpotifyReadBudget();
  for (let index = 0; index < 40; index += 1) {
    await request("me/top/artists?limit=50&time_range=medium_term", "token", budget);
  }
  await assert.rejects(request("me/top/artists?limit=50&time_range=medium_term", "token", budget), /40 letture/);
  assert.equal(budget.logical, 40);
  assert.equal(budget.actual, 1);
  assert.equal(fixture.calls.length, 1);
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
    assert.deepEqual(fixture.waits, delay < 3000 ? [delay, 3000 - delay] : [delay]);
    assert.equal(fixture.calls.length, 2);
    assert.equal(fixture.calls[1].time - fixture.calls[0].time, Math.max(delay, 3000));
  }
});

test("Spotify read retries are bounded, quota errors are not retried, and cooldown survives exhaustion", async () => {
  const fixture = spotifyTransportFixture(() => spotifyHttpResponse(429, "1"));
  await assert.rejects(fixture.transport.fetch("catalog", {}, true), /Limite richieste/);
  assert.equal(fixture.calls.length, 3);
  assert.deepEqual(fixture.waits, [1000, 2000, 1000, 2000]);
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
  assert.deepEqual(fixture.waits, [500, 1500, 1000, 1000, 2000]);
  assert.equal(fixture.calls.length, 3);
  assert.equal(fixture.calls[1].time - fixture.calls[0].time, 3000);
  assert.equal(fixture.calls[2].time - fixture.calls[1].time, 3000);
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

test("Spotify proactive pacing persists exact three-second slots across queued jobs and separate tabs", async () => {
  let queue = Promise.resolve();
  const lock = (_name, task) => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  const fixture = spotifyTransportFixture(() => spotifyHttpResponse(200), { lock });
  const secondTab = createSpotifyTransport(fixture.options);
  await Promise.all([
    fixture.transport.fetch("catalog", {}, true),
    secondTab.fetch("token", { method: "POST" }),
    fixture.transport.fetch("playlist", { method: "POST" }),
  ]);
  assert.deepEqual(fixture.calls.map((call) => call.time - fixture.calls[0].time), [0, 3000, 6000]);
  assert.deepEqual(fixture.waits, [3000, 3000]);
  assert.equal(Number(fixture.values.get("accord-spotify-request-at-v1")), fixture.calls[2].time);
  await createSpotifyTransport(fixture.options).fetch("another-catalog", {}, true);
  assert.equal(fixture.calls[3].time - fixture.calls[2].time, 3000);
});

test("Spotify malformed persisted pacing timestamps fail before HTTP while a missing timestamp permits first use", async () => {
  for (const value of ["", " ", "\t\n", "NaN", "Infinity", "-Infinity", "-1", "invalid"]) {
    const fixture = spotifyTransportFixture(() => spotifyHttpResponse(200));
    fixture.values.set("accord-spotify-request-at-v1", value);
    await assert.rejects(fixture.transport.fetch("catalog", {}, true),
      /Configurazione intervallo Spotify non valida.*accord-spotify-request-at-v1/);
    assert.equal(fixture.calls.length, 0);
    assert.deepEqual(fixture.waits, []);
    assert.equal(fixture.values.get("accord-spotify-request-at-v1"), value);
  }
  const fixture = spotifyTransportFixture(() => spotifyHttpResponse(200));
  await fixture.transport.fetch("catalog", {}, true);
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(fixture.waits, []);
});

test("Spotify cache hits consume no pacing wait and the next actual request retains its slot", async () => {
  const fixture = spotifyTransportFixture(() =>
    spotifyResponse({ items: [] }, { "Cache-Control": "max-age=600" }));
  const reader = createSpotifyJsonReader();
  const read = (url) => reader.read(url, "token", () => fixture.transport.fetch(url, {}, true));
  const url = "https://api.spotify.com/v1/search?q=first&type=artist";
  await read(url);
  await read(url);
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(fixture.waits, []);
  await read("https://api.spotify.com/v1/search?q=second&type=artist");
  assert.equal(fixture.calls.length, 2);
  assert.deepEqual(fixture.waits, [3000]);
});

test("Spotify long Retry-After remains unchanged and sends no jobs during the cooldown", async () => {
  const fixture = spotifyTransportFixture(() => spotifyHttpResponse(429, "17240"));
  const start = fixture.now();
  await assert.rejects(fixture.transport.fetch("catalog", {}, true), /17240 secondi/);
  const until = String(start + 17_240_000);
  assert.equal(fixture.values.get(spotifyCooldownKey), until);
  await assert.rejects(fixture.transport.fetch("other", {}, true), /17240 secondi/);
  await assert.rejects(fixture.transport.fetch("playlist", { method: "POST" }), /17240 secondi/);
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(fixture.waits, []);
  assert.equal(fixture.values.get(spotifyCooldownKey), until);
});

test("Spotify cooldown extended during proactive pacing is rechecked before sending a write", async () => {
  let time = Date.UTC(2026, 9, 28);
  let fixture;
  fixture = spotifyTransportFixture(() => spotifyHttpResponse(200), {
    now: () => time,
    wait: async (delay) => {
      time += delay;
      fixture.values.set(spotifyCooldownKey, String(time + 17_240_000));
    },
  });
  await fixture.transport.fetch("first", {}, true);
  await assert.rejects(fixture.transport.fetch("playlist", { method: "POST" }), /17240 secondi/);
  assert.equal(fixture.calls.length, 1);
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
  assert.equal(requests, 1, "headerless catalog reads use the conservative default TTL");
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
  reader.invalidateMutable();
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
  assert.equal(validateAlbum(album("neutral", { status: "neutral" })).status, "neutral");
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

test("field-wise merge preserves independent edits and asks only for true conflicts", () => {
  const base = album("abc");
  const local = album("abc", { rating: 4 });
  const remote = album("abc", { genres: ["Jazz"] });
  const merged = threeWayMerge([base], [local], [remote]);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.albums[0].rating, 4);
  assert.deepEqual(merged.albums[0].genres, ["Jazz"]);

  const conflict = threeWayMerge([base], [local], [album("abc", { rating: 3 })]);
  assert.equal(conflict.albums.length, 0);
  assert.equal(conflict.conflicts[0].id, "abc");
  assert.deepEqual(conflict.conflicts[0].fields.map((field) => field.field), ["rating"]);
  assert.equal(threeWayMerge([base], [local], [album("abc", { rating: 3 })],
    { abc: { rating: "local" } }).albums[0].rating, 4);
  assert.equal(threeWayMerge([base], [local], [album("abc", { rating: 3 })],
    { abc: { rating: "remote" } }).albums[0].rating, 3);
});

test("note conflicts are archived locally before choice without collapsing missing and empty notes", () => {
  const values = new Map(), writes = [];
  const context = {
    ALBUM_NOTE_CONFLICT_ARCHIVE_KEY: "notes-conflicts",
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => { values.set(key, value); writes.push(value); },
    },
    redactDiagnostics,
  };
  const archive = runInNewContext(`${appFunction("function archiveAlbumNoteConflicts(", "\nasync function sync(")}\narchiveAlbumNoteConflicts`,
    context);
  const conflict = { id: "abc", fields: [{ field: "notes", base: null, local: "", remote: "GitHub note" }] };
  assert.equal(archive([conflict], "sha-1"), 1);
  const first = JSON.parse(values.values().next().value);
  assert.deepEqual(first[0].base, { present: false, value: "" });
  assert.deepEqual(first[0].device, { present: true, value: "" });
  assert.deepEqual(first[0].github, { present: true, value: "GitHub note" });
  assert.equal(archive([conflict], "sha-1"), 0);
  assert.equal(writes.length, 1, "an existing version is never overwritten");
  assert.throws(() => archive([{ id: "abc", fields: [
    { field: "notes", base: null, local: "access_token=secret", remote: "other" },
  ] }], "sha-2"), /credenziale/);
  assert.equal(writes.length, 1);
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

test("classifies and deduplicates Spotify single / EP releases without persisting selection metadata", () => {
  const albumId = "0123456789012345678901";
  const singleId = "1123456789012345678901";
  const makeItem = (id, type, totalTracks = 0) => ({
    type: "track",
    album: {
      id, name: `Record ${id}`, album_type: type, total_tracks: totalTracks,
      artists: [{ name: "Artist" }],
      external_urls: { spotify: `https://open.spotify.com/album/${id}` },
      release_date: "2024-01-02",
    },
  });
  const entries = [
    { item: makeItem(albumId, "album") },
    { track: makeItem(singleId, "single", 3) },
    { item: makeItem(singleId, "single", 3) },
    { item: makeItem("2123456789012345678901", "compilation") },
    { item: { type: "episode" } },
  ];
  const releases = playlistReleaseRecords(entries);
  assert.deepEqual(releases.albums, [album(albumId, {
    name: `Record ${albumId}`, artist: "Artist", year: "2024", primary_genre: "",
  })]);
  assert.deepEqual(releases.singles, [{
    album: album(singleId, { name: `Record ${singleId}`, artist: "Artist", year: "2024", primary_genre: "" }),
    totalTracks: 3,
  }]);
  assert.equal(releases.skipped, 2);
  assert.deepEqual(spotifyAlbumSearchRecords(entries), [
    ...releases.albums, ...releases.singles.map(({ album: record }) => record),
  ]);
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

test("similar-artist ranking rewards consensus and matches the desktop scoring", () => {
  const ranked = rankSimilarArtists([
    ["Kamelot", 100, [{ name: "Solo match", match: 1 }, { name: "Shared", match: 0.6 }]],
    ["Epica", 100, [{ name: "Shared", match: 0.6 }]],
    ["Nightwish", 100, [{ name: "Shared", match: 0.5 }, { name: "kamelot", match: 0.9 }]],
  ], ["heard"]);
  assert.equal(ranked[0].name, "Shared");
  assert.equal(ranked[0].support, 3);
  assert.deepEqual(ranked[0].seeds, ["Epica", "Kamelot", "Nightwish"]);
  assert.ok(!ranked.some((item) => item.name.toLowerCase() === "kamelot"));
});

test("similar-artist ranking caps candidates per reference before overflow", () => {
  const ranked = rankSimilarArtists([
    ["Dominant", 1000, [0, 1, 2, 3, 4].map((index) => ({ name: `D${index}`, match: 0.9 - index / 100 }))],
    ["Other", 1000, [{ name: "O1", match: 0.5 }]],
  ]);
  assert.deepEqual(ranked.map((item) => item.name), ["D0", "D1", "D2", "O1", "D3", "D4"]);
});

test("similarity queue queries only the strongest references and stops on a Last.fm limit", async () => {
  const references = Array.from({ length: 20 }, (_, index) => ({ name: `Seed ${index}`, weight: 50 - index }));
  const asked = [];
  const result = await buildSimilarityQueue(references, async (name) => {
    asked.push(name);
    if (asked.length === 3) throw new Error("Limite Last.fm raggiunto");
    return [{ name: `${name} friend`, match: 0.5 }];
  });
  assert.deepEqual(asked, ["Seed 0", "Seed 1", "Seed 2"]);
  assert.equal(result.queue.length, 2);
  assert.match(result.note, /parziale/);
  const full = [];
  await buildSimilarityQueue(references, async (name) => { full.push(name); return []; });
  assert.equal(full.length, 12);
});

test("Spotify discovery takes Last.fm similar artists before genre search and keeps them queued on errors", async () => {
  const id = (number) => String(number).padStart(22, "0");
  const seed = { id: id(1), name: "Seed", genres: ["rock"] };
  const later = { id: id(3), name: "Later", genres: ["rock"], popularity: 70 };
  const calls = [];
  let failResolution = true;
  const context = {
    URLSearchParams, createSpotifyReadBudget, collectSpotifyDiscoveryAlbums, buildSimilarityQueue,
    resolveArtistFromTracks, spotifyDiscoveryPlaylistPreview, playlistAlbumRecords, filterListeningAlbumSuggestions,
    rankDiscogsSuggestionAlbums, state: { albums: [] },
    localStorage: { getItem: () => "key" }, LASTFM_KEY: "lastfm",
    similarLastFmArtists: async (name) => { calls.push(`lastfm:${name}`); return [{ name: "Later", match: 0.9 }]; },
    suggestionFilterValues: () => [],
    $: () => ({ value: "exact" }),
    rateDiscogsSuggestionCandidates: async (albums) => ({ albums }),
    spotifyRequest: async (path, _token, budget) => {
      budget.read();
      budget.attempt();
      calls.push(path);
      if (path.startsWith("me/top/artists")) return { items: [seed] };
      if (path.startsWith("me/top/tracks")) return { items: [] };
      const query = new URLSearchParams(path.slice(7)).get("q");
      if (query.startsWith("artist:")) {
        if (failResolution) {
          failResolution = false;
          throw new Error("Limite Spotify raggiunto");
        }
        return { artists: { items: [later] } };
      }
      return { artists: { items: [], next: null } };
    },
    spotifySearchRequest: async (parameters, _token, budget) => {
      budget.read();
      budget.attempt();
      calls.push(`${parameters.get("type")}:${parameters.get("q")}:${parameters.get("limit")}`);
      if (failResolution) {
        failResolution = false;
        throw new Error("Limite Spotify raggiunto");
      }
      const album = {
        id: id(20), name: "New album", artists: [later], album_type: "album",
        external_urls: { spotify: `https://open.spotify.com/album/${id(20)}` }, release_date: "2025-01-01",
      };
      return { tracks: { items: [{ id: id(21), uri: `spotify:track:${id(21)}`, name: "New track",
        artists: [later], album, popularity: 50 }] } };
    },
  };
  const source = appFunction("const spotifyTimeRanges =", "\nfunction renderSpotifyAlbumSuggestions(");
  const build = runInNewContext(`${source}\nbuildSpotifyAlbumSuggestions;`, context);
  const run = (continuation = null) => build({ period: "medium_term", exclusion: "medium_term" }, "token", {}, {
    maximum: 10, continuation, excludeCollectionAlbums: false,
    playlistRequest: { artistCount: 1, tracksPerArtist: 1, timeRange: "medium_term" },
  });
  const first = await run();
  assert.equal(first.albums.length, 0);
  assert.match(first.partialReason, /Limite Spotify/);
  assert.ok(first.continuation);
  const second = await run(first.continuation);
  assert.deepEqual(Array.from(second.albums, (record) => record.spotifyArtistId), [later.id]);
  assert.deepEqual(Array.from(second.albums[0].spotifySimilarTo), ["Seed"]);
  assert.equal(second.similarityCandidates, 1);
  assert.equal(calls.filter((call) => call.startsWith("lastfm:")).length, 1);
  assert.equal(calls.some((call) => call.includes("genre%3A")), false);
  // One track search resolves the artist and supplies its albums: no artist search, no second read.
  assert.deepEqual(calls.filter((call) => call.startsWith("track:")), ['track:artist:"Later":10', 'track:artist:"Later":10']);
  assert.equal(calls.some((call) => call.startsWith("search?")), false);
});

test("track-based artist resolution prefers the most frequent exact homonym", () => {
  const first = { id: "a".repeat(22), name: "Band" };
  const second = { id: "b".repeat(22), name: "band " };
  const other = { id: "c".repeat(22), name: "Band Two" };
  const tracks = [{ artists: [first] }, { artists: [second, other] }, { artists: [second] }, { artists: "bad" }];
  assert.equal(resolveArtistFromTracks(tracks, "Band").id, second.id);
  assert.equal(resolveArtistFromTracks([{ artists: [other] }], "Band"), null);
});

test("Spotify top lists reuse the HTTP cache for 30 minutes only when server policy permits", async () => {
  const calls = [];
  const artist = { id: "a".repeat(22), name: "Seed" };
  let now = 0;
  const reader = createSpotifyJsonReader({ cache: createConditionalJsonCache({ now: () => now }) });
  let headers = {};
  const context = {
    URLSearchParams, JSON,
    spotifyRequest: (path, token) => reader.read(new URL(path, "https://api.spotify.com/v1/"), token,
      async () => { calls.push(path); return spotifyResponse({ items: [artist] }, headers); }),
  };
  const source = appFunction("const spotifyTimeRanges =", "\nasync function resolveSimilarSpotifyArtists(");
  const read = runInNewContext(`${source}\nreadSpotifyTopArtists;`, context);
  const first = await read("short_term", "token", null);
  first[0].name = "mutated";
  assert.equal((await read("short_term", "token", null))[0].name, "Seed");
  assert.equal(calls.length, 1);
  await read("long_term", "token", null);
  now = 30 * 60 * 1000;
  await read("short_term", "token", null);
  assert.equal(calls.length, 3);
  headers = { "Cache-Control": "no-store" };
  reader.clear();
  await read("short_term", "token", null);
  await read("short_term", "token", null);
  assert.equal(calls.length, 5);
  headers = { "Cache-Control": "max-age=1" };
  await read("short_term", "token", null);
  now += 1000;
  await read("short_term", "token", null);
  assert.equal(calls.length, 7);
});

test("playlist writes preserve catalog cache and HTTP no-store policy", async () => {
  const reader = createSpotifyJsonReader();
  for (const directive of ["max-age=300", "no-store"]) {
    reader.clear();
    let reads = 0;
    const url = "https://api.spotify.com/v1/albums/album";
    const request = async () => spotifyResponse({ id: ++reads }, { "Cache-Control": directive });
    await reader.read(url, "token", request);
    const context = {
      URL, SPOTIFY_API: "https://api.spotify.com/v1", spotifyJsonReader: reader,
      spotifyApiFetch: async () => ({ ...spotifyResponse({ snapshot_id: "new" }), ok: true }),
    };
    const write = runInNewContext(appFunction("async function spotifyWriteRequest(", "\nasync function completeSpotifyPages(")
      + "\nspotifyWriteRequest;", context);
    await write("playlists/one/items", "token", { uris: ["spotify:track:one"] });
    await reader.read(url, "token", request);
    assert.equal(reads, directive === "no-store" ? 2 : 1);
  }
});

test("PWA playlist import applies only selected singles without additional Spotify reads", async () => {
  const albumId = "a".repeat(22);
  const firstSingleId = "s".repeat(22);
  const secondSingleId = "t".repeat(22);
  const entry = (id, type) => ({
    item: { type: "track", album: {
      id, name: `Record ${id}`, album_type: type, total_tracks: 2,
      artists: [{ name: "Artist" }],
      external_urls: { spotify: `https://open.spotify.com/album/${id}` },
      release_date: "2025-01-01",
    } },
  });
  let pages = 0;
  let checks = 0;
  let writes = 0;
  const state = { albums: [] };
  const context = {
    JSON, Map, Set, state, spotifyPlaylistSnapshots: new Map(),
    resolveSpotifyPlaylist: async () => ({ id: "p".repeat(22), name: "Synthetic", snapshot_id: "snapshot" }),
    completeSpotifyPages: async () => {
      pages += 1;
      return [entry(albumId, "album"), entry(firstSingleId, "single"), entry(secondSingleId, "single")];
    },
    spotifyRequest: async () => { checks += 1; return { id: "p".repeat(22), snapshot_id: "snapshot" }; },
    playlistReleaseRecords, addPlaylistAlbums,
    chooseSpotifyPlaylistSingles: async (_name, singles) => ({
      confirmed: true, ids: singles.map(({ album: record }) => record.id).slice(0, 1),
    }),
    window: { confirm: () => assert.fail("single selection dialog confirms the import") },
    setSyncState: () => {}, saveState: () => { writes += 1; },
    rememberLocalChanges: () => {}, render: () => {}, showMessage: () => {},
  };
  const read = runInNewContext(appFunction("async function runPlaylistImport(", "\nasync function importSpotifyPlaylist(")
    + "\nrunPlaylistImport;", context);
  await read("test", "token");
  assert.deepEqual(state.albums.map(({ id }) => id), [albumId, firstSingleId]);
  assert.equal(writes, 1);
  assert.equal(pages, 1);
  assert.equal(checks, 1);
});

test("PWA imports reuse only verified account-scoped playlist snapshots", async () => {
  let pages = 0;
  let checks = 0;
  let writes = 0;
  let snapshot = "v1";
  let latest = "v1";
  const context = {
    JSON, Map,
    state: { albums: [] },
    spotifyPlaylistSnapshots: new Map(),
    resolveSpotifyPlaylist: async () => ({ id: "p".repeat(22), name: "Synthetic", snapshot_id: snapshot }),
    completeSpotifyPages: async () => {
      pages += 1;
      return [{ track: { type: "track", album: { id: "a".repeat(22), name: "Synthetic",
        album_type: "album", artists: [{ name: "Artist" }],
        external_urls: { spotify: `https://open.spotify.com/album/${"a".repeat(22)}` } } } }, { track: null }];
    },
    spotifyRequest: async () => { checks += 1; return { id: "p".repeat(22), snapshot_id: latest }; },
    playlistReleaseRecords,
    addPlaylistAlbums,
    window: { confirm: () => false },
    setSyncState: () => {},
    saveState: () => { writes += 1; },
  };
  const read = runInNewContext(appFunction("async function runPlaylistImport(", "\nasync function importSpotifyPlaylist(")
    + "\nrunPlaylistImport;", context);
  await read("test", "first-token");
  await read("test", "first-token");
  assert.equal(pages, 1);
  const reused = context.spotifyPlaylistSnapshots.get(JSON.stringify(["first-token", "p".repeat(22)]));
  assert.equal(JSON.parse(reused.summary).count, 2);
  assert.equal(JSON.parse(reused.summary).skipped, 1);
  assert.equal(JSON.parse(reused.summary).albums.length, 1);
  assert.equal("entries" in reused, false, "full track payloads are not retained");
  assert.equal(checks, 2, "fresh snapshot metadata is always verified");
  await read("test", "second-token");
  assert.equal(pages, 2);
  snapshot = latest = "v2";
  await read("test", "first-token");
  assert.equal(pages, 3);
  latest = "v3";
  await assert.rejects(read("test", "first-token"), /cambiata durante la lettura/);
  assert.equal(context.spotifyPlaylistSnapshots.has(JSON.stringify(["first-token", "p".repeat(22)])), false);
  assert.equal(writes, 0);
});
