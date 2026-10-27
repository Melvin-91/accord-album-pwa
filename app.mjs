import {
  addPlaylistAlbums,
  albumPrimaryGenre,
  albumSecondaryGenres,
  aggregateDiscogsEditionRatings,
  bestSpotifyAlbumSuggestionMatch,
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
  primaryAlbumGenres,
  findSpotifyPlaylistMatches,
  listeningAlbumSuggestions,
  readMusicBrainzCatalog,
  readLastFmAllTimeArtists,
  rankDiscogsSuggestionAlbums,
  retryMusicBrainzRequest,
  shouldStopDiscogsSuggestionQueue,
  sortAlbumsByManualOrder,
  spotifyAlbumId,
  spotifyPlaylistId,
  spotifyRedirectUriForPage,
  summarizeLastFmTracks,
  topListenedAlbums,
  topDiscogsVersions,
  threeWayMerge,
  validateAlbum,
  validateDocument,
} from "./core.mjs?v=28";

const STORAGE_KEY = "accord-album-pwa-v1";
const COVER_DATABASE = "accord-album-covers-v1";
const COVER_STORE = "covers";
const ACTIVE_VIEW_TAB_KEY = "accord-active-view-tab";
const SUGGESTION_RETURN_KEY = "accord-spotify-suggestion-return";
const REPOSITORY = "accord-music-data";
const API = "https://api.github.com";
const DISCOGS_API = "https://api.discogs.com";
const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_ACCOUNTS = "https://accounts.spotify.com";
const SPOTIFY_COOLDOWN_KEY = "accord-spotify-rate-limit-until-v1";
const SPOTIFY_MAX_READ_RETRIES = 2;
const SPOTIFY_MAX_AUTOMATIC_WAIT_MS = 30_000;
const LASTFM_API = "https://ws.audioscrobbler.com/2.0/";
const DISCOGS_SUGGESTION_CACHE_KEY = "accord-discogs-suggestion-cache-v1";
const DISCOGS_SUGGESTION_CACHE_AGE = 14 * 24 * 60 * 60 * 1000;
const DISCOGS_SUGGESTION_SAMPLE_SIZE = 5;
const DISCOGS_SUGGESTION_REQUEST_LIMIT = 200;
const DISCOGS_SUGGESTION_PAGES_LIMIT = 20;
localStorage.removeItem("accord-spotify-heard-artists-v1");
localStorage.removeItem("accord-spotify-heard-artist-last-played-v1");
const suggestedSourceAlbums = new Map();
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
let lastListeningCatalogRequestAt = 0;
let lastDiscogsSuggestionRequestAt = 0;
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
let spotifyApiRequestQueue = Promise.resolve();
const LASTFM_KEY = "accord-lastfm-api-key";
const labels = { queued: "Da ascoltare", listening: "In ascolto", liked: "Mi piace", disliked: "Non mi piace" };
const $ = (selector) => document.querySelector(selector);
const template = $("#albumTemplate");
const state = loadState();
let automaticSyncQueued = false;
$("#sortOrder").value = state.sortOrder;
const viewTabs = [...document.querySelectorAll(".view-tabs [role='tab']")];

function activateViewTab(selectedTab) {
  for (const tab of viewTabs) {
    const selected = tab === selectedTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
  }
  sessionStorage.setItem(ACTIVE_VIEW_TAB_KEY, selectedTab.id);
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

function openCoverDatabase() {
  if (!coverDatabasePromise) {
    coverDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(COVER_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(COVER_STORE, { keyPath: "id" });
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
  const database = await openCoverDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(COVER_STORE, "readwrite");
    const request = transaction.objectStore(COVER_STORE).put({ id, data: data.slice().buffer });
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error(`Impossibile salvare la copertina offline: ${transaction.error?.message || request.error?.message || "transazione IndexedDB interrotta"}`));
    transaction.onerror = () => reject(new Error(`Impossibile salvare la copertina offline: ${transaction.error?.message || request.error?.message || "errore IndexedDB"}`));
  });
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const albums = validateDocument({ format: "accord-album-collection", version: 1,
      albums: Array.isArray(saved.albums) ? saved.albums : [] });
    const base = validateDocument({ format: "accord-album-collection", version: 1,
      albums: Array.isArray(saved.base) ? saved.base : [] });
    const manualOrder = Array.isArray(saved.manualOrder)
      ? [...new Set(saved.manualOrder.filter((id) => typeof id === "string" && /^[A-Za-z0-9]+$/.test(id)))]
      : [];
    const sortOrders = ["artist", "name", "year", "rating", "genre", "collection", "manual"];
    const sortOrder = sortOrders.includes(saved.sortOrder) ? saved.sortOrder : "artist";
    const hasLegacyStatuses = [saved.albums, saved.base].some((records) =>
      Array.isArray(records) && records.some((album) =>
        album && normalizeAlbumStatus(album.status) !== album.status));
    if (hasLegacyStatuses) localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, albums, base }));
    return { albums, base, manualOrder, sortOrder };
  } catch (error) {
    queueMicrotask(() => showMessage("Archivio locale non leggibile", error.message));
    return { albums: [], base: [], manualOrder: [], sortOrder: "artist", loadError: error.message };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  $("#messageBody").textContent = message;
  $("#messageDialog").showModal();
}

