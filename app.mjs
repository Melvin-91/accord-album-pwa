import {
  addPlaylistAlbums,
  bestSpotifyAlbumSuggestionMatch,
  filterListeningAlbumSuggestions,
  filterUnheardArtists,
  filterAlbums,
  moveAlbumInManualOrder,
  normalizeHeardArtistNames,
  decodeCoverArchive,
  encodeCoverArchive,
  listenBrainzRecommendations,
  lastFmSuggestionRange,
  musicBrainzCoverArtUrl,
  playlistAlbumRecords,
  primaryAlbumGenres,
  findSpotifyPlaylistMatches,
  listeningAlbumSuggestions,
  readMusicBrainzCatalog,
  readLastFmAllTimeArtists,
  sortAlbumsByManualOrder,
  spotifyAlbumId,
  spotifyHistoryArtistLastPlayed,
  spotifyHistoryArtistsInRange,
  spotifyHistoryArtistNames,
  spotifyPlaylistId,
  spotifyRedirectUriForPage,
  summarizeLastFmTracks,
  topTracksPerAlbum,
  threeWayMerge,
  validateAlbum,
  validateDocument,
} from "./core.mjs?v=22";

const STORAGE_KEY = "accord-album-pwa-v1";
const COVER_DATABASE = "accord-album-covers-v1";
const COVER_STORE = "covers";
const ACTIVE_VIEW_TAB_KEY = "accord-active-view-tab";
const SUGGESTION_RETURN_KEY = "accord-spotify-suggestion-return";
const REPOSITORY = "accord-music-data";
const API = "https://api.github.com";
const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_ACCOUNTS = "https://accounts.spotify.com";
const LASTFM_API = "https://ws.audioscrobbler.com/2.0/";
const SPOTIFY_HEARD_ARTISTS_KEY = "accord-spotify-heard-artists-v1";
const SPOTIFY_HEARD_ARTIST_LAST_PLAYED_KEY = "accord-spotify-heard-artist-last-played-v1";
const suggestedSourceAlbums = new Map();
const suggestedSpotifyAlbums = new Map();
const suggestedSpotifyCoverMatches = new Map();
const suggestedCoverFrames = new Map();
const suggestedSpotifyMatchCache = new Map();
const spotifyAlbumMetadata = new Map();
const suggestionCoverQueue = [];
const suggestionCoverTasks = new WeakMap();
const listeningCatalogCache = new Map();
const allTimeArtistCache = new Map();
let suggestedMatchAlbumId = null;
let lastListeningCatalogRequestAt = 0;
let suggestionCoverObserver = null;
let suggestionCoverTokenPromise = null;
let suggestionCoverJobsActive = 0;
let suggestionCoverFailureShown = false;
const LASTFM_KEY = "accord-lastfm-api-key";
const labels = { queued: "Da ascoltare", listening: "In ascolto", heard: "Ascoltato", liked: "Mi piace", hidden: "Non proporre" };
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

