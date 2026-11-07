import { initializeCatalogSuggestionsUI } from "./suggestions-ui.mjs";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const gate = { service: "qobuz", epoch: 0, assert(service, epoch = this.epoch) {
  if (service !== this.service || epoch !== this.epoch) throw new Error("Servizio cambiato.");
} };
const saved = [], prepared = [], outcomes = [];
let reads = 0;
let accountRevision = 0, mode = "normal", release = null;
const album = (id = "one", artist = "New artist", name = "Album") => ({
  id: `qobuz:${id}`, name, artist, url: `https://play.qobuz.com/album/${id}`, year: "2000",
  rating: null, status: "neutral", added_at: null, updated_at: null,
});
const api = {
  revision: () => accountRevision,
  seed: () => ({ id: "qobuz:seed", label: "Album di partenza sintetico" }),
  search: async (query) => { reads += 1; return query === "New artist"
    ? [{ album: album() }, { album: album("edition", "New artist", "Album (Deluxe)") }]
    : [{ album: album() }]; },
  native: async () => {
    reads += 1;
    if (mode === "error") throw new Error("Limite remoto sintetico: attendi.");
    if (mode === "late") await new Promise((resolve) => { release = resolve; });
    return { rows: [{ album: album() }, { album: album("two", "Other artist", "Other album") }], complete: true };
  },
  prepare: async (records) => { prepared.push(...records); },
};
const find = (title, parent = document) => [...parent.querySelectorAll("button")]
  .find((button) => button.textContent === title);
const originalPreferences = new Map(["qobuz", "tidal"].flatMap((service) => [
  `accord-${service}-discovery-v2`, `accord-${service}-suggestion-excluded-artists-v1`,
]).concat(["accord-music-suggestion-recipes-v1"]).map((key) => [key, localStorage.getItem(key)]));