function openSettings() {
  const current = credentials();
  const spotify = spotifySettings();
  $("#ownerInput").value = current.owner;
  $("#tokenInput").value = "";
  $("#tokenInput").placeholder = current.token ? "Token salvato (vuoto per mantenerlo)" : "ghp_…";
  $("#autoSyncInput").checked = current.autoSync;
  $("#spotifyClientIdInput").value = spotify.clientId;
  $("#spotifyRedirectUriInput").value = spotify.redirectUri;
  $("#lastfmApiKeyInput").value = "";
  $("#lastfmApiKeyInput").placeholder = localStorage.getItem(LASTFM_KEY)
    ? "Chiave salvata (vuoto per mantenerla)" : "Chiave API (32 caratteri)";
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
  showMessage("Chiave Last.fm salvata", "La chiave resta in questo profilo browser e non viene inclusa nella raccolta o nella sincronizzazione GitHub.");
});
$("#clearLastfmApiKey").addEventListener("click", () => {
  localStorage.removeItem(LASTFM_KEY);
  $("#lastfmApiKeyInput").value = "";
  $("#lastfmApiKeyInput").placeholder = "Chiave API (32 caratteri)";
  setSyncState("Chiave Last.fm dimenticata");
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
  if (clientId) localStorage.setItem("accord-spotify-client-id", clientId);
  else localStorage.removeItem("accord-spotify-client-id");
  localStorage.setItem("accord-spotify-redirect-uri", redirectUri.href);
  $("#tokenInput").value = "";
  $("#settingsDialog").close();
  setSyncState("Configurazione salvata");
  if (automaticSyncQueued) {
    automaticSyncQueued = false;
    void sync();
  }
});

$("#clearCredentials").addEventListener("click", () => {
  localStorage.removeItem("accord-album-owner");
  localStorage.removeItem("accord-album-token");
  localStorage.removeItem("accord-album-autosync");
  $("#ownerInput").value = "";
  $("#tokenInput").value = "";
  $("#autoSyncInput").checked = false;
  setSyncState("Credenziali dimenticate");
});

