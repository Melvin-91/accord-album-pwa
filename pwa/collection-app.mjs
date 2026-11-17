import { reconcileAlbumCards, validateAlbum } from "./core.mjs?v=54";
import { createCollectionStore, createCollectionCoverCache } from "./collection-store.mjs?v=7";
import { createCollectionSync } from "./collection-sync.mjs?v=7";
import { configureMusicAppLink, MUSIC_LINK_TARGET_KEY } from "./music-app-links.mjs?v=4";
import { openTidalPreview } from "./tidal-preview.mjs?v=1";
import { albumSearchMatch, shortReleaseKind } from "./music-suggestion-filters.mjs?v=4";
import { installCommandIcons } from "./command-icons.mjs?v=1";
import { installSelectWheelGuard } from "./ui.mjs?v=25";
import { showEditionComparison } from "./edition-comparison.mjs?v=2";
import { durationProvenanceText } from "./music-completion.mjs?v=5";
import { RECENT_CATALOG_SEARCHES, recentCatalogSearches, rememberCatalogSearch, clearCatalogSearches, catalogSearchCorrections,
  filteredCollection, collectionAnomalies } from "./collection-qol.mjs?v=1";

installCommandIcons(document);
installSelectWheelGuard(document);

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
const comparedEditions = new Set();
let revealedAlbum = null, revealOrigin = null, quickReview = null;
const collectionFilters = () => ({ query: $("search").value, status: $("statusFilter").value,
  favoritesOnly: $("favoritesFilter").checked, favoriteIds: store.state.preferences.favoriteIds || [] });
