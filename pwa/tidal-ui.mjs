import {
  TIDAL_SCOPES, createTidalTransport, createTidalAuth, tidalAlbumId, tidalPlaylistId, tidalAlbumRecords, tidalResources, tidalAlbumArtwork,
} from "./tidal.mjs?v=10";
import { albumSearchControls, albumSearchMatch, artistIsExcluded, excludedArtistNames } from "./music-suggestion-filters.mjs?v=2";
import { configureMusicAppLink } from "./music-app-links.mjs?v=2";
import { bindPauseNotice } from "./music-continuity.mjs?v=7";
import { showEditionComparison } from "./edition-comparison.mjs?v=1";

const CLIENT = "accord-tidal-client-id-v1";
const EXCLUDED_ARTISTS = "accord-tidal-suggestion-excluded-artists-v1";
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
const tidalAlbumArtists = (resources) => {
  const artists = new Map(resources.filter((item) => item.type === "artists" && item.attributes?.name)
    .map((item) => [item.id, item.attributes.name]));
  return new Map(resources.filter((item) => item.type === "albums").map((album) => {
    const data = album.relationships?.artists?.data;
    const refs = Array.isArray(data) ? data : data ? [data] : [];
    return [album.id, refs.map((ref) => artists.get(ref.id)).filter(Boolean)];
  }));
};

