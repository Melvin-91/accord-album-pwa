import { CatalogSuggestions, normalized } from "./catalog-suggestions.mjs?v=4";
import { configureMusicAppLink } from "./music-app-links.mjs?v=1";
import { bindPauseNotice, clearCheckpoint } from "./music-continuity.mjs?v=6";
import { createAlbumComparisonToolbar } from "./music-qol.mjs?v=3";
import { validateSuggestionCriteria, validateSuggestionRecipes } from "./music-suggestion-recipes.mjs?v=1";

const node = (tag, text = "") => {
  const result = document.createElement(tag); result.textContent = text; return result;
};
const field = (parent, title, tag = "input", choices = []) => {
  const label = node("label", title), input = node(tag);
  for (const [value, text] of choices) { const option = node("option", text); option.value = value; input.append(option); }
  label.append(input); parent.append(label); return input;
};
const action = (parent, title, callback) => {
  const button = node("button", title); button.type = "button"; button.className = "secondary";
  button.addEventListener("click", callback); parent.append(button); return button;
};

export function initializeCatalogSuggestionsUI({
  gate, providers, history, similar, topAlbums, genres, collection, addAlbum,
  appendActions, notSnoozed, rateAlbum, spotifyToolChanged,
}) {
  const root = document.querySelector("#suggestionsPanel > .suggestions");
  const tool = document.getElementById("suggestionTool"), output = document.getElementById("spotifySuggestionAlbums");
  const status = document.getElementById("spotifySuggestionStatus");
  bindPauseNotice(status, { storage: localStorage, provider: () => gate.service,
    describe: () => "potrai usare Continua ricerca, quando disponibile, oppure avviare una nuova ricerca." });
  const picker = document.querySelector(".suggestion-source-picker");
  const spotifyChildren = new Map([...document.querySelector(".spotify-suggestions").children].map((child) => [child, child.hidden]));
  const spotifyHeading = document.getElementById("spotifySuggestionHeading").textContent;
  const settings = node("details"); settings.className = "suggestion-filter-details catalog-suggestion-settings";
  settings.append(node("summary", "Impostazioni e filtri"));
  const controls = node("div"); controls.className = "lastfm-suggestion-controls";
  const user = field(controls, "Nome utente Last.fm");
  user.maxLength = 64;
  const period = field(controls, "Periodo di ascolto", "select",
    [["7", "Ultimi 7 giorni"], ["30", "Ultimi 30 giorni"], ["90", "Ultimi 90 giorni"],
      ["365", "Ultimi 365 giorni"], ["all", "Tutto lo storico"], ["custom", "Intervallo personalizzato"]]);
  const start = field(controls, "Dal"); start.type = "date";
  const end = field(controls, "Al"); end.type = "date";
  const exclusion = field(controls, "Escludi artisti ascoltati", "select",
    [["all", "Tutto lo storico disponibile"], ["30", "Ultimi 30 giorni"], ["90", "Ultimi 90 giorni"],
      ["365", "Ultimi 365 giorni"], ["none", "Nessuna esclusione aggiuntiva"]]);
  const artistFilter = field(controls, "Artisti da escludere (separati da ;)");
  const included = field(controls, "Generi album da includere (separati da ;)");
  const includedMode = field(controls, "Modalità generi inclusi", "select",
    [["contains", "Contiene il testo"], ["exact", "Genere esatto"]]);
  const excluded = field(controls, "Generi album da escludere (separati da ;)");
  const excludedMode = field(controls, "Modalità generi esclusi", "select",
    [["exact", "Genere esatto"], ["contains", "Contiene il testo"]]);
  settings.append(controls, node("p",
    "I tag album provengono da Last.fm, non sono una classificazione del servizio scelto. "
    + "Se applichi filtri genere, i risultati senza tag verificabili sono scartati."));
  picker.append(settings);
  const seedLabel = node("p", "Nessun album selezionato."); picker.append(seedLabel);
  const choose = action(picker, "Scegli un album…", () => providers[gate.service].openCatalog());
  const continuation = action(picker, "Continua ricerca", () => void run(true));
  const prepare = action(picker, "Prepara playlist dagli album selezionati", () => void preparePlaylist());
  const details = node("details"); details.className = "suggestion-filter-details catalog-suggestion-settings";
  details.append(node("summary", "Dettagli ricerca"));
  const detail = node("p"); details.append(detail); picker.append(details);
  const decisionDetails = node("details"); decisionDetails.className = "suggestion-filter-details";
  decisionDetails.append(node("summary", "Perché un album non compare?"));
  const decisionList = node("div"); decisionList.className = "suggestion-decision-list";
  decisionDetails.append(decisionList); picker.append(decisionDetails);
  const artists = node("div"); artists.className = "qol-actions catalog-suggestion-artists";
  artists.setAttribute("aria-label", "Artisti consigliati");
  output.before(artists);
  const historySelect = field(picker, "Risultati precedenti del servizio", "select");
  const recipes = node("details"); recipes.className = "suggestion-filter-details";
  recipes.append(node("summary", "Ricette per suggerimenti e playlist"));
  const recipeSelect = field(recipes, "Ricetta", "select");
  recipeSelect.id = "musicSuggestionRecipe";
  const recipeName = field(recipes, "Nome ricetta");
  recipeName.id = "musicSuggestionRecipeName";
  recipeName.maxLength = 60;
  const saveRecipe = action(recipes, "Salva criteri", () => saveCurrentRecipe());
  const applyRecipe = action(recipes, "Applica ricetta", () => applySelectedRecipe());
  const deleteRecipe = action(recipes, "Elimina ricetta", () => deleteSelectedRecipe());
  recipes.append(node("p", "Si salvano solo fonte e criteri consentiti; nome utente, account, token e risultati restano esclusi. Applicare aggiorna i campi e invalida l’anteprima senza avviare letture o scritture."));
  picker.append(recipes);
  const spotifyCriteria = ["spotifySuggestionPeriod", "spotifySuggestionExclusion", "spotifyExcludeArtists",
    "spotifyIncludeGenres", "spotifyExcludeGenres", "spotifyIncludeGenresMatch", "spotifyExcludeGenresMatch"]
    .map((id) => document.getElementById(id));
  const playlistArtists = document.getElementById("playlistArtistCount");
  const playlistTracks = document.getElementById("playlistTracksPerArtist");
  const recipesKey = "accord-music-suggestion-recipes-v1";
  let service = "spotify", search = null, result = null, busy = false, revision = 0;
  let comparison = null;
  let applyingRecipe = false;
  let selected = new Set(), excludedAlbums = new Set(), savedHistory = [], spotifyChoice = tool.value, searchAccount = null;
  const values = () => ({
    tool: tool.value, user: user.value.trim(), period: period.value, start: start.value, end: end.value, exclusion: exclusion.value,
    artistFilter: artistFilter.value, included: included.value, excluded: excluded.value,
    includedMode: includedMode.value, excludedMode: excludedMode.value,
  });
  const split = (value) => [...new Set(value.split(";").map((name) => name.trim()).filter(Boolean))];
  const preferencesKey = () => `accord-${service}-discovery-v2`;
  function persist() {
    localStorage.setItem(preferencesKey(), JSON.stringify({
      ...values(), excludedAlbums: [...excludedAlbums], history: savedHistory.slice(0, 5),
    }));
    localStorage.setItem(`accord-${service}-suggestion-excluded-artists-v1`, artistFilter.value);
  }
  function reset() {
    search = null; revision += 1; continuation.hidden = true;
    renderDecisionAudit(null);
  }
  function invalidateCriteria() {
    reset(); result = null; selected.clear(); comparison?.destroy(); comparison = null;
    output.replaceChildren(); artists.replaceChildren(); detail.textContent = "";
    clearCheckpoint(localStorage, gate.service);
    window.dispatchEvent(new CustomEvent("accord:discovery-criteria-changed"));
  }
  function recipeCriteria() {
    const spotify = service === "spotify";
    const customPeriod = !spotify && period.value === "custom";
    return validateSuggestionCriteria({
      tool: tool.value,
      period: spotify ? spotifyCriteria[0].value : period.value,
      start: customPeriod ? start.value : "",
      end: customPeriod ? end.value : "",
      exclusion: spotify ? spotifyCriteria[1].value : exclusion.value,
      artistFilter: spotify ? spotifyCriteria[2].value : artistFilter.value,
      included: spotify ? spotifyCriteria[3].value : included.value,
      excluded: spotify ? spotifyCriteria[4].value : excluded.value,
      includedMode: spotify ? spotifyCriteria[5].value : includedMode.value,
      excludedMode: spotify ? spotifyCriteria[6].value : excludedMode.value,
      playlistArtists: Number(playlistArtists.value),
      playlistTracks: Number(playlistTracks.value),
    });
  }
  function savedRecipes() {
    return validateSuggestionRecipes(JSON.parse(localStorage.getItem(recipesKey) || "[]"));
  }
  function refreshRecipes(selected = "") {
    recipeSelect.replaceChildren(node("option", "Scegli una ricetta…"));
    recipeSelect.options[0].value = "";
    const local = service !== "spotify";
    const presets = [
      ["preset:metal", "Scoperte metal · 20 artisti · 2 brani", {
        tool: local ? "history" : "lastfm", period: local ? "30" : "medium_term", start: "", end: "",
        exclusion: local ? "all" : "medium_term", artistFilter: "", included: "metal", excluded: "",
        includedMode: "contains", excludedMode: "exact", playlistArtists: 20, playlistTracks: 2 }],
      ["preset:recent", "Album recenti da provare", {
        tool: local ? "history" : "lastfm", period: local ? "7" : "short_term", start: "", end: "",
        exclusion: "none", artistFilter: "", included: "", excluded: "",
        includedMode: "contains", excludedMode: "exact", playlistArtists: 5, playlistTracks: 3 }],
    ];
    for (const [value, label, criteria] of presets) {
      const option = node("option", label); option.value = value; option.dataset.criteria = JSON.stringify(criteria);
      recipeSelect.append(option);
    }
    for (const [index, recipe] of savedRecipes().entries()) {
      const option = node("option", recipe.name); option.value = `saved:${index}`;
      option.dataset.criteria = JSON.stringify(recipe.criteria); recipeSelect.append(option);
    }
    recipeSelect.value = selected;
    deleteRecipe.disabled = !selected.startsWith("saved:");
  }
  function saveCurrentRecipe() {
    try {
      const value = validateSuggestionRecipes([...savedRecipes(), { name: recipeName.value, criteria: recipeCriteria() }]);
      localStorage.setItem(recipesKey, JSON.stringify(value));
      refreshRecipes(`saved:${value.length - 1}`);
      status.textContent = "Ricetta locale salvata; nessun account o risultato incluso.";
    } catch (error) { status.textContent = `Ricetta non salvata: ${error.message}`; }
  }
  function deleteSelectedRecipe() {
    try {
      const index = Number(recipeSelect.value.slice("saved:".length));
      if (!recipeSelect.value.startsWith("saved:") || !Number.isInteger(index)) throw new Error("Scegli una ricetta salvata.");
      const value = savedRecipes();
      if (index < 0 || index >= value.length) throw new Error("Ricetta non più disponibile.");
      value.splice(index, 1); localStorage.setItem(recipesKey, JSON.stringify(value));
      refreshRecipes(); status.textContent = "Ricetta locale eliminata.";
    } catch (error) { status.textContent = `Ricetta non eliminata: ${error.message}`; }
  }
  function applySelectedRecipe() {
    const option = recipeSelect.selectedOptions[0];
    if (!option?.dataset.criteria) { status.textContent = "Scegli una ricetta da applicare."; return; }
    try {
      const criteria = validateSuggestionCriteria(JSON.parse(option.dataset.criteria));
      if (![...tool.options].some((entry) => entry.value === criteria.tool)) {
        throw new Error("La fonte della ricetta non è disponibile per il servizio selezionato.");
      }
      const spotify = service === "spotify";
      if (spotify) {
        for (const [input, value] of spotifyCriteria.map((input, index) => [input, [
          criteria.period, criteria.exclusion, criteria.artistFilter, criteria.included, criteria.excluded,
          criteria.includedMode, criteria.excludedMode,
        ][index]])) input.value = value;
      } else {
        for (const [input, value] of [[period, criteria.period], [start, criteria.start], [end, criteria.end],
          [exclusion, criteria.exclusion], [artistFilter, criteria.artistFilter], [included, criteria.included],
          [excluded, criteria.excluded], [includedMode, criteria.includedMode], [excludedMode, criteria.excludedMode]]) {
          input.value = value;
        }
      }
      tool.value = criteria.tool;
      playlistArtists.value = String(criteria.playlistArtists);
      playlistTracks.value = String(criteria.playlistTracks);
      applyingRecipe = true;
      for (const input of [...spotifyCriteria, user, period, start, end, exclusion, artistFilter,
        included, excluded, includedMode, excludedMode, tool, playlistArtists, playlistTracks]) {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      applyingRecipe = false;
      updateFields(); persist(); invalidateCriteria();
      status.textContent = "Ricetta applicata. Nessuna lettura, anteprima o scrittura avviata.";
    } catch (error) {
      applyingRecipe = false;
      status.textContent = `Ricetta non applicata: ${error.message}`;
    }
  }
  settings.addEventListener("change", () => {
    if (applyingRecipe) return;
    try { persist(); status.textContent = "Impostazioni salvate. Avvia una nuova ricerca."; }
    catch (error) { status.textContent = `Impostazioni non salvate: ${error.message}`; }
    invalidateCriteria();
    updateFields();
  });
  function updateFields() {
    const isHistory = tool.value === "history";
    for (const input of [user, period, exclusion]) input.parentElement.hidden = !isHistory;
    for (const input of [start, end]) input.parentElement.hidden = !isHistory || period.value !== "custom";
    seedLabel.hidden = choose.hidden = tool.value !== "album";
    seedLabel.textContent = providers[service]?.suggestionAPI.seed().label || "Nessun album selezionato.";
  }
  function filterResult() {
    if (!result) return [];
    const blocked = new Set(split(artistFilter.value).map(normalized));
    return result.albums.filter((row) => !excludedAlbums.has(row.album.id)
      && !blocked.has(normalized(row.album.artist)) && notSnoozed(row.album));
  }
  function render() {
    comparison?.destroy();
    comparison = createAlbumComparisonToolbar(output, collection, status, "Suggerimenti");
    output.replaceChildren(); artists.replaceChildren(); selected.clear();
    const records = filterResult();
    for (const row of records) {
      const { album } = row, card = node("article"); card.className = "suggestion-album";
      appendActions(card, { ...album, reason: row.reason, source: row.source }, render);
      const cover = node("span"); cover.className = "suggestion-cover-frame";
      if (row.coverUrl) {
        const image = node("img"); image.src = row.coverUrl; image.alt = ""; image.loading = "lazy";
        image.referrerPolicy = "no-referrer"; image.className = "suggestion-cover";
        image.addEventListener("load", () => cover.classList.add("has-cover")); cover.append(image);
      }
      const placeholder = node("span", service.toUpperCase()); placeholder.className = "suggestion-cover-placeholder";
      cover.append(placeholder);
      const info = node("p"), title = node("strong", album.name);
      const meta = node("span", ` · ${album.artist} · ${album.year || "Anno sconosciuto"}`);
      meta.className = "suggestion-detail";
      const tags = node("span", `Generi album Last.fm: ${(row.genres || []).join(", ") || "non disponibili"}`);
      tags.className = "suggestion-detail suggestion-genres";
      info.append(title, meta, tags);
      const label = node("label", "Seleziona per playlist"), check = node("input"); check.type = "checkbox";
      label.className = "check";
      check.addEventListener("change", () => { check.checked ? selected.add(album.id) : selected.delete(album.id); });
      label.prepend(check); card.append(cover, info, label);
      comparison.append(card, { ...album, genres: row.genres, source: row.source, reason: row.reason });
      const inCollection = collection().some((entry) => entry.id === album.id);
      const add = action(card, inCollection ? "Già in raccolta" : "Aggiungi alla raccolta", () => {
        try { addAlbum(album, row.coverUrl); render(); }
        catch (error) { status.textContent = `Album non salvato: ${error.message}`; }
      });
      add.disabled = inCollection;
      const link = node("a", `Apri in ${service === "tidal" ? "TIDAL" : "Qobuz"} ↗`);
      configureMusicAppLink(link, album.url, {
        query: `${album.artist} ${album.name}`, report: (message) => { status.textContent = message; },
      });
      card.append(link);
      const more = node("details"); more.append(node("summary", "Altre azioni"));
      const moreActions = node("div"); moreActions.className = "qol-actions"; more.append(moreActions); card.append(more);
      action(moreActions, "Escludi album", () => {
        try { excludedAlbums.add(album.id); persist(); render(); reset(); }
        catch (error) { status.textContent = `Esclusione non salvata: ${error.message}`; }
      });
      action(moreActions, "Escludi artista", () => {
        try {
          artistFilter.value = [...new Set([...split(artistFilter.value), album.artist])].join("; ");
          persist(); render(); reset();
        } catch (error) { status.textContent = `Esclusione non salvata: ${error.message}`; }
      });
      action(moreActions, "Voti esterni", async (event) => {
        const button = event.currentTarget, epoch = gate.epoch;
        button.disabled = true;
        try {
          const currentService = service;
          const value = await rateAlbum(album); gate.assert(currentService, epoch);
          const note = node("span", value); note.className = "suggestion-detail"; info.append(note);
        } catch (error) { status.textContent = `Voti non letti: ${error.message}`; }
        finally { button.disabled = false; }
      });
      output.append(card);
    }
    const names = new Set((result?.artists?.length ? result.artists.map((artist) => artist.name) : records.map((row) => row.album.artist)));
    for (const name of names) action(artists, name, () => void browseArtist(name));
    if (!records.length) output.append(node("p", "Nessun album verificato nel campione con i filtri scelti."));
    prepare.disabled = !records.length;
    renderDecisionAudit(result);
  }
  function renderDecisionAudit(current) {
    decisionList.replaceChildren();
    if (!current) {
      decisionList.append(node("p", "Nessuna ricerca corrente. Gli album non elencati non sono stati esaminati."));
      return;
    }
    for (const decision of current.decisions || []) {
      const row = node("p");
      row.textContent = `${[decision.artist, decision.name].filter(Boolean).join(" · ") || "Album non identificato"} — ${decision.reason}`;
      decisionList.append(row);
    }
    if (current.unexamined?.length) {
      const heading = node("p", current.budgetLimited
        ? "Limite del passaggio raggiunto: questi candidati non sono ancora esaminati."
        : "Questi candidati non sono ancora esaminati.");
      decisionList.append(heading);
      for (const album of current.unexamined) {
        decisionList.append(node("p", `${[album.artist, album.name].filter(Boolean).join(" · ") || "Album non identificato"} — Non ancora esaminato`));
      }
    }
    if (!(current.decisions || []).length && !current.unexamined?.length) {
      decisionList.append(node("p", "Nessuna esclusione registrata. L’assenza dal campione non prova che l’album non esista."));
    }
    decisionList.prepend(node("p", "Solo decisioni registrate durante la ricerca corrente; nessuna lettura aggiuntiva."));
  }
  action(settings, "Ripristina album esclusi", () => {
    try { excludedAlbums.clear(); persist(); reset(); render(); }
    catch (error) { status.textContent = `Ripristino non salvato: ${error.message}`; }
  });
  function refreshHistory() {
    historySelect.replaceChildren();
    for (const [index, title] of [["", "Scegli risultato locale"], ...savedHistory.map((entry, index) =>
      [String(index), `${entry.at} · ${entry.result.albums.length} album`])]) {
      const option = node("option", title); option.value = index; historySelect.append(option);
    }
  }
  historySelect.addEventListener("change", () => {
    if (historySelect.value === "") return;
    result = savedHistory[Number(historySelect.value)]?.result || null;
    reset(); render(); status.textContent = "Risultati locali ripristinati; nessuna richiesta online.";
  });
  async function run(continuing = false) {
    if (busy || gate.service === "spotify") return;
    const currentService = gate.service, epoch = gate.epoch, currentRevision = revision;
    const api = providers[currentService].suggestionAPI, account = api.revision();
    const guard = () => {
      gate.assert(currentService, epoch);
      if (api.revision() !== account) throw new Error("Account cambiato: risultati scartati.");
      if (currentRevision !== revision) throw new Error("Impostazioni cambiate: risultati scartati.");
    };
    busy = true;
    const searchButton = document.getElementById("suggestionSearchButton");
    for (const input of [searchButton, tool, continuation]) input.disabled = true;
    status.textContent = "Preparo i suggerimenti nel catalogo scelto…";
    try {
      persist();
      if (continuing && account !== searchAccount) { reset(); throw new Error("Account cambiato: avvia una nuova ricerca."); }
      if (!continuing) {
        const filters = { excludedArtists: split(artistFilter.value), includedGenres: split(included.value),
          excludedGenres: split(excluded.value), includedGenresMatch: includedMode.value, excludedGenresMatch: excludedMode.value };
        let seeds = [], albums = [], heard = [], source = "";
        if (tool.value === "history") {
          const input = await history(values(), guard); guard();
          seeds = input.seeds; heard = [...input.heard, ...seeds.map((seed) => seed.name)]; source = input.source;
          if (!seeds.length) throw new Error("Nessuna cronologia utile disponibile nel periodo scelto.");
        } else {
          const page = await api.native(tool.value, guard); guard(); albums = page.rows;
          source = `${tool.options[tool.selectedIndex].textContent} · ${page.complete ? "campione restituito" : "risultati parziali"}`;
        }
        search = new CatalogSuggestions({ seeds, albums, heard, filters, known: collection(),
          excludedIds: [...excludedAlbums, ...(tool.value === "album" ? [api.seed().id] : [])], source, allowed: notSnoozed });
        searchAccount = account;
      }
      if (!search) throw new Error("Avvia una nuova ricerca.");
      const currentSearch = search;
      result = await currentSearch.step({ similar, topAlbums, genres, search: api.search, guard }); guard();
      render();
      status.textContent = `${result.albums.length}/10 album${result.uniqueArtists ? " di artisti diversi" : ""} · `
        + (result.canContinue ? "Puoi continuare." : "Campione esaurito o obiettivo raggiunto.");
      detail.textContent = `${result.source}. Letture logiche: ${result.stepReads}/20 nel passaggio; `
        + `${result.reads} totali, oltre alla preparazione della fonte (cronologia o fino a 6 letture native). `
        + `Noti/duplicati: ${result.stats.known}; generi scartati: ${result.stats.filtered}; `
        + `ambigui: ${result.stats.ambiguous}; non trovati nel campione: ${result.stats.unmatched}. `
        + `Ricerche catalogo incomplete, non abbinate: ${result.stats.partial}. `
        + (result.limited ? "Limite di 10 riferimenti o 30 artisti raggiunto. " : "")
        + "I tag Last.fm non sono voti. Ogni lettura può richiedere più pagine entro i limiti del client.";
      continuation.hidden = !result.canContinue;
      savedHistory.unshift({ at: new Date().toLocaleString(), result }); savedHistory = savedHistory.slice(0, 5);
      persist(); refreshHistory();
    } catch (error) {
      if (gate.service === currentService && epoch === gate.epoch) status.textContent = `Ricerca non completata: ${error.message}`;
    } finally {
      busy = false;
      if (gate.service === currentService && epoch === gate.epoch && currentRevision === revision) continuation.hidden = !search?.canContinue;
      for (const input of [searchButton, tool, continuation]) input.disabled = false;
    }
  }
  async function preparePlaylist() {
    if (busy || gate.service === "spotify") return;
    const records = filterResult().filter((row) => selected.has(row.album.id));
    if (!records.length) { status.textContent = "Seleziona da 1 a 10 album per la playlist."; return; }
    try {
      const message = await providers[service].suggestionAPI.prepare(records);
      if (message) status.textContent = message;
    } catch (error) { status.textContent = `Anteprima non preparata: ${error.message}`; }
  }
  async function browseArtist(name) {
    if (busy || gate.service === "spotify") return;
    const currentService = gate.service, epoch = gate.epoch, api = providers[currentService].suggestionAPI;
    const account = api.revision(), currentRevision = revision;
    const guard = () => {
      gate.assert(currentService, epoch);
      if (account !== api.revision()) throw new Error("Account cambiato: risultati scartati.");
      if (currentRevision !== revision) throw new Error("Impostazioni cambiate: risultati scartati.");
    };
    busy = true;
    try {
      const page = await api.search(name); guard();
      const rows = Array.isArray(page) ? page : page.rows;
      const state = new CatalogSuggestions({
        albums: rows.filter((row) => normalized(row.album.artist) === normalized(name)),
        known: collection(), excludedIds: [...excludedAlbums], allowed: notSnoozed, uniqueArtists: false,
        filters: { excludedArtists: split(artistFilter.value), includedGenres: split(included.value),
          excludedGenres: split(excluded.value), includedGenresMatch: includedMode.value, excludedGenresMatch: excludedMode.value },
        source: `Catalogo ${currentService.toUpperCase()} · ${name}${page.complete === false ? " · prima pagina, risultati parziali" : ""}`,
      });
      state.artists = result?.artists || [];
      result = await state.step({ similar, topAlbums, genres, search: api.search, guard }); guard();
      search = state; searchAccount = account;
      render();
      continuation.hidden = !state.canContinue;
      status.textContent = `${result.albums.length} album · ${name} · campione del catalogo scelto`;
      detail.textContent = `${result.source}. Edizioni mostrate separatamente: scegli quella desiderata. `
        + `${result.stepReads}/20 letture logiche di verifica, oltre alla ricerca.`;
    } catch (error) {
      if (gate.service === currentService && epoch === gate.epoch) status.textContent = `Album non caricati: ${error.message}`;
    } finally { busy = false; }
  }
  function configure() {
    const current = gate.service, local = current !== "spotify";
    if (current !== service) {
      if (service === "spotify") spotifyChoice = tool.value;
      service = current; reset(); result = null; output.replaceChildren(); artists.replaceChildren(); detail.textContent = "";
      if (local) {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(preferencesKey()) || "{}"); }
        catch (error) { status.textContent = `Preferenze non leggibili: ${error.message}`; }
        for (const [key, input] of Object.entries({ user, period, start, end, exclusion,
          artistFilter, included, excluded, includedMode, excludedMode })) {
          input.value = saved[key] ?? ({ user: localStorage.getItem("accord-lastfm-suggestion-user") || "",
            period: "30", exclusion: "all", includedMode: "contains", excludedMode: "exact" }[key] || "");
        }
        if (saved.artistFilter === undefined) artistFilter.value = localStorage.getItem(
          `accord-${current}-suggestion-excluded-artists-v1`) || "";
        excludedAlbums = new Set(saved.excludedAlbums || []); savedHistory = saved.history || [];
        tool.replaceChildren();
        for (const [value, text] of [["history", "Cronologia disponibile + Last.fm"],
          ["album", `Album simili · ${current === "tidal" ? "TIDAL" : "Qobuz"}`], ["favorites", "Preferiti"],
          ...(current === "tidal" ? [["discovery", "Mix scoperta TIDAL"], ["daily", "Mix giornalieri TIDAL"], ["new", "Nuove uscite TIDAL"]] : [])]) {
          const option = node("option", text); option.value = value; tool.append(option);
        }
        tool.value = [...tool.options].some((option) => option.value === saved.tool) ? saved.tool : "history";
        refreshHistory();
      } else {
        for (const [child, hidden] of spotifyChildren) child.hidden = hidden;
        document.getElementById("spotifySuggestionHeading").textContent = spotifyHeading;
        tool.replaceChildren();
        for (const value of ["spotify", "lastfm"]) { const option = node("option", value === "spotify" ? "Spotify" : "Last.fm"); option.value = value; tool.append(option); }
        tool.value = spotifyChoice; spotifyToolChanged();
      }
    }
    for (const item of [settings, seedLabel, choose, continuation, prepare, details, decisionDetails,
      artists, historySelect.parentElement]) item.hidden = !local;
    document.getElementById("suggestionHistory").parentElement.hidden = local;
    document.getElementById("clearSuggestionHistory").hidden = local;
    try { refreshRecipes(); }
    catch (error) { status.textContent = `Ricette non leggibili: ${error.message}`; }
    if (!local) return;
    root.hidden = false;
    for (const child of document.getElementById("suggestionsPanel").children) {
      if (child.dataset.tidalPanel || child.dataset.qobuzPanel) child.hidden = true;
    }
    document.querySelector(".spotify-suggestions").hidden = false;
    document.querySelector(".lastfm-suggestions").hidden = true;
    for (const child of document.querySelector(".spotify-suggestions").children) {
      child.hidden = ![output, status, artists].includes(child) && child.id !== "spotifySuggestionHeading";
    }
    document.getElementById("spotifySuggestionHeading").textContent = "Album";
    document.getElementById("suggestionToolHelp").textContent =
      "Cronologia e affinità Last.fm, album verificati nel servizio scelto; nessuna classifica personale simulata.";
    continuation.hidden = !search?.canContinue;
    updateFields();
  }
  tool.addEventListener("change", () => {
    if (applyingRecipe) return;
    if (gate.service !== "spotify") updateFields();
    invalidateCriteria();
  });
  document.querySelector(".spotify-suggestions").addEventListener("change", (event) => {
    if (!applyingRecipe && gate.service === "spotify" && spotifyCriteria.includes(event.target)) invalidateCriteria();
  });
  for (const input of [playlistArtists, playlistTracks]) input.addEventListener("change", () => {
    if (!applyingRecipe) window.dispatchEvent(new CustomEvent("accord:discovery-criteria-changed"));
  });
  document.querySelector(".view-tabs").addEventListener("click", () => { if (gate.service !== "spotify") updateFields(); });
  configure();
  async function playlistSource(target, guard, excludedReferences = []) {
    const snapshot = JSON.stringify(values()), currentRevision = revision;
    const check = () => {
      guard();
      if (snapshot !== JSON.stringify(values()) || currentRevision !== revision) {
        throw new Error("Impostazioni dei suggerimenti cambiate: genera una nuova anteprima.");
      }
    };
    const input = await history(values(), check); check();
    const blocked = new Set(excludedReferences.map(normalized));
    const seeds = input.seeds.filter((row) => !blocked.has(normalized(row.name)));
    if (!seeds.length) throw new Error("Nessuna cronologia utile nel periodo scelto.");
    const discovery = new CatalogSuggestions({ seeds, heard: [...input.heard, ...input.seeds.map((row) => row.name)],
      filters: { excludedArtists: split(artistFilter.value), includedGenres: split(included.value),
        excludedGenres: split(excluded.value), includedGenresMatch: includedMode.value, excludedGenresMatch: excludedMode.value },
      known: collection(), excludedIds: [...excludedAlbums], allowed: notSnoozed, source: input.source, target });
    const api = providers[gate.service].suggestionAPI;
    return { discovery, references: input.seeds, guard: check,
      discover: () => discovery.step({ similar, topAlbums, genres, search: api.search, guard: check }) };
  }
  function restorePlaylistSource(saved, guard) {
    const snapshot = JSON.stringify(values()), currentRevision = revision;
    const check = () => {
      guard();
      if (snapshot !== JSON.stringify(values()) || currentRevision !== revision) throw new Error("Criteri cambiati.");
    };
    const discovery = CatalogSuggestions.restore(saved, notSnoozed);
    const api = providers[gate.service].suggestionAPI;
    return { discovery, guard: check,
      discover: () => discovery.step({ similar, topAlbums, genres, search: api.search, guard: check }) };
  }
  const playlistControls = { period, start, end, exclusion, artistFilter, included, excluded, includedMode, excludedMode };
  function restorePlaylistParameters(saved) {
    for (const [key, input] of Object.entries(playlistControls)) {
      if (typeof saved.settings?.[key] !== "string") throw new Error("Parametri conservati non validi.");
      input.value = saved.settings[key];
    }
    if (!Array.isArray(saved.excludedAlbums)) throw new Error("Esclusioni conservate non valide.");
    excludedAlbums = new Set(saved.excludedAlbums);
    persist(); reset();
  }
  return { configure, run, playlistSource, restorePlaylistSource, isBusy: () => busy,
    playlistParameters: () => ({ settings: Object.fromEntries(Object.entries(playlistControls).map(([key, input]) => [key, input.value])),
      excludedAlbums: [...excludedAlbums] }),
    restorePlaylistParameters,
    playlistDurableSignature: () => JSON.stringify([values(), [...excludedAlbums], collection()]),
    playlistSignature: () => JSON.stringify([values(), revision, [...excludedAlbums]]) };
}