$("#disconnectSpotify").addEventListener("click", () => {
  for (const key of ["accord-spotify-access-token", "accord-spotify-refresh-token",
    "accord-spotify-token-expires", "accord-spotify-oauth-state", "accord-spotify-code-verifier",
    "accord-spotify-pending-playlist", "accord-spotify-pending-albums"]) sessionStorage.removeItem(key);
  setSyncState("Spotify scollegato");
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
  for (const album of scopedAlbums) {
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
  secondaryFilter.value = [...secondaryFilter.options].some((option) => option.value === selectedSecondary)
    ? selectedSecondary : "";
}

function render() {
  finishManualDrag(false);
  ensureManualOrder();
  refreshGenreFilters();
  refreshGroupFilter("#collectionFilter", "collections", "Tutte le collezioni");
  refreshGroupFilter("#tagFilter", "tags", "Tutti i tag");
  const sortOrder = $("#sortOrder").value;
  const filteredAlbums = filterAlbums(state.albums, {
    search: $("#searchInput").value,
    primaryGenre: $("#primaryGenreFilter").value,
    secondaryGenre: $("#secondaryGenreFilter").value,
    status: $("#statusFilter").value,
    collection: $("#collectionFilter").value,
    tag: $("#tagFilter").value,
    order: sortOrder,
  });
  const albums = sortOrder === "manual"
    ? sortAlbumsByManualOrder(filteredAlbums, state.manualOrder)
    : filteredAlbums;
  const manualSorting = sortOrder === "manual";
  $("#manualOrderHint").hidden = !manualSorting;
  if (manualSorting) {
    $("#manualOrderHint").textContent =
      "Ordine manuale salvato solo su questo dispositivo: tieni premuto un album e trascinalo; puoi anche usare le frecce.";
  }
  const generation = ++coverRenderGeneration;
  for (const url of coverObjectUrls) URL.revokeObjectURL(url);
  coverObjectUrls = [];
  $("#albumList").replaceChildren();
  $("#collectionSummary").textContent = `${albums.length} album · ${state.albums.length} nella raccolta`;
  $("#emptyState").hidden = albums.length !== 0;
  $("#emptyState").textContent = state.albums.length
    ? "Nessun album corrisponde ai filtri."
    : "Questa raccolta è vuota sul dispositivo. Per trasferire gli album dal PC, sincronizza Accord desktop con il repository accord-music-data, poi premi “Sincronizza” qui: il PC non deve restare acceso. Puoi anche importare una playlist Spotify.";
  updateCollectionCoverNotice();
  for (const [index, album] of albums.entries()) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.albumId = album.id;
    if (manualSorting) card.classList.add("manual-sortable");
    card.querySelector(".album-title").textContent = album.name;
    card.querySelector(".album-meta").textContent =
      `${album.artist} · ${album.year || "Anno sconosciuto"} · ${labels[album.status]}`;
    const coverImage = card.querySelector(".album-cover");
    coverImage.alt = `Copertina di ${album.name}`;
    coverImage.referrerPolicy = "no-referrer";
    card.querySelector(".cover-placeholder").textContent = album.cover_sha256
      ? "Premi Sincronizza per scaricare"
      : "Cerco una copertina online…";
    card.querySelector(".status-input").value = album.status;
    card.querySelector(".status-input").setAttribute("aria-label", `Stato per ${album.name}`);
    card.querySelector(".status-input").addEventListener("change", (event) =>
      updateAlbum(album.id, { status: event.currentTarget.value }));
    const link = card.querySelector(".spotify-link");
    link.href = album.url;
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
    $("#albumList").append(card);
  }
  void renderCovers(albums, generation);
}

async function renderCovers(albums, generation) {
  try {
    let unavailable = 0;
    const cards = new Map([...$("#albumList").children].map((card) => [card.dataset.albumId, card]));
    for (const [index, album] of albums.entries()) {
      const card = cards.get(album.id);
      if (!card) continue;
      if (!album.cover_sha256) {
        unavailable += 1;
        enqueueCollectionCover({ album, card, generation });
        continue;
      }
      let data;
      try {
        data = await getCachedCover(album.id);
      } catch (error) {
        collectionCoverFailures.set(album.id, `Archivio offline: ${error.message}`);
        unavailable += 1;
        enqueueCollectionCover({ album, card, generation });
        continue;
      }
      if (!data) {
        unavailable += 1;
        enqueueCollectionCover({ album, card, generation });
        continue;
      }
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
      const hash = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
      if (hash !== album.cover_sha256) {
        collectionCoverFailures.set(album.id, "La miniatura locale non corrisponde all'impronta sincronizzata.");
        unavailable += 1;
        enqueueCollectionCover({ album, card, generation });
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
        card.querySelector(".cover-placeholder").textContent = "Cerco una copertina online…";
        card.classList.add("cover-error");
        collectionCoverFailures.set(album.id, "La miniatura sincronizzata non è leggibile come immagine.");
        enqueueCollectionCover({ album, card, generation });
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
  return task.generation === coverRenderGeneration && task.card.isConnected;
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
    let loaded = false;
    for (const image of images) {
      if (await tryImage(trustedSpotifyCoverUrl(image.url), "Spotify")) {
        loaded = true;
        break;
      }
    }
    if (loaded) return;
    if (!images.length) errors.push("Spotify: nessuna immagine verificabile.");
  } else {
    errors.push("Spotify: nessuna immagine verificabile.");
  }

  if (!collectionCoverTaskIsCurrent(task)) return;
  try {
    const oembedUrl = new URL("https://open.spotify.com/oembed");
    oembedUrl.searchParams.set("url", album.url);
    const response = await fetch(oembedUrl, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(`Spotify oEmbed ha risposto con HTTP ${response.status}.`);
    const metadata = await response.json();
    const coverUrl = trustedSpotifyCoverUrl(metadata.thumbnail_url);
    if (coverUrl && await tryImage(coverUrl, "Spotify oEmbed")) return;
    errors.push("Spotify oEmbed: nessuna immagine verificabile.");
  } catch (error) {
    errors.push(`Spotify oEmbed: ${error.message}`);
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
  const albumsById = new Map();
  let spotifyError = "";
  if (pending.length) {
    try {
      const token = await collectionSpotifyToken();
      if (!token) throw new Error("Sessione Spotify non disponibile.");
      const ids = pending.map((task) => task.album.id);
      const query = new URLSearchParams({ ids: ids.join(",") });
      const data = await spotifyRequest(`albums?${query}`, token);
      if (!data || !Array.isArray(data.albums) || data.albums.length !== ids.length) {
        throw new Error("Spotify non ha restituito tutte le copertine richieste.");
      }
      data.albums.forEach((album, index) => {
        if (album === null) return;
        if (!album || album.id !== ids[index]) {
          throw new Error("Spotify ha restituito album fuori ordine o non verificabili.");
        }
        albumsById.set(album.id, album);
      });
    } catch (error) {
      spotifyError = error.message;
    }
  }
  await Promise.all(tasks.map((task, index) => cached[index] ? null : loadCollectionCover(
    task, albumsById.get(task.album.id) || null, spotifyError,
  )));
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
    saveState();
  } catch (error) {
    state.albums = previous;
    throw error;
  }
  render();
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
  if (!task.card.isConnected) return;
  if (!task.spotifyFallback && task.fallbackUrl) {
    setAlbumCover(task.cover, task.fallbackUrl, () => {
      enqueueSuggestionCover({ ...task, spotifyFallback: true });
    });
    return;
  }
  try {
    const token = await getSuggestionCoverSpotifyToken();
    if (!task.card.isConnected) return;
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
    empty.textContent = "Nessun risultato album trovato.";
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
    detail.textContent = ` · ${album.artist} · ${album.year || "Anno sconosciuto"}`
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
        if (addAlbumToCollection(album, { syncAutomatically: true })) {
          button.textContent = "Aggiunto";
          button.disabled = true;
          button.setAttribute("aria-label", `${album.name} aggiunto alla raccolta`);
          $("#manualAlbumStatus").textContent = `${album.name} aggiunto localmente; sincronizzazione GitHub avviata o in attesa di configurazione.`;
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
    if (coverUrl || artistNames.length) spotifyAlbumMetadata.set(id, { coverUrl, artistNames });
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
    return playlistAlbumRecords([{ item: { type: "track", album: spotifyAlbum } }]);
  }
  const queryTerms = [
    filters.album && spotifySearchField("album", filters.album),
    filters.artist && spotifySearchField("artist", filters.artist),
    filters.year && `year:${filters.year}`,
  ].filter(Boolean);
  const parameters = new URLSearchParams({ q: queryTerms.join(" "), type: "album", limit: "10" });
  const response = await spotifyRequest(`search?${parameters}`, accessToken);
  if (!Array.isArray(response.albums?.items)) throw new Error("Risposta Spotify senza risultati verificabili.");
  rememberSpotifyAlbumMetadata(response.albums.items);
  return playlistAlbumRecords(response.albums.items.map((album) => ({ item: { type: "track", album } })))
    .filter((album) => albumMatchesManualFilters(album, filters));
}

async function lastFmRequest(values) {
  const apiKey = localStorage.getItem(LASTFM_KEY);
  if (!apiKey) {
    openSettings();
    throw new Error("Configura la chiave API Last.fm nelle impostazioni, poi riprova.");
  }
  const parameters = new URLSearchParams({ ...values, api_key: apiKey, format: "json" });
  let response;
  try {
    response = await fetch(`${LASTFM_API}?${parameters}`, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new Error("Last.fm non raggiungibile. Verifica la connessione e riprova.");
  }
  if (!response.ok) throw new Error(`Last.fm ha risposto con HTTP ${response.status}.`);
  const data = await response.json();
  if (data.error) {
    if (["10", "26"].includes(String(data.error))) throw new Error("Chiave API Last.fm non valida o sospesa.");
    if (String(data.error) === "29") throw new Error("Limite Last.fm raggiunto; riprova più tardi.");
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
  return { ...summarizeLastFmTracks(tracks), partial: totalPages > pageLimit };
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
  if (state.requests >= DISCOGS_SUGGESTION_REQUEST_LIMIT) {
    throw new DiscogsSuggestionBudgetError("Raggiunto il limite di richieste Discogs per questa ricerca.");
  }
  const delay = 2600 - (Date.now() - lastDiscogsSuggestionRequestAt);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  const url = new URL(path, DISCOGS_API);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
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
  lastDiscogsSuggestionRequestAt = Date.now();
  state.requests += 1;
  if (!response.ok) {
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

async function rateDiscogsSuggestionCandidates(candidates) {
  const cache = getDiscogsSuggestionCache();
  const state = { requests: 0 };
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
    $("#suggestionStatus").textContent =
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
    const history = await recentLastFmScrobbles(username, range);
    let exclusion;
    if (exclusionPeriod === "none") {
      exclusion = { names: [], lastfmCount: 0, partial: false };
    } else if (exclusionPeriod === "all") {
      const allTimeHeard = await allTimeHeardArtistNames(username);
      exclusion = { ...allTimeHeard, partial: false };
    } else {
      const exclusionRange = lastFmSuggestionRange(exclusionPeriod);
      const windowHistory = period === exclusionPeriod ? history
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
    const coverage = history.partial ? " · campione parziale (massimo 1.000 ascolti)" : "";
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
  const container = $("#suggestionAlbums");
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
  for (const album of albums) {
    const card = document.createElement("article");
    card.className = "suggestion-album";
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

async function loadTopArtistPlaylistPreview(request, accessToken) {
  const { artistCount, tracksPerArtist, timeRange } = request;
  if (!Number.isInteger(artistCount) || artistCount < 1 || artistCount > 20
      || !Number.isInteger(tracksPerArtist) || tracksPerArtist < 1 || tracksPerArtist > 10
      || !["short_term", "medium_term", "long_term"].includes(timeRange)) {
    throw new Error("Scegli da 1 a 20 artisti, da 1 a 10 brani per artista e un periodo valido.");
  }
  const parameters = new URLSearchParams({ limit: String(artistCount), time_range: timeRange });
  const response = await spotifyRequest(`me/top/artists?${parameters}`, accessToken);
  if (!Array.isArray(response?.items)) throw new Error("Spotify non ha restituito una classifica artisti valida.");
  if (!response.items.length) throw new Error("Spotify non ha trovato artisti ascoltati nel periodo selezionato.");

  const artists = [];
  const tracks = [];
  const seenTracks = new Set();
  for (const artist of response.items.slice(0, artistCount)) {
    if (!/^[A-Za-z0-9]{22}$/.test(artist?.id || "") || !artist.name?.trim()) {
      throw new Error("La classifica Spotify contiene un artista non verificabile.");
    }
    const topTracks = await spotifyRequest(
      `artists/${encodeURIComponent(artist.id)}/top-tracks?market=from_token`, accessToken);
    if (!Array.isArray(topTracks?.tracks)) {
      throw new Error(`Spotify non ha restituito i brani di ${artist.name}.`);
    }
    let artistTrackCount = 0;
    for (const track of topTracks.tracks) {
      if (artistTrackCount >= tracksPerArtist) break;
      if (!track || track.is_playable === false || track.restrictions) continue;
      if (!/^[A-Za-z0-9]{22}$/.test(track.id || "") || track.uri !== `spotify:track:${track.id}`
          || !track.name?.trim() || seenTracks.has(track.id)) continue;
      seenTracks.add(track.id);
      tracks.push({
        uri: track.uri,
        name: track.name,
        artist: Array.isArray(track.artists)
          ? track.artists.map((entry) => entry?.name).filter((name) => typeof name === "string").join(", ")
          : "",
        sourceArtist: artist.name,
      });
      artistTrackCount += 1;
    }
    artists.push({ id: artist.id, name: artist.name, tracks: artistTrackCount });
  }
  if (!tracks.length) throw new Error("Nessun brano Spotify riproducibile trovato per gli artisti selezionati.");
  return { artists, tracks, timeRange, tracksPerArtist };
}

function renderTopArtistPlaylistPreview(preview) {
  const container = $("#playlistBuilderPreview");
  container.replaceChildren();
  for (const artist of preview.artists) {
    const group = document.createElement("details");
    group.className = "playlist-artist-preview";
    group.open = true;
    const heading = document.createElement("summary");
    heading.textContent = `${artist.name} · ${artist.tracks} brani`;
    group.append(heading);
    for (const track of preview.tracks.filter((entry) => entry.sourceArtist === artist.name)) {
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
    `Anteprima pronta: ${preview.artists.length} artisti · ${preview.tracks.length} brani. La playlist sarà privata.`;
  $("#playlistCreateButton").disabled = false;
}

async function createTopArtistPlaylist(name, preview, accessToken) {
  if (!name || name.length > 100 || !preview || !Array.isArray(preview.tracks)
      || !preview.tracks.length || preview.tracks.length > 200) {
    throw new Error("Nome o anteprima playlist non validi.");
  }
  const uris = preview.tracks.map((track) => {
    const match = typeof track?.uri === "string" ? track.uri.match(/^spotify:track:([A-Za-z0-9]{22})$/) : null;
    if (!match) throw new Error("L'anteprima contiene un brano Spotify non verificabile.");
    return track.uri;
  });
  if (new Set(uris).size !== uris.length) throw new Error("L'anteprima contiene brani duplicati; generala di nuovo.");
  const playlist = await spotifyWriteRequest("me/playlists", accessToken, {
    name,
    description: "Creata da Accord · brani dai tuoi artisti più ascoltati",
    public: false,
  });
  if (!/^[A-Za-z0-9]{22}$/.test(playlist?.id || "")) {
    throw new Error("Spotify non ha restituito una playlist verificabile.");
  }
  try {
    for (let offset = 0; offset < uris.length; offset += 100) {
      await spotifyWriteRequest(`playlists/${playlist.id}/items`, accessToken, {
        uris: uris.slice(offset, offset + 100),
      });
    }
  } catch (error) {
    const url = playlist.external_urls?.spotify;
    throw new Error(`Playlist creata ma aggiunta dei brani incompleta: ${error.message}`
      + (url ? ` Apri la playlist e verifica i brani: ${url}` : ` ID playlist: ${playlist.id}`));
  }
  return { playlist, tracks: uris.length };
}

function setPlaylistBuilderBusy(busy) {
  $("#playlistArtistCount").disabled = busy;
  $("#playlistTracksPerArtist").disabled = busy;
  $("#playlistTimeRange").disabled = busy;
  $("#playlistBuilderName").disabled = busy;
  $("#playlistPreviewButton").disabled = busy;
  $("#playlistCreateButton").disabled = busy || !topArtistPlaylistPreview;
}

async function beginPlaylistBuilderPreview() {
  topArtistPlaylistPreview = null;
  $("#playlistBuilderPreview").replaceChildren();
  setPlaylistBuilderBusy(true);
  $("#playlistBuilderStatus").textContent = "Carico gli artisti e preparo l'anteprima...";
  try {
    const request = {
      artistCount: Number($("#playlistArtistCount").value),
      tracksPerArtist: Number($("#playlistTracksPerArtist").value),
      timeRange: $("#playlistTimeRange").value,
    };
    const token = await spotifyAccessToken();
    if (!token || sessionStorage.getItem("accord-spotify-playlist-builder-authorized") !== "1") {
      await startSpotifyAuthorization(JSON.stringify(request), "playlist-builder");
      return;
    }
    topArtistPlaylistPreview = await loadTopArtistPlaylistPreview(request, token);
    renderTopArtistPlaylistPreview(topArtistPlaylistPreview);
  } catch (error) {
    $("#playlistBuilderStatus").textContent = `Anteprima non riuscita: ${error.message}`;
  } finally {
    setPlaylistBuilderBusy(false);
  }
}

async function beginPlaylistBuilderCreation() {
  if (!topArtistPlaylistPreview) return;
  const name = $("#playlistBuilderName").value.trim();
  if (!name || name.length > 100) {
    $("#playlistBuilderStatus").textContent = "Inserisci un nome playlist (massimo 100 caratteri).";
    return;
  }
  setPlaylistBuilderBusy(true);
  $("#playlistBuilderStatus").textContent = "Creo la playlist privata e aggiungo i brani...";
  try {
    const token = await spotifyAccessToken();
    if (!token || sessionStorage.getItem("accord-spotify-playlist-builder-authorized") !== "1") {
      await startSpotifyAuthorization(JSON.stringify({ name, preview: topArtistPlaylistPreview }), "playlist-create");
      return;
    }
    const result = await createTopArtistPlaylist(name, topArtistPlaylistPreview, token);
    $("#playlistBuilderStatus").textContent =
      `Playlist privata creata: ${result.playlist.name || name} · ${result.tracks} brani.`;
    showMessage("Playlist Spotify creata",
      `${result.playlist.name || name}: ${result.tracks} brani aggiunti. La playlist è privata.`
      + (result.playlist.external_urls?.spotify ? ` ${result.playlist.external_urls.spotify}` : ""));
  } catch (error) {
    $("#playlistBuilderStatus").textContent = `Creazione playlist non riuscita: ${error.message}`;
  } finally {
    setPlaylistBuilderBusy(false);
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
      ? `${albums.length} album trovati. ${filters.provider === "spotify" ? "Scegli un album da aggiungere." : "Seleziona un risultato e abbinalo a Spotify."}`
      : `Nessun album trovato su ${filters.provider === "lastfm" ? "Last.fm" : filters.provider === "musicbrainz" ? "MusicBrainz" : "Spotify"}.`;
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
      if (!alreadyPresent) addAlbumToCollection(match, { syncAutomatically: true });
      $("#manualAlbumResults").replaceChildren();
      $("#manualAlbumStatus").textContent = alreadyPresent
        ? `${match.name} è già nella raccolta.`
        : `${match.name} trovato senza ambiguità e aggiunto alla raccolta.`;
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
      : "Spotify esegue una sola ricerca album per titolo, artista e anno; per evitare richieste aggiuntive il filtro genere è disattivato.";
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
    const response = await spotifyRequest(`search?${query}`, token);
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

function updateCollectionCoverNotice() {
  const albums = new Map(state.albums.map((album) => [album.id, album]));
  const missingArchive = state.albums.filter((album) => !album.cover_sha256).length;
  const streamed = [...collectionCoverRemoteIds]
    .filter((id) => albums.has(id) && albums.get(id).cover_sha256).length;
  const failures = [...collectionCoverFailures.entries()].filter(([id]) => albums.has(id));
  const messages = [];
  if (missingArchive) {
    messages.push(`${missingArchive} album non hanno una miniatura sincronizzata. La PWA cerca le copertine online; sincronizza Accord desktop per archiviarle offline.`);
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
  try {
    const index = state.albums.findIndex((album) => album.id === id);
    if (index < 0) throw new Error("Album non piu' presente.");
    state.albums[index] = validateAlbum({ ...state.albums[index], ...changes });
    saveState();
    render();
    setSyncState("Modifiche locali in attesa di sincronizzazione");
  } catch (error) {
    showMessage("Modifica non valida", error.message);
  }
}

for (const input of [$("#searchInput"), $("#primaryGenreFilter"), $("#secondaryGenreFilter"), $("#statusFilter"),
  $("#collectionFilter"), $("#tagFilter")]) {
  input.addEventListener("input", render);
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
    "accord-spotify-playlist-builder-authorized"]) sessionStorage.removeItem(key);
}

function storeSpotifyTokens(tokens) {
  if (typeof tokens.access_token !== "string" || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
    throw new Error("Spotify ha restituito una risposta token non valida.");
  }
  sessionStorage.setItem("accord-spotify-access-token", tokens.access_token);
  sessionStorage.setItem("accord-spotify-token-expires", String(Date.now() + tokens.expires_in * 1000));
  if (typeof tokens.refresh_token === "string") {
    sessionStorage.setItem("accord-spotify-refresh-token", tokens.refresh_token);
  }
}

async function spotifyTokenRequest(parameters) {
  const response = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error(`Autenticazione Spotify non riuscita (HTTP ${response.status}).`);
  return response.json();
}

async function spotifyAccessToken() {
  const accessToken = sessionStorage.getItem("accord-spotify-access-token") || "";
  const expires = Number(sessionStorage.getItem("accord-spotify-token-expires"));
  if (accessToken && Number.isFinite(expires) && expires > Date.now() + 60_000) return accessToken;
  const refreshToken = sessionStorage.getItem("accord-spotify-refresh-token") || "";
  if (!refreshToken) return null;

  const response = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: spotifySettings().clientId,
    }),
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if ([400, 401].includes(response.status)) {
    clearSpotifySession();
    return null;
  }
  if (!response.ok) throw new Error(`Rinnovo della sessione Spotify non riuscito (HTTP ${response.status}).`);
  const tokens = await response.json();
  storeSpotifyTokens(tokens);
  return tokens.access_token;
}

function spotifyDelay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function storedSpotifyCooldown() {
  const until = Number(localStorage.getItem(SPOTIFY_COOLDOWN_KEY));
  if (!Number.isFinite(until) || until <= 0) {
    localStorage.removeItem(SPOTIFY_COOLDOWN_KEY);
    return 0;
  }
  return until;
}

function saveSpotifyCooldown(until) {
  const previous = storedSpotifyCooldown();
  localStorage.setItem(SPOTIFY_COOLDOWN_KEY, String(Math.max(previous, until)));
}

async function waitForSpotifyCooldown(retryRead) {
  while (true) {
    const remaining = storedSpotifyCooldown() - Date.now();
    if (remaining <= 0) {
      localStorage.removeItem(SPOTIFY_COOLDOWN_KEY);
      return;
    }
    if (!retryRead || remaining > SPOTIFY_MAX_AUTOMATIC_WAIT_MS) {
      throw new Error(`Limite richieste Spotify raggiunto; riprova tra ${Math.ceil(remaining / 1000)} secondi.`);
    }
    await spotifyDelay(remaining);
  }
}

function spotifyRetryAfterMs(response) {
  const value = response.headers.get("Retry-After");
  if (value && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    return Math.max(1000, Math.ceil(Number(value) * 1000));
  }
  const date = value ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? Math.max(1000, date - Date.now()) : 5000;
}

async function spotifyQuotaExceeded(response) {
  try {
    const error = (await response.clone().json()).error || {};
    return String(error.reason || "").toLocaleLowerCase() === "quota_exceeded"
      || String(error.message || "").toLocaleLowerCase().includes("quota exceeded");
  } catch {
    return false;
  }
}

function queueSpotifyApiRequest(request) {
  const queued = spotifyApiRequestQueue.then(() => {
    if (navigator.locks?.request) {
      return navigator.locks.request("accord-spotify-api", request);
    }
    return request();
  });
  spotifyApiRequestQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

function spotifyRetryDelay(retry) {
  return 500 * (2 ** retry) + Math.floor(Math.random() * 250);
}

async function spotifyApiFetch(url, options, retryRead) {
  return queueSpotifyApiRequest(async () => {
    let rateRetries = 0;
    let transientRetries = 0;
    while (true) {
      await waitForSpotifyCooldown(retryRead);
      let response;
      try {
        response = await fetch(url, options);
      } catch (error) {
        if (!retryRead || transientRetries >= SPOTIFY_MAX_READ_RETRIES) throw error;
        const delay = spotifyRetryDelay(transientRetries);
        transientRetries += 1;
        await spotifyDelay(delay);
        continue;
      }
      if (response.status === 429) {
        const delay = spotifyRetryAfterMs(response);
        saveSpotifyCooldown(Date.now() + delay);
        if (retryRead && rateRetries < SPOTIFY_MAX_READ_RETRIES
            && delay <= SPOTIFY_MAX_AUTOMATIC_WAIT_MS && !await spotifyQuotaExceeded(response)) {
          rateRetries += 1;
          await spotifyDelay(delay);
          continue;
        }
        throw new Error(`Limite richieste Spotify raggiunto; riprova tra ${Math.ceil(delay / 1000)} secondi.`);
      }
      if (retryRead && [500, 502, 503, 504].includes(response.status)
          && transientRetries < SPOTIFY_MAX_READ_RETRIES) {
        const delay = spotifyRetryDelay(transientRetries);
        transientRetries += 1;
        await spotifyDelay(delay);
        continue;
      }
      return response;
    }
  });
}

async function spotifyRequest(path, accessToken) {
  const url = new URL(path, `${SPOTIFY_API}/`);
  if (url.origin !== "https://api.spotify.com" || !url.pathname.startsWith("/v1/")) {
    throw new Error("Indirizzo API Spotify non valido.");
  }
  const response = await spotifyApiFetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }, true);
  if (response.status === 401) {
    clearSpotifySession();
    throw new Error("Sessione Spotify scaduta. Avvia di nuovo l’importazione per autorizzarti.");
  }
  if (response.status === 403) throw new Error("Spotify non consente questa richiesta. Verifica accesso e autorizzazioni.");
  if (!response.ok) throw new Error(`Richiesta Spotify non riuscita (HTTP ${response.status}).`);
  return response.json();
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
  }, false);
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
  let next = new URL(path, `${SPOTIFY_API}/`);
  const entries = [];
  let expectedOffset = Number(next.searchParams.get("offset") || 0);
  let expectedTotal = null;
  while (next) {
    if (next.origin !== "https://api.spotify.com" || !next.pathname.startsWith("/v1/")) {
      throw new Error("Spotify ha restituito un indirizzo di paginazione non valido.");
    }
    const page = await spotifyRequest(next.href, accessToken);
    if (!Array.isArray(page.items) || page.items.length > 50
        || (page.offset !== undefined && Number(page.offset) !== expectedOffset)) {
      throw new Error("Risposta Spotify incompleta; nessun album è stato aggiunto.");
    }
    if (page.total !== undefined && page.total !== null) {
      const total = Number(page.total);
      if (!Number.isInteger(total) || total < 0 || entries.length + page.items.length > total
          || (expectedTotal !== null && total !== expectedTotal)) {
        throw new Error("Conteggio Spotify non valido; nessun album è stato aggiunto.");
      }
      expectedTotal = total;
    }
    entries.push(...page.items);
    if (entries.length > 5000) throw new Error("Playlist troppo grande per essere importata in una sola volta.");
    if (page.next === null || page.next === undefined) {
      if (expectedTotal !== null && entries.length !== expectedTotal) {
        throw new Error("Lettura playlist incompleta; nessun album è stato aggiunto.");
      }
      return entries;
    }
    if (typeof page.next !== "string" || !page.next || !page.items.length || entries.length >= 5000) {
      throw new Error("Paginazione Spotify incompleta; nessun album è stato aggiunto.");
    }
    expectedOffset += page.items.length;
    next = new URL(page.next);
  }
  return entries;
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
  const entries = await completeSpotifyPages(`playlists/${encodeURIComponent(playlist.id)}/items?limit=50&offset=0`, accessToken);
  const latest = await spotifyRequest(`playlists/${encodeURIComponent(playlist.id)}?fields=id,snapshot_id`, accessToken);
  if (latest.id !== playlist.id || latest.snapshot_id !== playlist.snapshot_id) {
    throw new Error("La playlist è cambiata durante la lettura. Ripeti l’importazione.");
  }
  const additions = playlistAlbumRecords(entries);
  const result = addPlaylistAlbums(state.albums, additions);
  const previous = state.albums;
  state.albums = result.albums;
  try {
    if (result.added) saveState();
  } catch (error) {
    state.albums = previous;
    throw error;
  }
  if (result.added) {
    render();
    setSyncState("Album aggiunti localmente · sincronizza per inviarli");
  } else {
    setSyncState("Playlist importata · nessun album nuovo");
  }
  showMessage("Importazione playlist completata",
    `${playlist.name}: ${entries.length} brani letti, ${additions.length} album trovati, ${result.added} aggiunti e ${result.duplicates} già presenti. Nessun dato è stato inviato a GitHub.`);
}

async function importSpotifyPlaylist(input, accessToken = null) {
  $("#playlistImportButton").disabled = true;
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
  }
}

async function startSpotifyAuthorization(input, task = "playlist") {
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
  authorization.search = new URLSearchParams(authorizationParameters);
  location.assign(authorization);
}

async function finishSpotifyAuthorization() {
  const callback = new URL(location.href);
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
  for (const key of ["accord-spotify-oauth-state", "accord-spotify-code-verifier",
    "accord-spotify-oauth-redirect", "accord-spotify-pending-playlist",
    "accord-spotify-pending-playlist-create",
    "accord-spotify-pending-playlist-builder",
    "accord-spotify-pending-albums", "accord-spotify-pending-manual-search",
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
    if (pendingPlaylistBuilder) {
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
      const result = await createTopArtistPlaylist(request.name, request.preview, tokens.access_token);
      $("#playlistBuilderStatus").textContent =
        `Playlist privata creata: ${result.playlist.name || request.name} · ${result.tracks} brani.`;
      showMessage("Playlist Spotify creata",
        `${result.playlist.name || request.name}: ${result.tracks} brani aggiunti. La playlist è privata.`
        + (result.playlist.external_urls?.spotify ? ` ${result.playlist.external_urls.spotify}` : ""));
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
  $("#playlistInput").value = "";
  $("#playlistDialog").showModal();
});

$("#manualAlbumButton").addEventListener("click", () => {
  $("#manualAlbumSource").value = "lastfm";
  $("#manualAlbumQuery").value = "";
  $("#manualAlbumArtist").value = "";
  $("#manualAlbumGenre").value = "";
  $("#manualAlbumYear").value = "";
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

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...options.headers },
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    if (response.status === 409) throw new Error("Repository modificato in parallelo. Rileggi e risolvi di nuovo i conflitti.");
    if ([401, 403, 404].includes(response.status)) {
      throw new Error(`GitHub ha rifiutato l'accesso (HTTP ${response.status}). Verifica proprietario, repository privato e permessi Contents del token.`);
    }
    throw new Error(`Errore GitHub HTTP ${response.status}.`);
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
  const response = await fetch(fileUrl, { headers: authHeaders(), credentials: "omit", referrerPolicy: "no-referrer" });
  let albums = [];
  let sha = null;
  let legacyStatusesFound = false;
  if (response.status !== 404) {
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error(`Accesso al file rifiutato da GitHub (HTTP ${response.status}). Verifica il permesso Contents.`);
      throw new Error(`Errore GitHub HTTP ${response.status} durante la lettura di albums.json.`);
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
  const coverUrl = `${repoUrl}/contents/covers.bin?ref=${encodeURIComponent(branch)}`;
  const metadataResponse = await fetch(coverUrl, {
    headers: authHeaders(), credentials: "omit", referrerPolicy: "no-referrer",
  });
  if (metadataResponse.status === 404) {
    return { albums, sha, branch, covers: new Map(), coversSha: null, coverArchive: new Uint8Array(), legacyStatusesFound };
  }
  if (!metadataResponse.ok) {
    if ([401, 403].includes(metadataResponse.status)) throw new Error(`Accesso a covers.bin rifiutato da GitHub (HTTP ${metadataResponse.status}). Verifica il permesso Contents.`);
    throw new Error(`Errore GitHub HTTP ${metadataResponse.status} durante la lettura di covers.bin.`);
  }
  const metadata = await metadataResponse.json();
  if (metadata.type !== "file" || typeof metadata.sha !== "string") throw new Error("covers.bin non e' un file GitHub valido.");
  const rawResponse = await fetch(coverUrl, {
    headers: { ...authHeaders(), Accept: "application/vnd.github.raw+json" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!rawResponse.ok) throw new Error(`Errore GitHub HTTP ${rawResponse.status} durante il download di covers.bin.`);
  const coverArchive = new Uint8Array(await rawResponse.arrayBuffer());
  const covers = await decodeCoverArchive(coverArchive);
  return { albums, sha, branch, covers, coversSha: metadata.sha, coverArchive, legacyStatusesFound };
}

function encodeBase64(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""));
}

async function writeRemote(owner, records, sha, branch) {
  const document = {
    format: "accord-album-collection",
    version: 3,
    updated_at: new Date().toISOString(),
    albums: validateDocument({ format: "accord-album-collection", version: 3, albums: records }),
  };
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
  for (const conflict of conflicts) {
    const article = document.createElement("article");
    article.className = "conflict-card";
    const heading = document.createElement("h3");
    heading.textContent = `${conflict.local.name} · ${conflict.local.artist}`;
    article.append(heading);
    for (const [source, record] of [["base", conflict.base], ["locale", conflict.local], ["GitHub", conflict.remote]]) {
      const detail = document.createElement("p");
      detail.textContent = `${source}: ${albumDescription(record)}`;
      article.append(detail);
    }
    const fieldset = document.createElement("fieldset");
    fieldset.setAttribute("aria-label", `Scelta per ${conflict.local.name}`);
    for (const [value, label] of [["local", "Mantieni questo dispositivo"], ["remote", "Usa GitHub"]]) {
      const choice = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `conflict-${conflict.id}`;
      radio.value = value;
      radio.required = true;
      choice.append(radio, document.createTextNode(label));
      fieldset.append(choice);
    }
    article.append(fieldset);
    list.append(article);
  }
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      if (dialog.returnValue !== "resolve") return resolve(null);
      const choices = {};
      for (const conflict of conflicts) {
        const picked = dialog.querySelector(`input[name="conflict-${CSS.escape(conflict.id)}"]:checked`);
        if (!picked) return resolve(null);
        choices[conflict.id] = picked.value;
      }
      resolve(choices);
    }, { once: true });
  });
}

async function sync(choices = {}) {
  const { owner, token } = credentials();
  if (!owner || !token) {
    openSettings();
    return;
  }
  $("#syncButton").disabled = true;
  setSyncState("Sincronizzazione in corso…");
  try {
    if (state.loadError) throw new Error(`Archivio locale non leggibile: ${state.loadError}`);
    const remote = await readRemote(owner);
    const merged = threeWayMerge(state.base, state.albums, remote.albums, choices);
    if (merged.conflicts.length) {
      setSyncState(`${merged.conflicts.length} conflitto${merged.conflicts.length === 1 ? "" : "i"}`);
      const resolutions = await chooseConflicts(merged.conflicts);
      if (!resolutions) return;
      await sync(resolutions);
      return;
    }
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
    if (coversChanged) await writeRemoteCovers(owner, updatedCoverArchive, remote.coversSha, remote.branch);
    const remoteState = JSON.stringify(remote.albums);
    const finalState = JSON.stringify(merged.albums);
    if (finalState !== remoteState || remote.legacyStatusesFound) {
      await writeRemote(owner, merged.albums, remote.sha, remote.branch);
    }
    state.albums = merged.albums;
    state.base = merged.albums;
    saveState();
    render();
    setSyncState(`Sincronizzati ${merged.albums.length} album · aggiornato ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    setSyncState("Sincronizzazione non riuscita");
    showMessage("Errore di sincronizzazione", error.message);
  } finally {
    $("#syncButton").disabled = false;
    if (automaticSyncQueued && credentials().owner && credentials().token) {
      automaticSyncQueued = false;
      queueMicrotask(() => void sync());
    }
  }
}

$("#syncButton").addEventListener("click", () => sync());
$("#conflictForm").addEventListener("submit", (event) => {
  if (event.submitter?.value === "resolve") {
    const missing = [...$("#conflictList").querySelectorAll("fieldset")].some((fieldset) => !fieldset.querySelector(":checked"));
    if (missing) event.preventDefault();
  }
});

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
$("#lastfmSuggestionButton").addEventListener("click", (event) => {
  void suggestListeningAlbums(event.currentTarget);
});

render();
restoreListeningSuggestionsForSpotifyReturn();
finishSpotifyAuthorization().catch((error) => {
  setSyncState("Autorizzazione Spotify non riuscita");
  showMessage("Errore autorizzazione Spotify", error.message);
});
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    setSyncState("Cache offline non disponibile");
    console.error("Accord PWA service worker:", error);
  });
}
if (credentials().autoSync && credentials().token) sync();