export function initializeTidalUI({ gate, addAlbum, changed, selectView = () => {}, playlistPrepared = null,
  revealCollection = () => {}, requestOptions = {} }) {
  const epoch = () => gate.epoch;
  const transport = createTidalTransport({
    ...requestOptions,
    storage: localStorage, writeStorage: localStorage, active: () => gate.service === "tidal",
    revision: epoch,
    lock: (name, run) => navigator.locks?.request ? navigator.locks.request(name, run) : run(),
    fetch: async (...args) => {
      const current = epoch(); gate.assert("tidal", current);
      const response = await fetch(...args); gate.assert("tidal", current); return response;
    },
  });
  const auth = createTidalAuth({ session: sessionStorage, transport });
  const serviceBox = element("section", "", { class: "music-service-picker", "aria-label": "Servizio musicale" });
  serviceBox.append(element("p", "SERVIZIO MUSICALE", { class: "eyebrow" }));
  const provider = selection(serviceBox, "Servizio musicale", [["spotify", "Spotify"], ["tidal", "TIDAL"], ["qobuz", "Qobuz"]]);
  provider.id = "musicService"; provider.value = gate.service;
  serviceBox.append(element("p", "Un solo servizio per ascolto, associazioni e filtro Associazione mancante. La raccolta locale resta unica.", { class: "summary" }));
  const spotifyCapabilities = element("p",
    "Spotify · Cerca musica, scopri album, crea playlist e apri Spotify.",
    { class: "summary", id: "spotifyCapabilities" });
  const capabilities = element("p",
    "TIDAL · Cerca musica, scopri album, gestisci playlist e apri TIDAL.",
    { class: "summary", id: "tidalCapabilities" });
  const qobuzCapabilities = element("p",
    "Qobuz · Cerca musica, scopri album, gestisci playlist e riproduci musica.",
    { class: "summary", id: "qobuzCapabilities" });
  serviceBox.append(spotifyCapabilities, capabilities, qobuzCapabilities);
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
  let accountRevision = 0;
  const saveClient = button(configuration, "Salva Client ID", () => {
    if (client.value.trim() !== localStorage.getItem(CLIENT)) {
      accountRevision += 1; auth.disconnect(); clearDestination();
      searchAlbumRows = null;
    }
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
    accountRevision += 1; auth.disconnect(); clearDestination(); clearPreview();
    results.replaceChildren(); rows = []; lastPlaylist = null; refreshSelectionControls();
    searchAlbumRows = null;
    status.textContent = "Sessione TIDAL rimossa.";
  });
  disconnect.id = "tidalDisconnectButton";
  const settings = document.querySelector("#settingsDialog .dialog-scroll");
  settings.append(configuration);
  document.querySelector(".view-tabs").before(serviceBox);

  const sections = ["collectionPanel", "suggestionsPanel", "playlistBuilderPanel"].map((id) => {
    const node = element(id === "playlistBuilderPanel" ? "details" : "section", "", { class: "tidal-panel", "data-tidal-panel": id });
    if (id === "playlistBuilderPanel") node.append(element("summary", "Gestisci playlist TIDAL esistenti"));
    if (id === "collectionPanel") document.getElementById("tidalCollectionMount").append(node);
    else if (id === "playlistBuilderPanel") document.getElementById(id).append(node);
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
  const catalogOptions = element("details", "", { class: "tidal-secondary-details" });
  catalogOptions.append(element("summary", "Opzioni catalogo"));
  const country = input(catalogOptions, "Paese del catalogo (ISO, es. IT)", "IT", { maxlength: "2", pattern: "[A-Za-z]{2}" });
  const query = input(collectionControls, "Titolo, artista o link album TIDAL", "", { maxlength: "300" });
  query.id = "tidalAlbumQuery";
  let searchAlbumRows = null;
  const searchOptions = albumSearchControls(collectionControls, { prefix: "tidalAlbumSearch",
    changed: () => { if (searchAlbumRows) showAlbumSearch(); } });
  button(collectionControls, "Cerca · anteprima", () => read("search"), "primary");
  button(collectionControls, "Leggi album dal link / ID", () => read("album"));
  collectionDetails.append(collectionControls, catalogOptions,
    element("p", "L’importazione aggiunge soltanto gli album selezionati alla raccolta locale. I preferiti TIDAL restano separati da stato e voto Accord.", { class: "summary" }));
  const favoriteDetails = element("details", "", { class: "tidal-secondary-details" });
  favoriteDetails.append(element("summary", "Mostra altre azioni"));
  button(favoriteDetails, "Leggi i miei album preferiti · anteprima importazione", () => read("collection"));
  library.append(collectionDetails, favoriteDetails);
  const importDetails = element("details", "", { class: "tidal-playlist-import" });
  importDetails.append(element("summary", "Importa album da una playlist TIDAL"));
  const importControls = element("div", "", { class: "tidal-controls" });
  const importAdvanced = element("details", "", { class: "tidal-secondary-details" });
  importAdvanced.append(element("summary", "Usa un link o ID playlist"));
  const importPlaylist = input(importAdvanced, "Playlist TIDAL da importare · ID o link", "", { maxlength: "300" });
  importPlaylist.id = "tidalImportPlaylist";
  importControls.append(importAdvanced);
  importDetails.append(importControls);
  const listImportPlaylists = button(importDetails, "Elenca playlist TIDAL da importare", () => read("importPlaylists"));
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
  const seedChoice = element("p", "Nessun album o artista selezionato.", { class: "summary" });
  suggestionControls.append(seedChoice);
  button(suggestionControls, "Cerca un album o artista TIDAL…", () => openCatalog());
  const seedAdvanced = element("details", "", { class: "tidal-secondary-details" });
  seedAdvanced.append(element("summary", "Usa un link o ID"));
  const seed = input(seedAdvanced, "ID / link album, oppure ID artista per artisti simili", "", { maxlength: "300" });
  seed.addEventListener("input", () => { seedChoice.textContent = "Album o artista specificato tramite collegamento o ID."; });
  suggestionControls.append(seedAdvanced);
  const source = selection(suggestionControls, "Fonte dei suggerimenti", [
    ["similarAlbums", "Album simili a un album"], ["similarArtists", "Artisti simili a un artista"],
    ["userDailyMixes", "Daily Mix TIDAL"], ["userDiscoveryMixes", "Discovery Mix TIDAL"],
    ["userNewReleaseMixes", "New Release Mix TIDAL"],
  ]);
  const suggestionFilters = element("details", "", { class: "tidal-secondary-details" });
  suggestionFilters.append(element("summary", "Filtri suggerimenti"));
  const excludedInput = input(suggestionFilters, "Artisti da escludere",
    localStorage.getItem(EXCLUDED_ARTISTS) || "", { placeholder: "Nomi esatti separati da ;" });
  suggestionFilters.append(element("p", "Il filtro riguarda gli album e gli artisti mostrati, non i singoli brani dei mix.",
    { class: "summary" }));
  button(suggestionFilters, "Salva filtri", () => void run(async () => {
    localStorage.setItem(EXCLUDED_ARTISTS, excludedInput.value);
    if (suggestionResultsActive) {
      clearPreview(); results.replaceChildren(); rows = []; lastPlaylist = null; refreshSelectionControls();
    }
    status.textContent = "Filtri salvati. Rileggi i suggerimenti per applicarli.";
  }));
  suggestionControls.append(suggestionFilters);
  button(suggestionControls, "Leggi suggerimenti ufficiali · anteprima", () => read("suggestions"), "primary");
  suggestions.append(suggestionControls);

  const playlistsHeading = element("div", "", { class: "tidal-panel-heading" });
  playlistsHeading.append(element("p", "GESTIONE PLAYLIST", { class: "eyebrow" }),
    element("h2", "Playlist TIDAL"));
  playlists.append(playlistsHeading);
  playlists.append(element("p", "Ogni modifica richiede anteprima e conferma. Le playlist create sono UNLISTED (non private): chi conosce il link può accedere.", { class: "notice" }));
  const playlistControls = element("div", "", { class: "tidal-controls tidal-playlist-controls" });
  const playlistChoice = element("p", "Nessuna playlist selezionata.", { class: "summary" });
  playlistControls.append(playlistChoice);
  const playlistDestination = selection(playlistControls, "Playlist di destinazione", [["", "Scegli una playlist"]]);
  button(playlistControls, "Carica playlist di destinazione", () => void loadPlaylistDestinations());
  const playlistAdvanced = element("details", "", { class: "tidal-secondary-details" });
  playlistAdvanced.append(element("summary", "Usa un link o ID playlist"));
  const playlist = input(playlistAdvanced, "ID / link playlist TIDAL", "", { maxlength: "300" });
  playlistControls.append(playlistAdvanced);
  playlistDestination.addEventListener("change", () => {
    playlist.value = playlistDestination.value ? tidalPlaylistId(playlistDestination.value) : "";
    playlistChoice.textContent = playlist.value
      ? `Playlist selezionata: ${playlistDestination.selectedOptions[0].textContent}` : "Nessuna playlist selezionata.";
    clearPreview();
  });
  function clearDestination() {
    playlistDestination.replaceChildren(element("option", "Scegli una playlist", { value: "" }));
    playlistDestination.value = ""; playlist.value = ""; playlistChoice.textContent = "Nessuna playlist selezionata.";
  }
  const playlistName = input(playlistControls, "Nome playlist", "Nuove scoperte", { maxlength: "250" });
  const description = input(playlistControls, "Descrizione playlist", "", { maxlength: "500" });
  const moveOptions = element("details", "", { class: "tidal-secondary-details" });
  moveOptions.append(element("summary", "Opzioni avanzate per il riordino"));
  const position = input(moveOptions, "Sposta prima dell’itemId (vuoto = in fondo)", "", { maxlength: "36" });
  playlistControls.append(moveOptions);
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
  let rows = [], plan = null, busy = false, lastPlaylist = null, suggestionResultsActive = false;
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
  const albumTracksButton = button(actions, "Prepara brani dagli album selezionati", () => void prepareAlbumTracks());
  const compareEditionsButton = button(actions, "Confronta edizioni selezionate (2–4)", () => {
    try { showEditionComparison(rows.filter((row) => row.compareCheck?.checked).map((row) => row.album), "tidal"); }
    catch (error) { status.textContent = error.message; }
  });
  compareEditionsButton.hidden = true;
  compareEditionsButton.disabled = true;
  const addTracksButton = button(actions, "Prepara aggiunta brani alla playlist", () => prepare("add"));
  const resultManagement = element("details", "", { class: "tidal-secondary-details" });
  resultManagement.append(element("summary", "Mostra altre azioni"));
  button(resultManagement, "Prepara aggiunta album ai preferiti TIDAL", () => prepare("favorite"));
  button(resultManagement, "Prepara rimozione album dai preferiti TIDAL", () => prepare("unfavorite"));
  button(resultManagement, "Prepara rimozione occorrenze dalla playlist letta", () => prepare("remove"));
  button(resultManagement, "Prepara spostamento occorrenze nella playlist letta", () => prepare("move"));
  actions.append(resultManagement);
  refreshSelectionControls();
  const mutationSummary = element("p", "", { class: "summary" });
  const mutation = element("pre", "", { class: "tidal-mutation" });
  const mutationDetails = element("details", "", { class: "tidal-secondary-details" });
  mutationDetails.append(element("summary", "Dettagli tecnici della modifica"), mutation);
  mutationDetails.hidden = true;
  const commit = button(output, "Conferma e invia UNA volta a TIDAL", () => run(async () => {
    if (localStorage.getItem("accord-catalog-playlist-uncertain-tidal-v1")) {
      throw new Error("Verifica prima l'esito della creazione precedente dalla scheda Crea playlist.");
    }
    if (!plan) throw new Error("Prepara una nuova anteprima.");
    const operation = plan;
    gate.assert("tidal", operation.epoch);
    if (!confirm(`Confermi la scrittura TIDAL?\n${operation.summary}${operation.target || ""}\nNessun retry automatico; verifica lo stato remoto se l’esito è incerto.`)) return;
    clearPreview();
    const token = await auth.access(client.value.trim());
    gate.assert("tidal", operation.epoch);
    const response = await transport.request(operation.path, token, operation.options);
    gate.assert("tidal", operation.epoch);
    results.replaceChildren(); rows = []; searchAlbumRows = null;
    if (operation.path === "playlists" && operation.options.method === "POST" && response.data?.id) {
      playlist.value = tidalPlaylistId(response.data.id);
      playlistDestination.value = "";
      playlistChoice.textContent = `Playlist selezionata: ${playlistName.value.trim()}`;
      status.textContent = "Playlist non in elenco creata. Rileggila prima di altre modifiche.";
    } else status.textContent = "Scrittura inviata e confermata da TIDAL. Rileggi lo stato remoto prima di altre modifiche.";
  }), "primary");
  output.prepend(status, results, actions, mutationSummary, mutationDetails);
  commit.disabled = true; commit.hidden = true;
  function clearPreview() {
    plan = null; commit.disabled = true; commit.hidden = true;
    mutationSummary.textContent = ""; mutation.textContent = ""; mutationDetails.hidden = true;
  }
  function chosen() { return rows.filter((row) => row.check.checked); }
  function refreshSelectionControls() {
    if (!importButton || !clearSelection) return;
    const selected = chosen();
    selectionCount.textContent = selected.length === 1 ? "1 elemento selezionato"
      : selected.length ? `${selected.length} elementi selezionati` : "Nessun elemento selezionato";
    importButton.disabled = !selected.some((row) => row.album);
    clearSelection.disabled = !selected.length;
    albumTracksButton.disabled = !selected.some((row) => row.album);
    addTracksButton.disabled = !selected.some((row) => ["tracks", "videos"].includes(row.resource?.type));
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
    if (editionSelection) {
      button(item, "Associa questa edizione", () => {
      if (!editionSelection) { status.textContent = "Apri Associa edizione dalla raccolta prima di scegliere."; return; }
        const callback = editionSelection; editionSelection = null; compareEditionsButton.hidden = true; callback(row.album);
      });
      const compare = element("label", "Confronta", { class: "check" });
      row.compareCheck = element("input", "", { type: "checkbox", "aria-label": `Confronta ${row.album.name}` });
      row.compareCheck.addEventListener("change", () => {
        compareEditionsButton.disabled = rows.filter((entry) => entry.compareCheck?.checked).length < 2;
      });
      compare.prepend(row.compareCheck); item.append(compare);
    }
    button(item, "Usa per suggerimenti", () => useSeed(row.album.id.slice(6), `${row.album.artist} · ${row.album.name}`, "similarAlbums"));
    if (row.resource?.id) {
      item.append(configureMusicAppLink(element("a", "Apri in TIDAL ↗", { class: "tidal-result-link" }),
        `https://tidal.com/browse/album/${encodeURIComponent(row.resource.id)}`));
    }
    return item;
  }
  async function loadPlaylistDestinations() {
    return run(async () => {
      const current = epoch(), account = accountRevision, token = await auth.access(client.value.trim());
      gate.assert("tidal", current);
      if (account !== accountRevision) throw new Error("Sessione TIDAL cambiata: ricarica le playlist.");
      const page = await transport.pages("userCollectionPlaylists/me/relationships/items?include=items", token);
      gate.assert("tidal", current);
      if (account !== accountRevision) throw new Error("Sessione TIDAL cambiata: ricarica le playlist.");
      const resources = new Map(tidalResources(page.documents).map((resource) => [`${resource.type}:${resource.id}`, resource]));
      const targets = new Map();
      let complete = page.complete;
      for (const document of page.documents) for (const item of Array.isArray(document.data) ? document.data : []) {
        if (item.type !== "playlists") { complete = false; continue; }
        const resource = resources.get(`playlists:${item.id}`);
        const name = resource?.attributes?.name || resource?.attributes?.title;
        if (typeof name !== "string" || !name.trim()) { complete = false; continue; }
        const id = tidalPlaylistId(item.id);
        if (!targets.has(id)) targets.set(id, name.trim());
      }
      const previous = playlistDestination.value;
      playlistDestination.replaceChildren(element("option", "Scegli una playlist", { value: "" }));
      for (const [id, name] of targets) playlistDestination.append(element("option", name, { value: id }));
      playlistDestination.value = targets.has(previous) ? previous : "";
      status.textContent = `${targets.size} playlist di destinazione disponibili. `
        + (complete ? "" : "Elenco parziale: limite di lettura o metadati mancanti. ")
        + "La selezione dei brani resta invariata.";
    });
  }
  async function prepareAlbumTracks() {
    return run(async () => {
      const selected = chosen().filter((row) => row.album);
      if (!selected.length || selected.length > 10) throw new Error("Seleziona da 1 a 10 album per preparare i brani.");
      if (playlistPrepared) {
        status.textContent = await playlistPrepared(selected);
        return;
      }
      if (!/^[A-Za-z]{2}$/.test(country.value)) throw new Error("Immetti un codice paese ISO di due lettere.");
      const current = epoch(), account = accountRevision;
      clearPreview();
      const token = await auth.access(client.value.trim());
      const documents = [];
      let complete = true;
      for (const row of selected) {
        gate.assert("tidal", current);
        if (account !== accountRevision) throw new Error("Sessione TIDAL cambiata: ripeti l'anteprima.");
        const page = await transport.pages(catalogPath(`albums/${tidalAlbumId(row.album.id)}/relationships/items`,
          "items.artists,items.albums"), token, { maxPages: 2, maxItems: 100 });
        gate.assert("tidal", current);
        if (account !== accountRevision) throw new Error("Sessione TIDAL cambiata: ripeti l'anteprima.");
        complete &&= page.complete;
        documents.push(...page.documents);
      }
      const resources = new Map(tidalResources(documents).map((resource) => [`${resource.type}:${resource.id}`, resource]));
      const tracks = new Map();
      for (const document of documents) for (const item of Array.isArray(document.data) ? document.data : []) {
        if (item.type !== "tracks") { complete = false; continue; }
        if (!/^[1-9][0-9]*$/.test(item.id)) throw new Error("Brano TIDAL non valido nell'anteprima album.");
        const resource = resources.get(`tracks:${item.id}`);
        if (!resource?.attributes?.title) { complete = false; continue; }
        if (!tracks.has(item.id)) tracks.set(item.id, resource);
      }
      if (tracks.size > 250) complete = false;
      gate.assert("tidal", current);
      const currentAlbums = chosen().filter((row) => row.album);
      if (currentAlbums.length !== selected.length || selected.some((row) => !currentAlbums.includes(row))) {
        throw new Error("Selezione cambiata durante la lettura: ripeti l'anteprima.");
      }
      showPreparedResources([...tracks.values()].slice(0, 250));
      selectView("playlists"); moveOutput();
      if (!rows.length) results.append(element("p", "Nessun brano TIDAL disponibile per gli album selezionati.", { class: "summary" }));
      status.textContent = `${rows.length} brani TIDAL pronti da ${selected.length} album. `
        + (complete ? "" : "Risultato parziale: limite di lettura o metadati mancanti. ")
        + "Scegli una playlist, seleziona i brani e prepara l'aggiunta; nessuna scrittura e' stata eseguita.";
      refreshSelectionControls();
    });
  }
  function showPreparedResources(resources) {
    clearPreview();
    searchAlbumRows = null;
    results.replaceChildren(); rows = []; lastPlaylist = null; suggestionResultsActive = false;
    for (const resource of resources) {
      const row = { resource, label: `Brano · ${resource.attributes.title}` };
      const item = element("div", "", { class: "tidal-result" });
      const choice = element("label", row.label, { class: "tidal-result-choice" });
      row.check = element("input", "", { type: "checkbox", "aria-label": `Seleziona ${row.label}` });
      row.check.addEventListener("change", () => { clearPreview(); refreshSelectionControls(); });
      choice.prepend(row.check); item.append(choice);
      item.append(configureMusicAppLink(element("a", "Apri in TIDAL ↗", { class: "tidal-result-link" }),
        `https://tidal.com/browse/track/${resource.id}`));
      rows.push(row); results.append(item);
    }
    refreshSelectionControls();
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
    const qobuz = gate.service === "qobuz";
    spotifyCapabilities.hidden = tidal || qobuz;
    capabilities.hidden = !tidal;
    qobuzCapabilities.hidden = !qobuz;
    document.getElementById("playlistImportButton").hidden = false;
    document.getElementById("playlistImportButton").textContent = `Importa playlist ${tidal ? "TIDAL" : qobuz ? "Qobuz" : "Spotify"}…`;
    for (const section of sections) section.hidden = !tidal || section.dataset.tidalPanel === "suggestionsPanel";
    for (const id of ["suggestionsPanel", "playlistBuilderPanel"]) {
      for (const child of document.getElementById(id).children) {
        if (child.dataset.qobuzPanel) child.hidden = !qobuz || id === "suggestionsPanel";
        else if (!child.dataset.tidalPanel) child.hidden = false;
      }
    }
    for (const id of ["manualAlbumDialog", "playlistDialog", "playlistMatchDialog"]) {
      const dialog = document.getElementById(id);
      if ((tidal || qobuz) && dialog?.open) dialog.close();
    }
    clearPreview(); moveOutput(); changed();
  }
  provider.addEventListener("change", updateService);
  window.addEventListener("storage", (event) => {
    if (event.key === "accord-music-service-v1") {
      const saved = localStorage.getItem(event.key);
      provider.value = ["spotify", "tidal", "qobuz"].includes(saved) ? saved : "spotify";
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
      const current = epoch();
      if (["search", "album", "collection"].includes(action)) collectionDetails.open = true;
      if (!/^[A-Za-z]{2}$/.test(country.value)) throw new Error("Immetti un codice paese ISO di due lettere.");
      const requestedPlaylist = ["playlist", "importPlaylist"].includes(action)
        ? tidalPlaylistId(action === "importPlaylist" ? importPlaylist.value : playlist.value) : null;
      const token = await auth.access(client.value.trim()); gate.assert("tidal", current);
      let path, label = "", playlistId = null;
      if (action === "search") {
        const text = query.value.trim();
        if (!text || text.length > 100) throw new Error("Ricerca TIDAL: usa da 1 a 100 caratteri.");
        path = await transport.searchPath(text, "albums", token, {
          countryCode: country.value.toUpperCase(),
          include: "albums.artists,albums.coverArt",
        });
        gate.assert("tidal", current);
        label = "Ricerca album TIDAL";
      } else if (action === "album") {
        path = catalogPath(`albums/${tidalAlbumId(query.value)}`, "artists,coverArt");
        label = "Album TIDAL dal link";
      } else if (action === "collection") {
        path = "userCollectionAlbums/me/relationships/items?include=items.artists,items.coverArt";
        label = "Album preferiti TIDAL";
      } else if (["playlist", "importPlaylist"].includes(action)) {
        playlistId = requestedPlaylist;
        path = catalogPath(`playlists/${playlistId}/relationships/items`, "items.albums.artists,items.albums.coverArt");
        label = "Playlist TIDAL";
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
      clearPreview(); results.replaceChildren(); rows = []; lastPlaylist = null;
      suggestionResultsActive = action === "suggestions";
      refreshSelectionControls();
      const albums = tidalAlbumRecords(documents), all = tidalResources(documents), artwork = tidalAlbumArtwork(documents);
      const albumArtists = tidalAlbumArtists(all);
      const albumMap = new Map(albums.map((album) => [album.id.slice(6), album]));
      const albumRows = albums.map((album) => ({ album, coverUrl: artwork.get(album.id),
        resource: all.find((item) => item.type === "albums" && `tidal:${item.id}` === album.id), label: `${album.name} · ${album.artist}` }));
      searchAlbumRows = ["search", "album"].includes(action) ? albumRows : null;
      if (searchAlbumRows) {
        showAlbumSearch();
        if (!page.complete) status.textContent += " Risultato parziale: raggiunto il limite di ricerca.";
        return;
      }
      const excluded = action === "suggestions"
        ? excludedArtistNames(localStorage.getItem(EXCLUDED_ARTISTS) || "") : new Set();
      const visibleAlbums = albumRows.filter((row) => ![row.album.artist, ...(albumArtists.get(row.album.id.slice(6)) || [])]
        .some((name) => artistIsExcluded(name, excluded)));
      const typeNames = { tracks: "Brano", videos: "Video", playlists: "Playlist", artists: "Artista" };
      let otherRows = all.filter((item) => ["tracks", "videos", "playlists", "artists"].includes(item.type)
        && (item.attributes?.title || item.attributes?.name)).map((resource) => ({
        resource, label: `${typeNames[resource.type]} · ${resource.attributes.title || resource.attributes.name}`,
      }));
      const directItems = documents.flatMap((document) => Array.isArray(document.data) ? document.data : []);
      if (playlistId) {
        const occurrences = directItems.filter((item) => ["tracks", "videos"].includes(item.type) && item.meta?.itemId);
        otherRows = [
          ...otherRows.filter((row) => !["tracks", "videos"].includes(row.resource.type)),
          ...occurrences.map((ref, index) => {
            const resource = { ...all.find((item) => item.type === ref.type && item.id === ref.id), ...ref,
              attributes: all.find((item) => item.type === ref.type && item.id === ref.id)?.attributes };
            return { resource, label: `${typeNames[resource.type]} · ${resource.attributes?.title || "Senza titolo"} · posizione ${index + 1}` };
          }),
        ];
      }
      if (playlistId) lastPlaylist = playlistId;
      if (action === "importPlaylist") otherRows = [];
      if (action === "suggestions") otherRows = otherRows.filter((row) =>
        row.resource.type !== "artists" || !artistIsExcluded(row.resource.attributes.name || row.resource.attributes.title, excluded));
      for (const row of [...visibleAlbums, ...otherRows].slice(0, 250)) {
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
          item.append(configureMusicAppLink(element("a", "Apri in TIDAL ↗", { class: "tidal-result-link" }),
            `https://tidal.com/browse/${singular}/${encodeURIComponent(resource.id)}`));
        }
        if (resource.type === "artists") {
          button(item, "Album dell’artista", () => readArtist(resource.id));
          button(item, "Usa per suggerimenti", () => useSeed(resource.id, resource.attributes.name, "similarArtists"));
        }
        if (resource.type === "playlists") button(item, "Usa questa playlist", () => {
          if (action === "importPlaylists") { importPlaylist.value = resource.id; return read("importPlaylist"); }
          playlist.value = resource.id;
          playlistDestination.value = [...playlistDestination.children].some((option) => option.value === resource.id)
            ? resource.id : "";
          playlistChoice.textContent = `Playlist selezionata: ${resource.attributes.title || resource.attributes.name}`;
          return read("playlist");
        });
        rows.push(row); results.append(item);
      }
      if (!rows.length) results.append(element("p", "Nessun risultato TIDAL disponibile per questa ricerca.", { class: "summary" }));
      const omitted = !mixesComplete || missing.length > 10 || all.filter((item) => item.type === "albums").length > albumMap.size;
      status.textContent = `${label}: ${rows.length} risultati mostrati; ${visibleAlbums.length} album importabili. `
        + (page.complete && !omitted && visibleAlbums.length + otherRows.length <= 250
          ? "Risultati disponibili caricati." : "Risultato parziale: raggiunto il limite di ricerca o mancano alcuni dettagli.")
        + " Seleziona le righe per importare o preparare una modifica.";
      refreshSelectionControls();
    });
  }
  function showAlbumSearch() {
    clearPreview(); results.replaceChildren(); rows = []; lastPlaylist = null;
    suggestionResultsActive = false;
    for (const row of searchAlbumRows.filter(row => albumSearchMatch({
      ...row.album, album_type: row.resource?.attributes?.albumType,
    }, searchOptions())).slice(0, 250)) {
      results.append(renderAlbumResult(row)); rows.push(row);
    }
    status.textContent = `${rows.length} album mostrati su ${searchAlbumRows.length} risultati letti. `
      + "Modifica le caselle per includere live o singoli / EP; nessuna nuova ricerca automatica.";
    if (!rows.length) results.append(element("p", "Nessun album corrisponde ai filtri.", { class: "summary" }));
    refreshSelectionControls();
  }
  async function readArtist(id) {
    seed.value = id;
    return run(async () => {
      const current = epoch(), token = await auth.access(client.value.trim());
      const page = await transport.pages(catalogPath(`artists/${id}/relationships/albums`, "albums.artists,albums.coverArt"), token);
      gate.assert("tidal", current);
      clearPreview(); results.replaceChildren(); rows = []; lastPlaylist = null;
      searchAlbumRows = null;
      const artwork = tidalAlbumArtwork(page.documents);
      const excluded = suggestionResultsActive
        ? excludedArtistNames(localStorage.getItem(EXCLUDED_ARTISTS) || "") : new Set();
      const albumArtists = tidalAlbumArtists(tidalResources(page.documents));
      for (const album of tidalAlbumRecords(page.documents).filter((record) =>
        ![record.artist, ...(albumArtists.get(record.id.slice(6)) || [])].some((name) => artistIsExcluded(name, excluded)))) {
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
      let path, method, body, summary, target = "";
      if (["favorite", "unfavorite"].includes(action)) {
        const data = selected.filter((row) => row.album).map((row) => ({ type: "albums", id: row.album.id.slice(6) }));
        if (!data.length || data.length > 50) throw new Error("Seleziona da 1 a 50 album.");
        path = "userCollectionAlbums/me/relationships/items";
        method = action === "favorite" ? "POST" : "DELETE"; body = { data };
        summary = `${action === "favorite" ? "Aggiungi" : "Rimuovi"} ${data.length} album dai preferiti TIDAL.`;
      } else {
        const id = action === "create" ? null : tidalPlaylistId(playlist.value);
        if (id) target = `\nPlaylist: ${id}`;
        path = id ? `playlists/${id}` : "playlists";
        const attributes = { name: playlistName.value.trim(), description: description.value };
        if (["create", "edit"].includes(action) && !attributes.name) throw new Error("Immetti un nome playlist.");
        if (action === "create") {
          method = "POST"; body = { data: { type: "playlists", attributes: { ...attributes, accessType: "UNLISTED" } } };
          summary = `Crea playlist non in elenco (UNLISTED) «${attributes.name}», accessibile a chi ha il link; non privata.`;
        } else if (action === "edit") {
          method = "PATCH"; body = { data: { type: "playlists", id, attributes } };
          summary = "Modifica nome e descrizione della playlist selezionata.";
        } else if (action === "delete") {
          method = "DELETE"; summary = "Elimina definitivamente la playlist selezionata.";
        } else {
          let data = selected.filter((row) => ["tracks", "videos"].includes(row.resource?.type)).map((row) => {
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
          summary = `${action === "add" ? "Aggiungi (salta duplicati)" : action === "move" ? "Sposta" : "Rimuovi"} ${data.length} elementi nella playlist selezionata.`;
        }
      }
      plan = { path, options: { method, ...(body ? { body } : {}) }, summary, target, epoch: epoch() };
      mutationSummary.textContent = summary;
      mutation.textContent = `${summary}\n${method} ${path}\n${body ? JSON.stringify(body, null, 2) : ""}`;
      mutationDetails.hidden = false;
      commit.disabled = false; commit.hidden = false;
      status.textContent = "Anteprima pronta. Nessuna scrittura ancora eseguita.";
    } catch (error) { status.textContent = error.message; }
  }
  for (const field of [client, playlist, playlistName, description, position]) field.addEventListener("input", clearPreview);
  playlist.addEventListener("input", () => {
    playlistDestination.value = ""; playlistChoice.textContent = "Playlist specificata tramite collegamento o ID.";
  });
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
    revealCollection();
    importDetails.open = true; moveOutput(); listImportPlaylists.focus();
  }
  let editionSelection = null;
  function openCatalog(value = "", selection = null) {
    editionSelection = selection;
    compareEditionsButton.hidden = !selection;
    compareEditionsButton.disabled = true;
    gate.assert("tidal"); selectView("collection");
    revealCollection();
    collectionDetails.open = true; query.value = value; moveOutput(); query.focus();
  }
  function useSeed(id, label, kind) {
    gate.assert("tidal");
    if (busy) return;
    seed.value = id; source.value = kind; seedChoice.textContent = `Selezionato: ${label}`;
    selectView("suggestions"); moveOutput();
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
  async function suggestionAlbums(path, { maxPages = 1, maxItems = 100 } = {}) {
    const current = epoch(); gate.assert("tidal", current);
    const token = await auth.access(client.value.trim()); gate.assert("tidal", current);
    const page = await transport.pages(path, token, { maxPages, maxItems });
    gate.assert("tidal", current);
    const resources = tidalResources(page.documents), art = tidalAlbumArtwork(page.documents);
    const names = tidalAlbumArtists(resources);
    return { rows: tidalAlbumRecords(page.documents).map((album) => ({
      album, coverUrl: art.get(album.id), artistNames: names.get(album.id.slice(6)) || [album.artist],
      resource: { type: "albums", id: album.id.slice(6) },
    })), complete: page.complete };
  }
  const suggestionAPI = {
    album: async (id) => {
      const current = epoch(); gate.assert("tidal", current);
      const identifier = tidalAlbumId(id);
      const token = await auth.access(client.value.trim()); gate.assert("tidal", current);
      const document = await transport.request(catalogPath(`albums/${identifier}`, "artists,coverArt"), token);
      gate.assert("tidal", current);
      const row = tidalAlbumRecords([document]).find(row => row.id === `tidal:${identifier}`);
      if (!row) throw new Error("Album TIDAL non disponibile nel catalogo.");
      return row;
    },
    revision: () => accountRevision,
    seed: () => ({ id: seed.value, label: seedChoice.textContent }),
    search: async (text) => {
      const current = epoch(); gate.assert("tidal", current);
      const token = await auth.access(client.value.trim()); gate.assert("tidal", current);
      const path = await transport.searchPath(text, "albums", token, {
        countryCode: country.value.toUpperCase(), include: "albums.artists,albums.coverArt",
      });
      gate.assert("tidal", current);
      return suggestionAlbums(path);
    },
    native: async (mode, guard = () => {}) => {
      guard();
      if (mode === "album") return suggestionAlbums(catalogPath(
        `albums/${tidalAlbumId(seed.value)}/relationships/similarAlbums`, "similarAlbums.artists,similarAlbums.coverArt"));
      if (mode === "favorites") {
        const favorites = await suggestionAlbums("userCollectionAlbums/me/relationships/items?include=items.artists,items.coverArt");
        const known = new Set(favorites.rows.map((row) => row.album.id)), found = new Map();
        let complete = favorites.complete;
        for (const row of favorites.rows.slice(0, 5)) {
          guard();
          const page = await suggestionAlbums(catalogPath(
            `albums/${tidalAlbumId(row.album.id)}/relationships/similarAlbums`, "similarAlbums.artists,similarAlbums.coverArt"));
          guard();
          complete &&= page.complete;
          for (const item of page.rows) if (!known.has(item.album.id)) found.set(item.album.id, item);
        }
        if (!favorites.rows.length) throw new Error("Nessun preferito TIDAL nel campione disponibile.");
        return { rows: [...found.values()], complete: complete && favorites.rows.length <= 5 };
      }
      const modes = { discovery: "userDiscoveryMixes", daily: "userDailyMixes", new: "userNewReleaseMixes" };
      if (!modes[mode]) throw new Error("Fonte suggerimenti TIDAL non valida.");
      const current = epoch(), token = await auth.access(client.value.trim()); gate.assert("tidal", current);
      const page = await transport.pages(`${modes[mode]}/me?include=items`, token, { maxPages: 1, maxItems: 100 });
      gate.assert("tidal", current);
      const mixLists = tidalResources(page.documents).filter((row) => row.type === "playlists");
      const found = new Map(); let complete = page.complete && mixLists.length <= 3;
      for (const list of mixLists.slice(0, 3)) {
        guard();
        const items = await suggestionAlbums(catalogPath(`playlists/${tidalPlaylistId(list.id)}/relationships/items`,
          "items.albums.artists,items.albums.coverArt"));
        guard();
        complete &&= items.complete;
        for (const row of items.rows) found.set(row.album.id, row);
      }
      return { rows: [...found.values()], complete };
    },
    prepare: async (records) => {
      gate.assert("tidal"); clearPreview();
      rows = records.map((row) => ({ ...row, resource: { type: "albums", id: row.album.id.slice(6) }, check: { checked: true } }));
      await prepareAlbumTracks();
      return status.textContent;
    },
  };
  const playlistAPI = {
    adopt: (tracks) => showPreparedResources(tracks.map((track) => ({
      type: "tracks", id: track.id, attributes: { title: track.name },
    }))),
    revision: () => `${accountRevision}|${client.value}|${country.value}`,
    identity: async () => {
      const value = JSON.parse(sessionStorage.getItem("accord-tidal-token-v1") || "null");
      if (!value || value.clientId !== client.value) throw new Error("Collega TIDAL prima di riprendere.");
      const current = epoch(), account = accountRevision;
      const token = await auth.access(client.value.trim());
      const document = await transport.request("users/me", token);
      gate.assert("tidal", current);
      if (account !== accountRevision || document.data?.type !== "users" || !document.data.id) throw new Error("Account TIDAL non verificabile.");
      return [client.value, country.value, String(document.data.id)];
    },
    batchSize: 50,
    completionPage: async (path, beforeRead) => {
      const current = epoch(), account = accountRevision;
      gate.assert("tidal", current);
      const token = await auth.access(client.value.trim());
      const url = new URL(path, "https://openapi.tidal.com/v2/");
      if (url.origin !== "https://openapi.tidal.com" || url.username || url.password || url.hash
          || !/^\/v2\/albums\/[1-9][0-9]*(?:\/relationships\/items)?$/.test(url.pathname)) {
        throw new Error("Pagina completamento TIDAL non valida.");
      }
      url.searchParams.set("countryCode", country.value.toUpperCase());
      gate.assert("tidal", current);
      if (account !== accountRevision) throw new Error("Account cambiato.");
      const result = await transport.request(url.href, token, { beforeRead });
      gate.assert("tidal", current);
      if (account !== accountRevision) throw new Error("Account cambiato.");
      return result;
    },
    preflight: async () => {
      gate.assert("tidal"); transport.ready(); await auth.access(client.value.trim()); transport.ready();
    },
    albumTracks: async (id) => {
      const current = epoch(), account = accountRevision;
      gate.assert("tidal", current);
      const token = await auth.access(client.value.trim());
      gate.assert("tidal", current);
      if (account !== accountRevision) throw new Error("Account cambiato.");
      const page = await transport.pages(catalogPath(`albums/${tidalAlbumId(id)}/relationships/items`,
        "items.artists,items.albums"), token, { maxPages: 2, maxItems: 100 });
      gate.assert("tidal", current);
      if (account !== accountRevision) throw new Error("Account cambiato.");
      const resources = new Map(tidalResources(page.documents).map((row) => [`${row.type}:${row.id}`, row]));
      const tracks = [], seen = new Set(); let complete = page.complete;
      for (const document of page.documents) for (const item of Array.isArray(document.data) ? document.data : []) {
        if (item.type !== "tracks") { complete = false; continue; }
        const resource = resources.get(`tracks:${item.id}`);
        if (!resource?.attributes?.title || seen.has(item.id)) { complete = false; continue; }
        const refs = resource.relationships?.artists?.data || [];
        tracks.push({ id: item.id, name: resource.attributes.title,
          artist: refs.map((ref) => resources.get(`artists:${ref.id}`)?.attributes?.name).filter(Boolean).join(", "),
          uri: `tidal:track:${item.id}` });
        seen.add(item.id);
      }
      return { tracks, next: null, complete };
    },
    create: async (name, guard = () => {}) => {
      const token = await auth.access(client.value.trim());
      guard();
      const result = await transport.request("playlists", token, { method: "POST",
        body: { data: { type: "playlists", attributes: {
          name, description: "Creata da Accord · nuovi artisti e album verificati", accessType: "UNLISTED" } } } });
      const id = tidalPlaylistId(result.data?.id);
      if (result.data?.attributes?.accessType !== "UNLISTED") throw new Error("Privacy TIDAL non verificata: controlla la playlist.");
      return { id, name: result.data.attributes.name || name };
    },
    add: async (id, ids, guard = () => {}) => {
      const token = await auth.access(client.value.trim());
      guard();
      return transport.request(`playlists/${tidalPlaylistId(id)}/relationships/items`, token, { method: "POST",
        body: { data: ids.map((id) => ({ type: "tracks", id })), meta: { onDuplicates: "SKIP" } } });
    },
    management: () => { selectView("playlists"); playlists.open = true; playlists.hidden = false; moveOutput(); },
    prepare: async (records, guard) => {
      const tracks = new Map(); let partial = false;
      if (!records.length || records.length > 10) throw new Error("Seleziona da 1 a 10 album.");
      for (const record of records) {
        guard();
        const page = await playlistAPI.albumTracks(record.album.id); guard(); partial ||= !page.complete;
        for (const track of page.tracks) tracks.set(track.id, track);
      }
      return { tracks: [...tracks.values()].slice(0, 250), partial: partial || tracks.size > 250 };
    },
  };
  bindPauseNotice(status, { storage: localStorage, provider: () => "tidal",
    describe: () => "potrai rilanciare la lettura del catalogo o della playlist; Continua riprende le letture mancanti dell'anteprima." });
  return { auth, transport, openImport, openCatalog, loadArtwork, suggestionAPI, playlistAPI, isBusy: () => busy };
}
