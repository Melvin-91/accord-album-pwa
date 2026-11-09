import { initializeCatalogSuggestionsUI } from "./suggestions-ui.mjs?v=11";
import { initializeCatalogPlaylistUI } from "./playlist-ui.mjs?v=8";
import { createUpdateLifecycle, localCollectionStatus, musicalRecords, serviceFailure } from "./runtime-status.mjs?v=1";
import { fingerprint, saveCheckpoint, readCheckpoint, validateCheckpoint, clearCheckpoint,
  editionLink, setEditionLink, pauseRemaining } from "./music-continuity.mjs?v=5";
import { musicalAlbumTags } from "./catalog-suggestions.mjs?v=4";
import {
  addPlaylistAlbums,
  albumPrimaryGenre,
  albumSecondaryGenres,
  aggregateDiscogsEditionRatings,
  bestSpotifyAlbumSuggestionMatch,
  createSpotifyJsonReader,
  createSpotifyTransport,
  createSpotifyReadBudget,
  createSyncDocument,
  collectSpotifyDiscoveryAlbums,
  spotifyDiscoveryPlaylistPreview,
  createTimedJsonCache,
  buildSimilarityQueue,
  resolveArtistFromTracks,
  expandSimilarArtists,
  filterListeningAlbumSuggestions,
  filterUnheardArtists,
  filterAlbums,
  moveAlbumInManualOrder,
  normalizeAlbumStatus,
  NO_PRIMARY_GENRE_FILTER,
  NO_SECONDARY_GENRE_FILTER,
  decodeCoverArchive,
  encodeCoverArchive,
  lastFmAlbumCatalog,
  lastFmSuggestionRange,
  musicBrainzCoverArtUrl,
  playlistAlbumRecords,
  playlistReleaseRecords,
  primaryAlbumGenres,
  findSpotifyPlaylistMatches,
  listeningAlbumSuggestions,
  readMusicBrainzCatalog,
  readSpotifyPlaylistItems,
  readSpotifySearchPages,
  readLastFmAllTimeArtists,
  rankDiscogsSuggestionAlbums,
  retryMusicBrainzRequest,
  shouldStopDiscogsSuggestionQueue,
  sortAlbumsByManualOrder,
  spotifyAlbumSearchRecords,
  spotifyAlbumId,
  spotifyPlaylistId,
  spotifyRedirectUriForPage,
  summarizeLastFmTracks,
  topListenedAlbums,
  topDiscogsVersions,
  threeWayMerge,
  validateAlbum,
  validateDocument,
  validateLastFmHistoryDocument,
  writeSpotifyPlaylistItems,
} from "./core.mjs?v=48";
import {
  localCommandResults,
  collectionAuditSummary,
  formatSyncSummary,
  prepareAlbumUpdates,
  prepareAlbumRemoval,
  visibleSelection,
  duplicateAlbumGroups, albumFieldChanges, albumChanges, smartAlbumMatch,
  albumStatistics, suggestionIdentity, suggestionWhy, batchAlbumChanges,
  normalizeAccessibility, adjacentAlbumIds, spotifyAlbumIntent, playlistPreviewStatistics,
  portablePreferences, createLocalBackup, validateLocalBackup, prepareSelectiveRestore, commitLocalRestore as persistLocalRestore,
  backupReminderItems,
  exactAlbumFacet, normalizeAlbumFacet, prepareAlbumReview, assertAlbumReviewCurrent, labelNormalizationProposals,
  normalizeAlbumLabels, coverStorageInventory, createCommandGuard, redactDiagnostics, technicalDiagnostics,
  appendCollectionHistory, collectionHealthSummary, createCollectionHistoryEntry,
  prepareCollectionHistoryRestore, selectCollectionAlbum,
  runPlatformAccessChecks,
  userFacingStatus, installTechnicalStatusDetails, installDialogLayout, installCollectionLayout,
} from "./ui.mjs?v=17";
import { createMusicServiceGate, createTidalTransport, musicAlbumLink, tidalAlbumId } from "./tidal.mjs?v=9";
import { createQobuzClient } from "./qobuz.mjs?v=9";
import { configureMusicAppLink } from "./music-app-links.mjs?v=1";
import {
  createAlbumComparisonToolbar, suggestDurationQueue, localCollectionMatch,
  selectionVisibility, appendListeningActions, reviewManualGenres,
} from "./music-qol.mjs?v=2";
import { readCatalogPage, COMPLETION_EVIDENCE_KEY, COMPLETION_PROVENANCE_KEY }
  from "./music-completion.mjs?v=7";
import { openMusicCompletion } from "./music-completion-ui.mjs?v=7";
import { initializeTidalUI } from "./tidal-ui.mjs?v=26";
import { initializeQobuzUI } from "./qobuz-ui.mjs?v=21";
import { qobuzAlbumId } from "./qobuz.mjs?v=9";

const musicService = createMusicServiceGate(localStorage);

const STORAGE_KEY = "accord-album-pwa-v1";
const LISTENING_QUEUE_KEY = "accord-listening-queue-v1";
const ALBUM_DURATIONS_KEY = "accord-listening-album-durations-v1";
const SUGGESTION_RECIPES_KEY = "accord-music-suggestion-recipes-v1";
const ALBUM_NOTE_CONFLICT_ARCHIVE_KEY = "accord-album-note-conflicts-v1";
const BACKUP_SUCCESS_KEY = "accord-backup-last-success-v1";
const COVER_DATABASE = "accord-album-covers-v1";
const COVER_STORE = "covers";
const LASTFM_HISTORY_STORE = "lastfm-history";
const LASTFM_HISTORY_USE_KEY = "accord-use-synced-lastfm-history";
const MAX_LASTFM_HISTORY_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_LASTFM_HISTORY_JSON_BYTES = 200 * 1024 * 1024;
const ACTIVE_VIEW_TAB_KEY = "accord-active-view-tab";
const SUGGESTION_RETURN_KEY = "accord-spotify-suggestion-return";
const REPOSITORY = "accord-music-data";
const API = "https://api.github.com";
const DISCOGS_API = "https://api.discogs.com";
const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_ACCOUNTS = "https://accounts.spotify.com";
const LASTFM_API = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_REQUEST_INTERVAL_MS = 1000;
const LASTFM_RESPONSE_CACHE_TTL = 6 * 60 * 60 * 1000;
const LASTFM_RESPONSE_CACHE_METHODS = new Set([
  "album.search", "album.gettoptags", "artist.getsimilar", "artist.gettopalbums", "tag.gettopalbums",
]);
const LASTFM_REQUEST_AT_KEY = "accord-lastfm-request-at-v1";
const LASTFM_COOLDOWN_KEY = "accord-lastfm-cooldown-until-v1";
const DISCOGS_SUGGESTION_CACHE_KEY = "accord-discogs-suggestion-cache-v1";
const DISCOGS_SUGGESTION_CACHE_AGE = 14 * 24 * 60 * 60 * 1000;
const DISCOGS_SUGGESTION_SAMPLE_SIZE = 5;
const DISCOGS_SUGGESTION_REQUEST_LIMIT = 200;
const DISCOGS_SUGGESTION_PAGES_LIMIT = 20;
const DISCOGS_REQUEST_AT_KEY = "accord-discogs-request-at-v1";
const DISCOGS_RATE_LIMIT_KEY = "accord-discogs-rate-limit-v1";
const DISCOGS_COOLDOWN_KEY = "accord-discogs-cooldown-until-v1";
localStorage.removeItem("accord-spotify-heard-artists-v1");
localStorage.removeItem("accord-spotify-heard-artist-last-played-v1");
const suggestedSourceAlbums = new Map();
let listeningSuggestionComparison = null;
let spotifySuggestionComparison = null;
const spotifyJsonReader = createSpotifyJsonReader();
const spotifyPlaylistSnapshots = new Map();
const spotifyTransport = createSpotifyTransport({
  storage: localStorage,
  fetch: async (url, { accordServiceEpoch, ...options } = {}) => {
    musicService.assert("spotify", accordServiceEpoch);
    const response = await fetch(url, options);
    musicService.assert("spotify", accordServiceEpoch);
    return response;
  },
  lock: (name, request) => navigator.locks?.request
    ? navigator.locks.request(name, request) : request(),
});
let spotifyRefreshPromise = null;
const lastFmResponseCache = createTimedJsonCache({ maxEntries: 128 });
const lastFmPendingRequests = new Map();
const suggestedSpotifyCoverMatches = new Map();
const suggestedCoverFrames = new Map();
const suggestedSpotifyMatchCache = new Map();
const spotifyAlbumMetadata = new Map();
const suggestionCoverQueue = [];
const suggestionCoverTasks = new WeakMap();
const collectionCoverQueue = [];
const collectionCoverTasks = new WeakMap();
const collectionCoverImageUrls = new Map();
const collectionCoverRemoteIds = new Set();
const collectionCoverFailures = new Map();
const listeningCatalogCache = new Map();
const allTimeArtistCache = new Map();
let suggestedMatchAlbumId = null;
let topArtistPlaylistPreview = null;
let playlistDiscoveryContinuation = null;
let playlistCheckpointContext = null, playlistHistorical = false;
let spotifyPlaylistAccount = null;
const spotifyPlaylistUncertainKey = "accord-playlist-uncertain-spotify-v1";
let lastListeningCatalogRequestAt = 0;
let lastFmApiRequestQueue = Promise.resolve();
let discogsApiRequestQueue = Promise.resolve();
let discogsSuggestionCache;
let discogsSuggestionCacheWarning = "";
let suggestionCoverObserver = null;
let suggestionCoverTokenPromise = null;
let suggestionCoverJobsActive = 0;
let suggestionCoverFailureShown = false;
let collectionCoverObserver = null;
let collectionCoverTokenPromise = null;
let collectionCoverJobsActive = 0;
let collectionCoverBatchScheduled = false;
const LASTFM_KEY = "accord-lastfm-api-key";
const labels = { queued: "Da ascoltare", listening: "In ascolto", liked: "Piaciuto", neutral: "Neutro", disliked: "Non piaciuto" };
const $ = (selector) => document.querySelector(selector);
$("#removeSelectedButton").addEventListener("click", removeSelectedAlbums);
const template = $("#albumTemplate");
const state = loadState();
let localSaveError = state.loadError || "";
let githubAvailability = "GitHub: disponibilita' non verificata";
let persistedCollectionIdentity = JSON.stringify([normalizeLocalAlbums(state.albums), normalizeLocalAlbums(state.base)]);
const QOL_KEY = "accord-collection-qol-v1";
const qol = loadCollectionQol();
const COLLECTION_UI_KEY = "accord-collection-ui-v1";
let collectionPreferences;
try {
  collectionPreferences = portablePreferences(state.preferences
    || JSON.parse(localStorage.getItem(COLLECTION_UI_KEY) || "{}"));
} catch (error) {
  collectionPreferences = portablePreferences();
  queueMicrotask(() => showFeedback(`Preferenze locali non leggibili: ${error.message}`, true));
}
let selectedAlbumIds = new Set();
let collectionSelectionOnly = false;
let visibleAlbums = [];
let detailsAlbumId = null;
let detailsReturnFocus = null;
let feedbackTimer;
let appliedCollectionSearch = "";
let automaticSyncQueued = false;
const commandGuard = createCommandGuard();
const COVER_REMOVALS_KEY = "accord-cover-removals-v1";
let localFacet = null;
const facetReturnViews = [];
let navigatingToFacet = false;
$("#sortOrder").value = state.sortOrder;
$("#collectionLayout").value = collectionPreferences.layout;
$("#albumList").dataset.layout = collectionPreferences.layout;
const viewTabs = [...document.querySelectorAll(".view-tabs [role='tab']")];
let collectionLayout = null;

function activateViewTab(selectedTab) {
  for (const tab of viewTabs) {
    const selected = tab === selectedTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
  }
  sessionStorage.setItem(ACTIVE_VIEW_TAB_KEY, selectedTab.id);
  collectionLayout?.updateView();
  if (selectedTab.id !== "collectionTab") {
    selectedAlbumIds.clear();
    document.querySelectorAll(".album-select").forEach((input) => { input.checked = false; });
    updateSelectionToolbar();
  }
}

async function getCachedCoverIds() {
  const database = await openCoverDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(COVER_STORE, "readonly").objectStore(COVER_STORE).getAllKeys();
    request.onsuccess = () => resolve(new Set(request.result));
    request.onerror = () => reject(new Error(
      `Impossibile controllare le copertine offline: ${request.error?.message || "errore IndexedDB"}`));
  });
}

const restoredViewTab = viewTabs.find((tab) => tab.id === sessionStorage.getItem(ACTIVE_VIEW_TAB_KEY));
if (restoredViewTab) activateViewTab(restoredViewTab);

const tabList = document.querySelector(".view-tabs");
tabList.addEventListener("click", (event) => {
  const tab = event.target.closest("[role='tab']");
  if (tab) activateViewTab(tab);
});
tabList.addEventListener("keydown", (event) => {
  const current = viewTabs.indexOf(document.activeElement);
  const next = event.key === "ArrowRight" ? (current + 1) % viewTabs.length
    : event.key === "ArrowLeft" ? (current - 1 + viewTabs.length) % viewTabs.length
      : event.key === "Home" ? 0
        : event.key === "End" ? viewTabs.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault();
  activateViewTab(viewTabs[next]);
  viewTabs[next].focus();
});
let coverDatabasePromise;
let coverRenderGeneration = 0;
let coverObjectUrls = [];
let cachedLastFmHistoryDocument;

function openCoverDatabase() {
  if (!coverDatabasePromise) {
    coverDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(COVER_DATABASE, 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(COVER_STORE)) {
          database.createObjectStore(COVER_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(LASTFM_HISTORY_STORE)) {
          database.createObjectStore(LASTFM_HISTORY_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Archivio offline delle copertine non disponibile: ${request.error?.message || "errore IndexedDB"}`));
      request.onblocked = () => reject(new Error("Aggiornamento dell'archivio offline delle copertine bloccato da un'altra scheda."));
    });
  }
  return coverDatabasePromise;
}

async function getCachedCover(id) {
  const database = await openCoverDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(COVER_STORE, "readonly").objectStore(COVER_STORE).get(id);
    request.onsuccess = () => resolve(request.result ? new Uint8Array(request.result.data) : null);
    request.onerror = () => reject(new Error(`Impossibile leggere la copertina offline: ${request.error?.message || "errore IndexedDB"}`));
  });
}

async function cacheCover(id, data) {
  if (removedCoverIds().has(id)) return;
  const database = await openCoverDatabase();
  return new Promise((resolve, reject) => {
    if (removedCoverIds().has(id)) { resolve(); return; }
    const transaction = database.transaction(COVER_STORE, "readwrite");
    const request = transaction.objectStore(COVER_STORE).put({ id, data: data.slice().buffer });
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error(`Impossibile salvare la copertina offline: ${transaction.error?.message || request.error?.message || "transazione IndexedDB interrotta"}`));
    transaction.onerror = () => reject(new Error(`Impossibile salvare la copertina offline: ${transaction.error?.message || request.error?.message || "errore IndexedDB"}`));
  });
}

async function cacheLastFmHistory(document) {
  const validated = validateLastFmHistoryDocument(document);
  const database = await openCoverDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(LASTFM_HISTORY_STORE, "readwrite");
    const request = transaction.objectStore(LASTFM_HISTORY_STORE).put({
      key: validated.account.normalize("NFKC").toLocaleLowerCase(),
      document: validated,
    });
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error(
      `Impossibile salvare la cronologia Last.fm offline: ${transaction.error?.message || request.error?.message || "transazione interrotta"}`));
    transaction.onerror = () => reject(new Error(
      `Impossibile salvare la cronologia Last.fm offline: ${transaction.error?.message || request.error?.message || "errore IndexedDB"}`));
  });
  cachedLastFmHistoryDocument = validated;
  return validated;
}

async function getCachedLastFmHistory(username) {
  const accountKey = username.normalize("NFKC").trim().toLocaleLowerCase();
  if (cachedLastFmHistoryDocument
      && cachedLastFmHistoryDocument.account.normalize("NFKC").toLocaleLowerCase() === accountKey) {
    return cachedLastFmHistoryDocument;
  }
  const database = await openCoverDatabase();
  const document = await new Promise((resolve, reject) => {
    const request = database.transaction(LASTFM_HISTORY_STORE, "readonly")
      .objectStore(LASTFM_HISTORY_STORE).get(accountKey);
    request.onsuccess = () => resolve(request.result?.document || null);
    request.onerror = () => reject(new Error(
      `Impossibile leggere la cronologia Last.fm offline: ${request.error?.message || "errore IndexedDB"}`));
  });
  if (!document) return null;
  cachedLastFmHistoryDocument = validateLastFmHistoryDocument(document);
  return cachedLastFmHistoryDocument;
}

async function clearCachedLastFmHistory() {
  const database = await openCoverDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(LASTFM_HISTORY_STORE, "readwrite");
    const request = transaction.objectStore(LASTFM_HISTORY_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error(
      `Impossibile eliminare la cronologia Last.fm offline: ${transaction.error?.message || request.error?.message || "transazione interrotta"}`));
    transaction.onerror = () => reject(new Error(
      `Impossibile eliminare la cronologia Last.fm offline: ${transaction.error?.message || request.error?.message || "errore IndexedDB"}`));
  });
  cachedLastFmHistoryDocument = null;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const albums = validateDocument({ format: "accord-album-collection", version: 1,
      albums: Array.isArray(saved.albums) ? saved.albums : [] });
    const base = validateDocument({ format: "accord-album-collection", version: 1,
      albums: Array.isArray(saved.base) ? saved.base : [] });
    const manualOrder = Array.isArray(saved.manualOrder)
      ? [...new Set(saved.manualOrder.filter((id) => typeof id === "string" && /^(?:[A-Za-z0-9]+|tidal:[1-9][0-9]*|qobuz:[A-Za-z0-9]{1,120})$/.test(id)))]
      : [];
    const sortOrders = ["artist", "name", "year", "rating", "genre", "collection", "manual"];
    const sortOrder = sortOrders.includes(saved.sortOrder) ? saved.sortOrder : "artist";
    const hasLegacyStatuses = [saved.albums, saved.base].some((records) =>
      Array.isArray(records) && records.some((album) =>
        album && normalizeAlbumStatus(album.status) !== album.status));
    if (hasLegacyStatuses) localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, albums, base }));
    return { albums, base, manualOrder, sortOrder, preferences: saved.preferences,
      collectionHistory: Array.isArray(saved.collectionHistory) ? saved.collectionHistory : [] };
  } catch (error) {
    queueMicrotask(() => showMessage("Archivio locale non leggibile", error.message));
    return { albums: [], base: [], manualOrder: [], sortOrder: "artist",
      collectionHistory: [], loadError: error.message };
  }
}

function normalizeLocalAlbums(albums) {
  return validateDocument({ format: "accord-album-collection", version: 1, albums }).map((album) => {
    const record = { ...album, notes: album.notes || "" };
    return Object.fromEntries(Object.keys(record).sort().map((field) => [field, record[field]]));
  });
}

function commitLocalRestore(storage, key, current, next, related = {}, label = "Modifica locale raccolta") {
  return persistLocalRestore(storage, key, current, next, related, label, normalizeLocalAlbums);
}

function saveState(historyLabel = "Modifica locale raccolta") {
  try {
    if (state.loadError) throw new Error(`Archivio locale non leggibile: ${state.loadError}`);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (JSON.stringify([normalizeLocalAlbums(saved.albums || []), normalizeLocalAlbums(saved.base || [])])
        !== persistedCollectionIdentity) {
      throw new Error("La raccolta salvata e' cambiata in un'altra scheda. Conserva le bozze e riapri l'app prima di scrivere.");
    }
    const entry = createCollectionHistoryEntry(
      Array.isArray(saved.albums) ? saved.albums : [], state.albums, historyLabel,
    );
    const collectionHistory = appendCollectionHistory(
      Array.isArray(saved.collectionHistory) ? saved.collectionHistory : state.collectionHistory, entry,
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, collectionHistory }));
    state.collectionHistory = collectionHistory;
    localSaveError = "";
    updateLocalSyncSummary();
  } catch (error) {
    localSaveError = error.message;
    updateLocalSyncSummary();
    showFeedback(`Raccolta non salvata nel browser: ${error.message}`, true);
    throw error;
  }
}

function ensureManualOrder() {
  const known = new Set(state.manualOrder);
  let changed = false;
  for (const album of state.albums) {
    if (known.has(album.id)) continue;
    state.manualOrder.push(album.id);
    known.add(album.id);
    changed = true;
  }
  if (changed) saveState();
}

function moveManualAlbum(albumId, targetIndex, visibleAlbums) {
  if ($("#sortOrder").value !== "manual") return;
  const next = moveAlbumInManualOrder(
    state.manualOrder, visibleAlbums.map((album) => album.id), albumId, targetIndex,
  );
  if (next.length === state.manualOrder.length
      && next.every((id, index) => id === state.manualOrder[index])) return;
  state.manualOrder = next;
  saveState();
  render();
}

let manualDragSession = null;
const albumList = $("#albumList");
const interactiveAlbumTarget = "button, a, input, select, textarea, [contenteditable='true']";

function startManualDrag(session) {
  session.dragging = true;
  session.lastClientX = session.startX;
  session.lastClientY = session.startY;
  session.card.classList.add("dragging");
  document.body.classList.add("manual-sort-dragging");
  session.autoScrollFrame = requestAnimationFrame(() => autoScrollManualDrag(session));
}

function autoScrollManualDrag(session) {
  if (manualDragSession !== session || !session.dragging) return;
  const edge = 72;
  let delta = 0;
  if (session.lastClientY < edge) delta = -Math.ceil((edge - session.lastClientY) / 4);
  else if (session.lastClientY > window.innerHeight - edge) {
    delta = Math.ceil((session.lastClientY - (window.innerHeight - edge)) / 4);
  }
  if (delta) {
    window.scrollBy(0, delta);
    updateManualDragPosition(session, session.lastClientX, session.lastClientY);
  }
  session.autoScrollFrame = requestAnimationFrame(() => autoScrollManualDrag(session));
}

function updateManualDragPosition(session, clientX, clientY) {
  session.lastClientX = clientX;
  session.lastClientY = clientY;
  if (!session.card.isConnected) return;
  const target = document.elementFromPoint(clientX, clientY)?.closest(".album-card.manual-sortable");
  if (!target || target === session.card || target.parentElement !== session.list) return;
  if (session.overCard && session.overCard !== target) session.overCard.classList.remove("drag-over");
  session.overCard = target;
  target.classList.add("drag-over");
  const targetBounds = target.getBoundingClientRect();
  const insertBefore = clientY < targetBounds.top + targetBounds.height / 2;
  const oldIndex = [...session.list.children].indexOf(session.card);
  if (insertBefore && target.previousElementSibling !== session.card) {
    session.list.insertBefore(session.card, target);
  } else if (!insertBefore && target.nextElementSibling !== session.card) {
    session.list.insertBefore(session.card, target.nextElementSibling);
  }
  if ([...session.list.children].indexOf(session.card) !== oldIndex) session.moved = true;
}

function finishManualDrag(commit) {
  const session = manualDragSession;
  if (!session) return;
  clearTimeout(session.longPressTimer);
  cancelAnimationFrame(session.autoScrollFrame);
  const targetIndex = [...session.list.children].findIndex((card) => card === session.card);
  session.card.classList.remove("dragging");
  session.overCard?.classList.remove("drag-over");
  document.body.classList.remove("manual-sort-dragging");
  manualDragSession = null;
  if (commit && session.dragging && session.moved && targetIndex >= 0) {
    moveManualAlbum(session.albumId, targetIndex, session.visibleAlbums);
  }
}

function isInteractiveAlbumTarget(target) {
  return target instanceof Element && Boolean(target.closest(interactiveAlbumTarget));
}

albumList.addEventListener("pointerdown", (event) => {
  if ($("#sortOrder").value !== "manual" || event.pointerType === "touch"
      || event.button !== 0 || isInteractiveAlbumTarget(event.target) || manualDragSession) return;
  const card = event.target.closest(".album-card.manual-sortable");
  if (!card) return;
  manualDragSession = {
    kind: "pointer",
    pointerId: event.pointerId,
    card,
    albumId: card.dataset.albumId,
    list: albumList,
    visibleAlbums: [...albumList.children].map((item) => state.albums.find((album) => album.id === item.dataset.albumId)),
    startX: event.clientX,
    startY: event.clientY,
    dragging: false,
    moved: false,
  };
});

albumList.addEventListener("touchstart", (event) => {
  if ($("#sortOrder").value !== "manual" || event.touches.length !== 1
      || isInteractiveAlbumTarget(event.target) || manualDragSession) return;
  const card = event.target.closest(".album-card.manual-sortable");
  if (!card) return;
  const touch = event.touches[0];
  const session = {
    kind: "touch",
    touchId: touch.identifier,
    card,
    albumId: card.dataset.albumId,
    list: albumList,
    visibleAlbums: [...albumList.children].map((item) => state.albums.find((album) => album.id === item.dataset.albumId)),
    startX: touch.clientX,
    startY: touch.clientY,
    dragging: false,
    moved: false,
    longPressTimer: null,
  };
  manualDragSession = session;
  session.longPressTimer = setTimeout(() => {
    if (manualDragSession === session && session.card.isConnected) startManualDrag(session);
  }, 250);
}, { passive: true });

document.addEventListener("pointermove", (event) => {
  const session = manualDragSession;
  if (!session || session.kind !== "pointer" || session.pointerId !== event.pointerId) return;
  if (!session.dragging) {
    if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 6) return;
    startManualDrag(session);
  }
  if (event.cancelable) event.preventDefault();
  updateManualDragPosition(session, event.clientX, event.clientY);
});
document.addEventListener("pointerup", (event) => {
  if (manualDragSession?.kind === "pointer" && manualDragSession.pointerId === event.pointerId) finishManualDrag(true);
});
document.addEventListener("pointercancel", (event) => {
  if (manualDragSession?.kind === "pointer" && manualDragSession.pointerId === event.pointerId) finishManualDrag(true);
});
document.addEventListener("touchmove", (event) => {
  const session = manualDragSession;
  if (!session || session.kind !== "touch") return;
  if (event.touches.length !== 1) {
    finishManualDrag(session.dragging);
    return;
  }
  const touch = [...event.touches].find((item) => item.identifier === session.touchId);
  if (!touch) return;
  if (!session.dragging) {
    if (Math.hypot(touch.clientX - session.startX, touch.clientY - session.startY) > 8) {
      finishManualDrag(false);
    }
    return;
  }
  if (event.cancelable) event.preventDefault();
  updateManualDragPosition(session, touch.clientX, touch.clientY);
}, { passive: false });
document.addEventListener("touchend", (event) => {
  if (manualDragSession?.kind === "touch"
      && [...event.changedTouches].some((touch) => touch.identifier === manualDragSession.touchId)) {
    finishManualDrag(true);
  }
});
document.addEventListener("touchcancel", () => {
  if (manualDragSession?.kind === "touch") finishManualDrag(manualDragSession.dragging);
});

function credentials() {
  return {
    owner: localStorage.getItem("accord-album-owner") || "",
    token: localStorage.getItem("accord-album-token") || "",
    autoSync: localStorage.getItem("accord-album-autosync") === "true",
    useSyncedLastFmHistory: localStorage.getItem(LASTFM_HISTORY_USE_KEY) === "true",
  };
}

function spotifySettings() {
  const defaultRedirectUri = spotifyRedirectUriForPage(location.href);
  const savedRedirectUri = localStorage.getItem("accord-spotify-redirect-uri") || "";
  const legacyIndexUri = new URL("index.html", defaultRedirectUri).href;
  return {
    clientId: localStorage.getItem("accord-spotify-client-id") || "",
    redirectUri: savedRedirectUri === legacyIndexUri ? defaultRedirectUri : savedRedirectUri || defaultRedirectUri,
  };
}

function setSyncState(message) {
  $("#syncState").textContent = message;
}

function showMessage(title, message) {
  $("#messageTitle").textContent = title;
  $("#messageBody").textContent = safeDiagnostics(message);
  $("#messageSummary").textContent = userFacingStatus(safeDiagnostics(message));
  $("#messageTechnicalDetails").hidden = $("#messageSummary").textContent === $("#messageBody").textContent;
  $("#messageTechnicalDetails").open = /^Dettagli\b/i.test(title);
  $("#messageDialog .error-actions")?.remove();
  const actions = document.createElement("div");
  actions.className = "qol-actions error-actions";
  appendErrorActions(actions, `${title} ${message}`, () => $("#messageDialog").close());
  $("#messageDialog .dialog-footer").prepend(actions);
  $("#messageDialog").showModal();
}

function safeDiagnostics(text) {
  const secrets = [];
  for (const storage of [localStorage, sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (/(?:token|api-key|verifier|oauth-state|client-id)/i.test(key)) secrets.push(storage.getItem(key));
    }
  }
  return redactDiagnostics(text, secrets);
}

function appendErrorActions(container, message, close = () => {}, stage = "message") {
  message = safeDiagnostics(message);
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copia diagnostica oscurata";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(technicalDiagnostics({
        stage,
        httpStatuses: [...message.matchAll(/\bHTTP\s+([45]\d{2})\b/gi)].map((match) => Number(match[1])),
        counts: { albums: state.albums.length, drafts: Object.keys(qol.drafts).length,
          failedCovers: collectionCoverFailures.size },
      }));
      showFeedback("Diagnostica oscurata copiata");
    } catch (error) { showFeedback(`Copia non riuscita: ${error.message}. Il messaggio visualizzato può contenere dati personali: non condividerlo come diagnostica.`, true); }
  });
  const technical = document.createElement("details");
  const technicalToggle = document.createElement("summary");
  technicalToggle.textContent = "ⓘ Dettagli";
  technical.append(technicalToggle, copy);
  container.append(technical);
  if (/configur|autorizza|sessione|credenzial|token|client id|redirect|permess|HTTP (?:401|403)/i.test(message)) {
    const settings = document.createElement("button");
    settings.type = "button";
    settings.textContent = "Apri preferenze e collegamenti";
    settings.addEventListener("click", () => { close(); openSettings(); });
    container.append(settings);
  }
  if (/bozz/i.test(message)) {
    const drafts = document.createElement("button");
    drafts.type = "button";
    drafts.textContent = "Rivedi bozze locali";
    drafts.addEventListener("click", () => { close(); openDraftList(); });
    container.append(drafts);
  }
  const playlist = message.match(/https:\/\/open\.spotify\.com\/playlist\/([A-Za-z0-9]{22})\b/)
    || message.match(/ID playlist: ([A-Za-z0-9]{22})\b/);
  if (playlist || /playlist/i.test(message) && /esito|incomplet|non completat/i.test(message)) {
    const review = document.createElement("a");
    review.href = playlist ? `spotify:playlist:${playlist[1]}` : "spotify:collection:playlists";
    review.target = "_self";
    review.rel = "noopener noreferrer";
    review.textContent = "Rivedi playlist in Spotify ↗";
    container.append(review);
  }
  if (/sincronizzazione|repository GitHub/i.test(message) && credentials().owner) {
    const review = document.createElement("a");
    review.href = `https://github.com/${encodeURIComponent(credentials().owner)}/${REPOSITORY}`;
    review.target = "_blank";
    review.rel = "noopener noreferrer";
    review.textContent = "Verifica file nel repository GitHub ↗";
    container.append(review);
  }
  if (collectionCoverFailures.size) {
    const review = document.createElement("button");
    review.type = "button";
    review.textContent = "Rivedi copertine non riuscite";
    review.addEventListener("click", () => {
      close();
      showMessage("Copertine da rivedere", [...collectionCoverFailures].map(([id, reason]) => {
        const album = state.albums.find((record) => record.id === id);
        return `${album ? `${album.artist} · ${album.name}` : id}: ${reason}`;
      }).join("\n") + "\nNessun nuovo tentativo automatico. Usa Carica copertine o Sincronizza solo dopo la verifica.");
    });
    container.append(review);
  }
}

function openSettings() {
  const current = credentials();
  const spotify = spotifySettings();
  $("#ownerInput").value = current.owner;
  $("#tokenInput").value = "";
  $("#tokenInput").placeholder = current.token ? "Token salvato (vuoto per mantenerlo)" : "ghp_…";
  $("#autoSyncInput").checked = current.autoSync;
  $("#useSyncedLastfmHistoryInput").checked = current.useSyncedLastFmHistory;
  $("#spotifyClientIdInput").value = spotify.clientId;
  $("#spotifyRedirectUriInput").value = spotify.redirectUri;
  $("#lastfmApiKeyInput").value = "";
  $("#lastfmApiKeyInput").placeholder = localStorage.getItem(LASTFM_KEY)
    ? "Chiave salvata (vuoto per mantenerla)" : "Chiave API (32 caratteri)";
  $("#settingsFeedback").hidden = true;
  $("#settingsDialog").showModal();
}

$("#settingsButton").addEventListener("click", openSettings);
$("#saveLastfmApiKey").addEventListener("click", () => {
  const input = $("#lastfmApiKeyInput");
  const key = input.value.trim();
  if (!/^[a-fA-F0-9]{32}$/.test(key)) {
    showMessage("Chiave Last.fm non valida", "La chiave API Last.fm deve contenere 32 caratteri esadecimali.");
    return;
  }
  localStorage.setItem(LASTFM_KEY, key);
  input.value = "";
  input.placeholder = "Chiave salvata (vuoto per mantenerla)";
  showFeedback("Chiave Last.fm salvata solo in questo browser");
});
$("#clearLastfmApiKey").addEventListener("click", () => {
  localStorage.removeItem(LASTFM_KEY);
  $("#lastfmApiKeyInput").value = "";
  $("#lastfmApiKeyInput").placeholder = "Chiave API (32 caratteri)";
  setSyncState("Chiave Last.fm dimenticata");
});
$("#forgetSyncedLastfmHistory").addEventListener("click", async () => {
  if (!window.confirm("Eliminare da questo browser la copia offline della cronologia Last.fm? Il file nel repository GitHub non verrà modificato.")) {
    return;
  }
  try {
    await clearCachedLastFmHistory();
    localStorage.removeItem(LASTFM_HISTORY_USE_KEY);
    $("#useSyncedLastfmHistoryInput").checked = false;
    setSyncState("Copia locale della cronologia Last.fm eliminata");
  } catch (error) {
    showMessage("Eliminazione non riuscita", error.message);
  }
});
$("#settingsForm").addEventListener("submit", (event) => {
  if (event.submitter?.value !== "save") return;
  event.preventDefault();
  const owner = $("#ownerInput").value.trim();
  const token = $("#tokenInput").value.trim() || credentials().token;
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !token) {
    showMessage("Configurazione incompleta", "Inserisci il proprietario e un token GitHub a privilegi limitati valido.");
    return;
  }
  const clientId = $("#spotifyClientIdInput").value.trim();
  const redirectValue = $("#spotifyRedirectUriInput").value.trim();
  let redirectUri;
  try {
    redirectUri = new URL(redirectValue);
  } catch {
    showMessage("Redirect URI non valido", "Inserisci il Redirect URI HTTPS registrato nell’app Spotify.");
    return;
  }
  const expectedRedirectUri = spotifyRedirectUriForPage(location.href);
  const localHttp = location.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  if ((clientId && !/^[A-Za-z0-9]{32}$/.test(clientId))
      || redirectUri.origin !== location.origin
      || redirectUri.href !== expectedRedirectUri
      || redirectUri.search || redirectUri.hash
      || (!localHttp && redirectUri.protocol !== "https:")
      || redirectUri.username || redirectUri.password) {
    showMessage("Impostazioni Spotify non valide", `Usa il Redirect URI ${expectedRedirectUri} registrato nelle impostazioni della tua app Spotify.`);
    return;
  }
  localStorage.setItem("accord-album-owner", owner);
  localStorage.setItem("accord-album-token", token);
  localStorage.setItem("accord-album-autosync", String($("#autoSyncInput").checked));
  localStorage.setItem(LASTFM_HISTORY_USE_KEY, String($("#useSyncedLastfmHistoryInput").checked));
  updateSuggestionToolUi();
  if (clientId) localStorage.setItem("accord-spotify-client-id", clientId);
  else localStorage.removeItem("accord-spotify-client-id");
  localStorage.setItem("accord-spotify-redirect-uri", redirectUri.href);
  $("#tokenInput").value = "";
  $("#settingsDialog").close();
  setSyncState("Configurazione salvata");
  showFeedback("Preferenze salvate");
  if (automaticSyncQueued) {
    automaticSyncQueued = false;
    void sync();
  }
});

$("#clearCredentials").addEventListener("click", () => {
  localStorage.removeItem("accord-album-owner");
  localStorage.removeItem("accord-album-token");
  localStorage.removeItem("accord-album-autosync");
  localStorage.removeItem(LASTFM_HISTORY_USE_KEY);
  $("#ownerInput").value = "";
  $("#tokenInput").value = "";
  $("#autoSyncInput").checked = false;
  $("#useSyncedLastfmHistoryInput").checked = false;
  updateSuggestionToolUi();
  setSyncState("Credenziali dimenticate");
});

$("#disconnectSpotify").addEventListener("click", () => {
  for (const key of ["accord-spotify-access-token", "accord-spotify-refresh-token",
    "accord-spotify-token-expires", "accord-spotify-oauth-state", "accord-spotify-code-verifier",
    "accord-spotify-pending-playlist", "accord-spotify-pending-albums"]) sessionStorage.removeItem(key);
  setSyncState("Spotify scollegato");
});

function showFeedback(message, error = false) {
  message = safeDiagnostics(message);
  if ($("#settingsDialog").open) {
    $("#settingsFeedback").textContent = message;
    $("#settingsFeedback").hidden = false;
  }
  const toast = $("#feedbackToast");
  clearTimeout(feedbackTimer);
  toast.textContent = message;
  toast.classList.toggle("feedback-error", error);
  toast.hidden = false;
  feedbackTimer = setTimeout(() => { toast.hidden = true; }, error ? 8000 : 4000);
}

function saveCollectionPreferences(next) {
  try {
    if (state.loadError) throw new Error(state.loadError);
    const preferences = portablePreferences(next);
    commitLocalRestore(localStorage, STORAGE_KEY, state, { ...state, preferences });
    collectionPreferences = preferences;
    return true;
  } catch (error) {
    showFeedback(`Preferenze non salvate: ${error.message}`, true);
    return false;
  }
}

function setAlbumPins(ids, pinned) {
  const pins = new Set(collectionPreferences.pinnedIds);
  for (const id of ids) {
    if (pinned) pins.add(id);
    else pins.delete(id);
  }
  if (!saveCollectionPreferences({ ...collectionPreferences, pinnedIds: [...pins] })) return;
  render();
  showFeedback(pinned ? "Album fissati su questo dispositivo" : "Album non più fissati");
}

function collectionHasFilters() {
  return ["#searchInput", "#primaryGenreFilter", "#secondaryGenreFilter", "#statusFilter",
    "#collectionFilter", "#tagFilter", "#serviceFilter"].some((selector) => Boolean($(selector).value.trim()))
    || localCollectionChecks.some((selector) => $(selector).checked)
    || collectionSelectionOnly || $("#pinnedOnlyInput").checked || Boolean($("#smartCollectionList").value) || Boolean(localFacet);
}

const localCollectionChecks = ["#unratedFilter", "#missingDurationFilter", "#notesPresentFilter"];

function resetCollectionFilters({ refresh = true } = {}) {
  collectionSelectionOnly = false;
  localFacet = null;
  appliedCollectionSearch = "";
  for (const selector of ["#searchInput", "#primaryGenreFilter", "#secondaryGenreFilter",
    "#statusFilter", "#collectionFilter", "#tagFilter", "#serviceFilter"]) $(selector).value = "";
  for (const selector of localCollectionChecks) $(selector).checked = false;
  $("#pinnedOnlyInput").checked = false;
  $("#smartCollectionList").value = "";
  if (refresh) {
    render();
    $("#searchInput").focus();
  }
}

function openLocalFacet(field, value) {
  if (!persistDetailsDraft()) return;
  facetReturnViews.push({
    fields: Object.fromEntries(collectionViewSelectors.map((selector) => [selector, $(selector).value])),
    appliedSearch: appliedCollectionSearch,
    pinned: $("#pinnedOnlyInput").checked, facet: localFacet, scroll: $("#albumList").scrollTop,
    selected: [...selectedAlbumIds], filtersOpen: $("#collectionFilters").open,
    localChecks: localCollectionChecks.map((selector) => $(selector).checked),
    selectionOnly: collectionSelectionOnly,
  });
  navigatingToFacet = true;
  $("#albumDetailsDialog").close();
  for (const selector of collectionViewSelectors) {
    if (!["#sortOrder", "#collectionLayout"].includes(selector)) $(selector).value = "";
  }
  for (const selector of localCollectionChecks) $(selector).checked = false;
  collectionSelectionOnly = false;
  appliedCollectionSearch = "";
  $("#pinnedOnlyInput").checked = false;
  localFacet = { field, value };
  activateViewTab($("#collectionTab"));
  render();
  $("#facetBackButton").focus();
  $("#collectionPanel").scrollIntoView();
}

$("#facetBackButton").addEventListener("click", () => {
  const previous = facetReturnViews.pop();
  if (!previous) return;
  localFacet = previous.facet;
  for (const [selector, value] of Object.entries(previous.fields)) $(selector).value = value;
  appliedCollectionSearch = previous.appliedSearch ?? previous.fields["#searchInput"] ?? "";
  refreshGenreFilters();
  $("#secondaryGenreFilter").value = previous.fields["#secondaryGenreFilter"];
  $("#pinnedOnlyInput").checked = previous.pinned;
  $("#collectionFilters").open = previous.filtersOpen;
  selectedAlbumIds = new Set(previous.selected);
  localCollectionChecks.forEach((selector, index) => { $(selector).checked = previous.localChecks[index]; });
  collectionSelectionOnly = previous.selectionOnly;
  const layout = previous.fields["#collectionLayout"];
  if (collectionPreferences.layout !== layout) saveCollectionPreferences({ ...collectionPreferences, layout });
  $("#albumList").dataset.layout = layout;
  state.sortOrder = previous.fields["#sortOrder"];
  saveState();
  render();
  $("#searchInput").focus({ preventScroll: true });
  requestAnimationFrame(() => { $("#albumList").scrollTop = previous.scroll; });
});

function updateSelectionToolbar() {
  const count = selectedAlbumIds.size;
  const { hidden } = selectionVisibility(selectedAlbumIds, visibleAlbums);
  $("#selectionToolbar").hidden = !count;
  $("#selectionCount").textContent = `${count} selezionati` + (hidden ? `, ${hidden} nascosti dai filtri` : "");
  $("#dropHiddenSelectionButton").disabled = !hidden;
  $("#applyBulkStatus").disabled = !count || !$("#bulkStatus").value;
  $("#removeSelectedButton").disabled = !count;
}

function selectAlbumCard(id, event) {
  selectedAlbumIds = selectCollectionAlbum(selectedAlbumIds, id, event.ctrlKey);
  for (const card of $("#albumList").children) {
    card.querySelector(".album-select").checked = selectedAlbumIds.has(card.dataset.albumId);
  }
  updateSelectionToolbar();
}

$("#showSelectionButton").addEventListener("click", () => {
  resetCollectionFilters({ refresh: false });
  collectionSelectionOnly = true;
  render();
});
$("#dropHiddenSelectionButton").addEventListener("click", () => {
  selectedAlbumIds = visibleSelection(selectedAlbumIds, visibleAlbums);
  render();
});
$("#unratedSummary").addEventListener("click", () => {
  resetCollectionFilters({ refresh: false });
  $("#smartCollectionList").value = "unrated";
  render();
});

function renderCollectionFilterChips() {
  const chips = $("#collectionFilterChips");
  chips.replaceChildren();
  const append = (text, clear) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "secondary";
    button.textContent = `${text} ×`;
    button.setAttribute("aria-label", `Rimuovi filtro ${text}`);
    button.addEventListener("click", () => { clear(); render(); });
    chips.append(button);
  };
  if (appliedCollectionSearch) append(`Ricerca: ${appliedCollectionSearch}`, () => {
    appliedCollectionSearch = ""; $("#searchInput").value = "";
  });
  for (const selector of ["#primaryGenreFilter", "#secondaryGenreFilter", "#statusFilter",
    "#collectionFilter", "#tagFilter", "#serviceFilter", "#smartCollectionList"]) {
    const control = $(selector);
    if (control.value) append(control.selectedOptions[0].textContent, () => { control.value = ""; });
  }
  for (const [selector, text] of [["#unratedFilter", "Senza voto"],
    ["#missingDurationFilter", "Durata mancante"], ["#notesPresentFilter", "Note presenti"]]) {
    if ($(selector).checked) append(text, () => { $(selector).checked = false; });
  }
  if ($("#pinnedOnlyInput").checked) append("In evidenza", () => { $("#pinnedOnlyInput").checked = false; });
  if (localFacet) append(`${localFacet.field}: ${localFacet.value}`, () => { localFacet = null; });
  if (collectionSelectionOnly) append("Solo selezionati", () => { collectionSelectionOnly = false; });
}

function removeSelectedAlbums() {
  const ids = new Set(selectedAlbumIds);
  if (!ids.size) return;
  const count = ids.size;
  if (!window.confirm(
    `Rimuovere ${count} album dalla raccolta su questo dispositivo? `
    + "La rimozione raggiungerà GitHub solo alla prossima sincronizzazione."
  )) return;
  const previousAlbums = state.albums;
  const previousOrder = state.manualOrder;
  try {
    state.albums = prepareAlbumRemoval(previousAlbums, ids);
    state.manualOrder = previousOrder.filter((id) => !ids.has(id));
    saveState(`Rimozione di ${count} album`);
  } catch (error) {
    state.albums = previousAlbums;
    state.manualOrder = previousOrder;
    showFeedback(`Album non rimossi: ${error.message}`, true);
    return;
  }
  selectedAlbumIds.clear();
  render();
  showFeedback(`${count} album rimossi localmente · sincronizza per propagare la modifica`);
}

function commitAlbumChanges(ids, changes) {
  if (state.loadError) throw new Error(`Archivio locale non leggibile: ${state.loadError}`);
  if (Object.hasOwn(changes, "genres") && !Object.hasOwn(changes, "primary_genre")) {
    changes = { ...changes, primary_genre: changes.genres[0] || "" };
  }
  const next = prepareAlbumUpdates(state.albums, ids, changes, validateAlbum);
  let review = prepareAlbumReview(state.albums, ids, (album) => next.find((record) => record.id === album.id));
  assertAlbumReviewCurrent(review, state.albums, localStorage.getItem(STORAGE_KEY));
  if (Object.hasOwn(changes, "genres")) {
    review = reviewManualGenres(review, ids, localStorage, COMPLETION_PROVENANCE_KEY, new Date().toISOString());
  }
  commitLocalRestore(localStorage, STORAGE_KEY, state, { ...state, albums: next }, review?.related,
    ids.size > 1 ? `Modifica di ${ids.size} album` : "Modifica album");
  updateLocalSyncSummary();
  rememberLocalChanges(ids);
  setSyncState("Modifiche locali in attesa di sincronizzazione");
}

function openAlbumDetails(id, returnFocus = document.activeElement) {
  const album = state.albums.find((record) => record.id === id);
  if (!album) {
    showFeedback("Album non più presente nella raccolta", true);
    return;
  }
  detailsAlbumId = id;
  detailsReturnFocus = returnFocus;
  $("#albumDetailsTitle").textContent = album.name;
  $("#albumDetailsMeta").textContent = `${album.artist} · ${album.year || "Anno sconosciuto"}`;
  $("#albumDetailsDialog .album-facets")?.remove();
  const facets = document.createElement("div");
  facets.className = "qol-actions album-facets";
  facets.setAttribute("aria-label", "Esplora la raccolta locale per etichetta esatta");
  for (const [field, values] of [["artist", [album.artist]], ["genres", album.genres],
    ["tags", album.tags], ["collections", album.collections]]) {
    for (const value of values) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${{ artist: "Artista", genres: "Genere", tags: "Tag", collections: "Collezione" }[field]}: ${value}`;
      button.addEventListener("click", () => openLocalFacet(field, value));
      facets.append(button);
    }
  }
  $("#albumDetailsMeta").after(facets);
  $("#albumDetailsError").hidden = true;
  const fields = template.content.querySelector(".album-fields").cloneNode(true);
  fields.hidden = false;
  fields.querySelector(".status-input").value = album.status;
  fields.querySelector(".genres-input").value = album.genres.join(", ");
  fields.querySelector(".collections-input").value = album.collections.join(", ");
  fields.querySelector(".tags-input").value = album.tags.join(", ");
  const notesLabel = document.createElement("label");
  notesLabel.textContent = "Note";
  const notes = document.createElement("textarea");
  notes.className = "album-notes-input";
  notes.maxLength = 100_000;
  notes.value = album.notes || "";
  notes.setAttribute("aria-label", `Note per ${album.name}`);
  notesLabel.append(notes);
  fields.append(notesLabel);
  const rating = fields.querySelector(".rating-input");
  for (let step = 1; step <= 10; step += 1) {
    rating.add(new Option(`${(step / 2).toFixed(1)} / 5`, String(step / 2)));
  }
  rating.value = album.rating === null ? "" : String(album.rating);
  $("#albumDetailsFields").replaceChildren(fields);
  appendListeningActions(fields, album, {
    markListened: () => {
      if (!persistDetailsDraft()) return;
      if (qol.drafts[`edit:${id}`]) {
        $("#albumDetailsError").textContent = "Salva o scarta la bozza prima di segnare l'album ascoltato.";
        $("#albumDetailsError").hidden = false;
        return;
      }
      updateAlbum(id, { status: "neutral" });
      openAlbumDetails(id, returnFocus);
    },
    rate: () => rating.focus(),
  });
  restoreDetailsDraft(id);
  const adjacent = adjacentAlbumIds(visibleAlbums, id);
  $("#previousAlbumButton").disabled = !adjacent.previous;
  $("#nextAlbumButton").disabled = !adjacent.next;
  if (!$("#albumDetailsDialog").open) $("#albumDetailsDialog").showModal();
}

const detailsDraftSelectors = [".status-input", ".rating-input", ".genres-input", ".collections-input",
  ".tags-input", ".album-notes-input"];
function persistDetailsDraft() {
  if (!detailsAlbumId) return true;
  const album = state.albums.find((record) => record.id === detailsAlbumId);
  const fields = Object.fromEntries(detailsDraftSelectors.map((selector) =>
    [selector, $("#albumDetailsFields").querySelector(selector).value]));
  const original = album ? { ".status-input": album.status, ".rating-input": album.rating === null ? "" : String(album.rating),
    ".genres-input": album.genres.join(", "), ".collections-input": album.collections.join(", "),
    ".tags-input": album.tags.join(", "), ".album-notes-input": album.notes || "" } : {};
  return JSON.stringify(fields) === JSON.stringify(original)
    ? (!qol.drafts[`edit:${detailsAlbumId}`] || clearAlbumDraft(`edit:${detailsAlbumId}`))
    : saveAlbumDraft(`edit:${detailsAlbumId}`, fields);
}
for (const [selector, direction] of [["#previousAlbumButton", "previous"], ["#nextAlbumButton", "next"]]) {
  $(selector).addEventListener("click", () => {
    const id = adjacentAlbumIds(visibleAlbums, detailsAlbumId)[direction];
    if (!id || !persistDetailsDraft()) return;
    openAlbumDetails(id, detailsReturnFocus);
    $(selector).focus();
  });
}
$("#albumDetailsDialog").addEventListener("cancel", (event) => {
  if (!persistDetailsDraft()) event.preventDefault();
});

$("#albumDetailsForm").addEventListener("submit", (event) => {
  if (event.submitter?.value !== "save") {
    if (!persistDetailsDraft()) event.preventDefault();
    return;
  }
  event.preventDefault();
  const fields = $("#albumDetailsFields");
  const list = (selector) => fields.querySelector(selector).value.split(",").map((value) => value.trim()).filter(Boolean);
  try {
    if (!state.albums.some((album) => album.id === detailsAlbumId)) throw new Error("Album non più presente.");
    commitAlbumChanges(new Set([detailsAlbumId]), {
      status: fields.querySelector(".status-input").value,
      genres: list(".genres-input"),
      collections: list(".collections-input"),
      tags: list(".tags-input"),
      notes: fields.querySelector(".album-notes-input").value,
      rating: fields.querySelector(".rating-input").value ? Number(fields.querySelector(".rating-input").value) : null,
    });
    if (!clearAlbumDraft(`edit:${detailsAlbumId}`)) return;
    $("#albumDetailsDialog").close();
    render();
    showFeedback("Album salvato sul dispositivo");
  } catch (error) {
    $("#albumDetailsError").textContent = error.message;
    $("#albumDetailsError").hidden = false;
  }
});
$("#albumDetailsDialog").addEventListener("close", () => {
  if (navigatingToFacet) {
    navigatingToFacet = false;
    detailsAlbumId = null;
    $("#facetBackButton").focus({ preventScroll: true });
    return;
  }
  const target = detailsReturnFocus;
  const id = detailsAlbumId;
  detailsAlbumId = null;
  queueMicrotask(() => {
    if (target?.isConnected) target.focus();
    else {
      const card = [...$("#albumList").children].find((item) => item.dataset.albumId === id);
      (card?.querySelector(".album-details-button") || $("#searchInput")).focus();
    }
  });
});
$("#collectionLayout").addEventListener("change", () => {
  const layout = $("#collectionLayout").value;
  if (saveCollectionPreferences({ ...collectionPreferences, layout })) $("#albumList").dataset.layout = layout;
  else $("#collectionLayout").value = collectionPreferences.layout;
});
$("#pinnedOnlyInput").addEventListener("change", render);
$("#resetFiltersButton").addEventListener("click", resetCollectionFilters);
$("#emptyActionButton").addEventListener("click", () => {
  if (state.albums.length) resetCollectionFilters();
  else if (musicService.service === "tidal") tidalUI.openCatalog();
  else if (musicService.service === "qobuz") qobuzUI.openCatalog();
  else $("#manualAlbumButton").click();
});
$("#clearSelectionButton").addEventListener("click", () => {
  selectedAlbumIds.clear();
  document.querySelectorAll(".album-select").forEach((input) => { input.checked = false; });
  updateSelectionToolbar();
});
$("#selectVisibleButton").addEventListener("click", () => {
  selectedAlbumIds = new Set(visibleAlbums.map((album) => album.id));
  document.querySelectorAll(".album-select").forEach((input) => { input.checked = true; });
  updateSelectionToolbar();
});
$("#bulkStatus").addEventListener("change", updateSelectionToolbar);
$("#applyBulkStatus").addEventListener("click", () => {
  if (!selectedAlbumIds.size || !$("#bulkStatus").value) return;
  openBulkEditor({ status: $("#bulkStatus").value });
});
$("#pinSelectedButton").addEventListener("click", () => setAlbumPins(selectedAlbumIds, true));
$("#unpinSelectedButton").addEventListener("click", () => setAlbumPins(selectedAlbumIds, false));
$("#loadCoversButton").addEventListener("click", async () => {
  $("#viewMenu").open = false;
  try { localStorage.removeItem(COVER_REMOVALS_KEY); }
  catch (error) { showFeedback(`Copertine non riattivate: ${error.message}`, true); return; }
  if (musicService.service === "qobuz") {
    showFeedback("Le copertine Qobuz sono visibili online durante l'importazione; quelle sincronizzate dal desktop sono disponibili offline.");
  } else if (musicService.service === "tidal") {
    const button = $("#loadCoversButton"), serviceEpoch = musicService.epoch;
    button.disabled = true;
    try {
      const artwork = await tidalUI.loadArtwork(visibleAlbums.filter((album) => !collectionCoverImageUrls.has(album.id)));
      musicService.assert("tidal", serviceEpoch);
      if (!artwork) return;
      for (const [id, url] of artwork) collectionCoverImageUrls.set(id, url);
      render();
    } catch (error) { showFeedback(error.message, true); }
    finally { button.disabled = false; }
  } else render({ remoteCovers: true });
});

const localCommands = [
  { id: "collection", label: "Vai alla raccolta album" },
  { id: "suggestions", label: "Vai ai suggerimenti" },
  { id: "playlist", label: "Vai a Crea playlist" },
  { id: "add", label: "Aggiungi album · apri ricerca online" },
  { id: "import", label: "Importa playlist · apri finestra" },
  { id: "settings", label: "Apri preferenze e collegamenti" },
  { id: "search", label: "Cerca nella raccolta locale" },
  { id: "reset", label: "Azzera filtri della raccolta" },
];

function runLocalCommand(result) {
  $("#commandDialog").close();
  if (result.albumId) {
    activateViewTab($("#collectionTab"));
    openAlbumDetails(result.albumId, $("#commandButton"));
    return;
  }
  const tabs = { collection: "#collectionTab", suggestions: "#suggestionsTab", playlist: "#playlistBuilderTab" };
  if (tabs[result.id]) {
    activateViewTab($(tabs[result.id]));
    $(tabs[result.id]).focus();
  } else if (result.id === "settings") openSettings();
  else if (result.id === "add") $("#manualAlbumButton").click();
  else if (result.id === "import") $("#playlistImportButton").click();
  else {
    activateViewTab($("#collectionTab"));
    if (result.id === "reset") resetCollectionFilters();
    else $("#searchInput").focus();
  }
}

function renderLocalCommands() {
  const results = localCommandResults($("#commandInput").value, localCommands, state.albums);
  $("#commandResults").replaceChildren();
  for (const result of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${result.albumId ? "Album · " : ""}${result.label}`;
    button.addEventListener("click", () => runLocalCommand(result));
    $("#commandResults").append(button);
  }
  $("#commandStatus").textContent = results.length
    ? `${results.length} risultati locali${results.length === 30 ? " · affina la ricerca per trovarne altri" : ""}`
    : "Nessun risultato locale. Per aggiungere musica usa Aggiungi album.";
}

function openCommandPalette() {
  if (document.querySelector("dialog[open]")) return;
  $("#commandInput").value = "";
  renderLocalCommands();
  $("#commandDialog").showModal();
  $("#commandInput").focus();
}
$("#commandButton").addEventListener("click", openCommandPalette);
$("#closeCommandButton").addEventListener("click", () => $("#commandDialog").close());
$("#commandInput").addEventListener("input", renderLocalCommands);
for (const selector of ["#albumDetailsDialog", "#commandDialog"]) {
  $(selector).addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (selector === "#albumDetailsDialog" && !persistDetailsDraft()) return;
    $(selector).close();
  });
}
$("#commandDialog").addEventListener("keydown", (event) => {
  const buttons = [...$("#commandResults").querySelectorAll("button")];
  if (!buttons.length) return;
  const current = buttons.indexOf(document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = event.key === "ArrowDown" ? (current + 1) % buttons.length
      : (current <= 0 ? buttons.length - 1 : current - 1);
    buttons[next].focus();
  } else if (event.key === "Enter" && event.target === $("#commandInput")) {
    event.preventDefault();
    buttons[0].click();
  }
});
document.addEventListener("keydown", (event) => {
  const target = event.target;
  const editing = target instanceof HTMLElement
    && (target.matches("input, textarea, select") || target.isContentEditable);
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f"
      && (!editing || target === $("#searchInput")) && !document.querySelector("dialog[open]")) {
    event.preventDefault();
    activateViewTab($("#collectionTab"));
    $("#searchInput").focus();
    $("#searchInput").select();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    if ($("#commandDialog").open) $("#commandDialog").close();
    else openCommandPalette();
  }
});

function refreshGroupFilter(selector, key, allLabel) {
  const selected = $(selector).value;
  const values = new Map();
  for (const album of state.albums) {
    for (const value of album[key]) values.set(value.toLocaleLowerCase(), value);
  }
  $(selector).replaceChildren(new Option(allLabel, ""));
  for (const [value, label] of [...values].sort((a, b) => a[1].localeCompare(b[1]))) {
    $(selector).add(new Option(label, value));
  }
  $(selector).value = values.has(selected) ? selected : "";
}

function refreshGenreFilters() {
  const primaryFilter = $("#primaryGenreFilter");
  const secondaryFilter = $("#secondaryGenreFilter");
  const selectedPrimary = primaryFilter.value;
  const selectedSecondary = secondaryFilter.value;
  const primaryCounts = new Map();
  let albumsWithoutPrimary = 0;
  for (const album of state.albums) {
    const primary = albumPrimaryGenre(album);
    if (!primary) {
      albumsWithoutPrimary += 1;
      continue;
    }
    const key = primary.toLocaleLowerCase();
    const entry = primaryCounts.get(key) || { label: primary, count: 0 };
    entry.count += 1;
    primaryCounts.set(key, entry);
  }
  primaryFilter.replaceChildren(new Option(`Tutti i generi principali (${state.albums.length})`, ""));
  primaryFilter.add(new Option(`Senza genere principale (${albumsWithoutPrimary})`, NO_PRIMARY_GENRE_FILTER));
  for (const [key, entry] of [...primaryCounts].sort((left, right) => left[1].label.localeCompare(right[1].label))) {
    primaryFilter.add(new Option(`${entry.label} (${entry.count})`, key));
  }
  if ([...primaryFilter.options].some((option) => option.value === selectedPrimary)) {
    primaryFilter.value = selectedPrimary;
  }

  const primary = primaryFilter.value;
  const scopedAlbums = primary === NO_PRIMARY_GENRE_FILTER
    ? state.albums.filter((album) => !albumPrimaryGenre(album))
    : primary ? state.albums.filter((album) => albumPrimaryGenre(album).toLocaleLowerCase() === primary)
      : state.albums;
  const secondaryCounts = new Map();
  let albumsWithoutSecondary = 0;
  for (const album of primary && primary !== NO_PRIMARY_GENRE_FILTER ? scopedAlbums : []) {
    const secondaryGenres = albumSecondaryGenres(album);
    if (!secondaryGenres.length) albumsWithoutSecondary += 1;
    for (const genre of secondaryGenres) {
      const key = genre.toLocaleLowerCase();
      const entry = secondaryCounts.get(key) || { label: genre, count: 0 };
      entry.count += 1;
      secondaryCounts.set(key, entry);
    }
  }
  secondaryFilter.replaceChildren(new Option(`Tutti i generi secondari (${scopedAlbums.length})`, ""));
  secondaryFilter.add(new Option(`Nessun sottogenere (${albumsWithoutSecondary})`, NO_SECONDARY_GENRE_FILTER));
  for (const [key, entry] of [...secondaryCounts].sort((left, right) => left[1].label.localeCompare(right[1].label))) {
    secondaryFilter.add(new Option(`${entry.label} (${entry.count})`, key));
  }
  secondaryFilter.disabled = secondaryCounts.size === 0;
  secondaryFilter.value = !secondaryFilter.disabled
    && [...secondaryFilter.options].some((option) => option.value === selectedSecondary)
    ? selectedSecondary : "";
}

function render(options = {}) {
  finishManualDrag(false);
  ensureManualOrder();
  refreshGenreFilters();
  refreshGroupFilter("#collectionFilter", "collections", "Tutte le collezioni");
  refreshGroupFilter("#tagFilter", "tags", "Tutti i tag");
  const sortOrder = $("#sortOrder").value;
  let durations;
  try {
    const queue = JSON.parse(localStorage.getItem(LISTENING_QUEUE_KEY) || '{"durations":{}}');
    const known = JSON.parse(localStorage.getItem(ALBUM_DURATIONS_KEY) || "{}");
    if (!queue || !known || !queue.durations || typeof queue.durations !== "object"
        || Array.isArray(queue.durations) || typeof known !== "object" || Array.isArray(known)) {
      throw new Error("Formato durate non valido.");
    }
    durations = { ...queue.durations, ...known };
    if (Object.values(durations).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      throw new Error("Durate locali non valide.");
    }
  } catch (error) {
    showFeedback(`Impossibile filtrare la raccolta: ${error.message}`, true);
    return;
  }
  const filteredAlbums = filterAlbums(state.albums, {
    search: appliedCollectionSearch,
    primaryGenre: $("#primaryGenreFilter").value,
    secondaryGenre: $("#secondaryGenreFilter").value,
    status: $("#statusFilter").value,
    collection: $("#collectionFilter").value,
    tag: $("#tagFilter").value,
    order: sortOrder,
  }).filter((album) => smartAlbumMatch($("#smartCollectionList").value, album, qol.changedAt)
    && (!collectionSelectionOnly || selectedAlbumIds.has(album.id))
    && localCollectionMatch(album, {
      unrated: $("#unratedFilter").checked, missingDuration: $("#missingDurationFilter").checked,
      notesPresent: $("#notesPresentFilter").checked, service: $("#serviceFilter").value, durations,
    }));
  const sortedAlbums = sortOrder === "manual"
    ? sortAlbumsByManualOrder(filteredAlbums, state.manualOrder)
    : filteredAlbums;
  const pins = new Set(collectionPreferences.pinnedIds);
  const pinnedAlbums = $("#pinnedOnlyInput").checked
    ? sortedAlbums.filter((album) => pins.has(album.id)) : sortedAlbums;
  const albums = pinnedAlbums.filter((album) => exactAlbumFacet(album, localFacet));
  $("#facetBackButton").hidden = !facetReturnViews.length;
  $("#facetSummary").hidden = !localFacet;
  $("#facetSummary").textContent = localFacet ? `Filtro locale esatto · ${localFacet.field}: ${localFacet.value}` : "";
  visibleAlbums = albums;
  selectedAlbumIds = visibleSelection(selectedAlbumIds, state.albums);
  updateSelectionToolbar();
  renderCollectionFilterChips();
  $("#resetFiltersButton").hidden = !collectionHasFilters();
  const filterCount = ["#primaryGenreFilter", "#secondaryGenreFilter", "#statusFilter",
    "#collectionFilter", "#tagFilter", "#serviceFilter"].filter((selector) => $(selector).value).length
    + localCollectionChecks.filter((selector) => $(selector).checked).length
    + Number($("#pinnedOnlyInput").checked) + Number(collectionSelectionOnly);
  $("#activeFilterCount").textContent = filterCount ? `· ${filterCount} attivi` : "";
  const manualSorting = sortOrder === "manual";
  $("#manualOrderHint").hidden = !manualSorting;
  if (manualSorting) {
    $("#manualOrderHint").textContent =
      "Ordine manuale salvato solo su questo dispositivo: tieni premuto un album e trascinalo; puoi anche usare le frecce.";
  }
  const generation = ++coverRenderGeneration;
  const previousCovers = new Map([...$("#albumList").children]
    .filter((card) => card.classList.contains("has-cover"))
    .map((card) => [card.dataset.albumId, card.querySelector(".cover-frame")]));
  $("#albumList").replaceChildren();
  const cardsFragment = document.createDocumentFragment();
  $("#collectionSummary").textContent = `${albums.length} album · ${state.albums.length} nella raccolta`;
  $("#unratedSummary").textContent = `${state.albums.filter((album) =>
    smartAlbumMatch("unrated", album, qol.changedAt)).length} ascoltati senza voto · mostra`;
  $("#emptyState").hidden = albums.length !== 0;
  $("#emptyHeading").textContent = state.albums.length ? "Nessun album trovato" : "La tua raccolta inizia qui";
  $("#emptyDescription").textContent = state.albums.length
    ? "Nessun album corrisponde ai filtri."
    : `Questa raccolta è vuota sul dispositivo. Per trasferire gli album dal PC, sincronizza Accord desktop con il repository accord-music-data, poi premi “Sincronizza” qui: il PC non deve restare acceso. Puoi anche importare una playlist ${musicService.service === "tidal" ? "TIDAL" : musicService.service === "qobuz" ? "Qobuz" : "Spotify"}.`;
  $("#emptyActionButton").textContent = state.albums.length ? "Azzera filtri" : "Aggiungi il primo album";
  updateCollectionCoverNotice();
  for (const [index, album] of albums.entries()) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.albumId = album.id;
    const selection = card.querySelector(".album-select");
    selection.checked = selectedAlbumIds.has(album.id);
    selection.setAttribute("aria-label", `Seleziona ${album.name}`);
    selection.addEventListener("click", (event) => {
      selectAlbumCard(album.id, event);
    });
    card.addEventListener("click", (event) => {
      if (!event.target.closest(`${interactiveAlbumTarget}, label, summary`)) selectAlbumCard(album.id, event);
    });
    const pinned = pins.has(album.id);
    card.querySelector(".pinned-indicator").hidden = !pinned;
    const pinButton = card.querySelector(".pin-album");
    pinButton.setAttribute("aria-pressed", String(pinned));
    pinButton.setAttribute("aria-label", `${pinned ? "Non fissare" : "Fissa"} ${album.name}`);
    pinButton.textContent = pinned ? "Non fissare" : "Fissa";
    pinButton.addEventListener("click", () => {
      setAlbumPins([album.id], !pinned);
      const replacement = [...$("#albumList").children].find((item) => item.dataset.albumId === album.id);
      (replacement?.querySelector(".pin-album") || $("#pinnedOnlyInput")).focus();
    });
    card.querySelector(".album-details-button").setAttribute("aria-label", `Dettagli di ${album.name}`);
    card.querySelector(".album-details-button").addEventListener("click", (event) => openAlbumDetails(album.id, event.currentTarget));
    if (manualSorting) card.classList.add("manual-sortable");
    card.querySelector(".album-title").textContent = album.name;
    const draftBadge = document.createElement("span");
    draftBadge.className = "draft-indicator";
    draftBadge.textContent = "Bozza locale";
    draftBadge.hidden = !qol.drafts[`edit:${album.id}`];
    card.querySelector(".album-heading").append(draftBadge);
    card.querySelector(".album-meta").textContent =
      `${album.artist} · ${album.year || "Anno sconosciuto"} · ${labels[album.status]}`;
    card.querySelector(".album-extra").textContent = [
      albumPrimaryGenre(album), album.rating === null ? "" : `${album.rating} / 5`,
      album.collections.join(", "), album.tags.length ? `Tag: ${album.tags.join(", ")}` : "",
    ].filter(Boolean).join(" · ");
    const coverImage = card.querySelector(".album-cover");
    coverImage.alt = `Copertina di ${album.name}`;
    coverImage.referrerPolicy = "no-referrer";
    card.querySelector(".cover-placeholder").textContent = album.cover_sha256
      ? "Premi Sincronizza per scaricare"
      : musicService.service === "tidal" ? "Copertina TIDAL non caricata · usa Vista > Altre azioni"
        : options.remoteCovers ? "Cerco una copertina online…" : "Copertina non disponibile offline";
    if (!options.remoteCovers && previousCovers.has(album.id) && !removedCoverIds().has(album.id)) {
      card.querySelector(".cover-frame").replaceWith(previousCovers.get(album.id));
      card.classList.add("has-cover");
    }
    card.querySelector(".status-input").value = album.status;
    card.querySelector(".status-input").setAttribute("aria-label", `Stato per ${album.name}`);
    card.querySelector(".status-input").addEventListener("change", (event) =>
      updateAlbum(album.id, { status: event.currentTarget.value }));
    const quick = document.createElement("div");
    quick.className = "album-quick-edit";
    quick.setAttribute("role", "group");
    quick.setAttribute("aria-label", `Modifica rapida di ${album.name}`);
    quick.append(card.querySelector(".status-field"), card.querySelector(".rating-field"));
    const secondary = document.createElement("details");
    secondary.className = "album-secondary";
    const secondaryHeading = document.createElement("summary");
    secondaryHeading.textContent = "Altre azioni";
    const secondaryActions = document.createElement("div");
    secondaryActions.className = "album-secondary-actions";
    secondary.append(secondaryHeading, secondaryActions);
    card.querySelector(".album-actions").append(secondary);
    secondaryActions.append(quick, pinButton, card.querySelector(".manual-order-controls"));
    appendListeningActions(secondaryActions, album, {
      markListened: (id) => updateAlbum(id, { status: "neutral" }),
      rate: () => { secondary.open = true; card.querySelector(".rating-input").focus(); },
    });
    const link = card.querySelector(".album-player-link");
    const tidalAlbum = musicService.service === "tidal", qobuzAlbum = musicService.service === "qobuz";
    let associated = null;
    try { associated = editionLink(localStorage, album, musicService.service); }
    catch (error) { showFeedback(error.message, true); }
    const playbackAlbum = associated || album;
    const albumLink = musicAlbumLink(playbackAlbum, musicService.service);
    link.hidden = false;
    link.removeAttribute("href");
    link.target = "_self";
    link.rel = "noopener noreferrer";
    const serviceLabel = tidalAlbum ? "TIDAL" : qobuzAlbum ? "Qobuz" : "Spotify";
    const query = `${album.artist} ${album.name}`;
    const sameQobuz = qobuzAlbum && /^qobuz:[A-Za-z0-9]{1,120}$/.test(playbackAlbum.id)
      && playbackAlbum.url === `https://play.qobuz.com/album/${playbackAlbum.id.slice(6)}`;
    let label = `Apri nell'app ${serviceLabel}`;
    if (albumLink || sameQobuz) {
      configureMusicAppLink(link, albumLink || playbackAlbum.url, { query, report: showFeedback });
      if (!albumLink) label = "Copia artista e titolo per cercare nell'app Qobuz";
    } else {
      label = `Scegli l'edizione nel catalogo ${serviceLabel}`;
      link.setAttribute("role", "button"); link.tabIndex = 0;
      const search = (event) => {
        event.preventDefault();
        chooseCollectionEdition(album);
      };
      link.addEventListener("click", search);
      link.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") search(event);
      });
    }
    const iconPath = albumLink ? "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"
      : sameQobuz ? "M8 8h13v13H8zM16 8V3H3v13h5"
        : "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6";
    link.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="${iconPath}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    link.title = `${label}: ${album.artist} · ${album.name}`;
    link.setAttribute("aria-label", link.title);
    if (tidalAlbum || qobuzAlbum) {
      const change = document.createElement("button");
      change.type = "button"; change.className = "secondary";
      change.textContent = associated ? "Cambia edizione associata" : "Associa edizione";
      change.addEventListener("click", () => chooseCollectionEdition(album)); secondaryActions.append(change);
      if (associated) {
        const forget = document.createElement("button");
        forget.type = "button"; forget.className = "secondary"; forget.textContent = "Rimuovi associazione";
        forget.addEventListener("click", () => {
          try { setEditionLink(localStorage, album, musicService.service); render(); }
          catch (error) { showFeedback(error.message, true); }
        }); secondaryActions.append(forget);
      }
    }
    const orderControls = card.querySelector(".manual-order-controls");
    orderControls.hidden = !manualSorting;
    if (manualSorting) {
      const moveUp = orderControls.querySelector(".move-album-up");
      const moveDown = orderControls.querySelector(".move-album-down");
      const dragHandle = orderControls.querySelector(".album-drag-handle");
      moveUp.disabled = index === 0;
      moveDown.disabled = index === albums.length - 1;
      moveUp.setAttribute("aria-label", `Sposta ${album.name} in alto`);
      moveDown.setAttribute("aria-label", `Sposta ${album.name} in basso`);
      moveUp.addEventListener("click", () => moveManualAlbum(album.id, index - 1, albums));
      moveDown.addEventListener("click", () => moveManualAlbum(album.id, index + 1, albums));
    }
    const genres = card.querySelector(".genres-input");
    genres.value = album.genres.join(", ");
    genres.setAttribute("aria-label", `Generi per ${album.name}`);
    genres.addEventListener("change", () => updateAlbum(album.id, {
      genres: genres.value.split(",").map((value) => value.trim()).filter(Boolean),
    }));
    const collections = card.querySelector(".collections-input");
    collections.value = album.collections.join(", ");
    collections.setAttribute("aria-label", `Collezioni per ${album.name}`);
    collections.addEventListener("change", () => updateAlbum(album.id, {
      collections: collections.value.split(",").map((value) => value.trim()).filter(Boolean),
    }));
    const tags = card.querySelector(".tags-input");
    tags.value = album.tags.join(", ");
    tags.setAttribute("aria-label", `Tag per ${album.name}`);
    tags.addEventListener("change", () => updateAlbum(album.id, {
      tags: tags.value.split(",").map((value) => value.trim()).filter(Boolean),
    }));
    const rating = card.querySelector(".rating-input");
    for (let step = 1; step <= 10; step += 1) {
      const value = step / 2;
      rating.add(new Option(`${value.toFixed(1)} / 5`, String(value)));
    }
    rating.value = album.rating === null ? "" : String(album.rating);
    rating.setAttribute("aria-label", `Voto per ${album.name}`);
    rating.addEventListener("change", () => updateAlbum(album.id, {
      rating: rating.value ? Number(rating.value) : null,
    }));
    cardsFragment.append(card);
  }
  $("#albumList").append(cardsFragment);
  const retainedUrls = new Set([...$("#albumList").querySelectorAll(".album-cover")].map((image) => image.src));
  coverObjectUrls = coverObjectUrls.filter((url) => {
    if (retainedUrls.has(url)) return true;
    URL.revokeObjectURL(url);
    return false;
  });
  updateLocalSyncSummary();
  void renderCovers(albums, generation, Boolean(options.remoteCovers));
}

async function renderCovers(albums, generation, remoteCovers = false) {
  try {
    let unavailable = 0;
    const cards = new Map([...$("#albumList").children].map((card) => [card.dataset.albumId, card]));
    for (const [index, album] of albums.entries()) {
      const card = cards.get(album.id);
      if (!card) continue;
      if (removedCoverIds().has(album.id)) {
        card.querySelector(".cover-placeholder").textContent = "Copertina rimossa su questo dispositivo";
        continue;
      }
      if (card.classList.contains("has-cover")) continue;
      const enqueue = () => {
        if (remoteCovers) enqueueCollectionCover({ album, card, generation });
      };
      if (!album.cover_sha256) {
        unavailable += 1;
        const tidalArtwork = (album.id.startsWith("tidal:") && musicService.service === "tidal")
          || album.id.startsWith("qobuz:")
          ? collectionCoverImageUrls.get(album.id) : null;
        if (tidalArtwork) {
          const image = card.querySelector(".album-cover"), serviceEpoch = musicService.epoch;
          image.addEventListener("load", () => {
            if (generation !== coverRenderGeneration || musicService.epoch !== serviceEpoch) return;
            card.classList.add("has-cover");
            collectionCoverRemoteIds.add(album.id);
            collectionCoverFailures.delete(album.id);
            updateCollectionCoverNotice();
          }, { once: true });
          image.addEventListener("error", () => {
            if (generation !== coverRenderGeneration || musicService.epoch !== serviceEpoch) return;
            collectionCoverFailures.set(album.id, "Copertina online non caricabile.");
            updateCollectionCoverNotice();
          }, { once: true });
          image.src = tidalArtwork;
          continue;
        }
        enqueue();
        continue;
      }
      let data;
      try {
        data = await getCachedCover(album.id);
      } catch (error) {
        collectionCoverFailures.set(album.id, `Archivio offline: ${error.message}`);
        unavailable += 1;
        enqueue();
        continue;
      }
      if (!data) {
        unavailable += 1;
        enqueue();
        continue;
      }
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
      const hash = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
      if (hash !== album.cover_sha256) {
        collectionCoverFailures.set(album.id, "La miniatura locale non corrisponde all'impronta sincronizzata.");
        unavailable += 1;
        enqueue();
        continue;
      }
      if (generation !== coverRenderGeneration) return;
      collectionCoverFailures.delete(album.id);
      collectionCoverRemoteIds.delete(album.id);
      const url = URL.createObjectURL(new Blob([data], { type: "image/jpeg" }));
      coverObjectUrls.push(url);
      const image = card.querySelector(".album-cover");
      image.loading = index < 8 ? "eager" : "lazy";
      image.addEventListener("load", () => {
        if (generation === coverRenderGeneration) {
          card.classList.add("has-cover");
          updateCollectionCoverNotice();
        }
      }, { once: true });
      image.addEventListener("error", () => {
        if (generation !== coverRenderGeneration) return;
        card.querySelector(".cover-placeholder").textContent = musicService.service === "tidal"
          ? "Copertina TIDAL non caricata · usa Vista > Altre azioni" : "Cerco una copertina online…";
        card.classList.add("cover-error");
        collectionCoverFailures.set(album.id, "La miniatura sincronizzata non è leggibile come immagine.");
        enqueue();
      }, { once: true });
      image.src = url;
    }
    if (generation !== coverRenderGeneration) return;
    if (unavailable) updateCollectionCoverNotice();
  } catch (error) {
    setSyncState("Copertine offline non disponibili");
    showMessage("Errore archivio copertine", error.message);
  }
}

function collectionCoverTaskIsCurrent(task) {
  return musicService.service === "spotify" && !task.album.id.startsWith("tidal:") && !task.album.id.startsWith("qobuz:")
    && task.generation === coverRenderGeneration && task.card.isConnected;
}

function showCollectionCoverImage(task, url) {
  if (!collectionCoverTaskIsCurrent(task)) return Promise.resolve(false);
  const image = task.card.querySelector(".album-cover");
  image.loading = "eager";
  return new Promise((resolve) => {
    let settled = false;
    const finish = (loaded) => {
      if (settled) return;
      settled = true;
      if (collectionCoverTaskIsCurrent(task)) {
        if (loaded) {
          task.card.classList.add("has-cover");
          task.card.classList.remove("cover-error");
        } else {
          task.card.classList.remove("has-cover");
        }
      }
      resolve(loaded);
    };
    image.addEventListener("load", () => finish(true), { once: true });
    image.addEventListener("error", () => finish(false), { once: true });
    image.src = url;
    if (image.complete) queueMicrotask(() => finish(image.naturalWidth > 0));
  });
}

function trustedSpotifyCoverUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase();
    const allowed = host.endsWith(".scdn.co") || host === "scdn.co"
      || host.endsWith(".spotifycdn.com") || host === "spotifycdn.com";
    return url.protocol === "https:" && allowed && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function collectionSpotifyToken() {
  if (!collectionCoverTokenPromise) {
    collectionCoverTokenPromise = spotifyAccessToken().finally(() => {
      collectionCoverTokenPromise = null;
    });
  }
  return collectionCoverTokenPromise;
}

async function musicBrainzCollectionCoverUrl(album) {
  const escape = (value) => String(value).replace(/([\\"])/g, "\\$1");
  const parameters = new URLSearchParams({
    query: `primarytype:album AND artist:"${escape(album.artist)}" AND releasegroup:"${escape(album.name)}"`,
    fmt: "json",
    limit: "5",
  });
  const data = await retryMusicBrainzRequest(async () => {
    const delay = 1100 - (Date.now() - lastListeningCatalogRequestAt);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    lastListeningCatalogRequestAt = Date.now();
    const response = await fetch(`https://musicbrainz.org/ws/2/release-group?${parameters}`, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      const error = new Error(`MusicBrainz ha risposto con HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }, (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const groups = data["release-groups"];
  if (!Array.isArray(groups)) throw new Error("Risposta MusicBrainz senza gruppi di pubblicazione verificabili.");
  const normalize = (value) => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  let matches = groups.filter((group) => {
    if (group?.["primary-type"] !== "Album"
        || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(group.id || "")
        || normalize(group.title) !== normalize(album.name)) return false;
    const artist = (Array.isArray(group["artist-credit"]) ? group["artist-credit"] : [])
      .flatMap((credit) => typeof credit === "string" ? [credit]
        : [credit?.name || credit?.artist?.name || ""])
      .filter(Boolean).join(", ");
    return normalize(artist) === normalize(album.artist);
  });
  if (matches.length > 1 && album.year) {
    matches = matches.filter((group) => String(group["first-release-date"] || "").slice(0, 4) === album.year);
  }
  if (matches.length !== 1) return null;
  return `https://coverartarchive.org/release-group/${matches[0].id.toLocaleLowerCase()}/front-500`;
}

async function loadCollectionCover(task, spotifyAlbum, spotifyError = "") {
  if (!collectionCoverTaskIsCurrent(task)) return;
  const { album } = task;
  const errors = [];
  const tryImage = async (url, source) => {
    if (!url || !collectionCoverTaskIsCurrent(task)) return false;
    if (!await showCollectionCoverImage(task, url)) {
      errors.push(`${source}: immagine non caricabile`);
      return false;
    }
    collectionCoverImageUrls.set(album.id, url);
    collectionCoverRemoteIds.add(album.id);
    collectionCoverFailures.delete(album.id);
    updateCollectionCoverNotice();
    return true;
  };

  if (spotifyError) {
    errors.push(`Spotify: ${spotifyError}`);
  } else if (spotifyAlbum && collectionCoverTaskIsCurrent(task)) {
    const images = Array.isArray(spotifyAlbum.images) ? spotifyAlbum.images
      .filter((image) => trustedSpotifyCoverUrl(image?.url))
      .sort((left, right) => Math.abs((left.width || 300) - 300) - Math.abs((right.width || 300) - 300))
      : [];
    for (const image of images) {
      if (await tryImage(trustedSpotifyCoverUrl(image.url), "Spotify")) return;
    }
    if (!images.length) errors.push("Spotify: nessuna immagine verificabile.");
  } else {
    errors.push("Spotify: nessuna immagine verificabile.");
  }

  if (!collectionCoverTaskIsCurrent(task)) return;
  try {
    const coverUrl = await musicBrainzCollectionCoverUrl(album);
    if (coverUrl && await tryImage(coverUrl, "Cover Art Archive")) return;
    errors.push("Cover Art Archive: nessun gruppo MusicBrainz univoco.");
  } catch (error) {
    errors.push(`Cover Art Archive: ${error.message}`);
  }

  if (!collectionCoverTaskIsCurrent(task)) return;
  collectionCoverImageUrls.delete(album.id);
  collectionCoverRemoteIds.delete(album.id);
  collectionCoverFailures.set(album.id, errors.join("; ") || "Nessuna fonte ha restituito una copertina.");
  task.card.querySelector(".cover-placeholder").textContent = "Copertina non disponibile online";
  task.card.classList.add("cover-error");
  updateCollectionCoverNotice();
}

async function loadCollectionCoverBatch(tasks) {
  const cached = await Promise.all(tasks.map(async (task) => {
    const url = collectionCoverImageUrls.get(task.album.id);
    if (!url || !collectionCoverTaskIsCurrent(task)) return false;
    if (await showCollectionCoverImage(task, url)) {
      collectionCoverRemoteIds.add(task.album.id);
      collectionCoverFailures.delete(task.album.id);
      updateCollectionCoverNotice();
      return true;
    }
    collectionCoverImageUrls.delete(task.album.id);
    return false;
  }));
  const pending = tasks.filter((task, index) => !cached[index] && collectionCoverTaskIsCurrent(task));
  let token = null;
  let tokenError = "";
  if (pending.length) {
    try {
      token = await collectionSpotifyToken();
      if (!token) tokenError = "Sessione Spotify non disponibile.";
    } catch (error) {
      tokenError = error.message;
    }
  }
  await Promise.all(tasks.map(async (task, index) => {
    if (cached[index]) return;
    let spotifyAlbum = null;
    let spotifyError = tokenError;
    if (token && collectionCoverTaskIsCurrent(task)) {
      try {
        spotifyAlbum = await spotifyRequest(`albums/${encodeURIComponent(task.album.id)}`, token);
        if (spotifyAlbum?.id !== task.album.id) throw new Error("Spotify ha restituito un album non corrispondente.");
      } catch (error) {
        spotifyError = error.message;
      }
    }
    await loadCollectionCover(task, spotifyAlbum, spotifyError);
  }));
}

function enqueueCollectionCover(task) {
  if (!collectionCoverTaskIsCurrent(task)) return;
  if (!("IntersectionObserver" in window)) {
    collectionCoverQueue.push(task);
    processCollectionCoverQueue();
    return;
  }
  if (!collectionCoverObserver) {
    collectionCoverObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        collectionCoverObserver.unobserve(entry.target);
        const observedTask = collectionCoverTasks.get(entry.target);
        if (observedTask) {
          collectionCoverQueue.push(observedTask);
          processCollectionCoverQueue();
        }
      }
    }, { rootMargin: "180px 0px" });
  }
  collectionCoverTasks.set(task.card, task);
  collectionCoverObserver.observe(task.card);
}

function processCollectionCoverQueue() {
  if (collectionCoverJobsActive || collectionCoverBatchScheduled || !collectionCoverQueue.length) return;
  collectionCoverBatchScheduled = true;
  queueMicrotask(() => {
    collectionCoverBatchScheduled = false;
    const tasks = [];
    while (tasks.length < 20 && collectionCoverQueue.length) {
      const task = collectionCoverQueue.shift();
      if (collectionCoverTaskIsCurrent(task)) tasks.push(task);
    }
    if (!tasks.length) {
      processCollectionCoverQueue();
      return;
    }
    collectionCoverJobsActive = 1;
    void loadCollectionCoverBatch(tasks).finally(() => {
      collectionCoverJobsActive = 0;
      processCollectionCoverQueue();
    });
  });
}

function requestAutomaticSync() {
  automaticSyncQueued = true;
  const { owner, token } = credentials();
  if (!owner || !token) {
    setSyncState("Album aggiunto localmente · configura GitHub per sincronizzare");
    openSettings();
    return;
  }
  if ($("#syncButton").disabled) {
    setSyncState("Album aggiunto localmente · sincronizzazione GitHub in coda");
    return;
  }
  automaticSyncQueued = false;
  void sync();
}

function addAlbumToCollection(album, { syncAutomatically = false } = {}) {
  if (state.loadError) throw new Error(`Archivio locale non leggibile: ${state.loadError}`);
  const previous = state.albums;
  const result = addPlaylistAlbums(previous, [album]);
  if (!result.added) return false;
  state.albums = result.albums;
  try {
    saveState("Aggiungi album");
  } catch (error) {
    state.albums = previous;
    throw error;
  }
  rememberLocalChanges(new Set([album.id]));
  clearAlbumDraft("manual");
  render({ remoteCovers: true });
  if (syncAutomatically) requestAutomaticSync();
  else setSyncState("Album aggiunto localmente · sincronizza per inviarlo");
  return true;
}

function createAlbumCoverFrame(albumName) {
  const frame = document.createElement("div");
  frame.className = "suggestion-cover-frame";
  const image = document.createElement("img");
  image.className = "suggestion-cover";
  image.alt = `Copertina di ${albumName}`;
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  const placeholder = document.createElement("span");
  placeholder.className = "suggestion-cover-placeholder";
  placeholder.textContent = "Copertina non disponibile";
  placeholder.setAttribute("aria-hidden", "true");
  frame.append(image, placeholder);
  const cover = { frame, image, placeholder, generation: 0, objectUrl: null };
  setAlbumCover(cover, null);
  return cover;
}

function setAlbumCover(cover, url, onError = null) {
  const generation = ++cover.generation;
  if (cover.objectUrl && cover.objectUrl !== url) URL.revokeObjectURL(cover.objectUrl);
  cover.objectUrl = typeof url === "string" && url.startsWith("blob:") ? url : null;
  cover.frame.classList.remove("has-cover");
  cover.frame.classList.toggle("cover-unavailable", !url);
  cover.image.hidden = !url;
  if (!url) return;
  cover.image.addEventListener("load", () => {
    if (generation === cover.generation) cover.frame.classList.add("has-cover");
  }, { once: true });
  cover.image.addEventListener("error", () => {
    if (generation !== cover.generation) return;
    cover.image.hidden = true;
    cover.frame.classList.add("cover-unavailable");
    if (cover.objectUrl) {
      URL.revokeObjectURL(cover.objectUrl);
      cover.objectUrl = null;
    }
    onError?.();
  }, { once: true });
  cover.image.src = url;
}

function suggestedCoverFallback(album) {
  return musicBrainzCoverArtUrl(album.mbid || album.sourceId);
}

function suggestedSpotifyMatches(album, token) {
  if (!suggestedSpotifyMatchCache.has(album.id)) {
    const request = fetchSpotifyManualAlbums({
      provider: "spotify", album: album.name, artist: album.artist_names?.[0] || album.artist, genre: "", year: "",
    }, token);
    suggestedSpotifyMatchCache.set(album.id, request);
    request.catch(() => {
      if (suggestedSpotifyMatchCache.get(album.id) === request) {
        suggestedSpotifyMatchCache.delete(album.id);
      }
    });
  }
  return suggestedSpotifyMatchCache.get(album.id);
}

function applyBestSpotifySuggestionCover(album, matches) {
  const candidates = matches.map((match) => ({
    ...match,
    artist_names: spotifyAlbumMetadata.get(match.id)?.artistNames || [],
  }));
  const best = bestSpotifyAlbumSuggestionMatch(album, candidates);
  const metadata = best && spotifyAlbumMetadata.get(best.id);
  if (!metadata?.coverUrl) return false;
  const selected = { albumId: best.id, coverUrl: metadata.coverUrl };
  suggestedSpotifyCoverMatches.set(album.id, selected);
  const cover = suggestedCoverFrames.get(album.id);
  if (cover) {
    cover.image.alt = `Copertina Spotify di ${best.name} · ${best.artist}`;
    setAlbumCover(cover, selected.coverUrl, () => reportSuggestionCoverError(
      new Error("Nessuna copertina pubblica disponibile su Cover Art Archive o Spotify.")));
  }
  return true;
}

function reportSuggestionCoverError(error) {
  if (suggestionCoverFailureShown) return;
  suggestionCoverFailureShown = true;
  const status = $("#suggestionStatus");
  const message = `Copertina non caricata: ${error.message}`;
  status.textContent = status.textContent ? `${status.textContent} · ${message}` : message;
}

function getSuggestionCoverSpotifyToken() {
  if (!suggestionCoverTokenPromise) {
    suggestionCoverTokenPromise = spotifyAccessToken().finally(() => {
      suggestionCoverTokenPromise = null;
    });
  }
  return suggestionCoverTokenPromise;
}

async function loadSuggestedSpotifyCover(task) {
  if (musicService.service !== "spotify") return;
  const serviceEpoch = musicService.epoch;
  if (!task.card.isConnected || musicService.service !== "spotify" || musicService.epoch !== serviceEpoch) return;
  if (!task.spotifyFallback && task.fallbackUrl) {
    setAlbumCover(task.cover, task.fallbackUrl, () => {
      enqueueSuggestionCover({ ...task, spotifyFallback: true });
    });
    return;
  }
  try {
    const token = await getSuggestionCoverSpotifyToken();
    if (!task.card.isConnected || musicService.service !== "spotify" || musicService.epoch !== serviceEpoch) return;
    if (!token) throw new Error("Cover Art Archive e Spotify non hanno fornito una copertina verificabile.");
    const matches = await suggestedSpotifyMatches(task.album, token);
    if (!task.card.isConnected) return;
    if (!applyBestSpotifySuggestionCover(task.album, matches)) {
      reportSuggestionCoverError(new Error(
        "Nessuna copertina pubblica disponibile su Cover Art Archive o Spotify."));
    }
  } catch (error) {
    if (task.card.isConnected) reportSuggestionCoverError(error);
  }
}

function enqueueSuggestionCover(task) {
  if (musicService.service !== "spotify" || task.album.id?.startsWith("tidal:") || task.album.id?.startsWith("qobuz:")) return;
  suggestionCoverQueue.push(task);
  processSuggestionCoverQueue();
}

function processSuggestionCoverQueue() {
  while (suggestionCoverJobsActive < 2 && suggestionCoverQueue.length) {
    const next = suggestionCoverQueue.shift();
    if (!next.card.isConnected) continue;
    suggestionCoverJobsActive += 1;
    void loadSuggestedSpotifyCover(next).finally(() => {
      suggestionCoverJobsActive -= 1;
      processSuggestionCoverQueue();
    });
  }
}

function observeSuggestedCover(card, task) {
  if (!("IntersectionObserver" in window)) {
    enqueueSuggestionCover(task);
    return;
  }
  if (!suggestionCoverObserver) {
    suggestionCoverObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        suggestionCoverObserver.unobserve(entry.target);
        const observedTask = suggestionCoverTasks.get(entry.target);
        if (observedTask) enqueueSuggestionCover(observedTask);
      }
    }, { rootMargin: "180px 0px" });
  }
  suggestionCoverTasks.set(card, task);
  suggestionCoverObserver.observe(card);
}

function renderManualAlbumResults(albums) {
  const container = $("#manualAlbumResults");
  container.replaceChildren();
  if (!albums.length) {
    const empty = document.createElement("p");
    empty.className = "suggestion-detail";
    empty.textContent = "Nessun risultato verificabile trovato.";
    container.append(empty);
    return;
  }
  for (const album of albums) {
    const card = document.createElement("article");
    card.className = "suggestion-album";
    const cover = createAlbumCoverFrame(album.name);
    setAlbumCover(cover, spotifyAlbumMetadata.get(album.id)?.coverUrl
      || musicBrainzCoverArtUrl(album.mbid || album.sourceId));
    const info = document.createElement("p");
    const name = document.createElement("strong");
    name.textContent = album.name;
    const detail = document.createElement("span");
    detail.className = "suggestion-detail";
    const metadata = spotifyAlbumMetadata.get(album.id);
    detail.textContent = ` · ${album.artist} · ${album.year || "Anno sconosciuto"}`
      + (metadata?.albumType === "single"
        ? ` · Singolo / EP (Spotify)${metadata.totalTracks ? ` · ${metadata.totalTracks} brani` : ""}`
        : "")
      + (album.source ? ` · ${album.source}` : "");
    info.append(name, detail);
    const button = document.createElement("button");
    button.className = "secondary";
    button.type = "button";
    const external = ["Last.fm", "MusicBrainz"].includes(album.source);
    const alreadyAdded = !external && state.albums.some((existing) => existing.id === album.id);
    button.textContent = external ? "Abbina a Spotify" : alreadyAdded ? "Già in raccolta" : "Aggiungi";
    button.disabled = !external && alreadyAdded;
    button.addEventListener("click", () => {
      if (external) {
        button.disabled = true;
        void resolveManualAlbumToSpotify(album).finally(() => {
          if (button.isConnected) button.disabled = false;
        });
        return;
      }
      try {
        if (addAlbumToCollection(album)) {
          button.textContent = "Aggiunto";
          button.disabled = true;
          button.setAttribute("aria-label", `${album.name} aggiunto alla raccolta`);
          $("#manualAlbumStatus").textContent = `${album.name} aggiunto localmente. Sincronizza GitHub per inviarlo.`;
          if (suggestedMatchAlbumId && suggestedSourceAlbums.has(suggestedMatchAlbumId)) {
            suggestedMatchAlbumId = null;
          }
        }
      } catch (error) {
        $("#manualAlbumStatus").textContent = `Album non aggiunto: ${error.message}`;
      }
    });
    card.append(cover.frame, info, button);
    container.append(card);
  }
}

function manualAlbumSearchInput() {
  return {
    provider: $("#manualAlbumSource").value,
    album: $("#manualAlbumQuery").value.trim(),
    artist: $("#manualAlbumArtist").value.trim(),
    genre: $("#manualAlbumGenre").value.trim(),
    year: $("#manualAlbumYear").value.trim(),
  };
}

function spotifySearchField(field, value) {
  return `${field}:"${value.trim().replace(/["\\]/g, "\\$&")}"`;
}

function rememberSpotifyAlbumMetadata(albums) {
  for (const album of albums) {
    const id = album?.id;
    if (typeof id !== "string" || !/^[A-Za-z0-9]{22}$/.test(id)) continue;
    const coverUrl = (Array.isArray(album.images) ? album.images : [])
      .map((image) => image?.url)
      .find((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:"
            && (url.hostname.endsWith(".scdn.co") || url.hostname.endsWith(".spotifycdn.com"));
        } catch {
          return false;
        }
      }) || "";
    const artistNames = (Array.isArray(album.artists) ? album.artists : [])
      .map((artist) => String(artist?.name || "").trim()).filter(Boolean);
    const albumType = album.album_type === "single" ? "single" : "";
    const totalTracks = Number.isSafeInteger(Number(album.total_tracks)) ? Number(album.total_tracks) : 0;
    if (coverUrl || artistNames.length || albumType) {
      spotifyAlbumMetadata.set(id, { coverUrl, artistNames, albumType, totalTracks });
    }
  }
  while (spotifyAlbumMetadata.size > 500) {
    spotifyAlbumMetadata.delete(spotifyAlbumMetadata.keys().next().value);
  }
}

function albumMatchesManualFilters(album, filters) {
  const normalized = (value) => value.trim().toLocaleLowerCase();
  if (filters.album && !normalized(album.name).includes(normalized(filters.album))) return false;
  if (filters.artist && !normalized(album.artist).includes(normalized(filters.artist))) return false;
  if (filters.year) {
    const [first, last = first] = filters.year.split("-");
    const year = Number(album.year);
    if (!Number.isInteger(year) || year < Number(first) || year > Number(last)) return false;
  }
  return true;
}

function validateManualAlbumFilters(filters) {
  if (!["lastfm", "musicbrainz", "spotify"].includes(filters.provider)) {
    throw new Error("Scegli una fonte di ricerca valida.");
  }
  if (filters.year && filters.provider !== "lastfm" && !/^\d{4}(?:-\d{4})?$/.test(filters.year)) {
    throw new Error("Inserisci un anno a quattro cifre o un intervallo, ad esempio 1990-1999.");
  }
  if (filters.year && filters.provider !== "lastfm"
      && Number(filters.year.split("-")[0]) > Number(filters.year.split("-")[1] || filters.year)) {
    throw new Error("L’anno iniziale deve precedere quello finale.");
  }
  if (filters.provider === "lastfm" && filters.year) {
    throw new Error("Last.fm non supporta il filtro anno. Scegli MusicBrainz o Spotify.");
  }
  if (filters.provider === "spotify" && filters.genre) {
    throw new Error("Per evitare richieste aggiuntive, Spotify usa solo titolo, artista e anno. Scegli Last.fm per cercare per genere.");
  }
  if (!filters.album && !filters.artist && !filters.genre && !filters.year) {
    throw new Error("Inserisci almeno album, artista, genere o anno.");
  }
  if (filters.year && filters.provider === "lastfm" && !filters.album && !filters.artist && !filters.genre) {
    throw new Error("Inserisci un titolo, artista o genere supportato da Last.fm.");
  }
}

async function fetchSpotifyManualAlbums(filters, accessToken) {
  validateManualAlbumFilters(filters);
  const directId = filters.album && !filters.artist && !filters.year
    ? spotifyAlbumId(filters.album) : null;
  if (directId) {
    const spotifyAlbum = await spotifyRequest(`albums/${encodeURIComponent(directId)}`, accessToken);
    rememberSpotifyAlbumMetadata([spotifyAlbum]);
    return spotifyAlbumSearchRecords([{ item: { type: "track", album: spotifyAlbum } }]);
  }
  const queryTerms = [
    filters.album && spotifySearchField("album", filters.album),
    filters.artist && spotifySearchField("artist", filters.artist),
    filters.year && `year:${filters.year}`,
  ].filter(Boolean);
  const parameters = new URLSearchParams({ q: queryTerms.join(" "), type: "album", limit: "10" });
  const response = await spotifySearchRequest(parameters, accessToken);
  if (!Array.isArray(response.albums?.items)) throw new Error("Risposta Spotify senza risultati verificabili.");
  rememberSpotifyAlbumMetadata(response.albums.items);
  return spotifyAlbumSearchRecords(response.albums.items.map((album) => ({ item: { type: "track", album } })))
    .filter((album) => albumMatchesManualFilters(album, filters));
}

async function lastFmRequest(values, guard = () => {}, beforeRead = () => {}, signal) {
  guard();
  const apiKey = localStorage.getItem(LASTFM_KEY);
  if (!apiKey) {
    openSettings();
    throw new Error("Configura la chiave API Last.fm nelle impostazioni, poi riprova.");
  }
  const cacheable = LASTFM_RESPONSE_CACHE_METHODS.has(values.method);
  const cacheKey = JSON.stringify(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
  if (cacheable) {
    const cached = lastFmResponseCache.get(cacheKey);
    if (cached !== undefined) return cached;
    if (lastFmPendingRequests.has(cacheKey)) return lastFmPendingRequests.get(cacheKey);
  }
  const parameters = new URLSearchParams({ ...values, api_key: apiKey, format: "json" });
  const request = async () => {
    const queued = lastFmApiRequestQueue.then(async () => {
      if (navigator.locks?.request) {
        return navigator.locks.request("accord-lastfm-api", async () => {
          const cooldownUntil = Number(localStorage.getItem(LASTFM_COOLDOWN_KEY)) || 0;
          if (cooldownUntil > Date.now()) {
            throw new Error(`Limite Last.fm attivo; riprova tra ${Math.ceil((cooldownUntil - Date.now()) / 1000)} secondi.`);
          }
          const lastRequestAt = Number(localStorage.getItem(LASTFM_REQUEST_AT_KEY)) || 0;
          const delay = LASTFM_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
          const currentCooldown = Number(localStorage.getItem(LASTFM_COOLDOWN_KEY)) || 0;
          if (currentCooldown > Date.now()) {
            throw new Error(`Limite Last.fm attivo; riprova tra ${Math.ceil((currentCooldown - Date.now()) / 1000)} secondi.`);
          }
          guard();
          beforeRead();
          localStorage.setItem(LASTFM_REQUEST_AT_KEY, String(Date.now()));
          return fetchLastFmResponse(parameters, signal);
        });
      }
      const cooldownUntil = Number(localStorage.getItem(LASTFM_COOLDOWN_KEY)) || 0;
      if (cooldownUntil > Date.now()) {
        throw new Error(`Limite Last.fm attivo; riprova tra ${Math.ceil((cooldownUntil - Date.now()) / 1000)} secondi.`);
      }
      const lastRequestAt = Number(localStorage.getItem(LASTFM_REQUEST_AT_KEY)) || 0;
      const delay = LASTFM_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      guard();
      const currentCooldown = Number(localStorage.getItem(LASTFM_COOLDOWN_KEY)) || 0;
      if (currentCooldown > Date.now()) {
        throw new Error(`Limite Last.fm attivo; riprova tra ${Math.ceil((currentCooldown - Date.now()) / 1000)} secondi.`);
      }
      beforeRead();
      localStorage.setItem(LASTFM_REQUEST_AT_KEY, String(Date.now()));
      return fetchLastFmResponse(parameters, signal);
    });
    lastFmApiRequestQueue = queued.then(() => undefined, () => undefined);
    return queued;
  };
  const pending = request();
  if (cacheable) lastFmPendingRequests.set(cacheKey, pending);
  try {
    const data = await pending;
    if (cacheable) lastFmResponseCache.set(cacheKey, data, LASTFM_RESPONSE_CACHE_TTL);
    return data;
  } finally {
    if (cacheable && lastFmPendingRequests.get(cacheKey) === pending) {
      lastFmPendingRequests.delete(cacheKey);
    }
  }
}

async function fetchLastFmResponse(parameters, signal) {
  let response;
  try {
    response = await fetch(`${LASTFM_API}?${parameters}`, {
      ...(signal ? { signal } : {}),
      headers: { Accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new Error("Last.fm non raggiungibile. Verifica la connessione e riprova.");
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    const cooldown = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000;
    localStorage.setItem(LASTFM_COOLDOWN_KEY, String(Date.now() + cooldown));
    throw new Error(`Limite Last.fm raggiunto; riprova tra ${Math.ceil(cooldown / 1000)} secondi.`);
  }
  if (!response.ok) throw new Error(`Last.fm ha risposto con HTTP ${response.status}.`);
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Risposta Last.fm non leggibile.");
    throw error;
  }
  if (data.error) {
    if (["10", "26"].includes(String(data.error))) throw new Error("Chiave API Last.fm non valida o sospesa.");
    if (String(data.error) === "29") {
      localStorage.setItem(LASTFM_COOLDOWN_KEY, String(Date.now() + 60_000));
      throw new Error("Limite Last.fm raggiunto; riprova tra un minuto.");
    }
    throw new Error(data.message || "Last.fm non ha completato la richiesta.");
  }
  return data;
}

async function searchLastFmAlbums(filters) {
  const method = filters.genre ? "tag.gettopalbums"
    : filters.album ? "album.search" : "artist.gettopalbums";
  const parameters = { method, limit: "50" };
  if (method === "tag.gettopalbums") parameters.tag = filters.genre;
  else if (method === "album.search") parameters.album = filters.album;
  else {
    parameters.artist = filters.artist;
    parameters.autocorrect = "0";
  }
  const data = await lastFmRequest(parameters);
  const collection = method === "tag.gettopalbums" ? data.albums
    : method === "album.search" ? data.results?.albummatches : data.topalbums;
  let entries = collection?.album || [];
  if (!Array.isArray(entries)) entries = [entries];
  const albums = [];
  const seen = new Set();
  for (const entry of entries) {
    const name = String(entry?.name || "").trim();
    const artist = typeof entry?.artist === "string" ? entry.artist.trim()
      : String(entry?.artist?.name || entry?.artist?.["#text"] || "").trim();
    if (!name || !artist || !albumMatchesManualFilters({ name, artist, year: "" }, filters)) continue;
    const key = `${name.toLocaleLowerCase()}|${artist.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let sourceUrl = "";
    try {
      const parsed = new URL(entry.url || "");
      if (parsed.protocol === "https:" && ["last.fm", "www.last.fm"].includes(parsed.hostname)) sourceUrl = parsed.href;
    } catch {
      sourceUrl = "";
    }
    if (!sourceUrl) sourceUrl = `https://www.last.fm/music/${encodeURIComponent(artist)}/${encodeURIComponent(name)}`;
    albums.push({ name, artist, year: "", source: "Last.fm", sourceId: entry.mbid || sourceUrl, sourceUrl });
  }
  return albums;
}

function suggestionFilterValues(selector) {
  return $(selector).value.split(/[,\n]/).map((value) => value.trim()).filter(Boolean);
}

async function recentLastFmScrobbles(username, range) {
  const now = Math.floor(Date.now() / 1000);
  const from = range.from;
  const to = Math.min(range.to, now);
  const parameters = { method: "user.getrecenttracks", user: username, to: String(to), limit: "200", page: "1" };
  if (from !== null) parameters.from = String(from);
  const first = await lastFmRequest(parameters);
  const attrs = first.recenttracks?.["@attr"] || {};
  const totalPages = Number(attrs.totalPages);
  if (!Number.isInteger(totalPages) || totalPages < 0) {
    throw new Error("Last.fm non ha restituito il numero di pagine della cronologia.");
  }
  const pageLimit = Math.min(Math.max(totalPages, 1), 5);
  const tracks = [];
  for (let page = 1; page <= pageLimit; page += 1) {
    const data = page === 1 ? first : await lastFmRequest({ ...parameters, page: String(page) });
    let rows = data.recenttracks?.track || [];
    if (!Array.isArray(rows)) rows = [rows];
    tracks.push(...rows.filter((track) => {
      const stamp = Number(track?.date?.uts);
      return Number.isFinite(stamp) && stamp >= (from ?? 0) && stamp <= to;
    }));
  }
  return { ...summarizeLastFmTracks(tracks), tracks, partial: totalPages > pageLimit };
}

function lastFmArchiveTracks(document, range) {
  const from = range.from ?? 0;
  const to = range.to;
  return document.scrobbles
    .filter((row) => row.stamp >= from && row.stamp <= to)
    .map((row) => ({
      artist: { name: row.artist },
      name: row.name,
      album: { name: row.album },
      date: { uts: String(row.stamp) },
    }));
}

function summarizeLastFmRange(tracks, range) {
  const from = range.from ?? 0;
  const selected = tracks.filter((track) => {
    const stamp = Number(track?.date?.uts);
    return Number.isFinite(stamp) && stamp >= from && stamp <= range.to;
  });
  return { ...summarizeLastFmTracks(selected), tracks: selected, partial: false, syncedArchive: true };
}

async function completeLastFmArchiveTracks(username, document, to) {
  const accountKey = (value) => value.normalize("NFKC").trim().toLocaleLowerCase();
  if (accountKey(document.account) !== accountKey(username)) {
    throw new Error("L’archivio Last.fm sincronizzato appartiene a un altro account. Esporta l’account corretto da Desktop.");
  }
  const coveredUntil = document.coverage[0][1];
  const tracks = lastFmArchiveTracks(document, { from: 0, to: Math.min(to, coveredUntil) });
  if (to > coveredUntil) {
    const delta = await recentLastFmScrobbles(username, { from: coveredUntil + 1, to });
    if (delta.partial) {
      throw new Error("Gli ascolti successivi all’esportazione superano 1.000. Sincronizza tutto lo storico in Desktop e riesporta Last.fm.");
    }
    tracks.push(...delta.tracks);
  }
  return tracks;
}

async function lastFmAllTimeArtistNames(username) {
  const cacheKey = username.toLocaleLowerCase();
  const cached = allTimeArtistCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < 900000) return cached.names;
  const normalized = await readLastFmAllTimeArtists((page, limit) => lastFmRequest({
    method: "user.gettopartists",
    user: username,
    period: "overall",
    limit: String(limit),
    page: String(page),
  }));
  allTimeArtistCache.set(cacheKey, { names: normalized, savedAt: Date.now() });
  return normalized;
}

async function allTimeHeardArtistNames(username) {
  const lastfm = username ? await lastFmAllTimeArtistNames(username) : [];
  return {
    names: lastfm,
    lastfmCount: lastfm.length,
    lastfmLoaded: Boolean(username),
  };
}

async function similarLastFmArtists(name, limit = 30) {
  const data = await lastFmRequest({ method: "artist.getsimilar", artist: name, limit: String(limit), autocorrect: "0" });
  let rows = data.similarartists?.artist || [];
  if (!Array.isArray(rows)) rows = [rows];
  return rows.flatMap((artist) => {
    const candidate = String(artist?.name || "").trim();
    const match = Number(artist?.match);
    return candidate && Number.isFinite(match) && match > 0 && match <= 1
      ? [{ name: candidate, match }] : [];
  });
}

async function searchListeningMusicBrainzAlbums(artists) {
  const unique = new Map(artists.map((artist) => [artist.name.trim().toLocaleLowerCase(), artist]));
  const distinctArtists = [...unique.values()];
  if (!distinctArtists.length) throw new Error("MusicBrainz richiede almeno un artista da cercare.");
  const catalogs = [];
  for (let index = 0; index < distinctArtists.length; index += 10) {
    catalogs.push(await searchListeningMusicBrainzAlbumBatch(distinctArtists.slice(index, index + 10)));
  }
  const albums = new Map();
  for (const catalog of catalogs) {
    for (const album of catalog.albums) {
      if (!albums.has(album.id)) albums.set(album.id, album);
    }
  }
  const knownTotals = catalogs.map((catalog) => catalog.total);
  return {
    albums: [...albums.values()],
    truncated: catalogs.some((catalog) => catalog.truncated),
    total: knownTotals.every(Number.isFinite) ? knownTotals.reduce((sum, value) => sum + value, 0) : null,
    fetched: catalogs.reduce((sum, catalog) => sum + catalog.fetched, 0),
    pages: catalogs.reduce((sum, catalog) => sum + catalog.pages, 0),
    cached: catalogs.every((catalog) => catalog.cached),
  };
}

class ListeningMusicBrainzUnavailableError extends Error {}

async function searchListeningMusicBrainzAlbumBatch(artists) {
  const cacheKey = JSON.stringify(artists.map((artist) => artist.name.trim().toLocaleLowerCase()).sort());
  const now = Date.now();
  const cached = listeningCatalogCache.get(cacheKey);
  let catalog;
  if (cached && now - cached.savedAt < 900000) {
    catalog = { ...cached.catalog, cached: true };
  } else {
    for (const [key, value] of listeningCatalogCache) {
      if (now - value.savedAt >= 900000) listeningCatalogCache.delete(key);
    }
    const terms = artists.map((artist) => `artist:${JSON.stringify(artist.name)}`);
    const query = `primarytype:album AND (${terms.join(" OR ")})`;
    catalog = await readMusicBrainzCatalog(async (offset, limit) => {
      const parameters = new URLSearchParams({
        query,
        fmt: "json",
        limit: String(limit),
        offset: String(offset),
      });
      try {
        return await retryMusicBrainzRequest(async () => {
          const delay = 1100 - (Date.now() - lastListeningCatalogRequestAt);
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
          lastListeningCatalogRequestAt = Date.now();
          const response = await fetch(`https://musicbrainz.org/ws/2/release-group?${parameters}`, {
            headers: { Accept: "application/json" },
            credentials: "omit",
            referrerPolicy: "no-referrer",
          });
          if (!response.ok) {
            const error = new Error(`MusicBrainz ha risposto con HTTP ${response.status}.`);
            error.status = response.status;
            throw error;
          }
          return response.json();
        }, (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
      } catch (error) {
        if (error instanceof TypeError || [429, 500, 502, 503, 504].includes(Number(error?.status))) {
          throw new ListeningMusicBrainzUnavailableError(
            error instanceof TypeError
              ? "connessione non riuscita dopo tre tentativi."
              : `${error.message} dopo tre tentativi.`,
          );
        }
        throw error;
      }
    });
    catalog.cached = false;
    listeningCatalogCache.set(cacheKey, { savedAt: now, catalog });
    if (listeningCatalogCache.size > 8) {
      const oldest = [...listeningCatalogCache.entries()]
        .reduce((previous, current) => current[1].savedAt < previous[1].savedAt ? current : previous);
      listeningCatalogCache.delete(oldest[0]);
    }
  }
  const candidates = new Map(artists.map((artist) => [artist.name.toLocaleLowerCase(), artist]));
  const albums = [];
  for (const group of catalog.groups) {
    if (group?.["primary-type"] !== "Album"
        || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(group.id || "")) continue;
    const credits = (group["artist-credit"] || []).flatMap((credit) => {
      if (typeof credit === "string") return [];
      const name = String(credit?.name || credit?.artist?.name || "").trim();
      const mbid = String(credit?.artist?.id || "");
      return name ? [{ name, mbid, joinphrase: credit?.joinphrase || "" }] : [];
    });
    const creditedNames = credits.map((credit) => credit.name);
    const matchedArtists = creditedNames.filter((name) => candidates.has(name.toLocaleLowerCase()));
    if (!matchedArtists.length) continue;
    const tags = group.tags || group.genres || [];
    const genres = tags.flatMap((tag) => {
      const name = String(typeof tag === "string" ? tag : tag?.name || "").trim();
      return name ? [name] : [];
    });
    albums.push({
      id: `mb:${group.id}`,
      sourceId: group.id,
      mbid: group.id,
      name: String(group.title || "").trim(),
      artist: credits.map((credit) => credit.name + credit.joinphrase).join(""),
      artist_names: creditedNames,
      artist_mbids: credits.map((credit) => credit.mbid),
      year: /^\d{4}/.test(group["first-release-date"] || "") ? group["first-release-date"].slice(0, 4) : "",
      genres,
      source: "MusicBrainz",
      sourceUrl: `https://musicbrainz.org/release-group/${group.id}`,
      reason: matchedArtists.map((name) => {
        const candidate = candidates.get(name.toLocaleLowerCase());
        return `${name}: affine a ${candidate.seeds.join(", ")}`;
      }).join("; "),
    });
  }
  return { albums, truncated: catalog.truncated, total: catalog.total, fetched: catalog.fetched,
    pages: catalog.pages, cached: catalog.cached };
}

class DiscogsSuggestionApiError extends Error {
  constructor(message, { stopQueue = false } = {}) {
    super(message);
    this.stopQueue = stopQueue;
  }
}
class DiscogsSuggestionBudgetError extends Error {}

function getDiscogsSuggestionCache() {
  if (discogsSuggestionCache) return discogsSuggestionCache;
  const empty = { version: 1, searches: {}, masters: {}, releases: {} };
  const serialized = localStorage.getItem(DISCOGS_SUGGESTION_CACHE_KEY);
  if (!serialized) {
    discogsSuggestionCache = empty;
    return discogsSuggestionCache;
  }
  try {
    const cached = JSON.parse(serialized);
    const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
    if (cached?.version === 1 && isRecord(cached.searches) && isRecord(cached.masters)
        && isRecord(cached.releases)) {
      discogsSuggestionCache = cached;
      return discogsSuggestionCache;
    }
    discogsSuggestionCacheWarning = "Cache Discogs con formato non valido; ricostruita durante la ricerca.";
  } catch (error) {
    discogsSuggestionCacheWarning = `Cache Discogs non leggibile: ${error.message}`;
  }
  discogsSuggestionCache = empty;
  return discogsSuggestionCache;
}

function saveDiscogsSuggestionCache() {
  localStorage.setItem(DISCOGS_SUGGESTION_CACHE_KEY, JSON.stringify(discogsSuggestionCache));
}

function recentDiscogsEntry(entry) {
  return entry && Number.isFinite(entry.savedAt) && entry.savedAt <= Date.now()
    && Date.now() - entry.savedAt < DISCOGS_SUGGESTION_CACHE_AGE;
}

async function discogsSuggestionRequest(path, parameters, state) {
  const queued = discogsApiRequestQueue.then(async () => {
    const request = async () => {
      if (state.requests >= DISCOGS_SUGGESTION_REQUEST_LIMIT) {
        throw new DiscogsSuggestionBudgetError("Raggiunto il limite di richieste Discogs per questa ricerca.");
      }
      const cooldownUntil = Number(localStorage.getItem(DISCOGS_COOLDOWN_KEY)) || 0;
      if (cooldownUntil > Date.now()) {
        throw new DiscogsSuggestionApiError(
          `Limite Discogs attivo; riprova tra ${Math.ceil((cooldownUntil - Date.now()) / 1000)} secondi.`,
          { stopQueue: true },
        );
      }
      const rateLimit = Number(localStorage.getItem(DISCOGS_RATE_LIMIT_KEY)) || 25;
      const interval = Math.ceil(60_000 / rateLimit * 1.1);
      const lastRequestAt = Number(localStorage.getItem(DISCOGS_REQUEST_AT_KEY)) || 0;
      const delay = interval - (Date.now() - lastRequestAt);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const currentCooldown = Number(localStorage.getItem(DISCOGS_COOLDOWN_KEY)) || 0;
      if (currentCooldown > Date.now()) {
        throw new DiscogsSuggestionApiError(
          `Limite Discogs attivo; riprova tra ${Math.ceil((currentCooldown - Date.now()) / 1000)} secondi.`,
          { stopQueue: true },
        );
      }
      state.beforeRead?.();
      localStorage.setItem(DISCOGS_REQUEST_AT_KEY, String(Date.now()));
      state.requests += 1;
      const url = new URL(path, DISCOGS_API);
      for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
      let response;
      try {
        response = await fetch(url, {
          headers: { Accept: "application/vnd.discogs.v2.discogs+json" },
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
      } catch (error) {
        if (error instanceof TypeError) {
          throw new DiscogsSuggestionApiError(`Discogs non raggiungibile: ${error.message}`, {
            stopQueue: shouldStopDiscogsSuggestionQueue(null),
          });
        }
        throw error;
      }
      const rawLimit = response.headers.get("X-Discogs-Ratelimit");
      const reportedLimit = rawLimit ? Number(rawLimit) : NaN;
      if (Number.isSafeInteger(reportedLimit) && reportedLimit > 0) {
        localStorage.setItem(DISCOGS_RATE_LIMIT_KEY, String(reportedLimit));
      }
      const rawRemaining = response.headers.get("X-Discogs-Ratelimit-Remaining");
      const reportedRemaining = rawRemaining ? Number(rawRemaining) : NaN;
      if (Number.isSafeInteger(reportedRemaining) && reportedRemaining === 0) {
        localStorage.setItem(DISCOGS_COOLDOWN_KEY, String(Date.now() + 60_000));
      }
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const retrySeconds = Number(retryAfter);
          const retryDate = Date.parse(retryAfter || "");
          const cooldown = Number.isFinite(retrySeconds) && retrySeconds > 0
            ? retrySeconds * 1000
            : Number.isFinite(retryDate) && retryDate > Date.now() ? retryDate - Date.now() : 60_000;
          localStorage.setItem(DISCOGS_COOLDOWN_KEY, String(Date.now() + cooldown));
        }
        throw new DiscogsSuggestionApiError(
          response.status === 429
            ? "Discogs ha raggiunto il limite di richieste."
            : `Discogs ha risposto con HTTP ${response.status}.`,
          { stopQueue: shouldStopDiscogsSuggestionQueue(response.status) },
        );
      }
      let data;
      try {
        data = await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new DiscogsSuggestionApiError("Risposta Discogs non leggibile.", { stopQueue: true });
        }
        throw error;
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new DiscogsSuggestionApiError("Risposta Discogs non valida.", { stopQueue: true });
      }
      return data;
    };
    if (navigator.locks?.request) return navigator.locks.request("accord-discogs-api", request);
    return request();
  });
  discogsApiRequestQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

function normalizeDiscogsTitle(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[\[(][^\])]*(?:deluxe|expanded|anniversary|reissue|remastered|remaster|edition|bonus|mono|stereo)[^\])]*[\])]/g, " ")
    .replace(/\s[-–—:]\s[^-–—:]*(?:deluxe|expanded|anniversary|reissue|remastered|remaster|edition|bonus|mono|stereo)[^-–—:]*$/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

async function findDiscogsSuggestionMaster(album, state, cache) {
  const artist = String(album.artist_names?.[0] || album.artist || "").trim();
  const queryKey = JSON.stringify([
    normalizeDiscogsTitle(artist),
    normalizeDiscogsTitle(album.name),
    String(album.year || ""),
  ]);
  const cached = cache.searches[queryKey];
  if (recentDiscogsEntry(cached)) {
    return cached.masterId === null || Number.isSafeInteger(cached.masterId) ? cached.masterId : null;
  }
  const parameters = new URLSearchParams({
    artist,
    release_title: album.name,
    type: "master",
    per_page: "20",
    sort: "have",
    sort_order: "desc",
  });
  const data = await discogsSuggestionRequest(`/database/search?${parameters}`, {}, state);
  if (!Array.isArray(data.results)) throw new DiscogsSuggestionApiError("Ricerca master Discogs senza risultati validi.");
  const artistKey = normalizeDiscogsTitle(artist);
  const albumKey = normalizeDiscogsTitle(album.name);
  const matches = data.results.flatMap((result) => {
    if (typeof result?.title !== "string") return [];
    let title = result.title;
    const separator = title.indexOf(" - ");
    if (separator > 0 && normalizeDiscogsTitle(title.slice(0, separator)) === artistKey) {
      title = title.slice(separator + 3);
    }
    if (normalizeDiscogsTitle(title) !== albumKey) return [];
    const id = Number(result.master_id || result.id);
    return Number.isSafeInteger(id) && id > 0 ? [{ id, year: String(result.year || "") }] : [];
  });
  const matchingYear = album.year ? matches.filter((match) => match.year === String(album.year)) : [];
  const candidates = matchingYear.length ? matchingYear : matches;
  const masterIds = [...new Set(candidates.map((match) => match.id))];
  const masterId = masterIds.length === 1 ? masterIds[0] : null;
  cache.searches[queryKey] = { savedAt: Date.now(), masterId };
  saveDiscogsSuggestionCache();
  return masterId;
}

async function readDiscogsSuggestionRating(masterId, state, cache) {
  const cacheKey = String(masterId);
  const cached = cache.masters[cacheKey];
  if (recentDiscogsEntry(cached) && cached.rating && typeof cached.rating === "object") return cached.rating;
  const versions = [];
  const seen = new Set();
  let page = 1;
  let pages = 1;
  let expectedPages = null;
  let total = null;
  while (page <= pages) {
    const data = await discogsSuggestionRequest(`/masters/${masterId}/versions`, {
      per_page: 100,
      page,
    }, state);
    const pagination = data.pagination;
    const rows = data.versions;
    const reportedPages = Number(pagination?.pages);
    if (!Number.isSafeInteger(reportedPages) || reportedPages < 1
        || !Array.isArray(rows) || rows.length > 100) {
      throw new DiscogsSuggestionApiError("Elenco edizioni Discogs non valido.");
    }
    if (expectedPages !== null && expectedPages !== reportedPages) {
      throw new DiscogsSuggestionApiError("Conteggio pagine Discogs instabile.");
    }
    expectedPages = reportedPages;
    pages = reportedPages;
    if (pages > DISCOGS_SUGGESTION_PAGES_LIMIT) {
      throw new DiscogsSuggestionApiError("Catalogo edizioni Discogs troppo ampio per il campione.");
    }
    const reportedItems = Number(pagination.items);
    if (Number.isSafeInteger(reportedItems) && reportedItems >= 0) {
      if (total !== null && total !== reportedItems) {
        throw new DiscogsSuggestionApiError("Conteggio edizioni Discogs instabile.");
      }
      total = reportedItems;
    }
    for (const version of rows) {
      const id = Number(version?.id);
      if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)) {
        throw new DiscogsSuggestionApiError("Edizioni Discogs mancanti o duplicate.");
      }
      seen.add(id);
      versions.push(version);
    }
    page += 1;
  }
  if (total !== null && seen.size !== total) {
    throw new DiscogsSuggestionApiError("Elenco edizioni Discogs incompleto.");
  }
  let selected;
  try {
    selected = topDiscogsVersions(versions, DISCOGS_SUGGESTION_SAMPLE_SIZE);
  } catch (error) {
    throw new DiscogsSuggestionApiError(error.message);
  }
  const ratings = new Map();
  for (const version of selected) {
    const releaseId = Number(version.id);
    const saved = cache.releases[String(releaseId)];
    let rating;
    if (recentDiscogsEntry(saved)) {
      rating = saved.rating;
    } else {
      const data = await discogsSuggestionRequest(`/releases/${releaseId}/rating`, {}, state);
      rating = data.rating;
      cache.releases[String(releaseId)] = { savedAt: Date.now(), rating };
      saveDiscogsSuggestionCache();
    }
    ratings.set(releaseId, rating);
  }
  let rating;
  try {
    rating = aggregateDiscogsEditionRatings(selected, ratings, DISCOGS_SUGGESTION_SAMPLE_SIZE);
  } catch (error) {
    throw new DiscogsSuggestionApiError(error.message);
  }
  rating.discogs_versions = total ?? versions.length;
  rating.discogs_master = masterId;
  rating.discogs_url = `https://www.discogs.com/master/${masterId}`;
  rating.discogs_complete = false;
  rating.discogs_updated = new Date().toISOString();
  cache.masters[cacheKey] = { savedAt: Date.now(), rating };
  saveDiscogsSuggestionCache();
  return rating;
}

async function rateDiscogsSuggestionCandidates(candidates, status = $("#suggestionStatus"), state = { requests: 0 }) {
  const cache = getDiscogsSuggestionCache();
  const ratings = new Map();
  const targets = [];
  const artistCounts = new Map();
  for (const album of candidates) {
    const artist = String(album.artist_names?.[0] || album.artist || "").trim().toLocaleLowerCase();
    const mbid = String(album.artist_mbids?.[0] || "").toLocaleLowerCase();
    const artistKey = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(mbid)
      ? `mbid:${mbid}` : `name:${artist}`;
    if ((artistCounts.get(artistKey) || 0) >= 2) continue;
    artistCounts.set(artistKey, (artistCounts.get(artistKey) || 0) + 1);
    targets.push(album);
  }
  let rated = 0;
  let attempted = 0;
  let failed = 0;
  let failureReason = "";
  let unmatched = 0;
  let limited = false;
  let unavailable = "";
  for (let index = 0; index < targets.length; index += 1) {
    const album = targets[index];
    attempted += 1;
    status.textContent =
      `Discogs · album ${index + 1}/${targets.length} · richieste ${state.requests}/${DISCOGS_SUGGESTION_REQUEST_LIMIT}…`;
    try {
      const masterId = await findDiscogsSuggestionMaster(album, state, cache);
      if (!masterId) {
        unmatched += 1;
        continue;
      }
      const rating = await readDiscogsSuggestionRating(masterId, state, cache);
      if (rating.discogs !== null && rating.discogs_votes >= 2) rated += 1;
      ratings.set(album.id, { ...album, ...rating });
    } catch (error) {
      if (error instanceof DiscogsSuggestionBudgetError) {
        limited = true;
        unavailable = error.message;
        break;
      }
      if (error instanceof DiscogsSuggestionApiError) {
        if (error.stopQueue) {
          unavailable = error.message;
          break;
        }
        failed += 1;
        failureReason ||= error.message;
        continue;
      }
      throw error;
    }
  }
  return {
    albums: candidates.map((album) => ratings.get(album.id) || album),
    rated,
    attempted,
    failed,
    failureReason,
    unmatched,
    candidates: targets.length,
    requests: state.requests,
    requestLimit: DISCOGS_SUGGESTION_REQUEST_LIMIT,
    limited,
    unavailable,
    cacheWarning: discogsSuggestionCacheWarning,
  };
}

async function suggestListeningAlbums(button) {
  button.disabled = true;
  $("#suggestionStatus").textContent = "Leggo gli ascolti Last.fm e preparo le proposte…";
  $("#suggestionAlbums").replaceChildren();
  suggestedSourceAlbums.clear();
  suggestedSpotifyCoverMatches.clear();
  suggestedSpotifyMatchCache.clear();
  suggestedMatchAlbumId = null;
  suggestionCoverFailureShown = false;
  try {
    const username = $("#lastfmSuggestionUser").value.trim();
    const period = $("#lastfmSuggestionDays").value;
    if (!/^[A-Za-z0-9_.\- ]{1,64}$/.test(username)) throw new Error("Inserisci un nome utente Last.fm valido.");
    const range = lastFmSuggestionRange(
      period, $("#lastfmSuggestionStart").value, $("#lastfmSuggestionEnd").value);
    const exclusionPeriod = $("#lastfmSuggestionExclusion").value;
    localStorage.setItem("accord-lastfm-suggestion-user", username);
    localStorage.setItem("accord-lastfm-suggestion-days", period);
    localStorage.setItem("accord-lastfm-suggestion-exclusion", exclusionPeriod);
    const useSyncedHistory = credentials().useSyncedLastFmHistory;
    const syncedArchive = useSyncedHistory ? await getCachedLastFmHistory(username) : null;
    if (useSyncedHistory && !syncedArchive) {
      throw new Error("Cronologia sincronizzata non trovata su questo dispositivo. Attiva l’opzione in Impostazioni e premi Sincronizza.");
    }
    const syncedTracks = syncedArchive
      ? await completeLastFmArchiveTracks(username, syncedArchive, Math.floor(Date.now() / 1000)) : null;
    const history = syncedArchive
      ? summarizeLastFmRange(syncedTracks, range)
      : await recentLastFmScrobbles(username, range);
    let exclusion;
    if (exclusionPeriod === "none") {
      exclusion = { names: [], lastfmCount: 0, partial: false };
    } else if (exclusionPeriod === "all") {
      const allTimeHeard = syncedArchive
        ? summarizeLastFmRange(syncedTracks, { from: null, to: Math.floor(Date.now() / 1000) })
        : await allTimeHeardArtistNames(username);
      exclusion = { ...allTimeHeard, partial: false };
    } else {
      const exclusionRange = lastFmSuggestionRange(exclusionPeriod);
      const windowHistory = period === exclusionPeriod ? history
        : syncedArchive
          ? summarizeLastFmRange(syncedTracks, exclusionRange)
          : await recentLastFmScrobbles(username, exclusionRange);
      exclusion = {
        names: windowHistory.artists.map((artist) => artist.name),
        lastfmCount: windowHistory.artists.length,
        partial: windowHistory.partial,
      };
    }
    const filters = {
      excludedArtists: suggestionFilterValues("#lastfmExcludeArtists"),
      includedGenres: suggestionFilterValues("#lastfmIncludeGenres"),
      excludedGenres: suggestionFilterValues("#lastfmExcludeGenres"),
      includedGenresMatch: $("#lastfmIncludeGenresMatch").value,
      excludedGenresMatch: $("#lastfmExcludeGenresMatch").value,
    };
    for (const [selector, key] of Object.entries(lastFmSuggestionPreferences)) {
      localStorage.setItem(key, $(selector).value.trim());
    }
    const excluded = new Set(filters.excludedArtists.map((value) => value.toLocaleLowerCase()));
    const seeds = history.artists.filter((artist) => !excluded.has(artist.name.toLocaleLowerCase()));
    if (!history.trackCount || !seeds.length) throw new Error("Nessun ascolto Last.fm utile nel periodo selezionato.");
    const expansion = await expandSimilarArtists(seeds,
      (seed) => similarLastFmArtists(seed.name, 30), {
        maximumArtists: 30,
        maximumSeeds: 30,
        initialSeedCount: 5,
        excludedNames: [...excluded, ...exclusion.names],
      });
    const candidates = filterUnheardArtists(expansion.artists, exclusion.names);
    if (!candidates.length) throw new Error("Last.fm non ha trovato artisti compatibili con i filtri di esclusione.");
    const rankings = [];
    for (const artist of candidates) {
      const data = await lastFmRequest({
        method: "artist.gettopalbums",
        artist: artist.name,
        autocorrect: "0",
        limit: "50",
      });
      let entries = data.topalbums?.album || [];
      if (!Array.isArray(entries)) entries = [entries];
      entries.forEach((entry, index) => {
        const name = String(entry?.name || "").trim();
        const playcount = Number(entry?.playcount);
        if (name) rankings.push({
          artist: artist.name,
          name,
          mbid: typeof entry?.mbid === "string" ? entry.mbid : "",
          playcount: Number.isFinite(playcount) && playcount > 0 ? playcount : entries.length - index,
        });
      });
    }
    let catalog;
    try {
      catalog = await searchListeningMusicBrainzAlbums(candidates);
    } catch (error) {
      if (!(error instanceof ListeningMusicBrainzUnavailableError)) throw error;
      catalog = {
        albums: [],
        truncated: true,
        total: null,
        fetched: 0,
        pages: 0,
        cached: false,
        unavailable: true,
        unavailableReason: error.message,
      };
    }
    const catalogAlbums = catalog.unavailable ? lastFmAlbumCatalog(rankings, candidates) : catalog.albums;
    const eligibleAlbums = filterListeningAlbumSuggestions(catalogAlbums, {
      knownAlbums: history.knownAlbums,
      collection: state.albums,
      heardArtists: exclusion.names,
      ...filters,
    });
    const albumCandidates = catalog.unavailable
      ? topListenedAlbums(eligibleAlbums, rankings, 2).map((album) => ({
        ...album,
        matchConfidence: "lastfm",
        matchReason: `Classifica album Last.fm: ${album.playcount} ascolti; MusicBrainz non disponibile.`,
      }))
      : listeningAlbumSuggestions(eligibleAlbums, rankings, candidates, 2);
    const discogsResult = await rateDiscogsSuggestionCandidates(albumCandidates);
    const albums = rankDiscogsSuggestionAlbums(discogsResult.albums);
    for (const album of albums) {
      if (album.discogs !== null && album.discogs_votes >= 2) {
        album.matchReason += ` Discogs: media ponderata ${album.discogs}/5 su ${album.discogs_votes} voti, `
          + `${album.discogs_sampled_versions}/${album.discogs_versions} edizioni campionate; `
          + "i voti delle edizioni non corrispondono a utenti unici.";
      } else {
        album.matchReason += album.matchConfidence === "related"
          ? " Discogs non disponibile con voti sufficienti; ripiego sul catalogo MusicBrainz dell'artista simile."
          : " Discogs non disponibile con voti sufficienti; ripiego sulla classifica Last.fm.";
      }
    }
    const candidateNames = new Set(candidates.map((artist) => artist.name.toLocaleLowerCase()));
    const suggestedArtistNames = new Set(albums.flatMap((album) =>
      (Array.isArray(album.artist_names) ? album.artist_names : [album.artist])
        .map((artist) => String(artist || "").trim().toLocaleLowerCase())
        .filter((artist) => candidateNames.has(artist))));
    const artistCount = suggestedArtistNames.size;
    renderListeningAlbumSuggestions(albums);
    const relatedNote = albums.some((album) => album.matchConfidence === "related")
      ? " · nessuna corrispondenza Last.fm: mostrate solo alternative correlate del catalogo MusicBrainz"
      : "";
    const coverage = history.partial ? " · campione parziale (massimo 1.000 ascolti)"
      : history.syncedArchive
        ? ` · archivio completo fino al ${new Date(syncedArchive.coverage[0][1] * 1000).toLocaleDateString()} + ascolti recenti Last.fm`
        : "";
    const catalogNote = catalog.unavailable
      ? `MusicBrainz non disponibile (${catalog.unavailableReason}); classifica Last.fm usata come ripiego`
      : `MusicBrainz ${catalog.pages} pagine${catalog.truncated
        ? ` · catalogo parziale: ${catalog.fetched} di ${catalog.total ?? "?"} risultati consultati`
        : ` · catalogo completo: ${catalog.fetched} risultati`}`
        + (catalog.cached ? " · catalogo riutilizzato dalla cache in memoria (15 min)" : "");
    const discogsNote = ` · Discogs ${discogsResult.rated}/${discogsResult.attempted} album con voti sufficienti `
      + `(${discogsResult.attempted}/${discogsResult.candidates} candidati esaminati; `
      + `${discogsResult.unmatched} senza master canonico; ${discogsResult.failed} errori per album; `
      + `campione massimo ${DISCOGS_SUGGESTION_SAMPLE_SIZE} edizioni, ${discogsResult.requests}/`
      + `${discogsResult.requestLimit} richieste)`;
    const discogsWarnings = [...new Set([
      discogsResult.limited ? "budget Discogs esaurito; ripiego su Last.fm per i restanti candidati" : "",
      discogsResult.unavailable,
      discogsResult.failed ? `Almeno un album saltato: ${discogsResult.failureReason}` : "",
      discogsResult.cacheWarning,
    ].filter(Boolean))];
    const exclusionLabels = { none: "nessuna", 30: "ultimi 30 giorni", 90: "ultimi 3 mesi", 365: "ultimi 365 giorni", all: "tutto lo storico" };
    const exclusionCoverage = exclusionPeriod === "none" ? "esclusione disattivata"
      : `esclusione ${exclusionLabels[exclusionPeriod]}: Last.fm ${exclusion.lastfmCount} artisti${exclusion.partial ? " (campione parziale, max 1.000 ascolti)" : ""}`;
    const artistCoverage = artistCount >= 10
      ? ` · obiettivo raggiunto: ${artistCount} artisti con un album ciascuno`
      : ` · trovati ${artistCount} artisti su ${candidates.length} candidati dopo aver esaminato ${expansion.seedsUsed} artisti di partenza${candidates.length === 30 ? " (limite di 30 candidati raggiunto)" : expansion.seedLimitReached ? " (limite di 30 seed raggiunto)" : expansion.exhausted ? " (seed disponibili esauriti)" : ""}`;
    $("#suggestionStatus").textContent = `${history.trackCount} ascolti nel periodo · ${expansion.seedsUsed} artisti di partenza · ${albums.length} album candidati${artistCoverage}${relatedNote}${coverage} · ${exclusionCoverage} · ${catalogNote} · ${discogsNote}${discogsWarnings.length ? ` · ${discogsWarnings.join("; ")}` : ""}.`;
  } catch (error) {
    $("#suggestionStatus").textContent = `Suggerimenti Last.fm non riusciti: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

function persistListeningSuggestionsForSpotifyReturn() {
  const albums = [...suggestedSourceAlbums.values()].map((album) => ({
    id: album.id,
    sourceId: album.sourceId,
    mbid: album.mbid,
    name: album.name,
    artist: album.artist,
    artist_names: album.artist_names,
    year: album.year,
    genres: album.genres,
    reason: album.reason,
    matchReason: album.matchReason,
    matchConfidence: album.matchConfidence,
  }));
  sessionStorage.setItem(SUGGESTION_RETURN_KEY, JSON.stringify(albums));
}

function restoreListeningSuggestionsForSpotifyReturn() {
  const serialized = sessionStorage.getItem(SUGGESTION_RETURN_KEY);
  if (!serialized) return;
  sessionStorage.removeItem(SUGGESTION_RETURN_KEY);
  let albums;
  try {
    albums = JSON.parse(serialized);
  } catch (error) {
    $("#suggestionStatus").textContent = `Suggerimenti non ripristinati: ${error.message}`;
    return;
  }
  const validId = (value) => typeof value === "string"
    && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
  const valid = Array.isArray(albums) && albums.length > 0 && albums.length <= 300
    && albums.every((album) => album && typeof album === "object"
      && validId(album.mbid) && album.id === `mb:${album.mbid}` && album.sourceId === album.mbid
      && typeof album.name === "string" && album.name.length <= 300
      && typeof album.artist === "string" && album.artist.length <= 500
      && typeof album.year === "string" && /^\d{0,4}$/.test(album.year)
      && Array.isArray(album.artist_names) && album.artist_names.length <= 20
      && album.artist_names.every((artist) => typeof artist === "string" && artist.length <= 200)
      && Array.isArray(album.genres) && album.genres.length <= 100
      && album.genres.every((genre) => typeof genre === "string" && genre.length <= 100)
      && typeof album.reason === "string" && album.reason.length <= 1000
      && typeof album.matchReason === "string" && album.matchReason.length <= 1000
      && ["high", "ambiguous", "related"].includes(album.matchConfidence));
  if (!valid) {
    $("#suggestionStatus").textContent = "Suggerimenti non ripristinati: dati temporanei non validi.";
    return;
  }
  renderListeningAlbumSuggestions(albums);
  activateViewTab($("#suggestionsTab"));
  $("#suggestionStatus").textContent = "Suggerimenti ripristinati; continuo l’abbinamento Spotify.";
}

function renderListeningAlbumSuggestions(albums) {
  rememberSuggestionResult("lastfm", albums);
  albums = albums.filter(suggestionNotSnoozed);
  const container = $("#suggestionAlbums");
  listeningSuggestionComparison?.destroy();
  listeningSuggestionComparison = null;
  container.replaceChildren();
  suggestionCoverObserver?.disconnect();
  for (const cover of suggestedCoverFrames.values()) {
    if (cover.objectUrl) URL.revokeObjectURL(cover.objectUrl);
  }
  suggestedCoverFrames.clear();
  suggestedSourceAlbums.clear();
  for (const album of albums) suggestedSourceAlbums.set(album.id, album);
  if (!albums.length) {
    const empty = document.createElement("p");
    empty.className = "suggestion-detail";
    empty.textContent = "Nessun album nuovo corrisponde a cronologia e filtri. I generi non disponibili non possono soddisfare un filtro genere incluso.";
    container.append(empty);
    return;
  }
  listeningSuggestionComparison = createAlbumComparisonToolbar(container, () => state.albums,
    $("#suggestionStatus"), "Last.fm");
  for (const album of albums) {
    const card = document.createElement("article");
    card.className = "suggestion-album";
    listeningSuggestionComparison.append(card, { ...album, source: album.source || "Last.fm" });
    appendSuggestionActions(card, album, () => renderListeningAlbumSuggestions(albums));
    const cover = createAlbumCoverFrame(album.name);
    const rememberedMatch = suggestedSpotifyCoverMatches.get(album.id);
    if (rememberedMatch) {
      cover.image.alt = `Copertina Spotify abbinata a ${album.name}`;
      setAlbumCover(cover, rememberedMatch.coverUrl);
    }
    suggestedCoverFrames.set(album.id, cover);
    const info = document.createElement("p");
    const name = document.createElement("strong");
    name.textContent = album.name;
    const detail = document.createElement("span");
    detail.className = "suggestion-detail";
    detail.textContent = ` · ${album.artist} · ${album.year || "Anno sconosciuto"}`;
    const matchDetail = document.createElement("span");
    matchDetail.className = "suggestion-detail suggestion-genres";
    matchDetail.textContent = album.matchConfidence === "related"
      ? "Alternativa correlata · non corrispondenza diretta Last.fm"
      : "";
    const genreDetail = document.createElement("span");
    genreDetail.className = "suggestion-detail suggestion-genres";
    const genres = primaryAlbumGenres(album.genres);
    genreDetail.textContent = `Generi: ${genres.join(", ") || "non disponibili"}`;
    card.title = [album.name, album.artist, album.year, genreDetail.textContent,
      album.reason, album.matchReason]
      .filter(Boolean).join("\n");
    info.append(name, detail);
    if (matchDetail.textContent) info.append(matchDetail);
    if (album.discogs !== null && album.discogs_votes >= 2) {
      const ratingDetail = document.createElement("span");
      ratingDetail.className = "suggestion-detail suggestion-genres";
      ratingDetail.textContent = `Discogs ${album.discogs}/5 · ${album.discogs_votes} voti · ${album.discogs_sampled_versions}/${album.discogs_versions} edizioni campionate`;
      info.append(ratingDetail);
    }
    info.append(genreDetail);
    const button = document.createElement("button");
    button.className = "secondary";
    button.type = "button";
    button.textContent = "Abbina a Spotify";
    button.dataset.suggestionAlbumId = album.id;
    button.addEventListener("click", () => {
      button.disabled = true;
      suggestedMatchAlbumId = album.id;
      $("#manualAlbumSource").value = "spotify";
      $("#manualAlbumQuery").value = album.name;
      $("#manualAlbumArtist").value = album.artist;
      $("#manualAlbumGenre").value = "";
      $("#manualAlbumYear").value = album.year;
      updateManualAlbumSourceNotice();
      $("#manualAlbumStatus").textContent = "";
      $("#manualAlbumResults").replaceChildren();
      $("#manualAlbumDialog").showModal();
      void resolveManualAlbumToSpotify(album).then((result) => {
        if (result && button.isConnected) {
          button.textContent = result.alreadyPresent ? "Già in raccolta" : "Aggiunto";
          button.disabled = true;
        } else if (button.isConnected) button.disabled = false;
      });
    });
    card.append(cover.frame, info, button);
    container.append(card);
    if (!rememberedMatch) {
      observeSuggestedCover(card, {
        album,
        card,
        cover,
        fallbackUrl: suggestedCoverFallback(album),
      });
    }
  }
}

const spotifyTimeRanges = new Set(["short_term", "medium_term", "long_term"]);
async function readSpotifyTopSnapshot(kind, timeRange, accessToken, budget, validate) {
  const parameters = new URLSearchParams({ limit: "50", time_range: timeRange });
  return validate(await spotifyRequest(`me/top/${kind}?${parameters}`, accessToken, budget));
}

function spotifySuggestionAlbumKey(artist, name) {
  const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return JSON.stringify([normalize(artist), normalize(name)]);
}

async function readSpotifyTopArtists(timeRange, accessToken, budget) {
  return readSpotifyTopSnapshot("artists", timeRange, accessToken, budget, validateSpotifyTopArtists);
}

function validateSpotifyTopArtists(response) {
  if (!Array.isArray(response?.items) || response.items.length > 50
      || response.items.some((artist) => !/^[A-Za-z0-9]{22}$/.test(artist?.id || "")
        || typeof artist.name !== "string" || !artist.name.trim())) {
    throw new Error("Spotify non ha restituito una classifica artisti verificabile.");
  }
  if (!response.items.length) throw new Error("Spotify non ha trovato artisti nel periodo selezionato.");
  return response.items;
}

async function readSpotifyTopTracks(timeRange, accessToken, budget) {
  return readSpotifyTopSnapshot("tracks", timeRange, accessToken, budget, validateSpotifyTopTracks);
}

function validateSpotifyTopTracks(response) {
  if (!Array.isArray(response?.items) || response.items.length > 50
      || response.items.some((track) => !/^[A-Za-z0-9]{22}$/.test(track?.id || "")
        || !track.name?.trim() || !track.album?.id || !track.album?.name)) {
    throw new Error("Spotify non ha restituito una classifica brani verificabile.");
  }
  return response.items;
}

async function resolveSimilarSpotifyArtists(discovery, seedIds, seedNames, excluded, genreAllowed, accessToken, budget, maximum, viaTracks = false) {
  const candidates = discovery.candidates ||= new Map();
  const processed = discovery.processedArtistIds ||= new Set();
  const resolved = [];
  while (resolved.length < maximum && discovery.similarQueue.length) {
    const entry = discovery.similarQueue[0];
    const key = entry.name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    if (excluded.has(key) || seedNames.has(key)) {
      discovery.similarQueue.shift();
      continue;
    }
    let response;
    try {
      // The candidate stays queued until Spotify answers, so a limit or budget stop resumes it.
      // Without required genres, one track search resolves the artist and supplies its albums.
      response = viaTracks
        ? await spotifySearchRequest(new URLSearchParams({
          q: `artist:${JSON.stringify(entry.name)}`, type: "track", limit: "10" }), accessToken, budget)
        : await spotifyRequest(`search?${new URLSearchParams({
          q: `artist:${JSON.stringify(entry.name)}`, type: "artist", limit: "5" })}`, accessToken, budget);
    } catch (error) {
      if (resolved.length) break;
      throw error;
    }
    discovery.similarQueue.shift();
    const tracks = viaTracks && Array.isArray(response?.tracks?.items) ? response.tracks.items : null;
    const items = Array.isArray(response?.artists?.items) ? response.artists.items : [];
    const artist = tracks ? resolveArtistFromTracks(tracks, entry.name) : items.find((item) => /^[A-Za-z0-9]{22}$/.test(item?.id || "")
      && typeof item.name === "string" && item.name.trim().replace(/\s+/g, " ").toLocaleLowerCase() === key);
    if (!artist || seedIds.has(artist.id) || processed.has(artist.id) || candidates.has(artist.id)) continue;
    const genres = (Array.isArray(artist.genres) ? artist.genres : [])
      .filter((genre) => typeof genre === "string" && genre.trim()).map((genre) => genre.trim());
    if (!genreAllowed(genres)) continue;
    const candidate = {
      id: artist.id, name: artist.name.trim(),
      popularity: Number.isInteger(artist.popularity) ? artist.popularity : 0,
      genres, sharedGenres: new Set(), similarTo: entry.seeds, similarityScore: entry.score,
      ...(tracks ? { prefetchedTracks: tracks } : {}),
    };
    candidates.set(artist.id, candidate);
    resolved.push(candidate);
  }
  discovery.availableArtistIds = resolved.map((artist) => artist.id);
  return resolved.map((artist) => ({ ...artist, sharedGenres: [] }));
}

async function findSpotifySimilarArtists(seeds, excludedNames, customExcluded, filters, accessToken, budget, maximum = 10, discovery = {}) {
  const seedIds = new Set(seeds.map((artist) => artist.id));
  const seedNames = new Set(seeds.map((artist) => artist.name.trim().toLocaleLowerCase()));
  const excluded = new Set([...excludedNames, ...customExcluded]
    .map((name) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase()).filter(Boolean));
  const include = filters.includedGenres.map((value) => value.toLocaleLowerCase());
  const exclude = filters.excludedGenres.map((value) => value.toLocaleLowerCase());
  const matches = (genre, terms, mode) => mode === "contains"
    ? terms.some((term) => genre.toLocaleLowerCase().includes(term))
    : terms.includes(genre.toLocaleLowerCase());
  const genreAllowed = (values) => (!include.length || values.some((genre) =>
    matches(genre, include, filters.includedGenresMatch)))
    && !values.some((genre) => matches(genre, exclude, filters.excludedGenresMatch));
  if (!discovery.similarQueue) {
    if (localStorage.getItem(LASTFM_KEY)) {
      const references = (discovery.references || seeds).map((artist, index) => ({
        name: artist.name, weight: Number(artist.weight) || 50 - index }));
      const { queue, note } = await buildSimilarityQueue(
        references, (name) => similarLastFmArtists(name), [...excluded, ...seedNames]);
      discovery.similarQueue = queue;
      discovery.similarityNote = note;
      discovery.similarityCandidates = queue.length;
    } else {
      discovery.similarQueue = [];
      discovery.similarityNote = "Last.fm non configurato: candidati cercati solo per genere.";
      discovery.similarityCandidates = 0;
    }
  }
  if (discovery.similarQueue.length) {
    const resolved = await resolveSimilarSpotifyArtists(
      discovery, seedIds, seedNames, excluded, genreAllowed, accessToken, budget, maximum, !include.length);
    if (resolved.length || discovery.similarQueue.length) return resolved;
  }
  const genres = [...new Set(seeds.flatMap((artist) =>
    (Array.isArray(artist.genres) ? artist.genres : [])
      .filter((genre) => typeof genre === "string" && genre.trim())
      .map((genre) => genre.trim())))].slice(0, 6);
  if (!genres.length) {
    if (discovery.similarityCandidates) return [];
    throw new Error("Spotify non fornisce generi per gli artisti ascoltati; non è possibile trovare proposte affidabili.");
  }
  const candidates = discovery.candidates ||= new Map();
  const pages = discovery.genrePages ||= genres.map((genre) => ({ genre, offset: 0, exhausted: false }));
  const processed = discovery.processedArtistIds ||= new Set();
  const pending = discovery.availableArtistIds?.some((id) => !processed.has(id));
  const start = discovery.genreCursor || 0;
  for (let step = 0; !pending && step < pages.length; step += 1) {
    const index = (start + step) % pages.length;
    const page = pages[index];
    if (page.exhausted) {
      discovery.genreCursor = (index + 1) % pages.length;
      continue;
    }
    const { genre } = page;
    const parameters = new URLSearchParams({
      q: `genre:${JSON.stringify(genre)}`,
      type: "artist",
      limit: "10",
      offset: String(page.offset),
    });
    const response = await spotifyRequest(`search?${parameters}`, accessToken, budget);
    if (!Array.isArray(response?.artists?.items) || response.artists.items.length > 10
        || (response.artists.offset !== undefined && Number(response.artists.offset) !== page.offset)) {
      throw new Error("Spotify non ha restituito artisti verificabili per un genere.");
    }
    for (const artist of response.artists.items) {
      if (!/^[A-Za-z0-9]{22}$/.test(artist?.id || "")
          || typeof artist.name !== "string" || !artist.name.trim()) continue;
      const name = artist.name.trim();
      const normalizedName = name.replace(/\s+/g, " ").toLocaleLowerCase();
      if (seedIds.has(artist.id) || seedNames.has(normalizedName) || excluded.has(normalizedName)) continue;
      const candidate = candidates.get(artist.id) || {
        id: artist.id,
        name,
        popularity: Number.isInteger(artist.popularity) ? artist.popularity : 0,
        genres: [],
        sharedGenres: new Set(),
      };
      for (const value of [...(Array.isArray(artist.genres) ? artist.genres : []), genre]) {
        if (typeof value === "string" && value.trim()
            && !candidate.genres.some((entry) => entry.toLocaleLowerCase() === value.trim().toLocaleLowerCase())) {
          candidate.genres.push(value.trim());
        }
      }
      candidate.sharedGenres.add(genre);
      candidates.set(artist.id, candidate);
    }
    page.offset += response.artists.items.length;
    page.exhausted = !response.artists.next || !response.artists.items.length || page.offset >= 50;
    discovery.genreCursor = (index + 1) % pages.length;
  }
  const ranked = [...candidates.values()]
    .filter((artist) => !processed.has(artist.id) && artist.sharedGenres.size && genreAllowed(artist.genres))
    .sort((left, right) => right.sharedGenres.size - left.sharedGenres.size
      || right.popularity - left.popularity || left.name.localeCompare(right.name));
  discovery.availableArtistIds = ranked.map((artist) => artist.id);
  return ranked.slice(0, maximum).map((artist) => ({ ...artist, sharedGenres: [...artist.sharedGenres] }));
}

async function spotifyAlbumsForArtist(artist, accessToken, budget) {
  // A 10-track sample is one Spotify request (search pages hold at most 10 items).
  const parameters = new URLSearchParams({
    q: `artist:${JSON.stringify(artist.name)}`,
    type: "track",
    limit: "10",
  });
  const response = Array.isArray(artist.prefetchedTracks)
    ? { tracks: { items: artist.prefetchedTracks } }
    : await spotifySearchRequest(parameters, accessToken, budget);
  if (!Array.isArray(response?.tracks?.items)) {
    throw new Error(`Spotify non ha restituito i brani per ${artist.name}.`);
  }
  const albums = new Map();
  for (const track of response.tracks.items) {
    if (!Array.isArray(track?.artists) || !track.artists.some((entry) => entry?.id === artist.id)
        || !track.album || track.album.album_type !== "album") continue;
    if (track.popularity !== undefined && track.popularity !== null
        && (!Number.isInteger(track.popularity) || track.popularity < 0 || track.popularity > 100)) {
      throw new Error(`Spotify ha restituito una popolarità non valida per ${artist.name}.`);
    }
    const album = track.album;
    const current = albums.get(album.id) || { album, score: 0, count: 0, tracks: [] };
    current.score += track.popularity || 0;
    current.count += 1;
    current.tracks.push(track);
    albums.set(album.id, current);
  }
  const ranked = [...albums.values()]
    .sort((left, right) => right.score / right.count - left.score / left.count
      || right.count - left.count || String(right.album.release_date || "").localeCompare(left.album.release_date || ""))
    .slice(0, 2);
  return ranked.flatMap(({ album, score, count, tracks }) => {
    const [record] = playlistAlbumRecords([{ item: { type: "track", album } }]);
    if (!record) return [];
    const artistNames = (Array.isArray(album.artists) ? album.artists : [])
      .map((entry) => entry.name).filter((name) => typeof name === "string" && name.trim());
    return [{
      ...record,
      artist_names: artistNames,
      genres: artist.genres,
      spotifyPopularity: Math.round(score / count),
      spotifyTrackSample: count,
      spotifyRelatedArtist: artist.name,
      spotifySimilarTo: Array.isArray(artist.similarTo) ? artist.similarTo : [],
      spotifyArtistId: artist.id,
      spotifyTracks: tracks,
      coverUrl: album.images?.[0]?.url || "",
    }];
  });
}

function spotifyDiscoveryFilters() {
  return {
    excludedArtists: suggestionFilterValues("#spotifyExcludeArtists"),
    includedGenres: suggestionFilterValues("#spotifyIncludeGenres"),
    excludedGenres: suggestionFilterValues("#spotifyExcludeGenres"),
    includedGenresMatch: $("#spotifyIncludeGenresMatch").value,
    excludedGenresMatch: $("#spotifyExcludeGenresMatch").value,
  };
}

async function buildSpotifyAlbumSuggestions(request, accessToken, status, {
  maximum = 10, continuation = null, excludeCollectionAlbums = true, playlistRequest = null, readBudget = null,
} = {}) {
  if (!request || !spotifyTimeRanges.has(request.period)
      || !["none", ...spotifyTimeRanges].includes(request.exclusion)) {
    throw new Error("Periodo Spotify non valido.");
  }
  const budget = readBudget || createSpotifyReadBudget();
  let discovery = continuation;
  if (!discovery) {
    const topArtists = await readSpotifyTopArtists(request.period, accessToken, budget);
    const excludedNames = request.exclusion === "none" ? []
      : request.exclusion === request.period ? topArtists.map((artist) => artist.name)
        : (await readSpotifyTopArtists(request.exclusion, accessToken, budget)).map((artist) => artist.name);
    const topTracks = await readSpotifyTopTracks(request.period, accessToken, budget);
    const filters = spotifyDiscoveryFilters();
    const customExcluded = new Set(filters.excludedArtists.map((value) => value.toLocaleLowerCase()));
    const references = topArtists.filter((artist) => !customExcluded.has(artist.name.toLocaleLowerCase()))
      .map((artist, index) => ({ ...artist, weight: 50 - index }));
    const seeds = references.slice(0, 5);
    if (!seeds.length) throw new Error("Nessun artista Spotify di partenza corrisponde ai filtri.");
    const knownAlbums = new Set();
    for (const track of topTracks) {
      const albumArtists = (Array.isArray(track.album.artists) ? track.album.artists : [])
        .map((artist) => artist?.name).filter((name) => typeof name === "string" && name.trim());
      for (const artist of albumArtists) {
        knownAlbums.add(spotifySuggestionAlbumKey(artist, track.album.name));
      }
    }
    discovery = { artists: [], albums: [], nextArtist: 0, knownAlbums, seeds, references: references.slice(0, 12),
      excludedNames, filters, seedCount: seeds.length, trackCount: topTracks.length,
      candidates: new Map(), processedArtistIds: new Set(), genrePages: null };
  }
  const { knownAlbums, excludedNames, filters } = discovery;
  let partialReason = "";
  let discogs;
  let selected = [];
  let targetReached = false;
  const discogsBudget = { requests: 0 };
  while (true) {
    if (discovery.nextArtist >= discovery.artists.length) {
      try {
        discovery.artists = await findSpotifySimilarArtists(
          discovery.seeds, excludedNames, filters.excludedArtists, filters, accessToken,
          budget, maximum, discovery);
        discovery.nextArtist = 0;
      } catch (error) {
        partialReason = error.message;
      }
    }
    if (!partialReason) {
      const progress = await collectSpotifyDiscoveryAlbums(discovery, async (artist) => {
        status.textContent = `Spotify · artista ${discovery.nextArtist + 1}/${discovery.artists.length} · ${artist.name}…`;
        const albums = await spotifyAlbumsForArtist(artist, accessToken, budget);
        discovery.processedArtistIds.add(artist.id);
        return albums;
      });
      partialReason = progress.partialReason;
    }
    const eligible = filterListeningAlbumSuggestions(discovery.albums, {
      knownAlbums,
      collection: excludeCollectionAlbums ? state.albums : [],
      heardArtists: excludedNames,
      excludedArtists: filters.excludedArtists,
      includedGenres: filters.includedGenres,
      excludedGenres: filters.excludedGenres,
      includedGenresMatch: filters.includedGenresMatch,
      excludedGenresMatch: filters.excludedGenresMatch,
    });
    discogs = await rateDiscogsSuggestionCandidates(eligible, status, discogsBudget);
    selected = rankDiscogsSuggestionAlbums(discogs.albums);
    const validCount = playlistRequest
      ? spotifyDiscoveryPlaylistPreview(selected, playlistRequest).artists.length : selected.length;
    targetReached = validCount >= (playlistRequest?.artistCount || maximum);
    if (partialReason || targetReached) break;
    if (!discovery.genrePages?.some((page) => !page.exhausted) && !discovery.similarQueue?.length
        && !discovery.availableArtistIds?.some((id) => !discovery.processedArtistIds.has(id))) break;
  }
  const hasMore = !targetReached && Boolean(partialReason) && (
    discovery.nextArtist < discovery.artists.length
    || discovery.similarQueue?.length
    || !discovery.genrePages
    || discovery.genrePages.some((page) => !page.exhausted)
    || discovery.availableArtistIds?.some((id) => !discovery.processedArtistIds.has(id)));
  return {
    albums: selected,
    seedCount: discovery.seedCount,
    similarArtistCount: discovery.candidates.size,
    similarityCandidates: discovery.similarityCandidates || 0,
    similarityNote: discovery.similarityNote || "",
    candidateCount: discovery.albums.length,
    trackCount: discovery.trackCount,
    exclusionCount: excludedNames.length,
    discogs,
    continuation: hasMore ? discovery : null,
    partialReason,
    reads: { logical: budget.logical, actual: budget.actual },
  };
}

function renderSpotifyAlbumSuggestions(albums) {
  rememberSuggestionResult("spotify", albums);
  albums = albums.filter(suggestionNotSnoozed);
  const container = $("#spotifySuggestionAlbums");
  spotifySuggestionComparison?.destroy();
  spotifySuggestionComparison = null;
  container.replaceChildren();
  if (albums.length) {
    spotifySuggestionComparison = createAlbumComparisonToolbar(container, () => state.albums,
      $("#spotifySuggestionStatus"), "Spotify");
  }
  for (const album of albums) {
    const card = document.createElement("article");
    card.className = "suggestion-album";
    spotifySuggestionComparison.append(card, { ...album, source: album.source || "Spotify" });
    appendSuggestionActions(card, album, () => renderSpotifyAlbumSuggestions(albums));
    if (typeof album.coverUrl === "string" && album.coverUrl.startsWith("https://i.scdn.co/image/")) {
      const cover = createAlbumCoverFrame(album.name);
      setAlbumCover(cover, album.coverUrl);
      card.append(cover.frame);
    }
    const info = document.createElement("p");
    const name = document.createElement("strong");
    name.textContent = album.name;
    const detail = document.createElement("span");
    detail.className = "suggestion-detail";
    detail.textContent = ` · ${album.artist} · ${album.year || "Anno sconosciuto"}`;
    const genres = document.createElement("span");
    genres.className = "suggestion-detail suggestion-genres";
    genres.textContent = `Generi Spotify: ${primaryAlbumGenres(album.genres).join(", ") || "non disponibili"}`;
    const popularity = document.createElement("span");
    popularity.className = "suggestion-detail";
    popularity.textContent = `Popolarità brani Spotify ${album.spotifyPopularity}/100 · ${album.spotifyTrackSample} brani campionati`;
    info.append(name, detail, genres, popularity);
    if (album.discogs !== null && album.discogs_votes >= 2) {
      const rating = document.createElement("span");
      rating.className = "suggestion-detail suggestion-genres";
      rating.textContent = `Discogs ${album.discogs}/5 · ${album.discogs_votes} voti`;
      info.append(rating);
    }
    const button = document.createElement("button");
    button.className = "secondary";
    button.type = "button";
    button.textContent = "Aggiungi alla raccolta";
    button.addEventListener("click", () => {
      try {
        button.textContent = addAlbumToCollection(album) ? "Aggiunto" : "Già in raccolta";
        button.disabled = true;
      } catch (error) {
        $("#spotifySuggestionStatus").textContent = `Album non aggiunto: ${error.message}`;
      }
    });
    card.append(info, button);
    container.append(card);
  }
  if (!albums.length) {
    const empty = document.createElement("p");
    empty.className = "suggestion-detail";
    empty.textContent = "Nessun album nuovo corrisponde a cronologia e filtri. I generi non disponibili non possono soddisfare un filtro incluso.";
    container.append(empty);
  }
}

async function loadSpotifyAlbumSuggestions(request, accessToken) {
  const status = $("#spotifySuggestionStatus");
  const container = $("#spotifySuggestionAlbums");
  container.replaceChildren();
  status.textContent = "Leggo le classifiche Spotify e preparo i suggerimenti…";
  const result = await buildSpotifyAlbumSuggestions(request, accessToken, status);
  renderSpotifyAlbumSuggestions(result.albums);
  const visibleCount = result.albums.filter(suggestionNotSnoozed).length;
  const { discogs } = result;
  status.textContent = `Spotify · ${result.trackCount} brani campionati · ${result.seedCount} artisti di partenza · `
    + `${result.similarArtistCount} artisti simili`
    + (result.similarityCandidates ? ` (grafo Last.fm: ${result.similarityCandidates})` : " (per genere)")
    + ` · ${visibleCount}/${result.candidateCount} album nuovi visibili`
    + (visibleCount < result.albums.length ? ` · ${result.albums.length - visibleCount} rimandati localmente` : "")
    + (result.similarityNote ? ` · ${result.similarityNote}` : "")
    + (result.exclusionCount ? ` · ${result.exclusionCount} artisti esclusi` : "")
    + ` · Discogs ${discogs.rated}/${discogs.attempted} album valutati`
    + (discogs.limited ? " · budget Discogs raggiunto" : "")
    + (discogs.unavailable ? ` · ${discogs.unavailable}` : "")
    + (result.partialReason ? ` · Risultati parziali: ${result.partialReason}` : "");
}

async function suggestSpotifyAlbums(button) {
  button.disabled = true;
  const request = {
    period: $("#spotifySuggestionPeriod").value,
    exclusion: $("#spotifySuggestionExclusion").value,
  };
  $("#spotifySuggestionStatus").textContent = "Preparo i suggerimenti Spotify…";
  $("#spotifySuggestionAlbums").replaceChildren();
  localStorage.setItem("accord-spotify-suggestion-period", request.period);
  localStorage.setItem("accord-spotify-suggestion-exclusion", request.exclusion);
  for (const [selector, key] of Object.entries(spotifySuggestionPreferences)) {
    localStorage.setItem(key, $(selector).value.trim());
  }
  try {
    const token = await spotifyAccessToken();
    if (!token || sessionStorage.getItem("accord-spotify-top-artists-authorized") !== "1") {
      const { clientId, redirectUri } = spotifySettings();
      if (!clientId || !redirectUri) {
        openSettings();
        showMessage("Configura Spotify", "Per suggerire album, configura il Client ID e il Redirect URI Spotify.");
        return;
      }
      await startSpotifyAuthorization(JSON.stringify(request), "spotify-album-suggestions");
      return;
    }
    await loadSpotifyAlbumSuggestions(request, token);
  } catch (error) {
    $("#spotifySuggestionStatus").textContent = `Suggerimenti Spotify non riusciti: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function loadTopArtistPlaylistPreview(request, accessToken) {
  const { artistCount, tracksPerArtist } = request;
  if (!Number.isInteger(artistCount) || artistCount < 1 || artistCount > 50
      || !Number.isInteger(tracksPerArtist) || tracksPerArtist < 1 || tracksPerArtist > 10) {
    throw new Error("Scegli da 1 a 50 artisti e da 1 a 10 brani per artista.");
  }
  // Stessi input di Suggerimenti Spotify, così le due schede restano coerenti.
  const suggestionRequest = {
    period: $("#spotifySuggestionPeriod").value,
    exclusion: $("#spotifySuggestionExclusion").value,
  };
  const readBudget = createSpotifyReadBudget();
  const account = await spotifyPlaylistIdentity(readBudget);
  const key = await fingerprint([account, request, suggestionRequest, spotifyDiscoveryFilters(), state.albums]);
  playlistCheckpointContext = { identity: account, criteria: await spotifyPlaylistCriteria() };
  const continuation = playlistDiscoveryContinuation?.key === key
    ? playlistDiscoveryContinuation.discovery : null;
  if (!continuation) playlistHistorical = false;
  const result = await buildSpotifyAlbumSuggestions(
    suggestionRequest, accessToken, $("#playlistBuilderStatus"), {
      maximum: Math.max(10, artistCount), continuation,
      playlistRequest: request,
      readBudget,
    });
  playlistDiscoveryContinuation = result.continuation ? { key, discovery: result.continuation } : null;
  const basePreview = spotifyDiscoveryPlaylistPreview(result.albums, request);
  const preview = {
    ...basePreview,
    sourceAlbums: result.albums,
    partialReason: [result.partialReason, result.discogs.unavailable,
      result.discogs.limited ? "budget Discogs raggiunto" : ""].filter(Boolean).join(" · "),
    hasMore: Boolean(result.continuation),
    requestedArtists: artistCount,
    reads: result.reads,
  };
  saveSpotifyPlaylistCheckpoint(preview);
  return preview;
}

function chooseCollectionEdition(album) {
  const provider = musicService.service, epoch = musicService.epoch;
  const selected = (edition) => {
    try {
      musicService.assert(provider, epoch);
      if (!state.albums.some((row) => row.id === album.id && row.artist === album.artist && row.name === album.name)) throw new Error("Album locale cambiato.");
      if (!confirm(`Associare ${album.artist} · ${album.name} a ${edition.artist} · ${edition.name}? Solo apertura nel servizio; nessun album unito o voto trasferito.`)) return;
      setEditionLink(localStorage, album, provider, edition);
      selectMusicView("collection"); render();
      showFeedback("Edizione associata sul dispositivo. Album e voti invariati.");
    } catch (error) { showFeedback(error.message, true); }
  };
  (provider === "tidal" ? tidalUI : qobuzUI).openCatalog(`${album.artist} ${album.name}`, selected);
}

async function spotifyPlaylistIdentity(budget = null) {
  const token = sessionStorage.getItem("accord-spotify-refresh-token") || sessionStorage.getItem("accord-spotify-access-token");
  if (!token) throw new Error("Collega Spotify prima di riprendere l'anteprima.");
  const epoch = musicService.epoch, session = await fingerprint([spotifySettings().clientId, token]);
  musicService.assert("spotify", epoch);
  if (spotifyPlaylistAccount?.session === session) return spotifyPlaylistAccount.identity;
  const access = await spotifyAccessToken();
  const profile = await spotifyRequest("me", access, budget);
  musicService.assert("spotify", epoch);
  if (!profile?.id || typeof profile.id !== "string") throw new Error("Account Spotify non verificabile.");
  const identity = await fingerprint([spotifySettings().clientId, profile.id]);
  spotifyPlaylistAccount = { session, identity };
  return identity;
}
async function spotifyPlaylistCriteria() {
  return fingerprint(spotifyPlaylistCriteriaValues());
}
function spotifyPlaylistCriteriaValues() {
  return [$("#playlistArtistCount").value, $("#playlistTracksPerArtist").value,
    $("#spotifySuggestionPeriod").value, $("#spotifySuggestionExclusion").value, spotifyDiscoveryFilters(), state.albums];
}
function saveSpotifyPlaylistCheckpoint(preview = topArtistPlaylistPreview) {
  if (!preview || !playlistCheckpointContext) return;
  saveCheckpoint(localStorage, "spotify", playlistCheckpointContext.identity, playlistCheckpointContext.criteria,
    { artists: $("#playlistArtistCount").value, tracks: $("#playlistTracksPerArtist").value, name: $("#playlistBuilderName").value,
      period: $("#spotifySuggestionPeriod").value, exclusion: $("#spotifySuggestionExclusion").value,
      filters: Object.fromEntries(Object.keys(spotifySuggestionPreferences).map((selector) => [selector, $(selector).value])) },
    preview, playlistDiscoveryContinuation);
}

function renderTopArtistPlaylistPreview(preview) {
  const native = musicService.service !== "spotify";
  const container = $("#playlistBuilderPreview");
  container.replaceChildren();
  const stats = playlistPreviewStatistics(preview.tracks.map((track) => native ? {
    ...track, duration_ms: track.duration_ms || (track.duration > 0 ? track.duration * 1000 : undefined),
    artists: track.artists || (track.artist ? [{ name: track.artist }] : []),
  } : track),
    (preview.sourceAlbums || []).flatMap((album) => album.spotifyTracks || []));
  const summary = document.createElement("p");
  summary.className = "notice";
  summary.textContent = `Durata stimata: ${stats.timed ? `~${Math.round(stats.duration / 60000)} min su ${stats.timed}/${stats.total} brani` : "sconosciuta"}${
    stats.timed < stats.total ? " (totale sconosciuto)" : ""} · Artisti unici: ${
    stats.artistRows ? stats.uniqueArtists : "sconosciuti"}${
    stats.artistRows < stats.total && stats.artistRows ? " (dati parziali)" : ""} · Ripetizioni: ${
    stats.identified === stats.total ? stats.repeats : "sconosciute"} · Brani già noti: ${
    stats.classified ? `${stats.known}/${stats.classified} classificati (${Math.round(stats.known / stats.classified * 100)}%)` : "sconosciuti"}${
    stats.classified < stats.total ? `; ${stats.total - stats.classified} non classificati` : ""}. Solo dati disponibili, nessuna richiesta aggiuntiva.`;
  container.append(summary);
  for (const artist of preview.artists) {
    const group = document.createElement("details");
    group.className = "playlist-artist-preview";
    group.open = true;
    const heading = document.createElement("summary");
    heading.textContent = `${artist.name} · ${artist.tracks} brani`;
    group.append(heading);
    for (const track of preview.tracks.filter((entry) => entry.sourceArtistId === artist.id)) {
      const card = document.createElement("article");
      card.className = "playlist-track-card";
      const title = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = track.name;
      title.append(strong);
      const detail = document.createElement("p");
      detail.className = "suggestion-detail";
      detail.textContent = track.artist;
      card.append(title, detail);
      group.append(card);
    }
    container.append(group);
  }
  $("#playlistBuilderStatus").textContent =
    `Anteprima: ${preview.artists.length}/${preview.requestedArtists} artisti · ${preview.tracks.length} brani. `
    + (musicService.service === "tidal" ? "Playlist non in elenco (NON privata)." : "La playlist sarà privata.")
    + (preview.partialReason ? ` Risultati parziali: ${preview.partialReason}` : "")
    + (preview.hasMore ? " Premi Continua anteprima per un altro passaggio manuale." : " Nessun altro candidato nel campione; il numero richiesto non è garantito.")
    + (native ? " Primi brani verificati in ordine album, non classifiche native. Nessun ripiego sugli artisti ascoltati."
      : " Sono applicati i filtri di Suggerimenti Spotify; nessun ripiego sugli artisti ascoltati.");
  if (!native && playlistHistorical) $("#playlistBuilderStatus").textContent += " Include risultati storici conservati, non riletti oggi.";
  $("#playlistPreviewButton").textContent = preview.hasMore ? "Continua anteprima" : "Genera anteprima";
  $("#playlistCreateButton").disabled = !preview.tracks.length;
}

async function createTopArtistPlaylist(name, preview, accessToken) {
  const serviceEpoch = musicService.epoch;
  const criteria = JSON.stringify(spotifyPlaylistCriteriaValues());
  const account = sessionStorage.getItem("accord-spotify-refresh-token") || sessionStorage.getItem("accord-spotify-access-token");
  const guard = () => {
    musicService.assert("spotify", serviceEpoch);
    if (criteria !== JSON.stringify(spotifyPlaylistCriteriaValues())
        || account !== (sessionStorage.getItem("accord-spotify-refresh-token") || sessionStorage.getItem("accord-spotify-access-token"))) {
      throw new Error("Account o criteri cambiati: nessun nuovo invio; verifica l'esito nell'app.");
    }
  };
  guard();
  if (!commandGuard.acquire("playlist-write")) throw new Error("Creazione playlist già in corso. Nessuna seconda scrittura avviata.");
  try {
  if (!navigator.locks?.request) throw new Error("Browser senza blocco scritture sicuro: creazione non disponibile.");
  return await navigator.locks.request("accord-playlist-write-spotify-v1", async () => {
  if (!name || name.length > 100 || !preview || !Array.isArray(preview.tracks)
      || !preview.tracks.length || preview.tracks.length > 500) {
    throw new Error("Nome o anteprima playlist non validi.");
  }
  const uris = preview.tracks.map((track) => {
    const match = typeof track?.uri === "string" ? track.uri.match(/^spotify:track:([A-Za-z0-9]{22})$/) : null;
    if (!match) throw new Error("L'anteprima contiene un brano Spotify non verificabile.");
    return track.uri;
  });
  if (new Set(uris).size !== uris.length) throw new Error("L'anteprima contiene brani duplicati; generala di nuovo.");
  if (localStorage.getItem(spotifyPlaylistUncertainKey)) throw new Error("Verifica l'esito precedente nell'app Spotify; nessun nuovo invio.");
  guard();
  if (pauseRemaining(localStorage, "spotify")) throw new Error("Pausa attiva: nessuna scrittura avviata.");
  localStorage.setItem(spotifyPlaylistUncertainKey, "pending");
  const playlist = await spotifyWriteRequest("me/playlists", accessToken, {
    name,
    description: "Creata da Accord · artisti e album nuovi da Suggerimenti Spotify",
    public: false,
  });
  if (!/^[A-Za-z0-9]{22}$/.test(playlist?.id || "")) {
    throw new Error("Spotify non ha restituito una playlist verificabile.");
  }
  try {
    guard();
    await writeSpotifyPlaylistItems(playlist.id, uris,
      (path, body) => { guard(); return spotifyWriteRequest(path, accessToken, body); });
  } catch (error) {
    const url = playlist.external_urls?.spotify;
    throw new Error(`Playlist creata ma aggiunta dei brani incompleta: ${error.message}`
      + (url ? ` Apri la playlist e verifica i brani: ${url}` : ` ID playlist: ${playlist.id}`));
  }
  localStorage.removeItem(spotifyPlaylistUncertainKey);
  clearCheckpoint(localStorage, "spotify");
  return { playlist, tracks: uris.length };
  });
  } finally { commandGuard.release("playlist-write"); }
}

function setPlaylistBuilderBusy(busy) {
  $("#playlistArtistCount").disabled = busy;
  $("#playlistTracksPerArtist").disabled = busy;
  $("#playlistBuilderName").disabled = busy;
  $("#playlistPreviewButton").disabled = busy;
  $("#playlistCreateButton").disabled = busy || !topArtistPlaylistPreview?.tracks.length || Boolean(localStorage.getItem(spotifyPlaylistUncertainKey));
}

async function beginPlaylistBuilderPreview() {
  if (musicService.service !== "spotify") { await catalogPlaylistUI.run(); return; }
  const serviceEpoch = musicService.epoch;
  if (!commandGuard.acquire("playlist-builder")) { showFeedback("Operazione playlist già in corso"); return; }
  topArtistPlaylistPreview = null;
  $("#playlistBuilderPreview").replaceChildren();
  setPlaylistBuilderBusy(true);
  $("#playlistBuilderStatus").textContent = "Carico gli artisti e preparo l'anteprima...";
  try {
    const request = {
      artistCount: Number($("#playlistArtistCount").value),
      tracksPerArtist: Number($("#playlistTracksPerArtist").value),
    };
    const token = await spotifyAccessToken();
    musicService.assert("spotify", serviceEpoch);
    if (!token || sessionStorage.getItem("accord-spotify-playlist-builder-authorized") !== "1") {
      await startSpotifyAuthorization(JSON.stringify(request), "playlist-builder");
      return;
    }
    const preview = await loadTopArtistPlaylistPreview(request, token);
    musicService.assert("spotify", serviceEpoch);
    topArtistPlaylistPreview = preview;
    renderTopArtistPlaylistPreview(topArtistPlaylistPreview);
  } catch (error) {
    if (musicService.service === "spotify" && musicService.epoch === serviceEpoch) {
      $("#playlistBuilderStatus").textContent = `Anteprima non riuscita: ${error.message}`;
    }
  } finally {
    setPlaylistBuilderBusy(false);
    commandGuard.release("playlist-builder");
    catalogPlaylistUI?.configure();
  }
}

async function beginPlaylistBuilderCreation() {
  if (musicService.service !== "spotify") { await catalogPlaylistUI.create(); return; }
  const serviceEpoch = musicService.epoch;
  if (!topArtistPlaylistPreview) return;
  const name = $("#playlistBuilderName").value.trim();
  if (!name || name.length > 100) {
    $("#playlistBuilderStatus").textContent = "Inserisci un nome playlist (massimo 100 caratteri).";
    return;
  }
  if (localStorage.getItem(spotifyPlaylistUncertainKey)) {
    $("#playlistBuilderStatus").textContent = "Verifica l'esito precedente nell'app Spotify. Nessun nuovo invio.";
    return;
  }
  if (playlistCheckpointContext && (playlistCheckpointContext.identity !== await spotifyPlaylistIdentity()
      || playlistCheckpointContext.criteria !== await spotifyPlaylistCriteria())) {
    $("#playlistBuilderStatus").textContent = "Account o criteri cambiati: genera una nuova anteprima.";
    return;
  }
  if (!confirm(`Creare «${name}» privata con ${topArtistPlaylistPreview.tracks.length} brani?`
      + (playlistHistorical ? " Risultati storici conservati, non riletti oggi: confermi l'uso?" : ""))) return;
  if (!commandGuard.acquire("playlist-builder")) { showFeedback("Operazione playlist già in corso · nessuna seconda scrittura"); return; }
  const preview = topArtistPlaylistPreview;
  setPlaylistBuilderBusy(true);
  $("#playlistBuilderStatus").textContent = "Creo la playlist privata e aggiungo i brani...";
  try {
    const token = await spotifyAccessToken();
    musicService.assert("spotify", serviceEpoch);
    if (!token || sessionStorage.getItem("accord-spotify-playlist-builder-authorized") !== "1") {
      await startSpotifyAuthorization(JSON.stringify({ name, preview }), "playlist-create");
      return;
    }
    topArtistPlaylistPreview = null;
    saveSpotifyPlaylistCheckpoint(preview);
    const result = await createTopArtistPlaylist(name, preview, token);
    musicService.assert("spotify", serviceEpoch);
    $("#playlistBuilderStatus").textContent =
      `Playlist privata creata: ${result.playlist.name || name} · ${result.tracks} brani.`;
    showMessage("Playlist Spotify creata",
      `${result.playlist.name || name}: ${result.tracks} brani aggiunti. La playlist è privata.`
      + (result.playlist.external_urls?.spotify ? ` ${result.playlist.external_urls.spotify}` : ""));
  } catch (error) {
    topArtistPlaylistPreview = null;
    if (musicService.service !== "spotify" || musicService.epoch !== serviceEpoch) return;
    $("#playlistBuilderStatus").textContent = `Creazione non completata: ${safeDiagnostics(error.message)}. Prima di un nuovo invio verifica le playlist in Spotify: l'esito potrebbe essere parziale. Nessun tentativo automatico. Prepara una nuova anteprima solo dopo la verifica.`;
    showMessage("Rivedi esito playlist Spotify", $("#playlistBuilderStatus").textContent);
  } finally {
    setPlaylistBuilderBusy(false);
    commandGuard.release("playlist-builder");
    catalogPlaylistUI?.configure();
  }
}

async function searchMusicBrainzAlbums(filters) {
  const terms = [];
  if (filters.album) terms.push(`releasegroup:${JSON.stringify(filters.album)}`);
  if (filters.artist) terms.push(`artist:${JSON.stringify(filters.artist)}`);
  if (filters.genre) terms.push(`tag:${JSON.stringify(filters.genre)}`);
  if (filters.year) {
    const [first, last = first] = filters.year.split("-");
    terms.push(`firstreleasedate:[${first} TO ${last}]`);
  }
  const parameters = new URLSearchParams({ query: terms.join(" AND "), fmt: "json", limit: "25" });
  const response = await fetch(`https://musicbrainz.org/ws/2/release-group?${parameters}`, {
    headers: { Accept: "application/json" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error(`MusicBrainz ha risposto con HTTP ${response.status}.`);
  const data = await response.json();
  if (!Array.isArray(data["release-groups"])) throw new Error("Risposta MusicBrainz senza risultati verificabili.");
  return data["release-groups"].flatMap((group) => {
    if (group?.["primary-type"] !== "Album" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(group.id || "")) return [];
    const artist = (group["artist-credit"] || []).map((credit) => {
      if (typeof credit === "string") return credit;
      return `${credit?.name || credit?.artist?.name || ""}${credit?.joinphrase || ""}`;
    }).join("").trim();
    const year = /^\d{4}/.test(group["first-release-date"] || "")
      ? group["first-release-date"].slice(0, 4) : "";
    const album = { name: group.title || "", artist, year };
    if (!album.name || !artist || !albumMatchesManualFilters(album, filters)) return [];
    return [{
      ...album,
      source: "MusicBrainz",
      sourceId: group.id,
      sourceUrl: `https://musicbrainz.org/release-group/${group.id}`,
    }];
  });
}

async function searchManualAlbums(input = manualAlbumSearchInput(), accessToken = null) {
  const filters = typeof input === "string"
    ? { ...manualAlbumSearchInput(), album: input.trim() }
    : { ...input };
  const button = $("#manualAlbumSearchButton");
  button.disabled = true;
  suggestedMatchAlbumId = null;
  $("#manualAlbumStatus").textContent = `Ricerca su ${filters.provider || "Last.fm"} in corso…`;
  $("#manualAlbumResults").replaceChildren();
  try {
    validateManualAlbumFilters(filters);
    let albums;
    if (filters.provider === "lastfm") albums = await searchLastFmAlbums(filters);
    else if (filters.provider === "musicbrainz") albums = await searchMusicBrainzAlbums(filters);
    else {
      const token = accessToken || await spotifyAccessToken();
      if (!token) {
        const { clientId, redirectUri } = spotifySettings();
        if (!clientId || !redirectUri) {
          openSettings();
          $("#manualAlbumStatus").textContent = "Configura Client ID e Redirect URI Spotify nelle impostazioni, poi riprova.";
          return;
        }
        await startSpotifyAuthorization(JSON.stringify(filters), "manual-search");
        return;
      }
      albums = await fetchSpotifyManualAlbums(filters, token);
    }
    renderManualAlbumResults(albums);
    $("#manualAlbumStatus").textContent = albums.length
      ? `${albums.length} ${filters.provider === "spotify" ? "release" : "album"} trovati. ${
        filters.provider === "spotify" ? "Scegli un risultato da aggiungere." : "Seleziona un risultato e abbinalo a Spotify."}`
      : `Nessun ${filters.provider === "spotify" ? "album, singolo o EP verificabile" : "album"} trovato su ${
        filters.provider === "lastfm" ? "Last.fm" : filters.provider === "musicbrainz" ? "MusicBrainz" : "Spotify"}.`;
  } catch (error) {
    $("#manualAlbumStatus").textContent = `Ricerca non riuscita: ${error.message}`;
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function resolveManualAlbumToSpotify(album, accessToken = null) {
  try {
    const token = accessToken || await spotifyAccessToken();
    if (!token) {
      const { clientId, redirectUri } = spotifySettings();
      if (!clientId || !redirectUri) {
        openSettings();
        $("#manualAlbumStatus").textContent = "Configura Spotify nelle impostazioni per abbinare questo album.";
        return;
      }
      await startSpotifyAuthorization(JSON.stringify({
        action: "match",
        album,
        input: manualAlbumSearchInput(),
      }), "manual-search");
      return;
    }
    $("#manualAlbumStatus").textContent = "Verifico una corrispondenza con una singola ricerca Spotify…";
    const fromSuggestions = suggestedSourceAlbums.has(album.id);
    const matches = fromSuggestions
      ? await suggestedSpotifyMatches(album, token)
      : await fetchSpotifyManualAlbums({
        provider: "spotify", album: album.name, artist: album.artist, genre: "", year: "",
      }, token);
    if (fromSuggestions) applyBestSpotifySuggestionCover(album, matches);
    if (matches.length === 1 && album.matchConfidence !== "ambiguous") {
      const match = matches[0];
      const alreadyPresent = state.albums.some((existing) => existing.id === match.id);
      if (!alreadyPresent) addAlbumToCollection(match);
      $("#manualAlbumResults").replaceChildren();
      $("#manualAlbumStatus").textContent = alreadyPresent
        ? `${match.name} è già nella raccolta.`
        : `${match.name} trovato senza ambiguità e aggiunto localmente. Sincronizza GitHub per inviarlo.`;
      if ($("#manualAlbumDialog").open) $("#manualAlbumDialog").close();
      return { alreadyPresent };
    }
    suggestedMatchAlbumId = suggestedSourceAlbums.has(album.id) ? album.id : null;
    renderManualAlbumResults(matches);
    $("#manualAlbumStatus").textContent = matches.length
      ? album.matchConfidence === "ambiguous"
        ? `Il catalogo non distingue con certezza l’edizione. Verifica anno e artista, poi conferma con “Aggiungi”.`
        : `${matches.length} corrispondenze Spotify. Scegli l’edizione corretta da aggiungere.`
      : "Spotify non ha trovato un album verificabile corrispondente.";
    return null;
  } catch (error) {
    $("#manualAlbumStatus").textContent = `Abbinamento Spotify non riuscito: ${error.message}`;
  }
}

function updateManualAlbumSourceNotice() {
  const provider = $("#manualAlbumSource").value;
  $("#manualAlbumGenre").disabled = provider === "spotify";
  $("#manualAlbumYear").disabled = provider === "lastfm";
  $("#manualAlbumSourceNotice").textContent = provider === "lastfm"
    ? "Last.fm è predefinito e usa una richiesta per titolo, artista o genere. Il filtro anno non è disponibile."
    : provider === "musicbrainz"
      ? "MusicBrainz cerca per titolo, artista, tag/genere e anno con una richiesta al catalogo."
      : "Spotify esegue una sola ricerca per titolo, artista e anno; i risultati possono includere singoli / EP. "
        + "Per evitare richieste aggiuntive il filtro genere è disattivato.";
}

async function loadSuggestedAlbums(artistName, trigger = null, accessToken = null) {
  if (trigger) trigger.disabled = true;
  try {
    const token = accessToken || await spotifyAccessToken();
    if (!token) {
      const { clientId, redirectUri } = spotifySettings();
      if (!clientId || !redirectUri) {
        openSettings();
        showMessage("Configura Spotify", "Per esplorare gli album dei suggerimenti, configura il Client ID Spotify e il Redirect URI registrato.");
        return;
      }
      await startSpotifyAuthorization(artistName, "albums");
      return;
    }
    const query = new URLSearchParams({ q: `artist:"${artistName}"`, type: "album", limit: "50" });
    const response = await spotifySearchRequest(query, token);
    if (!Array.isArray(response.albums?.items)) throw new Error("Risposta Spotify senza album verificabili.");
    const exact = response.albums.items.filter((album) => Array.isArray(album?.artists)
      && album.artists.some((value) => value.name?.trim().toLocaleLowerCase() === artistName.trim().toLocaleLowerCase()));
    const rankedExact = [...exact].sort((left, right) =>
      (Number(right.popularity) || 0) - (Number(left.popularity) || 0));
    const albums = playlistAlbumRecords(rankedExact.map((album) => ({ item: { type: "track", album } })))
      .filter((album) => !state.albums.some((existing) => existing.id === album.id))
      .slice(0, 3);
    suggestedSourceAlbums.clear();
    const container = $("#suggestionAlbums");
    const heading = document.createElement("h3");
    heading.textContent = `Album di ${artistName}`;
    container.replaceChildren(heading);
    if (!albums.length) {
      const empty = document.createElement("p");
      empty.className = "suggestion-detail";
      empty.textContent = "Nessun nuovo album verificabile trovato su Spotify.";
      container.append(empty);
      return;
    }
    for (const album of albums) {
      const card = document.createElement("article");
      card.className = "suggestion-album";
      const info = document.createElement("p");
      const name = document.createElement("strong");
      name.textContent = album.name;
      const detail = document.createElement("span");
      detail.className = "suggestion-detail";
      detail.textContent = ` · ${album.artist} · ${album.year || "Anno sconosciuto"}`;
      const genreDetail = document.createElement("span");
      genreDetail.className = "suggestion-detail suggestion-genres";
      const genres = primaryAlbumGenres(album.genres);
      genreDetail.textContent = `Generi: ${genres.join(", ") || "non disponibili"}`;
      info.append(name, detail, genreDetail);
      const button = document.createElement("button");
      button.className = "secondary";
      button.type = "button";
      button.textContent = "Aggiungi";
      button.addEventListener("click", () => {
        try {
          if (addAlbumToCollection(album)) {
            button.textContent = "Aggiunto";
            button.disabled = true;
            button.setAttribute("aria-label", `${album.name} aggiunto alla raccolta`);
          }
        } catch (error) {
          showMessage("Album non aggiunto", error.message);
        }
      });
      card.append(info, button);
      container.append(card);
    }
  } catch (error) {
    $("#suggestionStatus").textContent = `Esplorazione album non riuscita: ${error.message}`;
  } finally {
    if (trigger?.isConnected) trigger.disabled = false;
  }
}

$("#playlistPreviewButton").addEventListener("click", () => void beginPlaylistBuilderPreview());
$("#playlistCreateButton").addEventListener("click", () => void beginPlaylistBuilderCreation());

function setCoverNotice(message) {
  const notice = $("#coverSyncNotice");
  notice.hidden = !message;
  notice.textContent = message;
}

function loadCollectionQol() {
  const empty = { views: {}, drafts: {}, history: [], snoozes: {}, changedAt: {}, lastSync: "", lastSyncSummary: null };
  try {
    const saved = JSON.parse(localStorage.getItem(QOL_KEY) || "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Formato non valido");
    for (const key of ["views", "drafts", "snoozes", "changedAt"]) {
      if (saved[key] && (typeof saved[key] !== "object" || Array.isArray(saved[key]))) throw new Error(`Campo ${key} non valido`);
    }
    if (saved.history && !Array.isArray(saved.history)) throw new Error("Cronologia non valida");
    if (saved.lastSyncSummary !== undefined && saved.lastSyncSummary !== null
      && (typeof saved.lastSyncSummary !== "object" || Array.isArray(saved.lastSyncSummary)
        || ["toGitHub", "toDevice", "unchanged", "conflictsResolved"].some((key) =>
          !Number.isSafeInteger(saved.lastSyncSummary[key]) || saved.lastSyncSummary[key] < 0))) {
      throw new Error("Riepilogo sincronizzazione non valido");
    }
    if (saved.history?.some((entry) => !entry || !["spotify", "lastfm"].includes(entry.kind)
      || !Array.isArray(entry.albums) || entry.albums.some((album) =>
        !album || typeof album.id !== "string" || typeof album.name !== "string"
        || typeof album.artist !== "string" || !Array.isArray(album.genres)))) throw new Error("Risultati precedenti non validi");
    if (Object.values(saved.views || {}).some((view) => !view || typeof view !== "object"
      || Array.isArray(view))) throw new Error("Viste salvate non valide");
    if (Object.values(saved.drafts || {}).some((draft) => !draft || typeof draft !== "object"
      || Array.isArray(draft))) throw new Error("Bozze non valide");
    return { ...empty, ...saved };
  } catch (error) {
    queueMicrotask(() => showMessage("Preferenze locali non leggibili", error.message));
    return { ...empty, loadError: error.message };
  }
}

function saveCollectionQol(next) {
  try {
    if (qol.loadError) throw new Error(`Preferenze precedenti non sovrascritte: ${qol.loadError}`);
    localStorage.setItem(QOL_KEY, JSON.stringify(next));
    Object.assign(qol, next);
    refreshDraftIndicators();
    $("#qolStorageError").hidden = true;
    return true;
  } catch (error) {
    $("#qolStorageError").textContent = `Preferenze o bozze non salvate: ${error.message}`;
    $("#qolStorageError").hidden = false;
    showFeedback(`Preferenze o bozza non salvate: ${error.message}`, true);
    return false;
  }
}

function rememberLocalChanges(ids) {
  const changedAt = { ...qol.changedAt };
  for (const id of ids) changedAt[id] = new Date().toISOString();
  saveCollectionQol({ ...qol, changedAt });
}

function updateLocalSyncSummary() {
  const lastSync = qol.lastSync ? new Date(qol.lastSync).toLocaleString() : "mai su questo dispositivo";
  const summary = qol.lastSyncSummary;
  const detail = summary ? ` · ${formatSyncSummary(summary)}` : "";
  let persistence;
  try {
    const saved = localCollectionStatus(localStorage, STORAGE_KEY, state, normalizeLocalAlbums);
    if (!saved.unsaved && !state.loadError) {
      localSaveError = "";
      persistedCollectionIdentity = JSON.stringify([normalizeLocalAlbums(state.albums), normalizeLocalAlbums(state.base)]);
    }
    persistence = saved.unsaved || localSaveError
      ? `Modifiche non salvate nel browser${localSaveError ? `: ${localSaveError}` : ""}`
      : saved.exists ? "Raccolta salvata nel browser" : "Raccolta vuota: nessun salvataggio ancora";
    persistence += ` · ${saved.pending} album salvati non ancora sincronizzati`;
    if (!saved.pending) persistence += " (nessuna differenza musicale dalla base locale; non verifica il remoto)";
  } catch (error) {
    localSaveError = error.message;
    persistence = `Salvataggio locale non verificabile: ${error.message}`;
  }
  $("#localSyncSummary").textContent = `${persistence} · ${
    navigator.onLine ? "Rete rilevata, servizi non verificati" : "Offline: modifiche locali disponibili"
  } · ${githubAvailability} · ultimo successo: ${lastSync}${detail}`;
}

function changesText(changes, technical = false) {
  const labels = { name: "Album", artist: "Artista", url: "Collegamento", year: "Anno",
    status: "Stato", rating: "Il tuo voto", genres: "Generi", primary_genre: "Genere principale",
    collections: "Collezioni", tags: "Tag", notes: "Note", genre_source: "Origine dei generi" };
  const states = { queued: "Da ascoltare", listening: "In ascolto", liked: "Piaciuto",
    neutral: "Neutro", disliked: "Non piaciuto", manual: "Scelti da te" };
  const value = (field, input) => input == null || input === "" ? "Non impostato"
    : Array.isArray(input) ? input.join(", ") || "Nessuno"
      : ["status", "genre_source"].includes(field) ? states[input] || "Dati del servizio" : String(input);
  return changes.map((change) => {
    const album = change.after || change.before;
    if (!technical) {
      const kind = { updated: "Modificato", added: "Aggiunto", removed: "Rimosso" }[change.kind] || "Modificato";
      return `${kind}: ${album.artist} - ${album.name}` + (change.kind === "updated"
        ? "\n" + change.fields.filter((field) => labels[field] || field === "cover_sha256").map((field) =>
          field === "cover_sha256" ? "  Copertina: aggiornata" : `  ${labels[field]}: ${
            value(field, change.before[field])} → ${value(field, change.after[field])}`).join("\n") : "");
    }
    const values = change.kind === "updated" ? change.fields.map((field) =>
      `  ${field}: ${JSON.stringify(change.before[field])} -> ${JSON.stringify(change.after[field])}`).join("\n") : "";
    return `${change.kind} | ${album.artist} - ${album.name} | ${change.fields.join(", ")}${values ? `\n${values}` : ""}`;
  }).join("\n");
}

function confirmSyncChanges(outgoing, incoming, albums) {
  const dialog = document.createElement("dialog");
  const heading = document.createElement("h2");
  heading.textContent = "Anteprima sincronizzazione";
  const details = document.createElement("pre");
  details.className = "qol-details";
  const changedIds = new Set([...outgoing, ...incoming].map((change) => change.id));
  details.textContent = `Verso GitHub: ${outgoing.length}\n${changesText(outgoing)}\n\nVerso questo dispositivo: ${
    incoming.length}\n${changesText(incoming)}\n\nInvariati: ${albums.filter((album) =>
      !changedIds.has(album.id)).length}. Nessuna scrittura ancora eseguita.`;
  const accept = document.createElement("button");
  accept.textContent = "Sincronizza queste modifiche";
  const cancel = document.createElement("button");
  cancel.textContent = "Annulla";
  dialog.append(heading, details, accept, cancel);
  document.body.append(dialog);
  return new Promise((resolve) => {
    accept.addEventListener("click", () => dialog.close("accept"));
    cancel.addEventListener("click", () => dialog.close("cancel"));
    dialog.addEventListener("close", () => {
      const accepted = dialog.returnValue === "accept";
      dialog.remove();
      resolve(accepted);
    }, { once: true });
    dialog.showModal();
  });
}

function saveAlbumDraft(key, fields) {
  return saveCollectionQol({ ...qol, drafts: { ...qol.drafts, [key]: fields } });
}

function clearAlbumDraft(key) {
  const drafts = { ...qol.drafts };
  delete drafts[key];
  return saveCollectionQol({ ...qol, drafts });
}

const manualDraftSelectors = ["#manualAlbumSource", "#manualAlbumQuery", "#manualAlbumArtist",
  "#manualAlbumGenre", "#manualAlbumYear"];
function restoreManualAlbumDraft() {
  const draft = qol.drafts.manual;
  if (!draft) return;
  for (const selector of manualDraftSelectors) if (typeof draft[selector] === "string") $(selector).value = draft[selector];
  showFeedback("Bozza di ricerca ripristinata. Premi Cerca per avviare richieste online.");
}

function restoreDetailsDraft(id) {
  const draft = qol.drafts[`edit:${id}`];
  if (!draft) return;
  for (const selector of detailsDraftSelectors) {
    const value = draft[selector];
    const field = $("#albumDetailsFields").querySelector(selector);
    if (field && typeof value === "string") field.value = value;
  }
  showFeedback("Bozza album ripristinata. Premi Salva per applicarla.");
}

function refreshDraftIndicators() {
  $("#draftListButton").textContent = `Bozze locali (${Object.keys(qol.drafts).length})`;
  for (const card of $("#albumList").children) {
    const indicator = card.querySelector(".draft-indicator");
    if (indicator) indicator.hidden = !qol.drafts[`edit:${card.dataset.albumId}`];
  }
}

function openDraftList() {
  const dialog = document.createElement("dialog");
  const title = document.createElement("h2");
  title.textContent = "Bozze solo su questo dispositivo";
  dialog.setAttribute("aria-label", title.textContent);
  const list = document.createElement("div");
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Chiudi";
  close.addEventListener("click", () => dialog.close());
  const renderDrafts = () => {
    list.replaceChildren();
    for (const key of Object.keys(qol.drafts)) {
      const album = key.startsWith("edit:") ? state.albums.find((record) => record.id === key.slice(5)) : null;
      const row = document.createElement("div");
      row.className = "qol-actions";
      const caption = document.createElement("span");
      caption.textContent = key === "manual" ? "Ricerca album non completata"
        : album ? `${album.artist} · ${album.name}` : `Album non più presente (${key})`;
      const resume = document.createElement("button");
      resume.type = "button";
      resume.textContent = "Riprendi";
      resume.disabled = key !== "manual" && !album;
      resume.addEventListener("click", () => {
        dialog.close();
        if (key === "manual") $("#manualAlbumButton").click();
        else { activateViewTab($("#collectionTab")); openAlbumDetails(album.id, $("#draftListButton")); }
      });
      const discard = document.createElement("button");
      discard.type = "button";
      discard.textContent = "Scarta…";
      discard.addEventListener("click", () => {
        if (!window.confirm(`Scartare definitivamente la bozza "${caption.textContent}"? L'album salvato non cambia.`)) return;
        if (clearAlbumDraft(key)) renderDrafts();
      });
      row.append(caption, resume, discard);
      list.append(row);
    }
    if (!list.children.length) list.textContent = "Nessuna bozza locale.";
  };
  dialog.append(title, list, close);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  renderDrafts();
  dialog.showModal();
}

function suggestionNotSnoozed(album) {
  return !(Number(qol.snoozes[suggestionIdentity(album)]) > Date.now());
}
suggestionNotSnoozed.reason = (album) => Number(qol.snoozes[suggestionIdentity(album)]) > Date.now()
  ? "Rinviato" : "";

let replayingSuggestions = false;
function rememberSuggestionResult(kind, albums) {
  if (replayingSuggestions || !albums.length) return;
  const records = JSON.parse(JSON.stringify(albums));
  const signature = JSON.stringify([kind, records]);
  const history = qol.history.filter((entry) => JSON.stringify([entry.kind, entry.albums]) !== signature);
  history.unshift({ kind, at: new Date().toISOString(), albums: records });
  if (saveCollectionQol({ ...qol, history: history.slice(0, 5) })) refreshSuggestionHistory();
}

function refreshSuggestionHistory() {
  const select = $("#suggestionHistory");
  select.replaceChildren(new Option("Scegli risultato locale", ""));
  qol.history.forEach((entry, index) => select.add(new Option(
    `${entry.kind} · ${new Date(entry.at).toLocaleString()} · ${entry.albums.length} album`, String(index))));
}

function appendSuggestionActions(card, album, rerender) {
  const actions = document.createElement("div");
  actions.className = "qol-actions";
  const why = document.createElement("button");
  why.type = "button";
  why.textContent = "Perche' questo album?";
  why.addEventListener("click", () => showMessage("Origine del suggerimento", suggestionWhy(album)));
  const snooze = document.createElement("button");
  snooze.type = "button";
  snooze.textContent = "Non adesso · 30 giorni";
  snooze.addEventListener("click", () => {
    if (!saveCollectionQol({ ...qol, snoozes: {
      ...qol.snoozes, [suggestionIdentity(album)]: Date.now() + 30 * 86400000,
    } })) return;
    replayingSuggestions = true;
    try { rerender(); } finally { replayingSuggestions = false; }
    showFeedback("Suggerimento nascosto per 30 giorni, non escluso definitivamente.");
  });
  actions.append(why, snooze);
  card.append(actions);
}

const collectionViewSelectors = ["#searchInput", "#primaryGenreFilter", "#secondaryGenreFilter",
  "#statusFilter", "#collectionFilter", "#tagFilter", "#serviceFilter", "#sortOrder", "#smartCollectionList", "#collectionLayout"];
function refreshSavedCollectionViews() {
  const select = $("#savedCollectionView");
  select.replaceChildren(new Option("Scegli vista", ""));
  for (const name of Object.keys(qol.views).sort()) select.add(new Option(name, name));
}

function pickLocalAlbum() {
  const dialog = document.createElement("dialog");
  const heading = document.createElement("h2");
  heading.textContent = "Cosa ascolto adesso?";
  const status = document.createElement("select");
  status.setAttribute("aria-label", "Stato da cui estrarre");
  for (const [value, label] of [["queued", "Da ascoltare"], ["neutral", "Neutri da rivalutare"], ["", "Tutti"]]) {
    status.add(new Option(label, value));
  }
  const genre = document.createElement("select");
  genre.setAttribute("aria-label", "Genere da cui estrarre");
  genre.add(new Option("Tutti i generi", ""));
  for (const value of [...new Set(state.albums.flatMap((album) => album.genres))].sort()) genre.add(new Option(value, value));
  const result = document.createElement("p");
  const pick = document.createElement("button");
  pick.textContent = "Estrai album locale";
  pick.addEventListener("click", () => {
    const candidates = state.albums.filter((album) => (!status.value || album.status === status.value)
      && (!genre.value || album.genres.includes(genre.value)));
    if (!candidates.length) { result.textContent = "Nessun album corrisponde alla scelta."; return; }
    const album = candidates[Math.floor(Math.random() * candidates.length)];
    result.textContent = `${album.artist} - ${album.name} · ${labels[album.status]}`;
    open.hidden = false;
    open.onclick = () => { dialog.close(); openAlbumDetails(album.id); };
  });
  const open = document.createElement("button");
  open.textContent = "Apri dettagli";
  open.hidden = true;
  const close = document.createElement("button");
  close.textContent = "Chiudi";
  close.addEventListener("click", () => dialog.close());
  dialog.append(heading, status, genre, pick, result, open, close);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

function completeSelectedMusic({ durationsOnly = false, resume = false, ids = [...selectedAlbumIds] } = {}) {
  try {
    const provider = musicService.service, epoch = musicService.epoch;
    const revision = provider === "tidal" ? tidalUI.playlistAPI.revision()
      : provider === "qobuz" ? qobuzUI.playlistAPI.revision() : spotifySettings().clientId;
    const guard = () => {
      musicService.assert(provider, epoch);
      const current = provider === "tidal" ? tidalUI.playlistAPI.revision()
        : provider === "qobuz" ? qobuzUI.playlistAPI.revision() : spotifySettings().clientId;
      if (revision !== current) throw new Error("Account o configurazione cambiati: riapri il piano.");
    };
    openMusicCompletion({
      storage: localStorage, albums: state.albums, ids, provider, guard, durationsOnly, resume,
      read: async (row, consume, remaining, check) => {
        if (row.category === "duration") {
          const api = provider === "spotify" ? {
            request: async (path) => {
              check(); const token = await spotifyAccessToken(); check();
              return spotifyRequest(path, token, { read() {}, attempt: consume });
            },
          } : (provider === "tidal" ? tidalUI : qobuzUI).playlistAPI;
          return readCatalogPage(provider, api, row, consume, true);
        }
        if (row.category === "genres") {
          const data = await lastFmRequest({ method: "album.gettoptags", artist: row.album.artist,
            album: row.album.name, autocorrect: "0" }, check, consume);
          const tags = data.toptags?.tag;
          if (!Array.isArray(tags)) throw new Error("Tag album Last.fm non verificabili.");
          return musicalAlbumTags(tags);
        }
        const budget = { requests: 0, beforeRead: consume };
        const cache = getDiscogsSuggestionCache();
        const master = await findDiscogsSuggestionMaster(row.album, budget, cache);
        check();
        if (master === null) return null;
        const rating = await readDiscogsSuggestionRating(master, budget, cache);
        return { source: "Discogs", updated: rating.discogs_updated, data: rating,
          detail: `Discogs · campione di ${rating.discogs_sample_size || DISCOGS_SUGGESTION_SAMPLE_SIZE} edizioni; `
            + `non un voto personale · ${rating.discogs_url}` };
      },
      changed: () => {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        state.albums = validateDocument({ format: "accord-album-collection", version: 1, albums: saved.albums || [] });
        refreshGenreFilters(); render();
      },
    });
  } catch (error) { showFeedback(error.message, true); }
}

function composeDurationQueue() {
  const dialog = document.createElement("dialog");
  dialog.className = "album-comparison-dialog";
  const heading = document.createElement("h2");
  heading.textContent = "Coda locale per tempo disponibile";
  const hint = document.createElement("p");
  hint.textContent = "Solo durate già note o inserite esplicitamente qui sono conteggiate. "
    + "Gli album senza durata sono esclusi; nessun servizio viene interrogato e la riproduzione non parte.";
  const budget = document.createElement("input");
  budget.type = "number"; budget.min = "1"; budget.max = "1440"; budget.step = "1"; budget.value = "45";
  budget.setAttribute("aria-label", "Tempo disponibile in minuti");
  const mode = document.createElement("select");
  mode.setAttribute("aria-label", "Aggiungere alla coda o sostituirla");
  mode.add(new Option("Sostituisci la coda (consigliato)", "replace"));
  mode.add(new Option("Aggiungi alla coda attuale", "add"));
  const controls = document.createElement("div"); controls.className = "qol-actions";
  controls.append(node("label", "Minuti disponibili "), budget, mode);
  const durationsEditor = document.createElement("div"), list = document.createElement("div");
  const dataSummary = document.createElement("p"), summary = document.createElement("p"), error = document.createElement("p");
  error.setAttribute("role", "alert");
  const confirm = document.createElement("button");
  confirm.className = "primary"; confirm.type = "button"; confirm.textContent = "Conferma coda";
  const cancel = document.createElement("button");
  cancel.className = "secondary"; cancel.type = "button"; cancel.textContent = "Annulla";
  const footer = document.createElement("div"); footer.className = "dialog-actions";
  footer.append(confirm, cancel);
  dialog.append(heading, hint, controls, dataSummary, durationsEditor, list, summary, error, footer);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });

  const parseStored = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || "null") || fallback; }
    catch (cause) { throw new Error(`Dati locali illeggibili (${key}): ${cause.message}`); }
  };
  const readSnapshot = () => {
    const storedCollection = parseStored(STORAGE_KEY, {});
    const storedAlbums = validateDocument({ format: "accord-album-collection", version: 1,
      albums: Array.isArray(storedCollection.albums) ? storedCollection.albums : [] });
    const queue = parseStored(LISTENING_QUEUE_KEY, { ids: [], resume: "", durations: {} });
    const durations = parseStored(ALBUM_DURATIONS_KEY, {});
    if (!Array.isArray(queue.ids) || !queue.ids.every((id) => typeof id === "string")
        || !queue.durations || typeof queue.durations !== "object"
        || !durations || typeof durations !== "object"
        || Object.values({ ...queue.durations, ...durations }).some((value) =>
          !Number.isSafeInteger(value) || value <= 0)) {
      throw new Error("Coda o durate locali non valide.");
    }
    return { albums: storedAlbums, queue, durations: { ...queue.durations, ...durations } };
  };

  let snapshot;
  let selected = new Set();
  let candidateById = new Map();
  try { snapshot = readSnapshot(); }
  catch (cause) { error.textContent = cause.message; confirm.disabled = true; dialog.showModal(); return; }

  const durationText = (milliseconds) => {
    const seconds = Math.floor(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  function updatePreview() {
    selected = new Set([...list.querySelectorAll("input[type=checkbox]:checked")].map((input) => input.value));
    const targetIds = mode.value === "add"
      ? [...new Set([...snapshot.queue.ids, ...selected])] : [...selected];
    const unknown = targetIds.filter((id) => snapshot.durations[id] === undefined);
    const total = targetIds.reduce((sum, id) => sum + (snapshot.durations[id] || 0), 0);
    const selectedAlbums = targetIds.map((id) => snapshot.albums.find((album) => album.id === id)).filter(Boolean);
    const duplicates = duplicateAlbumGroups(selectedAlbums).length;
    const availableMs = Number(budget.value) * 60_000;
    const over = !Number.isSafeInteger(availableMs) || availableMs <= 0 || total > availableMs;
    summary.textContent = `Coda risultante: ${durationText(total)} / ${budget.value || 0}:00 disponibili`
      + (unknown.length ? ` · ${unknown.length} album senza durata: limite non verificabile.` : "")
      + (duplicates ? ` · ${duplicates} gruppo/i di possibili duplicati.` : "");
    confirm.disabled = !selected.size || unknown.length > 0 || over;
    for (const input of list.querySelectorAll("input[type=checkbox]")) {
      input.disabled = snapshot.durations[input.value] === undefined;
      input.checked = selected.has(input.value);
    }
  }
  function refresh() {
    try {
      snapshot = readSnapshot();
      const currentQueue = snapshot.queue;
      const candidates = snapshot.albums.filter((album) => album.status !== "disliked"
        && (mode.value !== "add" || !currentQueue.ids.includes(album.id)));
      const proposed = suggestDurationQueue(candidates, snapshot.durations, Number(budget.value) * 60_000,
        mode.value === "add" ? currentQueue.ids : []);
      candidateById = new Map(candidates.map((album) => [album.id, album]));
      const duplicateIds = new Set(duplicateAlbumGroups(candidates).flat().map((album) => album.id));
      selected = selected.size ? new Set([...selected].filter((id) => candidateById.has(id)))
        : new Set(proposed.ids);
      list.replaceChildren();
      for (const id of proposed.orderedIds) {
        const album = candidateById.get(id);
        const duration = snapshot.durations[id];
        const label = document.createElement("label"); label.className = "check";
        const input = document.createElement("input");
        input.type = "checkbox"; input.value = id; input.checked = selected.has(id);
        input.disabled = duration === undefined;
        input.addEventListener("change", updatePreview);
        label.append(input, document.createTextNode(
          `${album.artist} — ${album.name} · ${album.year || "anno sconosciuto"} · ${labels[album.status]}`
          + (album.rating === null || album.rating === undefined ? " · senza voto" : ` · voto personale ${album.rating}/5`)
          + (duration ? ` · ${durationText(duration)}` : " · durata non disponibile")
          + (duplicateIds.has(id) ? " · possibile edizione duplicata" : "")));
        list.append(label);
      }
      const missingCount = proposed.missingDurationIds.length;
      dataSummary.textContent = `${missingCount} album candidati senza durata nota. `
        + `${proposed.duplicateSkippedIds.length} possibili edizioni duplicate escluse automaticamente.`;
      updatePreview();
    } catch (cause) {
      error.textContent = cause.message;
      confirm.disabled = true;
    }
  }
  const editRow = document.createElement("div"); editRow.className = "qol-actions";
  const durationAlbum = document.createElement("select");
  durationAlbum.setAttribute("aria-label", "Album senza durata da aggiornare");
  const seconds = document.createElement("input");
  seconds.type = "number"; seconds.min = "1"; seconds.max = "86400"; seconds.step = "1"; seconds.value = "2400";
  seconds.setAttribute("aria-label", "Durata nota dell'album in secondi");
  const saveDuration = document.createElement("button");
  saveDuration.type = "button"; saveDuration.className = "secondary"; saveDuration.textContent = "Registra durata nota";
  editRow.append(durationAlbum, seconds, saveDuration);
  const completeDuration = document.createElement("button");
  completeDuration.type = "button"; completeDuration.textContent = "Completa durata dal catalogo…";
  completeDuration.addEventListener("click", () => {
    if (!durationAlbum.value) { error.textContent = "Scegli un album senza durata."; return; }
    const id = durationAlbum.value;
    dialog.close("complete");
    completeSelectedMusic({ durationsOnly: true, ids: [id] });
  });
  editRow.append(completeDuration);
  durationsEditor.append(editRow);
  function refreshDurationEditor() {
    durationAlbum.replaceChildren(new Option("Scegli un album senza durata", ""));
    for (const album of snapshot.albums) {
      if (snapshot.durations[album.id] === undefined) {
        durationAlbum.add(new Option(`${album.artist} — ${album.name}`, album.id));
      }
    }
  }
  saveDuration.addEventListener("click", () => {
    const id = durationAlbum.value, value = Number(seconds.value);
    if (!id || !Number.isSafeInteger(value) || value <= 0 || value > 86400) {
      error.textContent = "Scegli un album e una durata positiva in secondi.";
      return;
    }
    try {
      const saved = parseStored(ALBUM_DURATIONS_KEY, {});
      const provenanceKey = "accord-music-completion-provenance-v1";
      const provenance = parseStored(provenanceKey, {});
      provenance[id] ||= {};
      provenance[id].duration = { source: "manual", updated: new Date().toISOString() };
      commitLocalRestore(localStorage, ALBUM_DURATIONS_KEY, saved, { ...saved, [id]: value * 1000 },
        { [provenanceKey]: provenance });
      selected.clear();
      refresh();
      refreshDurationEditor();
      error.textContent = "Durata locale registrata esplicitamente; la coda non è stata modificata.";
    } catch (cause) { error.textContent = `Durata non salvata: ${cause.message}`; }
  });
  budget.addEventListener("input", refresh);
  mode.addEventListener("change", () => { selected.clear(); refresh(); });
  cancel.addEventListener("click", () => dialog.close("cancel"));
  confirm.addEventListener("click", () => {
    try {
      const current = readSnapshot();
      if (JSON.stringify(current) !== JSON.stringify(snapshot)) {
        throw new Error("Raccolta, durate o coda sono cambiate dopo l'anteprima. Riaprila.");
      }
      const selectedIds = [...list.querySelectorAll("input[type=checkbox]:checked")].map((input) => input.value);
      const queueIds = mode.value === "add"
        ? [...new Set([...current.queue.ids, ...selectedIds])] : selectedIds;
      const unknown = queueIds.filter((id) => current.durations[id] === undefined);
      const total = queueIds.reduce((sum, id) => sum + (current.durations[id] || 0), 0);
      if (unknown.length || total > Number(budget.value) * 60_000) {
        throw new Error("La coda risultante non rispetta il limite con durate tutte note.");
      }
      const updated = { ...current.queue, ids: queueIds,
        resume: queueIds.includes(current.queue.resume) ? current.queue.resume : "",
        durations: Object.fromEntries(queueIds.map((id) => [id, current.durations[id]])) };
      const savedDurations = { ...(current.queue.durations || {}), ...current.durations };
      for (const id of queueIds) savedDurations[id] = current.durations[id];
      localStorage.setItem(ALBUM_DURATIONS_KEY, JSON.stringify(savedDurations));
      localStorage.setItem(LISTENING_QUEUE_KEY, JSON.stringify(updated));
      dialog.close("applied");
      showFeedback("Coda locale aggiornata. Nessuna riproduzione avviata.");
    } catch (cause) { error.textContent = cause.message; }
  });
  refresh();
  refreshDurationEditor();
  dialog.showModal();
}

function openBulkEditor(initialValues = {}, { genresOnly = false } = {}) {
  if (!selectedAlbumIds.size) return;
  const ids = new Set(selectedAlbumIds);
  const genreEditTime = new Date().toISOString();
  const dialog = document.createElement("dialog");
  const heading = document.createElement("h2");
  heading.textContent = genresOnly ? `Generi di ${ids.size} album` : `Modifica ${ids.size} album`;
  const hidden = selectionVisibility(ids, visibleAlbums).hidden;
  const notice = document.createElement("p");
  notice.textContent = `${hidden} nascosti dai filtri inclusi. Solo i campi spuntati cambiano. `
    + "Aggiungi mantiene gli altri valori; Rimuovi toglie solo quelli indicati; Sostituisci con elenco vuoto svuota il campo.";
  dialog.setAttribute("aria-label", heading.textContent);
  const form = document.createElement("form");
  const controls = new Map();
  const fields = genresOnly ? [["genres", "Generi"]] : [["status", "Stato"],
    ["rating", "Voto (vuoto = nessun voto)"], ["genres", "Generi"], ["collections", "Collezioni"], ["tags", "Tag"]];
  for (const [key, caption] of fields) {
    const row = document.createElement("label");
    row.className = "qol-bulk-row";
    const captionText = document.createElement("span");
    captionText.textContent = caption;
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = genresOnly;
    enabled.setAttribute("aria-label", `Applica ${caption}`);
    const field = document.createElement(key === "status" ? "select" : "input");
    if (key === "status") for (const [value, label] of Object.entries(labels)) field.add(new Option(label, value));
    else if (key === "rating") { field.type = "number"; field.min = "0.5"; field.max = "5"; field.step = "0.5"; }
    else field.placeholder = "Valori separati da virgole";
    if (Object.hasOwn(initialValues, key)) {
      enabled.checked = true;
      field.value = initialValues[key];
    }
    field.addEventListener("input", () => { enabled.checked = true; });
    row.append(captionText, enabled, field);
    form.append(row);
    controls.set(key, { enabled, field });
  }
  const mode = document.createElement("select");
  mode.setAttribute("aria-label", "Modifica generi, collezioni e tag");
  for (const [value, label] of [["add", "Aggiungi valori"], ["remove", "Rimuovi valori"], ["replace", "Sostituisci elenchi"]]) {
    mode.add(new Option(label, value));
  }
  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Annulla";
  close.addEventListener("click", () => dialog.close());
  form.append(mode, error);
  appendAlbumReview(form, dialog, () => {
      if (ids.size !== selectedAlbumIds.size || [...ids].some((id) => !selectedAlbumIds.has(id))) {
        throw new Error("Selezione cambiata: riapri la modifica multipla.");
      }
      const values = {};
      for (const [key, { enabled, field }] of controls) {
        if (!enabled.checked) continue;
        values[key] = key === "status" ? field.value : key === "rating" ? (field.value ? Number(field.value) : null)
          : field.value.split(",").map((value) => value.trim()).filter(Boolean);
        if (["genres", "collections", "tags"].includes(key) && mode.value !== "replace" && !values[key].length) {
          delete values[key];
        }
      }
      if (!Object.keys(values).length) throw new Error("Spunta almeno un campo.");
      const review = prepareAlbumReview(state.albums, ids,
        (album) => validateAlbum({ ...album, ...batchAlbumChanges(album, values, mode.value) }));
      return Object.hasOwn(values, "genres")
        ? reviewManualGenres(review, ids, localStorage, COMPLETION_PROVENANCE_KEY, genreEditTime) : review;
  }, error);
  form.append(close);
  dialog.append(heading, notice, form);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

function appendAlbumReview(form, dialog, buildReview, error) {
  let review = null;
  let draftSnapshot = "";
  const preview = document.createElement("pre");
  preview.className = "qol-details";
  preview.setAttribute("role", "status");
  const prepare = document.createElement("button");
  prepare.type = "submit";
  prepare.textContent = "Prepara anteprima · nessuna scrittura";
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.textContent = "Conferma queste modifiche locali";
  confirm.disabled = true;
  const technicalPreview = document.createElement("pre");
  const technicalDetails = document.createElement("details");
  const technicalToggle = document.createElement("summary");
  technicalToggle.textContent = "ⓘ Dettagli";
  technicalDetails.append(technicalToggle, technicalPreview);
  const errorActions = document.createElement("div");
  errorActions.className = "qol-actions";
  const showError = (failure) => {
    error.textContent = safeDiagnostics(failure.message);
    errorActions.replaceChildren();
    appendErrorActions(errorActions, error.textContent, () => dialog.close(), "local-review");
  };
  const invalidate = () => {
    review = null;
    confirm.disabled = true;
    preview.textContent = "Selezione o campi cambiati: prepara una nuova anteprima.";
    technicalPreview.textContent = "";
    technicalDetails.open = false;
  };
  form.addEventListener("input", invalidate);
  form.addEventListener("change", invalidate);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    confirm.disabled = true;
    review = null;
    try {
      const proposed = buildReview();
      const editing = proposed.changes.filter((change) => qol.drafts[`edit:${change.id}`]);
      if (editing.length) throw new Error(`${editing.length} album hanno bozze locali. Riprendile o scartale da Bozze locali prima di procedere.`);
      review = proposed;
      draftSnapshot = JSON.stringify(qol.drafts);
      technicalPreview.textContent = changesText(review.changes, true);
      preview.textContent = `${review.selected} selezionati · ${review.changed} realmente modificati · ${
        review.unchanged} invariati.\nNessuna scrittura eseguita.\n\n${changesText(review.changes) || "Nessuna differenza."}`
        + "\n\nInvariati:\n" + review.next.filter((album) =>
          review.selectedIds.includes(album.id)
          && !review.changes.some((change) => change.id === album.id))
          .map((album) => `${album.artist} - ${album.name}`).join("\n");
      confirm.disabled = !review.changed;
      error.textContent = "";
      errorActions.replaceChildren();
    } catch (failure) { showError(failure); }
  });
  confirm.addEventListener("click", () => {
    if (confirm.disabled) return;
    confirm.disabled = true;
    try {
      if (state.loadError) throw new Error(`Archivio locale non leggibile: ${state.loadError}`);
      assertAlbumReviewCurrent(review, state.albums, localStorage.getItem(STORAGE_KEY));
      if (Object.entries(review.relatedSnapshot || {}).some(([key, value]) => localStorage.getItem(key) !== value)) {
        throw new Error("Provenienza dei dati cambiata: rigenera l'anteprima.");
      }
      const currentReview = buildReview();
      if (JSON.stringify(qol.drafts) !== draftSnapshot
          || JSON.stringify(currentReview.next) !== JSON.stringify(review.next)
          || JSON.stringify(currentReview.related) !== JSON.stringify(review.related)) {
        throw new Error("Campi, selezione o bozze cambiati: rigenera l'anteprima.");
      }
      commitLocalRestore(localStorage, STORAGE_KEY, state, { ...state, albums: review.next }, review.related,
        `Modifica di ${review.changed} album`);
      rememberLocalChanges(new Set(review.changes.map((change) => change.id)));
      dialog.close();
      render();
      showFeedback(`${review.changed} album modificati localmente · ${review.unchanged} invariati`);
    } catch (failure) { showError(failure); }
  });
  form.append(prepare, preview, technicalDetails, confirm, errorActions);
}

function openLabelNormalization() {
  const proposals = labelNormalizationProposals(state.albums);
  if (!proposals.length) {
    showMessage("Etichette locali", "Nessuna variante equivalente rilevata tra generi, tag e collezioni. Nessuna fusione eseguita.");
    return;
  }
  const dialog = document.createElement("dialog");
  const title = document.createElement("h2");
  title.textContent = "Uniforma etichette · solo proposte locali";
  dialog.setAttribute("aria-label", title.textContent);
  const notice = document.createElement("p");
  notice.textContent = "Scegli una proposta, l'etichetta finale e gli album. Non vengono uniti album o tipi diversi di etichette. Il ruolo del genere principale viene conservato.";
  const form = document.createElement("form");
  const proposalLabel = document.createElement("label");
  proposalLabel.textContent = "Varianti rilevate";
  const select = document.createElement("select");
  proposals.forEach((proposal, index) => select.add(new Option(
    `${{ genres: "Generi", tags: "Tag", collections: "Collezioni" }[proposal.field]}: ${proposal.labels.join(" / ")}`, String(index))));
  proposalLabel.append(select);
  const finalLabel = document.createElement("label");
  finalLabel.textContent = "Etichetta finale";
  const final = document.createElement("input");
  final.type = "text";
  final.maxLength = 80;
  final.required = true;
  finalLabel.append(final);
  const albums = document.createElement("fieldset");
  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  const refresh = () => {
    const proposal = proposals[Number(select.value)];
    final.value = proposal.labels[0];
    const legend = document.createElement("legend");
    legend.textContent = "Album da includere";
    albums.replaceChildren(legend);
    for (const id of proposal.albumIds) {
      const album = state.albums.find((record) => record.id === id);
      if (!album) continue;
      const label = document.createElement("label");
      label.className = "check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = id;
      checkbox.checked = true;
      label.append(checkbox, `${album.artist} · ${album.name} · ${album[proposal.field].join(", ")}`);
      albums.append(label);
    }
  };
  select.addEventListener("change", refresh);
  refresh();
  form.append(proposalLabel, finalLabel, albums, error);
  appendAlbumReview(form, dialog, () => {
    const ids = new Set([...albums.querySelectorAll("input:checked")].map((input) => input.value));
    if (!ids.size) throw new Error("Seleziona almeno un album.");
    const proposal = proposals[Number(select.value)];
    return prepareAlbumReview(state.albums, ids,
      (album) => normalizeAlbumLabels(album, proposal.field, proposal.labels, final.value, validateAlbum));
  }, error);
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Annulla";
  close.addEventListener("click", () => dialog.close());
  form.append(close);
  dialog.append(title, notice, form);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

function removedCoverIds() {
  const value = JSON.parse(localStorage.getItem(COVER_REMOVALS_KEY) || "[]");
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    throw new Error("Preferenza copertine rimosse non valida. Nessun download riattivato.");
  }
  return new Set(value);
}

async function getCoverInventory() {
  const database = await openCoverDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(COVER_STORE, "readonly").objectStore(COVER_STORE).getAll();
    request.onsuccess = () => {
      try { resolve(coverStorageInventory(request.result)); }
      catch (error) { reject(error); }
    };
    request.onerror = () => reject(new Error(`Impossibile misurare le copertine: ${request.error?.message || "errore IndexedDB"}`));
  });
}

async function removeCachedCovers(ids) {
  const database = await openCoverDatabase();
  const previous = localStorage.getItem(COVER_REMOVALS_KEY);
  localStorage.setItem(COVER_REMOVALS_KEY, JSON.stringify([...new Set([...removedCoverIds(), ...ids])]));
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(COVER_STORE, "readwrite");
      const store = transaction.objectStore(COVER_STORE);
      for (const id of ids) store.delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(new Error(`Eliminazione copertine interrotta: ${transaction.error?.message || "transazione annullata"}`));
      transaction.onerror = () => reject(new Error(`Eliminazione copertine non riuscita: ${transaction.error?.message || "errore IndexedDB"}`));
    });
  } catch (error) {
    if (previous === null) localStorage.removeItem(COVER_REMOVALS_KEY);
    else localStorage.setItem(COVER_REMOVALS_KEY, previous);
    throw error;
  }
}

async function openCoverStorageManager() {
  const dialog = document.createElement("dialog");
  const title = document.createElement("h2");
  title.textContent = "Copertine offline · spazio locale";
  dialog.setAttribute("aria-label", title.textContent);
  const notice = document.createElement("p");
  notice.textContent = "Misuro i byte effettivi dei file copertina salvati, non lo spazio totale su disco o l'overhead IndexedDB. La rimozione non cambia album, preferenze, bozze, cronologia Last.fm o file GitHub. Le copertine rimosse non vengono ricaricate da sole, neppure alla sincronizzazione: usa esplicitamente Carica copertine mancanti online per riattivarle.";
  const summary = document.createElement("p");
  summary.setAttribute("role", "status");
  const list = document.createElement("div");
  const all = document.createElement("button");
  all.type = "button";
  all.textContent = "Rimuovi tutte le immagini della raccolta…";
  all.disabled = true;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Chiudi";
  close.addEventListener("click", () => dialog.close());
  let inventory = [];
  let busy = false;
  const refresh = async () => {
    inventory = await getCoverInventory();
    summary.textContent = `${inventory.length} copertine salvate · ${inventory.reduce((total, entry) => total + entry.bytes, 0).toLocaleString()} byte effettivi di immagini. Le immagini solo online e le icone dell'app non sono incluse.`;
    list.replaceChildren();
    for (const entry of inventory) {
      const album = state.albums.find((record) => record.id === entry.id);
      const row = document.createElement("div");
      row.className = "qol-actions";
      const caption = document.createElement("span");
      caption.textContent = `${album ? `${album.artist} · ${album.name}` : entry.id} · ${entry.bytes.toLocaleString()} byte`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Rimuovi immagine…";
      remove.addEventListener("click", () => void removeImages(new Set([entry.id]), caption.textContent));
      row.append(caption, remove);
      list.append(row);
    }
    all.disabled = false;
  };
  const removeImages = async (ids, description) => {
    if (busy) { showFeedback("Rimozione immagini già in corso"); return; }
    if (!window.confirm(`Rimuovere ${description}? Album, preferenze e bozze restano intatti. Nessun download automatico.`)) return;
    busy = true;
    all.disabled = true;
    list.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      await removeCachedCovers(ids);
      collectionCoverRemoteIds.clear();
      render();
      await refresh();
      void updateOfflineReadiness();
      showFeedback("Immagini rimosse. Raccolta, preferenze e bozze conservate.");
    } catch (error) { summary.textContent = `Rimozione non completata: ${error.message}`; }
    finally {
      busy = false;
      all.disabled = false;
      list.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    }
  };
  all.addEventListener("click", () => void removeImages(
    new Set([...inventory.map((entry) => entry.id), ...state.albums.map((album) => album.id)]),
    `tutte le immagini della raccolta (${inventory.length} file salvati, ${inventory.reduce((sum, entry) => sum + entry.bytes, 0)} byte)`));
  dialog.append(title, notice, summary, all, list, close);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  try { await refresh(); }
  catch (error) { summary.textContent = `Dimensione non disponibile: ${error.message}. Nessuna stima presentata.`; }
}

async function updateOfflineReadiness() {
  const notice = $("#offlineSummary");
  try {
    let appReady = false;
    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (registration?.active) {
      appReady = await new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => {
          channel.port1.close();
          reject(new Error("La versione offline non risponde: chiudi e riapri la PWA per aggiornarla."));
        }, 3000);
        channel.port1.onmessage = ({ data }) => {
          clearTimeout(timer);
          channel.port1.close();
          if (data.error) reject(new Error(data.error));
          else resolve(data.ready === true);
        };
        registration.active.postMessage({ type: "accord-offline-status" }, [channel.port2]);
      });
    }
    const inventory = await getCoverInventory();
    const coverIds = new Set(inventory.map((entry) => entry.id));
    const count = state.albums.filter((album) => coverIds.has(album.id)).length;
    notice.textContent = `App offline: ${appReady ? "cache installata" : "non ancora pronta"} · copertine salvate: ${
      count}/${state.albums.length} · ${inventory.reduce((total, entry) => total + entry.bytes, 0).toLocaleString()} byte effettivi di immagini · ${navigator.onLine ? "rete rilevata (servizi non verificati)" : "offline rilevato: nessuna disponibilita' remota verificata"}. Ricerca e modifiche locali restano disponibili.`;
  } catch (error) {
    notice.textContent = `Verifica offline non riuscita: ${error.message}. Disponibilita' non confermata.`;
  }
}

function initializeCollectionQol() {
  refreshDraftIndicators();
  $("#draftListButton").addEventListener("click", openDraftList);
  $("#normalizeLabelsButton").addEventListener("click", openLabelNormalization);
  $("#coverStorageButton").addEventListener("click", () => void openCoverStorageManager());
  refreshSavedCollectionViews();
  refreshSuggestionHistory();
  updateLocalSyncSummary();
  $("#viewMenu").addEventListener("click", (event) => {
    if (event.target.closest("button")) $("#viewMenu").open = false;
  });
  $("#smartCollectionList").addEventListener("change", render);
  $("#pickAlbumButton").addEventListener("click", pickLocalAlbum);
  $("#durationQueueButton").addEventListener("click", composeDurationQueue);
  $("#completeDurationsButton").addEventListener("click", () => completeSelectedMusic({ durationsOnly: true }));
  $("#completeMusicButton").addEventListener("click", () => completeSelectedMusic());
  $("#resumeMusicCompletionButton").addEventListener("click", () => completeSelectedMusic({ resume: true }));
  $("#bulkEditButton").addEventListener("click", openBulkEditor);
  $("#bulkGenresButton").addEventListener("click", () => openBulkEditor({}, { genresOnly: true }));
  $("#syncChangesButton").addEventListener("click", () => showMessage("Modifiche locali",
    changesText(albumChanges(musicalRecords(state.base), musicalRecords(state.albums)))
      || "Nessuna differenza musicale dalla base locale. Il remoto non e' stato verificato."));
  $("#statisticsButton").addEventListener("click", () => {
    const stats = albumStatistics(state.albums, qol.changedAt);
    showMessage("Statistiche locali", `${stats.total} album · ${stats.rated} votati · media ${
      stats.average === null ? "-" : stats.average.toFixed(2)}\nAscoltati senza voto: ${
      stats.unratedListened}\nModificati su questo dispositivo nel mese: ${stats.changedThisMonth}\n\nStati:\n${
      Object.entries(stats.states).map(([key, count]) => `${labels[key]}: ${count}`).join("\n")}\n\nGeneri:\n${
      Object.entries(stats.genres).sort((a, b) => b[1] - a[1]).map(([key, count]) => `${key}: ${count}`).join("\n")}`);
  });
  $("#duplicatesButton").addEventListener("click", () => {
    const text = duplicateAlbumGroups(state.albums).map((group) => group.map((album) =>
      `${album.artist} | ${album.name} | ${album.year || "-"} | ${labels[album.status]} | voto ${
        album.rating ?? "-"} | ${album.genres.join(", ")} | ${album.id}`).join("\n")).join("\n\n");
    showMessage("Possibili duplicati: confronto locale", text || "Nessun possibile duplicato. Nessuna fusione automatica.");
  });
  $("#auditCollectionButton").addEventListener("click", async () => {
    const button = $("#auditCollectionButton");
    button.disabled = true;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const rawAlbums = Array.isArray(saved.albums) ? saved.albums : [];
      const albums = state.loadError ? rawAlbums : state.albums;
      const parseObject = (key) => {
        const value = JSON.parse(localStorage.getItem(key) || "{}");
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error(`Dato locale non leggibile: ${key}.`);
        }
        return value;
      };
      const queue = parseObject(LISTENING_QUEUE_KEY);
      if (queue.durations !== undefined
          && (!queue.durations || typeof queue.durations !== "object" || Array.isArray(queue.durations))) {
        throw new Error("Durate della coda locale non leggibili.");
      }
      const durations = { ...(queue.durations || {}), ...parseObject(ALBUM_DURATIONS_KEY) };
      const editionLinks = parseObject("accord-music-edition-links-v1");
      const completionProvenance = parseObject(COMPLETION_PROVENANCE_KEY);
      const completionEvidence = parseObject(COMPLETION_EVIDENCE_KEY);
      const health = collectionHealthSummary(albums, {
        rawAlbums, durations, editionLinks, completionProvenance, completionEvidence,
      });
      const byId = new Map(albums.filter((album) => typeof album?.id === "string")
        .map((album) => [album.id, album]));
      const named = (ids) => ids.slice(0, 40).map((id) => {
        const album = byId.get(id);
        return album ? `${album.artist || "Artista sconosciuto"} · ${album.name || id}` : id;
      }).join("\n") + (ids.length > 40 ? `\n… e altri ${ids.length - 40}` : "");
      if (state.loadError) {
        showMessage("Controllo qualità locale", [
          `Archivio album non leggibile: ${state.loadError}`,
          ...[
            ["Collegamenti album malformati", health.malformedLinkIds],
            ["Associazioni d'edizione malformate", health.malformedEditionIds],
            ["Associazioni d'edizione non coerenti", health.incoherentEditionIds],
            ["Durate mancanti o non valide", health.missingDurationIds],
            ["Dati derivati obsoleti o orfani", health.staleDerivedIds],
          ].map(([label, ids]) => `${label}: ${ids.length}${ids.length ? `\n${named(ids)}` : ""}`),
          "",
          "Controllo solo locale: nessuna richiesta remota e nessuna correzione automatica.",
        ].join("\n"));
        return;
      }
      const coveredIds = state.albums.length ? await getCachedCoverIds() : new Set();
      const audit = collectionAuditSummary(state.albums, coveredIds);
      const lines = [
        `Album controllati: ${audit.total}`,
        `Possibili duplicati: ${audit.duplicateGroups.length} gruppi · ${audit.duplicateIds.length} album`,
        `Copertine non disponibili offline: ${audit.missingCoverIds.length}`,
        `Anno non specificato: ${audit.missingYearIds.length}`,
        `Generi non assegnati: ${audit.missingGenreIds.length}`,
        `Collegamenti album malformati: ${health.malformedLinkIds.length}`,
        `Associazioni d'edizione malformate: ${health.malformedEditionIds.length}`,
        `Associazioni d'edizione non coerenti: ${health.incoherentEditionIds.length}`,
        `Durate mancanti o non valide: ${health.missingDurationIds.length}`,
        `Dati derivati obsoleti o orfani: ${health.staleDerivedIds.length}`,
        "",
        "Controllo solo locale: nessuna richiesta remota e nessuna correzione automatica.",
      ];
      if (audit.duplicateGroups.length) {
        lines.push("", "Possibili duplicati (da verificare manualmente):",
          ...audit.duplicateGroups.slice(0, 40).map((group) => group.map((id) =>
            `${byId.get(id).artist} · ${byId.get(id).name}`).join(" | ")));
        if (audit.duplicateGroups.length > 40) lines.push(`… e altri ${audit.duplicateGroups.length - 40} gruppi`);
      }
      for (const [label, ids] of [
        ["Copertine mancanti offline", audit.missingCoverIds],
        ["Anno non specificato", audit.missingYearIds],
        ["Generi non assegnati", audit.missingGenreIds],
        ["Collegamenti album malformati", health.malformedLinkIds],
        ["Associazioni d'edizione malformate", health.malformedEditionIds],
        ["Associazioni d'edizione non coerenti", health.incoherentEditionIds],
        ["Durate mancanti o non valide", health.missingDurationIds],
        ["Dati derivati obsoleti o orfani", health.staleDerivedIds],
      ]) {
        if (ids.length) lines.push("", `${label}:`, named(ids));
      }
      showMessage("Controllo qualità locale", lines.join("\n"));
    } catch (error) {
      showFeedback(`Controllo locale non riuscito: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });
  $("#collectionHistoryButton").addEventListener("click", openCollectionHistory);
  $("#saveCollectionViewButton").addEventListener("click", () => {
    const name = window.prompt("Nome della vista locale");
    if (!name?.trim()) return;
    const view = Object.fromEntries(collectionViewSelectors.map((selector) => [selector, $(selector).value]));
    view.appliedSearch = appliedCollectionSearch;
    view.pinnedOnly = $("#pinnedOnlyInput").checked;
    view.facet = localFacet;
    view.localChecks = localCollectionChecks.map((selector) => $(selector).checked);
    if (saveCollectionQol({ ...qol, views: { ...qol.views, [name.trim()]: view } })) refreshSavedCollectionViews();
  });
  $("#deleteCollectionViewButton").addEventListener("click", () => {
    const name = $("#savedCollectionView").value;
    if (!name || !window.confirm(`Eliminare la vista ${name}?`)) return;
    const views = { ...qol.views };
    delete views[name];
    if (saveCollectionQol({ ...qol, views })) refreshSavedCollectionViews();
  });
  $("#savedCollectionView").addEventListener("change", () => {
    const view = qol.views[$("#savedCollectionView").value];
    if (!view) return;
    try { localFacet = normalizeAlbumFacet(view.facet); }
    catch (error) { showFeedback(`Vista non applicata: ${error.message}`, true); return; }
    for (const selector of collectionViewSelectors) {
      if (typeof view[selector] === "string") $(selector).value = view[selector];
      else if (selector === "#serviceFilter") $(selector).value = "";
      if (selector === "#primaryGenreFilter") refreshGenreFilters();
    }
    localCollectionChecks.forEach((selector, index) => { $(selector).checked = view.localChecks?.[index] === true; });
    collectionSelectionOnly = false;
    appliedCollectionSearch = view.appliedSearch ?? view["#searchInput"] ?? "";
    $("#pinnedOnlyInput").checked = Boolean(view.pinnedOnly);
    saveCollectionPreferences({ ...collectionPreferences, layout: $("#collectionLayout").value });
    state.sortOrder = $("#sortOrder").value;
    saveState();
    render();
    $("#viewMenu").open = false;
  });
  for (const selector of manualDraftSelectors) {
    $(selector).addEventListener("input", () => saveAlbumDraft("manual",
      Object.fromEntries(manualDraftSelectors.map((field) => [field, $(field).value]))));
  }
  const discardManual = document.createElement("button");
  discardManual.type = "button";
  discardManual.textContent = "Scarta bozza";
  discardManual.addEventListener("click", () => {
    if (!window.confirm("Scartare definitivamente la bozza di ricerca locale?")) return;
    if (!clearAlbumDraft("manual")) return;
    $("#manualAlbumSource").value = "spotify";
    for (const selector of manualDraftSelectors.slice(1)) $(selector).value = "";
    updateManualAlbumSourceNotice();
  });
  $("#manualAlbumSearchForm").append(discardManual);
  $("#albumDetailsFields").addEventListener("input", () => {
    persistDetailsDraft();
  });
  const discardDetails = document.createElement("button");
  discardDetails.type = "button";
  discardDetails.textContent = "Scarta bozza e ricarica album";
  discardDetails.addEventListener("click", () => {
    const id = detailsAlbumId;
    if (!window.confirm("Scartare definitivamente la bozza e ricaricare l'album salvato?")) return;
    if (!clearAlbumDraft(`edit:${id}`)) return;
    openAlbumDetails(id, detailsReturnFocus);
  });
  $("#albumDetailsForm").append(discardDetails);
  $("#suggestionHistory").addEventListener("change", () => {
    const value = $("#suggestionHistory").value;
    if (value === "") return;
    const entry = qol.history[Number(value)];
    if (!entry || !["spotify", "lastfm"].includes(entry.kind) || !Array.isArray(entry.albums)) {
      showFeedback("Risultato precedente non valido", true);
      return;
    }
    $("#suggestionTool").value = entry.kind;
    updateSuggestionToolUi();
    replayingSuggestions = true;
    try {
      if (entry.kind === "spotify") renderSpotifyAlbumSuggestions(entry.albums);
      else renderListeningAlbumSuggestions(entry.albums);
    } finally { replayingSuggestions = false; }
  });
  $("#clearSuggestionHistory").addEventListener("click", () => {
    if (saveCollectionQol({ ...qol, history: [] })) refreshSuggestionHistory();
  });
  $("#restoreSnoozedButton").addEventListener("click", () => {
    if (saveCollectionQol({ ...qol, snoozes: {} })) showFeedback("Rinvii rimossi. Riapri i risultati precedenti per rivederli.");
  });
  $("#offlineStatusButton").addEventListener("click", () => void updateOfflineReadiness());
  const networkChanged = () => {
    githubAvailability = "GitHub: disponibilita' non verificata dopo il cambio di rete";
    updateLocalSyncSummary();
    void updateOfflineReadiness();
  };
  window.addEventListener("online", networkChanged);
  window.addEventListener("offline", networkChanged);
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) updateLocalSyncSummary();
  });
  void updateOfflineReadiness();
}

function updateCollectionCoverNotice() {
  const albums = new Map(state.albums.map((album) => [album.id, album]));
  const missingArchive = state.albums.filter((album) => !album.cover_sha256).length;
  const streamed = [...collectionCoverRemoteIds]
    .filter((id) => albums.has(id) && albums.get(id).cover_sha256).length;
  const failures = [...collectionCoverFailures.entries()].filter(([id]) => albums.has(id));
  const messages = [];
  if (missingArchive) {
    messages.push(`${missingArchive} album senza miniatura sincronizzata. Per cercare le copertine usa “Vista > Altre azioni”; sincronizza Accord desktop per archiviarle offline.`);
  }
  if (streamed) {
    messages.push(`${streamed} copertine sono mostrate online ma non nella cache offline. Premi “Sincronizza” per scaricare le miniature.`);
  }
  if (failures.length) {
    messages.push(`${failures.length} copertine non caricate: ${failures[0][1]}`);
  }
  setCoverNotice(messages.join(" "));
}

function updateAlbum(id, changes) {
  const selector = document.activeElement?.classList.contains("status-input") ? ".status-input"
    : document.activeElement?.classList.contains("rating-input") ? ".rating-input" : null;
  const restoreFocus = () => {
    if (!selector) return;
    const card = [...$("#albumList").children].find((item) => item.dataset.albumId === id);
    (card?.querySelector(selector) || $("#searchInput")).focus();
  };
  try {
    if (!state.albums.some((album) => album.id === id)) throw new Error("Album non piu' presente.");
    if (qol.drafts[`edit:${id}`]) throw new Error("Una bozza è presente per questo album: apri Dettagli per salvarla o scartarla prima della modifica rapida.");
    commitAlbumChanges(new Set([id]), changes);
    render();
    restoreFocus();
    showFeedback("Album salvato sul dispositivo");
  } catch (error) {
    render();
    restoreFocus();
    showFeedback(`Modifica non salvata: ${error.message}`, true);
  }
}

function openCollectionHistory() {
  const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  state.collectionHistory = Array.isArray(persisted.collectionHistory) ? persisted.collectionHistory : [];
  const dialog = document.createElement("dialog");
  dialog.className = "album-comparison-dialog";
  const heading = document.createElement("h2");
  heading.textContent = "Cronologia locale della raccolta";
  const note = document.createElement("p");
  note.textContent = "Registra modifiche agli album avviate da questa PWA. Il ripristino controlla i campi cambiati e non sostituisce modifiche successive.";
  const list = document.createElement("div");
  list.className = "collection-history-list";
  const entries = [...state.collectionHistory].reverse();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nessuna modifica registrata su questo dispositivo.";
    list.append(empty);
  }
  for (const entry of entries) {
    const item = document.createElement("section");
    item.className = "collection-history-entry";
    const title = document.createElement("strong");
    title.textContent = `${entry.label} · ${entry.createdAt}`;
    item.append(title);
    for (const change of entry.changes || []) {
      const detail = document.createElement("p");
      const action = change.kind === "added" ? "album aggiunto" : change.kind === "removed" ? "album rimosso"
        : change.fields.join(", ");
      detail.textContent = `${change.id}: ${action}`;
      item.append(detail);
    }
    for (const change of entry.storageChanges || []) {
      const detail = document.createElement("p");
      detail.textContent = `${change.id}: ${change.field}`;
      item.append(detail);
    }
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "secondary";
    restore.textContent = entry.restoredAt ? "Già ripristinata" : "Ripristina questa modifica";
    restore.disabled = Boolean(entry.restoredAt);
    restore.addEventListener("click", () => {
      try {
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        if (JSON.stringify(persisted.albums) !== JSON.stringify(state.albums)) {
          throw new Error("La raccolta è cambiata in un'altra scheda. Ricarica prima di ripristinare.");
        }
        if (!window.confirm(`Ripristinare “${entry.label}”? La cronologia resta locale; nessuna modifica viene inviata a GitHub.`)) return;
        const recordKeys = [ALBUM_DURATIONS_KEY, "accord-music-edition-links-v1",
          COMPLETION_PROVENANCE_KEY, COMPLETION_EVIDENCE_KEY];
        const records = Object.fromEntries(recordKeys.map((key) => [key,
          JSON.parse(localStorage.getItem(key) || "{}")]));
        const { albums: restored, storageUpdates } = prepareCollectionHistoryRestore(
          state.albums, entry, records["accord-music-edition-links-v1"], records,
        );
        const known = new Set(restored.map((album) => album.id));
        const nextHistory = state.collectionHistory.map((row) => row.id === entry.id
          ? { ...row, restoredAt: new Date().toISOString() } : row);
        const next = { ...state, albums: restored,
          manualOrder: [...state.manualOrder.filter((id) => known.has(id)),
            ...restored.map((album) => album.id).filter((id) => !state.manualOrder.includes(id))],
          collectionHistory: nextHistory };
        commitLocalRestore(localStorage, STORAGE_KEY, state, next, storageUpdates, `Ripristino: ${entry.label}`);
        updateLocalSyncSummary();
        dialog.close();
        render();
        showFeedback("Modifica ripristinata localmente; sincronizza per propagare la scelta.");
      } catch (error) {
        showFeedback(`Ripristino non applicato: ${error.message}`, true);
      }
    });
    item.append(restore);
    list.append(item);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "secondary";
  close.textContent = "Chiudi";
  close.addEventListener("click", () => dialog.close());
  dialog.append(heading, note, list, close);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

function applyCollectionSearch() {
  const query = $("#searchInput").value.trim();
  if (query === appliedCollectionSearch) return;
  appliedCollectionSearch = query;
  render();
}
$("#searchInput").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!$("#searchInput").value) return;
    event.preventDefault();
    $("#searchInput").value = "";
    applyCollectionSearch();
  } else if (event.key === "Enter") {
    event.preventDefault();
    applyCollectionSearch();
  }
});
for (const input of [$("#primaryGenreFilter"), $("#secondaryGenreFilter"), $("#statusFilter"),
  $("#collectionFilter"), $("#tagFilter"), $("#serviceFilter"), ...localCollectionChecks.map($)]) {
  input.addEventListener("change", render);
}
$("#sortOrder").addEventListener("change", () => {
  state.sortOrder = $("#sortOrder").value;
  saveState();
  render();
});

function clearSpotifySession() {
  for (const key of ["accord-spotify-access-token", "accord-spotify-refresh-token",
    "accord-spotify-token-expires", "accord-spotify-playlist-write-authorized",
    "accord-spotify-playlist-builder-authorized", "accord-spotify-top-artists-authorized"]) {
    sessionStorage.removeItem(key);
  }
  spotifyJsonReader.clear();
  spotifyPlaylistSnapshots.clear();
}

function storeSpotifyTokens(tokens) {
  if (typeof tokens.access_token !== "string" || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
    throw new Error("Spotify ha restituito una risposta token non valida.");
  }
  spotifyJsonReader.clear();
  spotifyPlaylistSnapshots.clear();
  sessionStorage.setItem("accord-spotify-access-token", tokens.access_token);
  sessionStorage.setItem("accord-spotify-token-expires", String(Date.now() + tokens.expires_in * 1000));
  if (String(tokens.scope || "").split(/\s+/).includes("user-top-read")) {
    sessionStorage.setItem("accord-spotify-top-artists-authorized", "1");
  }
  if (typeof tokens.refresh_token === "string") {
    sessionStorage.setItem("accord-spotify-refresh-token", tokens.refresh_token);
  }
}

async function spotifyTokenRequest(parameters) {
  const response = await spotifyApiFetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }, false);
  if (!response.ok) throw new Error(`Autenticazione Spotify non riuscita (HTTP ${response.status}).`);
  return response.json();
}

async function spotifyAccessToken() {
  const accessToken = sessionStorage.getItem("accord-spotify-access-token") || "";
  const expires = Number(sessionStorage.getItem("accord-spotify-token-expires"));
  if (accessToken && Number.isFinite(expires) && expires > Date.now() + 60_000) return accessToken;
  const refreshToken = sessionStorage.getItem("accord-spotify-refresh-token") || "";
  if (!refreshToken) return null;
  if (!spotifyRefreshPromise) {
    spotifyRefreshPromise = refreshSpotifyAccessToken(refreshToken).finally(() => {
      spotifyRefreshPromise = null;
    });
  }
  return spotifyRefreshPromise;
}

async function refreshSpotifyAccessToken(refreshToken) {
  const response = await spotifyApiFetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: spotifySettings().clientId,
    }),
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }, false);
  if ([400, 401].includes(response.status)) {
    clearSpotifySession();
    return null;
  }
  if (!response.ok) throw new Error(`Rinnovo della sessione Spotify non riuscito (HTTP ${response.status}).`);
  const tokens = await response.json();
  storeSpotifyTokens(tokens);
  return tokens.access_token;
}

async function spotifyApiFetch(url, options, retryRead, budget = null) {
  const serviceEpoch = musicService.epoch;
  musicService.assert("spotify", serviceEpoch);
  const response = await spotifyTransport.fetch(url, { ...options, accordServiceEpoch: serviceEpoch }, retryRead, budget);
  musicService.assert("spotify", serviceEpoch);
  return response;
}

async function spotifyRequest(path, accessToken, budget = null) {
  const serviceEpoch = musicService.epoch;
  musicService.assert("spotify", serviceEpoch);
  const url = new URL(path, `${SPOTIFY_API}/`);
  if (url.origin !== "https://api.spotify.com" || !url.pathname.startsWith("/v1/")) {
    throw new Error("Indirizzo API Spotify non valido.");
  }
  budget?.read();
  const data = await spotifyJsonReader.read(url, accessToken, async (etag) => {
    const headers = { Accept: "application/json", Authorization: `Bearer ${accessToken}` };
    if (etag) headers["If-None-Match"] = etag;
    const response = await spotifyApiFetch(url, {
      headers,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    }, true, budget);
    if (response.status === 401) {
      clearSpotifySession();
      throw new Error("Sessione Spotify scaduta. Avvia di nuovo l’importazione per autorizzarti.");
    }
    if (response.status === 403) throw new Error("Spotify non consente questa richiesta. Verifica accesso e autorizzazioni.");
    if (!response.ok && response.status !== 304) throw new Error(`Richiesta Spotify non riuscita (HTTP ${response.status}).`);
    return response;
  });
  musicService.assert("spotify", serviceEpoch);
  return data;
}

function spotifySearchRequest(parameters, accessToken, budget = null) {
  return readSpotifySearchPages(parameters, (path) => spotifyRequest(path, accessToken, budget));
}

async function spotifyWriteRequest(path, accessToken, body) {
  const url = new URL(path, `${SPOTIFY_API}/`);
  if (url.origin !== "https://api.spotify.com" || !url.pathname.startsWith("/v1/")) {
    throw new Error("Indirizzo API Spotify non valido.");
  }
  const response = await spotifyApiFetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }, false).finally(() => spotifyJsonReader.invalidateMutable());
  if (response.status === 401) {
    clearSpotifySession();
    throw new Error("Sessione Spotify scaduta. Ricollega l’account e riprova.");
  }
  if (response.status === 403) {
    throw new Error("Spotify ha negato la scrittura. Autorizza il permesso playlist-modify-private e riprova.");
  }
  if (!response.ok) throw new Error(`Scrittura Spotify non riuscita (HTTP ${response.status}).`);
  return response.status === 204 ? {} : response.json();
}

async function completeSpotifyPages(path, accessToken) {
  return readSpotifyPlaylistItems(path, (next) => spotifyRequest(next, accessToken));
}

async function chooseSpotifyPlaylist(playlists) {
  const dialog = $("#playlistChoiceDialog");
  const select = $("#playlistChoiceSelect");
  select.replaceChildren(new Option("Seleziona una playlist", ""));
  for (const playlist of playlists) {
    const owner = playlist.owner?.display_name || playlist.owner?.id || "proprietario sconosciuto";
    select.add(new Option(`${playlist.name} · ${owner}`, playlist.id));
  }
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "choose"
        ? playlists.find((playlist) => playlist.id === select.value) || null
        : null);
    }, { once: true });
  });
}

async function chooseSpotifyPlaylistSingles(name, singles, albums, skipped) {
  const dialog = $("#playlistSinglesDialog");
  const list = $("#playlistSinglesList");
  const existingIds = new Set(albums.map((album) => album.id));
  list.replaceChildren();
  $("#playlistSinglesSummary").textContent =
    `Playlist “${name}”: ${albums.length} album completi verranno inclusi se confermi. `
    + `Scegli singolarmente i singoli / EP da aggiungere. `
    + `Spotify li identifica come tipo “single” e non distingue con certezza EP e singoli.`
    + (skipped ? ` ${skipped} elementi non disponibili o di altro tipo saranno saltati.` : "");
  for (const { album, totalTracks } of singles) {
    const label = document.createElement("label");
    label.className = "check playlist-single-choice";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = album.id;
    checkbox.checked = false;
    checkbox.disabled = existingIds.has(album.id);
    const text = document.createElement("span");
    text.textContent = `${album.name} · ${album.artist} · ${album.year || "Anno sconosciuto"}`
      + (totalTracks ? ` · ${totalTracks} brani` : "")
      + (checkbox.disabled ? " · Già in raccolta" : "");
    label.append(checkbox, text);
    list.append(label);
  }
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve({
        confirmed: dialog.returnValue === "import",
        ids: dialog.returnValue === "import"
          ? [...list.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value)
          : [],
      });
    }, { once: true });
    dialog.showModal();
  });
}

async function resolveSpotifyPlaylist(input, accessToken) {
  const id = spotifyPlaylistId(input);
  if (id) {
    const playlist = await spotifyRequest(`playlists/${id}`, accessToken);
    if (playlist.id !== id || typeof playlist.name !== "string" || !playlist.snapshot_id) {
      throw new Error("Spotify non ha restituito una playlist verificabile.");
    }
    return playlist;
  }
  const matches = await findSpotifyPlaylistMatches(input, (offset) =>
    spotifyRequest(`me/playlists?limit=50&offset=${offset}`, accessToken));
  if (!matches.length) throw new Error("Non è stata trovata una playlist con quel nome nel tuo account Spotify.");
  const selected = matches.length === 1 ? matches[0] : await chooseSpotifyPlaylist(matches);
  if (!selected) return null;
  if (!selected.snapshot_id) {
    const playlist = await spotifyRequest(
      `playlists/${encodeURIComponent(selected.id)}?fields=id,name,snapshot_id`, accessToken,
    );
    if (playlist.id !== selected.id || typeof playlist.name !== "string" || !playlist.snapshot_id) {
      throw new Error("Spotify non ha restituito una playlist verificabile.");
    }
    return playlist;
  }
  if (typeof selected.name !== "string" || !selected.name) {
    throw new Error("Spotify non ha restituito una playlist verificabile.");
  }
  return selected;
}

async function runPlaylistImport(input, accessToken) {
  if (state.loadError) throw new Error(`Archivio locale non leggibile: ${state.loadError}`);
  const playlist = await resolveSpotifyPlaylist(input, accessToken);
  if (!playlist) return;
  const key = JSON.stringify([accessToken, playlist.id]);
  const cached = spotifyPlaylistSnapshots.get(key);
  let summary;
  if (cached?.snapshot === playlist.snapshot_id) {
    summary = JSON.parse(cached.summary);
  } else {
    const entries = await completeSpotifyPages(`playlists/${encodeURIComponent(playlist.id)}/items?limit=50&offset=0`, accessToken);
    summary = { ...playlistReleaseRecords(entries), count: entries.length };
  }
  const latest = await spotifyRequest(`playlists/${encodeURIComponent(playlist.id)}?fields=id,snapshot_id`, accessToken);
  if (latest.id !== playlist.id || latest.snapshot_id !== playlist.snapshot_id) {
    spotifyPlaylistSnapshots.delete(key);
    throw new Error("La playlist è cambiata durante la lettura. Ripeti l’importazione.");
  }
  const serialized = JSON.stringify(summary);
  if (summary.count <= 5000 && serialized.length <= 1_000_000) {
    spotifyPlaylistSnapshots.set(key, { snapshot: playlist.snapshot_id, summary: serialized });
    while (spotifyPlaylistSnapshots.size > 32) spotifyPlaylistSnapshots.delete(spotifyPlaylistSnapshots.keys().next().value);
  }
  const singles = summary.singles || [];
  let selectedSingles = [];
  if (singles.length) {
    const choice = await chooseSpotifyPlaylistSingles(playlist.name, singles, state.albums, summary.skipped);
    if (!choice.confirmed) {
      setSyncState("Importazione annullata: raccolta invariata");
      return;
    }
    const selectedIds = new Set(choice.ids);
    selectedSingles = singles
      .filter(({ album }) => selectedIds.has(album.id))
      .map(({ album }) => album);
  }
  const additions = [...summary.albums, ...selectedSingles];
  const result = addPlaylistAlbums(state.albums, additions);
  const skipped = summary.skipped;
  if (!singles.length && !window.confirm(`${playlist.name}: ${result.added} album nuovi, ${result.duplicates} gia' presenti e invariati, ${
    skipped} elementi non utilizzabili saltati. Applicare solo alla raccolta locale?`)) {
    setSyncState("Importazione annullata: raccolta invariata");
    return;
  }
  const previous = state.albums;
  state.albums = result.albums;
  try {
    if (result.added) saveState("Importa playlist nella raccolta");
  } catch (error) {
    state.albums = previous;
    throw error;
  }
  if (result.added) {
    rememberLocalChanges(new Set(result.albums.filter((album) =>
      !previous.some((existing) => existing.id === album.id)).map((album) => album.id)));
    render();
    setSyncState("Album aggiunti localmente · sincronizza per inviarli");
  } else {
    setSyncState("Playlist importata · nessun album nuovo");
  }
  showMessage("Importazione playlist completata",
    `${playlist.name}: ${summary.count} brani letti, ${summary.albums.length} album completi trovati, `
    + `${singles.length} singoli / EP elencati, ${selectedSingles.length} selezionati, `
    + `${result.added} aggiunti e ${result.duplicates} già presenti. Nessun dato è stato inviato automaticamente a GitHub; usa Sincronizza per inviare la raccolta.`);
}

async function importSpotifyPlaylist(input, accessToken = null) {
  if (!commandGuard.acquire("playlist-import")) { showFeedback("Importazione playlist già in corso"); return; }
  $("#playlistImportButton").disabled = true;
  setSyncState("Importazione playlist in corso…");
  try {
    const token = accessToken || await spotifyAccessToken();
    if (!token) {
      const { clientId, redirectUri } = spotifySettings();
      if (!clientId || !redirectUri) {
        openSettings();
        showMessage("Configura Spotify", "Inserisci il Client ID della tua app Spotify e il Redirect URI registrato, poi salva e riprova.");
        return;
      }
      await startSpotifyAuthorization(input);
      return;
    }
    setSyncState("Lettura playlist Spotify…");
    await runPlaylistImport(input, token);
  } catch (error) {
    setSyncState("Importazione Spotify non riuscita");
    showMessage("Errore importazione Spotify", error.message);
  } finally {
    $("#playlistImportButton").disabled = false;
    commandGuard.release("playlist-import");
  }
}

async function startSpotifyAuthorization(input, task = "playlist") {
  musicService.assert("spotify");
  const { clientId, redirectUri } = spotifySettings();
  if (!clientId || !redirectUri) throw new Error("Configura prima Client ID e Redirect URI Spotify.");
  if (!crypto.subtle || !window.isSecureContext) {
    throw new Error("L’autorizzazione Spotify richiede HTTPS o localhost e supporto Web Crypto.");
  }
  const randomValue = (length) => {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const verifier = randomValue(64);
  const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const oauthState = randomValue(32);
  const pendingKeys = {
    playlist: "accord-spotify-pending-playlist",
    "playlist-create": "accord-spotify-pending-playlist-create",
    "playlist-builder": "accord-spotify-pending-playlist-builder",
    albums: "accord-spotify-pending-albums",
    "manual-search": "accord-spotify-pending-manual-search",
    "spotify-album-suggestions": "accord-spotify-pending-album-suggestions",
  };
  const pendingKey = pendingKeys[task];
  if (!pendingKey) throw new Error("Operazione Spotify non valida.");
  sessionStorage.removeItem(SUGGESTION_RETURN_KEY);
  if (task === "manual-search") {
    const request = JSON.parse(input);
    const activeTab = viewTabs.find((tab) => tab.getAttribute("aria-selected") === "true");
    if (request.action === "match" && activeTab?.id === "suggestionsTab"
        && suggestedSourceAlbums.has(request.album?.id)) {
      persistListeningSuggestionsForSpotifyReturn();
      activateViewTab(activeTab);
    }
  }
  for (const key of Object.values(pendingKeys)) sessionStorage.removeItem(key);
  sessionStorage.setItem(pendingKey, input);
  sessionStorage.setItem("accord-spotify-code-verifier", verifier);
  sessionStorage.setItem("accord-spotify-oauth-state", oauthState);
  sessionStorage.setItem("accord-spotify-oauth-redirect", redirectUri);
  const authorization = new URL(`${SPOTIFY_ACCOUNTS}/authorize`);
  const authorizationParameters = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state: oauthState,
    code_challenge_method: "S256",
    code_challenge: challenge,
  };
  if (task === "playlist") authorizationParameters.scope = "playlist-read-private playlist-read-collaborative";
  if (task === "playlist-create" || task === "playlist-builder") {
    authorizationParameters.scope = "user-top-read playlist-modify-private";
  }
  if (task === "spotify-album-suggestions") authorizationParameters.scope = "user-top-read";
  authorization.search = new URLSearchParams(authorizationParameters);
  location.assign(authorization);
}

async function finishSpotifyAuthorization() {
  const callback = new URL(location.href);
  if (callback.searchParams.get("state")?.startsWith("tidal.")) return;
  const code = callback.searchParams.get("code");
  const error = callback.searchParams.get("error");
  if (!code && !error) return;
  history.replaceState(null, "", `${location.pathname}${location.hash}`);
  const expectedState = sessionStorage.getItem("accord-spotify-oauth-state");
  const verifier = sessionStorage.getItem("accord-spotify-code-verifier");
  const redirectUri = sessionStorage.getItem("accord-spotify-oauth-redirect");
  const pendingPlaylist = sessionStorage.getItem("accord-spotify-pending-playlist");
  const pendingPlaylistCreate = sessionStorage.getItem("accord-spotify-pending-playlist-create");
  const pendingPlaylistBuilder = sessionStorage.getItem("accord-spotify-pending-playlist-builder");
  const pendingAlbums = sessionStorage.getItem("accord-spotify-pending-albums");
  const pendingManualSearch = sessionStorage.getItem("accord-spotify-pending-manual-search");
  const pendingSpotifyAlbumSuggestions = sessionStorage.getItem("accord-spotify-pending-album-suggestions");
  for (const key of ["accord-spotify-oauth-state", "accord-spotify-code-verifier",
    "accord-spotify-oauth-redirect", "accord-spotify-pending-playlist",
    "accord-spotify-pending-playlist-create",
    "accord-spotify-pending-playlist-builder",
    "accord-spotify-pending-albums", "accord-spotify-pending-manual-search",
    "accord-spotify-pending-album-suggestions",
    ]) sessionStorage.removeItem(key);
  if (error) {
    showMessage("Autorizzazione Spotify annullata", "Autorizzazione non completata; nessun dato è stato aggiunto.");
    return;
  }
  if (!expectedState || !verifier || !redirectUri || !code
      || callback.searchParams.get("state") !== expectedState) {
    showMessage("Autorizzazione Spotify non valida", "Verifica OAuth non riuscita. Avvia di nuovo l’importazione.");
    return;
  }
  try {
    const { clientId } = spotifySettings();
    const tokens = await spotifyTokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    storeSpotifyTokens(tokens);
    if (pendingSpotifyAlbumSuggestions) {
      if (!String(tokens.scope || "").split(/\s+/).includes("user-top-read")) {
        throw new Error("Spotify non ha concesso user-top-read; nessun album è stato cercato.");
      }
      let request;
      try {
        request = JSON.parse(pendingSpotifyAlbumSuggestions);
      } catch {
        throw new Error("Richiesta di suggerimenti album Spotify non valida.");
      }
      if (!spotifyTimeRanges.has(request.period)
          || !["none", ...spotifyTimeRanges].includes(request.exclusion)) {
        throw new Error("Periodo Spotify della richiesta non valido.");
      }
      await loadSpotifyAlbumSuggestions(request, tokens.access_token);
    }
    else if (pendingPlaylistBuilder) {
      if (musicService.service !== "spotify") throw new Error("Servizio cambiato: nessuna anteprima Spotify ripresa.");
      const grants = String(tokens.scope || "").split(/\s+/);
      if (!grants.includes("user-top-read") || !grants.includes("playlist-modify-private")) {
        throw new Error("Spotify non ha concesso user-top-read e playlist-modify-private; nessuna playlist è stata creata.");
      }
      sessionStorage.setItem("accord-spotify-playlist-builder-authorized", "1");
      let request;
      try {
        request = JSON.parse(pendingPlaylistBuilder);
      } catch {
        throw new Error("Richiesta di anteprima playlist non valida.");
      }
      topArtistPlaylistPreview = await loadTopArtistPlaylistPreview(request, tokens.access_token);
      renderTopArtistPlaylistPreview(topArtistPlaylistPreview);
    }
    else if (pendingPlaylistCreate) {
      if (musicService.service !== "spotify") throw new Error("Servizio cambiato: nessuna creazione Spotify ripresa.");
      const grants = String(tokens.scope || "").split(/\s+/);
      if (!grants.includes("user-top-read") || !grants.includes("playlist-modify-private")) {
        throw new Error("Spotify non ha concesso user-top-read e playlist-modify-private; nessuna playlist è stata creata.");
      }
      sessionStorage.setItem("accord-spotify-playlist-write-authorized", "1");
      sessionStorage.setItem("accord-spotify-playlist-builder-authorized", "1");
      let request;
      try {
        request = JSON.parse(pendingPlaylistCreate);
      } catch {
        throw new Error("Richiesta di creazione playlist non valida.");
      }
      $("#playlistBuilderName").value = request.name;
      topArtistPlaylistPreview = request.preview;
      playlistHistorical = true;
      playlistCheckpointContext = { identity: await spotifyPlaylistIdentity(), criteria: await spotifyPlaylistCriteria() };
      renderTopArtistPlaylistPreview(topArtistPlaylistPreview);
      saveSpotifyPlaylistCheckpoint();
      $("#playlistBuilderStatus").textContent += " Autorizzazione completata: nessuna scrittura ripresa. Conferma nuovamente Crea playlist.";
    }
    else if (pendingPlaylist) await importSpotifyPlaylist(pendingPlaylist, tokens.access_token);
    else if (pendingAlbums) await loadSuggestedAlbums(pendingAlbums, null, tokens.access_token);
    else if (pendingManualSearch) {
      let filters;
      try {
        filters = JSON.parse(pendingManualSearch);
      } catch {
        filters = { ...manualAlbumSearchInput(), album: pendingManualSearch };
      }
      if (filters.action === "match") filters = { ...filters, provider: "spotify" };
      else if (!filters.provider) filters.provider = filters.source ? "spotify" : "lastfm";
      const pendingMatch = filters.action === "match";
      const searchInput = pendingMatch ? filters.input : filters;
      $("#manualAlbumSource").value = searchInput.provider || "lastfm";
      $("#manualAlbumQuery").value = searchInput.album || "";
      $("#manualAlbumArtist").value = searchInput.artist || "";
      $("#manualAlbumGenre").value = searchInput.genre || "";
      $("#manualAlbumYear").value = searchInput.year || "";
      updateManualAlbumSourceNotice();
      $("#manualAlbumDialog").showModal();
      if (pendingMatch) await resolveManualAlbumToSpotify(filters.album, tokens.access_token);
      else await searchManualAlbums(searchInput, tokens.access_token);
    }
    else setSyncState("Spotify collegato per questa sessione");
  } catch (tokenError) {
    clearSpotifySession();
    setSyncState("Autorizzazione Spotify non riuscita");
    showMessage("Errore autorizzazione Spotify", tokenError.message);
  }
}

$("#playlistImportButton").addEventListener("click", () => {
  if (musicService.service === "tidal") { tidalUI.openImport(); return; }
  if (musicService.service === "qobuz") { qobuzUI.openPlaylists(); return; }
  $("#playlistInput").value = "";
  $("#playlistDialog").showModal();
});

$("#manualAlbumButton").addEventListener("click", () => {
  if (musicService.service === "tidal") { tidalUI.openCatalog(); return; }
  if (musicService.service === "qobuz") { qobuzUI.openCatalog(); return; }
  $("#manualAlbumSource").value = "lastfm";
  $("#manualAlbumQuery").value = "";
  $("#manualAlbumArtist").value = "";
  $("#manualAlbumGenre").value = "";
  $("#manualAlbumYear").value = "";
  restoreManualAlbumDraft();
  updateManualAlbumSourceNotice();
  $("#manualAlbumStatus").textContent = "";
  $("#manualAlbumResults").replaceChildren();
  $("#manualAlbumDialog").showModal();
  $("#manualAlbumQuery").focus();
});

$("#manualAlbumSource").addEventListener("change", updateManualAlbumSourceNotice);
$("#manualAlbumSearchForm").addEventListener("submit", (event) => {
  if (event.submitter?.value !== "search") return;
  event.preventDefault();
  void searchManualAlbums(manualAlbumSearchInput());
});

$("#playlistForm").addEventListener("submit", (event) => {
  if (event.submitter?.value !== "import") return;
  event.preventDefault();
  const input = $("#playlistInput").value.trim();
  $("#playlistDialog").close();
  void importSpotifyPlaylist(input);
});

$("#playlistChoiceForm").addEventListener("submit", (event) => {
  if (event.submitter?.value === "choose" && !$("#playlistChoiceSelect").value) event.preventDefault();
});

function authHeaders() {
  const { token } = credentials();
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubFetch(url, options) {
  try {
    const response = await fetch(url, options);
    if (!response.ok && response.status !== 304 && response.status !== 404) {
      githubAvailability = `GitHub: ${serviceFailure({ response }, navigator.onLine)}`;
    } else githubAvailability = "GitHub: ultima richiesta raggiungibile (non e' un controllo attuale)";
    updateLocalSyncSummary();
    return response;
  } catch (error) {
    githubAvailability = `GitHub: ${serviceFailure(error, navigator.onLine)}`;
    updateLocalSyncSummary();
    throw error;
  }
}

function githubHttpError(message, response) {
  if (response.status === 429 || response.status === 403 && (
    response.headers.get("retry-after") || response.headers.get("x-ratelimit-remaining") === "0")) {
    message = "Limite GitHub / cooldown: attendi prima di riprovare.";
  }
  const error = new Error(message);
  error.response = response;
  githubAvailability = `GitHub: ${serviceFailure(error, navigator.onLine)}`;
  updateLocalSyncSummary();
  return error;
}

async function githubRequest(url, options = {}) {
  const response = await githubFetch(url, {
    ...options,
    headers: { ...authHeaders(), ...options.headers },
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    if (response.status === 409) throw githubHttpError("Repository modificato in parallelo. Rileggi e risolvi di nuovo i conflitti.", response);
    if (response.status === 429 || response.status === 403 && (
      response.headers.get("retry-after") || response.headers.get("x-ratelimit-remaining") === "0")) {
      throw githubHttpError("Limite GitHub / cooldown: attendi prima di riprovare.", response);
    }
    if ([401, 403, 404].includes(response.status)) {
      throw githubHttpError(`GitHub ha rifiutato l'accesso (HTTP ${response.status}). Verifica proprietario, repository privato e permessi Contents del token.`, response);
    }
    throw githubHttpError(`Errore GitHub HTTP ${response.status}.`, response);
  }
  return response.json();
}

async function readRemote(owner) {
  const repoUrl = `${API}/repos/${encodeURIComponent(owner)}/${REPOSITORY}`;
  const repository = await githubRequest(repoUrl);
  if (repository.private !== true) throw new Error("Il repository accord-music-data deve essere privato.");
  if (!repository.default_branch) throw new Error("GitHub non ha restituito il branch predefinito.");
  const branch = repository.default_branch;
  const fileUrl = `${repoUrl}/contents/albums.json?ref=${encodeURIComponent(branch)}`;
  const response = await githubFetch(fileUrl, { headers: authHeaders(), credentials: "omit", referrerPolicy: "no-referrer" });
  let albums = [];
  let sha = null;
  let legacyStatusesFound = false;
  if (response.status !== 404) {
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw githubHttpError(`Accesso al file rifiutato da GitHub (HTTP ${response.status}). Verifica il permesso Contents.`, response);
      throw githubHttpError(`Errore GitHub HTTP ${response.status} durante la lettura di albums.json.`, response);
    }
    const file = await response.json();
    if (file.type !== "file" || typeof file.content !== "string") throw new Error("albums.json non e' un file GitHub valido.");
    try {
      const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, "")), (char) => char.charCodeAt(0));
      const document = JSON.parse(new TextDecoder().decode(bytes));
      legacyStatusesFound = Array.isArray(document?.albums) && document.albums.some((album) =>
        album && normalizeAlbumStatus(album.status) !== album.status);
      albums = validateDocument(document);
      sha = file.sha;
    } catch (error) {
      throw new Error(`Il contenuto remoto non e' valido: ${error.message}`);
    }
  }
  const lastFmHistory = credentials().useSyncedLastFmHistory
    ? await readRemoteLastFmHistory(repoUrl, branch) : null;
  const coverUrl = `${repoUrl}/contents/covers.bin?ref=${encodeURIComponent(branch)}`;
  const metadataResponse = await githubFetch(coverUrl, {
    headers: authHeaders(), credentials: "omit", referrerPolicy: "no-referrer",
  });
  if (metadataResponse.status === 404) {
    return {
      albums, sha, branch, covers: new Map(), coversSha: null,
      coverArchive: new Uint8Array(), legacyStatusesFound, lastFmHistory,
      lastFmHistoryMissing: credentials().useSyncedLastFmHistory && !lastFmHistory,
    };
  }
  if (!metadataResponse.ok) {
    if ([401, 403].includes(metadataResponse.status)) throw githubHttpError(`Accesso a covers.bin rifiutato da GitHub (HTTP ${metadataResponse.status}). Verifica il permesso Contents.`, metadataResponse);
    throw githubHttpError(`Errore GitHub HTTP ${metadataResponse.status} durante la lettura di covers.bin.`, metadataResponse);
  }
  const metadata = await metadataResponse.json();
  if (metadata.type !== "file" || typeof metadata.sha !== "string") throw new Error("covers.bin non e' un file GitHub valido.");
  const rawResponse = await githubFetch(coverUrl, {
    headers: { ...authHeaders(), Accept: "application/vnd.github.raw+json" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!rawResponse.ok) throw githubHttpError(`Errore GitHub HTTP ${rawResponse.status} durante il download di covers.bin.`, rawResponse);
  const coverArchive = new Uint8Array(await rawResponse.arrayBuffer());
  const covers = await decodeCoverArchive(coverArchive);
  return {
    albums, sha, branch, covers, coversSha: metadata.sha, coverArchive, legacyStatusesFound,
    lastFmHistory,
    lastFmHistoryMissing: credentials().useSyncedLastFmHistory && !lastFmHistory,
  };
}

async function readRemoteLastFmHistory(repoUrl, branch) {
  const url = `${repoUrl}/contents/lastfm-history.json.gz?ref=${encodeURIComponent(branch)}`;
  const metadataResponse = await githubFetch(url, {
    headers: authHeaders(), credentials: "omit", referrerPolicy: "no-referrer",
  });
  if (metadataResponse.status === 404) return null;
  if (!metadataResponse.ok) {
    if ([401, 403].includes(metadataResponse.status)) {
      throw githubHttpError(`Accesso alla cronologia Last.fm rifiutato da GitHub (HTTP ${metadataResponse.status}). Verifica il permesso Contents.`, metadataResponse);
    }
    throw githubHttpError(`Errore GitHub HTTP ${metadataResponse.status} durante la lettura della cronologia Last.fm.`, metadataResponse);
  }
  const metadata = await metadataResponse.json();
  if (metadata.type !== "file" || typeof metadata.sha !== "string") {
    throw new Error("L'archivio della cronologia Last.fm su GitHub non e' un file valido.");
  }
  if (Number.isFinite(metadata.size) && metadata.size > MAX_LASTFM_HISTORY_ARCHIVE_BYTES) {
    throw new Error("La cronologia Last.fm supera il limite di 50 MB compresso.");
  }
  const rawResponse = await githubFetch(url, {
    headers: { ...authHeaders(), Accept: "application/vnd.github.raw+json" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!rawResponse.ok) {
    throw githubHttpError(`Errore GitHub HTTP ${rawResponse.status} durante il download della cronologia Last.fm.`, rawResponse);
  }
  const archive = new Uint8Array(await rawResponse.arrayBuffer());
  if (!archive.length || archive.length > MAX_LASTFM_HISTORY_ARCHIVE_BYTES) {
    throw new Error("Archivio Last.fm vuoto o superiore a 50 MB.");
  }
  if (typeof DecompressionStream !== "function") {
    throw new Error("Questo browser non supporta l'archivio Last.fm compresso. Aggiorna il browser.");
  }
  let stream;
  try {
    stream = new Blob([archive]).stream().pipeThrough(new DecompressionStream("gzip"));
  } catch (error) {
    throw new Error(`Impossibile decomprimere la cronologia Last.fm: ${error.message}`);
  }
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_LASTFM_HISTORY_JSON_BYTES) {
        await reader.cancel();
        throw new Error("La cronologia Last.fm supera il limite di 200 MB non compresso.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("supera il limite")) throw error;
    throw new Error(`Archivio Last.fm gzip danneggiato: ${error.message}`);
  }
  const raw = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.length;
  }
  let document;
  try {
    document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch (error) {
    throw new Error(`La cronologia Last.fm non è JSON UTF-8 valido: ${error.message}`);
  }
  return validateLastFmHistoryDocument(document);
}

function encodeBase64(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""));
}

async function writeRemote(owner, records, sha, branch) {
  const document = createSyncDocument(records);
  const bytes = new TextEncoder().encode(JSON.stringify(document, null, 2));
  const payload = { message: "Sync Accord album collection", content: encodeBase64(bytes), branch };
  if (sha) payload.sha = sha;
  await githubRequest(`${API}/repos/${encodeURIComponent(owner)}/${REPOSITORY}/contents/albums.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function writeRemoteCovers(owner, archive, sha, branch) {
  const payload = {
    message: "Sync Accord album cover thumbnails",
    content: encodeBase64(archive),
    branch,
  };
  if (sha) payload.sha = sha;
  await githubRequest(`${API}/repos/${encodeURIComponent(owner)}/${REPOSITORY}/contents/covers.bin`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function albumDescription(album) {
  if (!album) return "Album assente";
  return `${album.artist} · ${album.name} · voto ${album.rating ?? "—"} · generi ${album.genres.join(", ") || "—"} · collezioni ${album.collections.join(", ") || "—"} · tag ${album.tags.join(", ") || "—"} · ${labels[album.status]}`;
}

function chooseConflicts(conflicts) {
  const dialog = $("#conflictDialog");
  const list = $("#conflictList");
  list.replaceChildren();
  if (conflicts.some((conflict) => conflict.fields?.some(({ field }) => field === "notes"))) {
    const notice = document.createElement("p");
    notice.textContent = "Le versioni delle note in conflitto sono state conservate solo su questo dispositivo prima della scelta.";
    list.append(notice);
  }
  for (const conflict of conflicts) {
    const article = document.createElement("article");
    article.className = "conflict-card";
    const heading = document.createElement("h3");
    const album = conflict.local || conflict.remote || conflict.base;
    heading.textContent = `${album.name} · ${album.artist}`;
    article.append(heading);
    const comparison = document.createElement("table");
    comparison.className = "qol-conflict-table";
    const header = document.createElement("tr");
    for (const title of ["Campo in conflitto", "Base", "Questo dispositivo", "GitHub"]) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = title;
      header.append(cell);
    }
    comparison.append(header);
    const fields = conflict.fields || [...new Set([...albumFieldChanges(conflict.base, conflict.local),
      ...albumFieldChanges(conflict.base, conflict.remote)])].map((field) => ({
      field, base: conflict.base?.[field], local: conflict.local?.[field], remote: conflict.remote?.[field],
    }));
    const choices = {};
    for (const { field, base, local, remote } of fields) {
      const row = document.createElement("tr");
      const title = ({ rating: "Voto", status: "Stato", notes: "Note", genres: "Generi",
        primary_genre: "Genere principale", collections: "Collezioni", tags: "Tag" })[field] || field;
      for (const value of [title, ...[base, local, remote].map((entry) =>
        entry === undefined ? "Non presente" : JSON.stringify(entry))]) {
        const cell = document.createElement("td");
        cell.textContent = value ?? "-";
        row.append(cell);
      }
      comparison.append(row);
      const fieldset = document.createElement("fieldset");
      fieldset.setAttribute("aria-label", `Scelta ${title} per ${album.name}`);
      for (const [value, label] of [["local", "Mantieni questo dispositivo"], ["remote", "Usa GitHub"]]) {
        const choice = document.createElement("label");
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `conflict-${conflict.id}-${field}`;
        radio.value = value;
        radio.required = true;
        choice.append(radio, document.createTextNode(label));
        fieldset.append(choice);
      }
      const choiceCell = document.createElement("td");
      choiceCell.colSpan = 4;
      choiceCell.append(fieldset);
      const choiceRow = document.createElement("tr");
      choiceRow.append(choiceCell);
      comparison.append(choiceRow);
      choices[field] = true;
    }
    const scroll = document.createElement("div");
    scroll.className = "qol-comparison-scroll";
    scroll.append(comparison);
    article.append(scroll);
    list.append(article);
  }
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      if (dialog.returnValue !== "resolve") return resolve(null);
      const choices = {};
      for (const conflict of conflicts) {
        choices[conflict.id] = {};
        for (const { field } of conflict.fields || []) {
          const picked = dialog.querySelector(
            `input[name="conflict-${CSS.escape(conflict.id)}-${CSS.escape(field)}"]:checked`);
          if (!picked) return resolve(null);
          choices[conflict.id][field] = picked.value;
        }
      }
      resolve(choices);
    }, { once: true });
  });
}

function archiveAlbumNoteConflicts(conflicts, remoteRevision) {
  const entries = conflicts.flatMap((conflict) => (conflict.fields || [])
    .filter(({ field }) => field === "notes")
    .map(({ base, local, remote }) => ({
      albumId: conflict.id,
      base: { present: base !== null, value: base ?? "" },
      device: { present: local !== null, value: local ?? "" },
      github: { present: remote !== null, value: remote ?? "" },
      remoteRevision: remoteRevision || "",
    })));
  if (!entries.length) return 0;
  for (const entry of entries) {
    for (const version of [entry.base, entry.device, entry.github]) {
      if (redactDiagnostics(version.value) !== version.value) {
        throw new Error("Una nota sembra contenere una credenziale; rimuovila prima di archiviarla e scegliere il conflitto.");
      }
    }
  }
  let archive;
  try { archive = JSON.parse(localStorage.getItem(ALBUM_NOTE_CONFLICT_ARCHIVE_KEY) || "[]"); }
  catch (error) {
    throw new Error(`Archivio locale delle versioni delle note non leggibile; nessuna scelta applicata: ${error.message}`);
  }
  if (!Array.isArray(archive) || archive.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
    throw new Error("Archivio locale delle versioni delle note non valido; nessuna scelta applicata.");
  }
  for (const entry of archive) {
    for (const version of [entry.base, entry.device, entry.github]) {
      if (!version || typeof version.present !== "boolean" || typeof version.value !== "string"
          || redactDiagnostics(version.value) !== version.value) {
        throw new Error("Archivio locale delle versioni delle note non valido o contenente credenziali.");
      }
    }
  }
  const signature = (entry) => JSON.stringify(entry);
  const existing = new Set(archive.map(({ albumId, base, device, github, remoteRevision }) =>
    signature({ albumId, base, device, github, remoteRevision })));
  const additions = [];
  for (const entry of entries) {
    const key = signature(entry);
    if (!existing.has(key)) {
      additions.push({ ...entry, capturedAt: new Date().toISOString() });
      existing.add(key);
    }
  }
  if (additions.length) {
    try { localStorage.setItem(ALBUM_NOTE_CONFLICT_ARCHIVE_KEY, JSON.stringify([...archive, ...additions])); }
    catch (error) { throw new Error(`Impossibile conservare entrambe le versioni delle note localmente: ${error.message}`); }
  }
  return additions.length;
}

async function sync(choices = {}) {
  if (!commandGuard.acquire("sync")) { showFeedback("Sincronizzazione già in corso · nessun secondo invio"); return; }
  try { await performSync(choices); }
  finally {
    commandGuard.release("sync");
    if (automaticSyncQueued && credentials().owner && credentials().token) {
      automaticSyncQueued = false;
      queueMicrotask(() => void sync());
    }
  }
}

async function performSync(choices = {}, resolvedConflicts = 0) {
  const { owner, token } = credentials();
  if (!owner || !token) {
    openSettings();
    return;
  }
  $("#syncButton").disabled = true;
  setSyncState("Sincronizzazione in corso…");
  const completedRemoteWrites = [];
  let localStateApplied = false;
  try {
    if (state.loadError) throw new Error(`Archivio locale non leggibile: ${state.loadError}`);
    const storedSnapshot = localStorage.getItem(STORAGE_KEY);
    const assertSyncCurrent = () => {
      if (localStorage.getItem(STORAGE_KEY) !== storedSnapshot) {
        throw new Error("La raccolta salvata o la base sono cambiate in un'altra scheda. Nessuna sovrascrittura locale; riapri Sincronizza.");
      }
    };
    if (localCollectionStatus(localStorage, STORAGE_KEY, state, normalizeLocalAlbums).unsaved) {
      throw new Error("Sono presenti modifiche non salvate o una raccolta diversa in un'altra scheda. Risolvi il salvataggio locale prima di sincronizzare.");
    }
    const remote = await readRemote(owner);
    let historySyncNote = "";
    if (remote.lastFmHistory) {
      const history = await cacheLastFmHistory(remote.lastFmHistory);
      historySyncNote = ` · Last.fm ${history.scrobbles.length.toLocaleString()} ascolti fino al ${new Date(history.coverage[0][1] * 1000).toLocaleDateString()}`;
    } else if (remote.lastFmHistoryMissing) {
      historySyncNote = " · esportazione Last.fm Desktop non trovata";
    }
    const merged = threeWayMerge(state.base, state.albums, remote.albums, choices);
    if (merged.conflicts.length) {
      setSyncState(`${merged.conflicts.length} conflitto${merged.conflicts.length === 1 ? "" : "i"}`);
      archiveAlbumNoteConflicts(merged.conflicts, remote.sha);
      const resolutions = await chooseConflicts(merged.conflicts);
      if (!resolutions) {
        setSyncState(`Sincronizzazione annullata · ${merged.conflicts.length} conflitti non risolti`);
        return;
      }
      await performSync(resolutions, resolvedConflicts + merged.conflicts.length);
      return;
    }
    const outgoing = albumChanges(remote.albums, merged.albums);
    const incoming = albumChanges(state.albums, merged.albums);
    const changedIds = new Set([...outgoing, ...incoming].map((change) => change.id));
    const summary = {
      toGitHub: outgoing.length,
      toDevice: incoming.length,
      unchanged: merged.albums.filter((album) => !changedIds.has(album.id)).length,
      conflictsResolved: resolvedConflicts,
    };
    const snapshot = JSON.stringify(state.albums);
    if ((outgoing.length || incoming.length) && !await confirmSyncChanges(outgoing, incoming, merged.albums)) {
      setSyncState("Sincronizzazione annullata: nessuna scrittura eseguita");
      return;
    }
    if (JSON.stringify(state.albums) !== snapshot) throw new Error("La raccolta e' cambiata durante l'anteprima. Riapri Sincronizza.");
    assertSyncCurrent();
    const selectedCovers = new Map();
    for (const album of merged.albums) {
      if (!album.cover_sha256) continue;
      const localCover = await getCachedCover(album.id);
      if (localCover) {
        const localDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", localCover));
        const localHash = [...localDigest].map((value) => value.toString(16).padStart(2, "0")).join("");
        if (localHash === album.cover_sha256) {
          selectedCovers.set(album.id, localCover);
          continue;
        }
      }
      const remoteCover = remote.covers.get(album.id);
      if (!remoteCover || remoteCover.hash !== album.cover_sha256) {
        throw new Error(`Miniatura non verificabile per ${album.artist} · ${album.name}. Nessun dato è stato applicato. Avvia “Sincronizza ora” in Accord desktop per caricare le miniature, poi riprova.`);
      }
      selectedCovers.set(album.id, remoteCover.data);
    }
    for (const [id, cover] of selectedCovers) await cacheCover(id, cover);
    const updatedCoverArchive = selectedCovers.size ? await encodeCoverArchive(selectedCovers) : new Uint8Array();
    const coversChanged = updatedCoverArchive.length > 0
      && (updatedCoverArchive.length !== remote.coverArchive.length
        || updatedCoverArchive.some((value, index) => value !== remote.coverArchive[index]));
    if (coversChanged) {
      assertSyncCurrent();
      await writeRemoteCovers(owner, updatedCoverArchive, remote.coversSha, remote.branch);
      completedRemoteWrites.push("copertine");
    }
    const remoteState = JSON.stringify(remote.albums);
    const finalState = JSON.stringify(merged.albums);
    if (finalState !== remoteState || remote.legacyStatusesFound) {
      assertSyncCurrent();
      await writeRemote(owner, merged.albums, remote.sha, remote.branch);
      completedRemoteWrites.push("elenco album");
    }
    assertSyncCurrent();
    commitLocalRestore(localStorage, STORAGE_KEY, state,
      { ...state, albums: merged.albums, base: merged.albums }, {}, null);
    localStateApplied = true;
    const syncAt = new Date().toISOString();
    const summarySaved = saveCollectionQol({ ...qol, lastSync: syncAt, lastSyncSummary: summary });
    updateLocalSyncSummary();
    render();
    setSyncState(`${formatSyncSummary(summary)}${historySyncNote} · ${new Date(syncAt).toLocaleTimeString()}`);
    if (!summarySaved) {
      showFeedback("Sincronizzazione completata, ma il riepilogo non è stato salvato localmente.", true);
    }
  } catch (error) {
    automaticSyncQueued = false;
    const partial = completedRemoteWrites.length > 0;
    const failure = serviceFailure(error, navigator.onLine);
    setSyncState(partial ? `Sincronizzazione parziale · ${failure}` : failure);
    updateLocalSyncSummary();
    const completion = partial
      ? `GitHub ha confermato: ${completedRemoteWrites.join(", ")}. `
        + (localStateApplied ? "La raccolta locale è aggiornata. " : "La raccolta locale non è stata aggiornata. ")
      : "";
    showMessage(partial ? "Sincronizzazione parziale" : "Sincronizzazione non completata",
      `${completion}${error.message}\nNessun nuovo invio automatico. Se la scrittura ha avuto esito incerto, verifica i file nel repository GitHub e le modifiche locali prima di avviare una nuova sincronizzazione.`);
  } finally {
    $("#syncButton").disabled = false;
  }
}

$("#syncButton").addEventListener("click", () => sync());
$("#conflictForm").addEventListener("submit", (event) => {
  if (event.submitter?.value === "resolve") {
    const missing = [...$("#conflictList").querySelectorAll("fieldset")].some((fieldset) => !fieldset.querySelector(":checked"));
    if (missing) event.preventDefault();
  }
});

const spotifySuggestionPreferences = {
  "#spotifyExcludeArtists": "accord-spotify-suggestion-exclude-artists",
  "#spotifyIncludeGenres": "accord-spotify-suggestion-include-genres",
  "#spotifyExcludeGenres": "accord-spotify-suggestion-exclude-genres",
  "#spotifyIncludeGenresMatch": "accord-spotify-suggestion-include-genres-match",
  "#spotifyExcludeGenresMatch": "accord-spotify-suggestion-exclude-genres-match",
};
const savedSpotifyPeriod = localStorage.getItem("accord-spotify-suggestion-period") || "medium_term";
const savedSpotifyExclusion = localStorage.getItem("accord-spotify-suggestion-exclusion") || "medium_term";
$("#spotifySuggestionPeriod").value = spotifyTimeRanges.has(savedSpotifyPeriod) ? savedSpotifyPeriod : "medium_term";
$("#spotifySuggestionExclusion").value = ["none", ...spotifyTimeRanges].includes(savedSpotifyExclusion)
  ? savedSpotifyExclusion : "medium_term";
for (const [selector, key] of Object.entries(spotifySuggestionPreferences)) {
  const input = $(selector);
  const saved = localStorage.getItem(key) || "";
  const matchingMode = selector.endsWith("Match");
  input.value = matchingMode ? saved === "contains" ? "contains" : "exact" : saved;
  input.addEventListener("change", () => localStorage.setItem(key, input.value.trim()));
}
$("#spotifySuggestionPeriod").addEventListener("change", (event) =>
  localStorage.setItem("accord-spotify-suggestion-period", event.currentTarget.value));
$("#spotifySuggestionExclusion").addEventListener("change", (event) =>
  localStorage.setItem("accord-spotify-suggestion-exclusion", event.currentTarget.value));

const lastFmSuggestionPreferences = {
  "#lastfmSuggestionUser": "accord-lastfm-suggestion-user",
  "#lastfmSuggestionStart": "accord-lastfm-suggestion-start",
  "#lastfmSuggestionEnd": "accord-lastfm-suggestion-end",
  "#lastfmExcludeArtists": "accord-lastfm-suggestion-exclude-artists",
  "#lastfmIncludeGenres": "accord-lastfm-suggestion-include-genres",
  "#lastfmExcludeGenres": "accord-lastfm-suggestion-exclude-genres",
  "#lastfmIncludeGenresMatch": "accord-lastfm-suggestion-include-genres-match",
  "#lastfmExcludeGenresMatch": "accord-lastfm-suggestion-exclude-genres-match",
};
const savedSuggestionPeriod = localStorage.getItem("accord-lastfm-suggestion-days") || "30";
const suggestionPeriods = new Set(["7", "30", "90", "365", "all", "custom"]);
const legacyDays = Number(savedSuggestionPeriod);
const initialSuggestionPeriod = suggestionPeriods.has(savedSuggestionPeriod) ? savedSuggestionPeriod
  : Number.isInteger(legacyDays) && legacyDays >= 1 && legacyDays <= 3650 ? "custom" : "30";
const savedExclusionPeriod = localStorage.getItem("accord-lastfm-suggestion-exclusion") || "all";
const exclusionPeriods = new Set(["none", "30", "90", "365", "all"]);
const initialExclusionPeriod = exclusionPeriods.has(savedExclusionPeriod) ? savedExclusionPeriod : "all";
const dateValue = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, "0"),
  String(date.getDate()).padStart(2, "0"),
].join("-");
const today = new Date();
const todayValue = dateValue(today);
const defaultStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
defaultStart.setDate(defaultStart.getDate() - (
  initialSuggestionPeriod === "custom" && Number.isInteger(legacyDays) ? legacyDays : 30));
$("#lastfmSuggestionDays").value = initialSuggestionPeriod;
$("#lastfmSuggestionExclusion").value = initialExclusionPeriod;
$("#lastfmSuggestionStart").max = todayValue;
$("#lastfmSuggestionEnd").max = todayValue;
if (initialSuggestionPeriod !== savedSuggestionPeriod) {
  localStorage.setItem("accord-lastfm-suggestion-days", initialSuggestionPeriod);
}
for (const [selector, key] of Object.entries(lastFmSuggestionPreferences)) {
  const input = $(selector);
  const saved = localStorage.getItem(key);
  const matchingMode = selector === "#lastfmIncludeGenresMatch" || selector === "#lastfmExcludeGenresMatch";
  input.value = matchingMode
    ? saved === "contains" ? "contains" : "exact"
    : saved
    || (selector === "#lastfmSuggestionStart" ? dateValue(defaultStart)
      : selector === "#lastfmSuggestionEnd" ? todayValue : "");
  input.addEventListener("change", () => localStorage.setItem(key, input.value.trim()));
}
const suggestionPeriodControl = $("#lastfmSuggestionDays");
const suggestionExclusionControl = $("#lastfmSuggestionExclusion");
const suggestionDateRange = $("#lastfmSuggestionCustomRange");
suggestionDateRange.hidden = suggestionPeriodControl.value !== "custom";
suggestionPeriodControl.addEventListener("change", () => {
  localStorage.setItem("accord-lastfm-suggestion-days", suggestionPeriodControl.value);
  suggestionDateRange.hidden = suggestionPeriodControl.value !== "custom";
});
suggestionExclusionControl.addEventListener("change", () => {
  localStorage.setItem("accord-lastfm-suggestion-exclusion", suggestionExclusionControl.value);
});
let catalogSuggestionsUI = null;
let catalogPlaylistUI = null;
const suggestionToolControl = $("#suggestionTool");
const savedSuggestionTool = localStorage.getItem("accord-music-suggestion-tool") || "spotify";
suggestionToolControl.value = ["spotify", "lastfm"].includes(savedSuggestionTool) ? savedSuggestionTool : "spotify";

function updateSuggestionToolUi() {
  if (musicService.service !== "spotify") { catalogSuggestionsUI?.configure(); return; }
  const spotify = suggestionToolControl.value === "spotify";
  $(".spotify-suggestions").hidden = !spotify;
  $(".lastfm-suggestions").hidden = spotify;
  $("#suggestionToolHelp").textContent = spotify
    ? "Scopri album ispirati ai tuoi ascolti Spotify."
    : credentials().useSyncedLastFmHistory
      ? "Scopri album dai tuoi ascolti Last.fm, usando anche l’archivio sincronizzato."
      : "Scopri album dai tuoi ascolti Last.fm nel periodo scelto.";
}

suggestionToolControl.addEventListener("change", () => {
  if (musicService.service !== "spotify") return;
  localStorage.setItem("accord-music-suggestion-tool", suggestionToolControl.value);
  updateSuggestionToolUi();
});
$("#suggestionSearchButton").addEventListener("click", async (event) => {
  if (musicService.service !== "spotify") { await catalogSuggestionsUI.run(); return; }
  const button = event.currentTarget;
  button.disabled = true;
  suggestionToolControl.disabled = true;
  try {
    if (suggestionToolControl.value === "spotify") await suggestSpotifyAlbums(button);
    else await suggestListeningAlbums(button);
  } finally {
    button.disabled = false;
    suggestionToolControl.disabled = false;
  }
});
updateSuggestionToolUi();

function applyAccessibility() {
  const preferences = normalizeAccessibility(collectionPreferences);
  for (const [key, value] of Object.entries(preferences)) document.documentElement.dataset[key] = value;
  $("#textScaleInput").value = preferences.textScale;
  $("#contrastInput").value = preferences.contrast;
  $("#densityInput").value = preferences.density;
}
for (const selector of ["#textScaleInput", "#contrastInput", "#densityInput"]) {
  $(selector).addEventListener("change", () => {
    saveCollectionPreferences({ ...collectionPreferences,
      textScale: $("#textScaleInput").value, contrast: $("#contrastInput").value, density: $("#densityInput").value });
    applyAccessibility();
  });
}

function openSpotifyAlbumIntent(input) {
  const intent = spotifyAlbumIntent(input);
  const existing = state.albums.find((album) => album.id === intent.id);
  if (existing) {
    activateViewTab($("#collectionTab"));
    openAlbumDetails(existing.id);
    return;
  }
  if (qol.drafts.manual && !window.confirm("Una bozza di ricerca manuale è presente. Sostituirla con questo link?")) return;
  $("#manualAlbumButton").click();
  $("#manualAlbumSource").value = "spotify";
  $("#manualAlbumQuery").value = intent.url;
  for (const selector of manualDraftSelectors.slice(2)) $(selector).value = "";
  updateManualAlbumSourceNotice();
  if (!saveAlbumDraft("manual", Object.fromEntries(manualDraftSelectors.map((selector) => [selector, $(selector).value])))) {
    showFeedback("Link preparato ma bozza non salvata. Non chiudere prima di risolvere l'errore.", true);
  }
  $("#manualAlbumStatus").textContent = "Album non presente localmente. Premi Cerca per autorizzare la ricerca Spotify; nessuna richiesta ancora eseguita.";
}
function openTidalAlbumIntent(input) {
  const id = tidalAlbumId(input), album = state.albums.find((record) => record.id === `tidal:${id}`);
  if (album) { activateViewTab($("#collectionTab")); openAlbumDetails(album.id); }
  else {
    tidalUI.openCatalog(`https://tidal.com/browse/album/${id}`);
    showFeedback("Album non presente localmente. Premi Leggi album dal link / ID: nessuna richiesta avviata.");
  }
}
function openQobuzAlbumIntent(input) {
  const id = qobuzAlbumId(input), album = state.albums.find((record) => record.id === `qobuz:${id}`);
  if (album) { activateViewTab($("#collectionTab")); openAlbumDetails(album.id); }
  else {
    qobuzUI.openCatalog(`https://play.qobuz.com/album/${id}`);
    showFeedback("Album non presente localmente. Premi Leggi ID / link album: nessuna richiesta avviata.");
  }
}
$("#openSpotifyForm").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    if (musicService.service === "qobuz") openQobuzAlbumIntent($("#openSpotifyInput").value);
    else if (musicService.service === "tidal") openTidalAlbumIntent($("#openSpotifyInput").value);
    else openSpotifyAlbumIntent($("#openSpotifyInput").value);
  }
  catch (error) { showFeedback(error.message, true); }
});

function receiveSharedAlbum() {
  const url = new URL(location.href);
  const keys = ["share_url", "share_text", "share_title"];
  if (!keys.some((key) => url.searchParams.has(key))) return;
  const input = keys.map((key) => url.searchParams.get(key) || "").join(" ");
  for (const key of keys) url.searchParams.delete(key);
  history.replaceState(history.state, "", url);
  try {
    if (musicService.service === "qobuz") {
      const link = input.match(/https:\/\/play\.qobuz\.com\/album\/[A-Za-z0-9]+/)?.[0] || input;
      openQobuzAlbumIntent(link);
      return;
    }
    if (musicService.service === "tidal") {
      const link = input.match(/https:\/\/(?:www\.)?tidal\.com\/(?:browse\/)?album\/[1-9][0-9]*(?:[/?#][^\s]*)?/)?.[0] || input;
      openTidalAlbumIntent(link);
      return;
    }
    const intent = spotifyAlbumIntent(input);
    $("#openSpotifyInput").value = intent.url;
    if (state.albums.some((album) => album.id === intent.id)) openSpotifyAlbumIntent(intent.url);
    else {
      activateViewTab($("#collectionTab"));
      $("#openSpotifyInput").focus();
      showFeedback("Link condiviso ricevuto. Premi Apri album / prepara ricerca, poi Cerca per andare online.");
    }
  } catch (error) { showFeedback(`Condivisione non aperta: ${error.message}`, true); }
}

function localBackupDocument() {
  const listeningQueue = JSON.parse(localStorage.getItem(LISTENING_QUEUE_KEY)
    || '{"ids":[],"resume":"","durations":{}}');
  const durations = JSON.parse(localStorage.getItem(ALBUM_DURATIONS_KEY) || "{}");
  return createLocalBackup(state.albums, collectionPreferences, validateAlbum, {
    manualOrder: state.manualOrder, listeningQueue, durations,
    suggestionRecipes: JSON.parse(localStorage.getItem(SUGGESTION_RECIPES_KEY) || "[]"),
    completionProvenance: JSON.parse(localStorage.getItem(COMPLETION_PROVENANCE_KEY) || "{}"),
    completionEvidence: JSON.parse(localStorage.getItem(COMPLETION_EVIDENCE_KEY) || "{}"),
  });
}

async function backupReminderHashes(backup) {
  const entries = backupReminderItems(backup);
  const result = {};
  for (const [key, value] of Object.entries(entries)) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
    result[key] = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return result;
}

async function updateBackupStatus() {
  const status = $("#backupStatus");
  try {
    const saved = JSON.parse(localStorage.getItem(BACKUP_SUCCESS_KEY) || "null");
    if (!saved?.createdAt || !saved?.items || typeof saved.items !== "object") {
      status.textContent = "Ultimo backup riuscito non verificabile: il browser non ha confermato il salvataggio file.";
      return;
    }
    const current = await backupReminderHashes(localBackupDocument());
    const keys = new Set([...Object.keys(saved.items), ...Object.keys(current)]);
    const changed = [...keys].filter((key) => saved.items[key] !== current[key]).length;
    const date = new Date(saved.createdAt);
    if (!Number.isFinite(date.getTime())) throw new Error("Data ultimo backup non valida.");
    status.textContent = `Ultimo backup riuscito e verificato: ${date.toLocaleString()}.`
      + (changed >= 5 ? ` Da allora sono cambiati ${changed} elementi locali inclusi: crea un nuovo backup.` : "");
  } catch (error) {
    status.textContent = `Stato backup non verificabile: ${error.message}`;
  }
}

$("#viewMenu").addEventListener("toggle", () => {
  if ($("#viewMenu").open) void updateBackupStatus();
});

$("#backupButton").addEventListener("click", async () => {
  try {
    if (state.loadError) throw new Error(state.loadError);
    const backup = localBackupDocument();
    const contents = JSON.stringify(backup, null, 2);
    if (typeof window.showSaveFilePicker !== "function") {
      const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `accord-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $("#backupStatus").textContent = "Download avviato. Questo browser non può attestare il salvataggio del file; "
        + "la data dell'ultimo backup verificato non è stata aggiornata.";
      return;
    }
    const handle = await window.showSaveFilePicker({
      suggestedName: `accord-backup-${new Date().toISOString().slice(0, 10)}.json`,
      types: [{ description: "Backup locale Accord", accept: { "application/json": [".json"] } }],
    });
    const writable = await handle.createWritable();
    try {
      await writable.write(contents);
      await writable.close();
    } catch (error) {
      await writable.abort?.();
      throw error;
    }
    const items = await backupReminderHashes(backup);
    localStorage.setItem(BACKUP_SUCCESS_KEY, JSON.stringify({ createdAt: new Date().toISOString(), items }));
    await updateBackupStatus();
    showFeedback("Backup locale scritto e chiuso con successo; non caricato nel cloud. "
      + "Esclusi account, credenziali, bozze, ricerche, checkpoint, cronologia e cache.");
  } catch (error) {
    $("#backupStatus").textContent = error.name === "AbortError" ? "Salvataggio backup annullato."
      : `Backup non verificato: ${error.message}`;
    showFeedback(`Backup non verificato: ${error.message}`, error.name !== "AbortError");
  }
});

$("#verifyBackupButton").addEventListener("click", () => $("#verifyBackupInput").click());
$("#verifyBackupInput").addEventListener("change", async (event) => {
  const file = event.currentTarget.files[0];
  event.currentTarget.value = "";
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error("Il backup supera il limite locale di 10 MB.");
    const backup = validateLocalBackup(JSON.parse(await file.text()), validateDocument);
    $("#backupStatus").textContent = `File verificato in sola lettura · ${backup.albums.length} album · `
      + `${backup.suggestionRecipes.length} ricette. Nessun dato è stato ripristinato o modificato.`;
  } catch (error) {
    $("#backupStatus").textContent = `File non verificato: ${error.message}`;
    showFeedback(`Backup non verificato: ${error.message}`, true);
  }
});

function previewLocalRestore(backup) {
  const snapshot = JSON.stringify({
    state, queue: localStorage.getItem(LISTENING_QUEUE_KEY), durations: localStorage.getItem(ALBUM_DURATIONS_KEY),
    recipes: localStorage.getItem(SUGGESTION_RECIPES_KEY),
    completionProvenance: localStorage.getItem(COMPLETION_PROVENANCE_KEY),
    completionEvidence: localStorage.getItem(COMPLETION_EVIDENCE_KEY),
  });
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "Anteprima ripristino selettivo");
  const title = document.createElement("h2");
  title.textContent = "Ripristino locale selettivo";
  const notice = document.createElement("p");
  notice.textContent = "Spunta solo gli album da aggiungere o sostituire. Gli altri restano invariati. Nessuna cancellazione, sincronizzazione o ricerca online. Bozze e credenziali restano escluse.";
  const list = document.createElement("div");
  list.className = "restore-album-list";
  const selected = new Set();
  const preview = document.createElement("pre");
  preview.className = "qol-details";
  const preferences = document.createElement("input");
  preferences.type = "checkbox";
  const preferenceLabel = document.createElement("label");
  preferenceLabel.className = "check";
  preferenceLabel.append(preferences, " Ripristina anche layout, album fissati e accessibilità");
  const restoreMusicData = document.createElement("input");
  restoreMusicData.type = "checkbox";
  const musicDataLabel = document.createElement("label");
  musicDataLabel.className = "check";
  musicDataLabel.append(restoreMusicData,
    " Sostituisci coda, durate e dati musicali consentiti (ricette, provenienza/evidenze)");
  const accept = document.createElement("button");
  accept.type = "button";
  accept.textContent = "Conferma ripristino selezionati";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Annulla";
  const errorOutput = document.createElement("p");
  errorOutput.setAttribute("role", "alert");
  const updatePreview = () => {
    const next = prepareSelectiveRestore(state.albums, backup, selected, validateAlbum);
    const changes = albumChanges(state.albums, next);
    const nextIds = new Set(next.map((album) => album.id));
    const missingQueueAlbums = restoreMusicData.checked
      ? backup.listeningQueue.ids.filter((id) => !nextIds.has(id)) : [];
    preview.textContent = `${selected.size} selezionati · ${changes.length} modifiche effettive\n${
      changesText(changes) || "Nessuna modifica agli album."}\n${
      preferences.checked ? `Preferenze: ${JSON.stringify(backup.preferences)}\n` : ""}${
      restoreMusicData.checked ? `Coda: ${backup.listeningQueue.ids.length} album · durate: ${
        Object.keys(backup.durations).length} · ricette: ${backup.suggestionRecipes.length}\n` : ""}${
      missingQueueAlbums.length ? `Album di coda non presenti dopo il ripristino: ${missingQueueAlbums.length}.\n` : ""
    }Le bozze esistenti non vengono applicate né eliminate.`;
    accept.disabled = (!selected.size && !preferences.checked && !restoreMusicData.checked)
      || missingQueueAlbums.length > 0;
  };
  for (const album of backup.albums) {
    const label = document.createElement("label");
    label.className = "check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", () => {
      if (input.checked) selected.add(album.id);
      else selected.delete(album.id);
      updatePreview();
    });
    const existing = state.albums.find((entry) => entry.id === album.id);
    label.append(input, `${album.artist} · ${album.name} · ${existing ? "sostituisci" : "aggiungi"}${
      qol.drafts[`edit:${album.id}`] ? " · bozza locale conservata" : ""}`);
    list.append(label);
  }
  preferences.addEventListener("change", updatePreview);
  restoreMusicData.addEventListener("change", updatePreview);
  accept.addEventListener("click", () => {
    try {
      if (state.loadError) throw new Error(state.loadError);
      if (JSON.stringify({
        state, queue: localStorage.getItem(LISTENING_QUEUE_KEY), durations: localStorage.getItem(ALBUM_DURATIONS_KEY),
        recipes: localStorage.getItem(SUGGESTION_RECIPES_KEY),
        completionProvenance: localStorage.getItem(COMPLETION_PROVENANCE_KEY),
        completionEvidence: localStorage.getItem(COMPLETION_EVIDENCE_KEY),
      }) !== snapshot) throw new Error("Raccolta, coda o durate sono cambiate durante l'anteprima. Annulla e riapri il backup.");
      const albums = prepareSelectiveRestore(state.albums, backup, selected, validateAlbum);
      const manualOrder = [...new Set([
        ...state.manualOrder.filter((id) => !selected.has(id)),
        ...backup.manualOrder.filter((id) => selected.has(id)),
        ...albums.filter((album) => selected.has(album.id)).map((album) => album.id),
      ])];
      const next = { ...state, albums,
        manualOrder,
        preferences: preferences.checked ? backup.preferences : collectionPreferences };
      const related = restoreMusicData.checked ? {
        [LISTENING_QUEUE_KEY]: { ...backup.listeningQueue },
        [ALBUM_DURATIONS_KEY]: Object.fromEntries(Object.entries(backup.durations)
          .filter(([id]) => albums.some((album) => album.id === id))),
        ...(backup.version === 3 ? {
          [SUGGESTION_RECIPES_KEY]: backup.suggestionRecipes,
          [COMPLETION_PROVENANCE_KEY]: Object.fromEntries(Object.entries(backup.completionProvenance)
            .filter(([id]) => albums.some((album) => album.id === id))),
          [COMPLETION_EVIDENCE_KEY]: Object.fromEntries(Object.entries(backup.completionEvidence)
            .filter(([id]) => albums.some((album) => album.id === id))),
        } : {}),
      } : {};
      commitLocalRestore(localStorage, STORAGE_KEY, state, next, related, "Ripristino backup locale");
      collectionPreferences = portablePreferences(state.preferences);
      $("#collectionLayout").value = collectionPreferences.layout;
      $("#albumList").dataset.layout = collectionPreferences.layout;
      applyAccessibility();
      updateLocalSyncSummary();
      dialog.close();
      rememberLocalChanges(selected);
      render();
      showFeedback("Ripristino locale completato. Nessun invio a GitHub e nessuna richiesta musicale.");
    } catch (error) { errorOutput.textContent = `Ripristino non applicato: ${error.message}`; }
  });
  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.append(title, notice, list, preferenceLabel, musicDataLabel, preview, errorOutput, accept, cancel);
  document.body.append(dialog);
  updatePreview();
  dialog.showModal();
}
$("#restoreBackupInput").addEventListener("change", async (event) => {
  const file = event.currentTarget.files[0];
  event.currentTarget.value = "";
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error("Il backup supera il limite locale di 10 MB.");
    const backup = validateLocalBackup(JSON.parse(await file.text()), validateDocument);
    previewLocalRestore(backup);
  } catch (error) { showFeedback(`Backup non aperto: ${error.message}`, true); }
});

const activityEntries = [];
const busyActivitySelectors = ["#syncButton", "#playlistPreviewButton", "#suggestionSearchButton", "#manualAlbumSearchButton"];
const activityStatusNodes = [...document.querySelectorAll("[role='status'], [role='alert'], #suggestionStatus, #manualAlbumStatus")]
  .filter((node) => !["updateBanner", "updateStatus"].includes(node.id));
function renderActivity() {
  const deadline = Number(localStorage.getItem("accord-spotify-rate-limit-until-v1"));
  $("#activityCooldown").textContent = deadline > Date.now()
    ? `Spotify in attesa fino a ${new Date(deadline).toLocaleTimeString()}. Nessun tentativo anticipato.`
    : "Nessun cooldown Spotify attivo noto. Stato aggiornato solo su eventi o apertura, senza polling.";
  const current = activityStatusNodes.filter((node) => node.id !== "feedbackToast" && !node.hidden && node.textContent.trim());
  const work = busyActivitySelectors.map((selector) => $(selector)).filter((button) => button.disabled);
  $("#activityCurrent").replaceChildren(...work.map((button) => {
    const item = document.createElement("li");
    item.textContent = `In corso: ${button.textContent.trim()}`;
    return item;
  }), ...current.map((node) => {
    const item = document.createElement("li");
    item.textContent = userFacingStatus(safeDiagnostics(node.textContent));
    return item;
  }));
  $("#activityHistory").replaceChildren(...activityEntries.map((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    return item;
  }));
}
function recordActivity(text) {
  text = safeDiagnostics(text);
  if (!text || activityEntries[0]?.endsWith(` · ${text}`)) return;
  activityEntries.unshift(`${new Date().toLocaleTimeString()} · ${text}`);
  activityEntries.splice(30);
  if ($("#activityDialog").open) renderActivity();
}
const activityObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    const node = activityStatusNodes.find((entry) => entry === mutation.target || entry.contains(mutation.target));
    if (node) recordActivity(node.textContent.trim());
  }
});
for (const node of activityStatusNodes) activityObserver.observe(node, { childList: true, subtree: true, characterData: true });
const busyObserver = new MutationObserver(() => { if ($("#activityDialog").open) renderActivity(); });
for (const selector of busyActivitySelectors) busyObserver.observe($(selector), { attributes: true, attributeFilter: ["disabled"] });
const errorObserver = new MutationObserver(() => {
  if ($("#messageDialog").open) recordActivity(`${$("#messageTitle").textContent}: ${$("#messageBody").textContent}`);
});
errorObserver.observe($("#messageDialog"), { attributes: true, attributeFilter: ["open"] });
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button && !button.closest("#activityDialog")) recordActivity(`Scelta: ${button.textContent.trim() || button.getAttribute("aria-label")}`);
});
window.addEventListener("storage", (event) => {
  if (event.key === "accord-spotify-rate-limit-until-v1" && $("#activityDialog").open) renderActivity();
});
$("#activityButton").addEventListener("click", () => {
  renderActivity();
  $("#activityDialog .error-actions")?.remove();
  const actions = document.createElement("div");
  actions.className = "qol-actions error-actions";
  appendErrorActions(actions, activityStatusNodes.filter((node) => !node.hidden)
    .map((node) => node.textContent).concat(activityEntries).join("\n"), () => $("#activityDialog").close(), "activity");
  $("#activityDialog").append(actions);
  $("#activityDialog").showModal();
});
$("#closeActivityButton").addEventListener("click", () => $("#activityDialog").close());

function presentUpdateBanner() {
  $("#updateBanner").hidden = false;
  $("#showUpdateButton").hidden = false;
  recordActivity("Aggiornamento disponibile; attivazione solo su scelta esplicita.");
}
$("#deferUpdateButton").addEventListener("click", () => {
  updateLifecycle.defer();
  $("#updateBanner").hidden = true;
});
$("#showUpdateButton").addEventListener("click", () => {
  $("#updateBanner").hidden = false;
  $("#activityDialog").close();
});
function updateHasUnsavedWork() {
  if (commandGuard.isBusy()) return true;
  if (!$("#qolStorageError").hidden) return true;
  if ([...$("#albumList").querySelectorAll(".album-card")].some((card) => {
    const album = state.albums.find((record) => record.id === card.dataset.albumId);
    return album && [[".genres-input", album.genres], [".collections-input", album.collections], [".tags-input", album.tags]]
      .some(([selector, values]) => card.querySelector(selector)?.value !== values.join(", "));
  })) return true;
  if (localSaveError || state.loadError || localCollectionStatus(localStorage, STORAGE_KEY, state, normalizeLocalAlbums).unsaved) return true;
  return Object.keys(qol.drafts).length > 0
    || [...document.querySelectorAll("dialog")].some((dialog) => dialog.open && dialog.id !== "activityDialog")
    || busyActivitySelectors.some((selector) => $(selector).disabled)
    || $("#loadCoversButton").disabled
    || Boolean(document.querySelector("[aria-busy='true']"))
    || catalogSuggestionsUI?.isBusy() || catalogPlaylistUI?.isBusy() || tidalUI.isBusy() || qobuzUI.isBusy()
    || [...document.querySelectorAll("audio, video")].some((media) => !media.paused);
}
const updateLifecycle = createUpdateLifecycle({
  hasWork: updateHasUnsavedWork,
  confirm: () => window.confirm("Riavviare con la nuova versione? I dati salvati nel browser restano locali: questo non sincronizza GitHub."),
  reload: () => location.reload(),
  present: presentUpdateBanner,
  status: (text, chosen) => {
    $("#applyUpdateButton").disabled = chosen;
    $("#updateStatus").textContent = text;
  },
  prepare: () => {
    const session = { fields: Object.fromEntries(collectionViewSelectors.map((selector) => [selector, $(selector).value])),
      appliedSearch: appliedCollectionSearch, pinnedOnly: $("#pinnedOnlyInput").checked, scrollY: $("#albumList").scrollTop,
      playlist: { name: $("#playlistBuilderName").value, artists: $("#playlistArtistCount").value,
        tracks: $("#playlistTracksPerArtist").value, preview: topArtistPlaylistPreview },
      openSpotify: $("#openSpotifyInput").value, selectedIds: [...selectedAlbumIds],
      localChecks: localCollectionChecks.map((selector) => $(selector).checked),
      selectionOnly: collectionSelectionOnly,
      facet: localFacet, facetReturnViews };
    sessionStorage.setItem("accord-update-view-v1", JSON.stringify(session));
  },
});
$("#applyUpdateButton").addEventListener("click", () => updateLifecycle.apply());

initializeCollectionQol();
applyAccessibility();
const updateView = sessionStorage.getItem("accord-update-view-v1");
if (updateView) {
  try {
    const saved = JSON.parse(updateView);
    localFacet = normalizeAlbumFacet(saved.facet);
    if (Array.isArray(saved.facetReturnViews)) {
      for (const view of saved.facetReturnViews) {
        if (!view || typeof view.fields !== "object" || !Array.isArray(view.selected)
            || !Number.isFinite(view.scroll)) throw new Error("Cronologia dei filtri locali non valida.");
        facetReturnViews.push({ ...view, facet: normalizeAlbumFacet(view.facet) });
      }
    }
    refreshGenreFilters();
    refreshGroupFilter("#collectionFilter", "collections", "Tutte le collezioni");
    refreshGroupFilter("#tagFilter", "tags", "Tutti i tag");
    for (const selector of collectionViewSelectors) {
      if (typeof saved.fields?.[selector] === "string") $(selector).value = saved.fields[selector];
      if (selector === "#primaryGenreFilter") refreshGenreFilters();
    }
    appliedCollectionSearch = saved.appliedSearch ?? saved.fields?.["#searchInput"] ?? "";
    $("#pinnedOnlyInput").checked = saved.pinnedOnly === true;
    localCollectionChecks.forEach((selector, index) => { $(selector).checked = saved.localChecks?.[index] === true; });
    collectionSelectionOnly = saved.selectionOnly === true;
    if (saved.playlist) {
      $("#playlistBuilderName").value = saved.playlist.name;
      $("#playlistArtistCount").value = saved.playlist.artists;
      $("#playlistTracksPerArtist").value = saved.playlist.tracks;
      topArtistPlaylistPreview = saved.playlist.preview;
      if (topArtistPlaylistPreview) renderTopArtistPlaylistPreview(topArtistPlaylistPreview);
    }
    if (typeof saved.openSpotify === "string") $("#openSpotifyInput").value = saved.openSpotify;
    selectedAlbumIds = new Set((Array.isArray(saved.selectedIds) ? saved.selectedIds : [])
      .filter((id) => state.albums.some((album) => album.id === id)));
    requestAnimationFrame(() => { $("#albumList").scrollTop = Number(saved.scrollY) || 0; });
    sessionStorage.removeItem("accord-update-view-v1");
  } catch (error) { showFeedback(`Vista precedente non ripristinata: ${error.message}`, true); }
}
const incomingShare = ["share_url", "share_text", "share_title"].some((key) => new URL(location.href).searchParams.has(key));
const selectMusicView = (view) => {
  activateViewTab(view === "collection" ? $("#collectionTab") : view === "suggestions" ? $("#suggestionsTab") : $("#playlistBuilderTab"));
  catalogSuggestionsUI?.configure();
  catalogPlaylistUI?.configure();
};
const qobuzUI = initializeQobuzUI({
  gate: musicService,
  selectView: selectMusicView,
  openSettings,
  addAlbum: (album, artwork) => {
    const record = validateAlbum(album);
    if (artwork) collectionCoverImageUrls.set(record.id, artwork);
    const added = addAlbumToCollection(record);
    if (!added) render();
    return added;
  },
});
const tidalUI = initializeTidalUI({
  gate: musicService,
  selectView: selectMusicView,
  revealCollection: () => collectionLayout?.show("import"),
  playlistPrepared: (records) => catalogPlaylistUI.prepareRecords(records),
  addAlbum: (album, artwork) => {
    const record = validateAlbum(album);
    if (artwork) collectionCoverImageUrls.set(record.id, artwork);
    const added = addAlbumToCollection(record);
    if (!added) render();
    return added;
  },
  changed: () => {
    const name = musicService.service === "tidal" ? "TIDAL" : musicService.service === "qobuz" ? "Qobuz" : "Spotify";
    qobuzUI.setActive();
    catalogSuggestionsUI?.configure();
    catalogPlaylistUI?.configure();
    $("#openMusicAlbumLabel").textContent = `Apri link album ${name} · prima cerca sul dispositivo`;
    $("#openSpotifyInput").placeholder = `Incolla un link album ${name}`;
    collectionCoverQueue.length = 0;
    suggestionCoverQueue.length = 0;
    collectionCoverObserver?.disconnect();
    suggestionCoverObserver?.disconnect();
    render();
  },
});
catalogSuggestionsUI = initializeCatalogSuggestionsUI({
  gate: musicService, providers: { tidal: tidalUI, qobuz: qobuzUI },
  collection: () => state.albums,
  addAlbum: (album, artwork) => {
    const record = validateAlbum(album);
    if (artwork) collectionCoverImageUrls.set(record.id, artwork);
    return addAlbumToCollection(record);
  },
  appendActions: appendSuggestionActions, notSnoozed: suggestionNotSnoozed,
  spotifyToolChanged: updateSuggestionToolUi,
  similar: similarLastFmArtists,
  topAlbums: async (name) => {
    const data = await lastFmRequest({ method: "artist.gettopalbums", artist: name, autocorrect: "0", limit: "3" });
    const albums = data.topalbums?.album;
    if (!Array.isArray(albums)) throw new Error("Classifica album Last.fm non verificabile.");
    return albums.filter((album) => typeof album.name === "string" && album.name.trim());
  },
  genres: async (artist, album) => {
    const data = await lastFmRequest({ method: "album.gettoptags", artist, album, autocorrect: "0" });
    const tags = data.toptags?.tag;
    if (!Array.isArray(tags)) throw new Error("Tag album Last.fm non verificabili.");
    return musicalAlbumTags(tags);
  },
  history: async (options, guard) => {
    const username = options.user;
    if (!/^[A-Za-z0-9_.\- ]{1,64}$/.test(username)) throw new Error("Inserisci un nome utente Last.fm valido nelle impostazioni dei suggerimenti.");
    const range = lastFmSuggestionRange(options.period, options.start, options.end);
    const useArchive = credentials().useSyncedLastFmHistory;
    const archive = useArchive ? await getCachedLastFmHistory(username) : null; guard();
    if (useArchive && !archive) throw new Error("Cronologia sincronizzata non presente su questo dispositivo: sincronizza Last.fm o disattiva l'opzione nelle impostazioni.");
    const tracks = archive ? await completeLastFmArchiveTracks(username, archive, Math.floor(Date.now() / 1000)) : null; guard();
    const read = async (window) => archive ? summarizeLastFmRange(tracks, window) : recentLastFmScrobbles(username, window);
    const summary = await read(range); guard();
    let heard = [], exclusionNote = "";
    if (options.exclusion !== "none") {
      const excluded = await read(options.exclusion === "all" ? { from: null, to: Math.floor(Date.now() / 1000) }
        : lastFmSuggestionRange(options.exclusion)); guard();
      heard = excluded.artists.map((artist) => artist.name);
      exclusionNote = ` Esclusione basata su ${excluded.trackCount} ascolti${excluded.partial ? " (parziale)" : ""}.`;
    }
    return { seeds: summary.artists, heard,
      source: `Last.fm · ${username} · ${summary.trackCount} ascolti · `
        + `${archive ? "archivio presente sul dispositivo" : "campione online, massimo 1000 ascolti"}`
        + `${summary.partial ? " (parziale)" : ""}. Può includere più servizi; non è lo storico nativo ${musicService.service.toUpperCase()}.`
        + exclusionNote };
  },
  rateAlbum: async (album) => {
    const result = await rateDiscogsSuggestionCandidates([{ ...album, sourceId: album.id }]);
    if (result.unavailable || result.failureReason || result.cacheWarning) throw new Error(
      result.unavailable || result.failureReason || result.cacheWarning);
    const rated = result.albums[0];
    return result.rated ? `Discogs: ${rated.discogs ?? "voto non disponibile"} · ${rated.discogs_votes ?? 0} voti`
      : "Nessun abbinamento Discogs univoco con voti disponibili nel campione.";
  },
});
catalogPlaylistUI = initializeCatalogPlaylistUI({
  gate: musicService, providers: { tidal: tidalUI, qobuz: qobuzUI }, discoveryUI: catalogSuggestionsUI,
  render: renderTopArtistPlaylistPreview,
  clearSpotifyPreview: () => { topArtistPlaylistPreview = null; setPlaylistBuilderBusy(false); },
  spotifyPreview: () => topArtistPlaylistPreview,
  selectView: selectMusicView,
});
const spotifyResume = document.createElement("button"), spotifyVerify = document.createElement("button");
for (const button of [spotifyResume, spotifyVerify]) {
  button.type = "button"; button.className = "secondary"; $("#playlistManageButton").parentElement.append(button);
}
spotifyResume.textContent = "Riprendi anteprima Spotify conservata";
spotifyVerify.textContent = "Verifica esito Spotify precedente";
spotifyResume.addEventListener("click", async () => {
  if (musicService.service !== "spotify" || commandGuard.isBusy()) return;
  if (!commandGuard.acquire("playlist-resume")) return;
  const epoch = musicService.epoch;
  try {
    const record = readCheckpoint(localStorage, "spotify");
    if (!record) throw new Error("Nessuna anteprima conservata.");
    $("#playlistArtistCount").value = record.parameters.artists;
    $("#playlistTracksPerArtist").value = record.parameters.tracks;
    $("#playlistBuilderName").value = record.parameters.name;
    if (record.parameters.period) $("#spotifySuggestionPeriod").value = record.parameters.period;
    if (record.parameters.exclusion) $("#spotifySuggestionExclusion").value = record.parameters.exclusion;
    for (const selector of Object.keys(spotifySuggestionPreferences)) {
      if (record.parameters.filters && typeof record.parameters.filters[selector] === "string") {
        $(selector).value = record.parameters.filters[selector];
      }
    }
    topArtistPlaylistPreview = null; playlistCheckpointContext = null;
    renderTopArtistPlaylistPreview(record.preview); setPlaylistBuilderBusy(true);
    const identity = await spotifyPlaylistIdentity(), criteria = await spotifyPlaylistCriteria();
    musicService.assert("spotify", epoch); validateCheckpoint(record, identity, criteria);
    playlistDiscoveryContinuation = record.state;
    playlistCheckpointContext = { identity, criteria };
    topArtistPlaylistPreview = record.preview; playlistHistorical = true;
    renderTopArtistPlaylistPreview(topArtistPlaylistPreview); setPlaylistBuilderBusy(false);
    $("#playlistBuilderStatus").textContent += " Risultati storici conservati, non riletti oggi. Continua riprende solo le letture mancanti, mai le scritture.";
  } catch (error) { $("#playlistBuilderStatus").textContent = `Risultati conservati consultabili. Ripresa non disponibile: ${error.message}`; }
  finally { commandGuard.release("playlist-resume"); setPlaylistBuilderBusy(false); }
});
spotifyVerify.addEventListener("click", async () => {
  if (musicService.service !== "spotify" || commandGuard.isBusy()) return;
  const epoch = musicService.epoch;
  try {
    if (!navigator.locks?.request) throw new Error("Browser senza blocco scritture sicuro: verifica non disponibile.");
    await navigator.locks.request("accord-playlist-write-spotify-v1", { ifAvailable: true }, (lock) => {
      musicService.assert("spotify", epoch);
      if (!lock) throw new Error("Scrittura ancora in corso in un'altra scheda.");
      if (!confirm("Hai controllato playlist e brani nell'app Spotify, anche parziali? Sbloccare non ripete l'operazione.")) return;
      localStorage.removeItem(spotifyPlaylistUncertainKey);
      topArtistPlaylistPreview = null; playlistDiscoveryContinuation = null;
      clearCheckpoint(localStorage, "spotify"); setPlaylistBuilderBusy(false);
      $("#playlistBuilderStatus").textContent = "Verifica confermata. Genera una nuova anteprima; nessun invio ripetuto.";
    });
  } catch (error) { $("#playlistBuilderStatus").textContent = error.message; }
});
$("#playlistBuilderName").addEventListener("input", () => {
  if (musicService.service !== "spotify") return;
  try { saveSpotifyPlaylistCheckpoint(); } catch (error) { $("#playlistBuilderStatus").textContent = `Parametri non conservati: ${error.message}`; }
});
function updateSpotifyPlaylistPause() {
  const spotify = musicService.service === "spotify";
  spotifyResume.hidden = spotifyVerify.hidden = !spotify;
  if (!spotify) return;
  try {
    spotifyResume.disabled = commandGuard.isBusy() || !readCheckpoint(localStorage, "spotify");
    spotifyVerify.hidden = !localStorage.getItem(spotifyPlaylistUncertainKey);
    spotifyVerify.disabled = commandGuard.isBusy();
    const remaining = pauseRemaining(localStorage, "spotify");
    if (remaining) {
      $("#playlistPreviewButton").disabled = true;
      $("#playlistCreateButton").disabled = true;
    } else if (!commandGuard.isBusy()) setPlaylistBuilderBusy(false);
  } catch (error) { $("#playlistBuilderStatus").textContent = error.message; }
}
setInterval(updateSpotifyPlaylistPause, 1000);
window.addEventListener("storage", updateSpotifyPlaylistPause);
updateSpotifyPlaylistPause();
collectionLayout = installCollectionLayout(document);
installTechnicalStatusDetails(document.body);
installDialogLayout(document.body);

function platformAccessChecks() {
  const local = (key) => localStorage.getItem(key) || "";
  const session = (key) => sessionStorage.getItem(key) || "";
  const lock = (name, run) => navigator.locks?.request ? navigator.locks.request(name, run) : run();
  return [
    { key: "github", identity: () => JSON.stringify([credentials().owner, credentials().token]),
      configured: () => Boolean(credentials().owner && credentials().token),
      check: async (guard) => {
        const { owner } = credentials(), root = `${API}/repos/${encodeURIComponent(owner)}/${REPOSITORY}`;
        const read = async (url) => {
          guard();
          const value = await githubRequest(url, { signal: AbortSignal.timeout(20_000) });
          guard(); return value;
        };
        const profile = await read(`${API}/user`);
        if (!profile?.login) throw new Error("Identità GitHub non verificabile.");
        const repository = await read(root);
        if (repository?.private !== true) throw new Error("Il repository GitHub deve essere privato.");
        if (!Array.isArray(await read(`${root}/contents/`))) throw new Error("Lettura Contents non verificabile.");
        return { account: profile.login, detail: "Identità, repository privato e Contents in lettura verificati; scrittura non attestata. Nessuna sincronizzazione." };
      } },
    { key: "spotify", identity: () => JSON.stringify([local("accord-spotify-client-id"), session("accord-spotify-access-token")]),
      configured: () => Boolean(session("accord-spotify-access-token") || session("accord-spotify-refresh-token")),
      check: async (guard) => {
        const token = session("accord-spotify-access-token");
        const expires = Number(session("accord-spotify-token-expires"));
        if (!token || !Number.isFinite(expires) || expires <= Date.now()) {
          throw new Error("Sessione Spotify scaduta: ricollega l'account. Nessun login avviato.");
        }
        const transport = createSpotifyTransport({ storage: localStorage, lock, fetch: async (...args) => {
          guard(); const result = await fetch(...args); guard(); return result;
        } });
        const response = await transport.fetch(`${SPOTIFY_API}/me`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(20_000), credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
        }, false);
        if (!response.ok) throw new Error(`Accesso Spotify rifiutato (HTTP ${response.status}).`);
        const profile = await response.json();
        if (!profile?.id) throw new Error("Identità Spotify non verificabile.");
        return { account: profile.display_name || profile.id, detail: "Identità verificata; nessuna importazione o riproduzione." };
      } },
    { key: "tidal", identity: () => JSON.stringify([local("accord-tidal-client-id-v1"), session("accord-tidal-token-v1")]),
      configured: () => Boolean(session("accord-tidal-token-v1")),
      check: async (guard) => {
        const saved = JSON.parse(session("accord-tidal-token-v1"));
        if (!saved?.access_token || saved.clientId !== local("accord-tidal-client-id-v1")
            || !Number.isFinite(saved.expires) || saved.expires <= Date.now()) {
          throw new Error("Sessione TIDAL scaduta o configurazione cambiata: ricollega l'account.");
        }
        const transport = createTidalTransport({ storage: localStorage, lock, fetch: async (...args) => {
          guard(); const result = await fetch(...args); guard(); return result;
        } });
        const profile = await transport.request("users/me", saved.access_token, { signal: AbortSignal.timeout(20_000) });
        if (!profile?.data?.id) throw new Error("Identità TIDAL non verificabile.");
        return { account: profile.data.attributes?.username || profile.data.id,
          detail: "Identità verificata; nessuna importazione o riproduzione." };
      } },
    { key: "qobuz", identity: () => session("accord-qobuz-session-v1"),
      configured: () => Boolean(session("accord-qobuz-session-v1")),
      check: async (guard) => {
        const saved = JSON.parse(session("accord-qobuz-session-v1"));
        const client = createQobuzClient({ ...saved, storage: localStorage, lock,
          signal: AbortSignal.timeout(20_000), fetch: async (...args) => {
            guard(); const result = await fetch(...args); guard(); return result;
          } });
        return client.verifyAccess();
      } },
    { key: "lastfm", identity: () => JSON.stringify([local(LASTFM_KEY), local("accord-lastfm-suggestion-user")]),
      configured: () => Boolean(local(LASTFM_KEY)),
      check: async (guard) => {
        const user = local("accord-lastfm-suggestion-user");
        const profile = await lastFmRequest(user ? { method: "user.getinfo", user }
          : { method: "tag.getinfo", tag: "rock" }, guard, () => {}, AbortSignal.timeout(20_000));
        if (user && !profile?.user?.name || !user && !profile?.tag?.name) {
          throw new Error("Lettura Last.fm non verificabile.");
        }
        return { account: user || "Chiave API Last.fm", detail: "Lettura pubblica verificata; nessuna importazione." };
      } },
  ];
}

let checkingPlatformAccess = false;
async function verifyConfiguredPlatformAccess() {
  if (checkingPlatformAccess) return;
  checkingPlatformAccess = true;
  $("#verifyPlatformAccessButton").disabled = true;
  try {
    await runPlatformAccessChecks(platformAccessChecks(), (key, result) => {
      const cell = document.querySelector(`[data-access-status="${key}"]`);
      cell.textContent = safeDiagnostics([result.state, result.account, result.detail, result.checked].filter(Boolean).join(" · "));
    });
  } finally {
    checkingPlatformAccess = false;
    $("#verifyPlatformAccessButton").disabled = false;
  }
}
$("#verifyPlatformAccessButton").addEventListener("click", () => {
  void verifyConfiguredPlatformAccess().catch((error) => showFeedback(`Verifica accessi non riuscita: ${safeDiagnostics(error.message)}`, true));
});
for (const provider of [tidalUI, qobuzUI]) provider.suggestionAPI.prepare = catalogPlaylistUI.prepareRecords;
render();
receiveSharedAlbum();
restoreListeningSuggestionsForSpotifyReturn();
finishSpotifyAuthorization().catch((error) => {
  setSyncState("Autorizzazione Spotify non riuscita");
  showMessage("Errore autorizzazione Spotify", error.message);
}).finally(() => requestAnimationFrame(() => setTimeout(() => {
  void verifyConfiguredPlatformAccess().catch((error) => showFeedback(`Verifica accessi non riuscita: ${safeDiagnostics(error.message)}`, true));
}, 1500)));
if ("serviceWorker" in navigator && window.isSecureContext) {
  const initialController = navigator.serviceWorker.controller;
  navigator.serviceWorker.register("./sw.js").then((registration) => {
    if (registration.waiting) updateLifecycle.ready(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) updateLifecycle.ready(worker);
      });
    });
  }).catch((error) => {
    setSyncState("Cache offline non disponibile");
    showFeedback(`Cache offline non disponibile: ${error.message}`, true);
    console.error("Accord PWA service worker:", error);
  });
  navigator.serviceWorker.ready.then(() => updateOfflineReadiness());
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    updateLifecycle.controllerChanged(navigator.serviceWorker.controller, Boolean(initialController));
    void updateOfflineReadiness();
  });
}
if (!incomingShare && !updateView && credentials().autoSync && credentials().token) sync();