function render() {
  finishManualDrag(false);
  ensureManualOrder();
  refreshSuggestionSeeds();
  refreshGroupFilter("#genreFilter", "genres", "Tutti i generi");
  refreshGroupFilter("#collectionFilter", "collections", "Tutte le collezioni");
  refreshGroupFilter("#tagFilter", "tags", "Tutti i tag");
  const sortOrder = $("#sortOrder").value;
  const filteredAlbums = filterAlbums(state.albums, {
    search: $("#searchInput").value,
    genre: $("#genreFilter").value,
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
  const albumsWithoutCover = state.albums.filter((album) => !album.cover_sha256).length;
  setCoverNotice(albumsWithoutCover
    ? `${albumsWithoutCover} album non hanno ancora una miniatura nel repository. Avvia “Sincronizza ora” in Accord desktop dopo l’aggiornamento, poi premi “Sincronizza” sul telefono.`
    : "");
  for (const [index, album] of albums.entries()) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.albumId = album.id;
    if (manualSorting) card.classList.add("manual-sortable");
    card.querySelector(".album-title").textContent = album.name;
    card.querySelector(".album-meta").textContent =
      `${album.artist} · ${album.year || "Anno sconosciuto"} · ${labels[album.status]}`;
    const coverImage = card.querySelector(".album-cover");
    coverImage.alt = `Copertina di ${album.name}`;
    card.querySelector(".cover-placeholder").textContent = album.cover_sha256
      ? "Premi Sincronizza per scaricare"
      : "Da sincronizzare dal PC";
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
    for (const [index, album] of albums.entries()) {
      if (!album.cover_sha256) {
        unavailable += 1;
        continue;
      }
      const data = await getCachedCover(album.id);
      if (!data) {
        unavailable += 1;
        continue;
      }
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
      const hash = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
      if (hash !== album.cover_sha256) {
        unavailable += 1;
        continue;
      }
      if (generation !== coverRenderGeneration) return;
      const card = [...$("#albumList").children].find((element) => element.dataset.albumId === album.id);
      if (!card) continue;
      const url = URL.createObjectURL(new Blob([data], { type: "image/jpeg" }));
      coverObjectUrls.push(url);
      const image = card.querySelector(".album-cover");
      image.loading = index < 8 ? "eager" : "lazy";
      image.addEventListener("load", () => {
        if (generation === coverRenderGeneration) card.classList.add("has-cover");
      }, { once: true });
      image.addEventListener("error", () => {
        if (generation !== coverRenderGeneration) return;
        card.querySelector(".cover-placeholder").textContent = "Miniatura non leggibile";
        card.classList.add("cover-error");
      }, { once: true });
      image.src = url;
    }
    if (generation !== coverRenderGeneration) return;
    if (unavailable && !state.albums.some((album) => !album.cover_sha256)) {
      setCoverNotice(`${unavailable} copertine non sono disponibili su questo dispositivo. Premi “Sincronizza” per scaricarle.`);
    }
  } catch (error) {
    setSyncState("Copertine offline non disponibili");
    showMessage("Errore archivio copertine", error.message);
  }
}

function refreshSuggestionSeeds() {
  const select = $("#suggestionSeed");
  const selected = select.value;
  const artists = [...new Set(state.albums.map((album) => album.artist))]
    .sort((a, b) => a.localeCompare(b, "it"));
  select.replaceChildren(new Option(artists.length ? "Scegli un artista" : "Nessun artista nella raccolta", ""));
  for (const artist of artists) select.add(new Option(artist, artist));
  select.value = artists.includes(selected) ? selected : "";
  $("#suggestionSearch").disabled = artists.length === 0;
}

async function identifyMusicBrainzArtist(name) {
  const url = new URL("https://musicbrainz.org/ws/2/artist/");
  url.search = new URLSearchParams({ query: `artist:"${name}"`, fmt: "json", limit: "10" });
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`Ricerca MusicBrainz non riuscita (HTTP ${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data.artists)) throw new Error("Risposta MusicBrainz non valida.");
  const exact = data.artists.filter((artist) => typeof artist?.name === "string"
    && artist.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()
    && typeof artist.id === "string" && /^[0-9a-f-]{36}$/i.test(artist.id));
  if (!exact.length) throw new Error(`MusicBrainz non ha trovato un profilo verificabile per “${name}”.`);
  if (exact.length === 1) return exact[0];
  const select = $("#musicbrainzArtistChoice");
  select.replaceChildren();
  for (const artist of exact) {
    const details = [artist.disambiguation, artist.area?.name].filter(Boolean).join(" · ");
    select.add(new Option(details ? `${artist.name} · ${details}` : artist.name, artist.id));
  }
  const dialog = $("#musicbrainzArtistDialog");
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "choose"
        ? exact.find((artist) => artist.id === select.value) || null
        : null);
    }, { once: true });
  });
}

async function findSpotifyRelatedArtists(seedName, accessToken) {
  const artistQuery = new URLSearchParams({
    q: `artist:"${seedName.replace(/["\\]/g, "\\$&")}"`,
    type: "artist",
    limit: "5",
  });
  const matches = await spotifyRequest(`search?${artistQuery}`, accessToken);
  const artists = matches.artists?.items;
  if (!Array.isArray(artists)) throw new Error("Spotify non ha restituito profili artista verificabili.");
  const seed = artists.find((artist) => artist.name?.trim().toLocaleLowerCase()
    === seedName.trim().toLocaleLowerCase() && /^[A-Za-z0-9]{22}$/.test(artist.id || ""));
  if (!seed) throw new Error(`Spotify non ha trovato un profilo esatto per “${seedName}”.`);
  const response = await spotifyRequest(`artists/${encodeURIComponent(seed.id)}/related-artists`, accessToken);
  if (!Array.isArray(response.artists)) throw new Error("Risposta Spotify degli artisti correlati non valida.");
  const seen = new Set([seedName.trim().toLocaleLowerCase()]);
  const related = response.artists.filter((artist) => typeof artist?.name === "string"
    && artist.name.trim() && /^[A-Za-z0-9]{22}$/.test(artist.id || "")
    && !seen.has(artist.name.trim().toLocaleLowerCase()) && seen.add(artist.name.trim().toLocaleLowerCase()))
    .slice(0, 20)
    .map((artist) => ({ name: artist.name.trim(), score: 0, source: "Spotify" }));
  if (!related.length) throw new Error("Spotify non ha trovato artisti correlati.");
  return { seed: seed.name, artists: related, source: "Spotify" };
}

