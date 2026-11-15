import { reconcileAlbumCards, validateAlbum } from "./core.mjs?v=52";
import { createCollectionStore, createCollectionCoverCache } from "./collection-store.mjs?v=6";
import { createCollectionSync } from "./collection-sync.mjs?v=4";
import { configureMusicAppLink, MUSIC_LINK_TARGET_KEY } from "./music-app-links.mjs?v=4";
import { albumSearchMatch, shortReleaseKind } from "./music-suggestion-filters.mjs?v=4";

const $ = (id) => document.getElementById(id);
const states = { queued: "Da ascoltare", listening: "In ascolto",
  liked: "Mi piace", neutral: "Neutro", disliked: "Non mi piace" };
const providerName = (album) => album.id.startsWith("tidal:") ? "TIDAL" : album.id.startsWith("qobuz:") ? "Qobuz" : "Spotify";
const node = (tag, text = "", attributes = {}) => {
  const value = document.createElement(tag); value.textContent = text;
  Object.entries(attributes).forEach(([key, item]) => value.setAttribute(key, item));
  return value;
};
let store, sync, servicesPromise, catalogAbort, durationAbort, busy = false, visibleLimit = 40, resultAlbums = [], generation = 0;
const covers = createCollectionCoverCache(indexedDB), cards = new Map(), urls = new Map();
let resultCoverUrls = new Map();
let resultMetadata = new Map();
function trustedCoverUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password
      && (host === "resources.tidal.com" || host === "static.qobuz.com"
        || host === "scdn.co" || host.endsWith(".scdn.co")
        || host === "spotifycdn.com" || host.endsWith(".spotifycdn.com"));
  } catch { return false; }
}
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
  if (!servicesPromise) servicesPromise = import("./collection-services.mjs?v=6")
    .then(({ createCollectionServices }) => createCollectionServices({
      storage: localStorage, session: sessionStorage, pageUrl: location.href }));
  return servicesPromise;
}
function disable() {
  document.querySelectorAll("header button, #openAdd, #filters input, #filters select, #albumList button, #albumList select, #moreAlbums, #addDialog button:not([data-close]), #addDialog input, #addDialog select, #settingsDialog button:not(#cancelDurations), #settingsDialog input, #settingsDialog select")
    .forEach((element) => { element.disabled = busy || !store; });
  $("collection").setAttribute("aria-busy", String(busy));
  $("cancelCatalogSearch").hidden = !catalogAbort;
  $("cancelCatalogSearch").disabled = !catalogAbort;
  $("cancelDurations").hidden = !durationAbort;
  $("cancelDurations").disabled = !durationAbort;
}
const durationProvider = (album) => /^tidal:[1-9][0-9]*$/.test(album.id) ? "tidal"
  : /^qobuz:[A-Za-z0-9]{1,120}$/.test(album.id) ? "qobuz"
    : /^[A-Za-z0-9]{22}$/.test(album.id) ? "spotify" : null;
