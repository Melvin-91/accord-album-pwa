import { exportCredentials, decryptCredentials, restoreCredentials } from "./credential-backup.mjs?v=1";
import { reconcileAlbumCards, validateAlbum } from "./core.mjs?v=54";
import { createCollectionStore, createCollectionCoverCache } from "./collection-store.mjs?v=13";
import { createCollectionSync } from "./collection-sync.mjs?v=11";
import { configureMusicAppLink, openAssociatedEditionDialog, selectedMusicEdition, setTidalAlbumLinkResolver,
  webMusicLink, MUSIC_LINK_TARGET_KEY } from "./music-app-links.mjs?v=7";
import { associationUpdates, openAssociationDialog } from "./album-association.mjs?v=15";
import { LIBRARY_CHOICES_KEY, readLibraryChoices, changeLibraryChoice, manuallyUnavailable } from "./music-library-choices.mjs?v=2";
import { openTidalPreview } from "./tidal-preview.mjs?v=1";
import { albumSearchMatch, shortReleaseKind } from "./music-suggestion-filters.mjs?v=4";
import { commandIconElement, commandIconName, installCommandIcons } from "./command-icons.mjs?v=4";
import { installSelectWheelGuard } from "./ui.mjs?v=25";
import { showEditionComparison } from "./edition-comparison.mjs?v=4";
import { initializePhysicalCollection } from "./physical-collection-ui.mjs?v=3";
import { PHYSICAL_KEY } from "./physical-collection.mjs?v=2";
import { RECENT_CATALOG_SEARCHES, recentCatalogSearches, rememberCatalogSearch, clearCatalogSearches, catalogSearchCorrections,
  collectionRows, collectionGenres, collectionAnomalies, catalogSearchFields, catalogSearchInput } from "./collection-qol.mjs?v=6";

installCommandIcons(document);
installSelectWheelGuard(document);

const $ = (id) => document.getElementById(id);
const states = { queued: "Da ascoltare", listening: "In ascolto",
  liked: "Mi piace", neutral: "Neutro", disliked: "Non mi piace" };
const stateIcon = (status) => commandIconElement(commandIconName(states[status]), document);
const refreshStateIcon = (label, status) => {
  const icon = label.querySelector(":scope > .command-icon");
  if (icon) icon.replaceWith(stateIcon(status));
};
const providerName = (album) => album.id.startsWith("tidal:") ? "TIDAL" : album.id.startsWith("qobuz:") ? "Qobuz" : "Spotify";
const musicServiceName = (provider) => ({ spotify: "Spotify", tidal: "TIDAL", qobuz: "Qobuz" })[provider] || "non noto";
const musicService = () => ["spotify", "tidal", "qobuz"].includes(localStorage.getItem("accord-music-service-v1"))
  ? localStorage.getItem("accord-music-service-v1") : "spotify";
const EDITION_LINKS_KEY = "accord-music-edition-links-v1";
const DURATION_FAILURES_KEY = "accord-duration-retry-failures-v1";
const node = (tag, text = "", attributes = {}) => {
  const value = document.createElement(tag); value.textContent = text;
  Object.entries(attributes).forEach(([key, item]) => value.setAttribute(key, item));
  return value;
};
let store, sync, physicalCollection, servicesPromise, catalogAbort, durationAbort, busy = false, visibleLimit = 40, resultAlbums = [], generation = 0;
const covers = createCollectionCoverCache(indexedDB), cards = new Map(), urls = new Map();
let resultCoverUrls = new Map();
let resultMetadata = new Map();
const comparedEditions = new Set();
let revealedAlbum = null, revealOrigin = null, quickReview = null;
const collectionFilters = () => ({ query: $("search").value, status: $("statusFilter").value, genre: $("genreFilter").value,
  format: $("formatFilter").value, favoritesOnly: $("favoritesFilter").checked, favoriteIds: store.state.preferences.favoriteIds || [] });
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
const catalogInputs = { artist: "catalogArtist", title: "catalogTitle", reference: "catalogReference" };
const catalogLabels = { artist: "Artista", title: "Titolo", reference: "Link/ID" };
const catalogFields = () => Object.fromEntries(Object.entries(catalogInputs).map(([key, id]) => [key, $(id).value]));