async function findSuggestedArtists(seedName, source = "listenbrainz", accessToken = null) {
  if (source === "spotify-related") {
    const token = accessToken || await spotifyAccessToken();
    if (!token) {
      const { clientId, redirectUri } = spotifySettings();
      if (!clientId || !redirectUri) {
        openSettings();
        showMessage("Configura Spotify", "Per usare i suggerimenti sperimentali Spotify, configura il Client ID e il Redirect URI.");
        return null;
      }
      await startSpotifyAuthorization(seedName, "related");
      return null;
    }
    const result = await findSpotifyRelatedArtists(seedName, token);
    return result ? excludeAllTimeHeardArtists(result) : null;
  }
  const seed = await identifyMusicBrainzArtist(seedName);
  if (!seed) {
    $("#suggestionStatus").textContent = "Ricerca annullata.";
    return null;
  }
  const url = new URL("https://labs.api.listenbrainz.org/similar-artists/json");
  url.search = new URLSearchParams({
    artist_mbids: seed.id,
    algorithm: "session_based_days_7500_session_300_contribution_3_threshold_10_limit_100_filter_True_skip_30",
  });
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`Ricerca ListenBrainz non riuscita (HTTP ${response.status}).`);
  const artists = listenBrainzRecommendations(await response.json(), seed.id);
  if (!artists.length) throw new Error("ListenBrainz non ha trovato artisti affini per questo profilo.");
  return excludeAllTimeHeardArtists({ seed: seed.name, artists, source: "ListenBrainz" });
}