async function run() {
  for (const key of originalPreferences.keys()) localStorage.removeItem(key);
  const ui = initializeCatalogSuggestionsUI({
    gate, providers: { qobuz: { suggestionAPI: api, openCatalog() {} }, tidal: { suggestionAPI: api, openCatalog() {} } },
    history: async () => { reads += 1; return { seeds: [{ name: "Seed" }], heard: [], source: "Cronologia sintetica · non account reale" }; },
    similar: async () => { reads += 1; return [{ name: "New artist", match: .8 }]; },
    topAlbums: async () => { reads += 1; return [{ name: "Album" }]; }, genres: async () => { reads += 1; return ["jazz"]; },
    collection: () => saved, addAlbum: (record) => saved.push(record),
    appendActions() {}, notSnoozed: () => true, rateAlbum: async () => "Discogs sintetico",
    spotifyToolChanged() {
      document.querySelector(".spotify-suggestions").hidden = false;
      document.querySelector(".lastfm-suggestions").hidden = true;
    },
  });
  document.getElementById("collectionPanel").hidden = true;
  document.getElementById("suggestionsPanel").hidden = false;
  const tool = document.getElementById("suggestionTool"), output = document.getElementById("spotifySuggestionAlbums");
  const status = document.getElementById("spotifySuggestionStatus");
  await ui.run();
  assert(output.querySelectorAll("article").length === 1, "La cronologia deve generare un album verificato.");
  assert(output.textContent.includes("New artist"), "I metadati devono essere visibili.");
  assert(document.querySelector(".spotify-suggestion-controls").hidden, "I controlli Spotify devono essere nascosti.");
  const readsBeforeRecipe = reads;
  const audit = document.querySelector(".suggestion-decision-list");
  assert(audit?.textContent.includes("Solo decisioni registrate"), "L'audit deve dichiarare la provenienza delle decisioni.");
  const selection = output.querySelector('input[type="checkbox"]');
  selection.checked = true; selection.dispatchEvent(new Event("change"));
  assert(reads === readsBeforeRecipe, "Cambiare selezione non deve avviare letture.");
  const auditSummary = [...document.querySelectorAll(".suggestion-source-picker details summary")]
    .find((summary) => summary.textContent === "Perché un album non compare?");
  assert(auditSummary, "L'audit deve essere accessibile dal pannello dei suggerimenti.");
  auditSummary.click();
  assert(reads === readsBeforeRecipe, "Aprire la spiegazione non deve avviare letture.");
  document.getElementById("musicSuggestionRecipe").value = "preset:metal";
  find("Applica ricetta", document.querySelector(".suggestion-source-picker")).click();
  assert(reads === readsBeforeRecipe, "Applicare una ricetta non deve avviare letture.");
  assert(audit.textContent.includes("Nessuna ricerca corrente"), "Cambiare i criteri deve invalidare le spiegazioni precedenti.");
  assert(document.getElementById("playlistArtistCount").value === "20"
    && document.getElementById("playlistTracksPerArtist").value === "2", "La ricetta deve applicare i criteri playlist.");
  document.getElementById("lastfmSuggestionUser").value = "synthetic-account";
  document.getElementById("musicSuggestionRecipeName").value = "Ricetta sintetica";
  find("Salva criteri", document.querySelector(".suggestion-source-picker")).click();
  const recipe = JSON.parse(localStorage.getItem("accord-music-suggestion-recipes-v1"))[0];
  assert.deepEqual(Object.keys(recipe).sort(), ["criteria", "name"]);
  assert.deepEqual(Object.keys(recipe.criteria).sort(), [
    "artistFilter", "end", "excluded", "excludedMode", "exclusion", "included", "includedMode",
    "period", "playlistArtists", "playlistTracks", "start", "tool",
  ].sort());
  assert(!JSON.stringify(recipe).includes("synthetic-account"), "La ricetta non deve conservare l'account.");
  outcomes.push("Ricette allowlist applicate senza letture; nessun account o risultato salvato");
  outcomes.push("Cronologia → affinità → album verificato; riuso dei risultati Spotify");
  find("New artist", document.querySelector(".catalog-suggestion-artists")).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(output.querySelectorAll("article").length === 2, "L'esplorazione manuale deve mostrare le edizioni separate.");
  assert(status.textContent.includes("campione del catalogo scelto"), "L'esplorazione artista deve indicare la fonte.");
  outcomes.push("Esplorazione artista con edizioni distinte, senza scelta automatica");
  find("Aggiungi alla raccolta", output).click();
  assert(saved.length === 1 && saved[0].id === "qobuz:one", "Il salvataggio deve mantenere l'identità Qobuz.");
  outcomes.push("Aggiunta locale con identità nativa");
  tool.value = "album"; tool.dispatchEvent(new Event("change"));
  await ui.run();
  assert(output.querySelectorAll("article").length === 1, "L'album già noto non deve essere riproposto.");
  const check = output.querySelector('input[type="checkbox"]'); check.checked = true; check.dispatchEvent(new Event("change"));
  find("Prepara playlist dagli album selezionati").click(); await Promise.resolve();
  assert(prepared.length === 1 && prepared[0].album.id === "qobuz:two", "L'anteprima deve usare solo gli album selezionati.");
  outcomes.push("Fonti native; esclusione dei noti; selezione per anteprima playlist");
  find("Escludi artista", output).click();
  assert(output.querySelectorAll("article").length === 0, "L'esclusione dell'artista deve aggiornare i risultati.");
  outcomes.push("Esclusioni applicate e salvate separatamente per servizio");
  mode = "error"; await ui.run();
  assert(status.textContent.includes("Limite remoto sintetico"), "L'errore remoto deve restare visibile.");
  outcomes.push("Errori remoti espliciti, nessuna falsa riuscita");
  mode = "late";
  const pending = ui.run(); await Promise.resolve(); await Promise.resolve();
  accountRevision += 1; release(); await pending;
  assert(status.textContent.includes("Account cambiato"), "Un cambio account deve scartare risposte tardive.");
  outcomes.push("Risposte tardive scartate dopo il cambio account");
  gate.service = "spotify"; gate.epoch += 1; ui.configure();
  assert(!document.querySelector(".spotify-suggestion-controls").hidden, "Ritorno a Spotify: controlli ripristinati.");
  assert(document.getElementById("spotifySuggestionHeading").textContent.includes("Spotify"), "Titolo Spotify ripristinato.");
  outcomes.push("Ritorno a Spotify senza controlli o testi del provider precedente");
  gate.service = "tidal"; gate.epoch += 1; ui.configure();
  assert([...tool.options].some((option) => option.value === "discovery"), "TIDAL deve esporre i mix.");
  assert(![...tool.options].some((option) => option.value === "spotify"), "TIDAL non deve instradare verso Spotify.");
  outcomes.push("Selettore condiviso e fonti specifiche TIDAL");
  mode = "normal"; tool.value = "album"; tool.dispatchEvent(new Event("change")); await ui.run();
  const report = document.createElement("pre"); report.id = "browserTestReport";
  report.textContent = outcomes.map((text) => `PASS ${text}`).join("\n");
  document.getElementById("suggestionsPanel").prepend(report);
  return outcomes;
}

window.suggestionsBrowserTests = run().then((results) => ({ passed: results.length, results })).catch((error) => {
  const report = document.createElement("pre"); report.id = "browserTestReport"; report.textContent = `FAIL ${error.stack}`;
  document.body.prepend(report); return { error: error.message, passed: outcomes.length };
}).finally(() => {
  for (const [key, value] of originalPreferences) {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  }
});