function refreshCatalogSearches() {
  const select = $("recentCatalogSearches");
  select.replaceChildren(node("option", "Scegli una ricerca, poi premi Cerca", { value: "" }));
  $("catalogCorrections").replaceChildren();
  try {
    const provider = $("catalogService").value;
    recentCatalogSearches(localStorage, provider).forEach((value) => {
      const fields = catalogSearchFields(provider, value);
      const label = typeof value === "string" ? value : Object.keys(catalogInputs)
        .filter((key) => fields[key]).map((key) => `${catalogLabels[key]}: ${fields[key]}`).join(" · ");
      select.append(node("option", label, { value: JSON.stringify(fields) }));
    });
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
  if (!servicesPromise) servicesPromise = import("./collection-services.mjs?v=21")
    .then(({ createCollectionServices }) => createCollectionServices({
      storage: localStorage, session: sessionStorage, pageUrl: location.href }));
  return servicesPromise;
}
setTidalAlbumLinkResolver(localStorage, async (value) => {
  const expected = store.state, links = localStorage.getItem(EDITION_LINKS_KEY);
  const service = localStorage.getItem("accord-music-service-v1");
  const revision = localStorage.getItem("accord-music-auth-revision-v1");
  const client = await services(), settings = client.settings("tidal");
  const configuredClient = settings.clientId;
  const guard = () => {
    store.assertCurrent();
    if (store.state !== expected || localStorage.getItem(EDITION_LINKS_KEY) !== links
        || localStorage.getItem("accord-music-service-v1") !== service
        || localStorage.getItem("accord-music-auth-revision-v1") !== revision
        || client.settings("tidal").clientId !== configuredClient) {
      throw new Error("Raccolta, associazione o account cambiato: riapri il collegamento.");
    }
  };
  guard();
  if (client.provider !== "tidal" || !settings.connected) {
    report("Apertura del link originale: disponibilita' non verificata. Seleziona e collega TIDAL per verificarla.");
    return value;
  }
  let result;
  try {
    result = await client.resolveTidalAlbum(webMusicLink(value));
  } catch (error) {
    guard();
    if (!confirm(`Verifica TIDAL non riuscita: ${error.message}\nAprire comunque il link originale senza verifica?`)) return null;
    guard();
    return value;
  }
  guard();
  if (result.album.id !== result.original.id && !confirm(
    `${result.original.artist} · ${result.original.name}\nL'edizione ${result.original.id.slice(6)} `
    + `non e' riproducibile in ${result.country}.\nAprire l'edizione disponibile ${result.album.id.slice(6)}? `
    + "Album, voti e associazioni restano invariati.")) return null;
  guard();
  return result.album.url;
});
function disable() {
  document.querySelectorAll("header button, #collectionDock button, #filters input, #filters select, #albumList button, #albumList select, #moreAlbums, #openQuickReview, #returnToFilters, #quickReviewDialog button, #quickReviewDialog select, #addDialog button:not([data-close]), #addDialog input, #addDialog select, #settingsDialog button:not(#cancelDurations), #settingsDialog input, #settingsDialog select")
    .forEach((element) => { element.disabled = busy || !store; });
  physicalCollection?.setBusy(busy);
  $("collection").setAttribute("aria-busy", String(busy));
  $("cancelCatalogSearch").hidden = !catalogAbort;
  $("cancelCatalogSearch").disabled = !catalogAbort;
  $("cancelDurations").hidden = !durationAbort;
  $("cancelDurations").disabled = !durationAbort;
}
const durationText = (milliseconds) => {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
};
function durationFailures() {
  const saved = JSON.parse(localStorage.getItem(DURATION_FAILURES_KEY) || "{}");
  if (!saved || typeof saved !== "object" || Array.isArray(saved)
      || Object.entries(saved).some(([id, row]) => !row || row.id !== id
        || typeof row.name !== "string" || typeof row.artist !== "string"
        || !["spotify", "tidal", "qobuz"].includes(row.provider)
        || !Array.isArray(row.attemptedProviders) || typeof row.reason !== "string")) {
    throw new Error("Registro dei tentativi di durata non valido.");
  }
  return saved;
}
function saveDurationFailures(failures) {
  localStorage.setItem(DURATION_FAILURES_KEY, JSON.stringify(failures));
}
function durationFailure(album, provider, error) {
  const attemptedProviders = Array.isArray(error.durationAttempts)
    ? error.durationAttempts.filter((item) => ["spotify", "tidal", "qobuz"].includes(item)) : [provider];
  const deadlines = attemptedProviders.map((item) => Number(localStorage.getItem(`accord-${item}-cooldown-until-v1`) || 0))
    .filter((value) => Number.isFinite(value) && value > Date.now());
  const wait = Number(error.retry_after || error.retryAfter || 0);
  if (wait > 0) deadlines.push(Date.now() + wait * 1000);
  const seconds = Number(error.message.match(/attendi\s+(\d+)\s+secondi/i)?.[1] || 0);
  if (seconds > 0) deadlines.push(Date.now() + seconds * 1000);
  const record = { id: album.id, artist: album.artist, name: album.name, provider,
    attemptedProviders, reason: error.message || String(error) };
  if (deadlines.length) record.retryAt = Math.max(...deadlines);
  return record;
}
function clearDurationFailure(id) {
  const failures = durationFailures();
  if (Object.hasOwn(failures, id)) { delete failures[id]; saveDurationFailures(failures); }
}
function renderDurationFailures() {
  const container = $("durationFailures");
  container.replaceChildren();
  const saved = durationFailures(), durations = store.durations();
  const records = Object.values(saved).filter((record) =>
    store.state.albums.some((album) => album.id === record.id) && !Object.hasOwn(durations, record.id));
  container.hidden = records.length === 0;
  if (!records.length) return;
  container.append(node("h3", `Durate in sospeso · ${records.length}`));
  const retryAll = node("button", "Riprova solo i falliti",
    { type: "button", class: "secondary", "data-retry-duration": "all" });
  container.append(retryAll);
  for (const record of records) {
    const row = node("div", "", { class: "duration-failure" });
    const attempted = record.attemptedProviders.length
      ? record.attemptedProviders.map(musicServiceName).join(", ") : "nessun catalogo interrogato";
    let retry = "";
    if (record.retryAt > Date.now()) retry = ` · riprova dopo ${new Date(record.retryAt).toLocaleString("it")}`;
    row.append(node("p", `${record.artist} · ${record.name} — ${attempted}: ${record.reason}${retry}`));
    const button = node("button", "Riprova",
      { type: "button", class: "secondary", "data-retry-duration": record.id });
    row.append(button); container.append(row);
  }
}
async function updateAlbumDuration(album, client, signal, provider) {
  if (Object.hasOwn(store.durations(), album.id)) return false;
  const result = await client.albumDuration(album, { signal, withProvenance: true, provider });
  const saved = store.saveMissingDuration(album, result.duration, result.provenance);
  if (saved) clearDurationFailure(album.id);
  return saved;
}
async function runDurationRecovery(records) {
  const client = await services(), controller = new AbortController();
  const currentAlbums = new Map(store.state.albums.map((album) => [album.id, album]));
  const known = store.durations(), failures = durationFailures(), blocked = new Map();
  const targets = records.filter((record) => currentAlbums.has(record.id) && !Object.hasOwn(known, record.id));
  if (!targets.length) { $("durationStatus").textContent = "Non ci sono durate mancanti da recuperare."; return; }
  let completed = 0, index = 0;
  durationAbort = controller; disable();
  try {
    for (const record of targets) {
      if (controller.signal.aborted) break;
      const album = currentAlbums.get(record.id), provider = record.provider || client.provider;
      index += 1;
      $("durationStatus").textContent = `Durate: ${index} su ${targets.length} · ${album.name}`;
      if (blocked.has(provider)) {
        failures[album.id] = { ...durationFailure(album, provider, new Error(blocked.get(provider))),
          attemptedProviders: [] };
        saveDurationFailures(failures);
        continue;
      }
      try {
        if (await updateAlbumDuration(album, client, controller.signal, provider)) completed += 1;
      } catch (error) {
        if (controller.signal.aborted) break;
        failures[album.id] = durationFailure(album, provider, error);
        saveDurationFailures(failures);
        if (/HTTP (401|403|429)\b|attendi|limite|accesso .*non attivo/i.test(error.message)) {
          blocked.set(provider, error.message);
        }
      }
    }
  } finally {
    durationAbort = null; disable();
  }
  const remainingDurations = store.durations();
  const remaining = Object.values(durationFailures()).filter((record) =>
    currentAlbums.has(record.id) && !Object.hasOwn(remainingDurations, record.id)).length;
  const status = `${controller.signal.aborted ? "Interrotto. " : ""}${completed} durate aggiunte.`
    + (remaining ? ` ${remaining} in sospeso; puoi riprovare singolarmente o tutti i falliti.` : "");
  $("durationStatus").textContent = status;
  renderDurationFailures();
  report(status, remaining > 0);
}
function fetchAddedDuration(album) {
  void (async () => {
    try {
      const client = await services();
      const saved = await updateAlbumDuration(album, client);
      if (saved) { render(); report(`Album aggiunto. Durata recuperata per ${album.name}.`); }
    } catch (error) {
      try {
        const client = await services(), failures = durationFailures();
        failures[album.id] = durationFailure(album, client.provider, error);
        saveDurationFailures(failures); renderDurationFailures();
      } catch (saveError) { report(`Durata non disponibile per ${album.name}; registro fallimenti non salvato: ${saveError.message}`, true); return; }
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
async function choice(title, content, actions, validate = () => true, signal) {
  signal?.throwIfAborted();
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
    const abort = () => dialog.close("cancel");
    dialog.addEventListener("close", () => {
      signal?.removeEventListener("abort", abort);
      resolve(dialog.returnValue);
    }, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
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
async function compareCandidate(candidate, found, physical = null) {
  const hasPhysical = Boolean(physical?.cd || physical?.vinyl);
  const expected = store.state, row = node("div", "", { class: "comparison-grid" });
  row.append(comparison(found.album, (expected.preferences.favoriteIds || []).includes(found.album.id)), comparison(candidate));
  const actions = [];
  if (found.confidence !== "uncertain") {
    const formats = [physical?.cd && "CD", physical?.vinyl && "Vinile"].filter(Boolean).join(" e ");
    const keepLabel = hasPhysical ? `Mantieni la copia e registra ${formats}` : "Mantieni la copia in raccolta";
    actions.push(["keep", keepLabel]);
  }
  actions.push(["cancel", "Annulla senza modifiche"]);
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
  if (answer === "keep") {
    if (hasPhysical) store.addPhysical([{ artist: found.album.artist, title: found.album.name,
      cd: physical.cd, vinyl: physical.vinyl }]);
    const coverError = await cacheCatalogCover(found.album.id, candidate.id);
    report(coverError ? `${hasPhysical ? "Possesso salvato" : "Copia mantenuta"}, ma copertina non memorizzata: ${coverError}`
      : hasPhysical ? "Possesso fisico salvato sulla copia in raccolta." : "Copia mantenuta in raccolta.",
    Boolean(coverError));
  } else if (answer === "replace") {
    const confirmed = await choice("Sostituisci copia", [node("p",
      "Voti e note della vecchia copia non verranno trasferiti. La rimozione sara' sincronizzata.")],
    [["cancel", "Annulla"], ["replace", "Sostituisci"]]);
    if (confirmed === "replace") {
      store.add(candidate, { replaceId: found.album.id, physical });
      fetchAddedDuration(candidate);
      const saveError = await cacheCatalogCover(candidate.id);
      report(saveError ? `Copia sostituita, ma copertina non salvata: ${saveError}`
        : "Copia sostituita. Sincronizza per aggiornare gli altri dispositivi.", Boolean(saveError));
    } else if (hasPhysical) report("Sostituzione annullata: i formati selezionati non sono stati registrati.");
  } else if (answer === "distinct") {
    const duplicate = store.add(candidate, { distinct: true, physical });
    if (duplicate) throw new Error("Lo stesso identificativo non puo' essere aggiunto due volte.");
    fetchAddedDuration(candidate);
    const saveError = await cacheCatalogCover(candidate.id);
    report(saveError ? `Album aggiunto, ma copertina non salvata: ${saveError}`
      : "Album aggiunto come copia distinta.", Boolean(saveError));
  } else if (answer === "cancel" && hasPhysical) {
    report("Confronto annullato senza modifiche: i formati selezionati non sono stati registrati.");
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
  const favoriteButton = node("button", "", { type: "button", "data-command-icon": "heart",
    class: "favorite", "aria-pressed": String(favorite), "aria-label": `Preferito: ${album.name}`,
    title: favorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti" });
  favoriteButton.dataset.control = "favorite";
  favoriteButton.addEventListener("click", () => {
    if (mutate(() => store.favorite(album.id))) report("Preferito salvato su questo dispositivo.");
  });
  const metadata = node("div", "", { class: "album-metadata muted" });
  const genre = album.primary_genre || album.genres[0];
  metadata.append(node("span", [`${album.year || "-"} - ${providerName(album)}`, genre].filter(Boolean).join(" · ")));
  if (duration) metadata.append(node("span", durationText(duration), {
    class: "album-duration", "aria-label": `Durata: ${durationText(duration)}`,
  }));
  card.append(artwork, node("h2", album.name), node("p", album.artist), metadata);
  const stateLine = node("div", "", { class: "album-state-line" });
  const currentState = node("span", states[album.status], { class: "album-listening-state" });
  currentState.prepend(stateIcon(album.status));
  stateLine.append(currentState, node("span",
    album.rating === null ? "Senza voto" : `Voto ${String(album.rating).replace(".", ",")}`));
  card.append(stateLine);
  const options = node("details", "", { class: "album-options", name: "collection-album" });
  options.append(node("summary", "Gestisci album", { "data-control": "options", "data-command-icon": "controls" }));
  options.addEventListener("toggle", () => {
    if (options.open && options.isConnected) closeAlbumOptions(options);
  });
  const controls = node("div", "", { class: "album-controls" });
  const statusLabel = node("label", "Ascolto"), status = node("select", "", { "data-control": "status" });
  statusLabel.prepend(stateIcon(album.status));
  Object.entries(states).forEach(([value, label]) => status.append(node("option", label, { value })));
  status.value = album.status; statusLabel.append(status);
  status.addEventListener("change", () => mutate(() => store.update(album.id, { status: status.value })));
  const ratingLabel = node("label", "Voto"), rating = node("select", "", { "data-control": "rating" });
  rating.append(node("option", "Senza voto", { value: "" }));
  for (let value = 0.5; value <= 5; value += 0.5) rating.append(node("option", String(value).replace(".", ","), { value }));
  rating.value = album.rating === null ? "" : String(album.rating); ratingLabel.append(rating);
  rating.addEventListener("change", () => mutate(() => store.update(album.id, { rating: rating.value ? Number(rating.value) : null })));
  controls.append(statusLabel, ratingLabel); options.append(controls);
  const footer = node("div", "", { class: "card-actions" }), target = musicService();
  let playback = null;
  try { playback = selectedMusicEdition(localStorage, album, target); }
  catch (error) { report(error.message, true); }
  const open = node(playback ? "a" : "button", playback ? `Apri in ${musicServiceName(target)}` : `Nessun link ${musicServiceName(target)}`, {
    ...(playback ? { rel: "noopener noreferrer" } : { type: "button", class: "secondary" }),
    "aria-label": `${playback ? "Apri" : "Associa"} album ${album.name} su ${musicServiceName(target)}` });
  if (playback) configureMusicAppLink(open, playback.url, { storage: localStorage,
    query: `${album.artist} ${album.name}`, report,
    beforeOpen() {
      store.assertCurrent();
      const current = store.state.albums.find((item) => item.id === album.id);
      if (!current || current.artist !== album.artist || current.name !== album.name || musicService() !== target) {
        throw new Error("Album o servizio cambiato: riapri la scheda.");
      }
      const selected = selectedMusicEdition(localStorage, current, target);
      if (!selected || selected.id !== playback.id || selected.url !== playback.url) {
        throw new Error("Associazione cambiata: riapri la scheda.");
      }
    } });
  else open.addEventListener("click", () => report(
    `Nessuna edizione collegata a ${musicServiceName(target)}. Usa “Controlla collegamenti” nelle impostazioni; Spotify non viene aperto come ripiego.`));
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
  const openWith = node("button", "Apri con…", { type: "button", class: "secondary" });
  openWith.addEventListener("click", () => {
    try {
      openAssociatedEditionDialog({ storage: localStorage, album, provider: album.id.startsWith("tidal:")
        ? "tidal" : album.id.startsWith("qobuz:") ? "qobuz" : "spotify", report });
    } catch (error) { report(error.message, true); }
  });
  footer.append(favoriteButton, open, openWith); card.append(footer, options);
  return card;
}
function closeAlbumOptions(except = null) {
  document.querySelectorAll("#albumList .album-options[open]").forEach((details) => {
    if (details !== except) details.open = false;
  });
}
function render() {
  if (!store) return;
  const genreSelect = $("genreFilter"), selectedGenre = genreSelect.value;
  const genres = collectionGenres(store.state.albums);
  const options = [["", "Tutti i generi"], ["none", "Senza genere"],
    ...genres.map(([key, label]) => [`g:${key}`, label])];
  if (selectedGenre && !options.some(([value]) => value === selectedGenre)) {
    const label = genreSelect.selectedOptions[0].textContent;
    options.push([selectedGenre, label.endsWith(" (non più presente)") ? label : `${label} (non più presente)`]);
  }
  if (JSON.stringify(options) !== JSON.stringify([...genreSelect.options].map((option) => [option.value, option.textContent]))) {
    genreSelect.replaceChildren(...options.map(([value, label]) => node("option", label, { value })));
    genreSelect.value = selectedGenre;
  }
  const favorites = new Set(store.state.preferences.favoriteIds || []);
  const durations = store.durations();
  document.documentElement.dataset.textScale = ["large", "larger"].includes(store.state.preferences.textScale) ? store.state.preferences.textScale : "normal";
  document.documentElement.dataset.contrast = store.state.preferences.contrast === "high" ? "high" : "standard";
  document.documentElement.dataset.density = store.state.preferences.density === "compact" ? "compact" : "touch";
  const { total, visible: filtered } = collectionRows(store.state.albums, store.state.physical, collectionFilters());
  if (revealedAlbum) {
    const rowIndex = filtered.findIndex((row) => row.id === revealedAlbum);
    if (rowIndex >= 0) visibleLimit = Math.max(visibleLimit, rowIndex + 1);
    else {
      const album = store.state.albums.find((item) => item.id === revealedAlbum);
      if (album) filtered.unshift(collectionRows([album], store.state.physical).visible.find((row) => row.id === album.id));
    }
  }
  $("returnToFilters").hidden = !revealedAlbum;
  const active = document.activeElement, activeId = active?.closest(".album-card")?.dataset.id, control = active?.dataset.control;
  const wanted = filtered.slice(0, visibleLimit).map(({ id, album, physical }) => {
    const signature = JSON.stringify(album
      ? [album, favorites.has(id), durations[id], localStorage.getItem(MUSIC_LINK_TARGET_KEY),
        localStorage.getItem("accord-music-service-v1"), localStorage.getItem(EDITION_LINKS_KEY)]
      : [physical.artist, physical.title]);
    const old = cards.get(id);
    if (!old || old.signature !== signature) {
      const oldImage = old?.element.querySelector("img");
      if (oldImage) coverObserver.unobserve(oldImage);
      const element = album ? albumCard(album, favorites.has(id), durations[id]) : physicalCollection.physicalCard(physical, physical);
      element.dataset.id = id;
      const options = element.querySelector(".album-options");
      if (options) options.open = Boolean(old?.element.querySelector(".album-options")?.open);
      cards.set(id, { signature, element });
    }
    const { element } = cards.get(id);
    physicalCollection.decorateCard(element, album || { artist: physical.artist, name: physical.title },
      physical || { cd: false, vinyl: false });
    return element;
  });
  reconcileAlbumCards($("albumList"), wanted);
  const retained = new Set(filtered.slice(0, visibleLimit).map((album) => album.id));
  for (const id of cards.keys()) if (!retained.has(id)) {
    const image = cards.get(id).element.querySelector("img");
    if (image) coverObserver.unobserve(image);
    cards.delete(id);
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  }
  if (activeId && control) {
    const target = [...$("albumList").children].find((card) => card.dataset.id === activeId)
      ?.querySelector(`[data-control="${control}"]`);
    if (target) target.focus({ preventScroll: true });
    else if (control.startsWith("physical-")) $("search").focus({ preventScroll: true });
  }
  $("count").textContent = `${filtered.length} album${filtered.length !== total ? ` su ${total}` : ""}`;
  $("empty").hidden = filtered.length > 0;
  $("empty").textContent = total ? "Nessun album corrisponde ai filtri." : "La raccolta è vuota. Aggiungi un album oppure sincronizza con GitHub.";
  $("moreAlbums").hidden = filtered.length <= visibleLimit;
  const pending = store.pendingChanges();
  const confirmed = store.state.lastSync ? new Date(store.state.lastSync).toLocaleString("it") : "mai";
  $("lastSync").textContent = `Ultima conferma GitHub: ${confirmed} · modifiche locali in attesa: ${pending}`;
  $("headerSyncState").textContent = store.state.lastSync ? "Raccolta condivisa" : "Raccolta sul dispositivo";
  const verificationRequired = Boolean(sync?.uncertainWrite());
  $("sync").textContent = verificationRequired ? "Verifica su GitHub" : "Sincronizza";
  $("sync").setAttribute("aria-describedby", "syncSummary");
  $("syncSummary").textContent = `Ultima conferma: ${confirmed} · ${pending} modifiche locali in attesa`
    + (verificationRequired ? " · verifica in sola lettura richiesta" : "");
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
    const physical = {};
    const physicalOptions = node("fieldset", "", { class: "physical-formats catalog-physical-formats" });
    physicalOptions.append(node("legend", "Possiedo anche"));
    for (const [format, labelText] of [["cd", "CD"], ["vinyl", "Vinile"]]) {
      const label = node("label", "", { class: "physical-check" });
      physical[format] = node("input", "", { type: "checkbox",
        "aria-label": `Possiedo ${labelText}: ${album.name} di ${album.artist}` });
      label.append(physical[format], document.createTextNode(` ${labelText}`));
      physicalOptions.append(label);
    }
    row.append(physicalOptions);
    const duplicate = store.duplicate(album), button = node("button", duplicate ? "Gia' presente: confronta" : "Aggiungi", { type: "button" });
    button.addEventListener("click", () => run(async () => {
      const formats = { cd: physical.cd.checked, vinyl: physical.vinyl.checked };
      const hasPhysical = formats.cd || formats.vinyl;
      const addWithFormats = () => store.add(album, { physical: formats });
      const current = store.duplicate(album);
      if (current) { await compareCandidate(album, current, formats); return; }
      const remote = await sync.checkAddition(album);
      if (remote) {
        const answer = await choice("Album gia' presente", [
          comparison(remote.album), node("p",
            "Non e' stata aggiunta un'altra copia. Sincronizza per caricare quella esistente.")],
        [["cancel", "Chiudi"], ["sync", "Sincronizza"]]);
        if (answer === "sync") {
          await performSync();
          const current = store.duplicate(album);
          if (current) await compareCandidate(album, current, formats);
        }
        return;
      }
      const found = addWithFormats();
      if (found) await compareCandidate(album, found, formats);
      else {
        fetchAddedDuration(album);
        const saveError = await cacheCatalogCover(album.id);
        const formatsText = hasPhysical ? ` Possesso registrato: ${[
          formats.cd ? "CD" : "", formats.vinyl ? "Vinile" : "",
        ].filter(Boolean).join(" e ")}.` : "";
        report(saveError ? `Album aggiunto.${formatsText} Copertina non salvata: ${saveError}`
          : `Album aggiunto.${formatsText} Sincronizza per condividerlo.`, Boolean(saveError));
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
  statusLabel.prepend(stateIcon(current.status));
  Object.entries(states).forEach(([value, text]) => status.append(node("option", text, { value })));
  status.value = current.status; statusLabel.append(status);
  status.addEventListener("change", () => refreshStateIcon(statusLabel, status.value));
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
  if (sync.uncertainWrite()) {
    const result = await sync.verifyUncertainWrite();
    render();
    const outcome = result.verified ? `GitHub conferma l'invio di ${result.file}.`
      : result.missing ? `GitHub non mostra ${result.file}: l'invio precedente non è confermato.`
        : `Su GitHub ${result.file} è diverso da quello atteso: l'invio precedente non è confermato.`;
    report(`${outcome} Nessun dato inviato. Premi Sincronizza per rileggere la raccolta e rivedere eventuali modifiche.`);
    return;
  }
  report("Lettura della raccolta condivisa...");
  const reviewedConflicts = [];
  const labels = { album: "Album", status: "Stato", rating: "Voto", genres: "Generi",
    primary_genre: "Genere principale", collections: "Collezioni", tags: "Tag", notes: "Note",
    favorite: "Preferito", pinned: "In evidenza", year: "Anno", url: "Collegamento",
    cover_sha256: "Copertina", duration_ms: "Durata" };
  const valueText = (value, fieldName, record) => {
    if (fieldName.startsWith("edition_link:")) return value ? `${value.name} (${value.id}; ${value.source.join(" / ")})` : "Rimossa";
    if (value === null || value === undefined || value === "") return record ? "Vuoto" : "Non presente";
    if (fieldName === "album" && typeof value === "object") return `${value.artist} - ${value.name}`;
    if (fieldName === "cover_sha256") return "Aggiornata";
    if (Array.isArray(value)) return value.length ? value.join(", ") : "Vuoto";
    if (typeof value === "boolean") return value ? "Si" : "No";
    if (fieldName === "status" && Object.hasOwn(states, value)) return states[value];
    if (fieldName === "rating" && typeof value === "number") return `${value} / 5`;
    if (fieldName === "duration_ms" && typeof value === "number") return durationText(value);
    if (typeof value === "object") return record?.artist && record?.name ? `${record.artist} - ${record.name}` : JSON.stringify(value);
    return String(value);
  };
  const completed = await sync.sync({
    onProgress: (message) => report(message),
    async chooseConflicts(conflicts) {
      const content = [node("p", "Scegli quale versione mantenere per ogni modifica.")], controls = [];
      conflicts.forEach((conflict) => {
        const album = conflict.local || conflict.remote || conflict.base;
        content.push(node("h3", `${album.artist} - ${album.name}`));
        conflict.fields.forEach((field) => {
          const label = node("label", field.field.startsWith("edition_link:")
            ? `Associazione ${field.field.slice("edition_link:".length)}` : labels[field.field] || field.field);
          const value = node("select");
          value.append(node("option", "Scegli...", { value: "" }),
            node("option", `Mantieni questo dispositivo: ${valueText(field.local, field.field, conflict.local)}`, { value: "local" }),
            node("option", `Usa la raccolta condivisa: ${valueText(field.remote, field.field, conflict.remote)}`, { value: "remote" }));
          label.append(value); content.push(label); controls.push({ id: conflict.id, field: field.field, value });
        });
      });
      const answer = await choice("Scegli cosa mantenere", content, [["cancel", "Annulla"], ["continue", "Continua"]],
        () => controls.every(({ value }) => value.value));
      if (answer !== "continue") return null;
      const choices = Object.create(null);
      controls.forEach(({ id, field, value }) => { choices[id] ||= Object.create(null); choices[id][field] = value.value; });
      conflicts.forEach((conflict) => reviewedConflicts.push({
        ...conflict,
        fields: conflict.fields.map((field) => ({
          ...field, selected: choices[conflict.id]?.[field.field],
        })),
      }));
      return choices;
    },
    async confirm({ local, remote, albums, durationOutgoing = [], durationIncoming = [], coversOutgoing,
      physicalOutgoing, physicalIncoming, migrating, linksOutgoing, linkChangesOutgoing = [], linkChangesIncoming = [] }) {
      const linkChangeText = ({ id, provider, previous, next }) =>
        `Associazione ${id} / ${provider}: ${valueText(previous, "edition_link:", null)} → ${valueText(next, "edition_link:", null)}`;
      const changesTo = (previous) => {
        const old = new Map(previous.map((album) => [album.id, album]));
        const next = new Map(albums.map((album) => [album.id, album]));
        return [...new Set([...old.keys(), ...next.keys()])].flatMap((id) => {
          const before = old.get(id), after = next.get(id);
          const album = after || before, title = `${album.artist} - ${album.name} (${providerName(album)})`;
          if (!before) return [`Aggiungi: ${title}`];
          if (!after) return [`Rimuovi: ${title}`];
          const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
            .filter((field) => !["id", "updated_at"].includes(field)
              && JSON.stringify(before[field]) !== JSON.stringify(after[field])).sort();
          if (!fields.length) return [];
          return [`Modifica: ${title}`, ...fields.map((field) =>
            `  ${labels[field] || field}: ${valueText(before[field], field, before)} → ${valueText(after[field], field, after)}`)];
        });
      };
      const conflictLines = reviewedConflicts.flatMap((conflict) => {
        const album = conflict.local || conflict.remote || conflict.base;
        return [`${album.artist} - ${album.name}`, ...conflict.fields.map((field) =>
          `  ${labels[field.field] || field.field}: base ${valueText(field.base, field.field, conflict.base)} · `
            + `questo dispositivo ${valueText(field.local, field.field, conflict.local)} · `
            + `raccolta condivisa ${valueText(field.remote, field.field, conflict.remote)} · `
            + `mantenuto ${field.selected === "local" ? "questo dispositivo" : "raccolta condivisa"}`)];
      });
      const content = [node("p", migrating
        ? "La prima sincronizzazione riunisce gli archivi in library.json. Le copie precedenti restano su GitHub. Usa un desktop compatibile con library.json per sincronizzare questa raccolta."
        : "Controlla le modifiche prima di sincronizzare."),
        node("h3", "Da inviare"), node("pre", [...changesTo(remote),
          ...(coversOutgoing ? ["Aggiorna l'archivio delle copertine."] : []),
          ...(physicalOutgoing ? ["Aggiorna i supporti CD e Vinile."] : []),
          ...(linksOutgoing && !linkChangesOutgoing.length ? ["Ripristina l'archivio delle associazioni."] : []),
          ...linkChangesOutgoing.map(linkChangeText),
          ...durationOutgoing.map((row) => `Durata: ${row.artist} - ${row.name} (${durationText(row.duration_ms)})`)].join("\n") || "Nessuna modifica."),
        node("h3", "Da ricevere"), node("pre", [...changesTo(local),
          ...(physicalIncoming ? ["Aggiorna i supporti CD e Vinile su questo dispositivo."] : []),
          ...linkChangesIncoming.map(linkChangeText),
          ...durationIncoming.map((row) => `Durata: ${row.artist} - ${row.name} (${durationText(row.duration_ms)})`)].join("\n") || "Nessuna modifica."),
        node("h3", "Conflitti"), node("pre", conflictLines.join("\n") || "Nessun conflitto.")];
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
  render();
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
let collectionAssociationOpen = false;
async function checkCollectionAssociations() {
  if (collectionAssociationOpen) return;
  const client = await services(), provider = $("settingsService").value;
  client.select(provider);
  const linksSnapshot = localStorage.getItem(EDITION_LINKS_KEY), links = JSON.parse(linksSnapshot || "{}");
  let choicesSnapshot = localStorage.getItem(LIBRARY_CHOICES_KEY);
  const choices = readLibraryChoices(localStorage);
  const guard = () => {
    store.assertCurrent();
    if (client.provider !== provider) throw new Error("Servizio musicale cambiato: ripeti il controllo.");
    if (localStorage.getItem(EDITION_LINKS_KEY) !== linksSnapshot
        || localStorage.getItem(LIBRARY_CHOICES_KEY) !== choicesSnapshot) {
      throw new Error("Collegamenti o scelte locali cambiati: ripeti il controllo.");
    }
  };
  collectionAssociationOpen = true;
  try {
    openAssociationDialog({
      albums: store.state.albums, links, provider,
      unavailableIds: store.state.albums.filter(album => manuallyUnavailable(choices, album, provider)).map(album => album.id),
      observed: plan => {
        guard();
        let updated = readLibraryChoices(localStorage);
        for (const row of plan.rows) if (!["native", "linked", "unavailable"].includes(row.state)) {
          updated = changeLibraryChoice(updated, row.album, { provider, state: row.state });
        }
        localStorage.setItem(LIBRARY_CHOICES_KEY, JSON.stringify(updated));
        choicesSnapshot = localStorage.getItem(LIBRARY_CHOICES_KEY);
      },
      search: async album => {
        guard();
        const query = `${album.artist} ${album.name}`;
        if (query.length > 100) return { albums: [], complete: false };
        const options = { withCompleteness: true };
        if (provider === "spotify") options.criteria = { artist: album.artist, title: album.name };
        const page = await client.search(query, options);
        guard();
        return page;
      },
      save: plan => {
        guard();
        const currentLinks = JSON.parse(localStorage.getItem(EDITION_LINKS_KEY) || "{}");
        const updated = associationUpdates(plan, store.state.albums, currentLinks);
        localStorage.setItem(EDITION_LINKS_KEY, JSON.stringify(updated));
        render();
        report(`${plan.rows.filter(row => row.state === "found").length} album collegati a ${musicServiceName(provider)} su questo dispositivo.`);
      },
      report,
      closed: () => { collectionAssociationOpen = false; },
    });
  } catch (error) {
    collectionAssociationOpen = false;
    throw error;
  }
}
try {
  store = createCollectionStore(localStorage);
  physicalCollection = initializePhysicalCollection({ store, report, render });
  sync = createCollectionSync({ storage: localStorage, store, covers, unified: true });
  render();
  renderDurationFailures();
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
["statusFilter", "genreFilter", "formatFilter", "favoritesFilter"].forEach((id) => $(id).addEventListener("change", () => {
  revealedAlbum = null; revealOrigin = null; visibleLimit = 40; closeAlbumOptions(); render();
}));
$("moreAlbums").addEventListener("click", () => { visibleLimit += 40; render(); });
$("openQuickReview").addEventListener("click", () => {
  if (busy || !store) return;
  const { visible } = collectionRows(store.state.albums, store.state.physical, collectionFilters());
  const ids = visible.filter(({ album }) => album).map(({ id }) => id);
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
  const client = await services(), known = store.durations();
  const missing = store.state.albums.filter((album) => !Object.hasOwn(known, album.id))
    .map((album) => ({ id: album.id, provider: client.provider }));
  if (!missing.length) {
    $("durationStatus").textContent = "Non ci sono durate mancanti. I fallimenti precedenti non vengono riprovati automaticamente.";
    return;
  }
  await runDurationRecovery(missing);
}));
$("durationFailures").addEventListener("click", (event) => {
  const button = event.target.closest("[data-retry-duration]");
  if (!button) return;
  try {
    const saved = durationFailures();
    const records = button.dataset.retryDuration === "all" ? Object.values(saved)
      : [saved[button.dataset.retryDuration]].filter(Boolean);
    if (records.length) void run(() => runDurationRecovery(records));
  } catch (error) { report(error.message, true); }
});
$("duplicates").addEventListener("click", () => {
  try { $("settingsDialog").close(); showDuplicates(); } catch (error) { report(error.message, true); }
});
$("openAdd").addEventListener("click", async () => {
  await run(async () => {
  const client = await services(); $("catalogService").value = client.provider;
  refreshCatalogSearches();
  $("catalogStatus").textContent = "Scegli un catalogo e premi Cerca quando hai compilato i campi.";
  physicalCollection.showCatalog();
  $("addDialog").showModal();
  $("catalogBody").scrollTop = 0;
  });
  if ($("addDialog").open && !busy) $("catalogArtist").focus();
});
$("catalogService").addEventListener("change", () => run(async () => {
  (await services()).select($("catalogService").value); generation += 1; resultAlbums = []; renderResults();
  refreshCatalogSearches();
}));
$("recentCatalogSearches").addEventListener("change", () => {
  const value = $("recentCatalogSearches").value;
  if (!value) return;
  const fields = JSON.parse(value);
  for (const [key, id] of Object.entries(catalogInputs)) $(id).value = fields[key];
  $("catalogCorrections").replaceChildren();
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
    const provider = $("catalogService").value, output = $("catalogCorrections");
    const recent = recentCatalogSearches(localStorage, provider).map((value) => catalogSearchFields(provider, value));
    output.replaceChildren();
    for (const [key, albumField] of [["artist", "artist"], ["title", "name"]]) {
      const input = $(catalogInputs[key]);
      const candidates = [...store.state.albums.map((album) => album[albumField]), ...recent.map((row) => row[key])];
      for (const proposal of catalogSearchCorrections(input.value, candidates)) {
        const use = node("button", `${catalogLabels[key]}: ${proposal}`, { type: "button", class: "secondary" });
        use.addEventListener("click", () => { input.value = proposal; output.replaceChildren(); });
        output.append(use);
      }
    }
    if (!output.childElementCount) output.append(node("p", "Nessuna correzione locale affidabile."));
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
async function chooseTidalSearchArtists(artists, { complete }, controller) {
  const fieldset = node("fieldset"), count = node("p", "0 artisti selezionati", { "aria-live": "polite" });
  fieldset.append(node("legend", "Artisti TIDAL corrispondenti"));
  const options = artists.map(({ id, name, photoUrl }) => {
    const checkbox = node("input", "", { type: "checkbox" });
    const label = node("label", "", { class: "tidal-artist-option" });
    const photo = node("span", "", { class: "tidal-artist-photo", title: "Foto non disponibile", "aria-hidden": "true" });
    if (photoUrl) {
      const image = node("img", "", { alt: "", width: "44", height: "44", loading: "lazy",
        decoding: "async", referrerpolicy: "no-referrer" });
      image.addEventListener("load", () => photo.removeAttribute("title"), { once: true });
      image.addEventListener("error", () => image.remove(), { once: true });
      image.src = photoUrl;
      photo.append(image);
    }
    label.append(checkbox, photo, node("span", name));
    const row = node("div"); row.append(label); fieldset.append(row);
    return { id, checkbox };
  });
  const selected = () => options.filter(({ checkbox }) => checkbox.checked).map(({ id }) => id);
  const canConfirm = () => selected().length > 0 && selected().length <= 5;
  fieldset.addEventListener("change", () => {
    const size = selected().length;
    count.textContent = `${size} artisti selezionati${size > 5 ? " · Riduci la selezione a 5." : ""}`;
    $("choiceDialog").querySelector('button[value="search"]').disabled = !canConfirm();
  });
  const answer = choice("Scegli gli artisti TIDAL", [
    node("p", "Seleziona fino a 5 artisti. Leggeremo solo le discografie selezionate."),
    ...(!complete ? [node("p", "Elenco parziale: il catalogo ha altre pagine non lette.")] : []),
    fieldset, count,
  ], [["cancel", "Annulla"], ["search", "Cerca album"]], canConfirm, controller.signal);
  const confirm = $("choiceDialog").querySelector('button[value="search"]');
  if (confirm) confirm.disabled = true;
  if (await answer !== "search") controller.abort();
  controller.signal.throwIfAborted();
  return selected();
}
$("catalogForm").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const client = await services(), current = ++generation;
    if (!$("addDialog").open) return;
    const { criteria, query, reference } = catalogSearchInput(client.provider, catalogFields());
    rememberCatalogSearch(localStorage, client.provider, criteria);
    refreshCatalogSearches();
    const controller = new AbortController();
    catalogAbort = controller; resultAlbums = []; renderResults(); disable();
    report("Ricerca in corso. Puoi annullarla.");
    try {
      const albums = await client.search(query, { signal: controller.signal, reference, criteria,
        chooseArtists: (artists, info) => chooseTidalSearchArtists(artists, info, controller) });
      if (current !== generation) throw new Error("Ricerca cambiata: risultati scartati.");
      resultAlbums = albums.map(validateAlbum);
      resultCoverUrls = new Map(resultAlbums.map((album) => [album.id, client.coverUrl(album)]).filter(([, url]) => url));
      resultMetadata = new Map(resultAlbums.map((album) => [album.id, client.releaseMetadata(album)]));
      renderResults();
      report(resultAlbums.length ? `${resultAlbums.length} risultati prima dei filtri Live, Singoli ed EP.`
        : "Nessun album corrisponde nei risultati restituiti dal catalogo.");
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
let credentialBackupUrl;
function clearCredentialPassword() {
  $("credentialPassword").value = ""; $("credentialConfirm").value = "";
}
$("credentialExport")?.addEventListener("click", () => run(async () => {
  const password=$("credentialPassword").value;
  try {
    if(password!==$("credentialConfirm").value) throw Error("Le passphrase non coincidono.");
    const encrypted=await exportCredentials(localStorage,sessionStorage,password);
    if(credentialBackupUrl) URL.revokeObjectURL(credentialBackupUrl);
    credentialBackupUrl=URL.createObjectURL(new Blob([encrypted],{type:"application/json"}));
    const link=$("credentialDownload"); link.href=credentialBackupUrl; link.hidden=false;
    $("credentialStatus").textContent="Backup pronto. Tocca Scarica backup cifrato e salvalo nell'app File. Conserva la passphrase separatamente.";
  } catch(error) { $("credentialStatus").textContent=error.message; }
  finally { clearCredentialPassword(); }
}));
$("credentialRestore")?.addEventListener("click", () => run(async () => {
  const password=$("credentialPassword").value, file=$("credentialFile").files[0];
  try {
    if(!file || file.size>524288) throw Error("Seleziona un file di backup valido.");
    const values=await decryptCredentials(await file.text(),password);
    if(!window.confirm("Ripristinare le credenziali dal backup? Gli accessi dei servizi inclusi saranno sostituiti. La raccolta non viene modificata.")) return;
    const count=restoreCredentials(localStorage,sessionStorage,values);
    $("credentialStatus").textContent="Ripristinate "+count+" voci. Riavvia l'app e verifica gli accessi.";
    location.reload();
  } catch(error) { $("credentialStatus").textContent=error.message; }
  finally { clearCredentialPassword(); $("credentialFile").value=""; }
}));
$("settingsDialog")?.addEventListener("close", () => {
  clearCredentialPassword();
  if(credentialBackupUrl) { URL.revokeObjectURL(credentialBackupUrl); credentialBackupUrl=undefined; }
  $("credentialDownload").removeAttribute("href"); $("credentialDownload").hidden=true;
});
$("settingsService").addEventListener("change", () => run(serviceSettings));
$("checkAlbumLinks").addEventListener("click", () => run(checkCollectionAssociations));
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
  if ([MUSIC_LINK_TARGET_KEY, "accord-music-service-v1", EDITION_LINKS_KEY,
    "accord-listening-album-durations-v1", "accord-listening-queue-v1"].includes(event.key)) render();
  if (event.key === null || event.key === "accord-album-pwa-v1" || event.key === PHYSICAL_KEY) {
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
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((registration) => {
    function updateReady() { $("update").hidden = false; }
    if (registration.waiting) updateReady();
    registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", () => {
      if (registration.waiting && navigator.serviceWorker.controller) updateReady();
    }));
    const checkUpdate = () => {
      if (registration.waiting) updateReady();
      return registration.update().catch(() => {});
    };
    void checkUpdate();
    window.addEventListener("pageshow", checkUpdate);
    window.addEventListener("focus", checkUpdate);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void checkUpdate(); });
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