function renderSuggestedArtists(result) {
  const container = $("#suggestionArtists");
  const albums = $("#suggestionAlbums");
  container.replaceChildren();
  albums.replaceChildren();
  for (const artist of result.artists) {
    const card = document.createElement("article");
    card.className = "suggestion-card";
    const info = document.createElement("p");
    const name = document.createElement("strong");
    name.textContent = artist.name;
    const detail = document.createElement("span");
    detail.className = "suggestion-detail";
    detail.textContent = result.source === "Spotify"
      ? " · Spotify (endpoint sperimentale)"
      : ` · Punteggio ListenBrainz ${artist.score}`;
    info.append(name, detail);
    const button = document.createElement("button");
    button.className = "secondary";
    button.type = "button";
    button.textContent = "Esplora album";
    button.addEventListener("click", () => void loadSuggestedAlbums(artist.name, button));
    card.append(info, button);
    container.append(card);
  }
  const label = result.artists.length === 1 ? "artista consigliato" : "artisti consigliati";
  const excluded = result.excludedHeardCount
    ? ` · ${result.excludedHeardCount} già ascoltati esclusi`
    : "";
  const coverage = ` · controllo all-time: Last.fm ${result.lastfmHistoryLoaded
    ? `${result.lastfmHeardArtistCount} artisti`
    : "non configurato"}, Spotify locale ${result.spotifyHeardArtistCount} artisti`;
  $("#suggestionStatus").textContent = `${result.artists.length} ${label} per ${result.seed}${excluded}${coverage}.`;
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
            suggestedSpotifyAlbums.set(album.id, album);
            renderSuggestionPlaylistAction();
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

function importedSpotifyHeardArtistNames() {
  const serialized = localStorage.getItem(SPOTIFY_HEARD_ARTISTS_KEY);
  if (!serialized) return [];
  return normalizeHeardArtistNames(JSON.parse(serialized));
}

function importedSpotifyHeardArtistLastPlayed() {
  const serialized = localStorage.getItem(SPOTIFY_HEARD_ARTIST_LAST_PLAYED_KEY);
  if (!serialized) return [];
  const records = JSON.parse(serialized);
  if (!Array.isArray(records)) throw new Error("Lo storico Spotify datato locale non è un elenco valido.");
  return records.filter((record) => record && typeof record.name === "string"
    && typeof record.playedAt === "string" && Number.isFinite(Date.parse(record.playedAt)));
}

async function allTimeHeardArtistNames(username) {
  const spotify = importedSpotifyHeardArtistNames();
  const lastfm = username ? await lastFmAllTimeArtistNames(username) : [];
  return {
    names: normalizeHeardArtistNames([...lastfm, ...spotify]),
    lastfmCount: lastfm.length,
    spotifyCount: spotify.length,
    lastfmLoaded: Boolean(username),
  };
}

async function excludeAllTimeHeardArtists(result) {
  const username = $("#lastfmSuggestionUser").value.trim();
  if (username && !/^[A-Za-z0-9_.\- ]{1,64}$/.test(username)) {
    throw new Error("Inserisci un nome utente Last.fm valido prima di cercare suggerimenti.");
  }
  const heard = await allTimeHeardArtistNames(username);
  if (!heard.lastfmLoaded && !heard.spotifyCount) {
    throw new Error("Per escludere gli ascolti complessivi, inserisci un utente Last.fm o importa lo storico Spotify.");
  }
  const artists = filterUnheardArtists(result.artists, heard.names);
  if (!artists.length) throw new Error("Tutti gli artisti consigliati risultano già ascoltati nella cronologia disponibile.");
  return {
    ...result,
    artists,
    excludedHeardCount: result.artists.length - artists.length,
    lastfmHeardArtistCount: heard.lastfmCount,
    spotifyHeardArtistCount: heard.spotifyCount,
    lastfmHistoryLoaded: heard.lastfmLoaded,
  };
}

async function similarLastFmArtists(name) {
  const data = await lastFmRequest({ method: "artist.getsimilar", artist: name, limit: "10", autocorrect: "0" });
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
      const delay = 1100 - (Date.now() - lastListeningCatalogRequestAt);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      lastListeningCatalogRequestAt = Date.now();
      const parameters = new URLSearchParams({
        query,
        fmt: "json",
        limit: String(limit),
        offset: String(offset),
      });
      const response = await fetch(`https://musicbrainz.org/ws/2/release-group?${parameters}`, {
        headers: { Accept: "application/json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error(`MusicBrainz ha risposto con HTTP ${response.status}.`);
      return response.json();
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

async function suggestListeningAlbums(button) {
  button.disabled = true;
  $("#suggestionStatus").textContent = "Leggo gli ascolti Last.fm e preparo le proposte…";
  $("#suggestionArtists").replaceChildren();
  $("#suggestionAlbums").replaceChildren();
  suggestedSourceAlbums.clear();
  suggestedSpotifyAlbums.clear();
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
      exclusion = { names: [], lastfmCount: 0, spotifyCount: 0, partial: false, legacyCount: 0 };
    } else if (exclusionPeriod === "all") {
      const allTimeHeard = await allTimeHeardArtistNames(username);
      exclusion = { ...allTimeHeard, partial: false, legacyCount: 0 };
    } else {
      const exclusionRange = lastFmSuggestionRange(exclusionPeriod);
      const windowHistory = period === exclusionPeriod ? history
        : await recentLastFmScrobbles(username, exclusionRange);
      const importedNames = importedSpotifyHeardArtistNames();
      const importedDated = importedSpotifyHeardArtistLastPlayed();
      const datedSpotify = spotifyHistoryArtistsInRange(
        importedDated, exclusionRange.from, exclusionRange.to);
      const datedKeys = new Set(importedDated.map((record) => record.name.toLocaleLowerCase()));
      exclusion = {
        names: normalizeHeardArtistNames([
          ...windowHistory.artists.map((artist) => artist.name),
          ...datedSpotify,
        ]),
        lastfmCount: windowHistory.artists.length,
        spotifyCount: datedSpotify.length,
        partial: windowHistory.partial,
        legacyCount: importedNames.filter((name) => !datedKeys.has(name.toLocaleLowerCase())).length,
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
    const seeds = history.artists.filter((artist) => !excluded.has(artist.name.toLocaleLowerCase())).slice(0, 5);
    if (!history.trackCount || !seeds.length) throw new Error("Nessun ascolto Last.fm utile nel periodo selezionato.");
    const similar = new Map();
    for (const seed of seeds) {
      for (const candidate of await similarLastFmArtists(seed.name)) {
        const key = candidate.name.toLocaleLowerCase();
        if (excluded.has(key) || seeds.some((entry) => entry.name.toLocaleLowerCase() === key)) continue;
        const entry = similar.get(key) || { ...candidate, seeds: [], support: 0 };
        entry.support += 1;
        entry.seeds.push(seed.name);
        entry.match = Math.max(entry.match, candidate.match);
        similar.set(key, entry);
      }
    }
    const candidates = filterUnheardArtists([...similar.values()], exclusion.names)
      .sort((a, b) => b.support - a.support || b.match - a.match || a.name.localeCompare(b.name))
      .slice(0, 10);
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
    const catalog = await searchListeningMusicBrainzAlbums(candidates);
    const eligibleAlbums = filterListeningAlbumSuggestions(catalog.albums, {
      knownAlbums: history.knownAlbums,
      collection: state.albums,
      heardArtists: exclusion.names,
      ...filters,
    });
    const albums = listeningAlbumSuggestions(eligibleAlbums, rankings, candidates, 3);
    renderListeningAlbumSuggestions(albums);
    const relatedNote = albums.some((album) => album.matchConfidence === "related")
      ? " · nessuna corrispondenza Last.fm: mostrate solo alternative correlate del catalogo MusicBrainz"
      : "";
    const coverage = history.partial ? " · campione parziale (massimo 1.000 ascolti)" : "";
    const catalogNote = catalog.truncated
      ? ` · catalogo parziale: ${catalog.fetched} di ${catalog.total ?? "?"} risultati consultati`
      : ` · catalogo completo: ${catalog.fetched} risultati`;
    const catalogCache = catalog.cached ? " · catalogo riutilizzato dalla cache in memoria (15 min)" : "";
    const exclusionLabels = { none: "nessuna", 30: "ultimi 30 giorni", 90: "ultimi 3 mesi", 365: "ultimi 365 giorni", all: "tutto lo storico" };
    const exclusionCoverage = exclusionPeriod === "none" ? "esclusione disattivata"
      : `esclusione ${exclusionLabels[exclusionPeriod]}: Last.fm ${exclusion.lastfmCount} artisti${exclusion.partial ? " (campione parziale, max 1.000 ascolti)" : ""}`;
    const spotifyNote = exclusionPeriod === "all"
      ? ` · Spotify locale: ${exclusion.spotifyCount} artisti`
      : exclusionPeriod === "none" ? ""
        : ` · Spotify con data: ${exclusion.spotifyCount} artisti` +
          (exclusion.legacyCount ? `; ${exclusion.legacyCount} senza data, esclusi solo con tutto lo storico` : "") +
          (exclusion.spotifyCount || exclusion.legacyCount ? " (copertura in base ai file importati)" : "");
    $("#suggestionStatus").textContent = `${history.trackCount} ascolti nel periodo · ${seeds.length} artisti di partenza · ${albums.length} album candidati${relatedNote}${coverage} · ${exclusionCoverage}${spotifyNote} · MusicBrainz ${catalog.pages} pagine${catalogNote}${catalogCache}.`;
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
  renderSuggestionPlaylistAction();
}

function renderSuggestionPlaylistAction() {
  $("#createSuggestedPlaylist")?.remove();
  if (!suggestedSpotifyAlbums.size) return;
  const button = document.createElement("button");
  button.id = "createSuggestedPlaylist";
  button.className = "primary";
  button.type = "button";
  button.textContent = `Crea playlist · ${suggestedSpotifyAlbums.size}`;
  button.addEventListener("click", () => {
    $("#suggestionPlaylistName").value = "";
    $("#suggestionPlaylistStatus").textContent =
      `Saranno aggiunti fino a tre brani più popolari per ciascuno dei ${suggestedSpotifyAlbums.size} album abbinati. La playlist sarà privata.`;
    $("#suggestionPlaylistDialog").showModal();
    $("#suggestionPlaylistName").focus();
  });
  $("#suggestionAlbums").append(button);
}

async function createSuggestedPlaylist(name, albumIds, accessToken) {
  if (!name || name.length > 100 || !albumIds.length || albumIds.length > 30) {
    throw new Error("Nome non valido o numero di album fuori limite (massimo 30).");
  }
  const albumGroups = [];
  const trackIds = [];
  const seenTrackIds = new Set();
  let totalCandidates = 0;
  for (const albumId of albumIds) {
    if (!/^[A-Za-z0-9]{22}$/.test(albumId)) throw new Error("Un album suggerito non ha un ID Spotify verificabile.");
    const entries = await completeSpotifyPages(`albums/${albumId}/tracks?limit=50&offset=0`, accessToken);
    totalCandidates += entries.length;
    if (totalCandidates > 3000) throw new Error("Gli album contengono troppi brani da analizzare in una volta.");
    albumGroups.push({ tracks: entries });
    for (const entry of entries) {
      const match = typeof entry?.uri === "string" && entry.type === "track"
        ? entry.uri.match(/^spotify:track:([A-Za-z0-9]{22})$/) : null;
      if (match && !seenTrackIds.has(match[1])) {
        seenTrackIds.add(match[1]);
        trackIds.push(match[1]);
      }
    }
  }
  if (!trackIds.length) throw new Error("Gli album selezionati non contengono brani Spotify verificabili.");

  const popularityById = new Map();
  for (let offset = 0; offset < trackIds.length; offset += 50) {
    const batch = trackIds.slice(offset, offset + 50);
    const query = new URLSearchParams({ ids: batch.join(",") });
    const response = await spotifyRequest(`tracks?${query}`, accessToken);
    if (!response || !Array.isArray(response.tracks) || response.tracks.length !== batch.length) {
      throw new Error("Spotify non ha restituito la popolarità completa dei brani.");
    }
    response.tracks.forEach((track, index) => {
      const expectedId = batch[index];
      if (track === null) {
        popularityById.set(expectedId, 0);
        return;
      }
      if (track?.id !== expectedId) throw new Error("Risposta Spotify con brani non corrispondenti.");
      const score = track.popularity;
      if (!Number.isInteger(score) || score < 0 || score > 100) {
        throw new Error("Popolarità brano Spotify non valida.");
      }
      popularityById.set(expectedId, score);
    });
  }
  const tracks = topTracksPerAlbum(albumGroups, popularityById);
  if (!tracks.length) throw new Error("Gli album selezionati non contengono brani Spotify verificabili.");

  const playlist = await spotifyWriteRequest("me/playlists", accessToken, {
    name,
    description: "Creata da Accord · brani più popolari degli album suggeriti",
    public: false,
  });
  if (!/^[A-Za-z0-9]{22}$/.test(playlist?.id || "")) {
    throw new Error("Spotify non ha restituito una playlist verificabile.");
  }
  try {
    for (let offset = 0; offset < tracks.length; offset += 100) {
      await spotifyWriteRequest(`playlists/${playlist.id}/items`, accessToken, {
        uris: tracks.slice(offset, offset + 100),
      });
    }
  } catch (error) {
    const url = playlist.external_urls?.spotify;
    throw new Error(`Playlist creata ma aggiunta dei brani incompleta: ${error.message}`
      + (url ? ` Apri la playlist e verifica i brani: ${url}` : ` ID playlist: ${playlist.id}`));
  }
  return { playlist, tracks: tracks.length };
}

async function beginSuggestedPlaylistCreation(name, albumIds, accessToken = null) {
  const token = accessToken || await spotifyAccessToken();
  if (!sessionStorage.getItem("accord-spotify-playlist-write-authorized")) {
    await startSpotifyAuthorization(JSON.stringify({ name, albumIds }), "playlist-create");
    return;
  }
  if (!token) {
    await startSpotifyAuthorization(JSON.stringify({ name, albumIds }), "playlist-create");
    return;
  }
  const result = await createSuggestedPlaylist(name, albumIds, token);
  $("#suggestionPlaylistDialog").close();
  showMessage("Playlist Spotify creata",
    `${result.playlist.name || name}: ${result.tracks} brani aggiunti. La playlist è privata.`
    + (result.playlist.external_urls?.spotify ? ` ${result.playlist.external_urls.spotify}` : ""));
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
      if (suggestedSourceAlbums.has(album.id)) {
        suggestedSpotifyAlbums.set(match.id, match);
        renderSuggestionPlaylistAction();
      }
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
    suggestedSpotifyAlbums.clear();
    for (const album of albums) suggestedSpotifyAlbums.set(album.id, album);
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
    renderSuggestionPlaylistAction();
  } catch (error) {
    $("#suggestionStatus").textContent = `Esplorazione album non riuscita: ${error.message}`;
  } finally {
    if (trigger?.isConnected) trigger.disabled = false;
  }
}

$("#suggestionSearch").addEventListener("click", async () => {
  const seedName = $("#suggestionSeed").value;
  if (!seedName) return;
  const button = $("#suggestionSearch");
  button.disabled = true;
  $("#suggestionStatus").textContent = `Cerco artisti affini a ${seedName}…`;
  $("#suggestionArtists").replaceChildren();
  $("#suggestionAlbums").replaceChildren();
  try {
    const result = await findSuggestedArtists(seedName, $("#suggestionSource").value);
    if (result) renderSuggestedArtists(result);
  } catch (error) {
    $("#suggestionStatus").textContent = `Ricerca suggerimenti non riuscita: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

function setCoverNotice(message) {
  const notice = $("#coverSyncNotice");
  notice.hidden = !message;
  notice.textContent = message;
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

for (const input of [$("#searchInput"), $("#genreFilter"), $("#statusFilter"),
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
    "accord-spotify-token-expires", "accord-spotify-playlist-write-authorized"]) sessionStorage.removeItem(key);
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

async function spotifyRequest(path, accessToken) {
  const url = new URL(path, `${SPOTIFY_API}/`);
  if (url.origin !== "https://api.spotify.com" || !url.pathname.startsWith("/v1/")) {
    throw new Error("Indirizzo API Spotify non valido.");
  }
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (response.status === 401) {
    clearSpotifySession();
    throw new Error("Sessione Spotify scaduta. Avvia di nuovo l’importazione per autorizzarti.");
  }
  if (response.status === 403) throw new Error("Spotify non consente questa richiesta. Verifica accesso e autorizzazioni.");
  if (response.status === 429) {
    const delay = response.headers.get("Retry-After");
    throw new Error(`Limite richieste Spotify raggiunto${delay ? `; riprova tra ${delay} secondi` : ""}.`);
  }
  if (!response.ok) throw new Error(`Richiesta Spotify non riuscita (HTTP ${response.status}).`);
  return response.json();
}

async function spotifyWriteRequest(path, accessToken, body) {
  const url = new URL(path, `${SPOTIFY_API}/`);
  if (url.origin !== "https://api.spotify.com" || !url.pathname.startsWith("/v1/")) {
    throw new Error("Indirizzo API Spotify non valido.");
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (response.status === 401) {
    clearSpotifySession();
    throw new Error("Sessione Spotify scaduta. Ricollega l’account e riprova.");
  }
  if (response.status === 403) {
    throw new Error("Spotify ha negato la scrittura. Autorizza il permesso playlist-modify-private e riprova.");
  }
  if (response.status === 429) {
    const delay = response.headers.get("Retry-After");
    throw new Error(`Limite richieste Spotify raggiunto${delay ? `; riprova tra ${delay} secondi` : ""}.`);
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
    albums: "accord-spotify-pending-albums",
    "manual-search": "accord-spotify-pending-manual-search",
    related: "accord-spotify-pending-related",
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
  if (task === "playlist-create") authorizationParameters.scope = "playlist-modify-private";
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
  const pendingAlbums = sessionStorage.getItem("accord-spotify-pending-albums");
  const pendingManualSearch = sessionStorage.getItem("accord-spotify-pending-manual-search");
  const pendingRelated = sessionStorage.getItem("accord-spotify-pending-related");
  for (const key of ["accord-spotify-oauth-state", "accord-spotify-code-verifier",
    "accord-spotify-oauth-redirect", "accord-spotify-pending-playlist",
    "accord-spotify-pending-playlist-create",
    "accord-spotify-pending-albums", "accord-spotify-pending-manual-search",
    "accord-spotify-pending-related"]) sessionStorage.removeItem(key);
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
    if (pendingPlaylistCreate) {
      const grants = String(tokens.scope || "").split(/\s+/);
      if (!grants.includes("playlist-modify-private")) {
        throw new Error("Spotify non ha concesso il permesso playlist-modify-private; nessuna playlist è stata creata.");
      }
      sessionStorage.setItem("accord-spotify-playlist-write-authorized", "1");
      let request;
      try {
        request = JSON.parse(pendingPlaylistCreate);
      } catch {
        throw new Error("Richiesta di creazione playlist non valida.");
      }
      const result = await createSuggestedPlaylist(request.name, request.albumIds, tokens.access_token);
      showMessage("Playlist Spotify creata",
        `${result.playlist.name || request.name}: ${result.tracks} brani aggiunti. La playlist è privata.`
        + (result.playlist.external_urls?.spotify ? ` ${result.playlist.external_urls.spotify}` : ""));
    }
    else if (pendingPlaylist) await importSpotifyPlaylist(pendingPlaylist, tokens.access_token);
    else if (pendingAlbums) await loadSuggestedAlbums(pendingAlbums, null, tokens.access_token);
    else if (pendingRelated) {
      const result = await findSuggestedArtists(pendingRelated, "spotify-related", tokens.access_token);
      if (result) renderSuggestedArtists(result);
    }
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

$("#suggestionPlaylistForm").addEventListener("submit", (event) => {
  if (event.submitter?.value !== "create") return;
  event.preventDefault();
  const name = $("#suggestionPlaylistName").value.trim();
  const albumIds = [...suggestedSpotifyAlbums.keys()];
  if (!name || !albumIds.length) {
    $("#suggestionPlaylistStatus").textContent = "Inserisci un nome e abbina almeno un album Spotify.";
    return;
  }
  $("#suggestionPlaylistStatus").textContent = "Seleziono i brani più popolari degli album selezionati…";
  void beginSuggestedPlaylistCreation(name, albumIds).catch((error) => {
    $("#suggestionPlaylistStatus").textContent = `Creazione playlist non riuscita: ${error.message}`;
  });
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
    return { albums, sha, branch, covers: new Map(), coversSha: null, coverArchive: new Uint8Array() };
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
  return { albums, sha, branch, covers, coversSha: metadata.sha, coverArchive };
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
    version: 2,
    updated_at: new Date().toISOString(),
    albums: validateDocument({ format: "accord-album-collection", version: 2, albums: records }),
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
    if (finalState !== remoteState) await writeRemote(owner, merged.albums, remote.sha, remote.branch);
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

function refreshSpotifyHistoryStatus() {
  try {
    const count = importedSpotifyHeardArtistNames().length;
    const datedCount = importedSpotifyHeardArtistLastPlayed().length;
    $("#spotifyHistoryStatus").textContent = count
      ? `${count} artisti Spotify salvati localmente; ${datedCount} con ultimo ascolto datato. I file non vengono caricati né sincronizzati.`
      : "Nessun artista Spotify importato.";
  } catch (error) {
    $("#spotifyHistoryStatus").textContent = `Archivio artisti Spotify locale non leggibile: ${error.message}`;
  }
}

$("#spotifyHistoryImportButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const input = $("#spotifyHistoryFiles");
  button.disabled = true;
  try {
    const files = [...input.files];
    if (!files.length) throw new Error("Seleziona i file JSON Extended Streaming History.");
    if (files.length > 10) throw new Error("Seleziona al massimo 10 file alla volta; puoi importare più gruppi.");
    let imported = [];
    let importedDated = [];
    for (const file of files) {
      if (file.size > 50_000_000) throw new Error(`${file.name}: il limite è 50 MB per file.`);
      const history = JSON.parse(await file.text());
      imported = [...imported, ...spotifyHistoryArtistNames(history)];
      importedDated = [...importedDated, ...spotifyHistoryArtistLastPlayed(history)];
    }
    if (!imported.length) throw new Error("Nei file selezionati non sono stati trovati artisti ascoltati.");
    const artists = normalizeHeardArtistNames([...importedSpotifyHeardArtistNames(), ...imported]);
    localStorage.setItem(SPOTIFY_HEARD_ARTISTS_KEY, JSON.stringify(artists));
    const dated = new Map(importedSpotifyHeardArtistLastPlayed()
      .map((record) => [record.name.toLocaleLowerCase(), record]));
    for (const record of importedDated) {
      const key = record.name.toLocaleLowerCase();
      if (!dated.has(key) || Date.parse(record.playedAt) > Date.parse(dated.get(key).playedAt)) {
        dated.set(key, record);
      }
    }
    localStorage.setItem(SPOTIFY_HEARD_ARTIST_LAST_PLAYED_KEY, JSON.stringify([...dated.values()]));
    $("#spotifyHistoryStatus").textContent =
      `${artists.length} artisti Spotify salvati localmente; ${dated.size} con ultimo ascolto datato. File e ascolti non vengono caricati né sincronizzati.`;
  } catch (error) {
    $("#spotifyHistoryStatus").textContent = `Importazione Spotify non riuscita: ${error.message}`;
  } finally {
    input.value = "";
    button.disabled = false;
  }
});

$("#spotifyHistoryClearButton").addEventListener("click", () => {
  try {
    localStorage.removeItem(SPOTIFY_HEARD_ARTISTS_KEY);
    localStorage.removeItem(SPOTIFY_HEARD_ARTIST_LAST_PLAYED_KEY);
    $("#spotifyHistoryStatus").textContent = "Nomi artista Spotify rimossi da questo browser.";
  } catch (error) {
    $("#spotifyHistoryStatus").textContent = `Rimozione non riuscita: ${error.message}`;
  }
});

refreshSpotifyHistoryStatus();
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