const matchingAlbums = () => filteredCollection(store.state.albums, collectionFilters());
function revealCollectionAlbum(id) {
  if (!store.state.albums.some((album) => album.id === id)) throw new Error("Album non piu' presente.");
  if (!revealedAlbum) revealOrigin = { scroll: scrollY, limit: visibleLimit };
  revealedAlbum = id;
  $("addDialog").close(); $("settingsDialog").close();
  render();
  requestAnimationFrame(() => {
    const card = [...$("albumList").children].find((item) => item.dataset.id === id);
    card?.querySelector(".album-options")?.setAttribute("open", "");
    card?.querySelector("summary")?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "center" });
  });
}
function refreshCatalogSearches() {
  const select = $("recentCatalogSearches");
  select.replaceChildren(node("option", "Scegli una ricerca, poi premi Cerca", { value: "" }));
  $("catalogCorrections").replaceChildren();
  try {
    recentCatalogSearches(localStorage, $("catalogService").value).forEach((value) => select.append(node("option", value, { value })));
  } catch (error) {
    const message = error.message + " Usa Svuota recenti per ripristinarle.";
    $("catalogCorrections").append(node("p", message, { role: "alert" }));
    report(message, true);
  }
}
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
  if (!servicesPromise) servicesPromise = import("./collection-services.mjs?v=10")
    .then(({ createCollectionServices }) => createCollectionServices({
      storage: localStorage, session: sessionStorage, pageUrl: location.href }));
  return servicesPromise;
}
function disable() {
  document.querySelectorAll("header button, #collectionDock button, #filters input, #filters select, #albumList button, #albumList select, #moreAlbums, #openQuickReview, #returnToFilters, #quickReviewDialog button, #quickReviewDialog select, #addDialog button:not([data-close]), #addDialog input, #addDialog select, #settingsDialog button:not(#cancelDurations), #settingsDialog input, #settingsDialog select")
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
  const result = await client.albumDuration(album, { signal, withProvenance: true });
  return store.saveMissingDuration(album, result.duration, result.provenance);
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
  const source = resultCoverUrls.get(album.id) || urls.get(album.id);
  if (source && (trustedCoverUrl(source) || source === urls.get(album.id))) {
    card.append(node("img", "", { src: source, alt: `Copertina: ${album.name}`,
      width: "112", height: "112", class: "comparison-artwork", referrerpolicy: "no-referrer" }));
  }
  const facts = node("dl");
  const values = { Servizio: providerName(album), Anno: album.year || "-", Stato: states[album.status],
    Voto: album.rating ?? "-", Preferito: favorite ? "Si" : "No", Generi: album.genres.join(", ") || "-",
    Collezioni: album.collections.join(", ") || "-", Tag: album.tags.join(", ") || "-", Note: album.notes || "-",
    Durata: store.durations()[album.id] ? durationText(store.durations()[album.id]) : "Non disponibile", "ID catalogo": album.id };
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
    node("p", "Motivo: " + found.reason),
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
  const favoriteButton = node("button", "", { type: "button", "data-command-icon": "star",
    class: "favorite", "aria-pressed": String(favorite), "aria-label": `Preferito: ${album.name}`,
    title: favorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti" });
  favoriteButton.dataset.control = "favorite";
  favoriteButton.addEventListener("click", () => {
    if (mutate(() => store.favorite(album.id))) report("Preferito salvato su questo dispositivo.");
  });
  const metadata = node("div", "", { class: "album-metadata muted" });
  metadata.append(node("span", `${album.year || "-"} - ${providerName(album)}`));
  if (duration) metadata.append(node("span", durationText(duration), {
    class: "album-duration", "aria-label": `Durata: ${durationText(duration)}`,
  }));
  card.append(artwork, node("h2", album.name), node("p", album.artist), metadata);
  const stateLine = node("div", "", { class: "album-state-line" });
  stateLine.append(node("span", states[album.status]), node("span",
    album.rating === null ? "Senza voto" : `Voto ${String(album.rating).replace(".", ",")}`));
  card.append(stateLine);
  const options = node("details", "", { class: "album-options", name: "collection-album" });
  options.append(node("summary", "Gestisci album", { "data-control": "options", "data-command-icon": "settings" }));
  options.addEventListener("toggle", () => {
    if (options.open && options.isConnected) closeAlbumOptions(options);
  });
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
  controls.append(statusLabel, ratingLabel); options.append(controls);
  if (duration) {
    const provenance = node("details"), details = node("pre");
    provenance.append(node("summary", "Provenienza durata"), details);
    provenance.addEventListener("toggle", () => {
      if (!provenance.open) return;
      try { details.textContent = durationProvenanceText(localStorage, album, duration); }
      catch (error) { details.textContent = error.message; report(error.message, true); }
    });
    options.append(provenance);
  }
  const footer = node("div", "", { class: "card-actions" }), open = node("a", "Apri", {
    rel: "noopener noreferrer", "aria-label": `Apri album: ${album.name}` });
  configureMusicAppLink(open, album.url, { storage: localStorage,
    query: `${album.artist} ${album.name}`, report: (message) => report(message) });
  const remove = node("button", "Rimuovi", { type: "button", "data-control": "remove", class: "secondary" });
  remove.addEventListener("click", () => run(() => confirmRemoval([album.id])));
  const management = node("div", "", { class: "dialog-actions" });
  management.append(remove);
  options.append(management);
  if (/^tidal:[1-9][0-9]*$/.test(album.id)) {
    const preview = node("button", "Anteprima TIDAL · 30 s", { type: "button", class: "secondary" });
    preview.addEventListener("click", () => {
      try { openTidalPreview(document, album); }
      catch (error) { report(error.message, true); }
    });
    management.append(preview);
  }
  footer.append(favoriteButton, open); card.append(footer, options);
  return card;
}
function closeAlbumOptions(except = null) {
  document.querySelectorAll("#albumList .album-options[open]").forEach((details) => {
    if (details !== except) details.open = false;
  });
}
function render() {
  if (!store) return;
  const favorites = new Set(store.state.preferences.favoriteIds || []);
  const durations = store.durations();
  document.documentElement.dataset.textScale = ["large", "larger"].includes(store.state.preferences.textScale) ? store.state.preferences.textScale : "normal";
  document.documentElement.dataset.contrast = store.state.preferences.contrast === "high" ? "high" : "standard";
  document.documentElement.dataset.density = store.state.preferences.density === "compact" ? "compact" : "touch";
  const filtered = matchingAlbums();
  const revealed = store.state.albums.find((album) => album.id === revealedAlbum);
  if (revealed && !filtered.some((album) => album.id === revealedAlbum)) filtered.unshift(revealed);
  if (revealed) visibleLimit = Math.max(visibleLimit, filtered.findIndex((album) => album.id === revealedAlbum) + 1);
  $("returnToFilters").hidden = !revealedAlbum;
  const active = document.activeElement, activeId = active?.closest(".album-card")?.dataset.id, control = active?.dataset.control;
  const wanted = filtered.slice(0, visibleLimit).map((album) => {
    const signature = JSON.stringify([album, favorites.has(album.id), durations[album.id], localStorage.getItem(MUSIC_LINK_TARGET_KEY)]);
    const old = cards.get(album.id);
    if (!old || old.signature !== signature) {
      const oldImage = old?.element.querySelector("img");
      if (oldImage) coverObserver.unobserve(oldImage);
      const element = albumCard(album, favorites.has(album.id), durations[album.id]);
      element.querySelector(".album-options").open = Boolean(old?.element.querySelector(".album-options")?.open);
      cards.set(album.id, { signature, element });
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
  comparedEditions.clear();
  $("compareCatalogEditions").hidden = true;
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
    const compareLabel = node("label", "", { class: "check" }), compare = node("input", "", {
      type: "checkbox", "aria-label": `Confronta edizione: ${album.name} (${album.year || "-"})` });
    compare.addEventListener("change", () => {
      if (compare.checked && comparedEditions.size >= 4) {
        compare.checked = false; report("Confronta al massimo quattro edizioni alla volta.", true); return;
      }
      if (compare.checked) comparedEditions.add(album.id); else comparedEditions.delete(album.id);
      $("compareCatalogEditions").hidden = comparedEditions.size < 2;
    });
    compareLabel.append(compare, document.createTextNode("Confronta edizione")); row.append(compareLabel);
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
    if (duplicate) {
      const evidence = node("details");
      evidence.append(node("summary", "Perche' gia' presente?"), node("p", duplicate.reason, { class: "muted" }));
      row.append(evidence);
      const reveal = node("button", "Apri la copia in raccolta", { type: "button", class: "secondary" });
      reveal.addEventListener("click", () => {
        try { revealCollectionAlbum(duplicate.album.id); } catch (error) { report(error.message, true); }
      });
      row.append(reveal);
    }
    row.append(button); $("catalogResults").append(row);
  }
}
function reviewDirty() {
  return quickReview && (quickReview.status.value !== quickReview.album.status
    || (quickReview.rating.value ? Number(quickReview.rating.value) : null) !== quickReview.album.rating);
}
async function leaveQuickReview(offset = null) {
  if (busy || !quickReview) return;
  if (reviewDirty() && await choice("Modifiche non salvate", [node("p", "Stato e voto non salvati saranno scartati.")],
    [["cancel", "Resta qui"], ["discard", "Scarta e continua"]]) !== "discard") return;
  if (offset === null) $("quickReviewDialog").close();
  else {
    quickReview.index += offset;
    showQuickReview();
  }
}
function showQuickReview() {
  const dialog = $("quickReviewDialog"), current = store.state.albums.find((album) => album.id === quickReview.ids[quickReview.index]);
  if (!current) { report("Album non piu' presente: revisione interrotta. Le modifiche gia' salvate restano.", true); dialog.close(); return; }
  quickReview.album = current;
  const title = node("h2", "Revisione rapida"), progress = node("p",
    `${quickReview.index + 1} di ${quickReview.ids.length} · ${providerName(current)}`, { class: "muted" });
  const name = node("h3", current.name), artist = node("p", `${current.artist} · ${current.year || "-"}`);
  const controls = node("div", "", { class: "album-controls" }), statusLabel = node("label", "Ascolto");
  const status = node("select", "", { "aria-label": "Stato della revisione", id: "quickReviewStatusValue" });
  Object.entries(states).forEach(([value, text]) => status.append(node("option", text, { value })));
  status.value = current.status; statusLabel.append(status);
  const ratingLabel = node("label", "Voto"), rating = node("select", "", { "aria-label": "Voto della revisione", id: "quickReviewRating" });
  rating.append(node("option", "Senza voto", { value: "" }));
  for (let value = .5; value <= 5; value += .5) rating.append(node("option", String(value).replace(".", ","), { value }));
  rating.value = current.rating === null ? "" : String(current.rating); ratingLabel.append(rating);
  quickReview.status = status; quickReview.rating = rating;
  controls.append(statusLabel, ratingLabel);
  const message = node("p", "Salva solo questo album. L'elenco iniziale resta stabile anche se cambi stato.", {
    id: "quickReviewStatus", role: "status" });
  const actions = node("div", "", { class: "dialog-actions" });
  const previous = node("button", "Precedente", { type: "button", class: "secondary" });
  previous.disabled = quickReview.index === 0;
  previous.addEventListener("click", () => { void leaveQuickReview(-1); });
  const skip = node("button", "Salta", { type: "button", class: "secondary" });
  skip.disabled = quickReview.index + 1 === quickReview.ids.length;
  skip.addEventListener("click", () => { void leaveQuickReview(1); });
  const close = node("button", "Chiudi", { type: "button", class: "secondary" });
  close.addEventListener("click", () => { void leaveQuickReview(); });
  const save = node("button", quickReview.index + 1 === quickReview.ids.length ? "Salva e termina" : "Salva e successivo", {
    id: "quickReviewSave", type: "button" });
  save.addEventListener("click", () => {
    if (busy) return;
    try {
      store.assertCurrent();
      const actual = store.state.albums.find((album) => album.id === current.id);
      if (JSON.stringify(actual) !== JSON.stringify(current)) throw new Error("Album cambiato: chiudi e riapri la revisione.");
      const changes = { status: status.value, rating: rating.value ? Number(rating.value) : null };
      if (reviewDirty()) store.update(current.id, changes);
      quickReview.album = store.state.albums.find((album) => album.id === current.id);
      render();
      if (quickReview.index + 1 === quickReview.ids.length) {
        dialog.close(); report("Revisione completata sul dispositivo. Sincronizza per condividere le modifiche.");
      } else {
        quickReview.index += 1; showQuickReview();
      }
    } catch (error) { message.textContent = error.message; report(error.message, true); }
  });
  actions.append(previous, skip, close, save);
  dialog.replaceChildren(title, progress, name, artist, controls, message, actions);
  if (!dialog.open) dialog.showModal();
  status.focus({ preventScroll: true });
}
async function reviewMetadata() {
  const provenance = JSON.parse(localStorage.getItem("accord-music-completion-provenance-v1") || "{}");
  const issues = collectionAnomalies(store.state.albums, store.durations(), provenance);
  const content = node("div"), category = node("select", "", { "aria-label": "Tipo di anomalia" });
  category.append(node("option", "Tutte le anomalie", { value: "" }));
  [...new Set(issues.map(({ reason }) => reason))].sort().forEach((value) => category.append(node("option", value, { value })));
  const listing = node("div"), byId = new Map(store.state.albums.map((album) => [album.id, album]));
  function populate() {
    listing.replaceChildren();
    for (const issue of issues.filter(({ reason }) => !category.value || reason === category.value)) {
      const album = byId.get(issue.id), row = node("article", "", { class: "catalog-result" });
      row.append(node("h3", `${album.artist} - ${album.name}`), node("p", issue.reason));
      const open = node("button", "Apri album per verificare", { type: "button", class: "secondary" });
      open.addEventListener("click", () => $("choiceDialog").close(`album:${album.id}`));
      row.append(open); listing.append(row);
    }
  }
  category.addEventListener("change", populate); populate(); content.append(category, listing);
  const answer = await choice("Revisione anomalie", [node("p", `${issues.length} segnalazioni locali. Non sono tutte errori: `
    + "verifica l'edizione. Nessuna sovrascrittura automatica e nessuna richiesta ai cataloghi."), content],
  [["cancel", "Chiudi"]]);
  if (answer.startsWith("album:")) revealCollectionAlbum(answer.slice(6));
}
async function performSync() {
  report("Lettura della raccolta condivisa...");
  const completed = await sync.sync({
    onProgress: (message) => report(message),
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
  refreshCatalogSearches();
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
const dockObserver = new ResizeObserver(() => {
  document.documentElement.style.setProperty("--dock-height", `${Math.ceil($("collectionDock").getBoundingClientRect().height)}px`);
});
dockObserver.observe($("collectionDock"));
$("collectionHome").addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "auto" });
  $("collectionTitle").focus({ preventScroll: true });
});
$("search").addEventListener("input", () => {
  revealedAlbum = null; revealOrigin = null; visibleLimit = 40; closeAlbumOptions(); render();
});
["statusFilter", "favoritesFilter"].forEach((id) => $(id).addEventListener("change", () => {
  revealedAlbum = null; revealOrigin = null; visibleLimit = 40; closeAlbumOptions(); render();
}));
$("moreAlbums").addEventListener("click", () => { visibleLimit += 40; render(); });
$("openQuickReview").addEventListener("click", () => {
  if (busy || !store) return;
  const ids = matchingAlbums().map((album) => album.id);
  if (!ids.length) { report("Nessun album nei filtri correnti da rivedere."); return; }
  quickReview = { ids, index: 0, scroll: scrollY };
  showQuickReview();
});
$("quickReviewDialog").addEventListener("cancel", (event) => {
  event.preventDefault(); void leaveQuickReview();
});
$("quickReviewDialog").addEventListener("close", () => {
  const scroll = quickReview?.scroll || 0;
  quickReview = null;
  requestAnimationFrame(() => { $("openQuickReview").focus({ preventScroll: true }); window.scrollTo({ top: scroll }); });
});
$("reviewMetadata").addEventListener("click", () => run(reviewMetadata));
$("returnToFilters").addEventListener("click", () => {
  const origin = revealOrigin;
  revealedAlbum = null; revealOrigin = null; visibleLimit = origin?.limit || 40; render();
  requestAnimationFrame(() => window.scrollTo({ top: origin?.scroll || 0, behavior: "auto" }));
});
$("sync").addEventListener("click", () => run(performSync));
$("cancelDurations").addEventListener("click", () => durationAbort?.abort());
$("updateDurations").addEventListener("click", () => run(async () => {
  const client = await services(), provider = client.provider, controller = new AbortController();
  const known = store.durations();
  const missing = store.state.albums.filter((album) => !Object.hasOwn(known, album.id));
  const failed = [], unavailable = new Map();
  let completed = 0, index = 0;
  durationAbort = controller; disable();
  try {
    for (const album of missing) {
      if (controller.signal.aborted) break;
      index += 1;
      $("durationStatus").textContent = `Durate: ${index} su ${missing.length} · ${album.name}`;
      if (unavailable.has(provider)) { failed.push(`${album.name}: ${unavailable.get(provider)}`); continue; }
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
    durationAbort = null; disable();
  }
  const details = failed;
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
  refreshCatalogSearches();
  $("catalogStatus").textContent = "Cerca per titolo e artista, oppure incolla un link album.";
    $("addDialog").showModal();
    $("catalogBody").scrollTop = 0;
  });
  if ($("addDialog").open && !busy) $("catalogQuery").focus();
});
$("catalogService").addEventListener("change", () => run(async () => {
  (await services()).select($("catalogService").value); generation += 1; resultAlbums = []; renderResults();
  refreshCatalogSearches();
}));
$("recentCatalogSearches").addEventListener("change", () => {
  if ($("recentCatalogSearches").value) $("catalogQuery").value = $("recentCatalogSearches").value;
});
$("clearCatalogSearches").addEventListener("click", async () => {
  try { clearCatalogSearches(localStorage, $("catalogService").value); refreshCatalogSearches(); }
  catch (error) {
    report(error.message, true);
    if (await choice("Ripristina ricerche recenti", [node("p", "Impossibile aggiornare le ricerche recenti. Eliminare soltanto "
      + "le ricerche recenti di tutti i cataloghi? Raccolta e account restano invariati.")],
    [["cancel", "Annulla"], ["clear", "Elimina cronologia ricerche"]]) === "clear") {
      try { localStorage.removeItem(RECENT_CATALOG_SEARCHES); refreshCatalogSearches(); }
      catch (failure) { report(failure.message, true); }
    }
  }
});
$("suggestCatalogCorrections").addEventListener("click", () => {
  try {
    const candidates = store.state.albums.flatMap((album) => [album.name, album.artist, `${album.artist} ${album.name}`]);
    candidates.push(...recentCatalogSearches(localStorage, $("catalogService").value));
    const proposals = catalogSearchCorrections($("catalogQuery").value, candidates);
    $("catalogCorrections").replaceChildren();
    for (const proposal of proposals) {
      const use = node("button", `Usa: ${proposal}`, { type: "button", class: "secondary" });
      use.addEventListener("click", () => { $("catalogQuery").value = proposal; $("catalogCorrections").replaceChildren(); });
      $("catalogCorrections").append(use);
    }
    if (!proposals.length) $("catalogCorrections").append(node("p", "Nessuna correzione locale affidabile."));
  } catch (error) { report(error.message, true); }
});
$("compareCatalogEditions").addEventListener("click", () => {
  try {
    const selected = resultAlbums.filter((album) => comparedEditions.has(album.id)).map((album) => ({
      ...album, ...resultMetadata.get(album.id), cover_url: resultCoverUrls.get(album.id),
      ...(store.durations()[album.id] ? { duration_ms: store.durations()[album.id] } : {}) }));
    showEditionComparison(selected, $("catalogService").value);
  } catch (error) { report(error.message, true); }
});
$("catalogForm").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const client = await services(), current = ++generation;
    if (!$("addDialog").open) return;
    rememberCatalogSearch(localStorage, $("catalogService").value, $("catalogQuery").value);
    refreshCatalogSearches();
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
