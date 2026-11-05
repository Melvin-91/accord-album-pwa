import {
  TIDAL_SCOPES, createTidalTransport, createTidalAuth, tidalAlbumId, tidalPlaylistId, tidalAlbumRecords, tidalResources, tidalAlbumArtwork,
} from "./tidal.mjs?v=2";

const CLIENT = "accord-tidal-client-id-v1";
const element = (tag, text, attributes = {}) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};
const input = (parent, label, value = "", attributes = {}) => {
  const wrapper = element("label", label), field = element("input", "", attributes);
  field.value = value; wrapper.append(field); parent.append(wrapper); return field;
};
const button = (parent, label, action, className = "secondary") => {
  const node = element("button", label, { type: "button", class: className });
  node.addEventListener("click", action); parent.append(node); return node;
};
const selection = (parent, label, values) => {
  const wrapper = element("label", label), select = element("select");
  for (const [value, text] of values) select.append(element("option", text, { value }));
  wrapper.append(select); parent.append(wrapper); return select;
};

export function initializeTidalUI({ gate, addAlbum, changed, selectView = () => {} }) {
  const epoch = () => gate.epoch;
  const transport = createTidalTransport({
    storage: localStorage, writeStorage: localStorage, active: () => gate.service === "tidal",
    lock: (name, run) => navigator.locks?.request ? navigator.locks.request(name, run) : run(),
    fetch: async (...args) => {
      const current = epoch(); gate.assert("tidal", current);
      const response = await fetch(...args); gate.assert("tidal", current); return response;
    },
  });
  const auth = createTidalAuth({ session: sessionStorage, transport });
  const serviceBox = element("section", "", { class: "music-service-picker", "aria-label": "Servizio musicale" });
  serviceBox.append(element("p", "SERVIZIO MUSICALE", { class: "eyebrow" }));
  const provider = selection(serviceBox, "Servizio musicale", [["spotify", "Spotify"], ["tidal", "TIDAL"]]);
  provider.id = "musicService"; provider.value = gate.service;
  serviceBox.append(element("p", "La raccolta locale è unica; il servizio scelto cambia solo le funzioni online.", { class: "summary" }));
  const capabilities = element("p",
    "TIDAL: catalogo, preferiti, importazione e gestione playlist, album simili e mix ufficiali. Classifiche e cronologia Spotify non vengono usate come dati TIDAL. Il browser non può controllare l'app TIDAL Windows; Last.fm e i dati locali restano separati.",
    { class: "summary", id: "tidalCapabilities" });
  serviceBox.append(capabilities);
  const configuration = element("fieldset", "", { class: "preference-group", id: "tidalConfiguration" });
  configuration.append(element("legend", "TIDAL · accesso con PKCE"));
  const client = input(configuration, "Client ID dell’app TIDAL (non Client Secret)",
    localStorage.getItem(CLIENT) || "", { autocomplete: "off", maxlength: "200" });
  client.id = "tidalClientIdInput";
  const redirect = new URL(location.href); redirect.search = ""; redirect.hash = "";
  const redirectField = input(configuration, "Redirect URI TIDAL (esatto, non modificabile)", redirect.href,
    { type: "url", readonly: "" });
  redirectField.id = "tidalRedirectUriInput";
  configuration.append(element("p", "Registra esattamente questo Redirect URI nel portale TIDAL.", { class: "notice" }));
  const portal = element("a", "Crea e configura un’app su developer.tidal.com", {
    href: "https://developer.tidal.com/", target: "_blank", rel: "noopener noreferrer",
  });
  configuration.append(portal);
  configuration.append(element("p", `Abilita Authorization Code + PKCE e gli scope ${TIDAL_SCOPES}. Nessun backend o secret. I token restano nella sessione di questo browser; il Client ID resta sul dispositivo.`, { class: "notice" }));
  configuration.append(element("p", "Se il portale mostra Allowed scopes: None, l’app non dispone dei permessi richiesti da Accord. Abilitali nelle impostazioni dell’app; se non sono modificabili, contatta il supporto TIDAL Developer. L’errore 1002 prima del login va verificato nel portale: salvare il Client ID qui non abilita i permessi. Non inserire Client Secret o password e non ripetere automaticamente il collegamento.", { class: "notice", id: "tidalAuthorizationHelp" }));
  const authStatus = element("p", "", { id: "tidalAuthStatus", role: "status", class: "summary" });
  configuration.append(authStatus);
  const saveClient = button(configuration, "Salva Client ID", () => {
    if (client.value.trim() !== localStorage.getItem(CLIENT)) auth.disconnect();
    localStorage.setItem(CLIENT, client.value.trim());
    authStatus.textContent = "Client ID salvato sul dispositivo. Nessun token o secret salvato nel repository.";
  });
  saveClient.id = "tidalSaveClientId";
  const connect = button(configuration, "Collega / autorizza TIDAL", () => run(async () => {
    localStorage.setItem(CLIENT, client.value.trim());
    location.assign(await auth.authorize(client.value.trim(), location.href));
  }, authStatus), "primary");
  connect.id = "tidalConnectButton";
  const disconnect = button(configuration, "Scollega TIDAL", () => {
    auth.disconnect(); clearPreview(); results.replaceChildren(); status.textContent = "Sessione TIDAL rimossa.";
  });
  disconnect.id = "tidalDisconnectButton";
  const settings = document.querySelector("#settingsDialog .dialog-scroll");
  settings.append(configuration);
  document.querySelector(".view-tabs").before(serviceBox);

  const sections = ["collectionPanel", "suggestionsPanel", "playlistBuilderPanel"].map((id) => {
    const node = element("section", "", { class: "tidal-panel", "data-tidal-panel": id });
    if (id === "collectionPanel") document.getElementById("tidalCollectionMount").append(node);
    else document.getElementById(id).prepend(node);
    return node;
  });
  const [library, suggestions, playlists] = sections;
  const collectionDetails = element("details", "", { class: "tidal-collection-details" });
  const collectionSummary = element("summary");
  collectionSummary.append(element("span", "CATALOGO TIDAL", { class: "eyebrow" }),
    element("strong", "Cerca e importa album TIDAL"));
  collectionDetails.append(collectionSummary);
  const collectionControls = element("div", "", { class: "tidal-controls tidal-collection-controls" });
  const country = input(collectionControls, "Paese del catalogo (ISO, es. IT)", "IT", { maxlength: "2", pattern: "[A-Za-z]{2}" });
  const query = input(collectionControls, "Titolo, artista o link album TIDAL", "", { maxlength: "300" });
  query.id = "tidalAlbumQuery";
  const kind = selection(collectionControls, "Ricerca pubblica", [
    ["albums", "Album"], ["artists", "Artisti"], ["tracks", "Brani"], ["playlists", "Playlist"],
  ]);
  button(collectionControls, "Cerca · anteprima", () => read("search"), "primary");
  button(collectionControls, "Leggi album dal link / ID", () => read("album"));
  collectionDetails.append(collectionControls,
    element("p", "L’importazione aggiunge soltanto gli album selezionati alla raccolta locale. I preferiti TIDAL restano separati da stato e voto Accord.", { class: "summary" }));
  const favoriteDetails = element("details", "", { class: "tidal-secondary-details" });
  favoriteDetails.append(element("summary", "Mostra altre azioni"));
  button(favoriteDetails, "Leggi i miei album preferiti · anteprima importazione", () => read("collection"));
  library.append(collectionDetails, favoriteDetails);
  const importDetails = element("details", "", { class: "tidal-playlist-import" });
  importDetails.append(element("summary", "Importa album da una playlist TIDAL"));
  const importControls = element("div", "", { class: "tidal-controls" });
  const importPlaylist = input(importControls, "Playlist TIDAL da importare · ID o link", "", { maxlength: "300" });
  importPlaylist.id = "tidalImportPlaylist";
  importDetails.append(importControls);
  button(importDetails, "Elenca playlist TIDAL da importare", () => read("importPlaylists"));
  button(importDetails, "Anteprima album della playlist TIDAL", () => read("importPlaylist"), "primary");
  importPlaylist.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); void read("importPlaylist"); }
  });
  importDetails.append(element("p",
    "Scegli una playlist salvata oppure incolla il link. Leggi l’anteprima e seleziona gli album da aggiungere: nessuna scrittura remota o sincronizzazione automatica.",
    { class: "summary" }));
  library.append(importDetails);

  const suggestionsHeading = element("div", "", { class: "tidal-panel-heading" });
  suggestionsHeading.append(element("p", "SCOPERTA MUSICALE", { class: "eyebrow" }),
    element("h2", "Album simili e mix TIDAL"));
  suggestions.append(suggestionsHeading);
  const suggestionInfo = element("details", "", { class: "tidal-info-details" });
  suggestionInfo.append(element("summary", "Come vengono creati i suggerimenti"));
  suggestionInfo.append(element("p", "Album/artisti simili e mix ufficiali TIDAL, non statistiche di ascolto. Daily, Discovery e New Release dipendono dall’account e dalla disponibilità del servizio. Nessun widget remoto, brano attuale o cronologia ascolti: l’API pubblica non espone PlaybackStates o RecommendationBlocks."));
  suggestions.append(suggestionInfo);
  const suggestionControls = element("div", "", { class: "tidal-controls" });
  const seed = input(suggestionControls, "ID / link album, oppure ID artista per artisti simili", "", { maxlength: "300" });
  const source = selection(suggestionControls, "Fonte dei suggerimenti", [
    ["similarAlbums", "Album simili a un album"], ["similarArtists", "Artisti simili a un artista"],
    ["userDailyMixes", "Daily Mix TIDAL"], ["userDiscoveryMixes", "Discovery Mix TIDAL"],
    ["userNewReleaseMixes", "New Release Mix TIDAL"],
  ]);
  button(suggestionControls, "Leggi suggerimenti ufficiali · anteprima", () => read("suggestions"), "primary");
  suggestions.append(suggestionControls);

  const playlistsHeading = element("div", "", { class: "tidal-panel-heading" });
  playlistsHeading.append(element("p", "GESTIONE PLAYLIST", { class: "eyebrow" }),
    element("h2", "Playlist TIDAL"));
  playlists.append(playlistsHeading);
  playlists.append(element("p", "Ogni modifica richiede anteprima e conferma. Le playlist create sono UNLISTED (non private): chi conosce il link può accedere.", { class: "notice" }));
  const playlistControls = element("div", "", { class: "tidal-controls tidal-playlist-controls" });
  const playlist = input(playlistControls, "ID / link playlist TIDAL", "", { maxlength: "300" });
  const playlistName = input(playlistControls, "Nome playlist", "Nuove scoperte", { maxlength: "250" });
  const description = input(playlistControls, "Descrizione playlist", "", { maxlength: "500" });
  const position = input(playlistControls, "Sposta prima dell’itemId (vuoto = in fondo)", "", { maxlength: "36" });
  const playlistActions = element("div", "", { class: "tidal-actions" });
  button(playlistActions, "Leggi playlist · anteprima importazione album / brani", () => read("playlist"), "primary");
  button(playlistActions, "Elenca le mie playlist", () => read("playlists"));
  const playlistManagement = element("details", "", { class: "tidal-secondary-details" });
  playlistManagement.append(element("summary", "Mostra gestione playlist esistenti"));
  button(playlistManagement, "Prepara creazione UNLISTED", () => prepare("create"));
  button(playlistManagement, "Prepara modifica nome / descrizione", () => prepare("edit"));
  button(playlistManagement, "Prepara eliminazione playlist", () => prepare("delete"));
  playlistActions.append(playlistManagement);
  const playlistForm = element("details", "", { class: "tidal-playlist-form" });
  playlistForm.open = true;
  playlistForm.append(element("summary", "Dati e letture playlist TIDAL"), playlistControls, playlistActions);
  playlists.append(playlistForm);

  const output = element("section", "", { class: "tidal-output", hidden: "" });
  const status = element("p", "", { role: "status", "aria-live": "polite", id: "tidalStatus" });
  const results = element("div", "", { class: "tidal-results" });
  const actions = element("div", "", { class: "tidal-actions" });
  const selectionCount = element("p", "Nessun elemento selezionato", { id: "tidalSelectionCount", class: "summary" });
  actions.append(selectionCount);
  let rows = [], plan = null, busy = false, lastPlaylist = null;
  const importButton = button(actions, "Importa album selezionati nella raccolta locale", () => run(async () => {
    const selected = chosen().filter((row) => row.album);
    if (!selected.length) throw new Error("Seleziona almeno un album con metadati completi.");
    if (!confirm(`Importare ${selected.length} album nella raccolta locale? Nessuna scrittura TIDAL o sincronizzazione automatica.`)) return;
    let added = 0;
    for (const row of selected) if (addAlbum(row.album, row.coverUrl)) added += 1;
    status.textContent = `${added} album aggiunti localmente; ${selected.length - added} già presenti.`;
  }), "primary");
  const clearSelection = button(actions, "Annulla selezione", () => {
    for (const row of rows) row.check.checked = false;
    clearPreview(); refreshSelectionControls();
  });
  const resultManagement = element("details", "", { class: "tidal-secondary-details" });
  resultManagement.append(element("summary", "Mostra altre azioni"));
  button(resultManagement, "Prepara aggiunta album ai preferiti TIDAL", () => prepare("favorite"));
  button(resultManagement, "Prepara rimozione album dai preferiti TIDAL", () => prepare("unfavorite"));
  button(resultManagement, "Prepara aggiunta brani alla playlist", () => prepare("add"));
  button(resultManagement, "Prepara rimozione occorrenze dalla playlist letta", () => prepare("remove"));
  button(resultManagement, "Prepara spostamento occorrenze nella playlist letta", () => prepare("move"));
  actions.append(resultManagement);
  refreshSelectionControls();
  const mutation = element("pre", "", { class: "tidal-mutation" });
  const commit = button(output, "Conferma e invia UNA volta a TIDAL", () => run(async () => {
    if (!plan) throw new Error("Prepara una nuova anteprima.");
    const operation = plan;
    gate.assert("tidal", operation.epoch);
    if (!confirm(`Confermi la scrittura TIDAL?\n${operation.summary}\nNessun retry automatico; verifica lo stato remoto se l’esito è incerto.`)) return;
    clearPreview();
    const token = await auth.access(client.value.trim());
    gate.assert("tidal", operation.epoch);
    const response = await transport.request(operation.path, token, operation.options);
    gate.assert("tidal", operation.epoch);
    results.replaceChildren(); rows = [];
    if (operation.path === "playlists" && operation.options.method === "POST" && response.data?.id) {
      playlist.value = tidalPlaylistId(response.data.id);
      status.textContent = `Playlist UNLISTED creata: https://tidal.com/browse/playlist/${playlist.value}. Rileggi la playlist prima di altre modifiche.`;
    } else status.textContent = "Scrittura inviata e confermata da TIDAL. Rileggi lo stato remoto prima di altre modifiche.";
  }), "primary");
  output.prepend(status, results, actions, mutation);
  commit.disabled = true; commit.hidden = true;
  function clearPreview() { plan = null; commit.disabled = true; commit.hidden = true; mutation.textContent = ""; }
  function chosen() { return rows.filter((row) => row.check.checked); }
  function refreshSelectionControls() {
    if (!importButton || !clearSelection) return;
    const selected = chosen();
    selectionCount.textContent = selected.length === 1 ? "1 elemento selezionato"
      : selected.length ? `${selected.length} elementi selezionati` : "Nessun elemento selezionato";
    importButton.disabled = !selected.some((row) => row.album);
    clearSelection.disabled = !selected.length;
  }
  function renderAlbumResult(row) {
    const item = element("article", "", { class: "suggestion-album tidal-album-result" });
    const choice = element("label", "", { class: "tidal-album-choice" });
    row.check = element("input", "", { type: "checkbox", "aria-label": `Seleziona ${row.album.name}` });
    row.check.addEventListener("change", () => { clearPreview(); refreshSelectionControls(); });
    const cover = element("span", "", { class: "suggestion-cover-frame" });
    if (row.coverUrl) {
      const image = element("img", "", { src: row.coverUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer", class: "suggestion-cover" });
      image.addEventListener("load", () => cover.classList.add("has-cover"));
      cover.append(image);
    }
    cover.append(element("span", "TIDAL", { class: "suggestion-cover-placeholder" }));
    const info = element("span", "", { class: "tidal-album-copy" });
    info.append(element("strong", row.album.name),
      element("span", `${row.album.artist} · ${row.album.year || "Anno sconosciuto"}`, { class: "suggestion-detail" }));
    choice.append(row.check, cover, info);
    item.append(choice);
    if (row.resource?.id) {
      item.append(element("a", "Apri in TIDAL ↗", {
        href: `https://tidal.com/browse/album/${encodeURIComponent(row.resource.id)}`,
        target: "_blank", rel: "noopener noreferrer", class: "tidal-result-link",
      }));
    }
    return item;
  }
  function moveOutput() {
    const active = document.querySelector(".view-tabs [aria-selected='true']");
    const target = sections.find((section) => section.dataset.tidalPanel === active?.getAttribute("aria-controls")) || library;
    target.append(output); output.hidden = gate.service !== "tidal";
  }
  document.querySelector(".view-tabs").addEventListener("click", () => queueMicrotask(moveOutput));
  document.querySelector(".view-tabs").addEventListener("keydown", () => queueMicrotask(moveOutput));
  function updateService() {
    gate.select(provider.value);
    const tidal = gate.service === "tidal";
    capabilities.hidden = !tidal;
    document.getElementById("playlistImportButton").textContent = `Importa playlist ${tidal ? "TIDAL" : "Spotify"}…`;
    for (const section of sections) section.hidden = !tidal;
    for (const id of ["suggestionsPanel", "playlistBuilderPanel"]) {
      for (const child of document.getElementById(id).children) if (!child.dataset.tidalPanel) child.hidden = tidal;
    }
    for (const id of ["manualAlbumDialog", "playlistDialog", "playlistMatchDialog"]) {
      const dialog = document.getElementById(id);
      if (tidal && dialog?.open) dialog.close();
    }
    clearPreview(); moveOutput(); changed();
  }
  provider.addEventListener("change", updateService);
  window.addEventListener("storage", (event) => {
    if (event.key === "accord-music-service-v1") {
      provider.value = localStorage.getItem(event.key) === "tidal" ? "tidal" : "spotify";
      updateService();
    }
  });
  async function run(action, errorOutput = status) {
    if (busy) return;
    busy = true;
    for (const section of sections) section.setAttribute("aria-busy", "true");
    try { gate.assert("tidal"); return await action(); }
    catch (error) { errorOutput.textContent = error.message; }
    finally { busy = false; for (const section of sections) section.removeAttribute("aria-busy"); }
  }
  function catalogPath(path, include) {
    const params = new URLSearchParams({ countryCode: country.value.toUpperCase(), include });
    return `${path}?${params}`;
  }
  async function read(action) {
    return run(async () => {
      const current = epoch(); clearPreview(); results.replaceChildren(); rows = []; lastPlaylist = null;
      refreshSelectionControls();
      if (["search", "album", "collection"].includes(action)) collectionDetails.open = true;
      if (!/^[A-Za-z]{2}$/.test(country.value)) throw new Error("Immetti un codice paese ISO di due lettere.");
      const requestedPlaylist = ["playlist", "importPlaylist"].includes(action)
        ? tidalPlaylistId(action === "importPlaylist" ? importPlaylist.value : playlist.value) : null;
      const token = await auth.access(client.value.trim()); gate.assert("tidal", current);
      let path, label = "", playlistId = null;
      if (action === "search") {
        const text = query.value.trim();
        if (!text || text.length > 100) throw new Error("Ricerca TIDAL: usa da 1 a 100 caratteri.");
        path = catalogPath(`searchResults/${encodeURIComponent(text)}/relationships/${kind.value}`,
          kind.value === "albums" ? "albums.artists,albums.coverArt" : kind.value === "tracks" ? "tracks.albums.artists,tracks.albums.coverArt" : kind.value);
        label = `Ricerca pubblica TIDAL · ${kind.selectedOptions[0].textContent}`;
      } else if (action === "album") {
        path = catalogPath(`albums/${tidalAlbumId(query.value)}`, "artists,coverArt");
        label = "Album TIDAL dal link";
      } else if (action === "collection") {
        path = "userCollectionAlbums/me/relationships/items?include=items.artists,items.coverArt";
        label = "Album preferiti TIDAL";
      } else if (["playlist", "importPlaylist"].includes(action)) {
        playlistId = requestedPlaylist;
        path = catalogPath(`playlists/${playlistId}/relationships/items`, "items.albums.artists,items.albums.coverArt");
        label = `Playlist TIDAL ${playlistId}`;
      } else if (["playlists", "importPlaylists"].includes(action)) {
        path = "userCollectionPlaylists/me/relationships/items?include=items";
        label = "Playlist della raccolta TIDAL";
      } else if (source.value === "similarAlbums") {
        path = catalogPath(`albums/${tidalAlbumId(seed.value)}/relationships/similarAlbums`, "similarAlbums.artists,similarAlbums.coverArt");
        label = "Somiglianza album ufficiale TIDAL (non ascolti)";
      } else if (source.value === "similarArtists") {
        if (!/^[1-9][0-9]*$/.test(seed.value.trim())) throw new Error("Immetti l’ID numerico dell’artista.");
        path = catalogPath(`artists/${seed.value.trim()}/relationships/similarArtists`, "similarArtists");
        label = "Artisti simili ufficiali TIDAL (non ascolti)";
      } else {
        path = `${source.value}/me?include=items.items.albums.artists,items.items.albums.coverArt`;
        label = source.selectedOptions[0].textContent;
      }
      status.textContent = `Lettura ${label}…`;
      const page = await transport.pages(path, token);
      gate.assert("tidal", current);
      let documents = page.documents, mixesComplete = true;
      if (action === "suggestions" && source.value.startsWith("user")) {
        const mixPlaylists = tidalResources(documents).filter((resource) => resource.type === "playlists");
        mixesComplete = mixPlaylists.length <= 3;
        for (const mix of mixPlaylists.slice(0, 3)) {
          gate.assert("tidal", current);
          const items = await transport.pages(catalogPath(`playlists/${tidalPlaylistId(mix.id)}/relationships/items`,
            "items.albums.artists,items.albums.coverArt"), token, { maxPages: 1, maxItems: 100 });
          mixesComplete &&= items.complete;
          documents = [...documents, ...items.documents];
        }
      }
      const resources = tidalResources(documents);
      // Some relationship responses omit nested album metadata; resolve a bounded subset, never via Spotify.
      const missing = resources.filter((resource) => resource.type === "albums"
        && (!resource.attributes?.title || !resource.relationships?.artists?.data?.length));
      for (const resource of missing.slice(0, 10)) {
        gate.assert("tidal", current);
        documents = [...documents, await transport.request(catalogPath(`albums/${tidalAlbumId(resource.id)}`, "artists,coverArt"), token)];
      }
      gate.assert("tidal", current);
      const albums = tidalAlbumRecords(documents), all = tidalResources(documents), artwork = tidalAlbumArtwork(documents);
      const albumMap = new Map(albums.map((album) => [album.id.slice(6), album]));
      const albumRows = albums.map((album) => ({ album, coverUrl: artwork.get(album.id),
        resource: all.find((item) => item.type === "albums" && `tidal:${item.id}` === album.id), label: `${album.name} · ${album.artist}` }));
      let otherRows = all.filter((item) => ["tracks", "videos", "playlists", "artists"].includes(item.type)
        && (item.attributes?.title || item.attributes?.name)).map((resource) => ({
        resource, label: `${resource.type} · ${resource.attributes.title || resource.attributes.name} · ${resource.id}`,
      }));
      const directItems = documents.flatMap((document) => Array.isArray(document.data) ? document.data : []);
      if (playlistId) {
        const occurrences = directItems.filter((item) => ["tracks", "videos"].includes(item.type) && item.meta?.itemId);
        otherRows = [
          ...otherRows.filter((row) => !["tracks", "videos"].includes(row.resource.type)),
          ...occurrences.map((ref) => {
            const resource = { ...all.find((item) => item.type === ref.type && item.id === ref.id), ...ref,
              attributes: all.find((item) => item.type === ref.type && item.id === ref.id)?.attributes };
            return { resource, label: `${resource.type} · ${resource.attributes?.title || resource.id} · itemId ${ref.meta.itemId}` };
          }),
        ];
      }
      if (playlistId) lastPlaylist = playlistId;
      if (action === "importPlaylist") otherRows = [];
      for (const row of [...albumRows, ...otherRows].slice(0, 250)) {
        const resource = row.resource;
        if (row.album) {
          results.append(renderAlbumResult(row));
          rows.push(row);
          continue;
        }
        const item = element("div", "", { class: "tidal-result" }), choice = element("label", row.label,
          { class: "tidal-result-choice" });
        row.check = element("input", "", { type: "checkbox", "aria-label": `Seleziona ${row.label}` });
        row.check.addEventListener("change", () => { clearPreview(); refreshSelectionControls(); });
        choice.prepend(row.check);
        item.append(choice);
        if (["albums", "artists", "tracks", "playlists", "videos"].includes(resource.type)) {
          const singular = { albums: "album", artists: "artist", tracks: "track", playlists: "playlist", videos: "video" }[resource.type];
          item.append(element("a", "Apri in TIDAL ↗", { href: `https://tidal.com/browse/${singular}/${encodeURIComponent(resource.id)}`, target: "_blank", rel: "noopener noreferrer", class: "tidal-result-link" }));
        }
        if (resource.type === "artists") button(item, "Album dell’artista", () => readArtist(resource.id));
        if (resource.type === "playlists") button(item, "Usa questa playlist", () => {
          if (action === "importPlaylists") { importPlaylist.value = resource.id; return read("importPlaylist"); }
          playlist.value = resource.id; return read("playlist");
        });
        rows.push(row); results.append(item);
      }
      if (!rows.length) results.append(element("p", "Nessun risultato TIDAL disponibile per questa ricerca.", { class: "summary" }));
      const omitted = !mixesComplete || missing.length > 10 || all.filter((item) => item.type === "albums").length > albumMap.size;
      status.textContent = `${label}: ${rows.length} risultati mostrati; ${albums.length} album importabili. `
        + (page.complete && !omitted && albumRows.length + otherRows.length <= 250
          ? "Pagine disponibili lette entro il limite." : "Risultato PARZIALE: limite 5 pagine / 250 risorse, 3 playlist mix (1 pagina ciascuna), 10 dettagli album; metadati mancanti non inventati.")
        + " Seleziona le righe per importare o preparare una modifica.";
      refreshSelectionControls();
    });
  }
  async function readArtist(id) {
    seed.value = id;
    return run(async () => {
      const current = epoch(), token = await auth.access(client.value.trim());
      const page = await transport.pages(catalogPath(`artists/${id}/relationships/albums`, "albums.artists,albums.coverArt"), token);
      gate.assert("tidal", current);
      clearPreview(); results.replaceChildren(); rows = []; lastPlaylist = null;
      const artwork = tidalAlbumArtwork(page.documents);
      for (const album of tidalAlbumRecords(page.documents)) {
        const row = { album, coverUrl: artwork.get(album.id), resource: { type: "albums", id: album.id.slice(6) } };
        results.append(renderAlbumResult(row)); rows.push(row);
      }
      if (!rows.length) results.append(element("p", "Nessun album TIDAL disponibile.", { class: "summary" }));
      status.textContent = `Album dell’artista TIDAL: ${rows.length}. ${page.complete ? "" : "Risultato PARZIALE (limite pagine)."} Seleziona prima di importare.`;
      refreshSelectionControls();
    });
  }
  function prepare(action) {
    if (busy) return;
    try {
      gate.assert("tidal"); clearPreview();
      const selected = chosen();
      let path, method, body, summary;
      if (["favorite", "unfavorite"].includes(action)) {
        const data = selected.filter((row) => row.album).map((row) => ({ type: "albums", id: row.album.id.slice(6) }));
        if (!data.length || data.length > 50) throw new Error("Seleziona da 1 a 50 album.");
        path = "userCollectionAlbums/me/relationships/items";
        method = action === "favorite" ? "POST" : "DELETE"; body = { data };
        summary = `${action === "favorite" ? "Aggiungi" : "Rimuovi"} ${data.length} album dai preferiti TIDAL.`;
      } else {
        const id = action === "create" ? null : tidalPlaylistId(playlist.value);
        path = id ? `playlists/${id}` : "playlists";
        const attributes = { name: playlistName.value.trim(), description: description.value };
        if (["create", "edit"].includes(action) && !attributes.name) throw new Error("Immetti un nome playlist.");
        if (action === "create") {
          method = "POST"; body = { data: { type: "playlists", attributes: { ...attributes, accessType: "UNLISTED" } } };
          summary = `Crea playlist non in elenco (UNLISTED) «${attributes.name}», accessibile a chi ha il link; non privata.`;
        } else if (action === "edit") {
          method = "PATCH"; body = { data: { type: "playlists", id, attributes } };
          summary = `Modifica nome e descrizione della playlist ${id}.`;
        } else if (action === "delete") {
          method = "DELETE"; summary = `Elimina definitivamente la playlist ${id}.`;
        } else {
          let data = selected.filter((row) => ["tracks", "videos"].includes(row.resource.type)).map((row) => {
            const resource = row.resource;
            if (action === "remove" || action === "move") {
              if (lastPlaylist !== id || !resource.meta?.itemId) throw new Error("Rileggi questa playlist: servono gli itemId delle occorrenze selezionate.");
              return { type: resource.type, id: resource.id, meta: { itemId: resource.meta.itemId } };
            }
            return { type: resource.type, id: resource.id };
          });
          if (action === "add") data = [...new Map(data.map((item) => [`${item.type}:${item.id}`, item])).values()];
          const limit = action === "move" ? 20 : 50;
          if (!data.length || data.length > limit) throw new Error(`Seleziona da 1 a ${limit} brani / video dell’anteprima.`);
          path += "/relationships/items"; method = action === "add" ? "POST" : action === "move" ? "PATCH" : "DELETE";
          body = { data, ...(action === "add" ? { meta: { onDuplicates: "SKIP" } }
            : action === "move" ? { meta: { mode: "INCREMENTAL", ...(position.value.trim() ? { positionBefore: position.value.trim() } : {}) } } : {}) };
          summary = `${action === "add" ? "Aggiungi (salta duplicati)" : action === "move" ? "Sposta occorrenze" : "Rimuovi occorrenze"}: ${data.length} elementi, playlist ${id}.`;
        }
      }
      plan = { path, options: { method, ...(body ? { body } : {}) }, summary, epoch: epoch() };
      mutation.textContent = `${summary}\n${method} ${path}\n${body ? JSON.stringify(body, null, 2) : ""}`;
      commit.disabled = false; commit.hidden = false;
      status.textContent = "Anteprima pronta. Nessuna scrittura ancora eseguita.";
    } catch (error) { status.textContent = error.message; }
  }
  for (const field of [client, playlist, playlistName, description, position]) field.addEventListener("input", clearPreview);
  updateService();
  if (new URL(location.href).searchParams.get("state")?.startsWith("tidal.")) {
    document.getElementById("settingsDialog").showModal();
    const callbackUrl = location.href;
    run(async () => {
      if (await auth.finish(callbackUrl)) authStatus.textContent = "TIDAL collegato. Scegli una lettura: nessuna scrittura ripresa automaticamente.";
    }, authStatus).finally(() => history.replaceState(null, "", `${location.pathname}${location.hash}`));
  }
  function openImport() {
    gate.assert("tidal"); selectView("collection");
    importDetails.open = true; moveOutput(); importPlaylist.focus();
  }
  function openCatalog(value = "") {
    gate.assert("tidal"); selectView("collection");
    collectionDetails.open = true; query.value = value; moveOutput(); query.focus();
  }
  async function loadArtwork(albums) {
    return run(async () => {
      selectView("collection"); moveOutput();
      const ids = [...new Set(albums.filter((album) => /^tidal:[1-9][0-9]*$/.test(album.id)).map((album) => album.id))];
      if (!ids.length) {
        status.textContent = "Nessun album TIDAL da verificare. Nessuna richiesta inviata.";
        return new Map();
      }
      const current = epoch(), token = await auth.access(client.value.trim());
      const documents = [];
      for (const id of ids.slice(0, 10)) {
        gate.assert("tidal", current);
        documents.push(await transport.request(catalogPath(`albums/${tidalAlbumId(id)}`, "artists,coverArt"), token));
      }
      gate.assert("tidal", current);
      const artwork = tidalAlbumArtwork(documents);
      status.textContent = `Copertine TIDAL disponibili: ${artwork.size}. `
        + (ids.length > 10 ? "Risultato PARZIALE: massimo 10 album per richiesta manuale. " : "")
        + "Solo album TIDAL; nessuna ricerca Spotify o sostituzione delle edizioni.";
      return artwork;
    });
  }
  return { auth, transport, openImport, openCatalog, loadArtwork };
}
