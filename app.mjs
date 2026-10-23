import {
  addPlaylistAlbums,
  filterAlbums,
  moveAlbumInManualOrder,
  decodeCoverArchive,
  encodeCoverArchive,
  listenBrainzRecommendations,
  playlistAlbumRecords,
  sortAlbumsByManualOrder,
  spotifyAlbumId,
  spotifyPlaylistId,
  threeWayMerge,
  validateAlbum,
  validateDocument,
} from "./core.mjs?v=6";

const STORAGE_KEY = "accord-album-pwa-v1";
const COVER_DATABASE = "accord-album-covers-v1";
const COVER_STORE = "covers";
const REPOSITORY = "accord-music-data";
const API = "https://api.github.com";
const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_ACCOUNTS = "https://accounts.spotify.com";
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
}

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

function credentials() {
  return {
    owner: localStorage.getItem("accord-album-owner") || "",
    token: localStorage.getItem("accord-album-token") || "",
    autoSync: localStorage.getItem("accord-album-autosync") === "true",
  };
}

function spotifySettings() {
  return {
    clientId: localStorage.getItem("accord-spotify-client-id") || "",
    redirectUri: localStorage.getItem("accord-spotify-redirect-uri") || "",
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
  $("#spotifyRedirectUriInput").value = spotify.redirectUri || `${location.origin}${location.pathname}`;
  $("#settingsDialog").showModal();
}

$("#settingsButton").addEventListener("click", openSettings);
$("#settingsForm").addEventListener("submit", (event) => {
  if (event.submitter?.value !== "save") return;
  event.preventDefault();
  const owner = $("#ownerInput").value.trim();
  const token = $("#tokenInput").value.trim() || credentials().token;
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !token) {
    showMessage("Configurazione incompleta", "Inserisci il proprietario e un fine-grained token GitHub valido.");
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
  const localHttp = location.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  if ((clientId && !/^[A-Za-z0-9]{32}$/.test(clientId))
      || redirectUri.origin !== location.origin
      || redirectUri.pathname !== location.pathname
      || redirectUri.search || redirectUri.hash
      || (!localHttp && redirectUri.protocol !== "https:")
      || redirectUri.username || redirectUri.password) {
    showMessage("Impostazioni Spotify non valide", "Usa un Client ID di 32 caratteri e un Redirect URI HTTPS registrato che punti a questa pagina.");
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
      "Ordine manuale salvato solo su questo dispositivo: usa le frecce o trascina l’icona ↕.";
  }
  const generation = ++coverRenderGeneration;
  for (const url of coverObjectUrls) URL.revokeObjectURL(url);
  coverObjectUrls = [];
  $("#albumList").replaceChildren();
  $("#collectionSummary").textContent = `${albums.length} album · ${state.albums.length} nella raccolta`;
  $("#emptyState").hidden = albums.length !== 0;
  $("#emptyState").textContent = state.albums.length
    ? "Nessun album corrisponde ai filtri."
    : "La raccolta è vuota su questo dispositivo. Se gli album sono in Accord desktop, avvia prima “Sincronizza ora” sul PC con il repository accord-music-data, poi premi “Sincronizza” qui. In alternativa, importa una playlist Spotify.";
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
      dragHandle.draggable = true;
      moveUp.addEventListener("click", () => moveManualAlbum(album.id, index - 1, albums));
      moveDown.addEventListener("click", () => moveManualAlbum(album.id, index + 1, albums));
      dragHandle.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", album.id);
        card.classList.add("dragging");
      });
      dragHandle.addEventListener("dragend", () => {
        for (const element of $("#albumList").querySelectorAll(".dragging, .drag-over")) {
          element.classList.remove("dragging", "drag-over");
        }
      });
      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        card.classList.add("drag-over");
      });
      card.addEventListener("dragleave", (event) => {
        if (!card.contains(event.relatedTarget)) card.classList.remove("drag-over");
      });
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        const albumId = event.dataTransfer?.getData("text/plain");
        if (!albumId) return;
        const targetIndex = albums.findIndex((item) => item.id === album.id);
        moveManualAlbum(albumId, targetIndex, albums);
      });
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

