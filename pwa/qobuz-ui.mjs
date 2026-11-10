import { createQobuzClient, qobuzCredentials, qobuzNumericId, qobuzAlbumId } from "./qobuz.mjs?v=10";
import { qobuzBundleSecrets, qobuzStreamUrl } from "./qobuz-playback.mjs?v=9";
import { albumSearchControls, albumSearchMatch, artistIsExcluded, excludedArtistNames } from "./music-suggestion-filters.mjs?v=2";
import { configureMusicAppLink } from "./music-app-links.mjs?v=2";
import { bindPauseNotice } from "./music-continuity.mjs?v=7";
import { showEditionComparison } from "./edition-comparison.mjs?v=1";

const SESSION = "accord-qobuz-session-v1";
const UNCERTAIN = "accord-qobuz-write-uncertain-v1";
const EXCLUDED_ARTISTS = "accord-qobuz-suggestion-excluded-artists-v1";
const element = (tag, text = "", attributes = {}) => {
  const node = document.createElement(tag);
  node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};

export function initializeQobuzUI({ addAlbum, gate, selectView = () => {}, openSettings = () => {},
  requestOptions = {} }) {
  let accountRevision = 0;
  const section = element("details", "", { class: "tidal-collection-details" });
  section.append(element("summary", "Qobuz · cerca, importa e gestisci preferiti"));
  section.append(element("p", "Cerca album o leggi i preferiti, poi scegli cosa aggiungere alla raccolta.", { class: "summary" }));
  const accountDetails = element("details", "", { class: "preference-group", id: "qobuzConfiguration" });
  accountDetails.append(element("summary", "Collegamento Qobuz"));
  const configuration = element("div", "", { class: "tidal-controls" });
  const field = (label, type = "text") => {
    const wrapper = element("label", label), input = element("input", "", {
      type, maxlength: "512", autocomplete: "off",
    });
    wrapper.append(input); configuration.append(wrapper); return input;
  };
  const appId = field("X-App-Id della sessione web", "password");
  const token = field("X-User-Auth-Token (non password)", "password");
  accountDetails.append(configuration, element("p",
    "Nel browser Qobuz: Strumenti sviluppatore > Rete; apri la libreria e seleziona "
    + "favorite/getUserFavorites. Copia le due intestazioni, senza condividere il token. "
    + "L'accesso resta nella sessione del browser, leggibile dagli script della stessa origine; "
    + "non entra in backup o sincronizzazione.", { class: "notice" }));
  const controls = element("div", "", { class: "tidal-actions" });
  const status = element("p", "", { role: "status", "aria-live": "polite", class: "summary" });
  const accountStatus = element("p", "", { role: "status", "aria-live": "polite", class: "summary" });
  const results = element("div", "", { class: "tidal-results" });
  const query = element("input", "", { placeholder: "Titolo, artista, ID o link album Qobuz", maxlength: "300" });
  let rows = [], mode = "", currentQuery = "", offset = 0, next = null, busy = false;
  const buttons = [];
  function button(parent, text, action, tracked = true) {
    const node = element("button", text, { type: "button", class: "secondary" });
    node.addEventListener("click", action); parent.append(node);
    if (tracked) buttons.push(node);
    return node;
  }
  async function run(action, output = status) {
    if (busy) return;
    busy = true;
    for (const node of buttons) node.disabled = true;
    updatePlayerButtons();
    const epoch = gate.epoch;
    const guard = () => gate.assert("qobuz", epoch);
    try { guard(); await action(guard); }
    catch (error) { output.textContent = error.message; }
    finally { busy = false; for (const node of buttons) node.disabled = false; updatePlayerButtons(); }
  }
  function client() {
    let value;
    try { value = JSON.parse(sessionStorage.getItem(SESSION) || "null"); }
    catch { throw new Error("Sessione Qobuz non leggibile: scollega e ricollega."); }
    if (!value || Object.keys(value).sort().join("|") !== "appId|token") {
      throw new Error("Collega prima la sessione Qobuz.");
    }
    return guardedClient(qobuzCredentials(value.appId, value.token));
  }
  function guardedClient(value) {
    const epoch = gate.epoch, revision = accountRevision;
    return createQobuzClient({ ...requestOptions, ...value, storage: localStorage,
      active: () => gate.service === "qobuz" && gate.epoch === epoch && accountRevision === revision });
  }
  button(controls, "Collega Qobuz", () => run(async (guard) => {
    const value = qobuzCredentials(appId.value.trim(), token.value.trim());
    appId.value = ""; token.value = "";
    await guardedClient(value).favorites();
    guard();
    resetSessionViews();
    sessionStorage.setItem(SESSION, JSON.stringify(value));
    accountStatus.textContent = "Qobuz collegato in questa sessione. Scegli una lettura.";
    status.textContent = "Qobuz collegato. Scegli una lettura.";
  }, accountStatus));
  button(controls, "Scollega Qobuz", () => void run(async () => {
    sessionStorage.removeItem(SESSION); resetSessionViews();
    accountStatus.textContent = status.textContent = "Qobuz scollegato; raccolta Accord invariata.";
  }, accountStatus));
  accountDetails.append(controls, accountStatus);
  button(section, "Collegamento Qobuz…", () => {
    openSettings(); accountDetails.open = true; appId.focus();
  }, false);
  const reads = element("div", "", { class: "tidal-controls" });
  const label = element("label", "Ricerca album Qobuz");
  label.append(query); reads.append(label);
  let searchPage = null;
  const searchOptions = albumSearchControls(reads, { prefix: "qobuzAlbumSearch",
    changed: () => { if (searchPage) show(searchPage); } });
  button(reads, "Cerca", () => {
    mode = "search"; currentQuery = query.value.trim();
    if (/^(?:qobuz:|https:\/\/play\.qobuz\.com\/)/.test(currentQuery)) {
      void readAlbum();
    } else void read(0);
  });
  function readAlbum() {
    mode = "album"; currentQuery = query.value.trim();
    return run(async (guard) => {
      const album = await client().album(currentQuery);
      guard(); show({ rows: [album], offset: 0, total: 1, next: null });
    });
  }
  button(reads, "Leggi preferiti", () => { mode = "favorites"; currentQuery = ""; void read(0); });
  button(reads, "Pagina precedente", () => { if (offset > 0) void read(Math.max(0, offset - 100)); });
  button(reads, "Pagina successiva", () => { if (next !== null) void read(next); });
  const albumLinkDetails = element("details", "", { class: "tidal-secondary-details" });
  albumLinkDetails.append(element("summary", "Ricerca tramite ID o link"));
  button(albumLinkDetails, "Leggi ID / link album", () => void readAlbum());
  section.append(reads, albumLinkDetails, results);
  function show(page) {
    searchPage = page;
    offset = page.offset; next = page.next; rows = [];
    results.replaceChildren();
    for (const row of page.rows) {
      if (mode !== "favorites" && !albumSearchMatch({ ...row.album, ...row.edition }, searchOptions())) continue;
      const item = element("article", "", { class: "suggestion-album tidal-album-result" });
      const choice = element("label", "", { class: "tidal-album-choice" });
      const check = element("input", "", { type: "checkbox", "aria-label": `Seleziona ${row.album.name}` });
      const compareCheck = element("input", "", { type: "checkbox", "aria-label": `Confronta ${row.album.name}` });
      const text = element("span");
      text.append(element("strong", row.album.name),
        element("span", `${row.album.artist} · ${row.album.year || "Anno sconosciuto"}`, { class: "suggestion-detail" }));
      if (row.coverUrl) {
        choice.append(element("img", "", { src: row.coverUrl, alt: "", loading: "lazy",
          referrerpolicy: "no-referrer", class: "suggestion-cover" }));
      }
      choice.prepend(check); choice.append(text); item.append(choice);
      const compare = element("label", "Confronta", { class: "check" });
      if (editionSelection) {
        compare.prepend(compareCheck); item.append(compare);
        compareCheck.addEventListener("change", () => {
          compareEditionsButton.disabled = rows.filter((entry) => entry.compareCheck.checked).length < 2;
        });
      }
      item.append(configureMusicAppLink(element("a", "Apri in Qobuz ↗", { class: "tidal-result-link" }),
        row.album.url, { query: `${row.album.artist} ${row.album.name}`,
          report: (message) => { status.textContent = message; } }));
      button(item, "Usa per suggerimenti", () => useAlbum(row.album, "suggestions"), false);
      button(item, "Usa per playlist", () => useAlbum(row.album, "playlists"), false);
      if (editionSelection) button(item, "Associa questa edizione", () => {
        if (!editionSelection) { status.textContent = "Apri Associa edizione dalla raccolta prima di scegliere."; return; }
        const callback = editionSelection; editionSelection = null; compareEditionsButton.hidden = true; callback(row.album);
      }, false);
      results.append(item); rows.push({ ...row, check, compareCheck });
    }
    status.textContent = `Qobuz: ${rows.length} mostrati su ${page.rows.length} risultati da ${offset + 1}, totale ${page.total}. `
      + "Seleziona gli album; le altre pagine restano disponibili.";
  }
  async function read(position) {
    return run(async (guard) => {
      if (!["favorites", "search"].includes(mode)) throw new Error("Scegli una lettura Qobuz.");
      const page = mode === "favorites" ? await client().favorites(position) : await client().search(currentQuery, position);
      guard();
      show(page);
    });
  }
  const selected = () => rows.filter((row) => row.check.checked);
  const actions = element("div", "", { class: "tidal-actions" });
  const compareEditionsButton = button(actions, "Confronta edizioni selezionate (2–4)", () => {
    try {
      const editions = rows.filter((row) => row.compareCheck.checked);
      showEditionComparison(editions.map((row) => ({ ...row.album, ...row.edition })), "qobuz");
    } catch (error) { status.textContent = error.message; }
  });
  compareEditionsButton.hidden = true;
  compareEditionsButton.disabled = true;
  button(actions, "Importa selezionati in Accord", () => run(async (guard) => {
    const chosen = selected();
    if (!chosen.length) throw new Error("Seleziona almeno un album.");
    if (!confirm(`Importare ${chosen.length} album in Accord? I dati esistenti non vengono sovrascritti.`)) return;
    let added = 0;
    try {
      for (const row of chosen) {
        guard();
        if (await addAlbum(row.album, row.coverUrl)) added += 1;
      }
    } catch (error) {
      throw new Error(`Importazione interrotta: ${added} album gia' aggiunti. ${error.message}`);
    }
    status.textContent = `${added} album aggiunti localmente. Sincronizza GitHub solo quando desideri.`;
  }));
  function write(favorite) {
    return run(async (guard) => {
      const chosen = selected();
      if (chosen.length !== 1) throw new Error("Seleziona un solo album per modificare i preferiti Qobuz.");
      const target = chosen[0].album;
      if (!confirm(`${favorite ? "Aggiungere" : "Rimuovere"} «${target.name}» ${favorite ? "ai" : "dai"} preferiti Qobuz? La raccolta Accord non cambia. Nessun reinvio automatico.`)) return;
      if (!navigator.locks?.request) {
        throw new Error("Questo browser non supporta il blocco sicuro fra schede. Modifica i preferiti direttamente su Qobuz.");
      }
      await navigator.locks.request("accord-qobuz-write-v1", async () => {
        guard();
        if (localStorage.getItem(UNCERTAIN)) throw new Error("Verifica prima su Qobuz l'esito della scrittura precedente.");
        const active = client();
        localStorage.setItem(UNCERTAIN, "1");
        await active.setFavorite(target.id, favorite);
        localStorage.removeItem(UNCERTAIN);
      });
      status.textContent = "Risposta Qobuz ricevuta. Rileggi i preferiti per verificare la modifica.";
    });
  }
  const favoriteActions = element("details", "", { class: "tidal-secondary-details" });
  favoriteActions.append(element("summary", "Gestione preferiti Qobuz"));
  button(favoriteActions, "Aggiungi preferito Qobuz", () => void write(true));
  button(favoriteActions, "Rimuovi preferito Qobuz", () => void write(false));
  button(favoriteActions, "Ho verificato l'esito su Qobuz", () => void run(async (guard) => {
    if (!navigator.locks?.request) throw new Error("Questo browser non supporta il blocco sicuro fra schede.");
    await navigator.locks.request("accord-qobuz-write-v1", async () => {
      guard();
      if (!localStorage.getItem(UNCERTAIN)) { status.textContent = "Nessuna scrittura Qobuz incerta."; return; }
      if (confirm("Hai controllato direttamente su Qobuz l'esito dell'ultima modifica incerta?")) {
        localStorage.removeItem(UNCERTAIN);
        status.textContent = "Verifica confermata. Rileggi i preferiti prima di altre modifiche.";
      }
    });
  }));
  actions.append(favoriteActions);
  section.append(actions, status);
  document.getElementById("tidalCollectionMount").append(section);
  document.querySelector("#settingsDialog .dialog-scroll").append(accountDetails);

  const suggestions = element("section", "", { class: "tidal-panel", "data-qobuz-panel": "suggestionsPanel" });
  suggestions.append(element("p", "SCOPERTA MUSICALE", { class: "eyebrow" }),
    element("h2", "Suggerimenti Qobuz"),
    element("p", "Scegli un album o parti dai preferiti Qobuz. I suggerimenti non modificano la raccolta.", { class: "summary" }));
  const suggestionControls = element("div", "", { class: "tidal-controls" });
  const suggestionChoice = element("p", "Nessun album selezionato.", { class: "summary" });
  suggestionControls.append(suggestionChoice);
  button(suggestionControls, "Cerca un album Qobuz…", () => openCatalog(), false);
  const suggestionAdvanced = element("details", "", { class: "tidal-secondary-details" });
  suggestionAdvanced.append(element("summary", "Usa un link o ID album"));
  const suggestionLabel = element("label", "ID / link album Qobuz");
  const suggestionQuery = element("input", "", { maxlength: "300" });
  suggestionQuery.addEventListener("input", () => { suggestionChoice.textContent = "Album specificato tramite collegamento o ID."; });
  suggestionLabel.append(suggestionQuery); suggestionAdvanced.append(suggestionLabel);
  suggestionControls.append(suggestionAdvanced);
  const suggestionResults = element("div", "", { class: "tidal-results" });
  const suggestionStatus = element("p", "", { role: "status", "aria-live": "polite", class: "summary" });
  const suggestionFilters = element("details", "", { class: "tidal-secondary-details" });
  suggestionFilters.append(element("summary", "Filtri suggerimenti"));
  const excludedLabel = element("label", "Artisti da escludere");
  const excludedInput = element("input", "", { placeholder: "Nomi esatti separati da ;" });
  excludedInput.value = localStorage.getItem(EXCLUDED_ARTISTS) || "";
  excludedLabel.append(excludedInput); suggestionFilters.append(excludedLabel);
  suggestionFilters.append(element("p", "Filtra i nomi degli artisti mostrati; non cambia l'album di partenza.",
    { class: "summary" }));
  button(suggestionFilters, "Salva filtri", () => void run(async () => {
    localStorage.setItem(EXCLUDED_ARTISTS, excludedInput.value);
    suggested = []; suggestionResults.replaceChildren();
    suggestionStatus.textContent = "Filtri salvati. Rileggi i suggerimenti per applicarli.";
  }, suggestionStatus), false);
  suggestionControls.append(suggestionFilters);
  let suggested = [];
  function showSuggestions(records, detail = "") {
    suggested = [];
    suggestionResults.replaceChildren();
    const excluded = excludedArtistNames(localStorage.getItem(EXCLUDED_ARTISTS) || "");
    for (const row of records) {
      if (artistIsExcluded(row.album.artist, excluded)) continue;
      const item = element("article", "", { class: "suggestion-album tidal-album-result" });
      const wrapper = element("label", "", { class: "tidal-album-choice" });
      const check = element("input", "", { type: "checkbox", "aria-label": `Seleziona ${row.album.name}` });
      const cover = element("span", "", { class: "suggestion-cover-frame" });
      if (row.coverUrl) {
        const image = element("img", "", { src: row.coverUrl, alt: "", loading: "lazy",
          referrerpolicy: "no-referrer", class: "suggestion-cover" });
        image.addEventListener("load", () => cover.classList.add("has-cover"));
        cover.append(image);
      }
      cover.append(element("span", "Qobuz", { class: "suggestion-cover-placeholder" }));
      const text = element("span", "", { class: "tidal-album-copy" });
      text.append(element("strong", row.album.name),
        element("span", `${row.album.artist} · ${row.album.year || "Anno sconosciuto"}`, { class: "suggestion-detail" }));
      wrapper.append(check, cover, text); item.append(wrapper);
      item.append(configureMusicAppLink(element("a", "Apri in Qobuz ↗", { class: "tidal-result-link" }),
        row.album.url, { query: `${row.album.artist} ${row.album.name}`,
          report: (message) => { suggestionStatus.textContent = message; } }));
      button(item, "Usa per suggerimenti", () => useAlbum(row.album, "suggestions"), false);
      button(item, "Usa per playlist", () => useAlbum(row.album, "playlists"), false);
      suggestionResults.append(item); suggested.push({ ...row, check });
    }
    suggestionStatus.textContent = `${suggested.length} album suggeriti da Qobuz. Seleziona quelli da importare.${detail}`;
  }
  button(suggestionControls, "Leggi suggerimenti · anteprima", () => void run(async (guard) => {
    const records = await client().similarAlbums(suggestionQuery.value);
    guard(); showSuggestions(records);
  }, suggestionStatus));
  button(suggestionControls, "Suggerimenti dai miei preferiti", () => void run(async (guard) => {
    const api = client(), favorites = await api.favorites();
    guard();
    const known = new Set(favorites.rows.map((row) => row.album.id));
    const seeds = [...known].slice(0, 5);
    if (!seeds.length) throw new Error("Nessun album tra i preferiti Qobuz. Aggiungine almeno uno per iniziare.");
    const records = new Map();
    for (const seed of seeds) {
      guard();
      const similar = await api.similarAlbums(seed);
      guard();
      for (const row of similar) {
        if (!known.has(row.album.id) && !records.has(row.album.id)) records.set(row.album.id, row);
      }
    }
    showSuggestions([...records.values()], ` Basati su ${seeds.length} album preferiti tra i primi `
      + `${favorites.rows.length} letti su ${favorites.total}; non sono cronologia di ascolto.`);
  }, suggestionStatus));
  button(suggestionControls, "Importa album selezionati", () => void run(async (guard) => {
    const selected = suggested.filter((row) => row.check.checked);
    if (!selected.length) throw new Error("Seleziona almeno un album.");
    if (!confirm(`Importare ${selected.length} album nella raccolta locale? Nessuna scrittura Qobuz.`)) return;
    let added = 0;
    for (const row of selected) { guard(); if (await addAlbum(row.album, row.coverUrl)) added += 1; }
    suggestionStatus.textContent = `${added} album aggiunti localmente.`;
  }, suggestionStatus));
  function prepareSuggestedPlaylist() { return run(async (guard) => {
    const selected = suggested.filter((row) => row.check.checked);
    if (!selected.length || selected.length > 10) throw new Error("Seleziona da 1 a 10 album per preparare l'anteprima.");
    const api = client(), tracks = new Map();
    let partial = false;
    for (const row of selected) {
      guard();
      const page = await api.albumTracks(row.album.id);
      guard();
      partial ||= page.next !== null;
      for (const track of page.tracks) if (!tracks.has(track.id)) tracks.set(track.id, track);
    }
    const current = suggested.filter((row) => row.check.checked);
    if (current.length !== selected.length || selected.some((row) => !current.includes(row))) {
      throw new Error("Selezione cambiata durante la lettura: ripeti l'anteprima.");
    }
    const prepared = [...tracks.values()].slice(0, 250);
    playlistValue = ""; playlistPrevious = [];
    showPlaylistPage({ tracks: prepared, offset: 0, total: prepared.length, next: null }, "prepared");
    playlistStatus.textContent = `Anteprima: ${prepared.length} brani da ${selected.length} album. `
      + (partial || tracks.size > 250 ? "Risultato parziale: raggiunto il limite di lettura. " : "")
      + "Scegli una playlist, seleziona i brani e conferma l'aggiunta.";
    selectView("playlists");
  }, suggestionStatus); }
  button(suggestionControls, "Prepara playlist dagli album selezionati", () => void prepareSuggestedPlaylist());
  suggestions.append(suggestionControls, suggestionResults, suggestionStatus);
  document.getElementById("suggestionsPanel").prepend(suggestions);

  const playlists = element("details", "", { class: "tidal-panel", "data-qobuz-panel": "playlistBuilderPanel" });
  playlists.append(element("summary", "Gestisci playlist Qobuz esistenti"));
  playlists.append(element("p", "GESTIONE PLAYLIST", { class: "eyebrow" }),
    element("h2", "Playlist Qobuz"),
    element("p", "Leggi una playlist o prepara brani da un album. Ogni modifica remota richiede conferma; le nuove playlist sono private.", { class: "summary" }));
  const playlistControls = element("div", "", { class: "tidal-controls tidal-playlist-controls" });
  function playlistField(parent, label, placeholder) {
    const wrapper = element("label", label), input = element("input", "", { maxlength: "300", placeholder });
    wrapper.append(input); parent.append(wrapper); return input;
  }
  const playlistChoice = element("p", "Nessuna playlist selezionata.", { class: "summary" });
  const playlistAlbumChoice = element("p", "Nessun album selezionato.", { class: "summary" });
  playlistControls.append(playlistChoice, playlistAlbumChoice);
  button(playlistControls, "Cerca un album Qobuz…", () => openCatalog(), false);
  const playlistAdvanced = element("details", "", { class: "tidal-secondary-details" });
  playlistAdvanced.append(element("summary", "Usa collegamenti o ID"));
  const playlistId = playlistField(playlistAdvanced, "ID / link playlist Qobuz", "Playlist Qobuz");
  const playlistAlbum = playlistField(playlistAdvanced, "ID / link album Qobuz", "Album di partenza");
  playlistAlbum.addEventListener("input", () => { playlistAlbumChoice.textContent = "Album specificato tramite collegamento o ID."; });
  playlistControls.append(playlistAdvanced);
  const playlistName = playlistField(playlistControls, "Nome playlist", "Nome della playlist");
  const playlistDescription = playlistField(playlistControls, "Descrizione playlist", "Descrizione");
  const playlistListing = element("div", "", { class: "tidal-results" });
  const playlistResults = element("div", "", { class: "tidal-results" });
  const playlistStatus = element("p", "", { role: "status", "aria-live": "polite", class: "summary" });
  let playlistRows = [], playlistMode = "", playlistOffset = 0, playlistNext = null,
    loadedPlaylist = null, playlistValue = "", playlistPrevious = [],
    descriptionKnown = false, descriptionEdited = false, loadedPlaylistPage = null;
  playlistDescription.addEventListener("input", () => { descriptionEdited = true; });
  playlistId.addEventListener("input", () => {
    loadedPlaylist = null; loadedPlaylistPage = null; descriptionKnown = false; descriptionEdited = false;
    playlistChoice.textContent = "Playlist specificata tramite collegamento o ID.";
  });
  function showPlaylistPage(page, mode) {
    playlistMode = mode; playlistOffset = page.offset; playlistNext = page.next;
    playlistListing.replaceChildren();
    if (mode === "list") {
      for (const item of page.playlists) {
        const row = element("div", "", { class: "tidal-result" });
        row.append(element("span", `${item.name} · ${item.tracksCount} ${item.tracksCount === 1 ? "brano" : "brani"} · ${item.public ? "pubblica" : "privata"}`));
        button(row, "Scegli playlist", () => {
          if (!busy) {
            playlistId.value = item.id; playlistName.value = item.name; playlistDescription.value = "";
            loadedPlaylist = null; loadedPlaylistPage = null; descriptionKnown = false; descriptionEdited = false;
            playlistChoice.textContent = `Playlist selezionata: ${item.name}`;
          }
        }, false);
        playlistListing.append(row);
      }
    } else {
      playlistRows = []; playlistResults.replaceChildren();
      const previousPlaylist = loadedPlaylist;
      loadedPlaylist = mode === "playlist" ? page.playlist.id : null;
      loadedPlaylistPage = mode === "playlist" ? {
        id: page.playlist.id, offset: page.offset, total: page.total,
        occurrences: page.tracks.map((track) => track.playlistTrackId),
      } : null;
      if (mode === "playlist" && previousPlaylist !== loadedPlaylist) {
        playlistChoice.textContent = `Playlist selezionata: ${page.playlist.name}`;
        playlistName.value = page.playlist.name;
        descriptionKnown = page.playlist.description !== null;
        playlistDescription.value = page.playlist.description ?? "";
        descriptionEdited = false;
      }
      for (const track of page.tracks) {
        const wrapper = element("div", "", { class: "tidal-result" });
        const choice = element("label", "", { class: "tidal-result-choice" });
        const check = element("input", "", { type: "checkbox", "aria-label": `Seleziona ${track.name}` });
        choice.append(check, element("span", `${track.name} · ${track.artist || track.album?.album.artist || "Artista sconosciuto"}`));
        wrapper.append(choice);
        playlistResults.append(wrapper); playlistRows.push({ ...track, check });
      }
    }
    const count = mode === "list" ? page.playlists.length : page.tracks.length;
    playlistStatus.textContent = `${count} ${count === 1 ? "risultato" : "risultati"} · totale ${page.total}.`
      + (mode === "playlist" && !descriptionKnown ? " Descrizione non disponibile: inseriscila prima di salvare le modifiche." : "");
  }
  async function readPlaylistPage(mode, offset, value = null, previous = []) {
    return run(async (guard) => {
      const api = client();
      const target = mode === "playlist" ? qobuzNumericId(value ?? playlistId.value, "playlist")
        : mode === "album" ? qobuzAlbumId(value ?? playlistAlbum.value) : "";
      const page = mode === "list" ? await api.playlists(offset)
        : mode === "playlist" ? await api.playlistTracks(target, offset)
          : await api.albumTracks(target, offset);
      guard(); playlistValue = target; playlistPrevious = previous; showPlaylistPage(page, mode);
    }, playlistStatus);
  }
  const listPlaylists = button(playlistControls, "Elenca le mie playlist", () => void readPlaylistPage("list", 0));
  button(playlistControls, "Leggi playlist · anteprima", () => void readPlaylistPage("playlist", 0));
  button(playlistControls, "Leggi brani dell'album · anteprima", () => void readPlaylistPage("album", 0));
  button(playlistControls, "Pagina precedente", () => {
    if (playlistMode && playlistPrevious.length) void readPlaylistPage(
      playlistMode, playlistPrevious.at(-1), playlistValue, playlistPrevious.slice(0, -1));
  });
  button(playlistControls, "Pagina successiva", () => {
    if (playlistMode && playlistNext !== null) void readPlaylistPage(
      playlistMode, playlistNext, playlistValue, [...playlistPrevious, playlistOffset]);
  });
  const playlistActions = element("div", "", { class: "tidal-actions" });
  button(playlistActions, "Importa album selezionati", () => void run(async (guard) => {
    const selected = playlistRows.filter((row) => row.check.checked && row.album);
    if (!selected.length) throw new Error("Seleziona almeno un brano con album disponibile.");
    const albums = [...new Map(selected.map((row) => [row.album.album.id, row.album])).values()];
    if (!confirm(`Importare ${albums.length} album nella raccolta locale? Nessuna scrittura Qobuz.`)) return;
    let added = 0;
    for (const row of albums) { guard(); if (await addAlbum(row.album, row.coverUrl)) added += 1; }
    playlistStatus.textContent = `${added} album aggiunti localmente.`;
  }, playlistStatus));
  async function playlistWrite(description, prepare, preflight = null) {
    return run(async (guard) => {
      const operation = prepare();
      if (!confirm(`${description}\nInviare una sola volta a Qobuz? Verifica lo stato remoto se l'esito è incerto.`)) return;
      if (!navigator.locks?.request) throw new Error("Questo browser non supporta il blocco sicuro fra schede.");
      let result;
      await navigator.locks.request("accord-qobuz-write-v1", async () => {
        guard();
        if (localStorage.getItem(UNCERTAIN)) throw new Error("Verifica prima su Qobuz l'esito della scrittura precedente.");
        const api = client();
        if (preflight) { await preflight(api); guard(); }
        localStorage.setItem(UNCERTAIN, "1");
        result = await operation(api);
        localStorage.removeItem(UNCERTAIN);
      });
      guard();
      playlistRows = []; loadedPlaylist = null; loadedPlaylistPage = null; playlistListing.replaceChildren(); playlistResults.replaceChildren();
      playlistStatus.textContent = "Modifica Qobuz confermata. Rileggi la playlist prima di altre modifiche.";
      if (result?.id) playlistId.value = String(result.id);
    }, playlistStatus);
  }
  function playlistDetails() {
    const name = playlistName.value.trim(), description = playlistDescription.value;
    if (!name || name.length > 200 || description.length > 500) throw new Error("Inserisci nome e descrizione validi per la playlist Qobuz.");
    return { name, description };
  }
  button(playlistActions, "Crea playlist privata", () => void playlistWrite(`Creare la playlist privata «${playlistName.value.trim()}»?`, () => {
    const { name, description } = playlistDetails();
    return (api) => api.createPlaylist(name, description);
  }));
  button(playlistActions, "Aggiungi brani selezionati", () => {
    const selected = playlistRows.filter((row) => row.check.checked).map((row) => row.id);
    if (!selected.length || selected.length > 100) {
      playlistStatus.textContent = "Seleziona da 1 a 100 brani."; return;
    }
    void playlistWrite(`Aggiungere ${selected.length} brani alla playlist ${playlistId.value.trim()}?`, () => {
      const id = qobuzNumericId(playlistId.value, "playlist");
      return (api) => api.addPlaylistTracks(id, selected);
    });
  });
  const playlistManagement = element("details", "", { class: "tidal-secondary-details" });
  playlistManagement.append(element("summary", "Gestione playlist esistenti"));
  button(playlistManagement, "Salva nome e descrizione", () => void playlistWrite(
    `Modificare la playlist ${playlistId.value.trim()}?\nNome: ${playlistName.value.trim()}\nDescrizione: ${playlistDescription.value || "(vuota)"}`, () => {
    const id = qobuzNumericId(playlistId.value, "playlist"), { name, description } = playlistDetails();
    if (loadedPlaylist !== id) throw new Error("Leggi prima la playlist da modificare.");
    if (!descriptionKnown && !descriptionEdited) throw new Error("La descrizione non è disponibile: inseriscila o modificala prima di salvare.");
    return (api) => api.updatePlaylist(id, name, description);
  }));
  button(playlistManagement, "Elimina playlist", () => void playlistWrite(`Eliminare definitivamente la playlist ${playlistId.value.trim()}?`, () => {
    const id = qobuzNumericId(playlistId.value, "playlist");
    return (api) => api.deletePlaylist(id);
  }));
  button(playlistManagement, "Rimuovi brani selezionati", () => {
    const selected = playlistRows.filter((row) => row.check.checked);
    let id;
    try { id = qobuzNumericId(playlistId.value, "playlist"); } catch (error) {
      playlistStatus.textContent = error.message; return;
    }
    if (!loadedPlaylist || id !== loadedPlaylist || !selected.length || selected.length > 100
        || selected.some((row) => !row.playlistTrackId)
        || new Set(selected.map((row) => row.playlistTrackId)).size !== selected.length) {
      playlistStatus.textContent = "Rileggi la playlist indicata e seleziona da 1 a 100 occorrenze distinte."; return;
    }
    const occurrences = selected.map((row) => row.playlistTrackId);
    void playlistWrite(`Rimuovere ${selected.length} occorrenze dalla playlist ${id}?`, () =>
      (api) => api.removePlaylistTracks(id, occurrences));
  });
  function moveTracks(beginning) {
    const selected = playlistRows.filter((row) => row.check.checked);
    const page = loadedPlaylistPage;
    let id;
    try { id = qobuzNumericId(playlistId.value, "playlist"); } catch (error) {
      playlistStatus.textContent = error.message; return;
    }
    if (!page || loadedPlaylist !== id || page.id !== id || !selected.length || selected.length > 100
        || page.occurrences.some((occurrence) => !occurrence)
        || new Set(page.occurrences).size !== page.occurrences.length
        || !Number.isSafeInteger(page.total) || page.total < page.occurrences.length
        || page.total >= Number.MAX_SAFE_INTEGER) {
      playlistStatus.textContent = "Rileggi la playlist indicata e seleziona da 1 a 100 occorrenze distinte."; return;
    }
    const occurrences = selected.map((row) => row.playlistTrackId);
    const direction = beginning ? "all'inizio" : "in fondo";
    const target = playlistName.value.trim() || "playlist selezionata";
    void playlistWrite(`Spostare ${occurrences.length} occorrenze ${direction} in «${target}»?`,
      () => (api) => api.movePlaylistTracks(id, occurrences, beginning, page.total),
      async (api) => {
        const fresh = await api.playlistTracks(id, page.offset);
        const current = playlistRows.filter((row) => row.check.checked);
        if (loadedPlaylistPage !== page || loadedPlaylist !== id || qobuzNumericId(playlistId.value, "playlist") !== id
            || current.length !== selected.length || selected.some((row) => !current.includes(row))
            || fresh.total !== page.total || fresh.tracks.length !== page.occurrences.length
            || fresh.tracks.some((row, index) => row.playlistTrackId !== page.occurrences[index])) {
          throw new Error("La playlist o la selezione è cambiata: rileggila prima di spostare i brani. Nessuna modifica inviata.");
        }
      });
  }
  button(playlistManagement, "Sposta all'inizio", () => moveTracks(true));
  button(playlistManagement, "Sposta in fondo", () => moveTracks(false));
  button(playlistManagement, "Ho verificato l'esito su Qobuz", () => void run(async (guard) => {
    if (!navigator.locks?.request) throw new Error("Questo browser non supporta il blocco sicuro fra schede.");
    await navigator.locks.request("accord-qobuz-write-v1", async () => {
      guard();
      if (!localStorage.getItem(UNCERTAIN)) { playlistStatus.textContent = "Nessuna scrittura Qobuz incerta."; return; }
      if (confirm("Hai controllato direttamente su Qobuz l'esito dell'ultima modifica incerta?")) {
        localStorage.removeItem(UNCERTAIN);
        playlistStatus.textContent = "Verifica confermata. Rileggi la playlist prima di altre modifiche.";
      }
    });
  }, playlistStatus));
  playlistActions.append(playlistManagement);
  const player = element("section", "", { class: "tidal-panel", "aria-label": "Player Qobuz" });
  player.append(element("h3", "Player Qobuz"),
    element("p", "Riproduci i brani selezionati nell'anteprima. Il player si ferma cambiando servizio.", { class: "summary" }));
  const playerSettings = element("details", "", { class: "tidal-secondary-details" });
  playerSettings.append(element("summary", "Configurazione player Qobuz"),
    element("p", "Richiede un abbonamento Qobuz e un browser compatibile; usa MP3 320 kbps. Nel web player Qobuz apri gli strumenti sviluppatore, scheda Rete, ricarica la pagina e salva il file pubblico bundle.js. Selezionalo qui: viene letto solo su questo dispositivo e non inviato a server. Non caricare file HAR o dati di accesso.", { class: "notice" }));
  const bundleLabel = element("label", "Bundle pubblico Qobuz (bundle.js)");
  const bundleFile = element("input", "", { type: "file", accept: ".js,text/javascript,application/javascript" });
  bundleLabel.append(bundleFile); playerSettings.append(bundleLabel);
  const keyLabel = element("label", "Chiave del bundle");
  const keyChoice = element("select");
  keyLabel.append(keyChoice); playerSettings.append(keyLabel);
  player.append(playerSettings);
  const playerStatus = element("p", "Apri «Configurazione player Qobuz» per iniziare.", { role: "status", "aria-live": "polite", class: "summary" });
  const audio = element("audio", "", { controls: "", preload: "none", referrerpolicy: "no-referrer" });
  const playerQueueDetails = element("details", "", { class: "tidal-secondary-details" });
  playerQueueDetails.append(element("summary", "Prossimi brani"));
  const playerQueueList = element("ol", "", { "aria-label": "Brani preparati per il player Qobuz" });
  playerQueueDetails.append(playerQueueList);
  let secrets = [], secretAppId = "", playerEpoch = 0, playerRequest = null,
    playerQueue = [], playerQueueIndex = -1, shufflePlayerEnabled = false;
  function clearPlayerSource() {
    playerEpoch += 1;
    playerRequest?.abort(); playerRequest = null;
    audio.pause(); audio.removeAttribute("src"); audio.load();
  }
  function renderPlayerQueue() {
    playerQueueList.replaceChildren();
    playerQueue.forEach((track, index) => {
      const marker = index === playerQueueIndex ? "Brano corrente: " : "";
      playerQueueList.append(element("li", `${marker}${track.name} · ${track.artist || "Artista sconosciuto"}`));
    });
    updatePlayerButtons();
  }
  function updatePlayerButtons() {
    const wrap = playerQueue.length > 0 && repeatPlayer.value === "context";
    previousPlayer.disabled = busy || (playerQueueIndex <= 0 && !wrap);
    nextPlayer.disabled = busy || playerQueueIndex < 0 || (playerQueueIndex >= playerQueue.length - 1 && !wrap);
    shufflePlayer.disabled = busy;
  }
  function shuffleRemaining() {
    if (playerQueueIndex < 0) return;
    const prefix = playerQueue.slice(0, playerQueueIndex + 1);
    const rest = playerQueue.slice(playerQueueIndex + 1);
    if (shufflePlayerEnabled) {
      for (let index = rest.length - 1; index > 0; index -= 1) {
        const other = Math.floor(Math.random() * (index + 1));
        [rest[index], rest[other]] = [rest[other], rest[index]];
      }
    } else rest.sort((a, b) => a.queueOrder - b.queueOrder);
    playerQueue = [...prefix, ...rest];
  }
  function stopPlayer() {
    clearPlayerSource();
    playerQueue = []; playerQueueIndex = -1; renderPlayerQueue();
  }
  function resetSessionViews() {
    accountRevision += 1;
    stopPlayer(); secrets = []; secretAppId = ""; keyChoice.replaceChildren();
    rows = []; mode = ""; searchPage = null; offset = 0; next = null; results.replaceChildren();
    suggested = []; suggestionResults.replaceChildren(); suggestionQuery.value = "";
    playlistRows = []; loadedPlaylist = null; loadedPlaylistPage = null; playlistListing.replaceChildren(); playlistResults.replaceChildren();
    playlistMode = ""; playlistNext = null; playlistPrevious = [];
    descriptionKnown = false; descriptionEdited = false;
    for (const field of [playlistId, playlistName, playlistDescription, playlistAlbum]) field.value = "";
    suggestionChoice.textContent = playlistAlbumChoice.textContent = "Nessun album selezionato.";
    playlistChoice.textContent = "Nessuna playlist selezionata.";
    suggestionStatus.textContent = ""; playlistStatus.textContent = "";
    playerStatus.textContent = "Apri «Configurazione player Qobuz» per iniziare.";
  }
  bundleFile.addEventListener("change", () => void run(async (guard) => {
    const file = bundleFile.files?.[0];
    if (!file || file.size > 16 * 1024 * 1024) throw new Error("Seleziona un bundle.js pubblico non superiore a 16 MiB.");
    const auth = JSON.parse(sessionStorage.getItem(SESSION) || "null");
    const app = qobuzCredentials(auth?.appId, auth?.token).appId;
    const source = await file.text();
    guard();
    const found = qobuzBundleSecrets(source, app);
    secrets = found; secretAppId = app; keyChoice.replaceChildren();
    found.forEach((_secret, index) => keyChoice.append(element("option", `Chiave ${index + 1}`, { value: String(index) })));
    keyChoice.value = String(found.length - 1);
    bundleFile.value = "";
    playerSettings.open = false;
    playerStatus.textContent = "Player configurato. Seleziona un brano e avvia la riproduzione.";
  }, playerStatus));
  function playerCredentials() {
    let auth;
    try { auth = JSON.parse(sessionStorage.getItem(SESSION) || "null"); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error("Sessione Qobuz non leggibile: scollega e ricollega.");
    }
    const active = qobuzCredentials(auth?.appId, auth?.token);
    const secret = secrets[Number(keyChoice.value)];
    if (!secret || secretAppId !== active.appId) throw new Error("Carica prima il bundle pubblico corrispondente alla sessione Qobuz.");
    return { active, secret };
  }
  async function playQueuedTrack(target, guard, credentials) {
    clearPlayerSource();
    playerQueueIndex = target;
    renderPlayerQueue();
    const track = playerQueue[target], { active, secret } = credentials;
    const epoch = playerEpoch, request = new AbortController();
    playerRequest = request;
    playerStatus.textContent = "Preparazione del brano Qobuz…";
    try {
      const url = await qobuzStreamUrl({ ...requestOptions, ...active, trackId: track.id, secret, signal: request.signal,
        active: () => epoch === playerEpoch && gate.service === "qobuz" });
      guard();
      if (epoch !== playerEpoch) throw new Error("Riproduzione Qobuz interrotta.");
      playerRequest = null; audio.src = url;
      try { await audio.play(); } catch { throw new Error("Riproduzione non avviata: usa i controlli audio o verifica il formato supportato."); }
      guard();
      if (epoch !== playerEpoch) throw new Error("Riproduzione Qobuz interrotta.");
      playerStatus.textContent = `${track.name} · ${track.artist || "Artista sconosciuto"}`;
    } finally {
      if (epoch === playerEpoch) playerRequest = null;
    }
  }
  function movePlayerQueue(step) {
    if (busy) {
      playerStatus.textContent = "Attendi le altre operazioni, poi riprendi o scegli il brano successivo.";
      return;
    }
    void run(async (guard) => {
      let target = playerQueueIndex + step;
      if (playerQueue.length && (target < 0 || target >= playerQueue.length) && repeatPlayer.value === "context") {
        target = (target + playerQueue.length) % playerQueue.length;
      }
      if (target < 0 || target >= playerQueue.length) throw new Error("Non ci sono altri brani nella selezione.");
      await playQueuedTrack(target, guard, playerCredentials());
    }, playerStatus);
  }
  button(player, "Riproduci selezionati", () => void run(async (guard) => {
    const selected = playlistRows.filter((row) => row.check.checked);
    if (!selected.length) throw new Error("Seleziona almeno un brano nell'anteprima.");
    const credentials = playerCredentials();
    playerQueue = selected.map(({ check, ...track }, queueOrder) => ({ ...track, queueOrder }));
    playerQueueIndex = 0;
    shuffleRemaining();
    await playQueuedTrack(0, guard, credentials);
  }, playerStatus));
  const previousPlayer = button(player, "Precedente", () => movePlayerQueue(-1), false);
  const nextPlayer = button(player, "Successivo", () => movePlayerQueue(1), false);
  const shufflePlayer = button(player, "Casuale", () => {
    if (busy) return;
    shufflePlayerEnabled = !shufflePlayerEnabled;
    shufflePlayer.setAttribute("aria-pressed", String(shufflePlayerEnabled));
    shuffleRemaining(); renderPlayerQueue();
  }, false);
  shufflePlayer.setAttribute("aria-pressed", "false");
  const repeatLabel = element("label", "Ripetizione");
  const repeatPlayer = element("select", "", { "aria-label": "Ripetizione del player Qobuz" });
  for (const [value, label] of [["off", "Ripetizione: no"], ["context", "Ripeti selezione"], ["track", "Ripeti brano"]]) {
    repeatPlayer.append(element("option", label, { value }));
  }
  repeatPlayer.value = "off";
  repeatPlayer.addEventListener("change", updatePlayerButtons);
  repeatLabel.append(repeatPlayer); player.append(repeatLabel); buttons.push(repeatPlayer);
  button(player, "Ferma player", () => { stopPlayer(); playerStatus.textContent = "Player Qobuz fermato."; }, false);
  audio.addEventListener("ended", () => {
    if (playerQueueIndex >= 0 && repeatPlayer.value === "track") movePlayerQueue(0);
    else if (playerQueueIndex >= 0 && (playerQueueIndex + 1 < playerQueue.length || repeatPlayer.value === "context")) movePlayerQueue(1);
    else if (playerQueueIndex >= 0) playerStatus.textContent = "Riproduzione della selezione terminata.";
  });
  audio.addEventListener("error", () => {
    if (audio.src) playerStatus.textContent = "Audio Qobuz non riproducibile: verifica abbonamento, chiave e supporto MP3 del dispositivo.";
  });
  player.append(audio, playerQueueDetails, playerStatus);
  updatePlayerButtons();
  playlists.append(playlistControls, playlistListing, playlistResults, playlistActions, playlistStatus, player);
  document.getElementById("playlistBuilderPanel").append(playlists);
  let wasActive = gate.service === "qobuz";
  function setActive() {
    const active = gate.service === "qobuz";
    section.hidden = suggestions.hidden = playlists.hidden = !active;
    if (!active && wasActive) {
      stopPlayer();
      loadedPlaylist = null; playlistRows = []; playlistListing.replaceChildren(); playlistResults.replaceChildren();
      playlistMode = ""; playlistNext = null; playlistPrevious = [];
      suggested = []; suggestionResults.replaceChildren();
    }
    wasActive = active;
  }
  let editionSelection = null;
  function openCatalog(value = "", selection = null) {
    editionSelection = selection;
    compareEditionsButton.hidden = !selection;
    compareEditionsButton.disabled = true;
    gate.assert("qobuz");
    selectView("collection");
    section.open = true;
    query.value = value;
    query.focus();
  }
  function useAlbum(album, view) {
    gate.assert("qobuz");
    if (busy) return;
    const text = `${album.artist} · ${album.name}`;
    if (view === "suggestions") {
      suggestionQuery.value = album.id;
      suggestionChoice.textContent = `Album selezionato: ${text}`;
    } else {
      playlistAlbum.value = album.id;
      playlistAlbumChoice.textContent = `Album selezionato: ${text}`;
      playlists.open = true;
    }
    selectView(view);
  }
  function openPlaylists() {
    gate.assert("qobuz");
    selectView("playlists");
    playlists.open = true;
    listPlaylists.focus();
  }
  setActive();
  const suggestionAPI = {
    album: async (id) => {
      const epoch = gate.epoch; gate.assert("qobuz", epoch);
      const result = await client().album(id);
      gate.assert("qobuz", epoch);
      return result.album;
    },
    revision: () => accountRevision,
    seed: () => ({ id: suggestionQuery.value, label: suggestionChoice.textContent }),
    search: async (text) => {
      const page = await client().search(text);
      return { rows: page.rows, complete: page.next === null };
    },
    native: async (mode, guard = () => {}) => {
      guard();
      const epoch = gate.epoch; gate.assert("qobuz", epoch);
      if (mode === "album") return { rows: await client().similarAlbums(suggestionQuery.value), complete: true };
      if (mode !== "favorites") throw new Error("Fonte suggerimenti Qobuz non valida.");
      const api = client(), favorites = await api.favorites(); gate.assert("qobuz", epoch);
      const known = new Set(favorites.rows.map((row) => row.album.id)), found = new Map();
      for (const seed of favorites.rows.slice(0, 5)) {
        guard();
        const records = await api.similarAlbums(seed.album.id); gate.assert("qobuz", epoch);
        guard();
        for (const row of records) if (!known.has(row.album.id)) found.set(row.album.id, row);
      }
      if (!favorites.rows.length) throw new Error("Nessun preferito Qobuz nel campione disponibile.");
      return { rows: [...found.values()], complete: favorites.total <= Math.min(5, favorites.rows.length) };
    },
    prepare: async (records) => {
      gate.assert("qobuz"); showSuggestions(records);
      for (const row of suggested) row.check.checked = true;
      await prepareSuggestedPlaylist();
      return suggestionStatus.textContent;
    },
  };
  const playlistAPI = {
    adopt: (tracks) => {
      playlistValue = ""; playlistPrevious = [];
      showPlaylistPage({ tracks, offset: 0, total: tracks.length, next: null }, "prepared");
    },
    revision: () => `${accountRevision}|${sessionStorage.getItem(SESSION)}`,
    identity: () => {
      const value = JSON.parse(sessionStorage.getItem(SESSION) || "null");
      if (!value) throw new Error("Collega Qobuz prima di riprendere.");
      return value;
    },
    batchSize: 100,
    preflight: async () => { gate.assert("qobuz"); client(); },
    albumTracks: (id, offset = 0, beforeRead) => client().albumTracks(id, offset, beforeRead),
    create: (name) => client().createPlaylist(name, "Creata da Accord · nuovi artisti e album verificati"),
    add: (id, tracks) => client().addPlaylistTracks(id, tracks),
    management: openPlaylists,
    prepare: async (records, guard) => {
      const tracks = new Map(); let partial = false;
      if (!records.length || records.length > 10) throw new Error("Seleziona da 1 a 10 album.");
      for (const record of records) {
        guard(); const page = await playlistAPI.albumTracks(record.album.id); guard();
        partial ||= page.next !== null;
        for (const track of page.tracks) if (track.streamable !== false) tracks.set(track.id, track);
      }
      return { tracks: [...tracks.values()].slice(0, 250), partial: partial || tracks.size > 250 };
    },
  };
  for (const [anchor, describe] of [
    [status, () => next !== null ? "Pagina successiva legge la pagina seguente dei risultati conservati."
      : "potrai rilanciare la ricerca o la lettura dei preferiti."],
    [suggestionStatus, () => "potrai rilanciare la ricerca di album o la lettura dei preferiti."],
    [playlistStatus, () => playlistNext !== null ? "Pagina successiva legge la pagina seguente della playlist o dell'album."
      : "potrai rileggere la playlist o l'album; Continua riprende le letture mancanti dell'anteprima."],
  ]) bindPauseNotice(anchor, { storage: localStorage, provider: () => "qobuz", describe });
  return { setActive, openCatalog, openPlaylists, suggestionAPI, playlistAPI, isBusy: () => busy };
}
