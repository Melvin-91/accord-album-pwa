import { reconcileAlbumCards, validateAlbum } from "./core.mjs?v=52";
import { createCollectionStore, createCollectionCoverCache } from "./collection-store.mjs?v=3";
import { createCollectionSync } from "./collection-sync.mjs?v=3";
import { configureMusicAppLink, MUSIC_LINK_TARGET_KEY } from "./music-app-links.mjs?v=4";

const $ = (id) => document.getElementById(id);
const states = { queued: "Da ascoltare", listening: "In ascolto",
  liked: "Mi piace", neutral: "Neutro", disliked: "Non mi piace" };
const providerName = (album) => album.id.startsWith("tidal:") ? "TIDAL" : album.id.startsWith("qobuz:") ? "Qobuz" : "Spotify";
const node = (tag, text = "", attributes = {}) => {
  const value = document.createElement(tag); value.textContent = text;
  Object.entries(attributes).forEach(([key, item]) => value.setAttribute(key, item));
  return value;
};
let store, sync, servicesPromise, catalogAbort, busy = false, visibleLimit = 40, resultAlbums = [], generation = 0;
const covers = createCollectionCoverCache(indexedDB), cards = new Map(), urls = new Map();
function report(message, error = false) {
  $("feedback").textContent = message;
  $("feedback").classList.toggle("error", error);
  $("feedback").setAttribute("role", error ? "alert" : "status");
  if ($("addDialog").open) {
    $("catalogStatus").textContent = message;
    $("catalogStatus").classList.toggle("error", error);
    $("catalogStatus").setAttribute("role", error ? "alert" : "status");
  }
}
async function services() {
  if (!servicesPromise) servicesPromise = import("./collection-services.mjs?v=3")
    .then(({ createCollectionServices }) => createCollectionServices({
      storage: localStorage, session: sessionStorage, pageUrl: location.href }));
  return servicesPromise;
}
function disable() {
  document.querySelectorAll("header button, #openAdd, #filters input, #filters select, #albumList button, #albumList select, #moreAlbums, #addDialog button:not([data-close]), #addDialog input, #addDialog select, #settingsDialog button, #settingsDialog input, #settingsDialog select")
    .forEach((element) => { element.disabled = busy || !store; });
  $("collection").setAttribute("aria-busy", String(busy));
  $("cancelCatalogSearch").hidden = !catalogAbort;
  $("cancelCatalogSearch").disabled = !catalogAbort;
}
async function run(action) {
  if (busy || !store) return;
  busy = true; disable();
  try { await action(); }
  catch (error) { report(error.message, true); }
  finally { busy = false; render(); disable(); }
}
function mutate(action) {
  if (busy || !store) return;
  try { action(); render(); report("Modifica salvata sul dispositivo. Sincronizza per aggiornare la raccolta condivisa."); return true; }
  catch (error) { report(error.message, true); return false; }
}
async function choice(title, content, actions, validate = () => true) {
  const dialog = $("choiceDialog"), form = node("form", "", { method: "dialog" });
  dialog.setAttribute("aria-label", title);
  form.append(node("h2", title));
  form.append(...content);
  const footer = node("div", "", { class: "dialog-actions" });
  actions.forEach(([value, text]) => {
    const button = node("button", text, { value, type: "submit" });
    button.addEventListener("click", (event) => { if (value !== "cancel" && !validate()) event.preventDefault(); });
    footer.append(button);
  });
  form.append(footer); dialog.replaceChildren(form); dialog.returnValue = "cancel";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
    dialog.showModal();
  });
}
function comparison(album, favorite = false) {
  const card = node("article", "", { class: "comparison-card" });
  card.append(node("h3", album.name), node("p", album.artist));
  const facts = node("dl");
  const values = { Servizio: providerName(album), Anno: album.year || "-", Stato: states[album.status],
    Voto: album.rating ?? "-", Preferito: favorite ? "Si" : "No", Generi: album.genres.join(", ") || "-",
    Collezioni: album.collections.join(", ") || "-", Tag: album.tags.join(", ") || "-",
    Note: album.notes || "-", ID: album.id };
  Object.entries(values).forEach(([label, value]) => facts.append(node("dt", label), node("dd", String(value))));
  const link = node("a", "Apri nel servizio", { href: album.url, target: "_blank", rel: "noopener noreferrer" });
  card.append(facts, link);
  return card;
}
async function confirmRemoval(ids, expected = store.state) {
  const removed = expected.albums.filter((album) => ids.includes(album.id));
  const answer = await choice("Conferma rimozione", [
    node("p", "Le copie selezionate saranno rimosse dal dispositivo e, con Sincronizza, dalla raccolta condivisa. Voti, note e altri dati non vengono uniti alle copie mantenute."),
    ...removed.map((album) => node("p", `${providerName(album)} - ${album.artist} - ${album.name} (${album.year || "-"})`)),
  ], [["cancel", "Annulla"], ["remove", "Rimuovi le copie selezionate"]]);
  if (answer === "remove") {
    store.remove(ids, expected);
    report("Copie rimosse localmente. Premi Sincronizza per aggiornare la raccolta condivisa.");
  }
}
async function compareCandidate(candidate, found) {
  const expected = store.state, row = node("div", "", { class: "comparison-grid" });
  row.append(comparison(found.album, (expected.preferences.favoriteIds || []).includes(found.album.id)), comparison(candidate));
  const actions = [["cancel", "Mantieni la copia in raccolta"]];
  if (candidate.id !== found.album.id) actions.push(["replace", "Mantieni la nuova copia"]);
  if (found.confidence === "uncertain" && candidate.id !== found.album.id) actions.push(["distinct", "Sono album diversi: aggiungi"]);
  const answer = await choice("Confronta prima di aggiungere", [
    node("p", found.confidence === "uncertain"
      ? "Titolo e artista coincidono, ma gli anni differiscono. Potrebbero essere edizioni diverse oppure album distinti."
      : "Questo album risulta gia' presente. Confronta i dati prima di sostituire una copia."),
    row,
  ], actions);
  if (store.state !== expected) throw new Error("Raccolta cambiata: riapri il confronto.");
  if (answer === "replace") {
    const confirmed = await choice("Conferma sostituzione", [node("p",
      "La nuova copia conservera' i propri dati. Voto, note e altri dati della vecchia copia non saranno trasferiti. La rimozione sara' inviata alla prossima sincronizzazione.")],
    [["cancel", "Annulla"], ["replace", "Sostituisci"]]);
    if (confirmed === "replace") {
      store.add(candidate, { replaceId: found.album.id });
      report("Copia sostituita localmente. Sincronizza per aggiornare la raccolta condivisa.");
    }
  } else if (answer === "distinct") {
    const duplicate = store.add(candidate, { distinct: true });
    if (duplicate) throw new Error("Lo stesso identificativo non puo' essere aggiunto due volte.");
    report("Album distinto aggiunto dopo il confronto.");
  }
  renderResults();
}
function showDuplicates(index = 0) {
  const groups = store.groups(), dialog = $("duplicatesDialog");
  $("duplicateContent").replaceChildren();
  if (!groups.length) {
    $("duplicateContent").append(node("p", "Nessun possibile duplicato trovato."));
    $("duplicatePrevious").disabled = $("duplicateNext").disabled = true;
    $("removeDuplicates").disabled = true;
  } else {
    index = Math.min(Math.max(index, 0), groups.length - 1);
    const group = groups[index], expected = store.state, proposal = store.suggestMerge(group);
    $("duplicateContent").append(node("p", `Proposta ${index + 1} di ${groups.length}`),
      node("h3", `${proposal.album.artist} - ${proposal.album.name}`),
      node("p", `Ho trovato ${group.length} copie. Ti suggerisco di unirle in un solo album, mantenendo la copia ${providerName(proposal.album)} (${proposal.album.year || "anno non indicato"}).`),
      node("p", `Stato proposto: ${states[proposal.album.status]}. Voto: ${proposal.album.rating ?? "non assegnato"}. Note, generi, collezioni, tag e preferiti vengono conservati; voti e stati diversi restano annotati nelle note.`));
    const details = node("details"), grid = node("div", "", { class: "comparison-grid" });
    details.append(node("summary", "Vedi le copie e il risultato proposto"));
    group.forEach((album) => grid.append(comparison(album, (expected.preferences.favoriteIds || []).includes(album.id))));
    grid.append(comparison(proposal.album, proposal.favorite));
    details.append(grid); $("duplicateContent").append(details);
    $("duplicatePrevious").disabled = index === 0; $("duplicateNext").disabled = index === groups.length - 1;
    $("removeDuplicates").disabled = false;
    $("duplicatePrevious").onclick = () => showDuplicates(index - 1);
    $("duplicateNext").onclick = () => showDuplicates(index + 1);
    $("removeDuplicates").onclick = () => run(async () => {
      store.merge(group, expected);
      report("Copie unite. Premi Sincronizza per condividere il risultato con l'app.");
      showDuplicates(index);
    });
  }
  if (!dialog.open) dialog.showModal();
}
const coverObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    coverObserver.unobserve(entry.target);
    const { id, hash } = entry.target.dataset;
    covers.get(id).then((data) => {
      if (!data || !entry.target.isConnected || entry.target.dataset.hash !== hash) return;
      const url = URL.createObjectURL(new Blob([data], { type: "image/jpeg" }));
      if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
      urls.set(id, url); entry.target.src = url; entry.target.hidden = false;
    }).catch((error) => report(error.message, true));
  }
}, { rootMargin: "200px" });
function albumCard(album, favorite) {
  const card = node("article", "", { class: "album-card", "data-id": album.id });
  const artwork = node("div", "", { class: "artwork" });
  artwork.append(node("span", album.name.slice(0, 1).toUpperCase(), { "aria-hidden": "true" }));
  if (album.cover_sha256) {
    const image = node("img", "", { alt: "", loading: "lazy", width: "240", height: "240",
      "data-id": album.id, "data-hash": album.cover_sha256, hidden: "" });
    artwork.append(image); queueMicrotask(() => coverObserver.observe(image));
  }
  const favoriteButton = node("button", favorite ? "Preferito" : "Preferito +", { type: "button",
    class: "favorite", "aria-pressed": String(favorite), "aria-label": `Preferito: ${album.name}` });
  favoriteButton.dataset.control = "favorite";
  favoriteButton.addEventListener("click", () => {
    if (mutate(() => store.favorite(album.id))) report("Preferito salvato su questo dispositivo.");
  });
  card.append(artwork, node("h2", album.name), node("p", album.artist),
    node("p", `${album.year || "-"} - ${providerName(album)}`, { class: "muted" }));
  const controls = node("div", "", { class: "album-controls" });
  const statusLabel = node("label", "Ascolto"), status = node("select", "", { "data-control": "status" });
  Object.entries(states).forEach(([value, label]) => status.append(node("option", label, { value })));
  status.value = album.status; statusLabel.append(status);
  status.addEventListener("change", () => mutate(() => store.update(album.id, { status: status.value })));
  const ratingLabel = node("label", "Voto"), rating = node("select", "", { "data-control": "rating" });
  rating.append(node("option", "Senza voto", { value: "" }));
  for (let value = 0.5; value <= 5; value += 0.5) rating.append(node("option", String(value).replace(".", ","), { value }));
  rating.value = album.rating === null ? "" : String(album.rating); ratingLabel.append(rating);
  rating.addEventListener("change", () => mutate(() => store.update(album.id, { rating: rating.value ? Number(rating.value) : null })));
  controls.append(statusLabel, ratingLabel); card.append(controls);
  const footer = node("div", "", { class: "card-actions" }), open = node("a", "Apri album", { rel: "noopener noreferrer" });
  configureMusicAppLink(open, album.url, { storage: localStorage,
    query: `${album.artist} ${album.name}`, report: (message) => report(message) });
  const remove = node("button", "Rimuovi", { type: "button", "data-control": "remove", class: "secondary" });
  remove.addEventListener("click", () => run(() => confirmRemoval([album.id])));
  footer.append(favoriteButton, open, remove); card.append(footer);
  return card;
}
function render() {
  if (!store) return;
  const query = $("search").value.trim().toLocaleLowerCase(), state = $("statusFilter").value;
  const favorites = new Set(store.state.preferences.favoriteIds || []);
  document.documentElement.dataset.textScale = ["large", "larger"].includes(store.state.preferences.textScale) ? store.state.preferences.textScale : "normal";
  document.documentElement.dataset.contrast = store.state.preferences.contrast === "high" ? "high" : "standard";
  document.documentElement.dataset.density = store.state.preferences.density === "compact" ? "compact" : "touch";
  const filtered = store.state.albums.filter((album) => (!query || `${album.artist} ${album.name}`.toLocaleLowerCase().includes(query))
    && (!state || album.status === state) && (!$("favoritesFilter").checked || favorites.has(album.id)));
  filtered.sort((a, b) => a.artist.localeCompare(b.artist, "it") || a.name.localeCompare(b.name, "it"));
  const active = document.activeElement, activeId = active?.closest(".album-card")?.dataset.id, control = active?.dataset.control;
  const wanted = filtered.slice(0, visibleLimit).map((album) => {
    const signature = JSON.stringify([album, favorites.has(album.id), localStorage.getItem(MUSIC_LINK_TARGET_KEY)]);
    const old = cards.get(album.id);
    if (!old || old.signature !== signature) {
      const oldImage = old?.element.querySelector("img");
      if (oldImage) coverObserver.unobserve(oldImage);
      cards.set(album.id, { signature, element: albumCard(album, favorites.has(album.id)) });
    }
    return cards.get(album.id).element;
  });
  reconcileAlbumCards($("albumList"), wanted);
  const retained = new Set(filtered.slice(0, visibleLimit).map((album) => album.id));
  for (const id of cards.keys()) if (!retained.has(id)) {
    const image = cards.get(id).element.querySelector("img");
    if (image) coverObserver.unobserve(image);
    cards.delete(id);
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  }
  if (activeId && control) [...$("albumList").children].find((card) => card.dataset.id === activeId)
    ?.querySelector(`[data-control="${control}"]`)?.focus({ preventScroll: true });
  $("count").textContent = `${filtered.length} album${filtered.length !== store.state.albums.length ? ` su ${store.state.albums.length}` : ""}`;
  $("empty").hidden = filtered.length > 0;
  $("empty").textContent = store.state.albums.length ? "Nessun album corrisponde ai filtri." : "La raccolta e' vuota. Aggiungi un album oppure sincronizza con GitHub.";
  $("moreAlbums").hidden = filtered.length <= visibleLimit;
  $("lastSync").textContent = store.state.lastSync ? `Ultima sincronizzazione: ${new Date(store.state.lastSync).toLocaleString("it")}` : "Le modifiche restano sul dispositivo finche' sincronizzi.";
  $("headerSyncState").textContent = store.state.lastSync ? "Raccolta collegata a GitHub" : "Raccolta sul dispositivo";
}
function renderResults() {
  $("catalogResults").replaceChildren();
  for (const album of resultAlbums) {
    const row = node("article", "", { class: "catalog-result" });
    row.append(node("h3", album.name), node("p", `${album.artist} - ${album.year || "-"} - ${providerName(album)}`));
    const duplicate = store.duplicate(album), button = node("button", duplicate ? "Gia' presente: confronta" : "Aggiungi", { type: "button" });
    button.addEventListener("click", () => run(async () => {
      const current = store.duplicate(album);
      if (current) { await compareCandidate(album, current); return; }
      const remote = await sync.checkAddition(album);
      if (remote) {
        const answer = await choice("Album gia' nella raccolta condivisa", [
          comparison(remote.album), node("p", "Non e' stata aggiunta un'altra copia. Sincronizza per caricare quella esistente.")],
        [["cancel", "Chiudi"], ["sync", "Sincronizza"]]);
        if (answer === "sync") await performSync();
        return;
      }
      const found = store.add(album);
      if (found) await compareCandidate(album, found);
      else report("Album aggiunto localmente. Sincronizza per inviarlo alla raccolta condivisa.");
      renderResults();
    }));
    row.append(button); $("catalogResults").append(row);
  }
}
async function performSync() {
  report("Lettura della raccolta condivisa...");
  const completed = await sync.sync({
    async chooseConflicts(conflicts) {
      const content = [node("p", "Scegli soltanto per i dati in conflitto. Una rimozione contrapposta a una modifica richiede la tua conferma.")], controls = [];
      conflicts.forEach((conflict) => {
        const album = conflict.local || conflict.remote || conflict.base;
        content.push(node("h3", `${album.artist} - ${album.name}`));
        conflict.fields.forEach((field) => {
          const label = node("label", field.field === "album" ? "Rimozione o modifica" : field.field);
          const value = node("select");
          value.append(node("option", "Scegli...", { value: "" }), node("option", "Mantieni il dispositivo", { value: "local" }),
            node("option", "Usa la raccolta GitHub", { value: "remote" }));
          content.push(node("pre", `Dispositivo: ${JSON.stringify(field.local, null, 2)}\nGitHub: ${JSON.stringify(field.remote, null, 2)}`));
          label.append(value); content.push(label); controls.push({ id: conflict.id, field: field.field, value });
        });
      });
      const answer = await choice("Modifiche in conflitto", content, [["cancel", "Annulla"], ["continue", "Applica scelte"]],
        () => controls.every(({ value }) => value.value));
      if (answer !== "continue") return null;
      const choices = {};
      controls.forEach(({ id, field, value }) => { choices[id] ||= {}; choices[id][field] = value.value; });
      return choices;
    },
    async confirm({ local, remote, albums }) {
      const changes = (previous) => {
        const next = new Map(albums.map((album) => [album.id, album])), old = new Map(previous.map((album) => [album.id, album]));
        return [...new Set([...old.keys(), ...next.keys()])].flatMap((id) => {
          const left = old.get(id), right = next.get(id);
          if (JSON.stringify(left) === JSON.stringify(right)) return [];
          const album = right || left;
          return [`${!right ? "Rimuovi" : !left ? "Aggiungi" : "Aggiorna"}: ${album.artist} - ${album.name} (${providerName(album)})`];
        });
      };
      const content = [node("p", "Queste sono le modifiche da applicare. Nessuna scrittura viene eseguita prima della conferma."),
        node("h3", "Raccolta condivisa"), node("pre", changes(remote).join("\n") || "Nessuna modifica."),
        node("h3", "Questo dispositivo"), node("pre", changes(local).join("\n") || "Nessuna modifica.")];
      return await choice("Conferma sincronizzazione", content, [["cancel", "Annulla"], ["sync", "Sincronizza"]]) === "sync";
    },
  });
  report(completed ? "Sincronizzazione completata." : "Sincronizzazione annullata. Nessun invio eseguito.");
  renderResults();
}
async function serviceSettings() {
  const client = await services(), provider = $("settingsService").value;
  client.select(provider); $("catalogService").value = provider; generation += 1;
  resultAlbums = []; renderResults();
  document.querySelectorAll("[data-service]").forEach((field) => { field.hidden = field.dataset.service !== provider; });
  const settings = client.settings(provider);
  const name = { spotify: "Spotify", tidal: "TIDAL", qobuz: "Qobuz" }[provider];
  $("connectService").textContent = `Collega ${name}`;
  $("disconnectService").textContent = `Scollega ${name}`;
  $("serviceStatus").textContent = settings.text;
  $("clientId").value = settings.clientId || "";
  $("redirectUri").value = settings.redirectUri || "";
  $("redirectField").hidden = provider !== "spotify"; $("clientField").hidden = provider === "qobuz";
}
try {
  store = createCollectionStore(localStorage);
  sync = createCollectionSync({ storage: localStorage, store, covers });
  render();
} catch (error) { report(error.message, true); }
disable();
$("search").addEventListener("input", () => { visibleLimit = 40; render(); });
["statusFilter", "favoritesFilter"].forEach((id) => $(id).addEventListener("change", () => { visibleLimit = 40; render(); }));
$("moreAlbums").addEventListener("click", () => { visibleLimit += 40; render(); });
$("sync").addEventListener("click", () => run(performSync));
$("duplicates").addEventListener("click", () => {
  try { $("settingsDialog").close(); showDuplicates(); } catch (error) { report(error.message, true); }
});
$("openAdd").addEventListener("click", async () => {
  await run(async () => {
  const client = await services(); $("catalogService").value = client.provider;
  $("catalogStatus").textContent = "Cerca per titolo e artista, oppure incolla un link album.";
    $("addDialog").showModal();
    $("catalogBody").scrollTop = 0;
  });
  if ($("addDialog").open && !busy) $("catalogQuery").focus();
});
$("catalogService").addEventListener("change", () => run(async () => {
  (await services()).select($("catalogService").value); generation += 1; resultAlbums = []; renderResults();
}));
$("catalogForm").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const client = await services(), current = ++generation;
    if (!$("addDialog").open) return;
    const controller = new AbortController();
    catalogAbort = controller; resultAlbums = []; renderResults(); disable();
    report("Ricerca in corso (massimo 45 secondi). Puoi annullarla.");
    try {
      const albums = await client.search($("catalogQuery").value, { signal: controller.signal });
      if (current !== generation) throw new Error("Ricerca cambiata: risultati scartati.");
      resultAlbums = albums.map(validateAlbum); renderResults();
      report(`${resultAlbums.length} risultati. Il controllo duplicati viene ripetuto anche al momento dell'aggiunta.`);
    } catch (error) {
      if (error.name === "AbortError" && controller.signal.aborted) report("Ricerca annullata. Puoi riprovare.");
      else if (error.name === "TimeoutError") throw new Error("Tempo di attesa superato: il catalogo non ha risposto in tempo. Riprova oppure incolla il link dell'album.");
      else if (error.name === "AbortError") throw new Error("Connessione al catalogo interrotta. Nessun album aggiunto: riprova la ricerca.");
      else if (/TIDAL HTTP (401|403)\b/.test(error.message)) throw new Error(`${error.message} Verifica l'accesso e i permessi nelle impostazioni, poi premi Collega TIDAL.`);
      else throw error;
    } finally { catalogAbort = null; }
  });
});
$("cancelCatalogSearch").addEventListener("click", () => catalogAbort?.abort());
$("addDialog").addEventListener("close", () => catalogAbort?.abort());
$("addDialog").addEventListener("cancel", () => catalogAbort?.abort());
$("openSettings").addEventListener("click", () => run(async () => {
  const client = await services();
  $("owner").value = localStorage.getItem("accord-album-owner") || "";
  $("githubToken").value = "";
  $("githubToken").placeholder = localStorage.getItem("accord-album-token") ? "Token gia' salvato; vuoto non cambia" : "Token con permesso Contents";
  $("settingsService").value = client.provider;
  $("linkTarget").value = localStorage.getItem(MUSIC_LINK_TARGET_KEY) === "web" ? "web" : "app";
  await serviceSettings(); $("settingsDialog").showModal();
}));
$("settingsService").addEventListener("change", () => run(serviceSettings));
$("githubForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const saved = mutate(() => {
    const owner = $("owner").value.trim(), token = $("githubToken").value.trim();
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) throw new Error("Proprietario GitHub non valido.");
    if (!token && !localStorage.getItem("accord-album-token")) throw new Error("Inserisci il token GitHub.");
    if (token && /[\r\n]/.test(token)) throw new Error("Token GitHub non valido.");
    localStorage.setItem("accord-album-owner", owner);
    if (token) localStorage.setItem("accord-album-token", token);
    localStorage.setItem("accord-album-autosync", "0");
    $("githubToken").value = "";
  });
  if (saved) report("Impostazioni GitHub salvate. Premi Sincronizza per verificare e collegare la raccolta.");
});
$("connectService").addEventListener("click", () => run(async () => {
  const client = await services(), provider = $("settingsService").value;
  const url = await client.connect(provider, { clientId: $("clientId").value, appId: $("qobuzAppId").value, token: $("qobuzToken").value });
  $("qobuzAppId").value = ""; $("qobuzToken").value = "";
  if (url) location.assign(url);
  else { await serviceSettings(); report("Accesso Qobuz verificato e salvato su questo dispositivo."); }
}));
$("disconnectService").addEventListener("click", () => run(async () => {
  const client = await services(); client.disconnect($("settingsService").value);
  await serviceSettings(); report("Accesso salvato rimosso da questo browser. Il Client ID configurato e' conservato.");
}));
$("linkTarget").addEventListener("change", () => {
  try { localStorage.setItem(MUSIC_LINK_TARGET_KEY, $("linkTarget").value); render(); }
  catch (error) { report(error.message, true); }
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => $(button.dataset.close).close()));
window.addEventListener("storage", (event) => {
  if (event.key === MUSIC_LINK_TARGET_KEY) render();
  if (event.key === null || event.key === "accord-album-pwa-v1") {
    report("Raccolta modificata in un'altra scheda. Ricarica prima di continuare.", true);
  }
});
const callback = new URL(location.href);
if (callback.searchParams.has("code") || callback.searchParams.has("error")) {
  run(async () => {
    try { await (await services()).finish(location.href); report("Servizio musicale collegato. Accesso salvato su questo dispositivo."); }
    finally { history.replaceState(null, "", `${location.pathname}${location.hash}`); }
  });
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").then((registration) => {
    function updateReady() { $("update").hidden = false; }
    if (registration.waiting) updateReady();
    registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", () => {
      if (registration.waiting && navigator.serviceWorker.controller) updateReady();
    }));
    $("update").addEventListener("click", () => run(async () => {
      store.assertCurrent();
      const answer = await choice("Aggiorna PWA", [node("p", "Le modifiche salvate restano sul dispositivo. I testi non inviati nei moduli verranno persi.")],
        [["cancel", "Annulla"], ["update", "Aggiorna"]]);
      if (answer === "update" && registration.waiting) {
        navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
        registration.waiting.postMessage({ type: "accord-activate-update" });
      }
    }));
  }).catch((error) => report(`Modalita' offline non disponibile: ${error.message}`, true));
}