async function findSuggestedArtists(seedName) {
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
  return { seed: seed.name, artists };
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
    detail.textContent = ` · Punteggio ListenBrainz ${artist.score}`;
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
  $("#suggestionStatus").textContent = `${result.artists.length} ${label} per ${result.seed}.`;
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
    const albums = playlistAlbumRecords(exact.map((album) => ({ item: { type: "track", album } })))
      .filter((album) => !state.albums.some((existing) => existing.id === album.id))
      .slice(0, 10);
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
      info.append(name, detail);
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

function renderManualAlbumResults(albums) {
  const container = $("#manualAlbumResults");
  container.replaceChildren();
  if (!albums.length) {
    const empty = document.createElement("p");
    empty.className = "suggestion-detail";
    empty.textContent = "Nessun album completo e verificabile trovato su Spotify.";
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
    info.append(name, detail);
    const button = document.createElement("button");
    button.className = "secondary";
    button.type = "button";
    const alreadyAdded = state.albums.some((existing) => existing.id === album.id);
    button.textContent = alreadyAdded ? "Già in raccolta" : "Aggiungi";
    button.disabled = alreadyAdded;
    button.addEventListener("click", () => {
      try {
        if (addAlbumToCollection(album, { syncAutomatically: true })) {
          button.textContent = "Aggiunto";
          button.disabled = true;
          button.setAttribute("aria-label", `${album.name} aggiunto alla raccolta`);
          $("#manualAlbumStatus").textContent = `${album.name} aggiunto localmente; sincronizzazione GitHub avviata o in attesa di configurazione.`;
        }
      } catch (error) {
        $("#manualAlbumStatus").textContent = `Album non aggiunto: ${error.message}`;
      }
    });
    card.append(info, button);
    container.append(card);
  }
}

async function searchSpotifyAlbums(input = $("#manualAlbumQuery").value, accessToken = null) {
  const query = input.trim();
  const button = $("#manualAlbumSearchButton");
  button.disabled = true;
  $("#manualAlbumStatus").textContent = "Ricerca su Spotify in corso…";
  $("#manualAlbumResults").replaceChildren();
  try {
    if (!query) throw new Error("Inserisci il titolo, l’artista o un link Spotify.");
    const token = accessToken || await spotifyAccessToken();
    if (!token) {
      const { clientId, redirectUri } = spotifySettings();
      if (!clientId || !redirectUri) {
        $("#manualAlbumStatus").textContent = "Configura il Client ID e il Redirect URI Spotify nelle impostazioni, poi riprova.";
        return;
      }
      await startSpotifyAuthorization(query, "manual-search");
      return;
    }
    const id = spotifyAlbumId(query);
    let albums;
    if (id) {
      const album = await spotifyRequest(`albums/${encodeURIComponent(id)}`, token);
      albums = playlistAlbumRecords([{ item: { type: "track", album } }]);
    } else {
      const parameters = new URLSearchParams({ q: query, type: "album", limit: "10" });
      const response = await spotifyRequest(`search?${parameters}`, token);
      if (!Array.isArray(response.albums?.items)) throw new Error("Risposta Spotify senza risultati verificabili.");
      albums = playlistAlbumRecords(response.albums.items.map((album) => ({ item: { type: "track", album } })));
    }
    renderManualAlbumResults(albums);
    $("#manualAlbumStatus").textContent = albums.length
      ? `${albums.length} album trovati. Scegli quali aggiungere alla raccolta.`
      : "Nessun nuovo album verificabile trovato su Spotify.";
  } catch (error) {
    $("#manualAlbumStatus").textContent = `Ricerca Spotify non riuscita: ${error.message}`;
  } finally {
    if (button.isConnected) button.disabled = false;
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
    const result = await findSuggestedArtists(seedName);
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
    "accord-spotify-token-expires"]) sessionStorage.removeItem(key);
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
  const playlists = await completeSpotifyPages("me/playlists?limit=50&offset=0", accessToken);
  const matches = playlists.filter((playlist) => typeof playlist.name === "string"
    && playlist.name.trim().toLocaleLowerCase() === input.trim().toLocaleLowerCase()
    && typeof playlist.id === "string");
  if (!matches.length) throw new Error("Non è stata trovata una playlist con quel nome nel tuo account Spotify.");
  if (matches.length === 1) return resolveSpotifyPlaylist(matches[0].id, accessToken);
  const selected = await chooseSpotifyPlaylist(matches);
  if (!selected) return null;
  return resolveSpotifyPlaylist(selected.id, accessToken);
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
    albums: "accord-spotify-pending-albums",
    "manual-search": "accord-spotify-pending-manual-search",
  };
  const pendingKey = pendingKeys[task];
  if (!pendingKey) throw new Error("Operazione Spotify non valida.");
  for (const key of Object.values(pendingKeys)) sessionStorage.removeItem(key);
  sessionStorage.setItem(pendingKey, input);
  sessionStorage.setItem("accord-spotify-code-verifier", verifier);
  sessionStorage.setItem("accord-spotify-oauth-state", oauthState);
  sessionStorage.setItem("accord-spotify-oauth-redirect", redirectUri);
  const authorization = new URL(`${SPOTIFY_ACCOUNTS}/authorize`);
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "playlist-read-private playlist-read-collaborative",
    state: oauthState,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
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
  const pendingAlbums = sessionStorage.getItem("accord-spotify-pending-albums");
  const pendingManualSearch = sessionStorage.getItem("accord-spotify-pending-manual-search");
  for (const key of ["accord-spotify-oauth-state", "accord-spotify-code-verifier",
    "accord-spotify-oauth-redirect", "accord-spotify-pending-playlist",
    "accord-spotify-pending-albums", "accord-spotify-pending-manual-search"]) sessionStorage.removeItem(key);
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
    if (pendingPlaylist) await importSpotifyPlaylist(pendingPlaylist, tokens.access_token);
    else if (pendingAlbums) await loadSuggestedAlbums(pendingAlbums, null, tokens.access_token);
    else if (pendingManualSearch) {
      $("#manualAlbumQuery").value = pendingManualSearch;
      $("#manualAlbumDialog").showModal();
      await searchSpotifyAlbums(pendingManualSearch, tokens.access_token);
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
  $("#manualAlbumQuery").value = "";
  $("#manualAlbumStatus").textContent = "";
  $("#manualAlbumResults").replaceChildren();
  $("#manualAlbumDialog").showModal();
  $("#manualAlbumQuery").focus();
});

$("#manualAlbumSearchForm").addEventListener("submit", (event) => {
  if (event.submitter?.value !== "search") return;
  event.preventDefault();
  void searchSpotifyAlbums($("#manualAlbumQuery").value);
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

render();
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