const durationText = (milliseconds) => {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
};
async function updateAlbumDuration(album, client, signal) {
  if (Object.hasOwn(store.durations(), album.id)) return false;
  const duration = await client.albumDuration(album, { signal });
  return store.saveMissingDuration(album, duration);
}
function fetchAddedDuration(album) {
  void (async () => {
    try {
      const client = await services(), provider = durationProvider(album);
      if (!provider || provider !== client.provider) throw new Error("Servizio dell'album non attivo.");
      const saved = await updateAlbumDuration(album, client);
      if (saved) { render(); report(`Album aggiunto. Durata recuperata per ${album.name}.`); }
    } catch (error) {
      report(`Album aggiunto, ma durata non disponibile per ${album.name}: ${error.message}`, true);
    }
  })();
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
    Collezioni: album.collections.join(", ") || "-", Tag: album.tags.join(", ") || "-", Note: album.notes || "-" };
  Object.entries(values).forEach(([label, value]) => facts.append(node("dt", label), node("dd", String(value))));
  const link = node("a", "Apri nel servizio", { href: album.url, target: "_blank", rel: "noopener noreferrer" });
  card.append(facts, link);
  return card;
}
async function confirmRemoval(ids, expected = store.state) {
  const removed = expected.albums.filter((album) => ids.includes(album.id));
  const answer = await choice("Conferma rimozione", [
    node("p", "Le copie scelte saranno rimosse. Voti e note non verranno trasferiti; la raccolta condivisa si aggiorna alla prossima sincronizzazione."),
    ...removed.map((album) => node("p", `${providerName(album)} - ${album.artist} - ${album.name} (${album.year || "-"})`)),
  ], [["cancel", "Annulla"], ["remove", "Rimuovi le copie selezionate"]]);
  if (answer === "remove") {
    store.remove(ids, expected);
    report("Copie rimosse. Sincronizza per aggiornare gli altri dispositivi.");
  }
}
async function cacheCatalogCover(albumId, sourceId = albumId) {
  const coverUrl = resultCoverUrls.get(sourceId);
  if (!coverUrl) return "";
  try { await covers.putUrl(albumId, coverUrl); }
  catch (error) { return error.message; }
  return "";
}
async function compareCandidate(candidate, found) {
  const coverError = found.confidence !== "uncertain" ? await cacheCatalogCover(found.album.id, candidate.id) : "";
  const expected = store.state, row = node("div", "", { class: "comparison-grid" });
  row.append(comparison(found.album, (expected.preferences.favoriteIds || []).includes(found.album.id)), comparison(candidate));
  const actions = [["cancel", "Mantieni la copia in raccolta"]];
  if (candidate.id !== found.album.id) actions.push(["replace", "Mantieni la nuova copia"]);
  if (found.confidence === "uncertain" && candidate.id !== found.album.id) actions.push(["distinct", "Sono album diversi: aggiungi"]);
  const answer = await choice("Confronta prima di aggiungere", [
    node("p", found.confidence === "uncertain"
      ? "Titolo e artista coincidono, ma l'anno e' diverso. Controlla se si tratta di un'altra edizione."
      : "Album gia' presente. Confronta le copie prima di decidere."),
    row,
  ], actions);
  if (store.state !== expected) throw new Error("Raccolta cambiata: riapri il confronto.");
  if (answer === "replace") {
    const confirmed = await choice("Sostituisci copia", [node("p",
      "Voti e note della vecchia copia non verranno trasferiti. La rimozione sara' sincronizzata.")],
    [["cancel", "Annulla"], ["replace", "Sostituisci"]]);
    if (confirmed === "replace") {
      store.add(candidate, { replaceId: found.album.id });
      fetchAddedDuration(candidate);
      const saveError = await cacheCatalogCover(candidate.id);
      report(saveError ? `Copia sostituita, ma copertina non salvata: ${saveError}`
        : "Copia sostituita. Sincronizza per aggiornare gli altri dispositivi.", Boolean(saveError));
    }
  } else if (answer === "distinct") {
    const duplicate = store.add(candidate, { distinct: true });
    if (duplicate) throw new Error("Lo stesso identificativo non puo' essere aggiunto due volte.");
    fetchAddedDuration(candidate);
    const saveError = await cacheCatalogCover(candidate.id);
    report(saveError ? `Album aggiunto, ma copertina non salvata: ${saveError}`
      : "Album aggiunto come copia distinta.", Boolean(saveError));
  } else if (coverError) {
    report(`Album gia' presente; copertina non memorizzata: ${coverError}`, true);
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
        node("p", `Ho trovato ${group.length} copie. Suggerisco di tenere quella ${providerName(proposal.album)}. Controlla i dettagli, poi conferma.`),
        node("p", "Conservo note e preferiti; voti e stati diversi vengono annotati."));
    const details = node("details"), grid = node("div", "", { class: "comparison-grid" });
    details.append(node("summary", "Confronta le copie"));
    group.forEach((album) => grid.append(comparison(album, (expected.preferences.favoriteIds || []).includes(album.id))));
    grid.append(comparison(proposal.album, proposal.favorite));
    details.append(grid); $("duplicateContent").append(details);
    $("duplicatePrevious").disabled = index === 0; $("duplicateNext").disabled = index === groups.length - 1;
    $("removeDuplicates").disabled = false;
    $("duplicatePrevious").onclick = () => showDuplicates(index - 1);
    $("duplicateNext").onclick = () => showDuplicates(index + 1);
    $("removeDuplicates").onclick = () => run(async () => {
      store.merge(group, expected);
      report("Copie unite. Sincronizza per aggiornare gli altri dispositivi.");
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
    covers.get(id).then(async (data) => {
      if (!entry.target.isConnected || entry.target.dataset.hash !== hash) return;
      let source;
      if (data) source = URL.createObjectURL(new Blob([data], { type: "image/jpeg" }));
      else source = await covers.getUrl(id);
      if (source && !source.startsWith("blob:") && !trustedCoverUrl(source)) return;
      if (!source || !entry.target.isConnected || entry.target.dataset.hash !== hash) {
        if (source?.startsWith("blob:")) URL.revokeObjectURL(source);
        return;
      }
      if (source.startsWith("blob:")) {
        if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
        urls.set(id, source);
      }
      const image = entry.target, placeholder = image.parentElement.querySelector("span");
      image.onload = () => { image.classList.add("loaded"); placeholder.hidden = true; };
      image.onerror = () => { image.classList.remove("loaded"); };
      image.src = source;
    }).catch((error) => report(error.message, true));
  }
}, { rootMargin: "200px" });
function albumCard(album, favorite, duration) {
  const card = node("article", "", { class: "album-card", "data-id": album.id });
  const artwork = node("div", "", { class: "artwork" });
  artwork.append(node("span", album.name.slice(0, 1).toUpperCase(), { "aria-hidden": "true" }));
  const image = node("img", "", { alt: `Copertina di ${album.name}`, loading: "lazy", width: "240", height: "240",
    referrerpolicy: "no-referrer", "data-id": album.id, "data-hash": album.cover_sha256 || "" });
  artwork.append(image); queueMicrotask(() => coverObserver.observe(image));
  const favoriteButton = node("button", favorite ? "Preferito" : "Preferito +", { type: "button",
    class: "favorite", "aria-pressed": String(favorite), "aria-label": `Preferito: ${album.name}` });
  favoriteButton.dataset.control = "favorite";
  favoriteButton.addEventListener("click", () => {
    if (mutate(() => store.favorite(album.id))) report("Preferito salvato su questo dispositivo.");
  });
  card.append(artwork, node("h2", album.name), node("p", album.artist),
    node("p", `${album.year || "-"} - ${providerName(album)}`, { class: "muted" }));
  if (duration) card.append(node("p", `Durata: ${durationText(duration)}`, { class: "muted" }));
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
  const durations = store.durations();
  document.documentElement.dataset.textScale = ["large", "larger"].includes(store.state.preferences.textScale) ? store.state.preferences.textScale : "normal";
  document.documentElement.dataset.contrast = store.state.preferences.contrast === "high" ? "high" : "standard";
  document.documentElement.dataset.density = store.state.preferences.density === "compact" ? "compact" : "touch";
  const filtered = store.state.albums.filter((album) => (!query || `${album.artist} ${album.name}`.toLocaleLowerCase().includes(query))
    && (!state || album.status === state) && (!$("favoritesFilter").checked || favorites.has(album.id)));
  filtered.sort((a, b) => a.artist.localeCompare(b.artist, "it") || a.name.localeCompare(b.name, "it"));
  const active = document.activeElement, activeId = active?.closest(".album-card")?.dataset.id, control = active?.dataset.control;
  const wanted = filtered.slice(0, visibleLimit).map((album) => {
    const signature = JSON.stringify([album, favorites.has(album.id), durations[album.id], localStorage.getItem(MUSIC_LINK_TARGET_KEY)]);
    const old = cards.get(album.id);
    if (!old || old.signature !== signature) {
      const oldImage = old?.element.querySelector("img");
      if (oldImage) coverObserver.unobserve(oldImage);
      cards.set(album.id, { signature, element: albumCard(album, favorites.has(album.id), durations[album.id]) });
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
  $("headerSyncState").textContent = store.state.lastSync ? "Raccolta condivisa" : "Raccolta sul dispositivo";
}
function renderResults() {
  $("catalogResults").replaceChildren();
  const options = { includeLive: $("catalogLive").checked, includeSingle: $("catalogSingle").checked,
    includeEp: $("catalogEp").checked };
  for (const album of resultAlbums) {
    const metadata = { ...album, ...resultMetadata.get(album.id) };
    if (!albumSearchMatch(metadata, options)) continue;
    const { kind, estimated } = shortReleaseKind(metadata);
    const release = kind ? ` - ${{ single: "Singolo", ep: "EP", short: "Singolo o EP" }[kind]}${estimated ? " (stima)" : ""}` : "";
    const row = node("article", "", { class: "catalog-result" });
    row.append(node("h3", album.name), node("p", `${album.artist} - ${album.year || "-"} - ${providerName(album)}${release}`));
    const duplicate = store.duplicate(album), button = node("button", duplicate ? "Gia' presente: confronta" : "Aggiungi", { type: "button" });
    button.addEventListener("click", () => run(async () => {
      const current = store.duplicate(album);
      if (current) { await compareCandidate(album, current); return; }
      const remote = await sync.checkAddition(album);
      if (remote) {
        const saveError = await cacheCatalogCover(remote.album.id, album.id);
        const answer = await choice("Album gia' presente", [
          comparison(remote.album), node("p", saveError
            ? `Non e' stata aggiunta un'altra copia. Sincronizza per caricare quella esistente. La copertina non e' stata memorizzata: ${saveError}`
            : "Non e' stata aggiunta un'altra copia. Sincronizza per caricare quella esistente.")],
        [["cancel", "Chiudi"], ["sync", "Sincronizza"]]);
        if (answer === "sync") await performSync();
        return;
      }
      const found = store.add(album);
      if (found) await compareCandidate(album, found);
      else {
        fetchAddedDuration(album);
        const saveError = await cacheCatalogCover(album.id);
        report(saveError ? `Album aggiunto, ma copertina non salvata: ${saveError}`
          : "Album aggiunto. Sincronizza per condividerlo.", Boolean(saveError));
      }
      renderResults();
    }));
    row.append(button); $("catalogResults").append(row);
  }
}
async function performSync() {
  report("Lettura della raccolta condivisa...");
  const completed = await sync.sync({
    async chooseConflicts(conflicts) {
      const content = [node("p", "Scegli quale versione mantenere per ogni modifica.")], controls = [];
      const labels = { album: "Album", status: "Stato", rating: "Voto", genres: "Generi",
        collections: "Collezioni", tags: "Tag", notes: "Note", favorite: "Preferito", pinned: "In evidenza", duration_ms: "Durata" };
      const valueText = (value, fieldName) => {
        if (value === null || value === undefined || value === "") return "Vuoto";
        if (Array.isArray(value)) return value.length ? value.join(", ") : "Vuoto";
        if (typeof value === "boolean") return value ? "Si" : "No";
        if (typeof value === "object") return value.artist && value.name ? `${value.artist} - ${value.name}` : "Modifica album";
        if (fieldName === "status" && Object.hasOwn(states, value)) return states[value];
        if (fieldName === "rating" && typeof value === "number") return `${value} / 5`;
        if (fieldName === "duration_ms" && typeof value === "number") return durationText(value);
        return String(value);
      };
      conflicts.forEach((conflict) => {
        const album = conflict.local || conflict.remote || conflict.base;
        content.push(node("h3", `${album.artist} - ${album.name}`));
        conflict.fields.forEach((field) => {
          const label = node("label", labels[field.field] || field.field);
          const value = node("select");
          value.append(node("option", "Scegli...", { value: "" }),
            node("option", `Mantieni questo dispositivo: ${valueText(field.local, field.field)}`, { value: "local" }),
            node("option", `Usa la raccolta condivisa: ${valueText(field.remote, field.field)}`, { value: "remote" }));
          label.append(value); content.push(label); controls.push({ id: conflict.id, field: field.field, value });
        });
      });
      const answer = await choice("Scegli cosa mantenere", content, [["cancel", "Annulla"], ["continue", "Continua"]],
        () => controls.every(({ value }) => value.value));
      if (answer !== "continue") return null;
      const choices = {};
      controls.forEach(({ id, field, value }) => { choices[id] ||= {}; choices[id][field] = value.value; });
      return choices;
    },
    async confirm({ local, remote, albums, durationOutgoing = [], durationIncoming = [] }) {
      const changes = (previous) => {
        const next = new Map(albums.map((album) => [album.id, album])), old = new Map(previous.map((album) => [album.id, album]));
        return [...new Set([...old.keys(), ...next.keys()])].flatMap((id) => {
          const left = old.get(id), right = next.get(id);
          if (JSON.stringify(left) === JSON.stringify(right)) return [];
          const album = right || left;
          return [`${!right ? "Rimuovi" : !left ? "Aggiungi" : "Aggiorna"}: ${album.artist} - ${album.name} (${providerName(album)})`];
        });
      };
      const content = [node("p", "Controlla le modifiche prima di sincronizzare."),
        node("h3", "Raccolta condivisa"), node("pre", [...changes(remote),
          ...durationOutgoing.map((row) => `Durata: ${row.artist} - ${row.name} (${durationText(row.duration_ms)})`)].join("\n") || "Nessuna modifica."),
        node("h3", "Questo dispositivo"), node("pre", [...changes(local),
          ...durationIncoming.map((row) => `Durata: ${row.artist} - ${row.name} (${durationText(row.duration_ms)})`)].join("\n") || "Nessuna modifica.")];
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
$("cancelDurations").addEventListener("click", () => durationAbort?.abort());
$("updateDurations").addEventListener("click", () => run(async () => {
  const client = await services(), original = client.provider, controller = new AbortController();
  const known = store.durations();
  const missing = store.state.albums.filter((album) => !Object.hasOwn(known, album.id));
  const failed = [], skipped = [], unavailable = new Map();
  let completed = 0, index = 0;
  durationAbort = controller; disable();
  try {
    for (const album of missing) {
      if (controller.signal.aborted) break;
      index += 1;
      $("durationStatus").textContent = `Durate: ${index} su ${missing.length} · ${album.name}`;
      const provider = durationProvider(album);
      if (!provider) { skipped.push(`${album.name}: servizio non identificabile`); continue; }
      if (unavailable.has(provider)) { failed.push(`${album.name}: ${unavailable.get(provider)}`); continue; }
      client.select(provider);
      try {
        if (await updateAlbumDuration(album, client, controller.signal)) completed += 1;
      } catch (error) {
        if (controller.signal.aborted) break;
        if (/HTTP (401|403|429)\b|collega|attendi|limite|accesso .*non attivo/i.test(error.message)) {
          unavailable.set(provider, error.message);
        }
        failed.push(`${album.name}: ${error.message}`);
      }
    }
  } finally {
    client.select(original); durationAbort = null; disable();
  }
  const details = [...failed, ...skipped];
  const status = `${controller.signal.aborted ? "Interrotto. " : ""}${completed} durate aggiunte.`
    + (details.length ? ` Non disponibili (${details.length}): ${details.join("; ")}` : "");
  $("durationStatus").textContent = status;
  report(status, details.length > 0);
}));
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
      resultAlbums = albums.map(validateAlbum);
      resultCoverUrls = new Map(resultAlbums.map((album) => [album.id, client.coverUrl(album)]).filter(([, url]) => url));
      resultMetadata = new Map(resultAlbums.map((album) => [album.id, client.releaseMetadata(album)]));
      renderResults();
      report(`${resultAlbums.length} risultati. Verifico di nuovo le copie prima di aggiungere.`);
    } catch (error) {
      if (error.name === "AbortError" && controller.signal.aborted) report("Ricerca annullata. Puoi riprovare.");
      else if (error.name === "TimeoutError") throw new Error("Il catalogo non ha risposto. Riprova o incolla il link dell'album.");
      else if (error.name === "AbortError") throw new Error("Connessione al catalogo interrotta. Nessun album aggiunto: riprova la ricerca.");
      else if (/TIDAL HTTP (401|403)\b/.test(error.message)) throw new Error("Accesso TIDAL non valido. Verifica le impostazioni e ricollega il servizio.");
      else throw error;
    } finally { catalogAbort = null; }
  });
});
for (const id of ["catalogLive", "catalogSingle", "catalogEp"]) $(id).addEventListener("change", renderResults);
$("cancelCatalogSearch").addEventListener("click", () => catalogAbort?.abort());
$("addDialog").addEventListener("close", () => catalogAbort?.abort());
$("addDialog").addEventListener("cancel", () => catalogAbort?.abort());
$("openSettings").addEventListener("click", () => run(async () => {
  const client = await services();
  $("owner").value = localStorage.getItem("accord-album-owner") || "";
  $("githubToken").value = "";
  $("githubToken").placeholder = localStorage.getItem("accord-album-token") ? "Gia' salvato; vuoto non cambia" : "Token di accesso";
  $("settingsService").value = client.provider;
  $("linkTarget").value = localStorage.getItem(MUSIC_LINK_TARGET_KEY) === "web" ? "web" : "app";
  await serviceSettings(); $("settingsDialog").showModal();
}));
$("settingsService").addEventListener("change", () => run(serviceSettings));
$("githubForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const saved = mutate(() => {
    const owner = $("owner").value.trim(), token = $("githubToken").value.trim();
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) throw new Error("Account GitHub non valido.");
    if (!token && !localStorage.getItem("accord-album-token")) throw new Error("Inserisci il token di accesso.");
    if (token && /[\r\n]/.test(token)) throw new Error("Token GitHub non valido.");
    localStorage.setItem("accord-album-owner", owner);
    if (token) localStorage.setItem("accord-album-token", token);
    localStorage.setItem("accord-album-autosync", "0");
    $("githubToken").value = "";
  });
  if (saved) report("Collegamento salvato. Sincronizza per completarlo.");
});
$("connectService").addEventListener("click", () => run(async () => {
  const client = await services(), provider = $("settingsService").value;
  const url = await client.connect(provider, { clientId: $("clientId").value, appId: $("qobuzAppId").value, token: $("qobuzToken").value });
  $("qobuzAppId").value = ""; $("qobuzToken").value = "";
  if (url) location.assign(url);
  else { await serviceSettings(); report("Qobuz collegato."); }
}));
$("disconnectService").addEventListener("click", () => run(async () => {
  const client = await services(); client.disconnect($("settingsService").value);
  await serviceSettings(); report("Servizio scollegato.");
}));
$("linkTarget").addEventListener("change", () => {
  try { localStorage.setItem(MUSIC_LINK_TARGET_KEY, $("linkTarget").value); render(); }
  catch (error) { report(error.message, true); }
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => $(button.dataset.close).close()));
window.addEventListener("storage", (event) => {
  if ([MUSIC_LINK_TARGET_KEY, "accord-listening-album-durations-v1", "accord-listening-queue-v1"].includes(event.key)) render();
  if (event.key === null || event.key === "accord-album-pwa-v1") {
    report("Raccolta modificata in un'altra scheda. Ricarica prima di continuare.", true);
  }
});
const callback = new URL(location.href);
if (callback.searchParams.has("code") || callback.searchParams.has("error")) {
  run(async () => {
    try { await (await services()).finish(location.href); report("Servizio musicale collegato."); }
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
      const answer = await choice("Aggiorna PWA", [node("p", "I dati salvati restano. I campi non salvati verranno persi.")],
        [["cancel", "Annulla"], ["update", "Aggiorna"]]);
      if (answer === "update" && registration.waiting) {
        navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
        registration.waiting.postMessage({ type: "accord-activate-update" });
      }
    }));
  }).catch((error) => report(`Modalita' offline non disponibile: ${error.message}`, true));
}
