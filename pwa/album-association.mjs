import { validEdition, sourceIdentity, editionLink } from "./music-continuity.mjs?v=11";
import { nativeMusicLink, configureMusicAppLink } from "./music-app-links.mjs?v=3";
import { showEditionComparison } from "./edition-comparison.mjs?v=2";
import { associationCaptions, libraryChoice, manuallyUnavailable, readLibraryChoices,
  writeLibraryChoice } from "./music-library-choices.mjs?v=2";

const normalized = (value) => String(value || "").normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
const identity = (albums) => JSON.stringify(albums.map(album =>
  [album.id, album.artist, album.name, album.year ?? null, album.url ?? null])
  .sort((a, b) => a[0].localeCompare(b[0])));
const captions = associationCaptions;

export function playbackEditions(storage, album, links = JSON.parse(storage.getItem("accord-music-edition-links-v1") || "{}")) {
  return ["spotify", "tidal", "qobuz"].flatMap(provider => {
    const record = validEdition(provider, album.id) ? album : editionLink(storage, album, provider, links);
    return record ? [{ provider, album: record }] : [];
  });
}

export function openPlaybackServiceDialog({ storage, album, provider, report }) {
  const choices = readLibraryChoices(storage), preferred = libraryChoice(choices, album).preferred;
  const editions = playbackEditions(storage, album).filter(row => row.provider !== provider
    && !manuallyUnavailable(choices, album, row.provider)).sort((a, b) => Number(b.provider === preferred) - Number(a.provider === preferred));
  const dialog = document.createElement("dialog"); dialog.setAttribute("aria-label", "Scegli dove ascoltare");
  const heading = document.createElement("h2"); heading.textContent = "Scegli dove ascoltare";
  const notice = document.createElement("p");
  notice.textContent = `${album.artist} · ${album.name}. Nessuna edizione collegata al servizio scelto. `
    + "Scegli un servizio solo per questo album: il servizio principale non cambia. "
    + "Mostriamo album nativi e associazioni salvate, non una verifica attuale del catalogo. "
    + "L'apertura del link non avvia automaticamente l'audio.";
  dialog.append(heading, notice);
  for (const row of editions) {
    const link = document.createElement("a");
    link.textContent = `Apri in ${{ spotify: "Spotify", tidal: "TIDAL", qobuz: "Qobuz" }[row.provider]}`;
    link.addEventListener("click", event => {
      try {
        const current = playbackEditions(storage, album).find(item => item.provider === row.provider);
        if (!current || current.album.id !== row.album.id) throw new Error("Associazione cambiata: riapri la scelta del servizio.");
        if (manuallyUnavailable(readLibraryChoices(storage), album, row.provider)) throw new Error("Servizio segnato non disponibile: rivedi le indicazioni manuali.");
        writeLibraryChoice(storage, album, { preferred: row.provider });
      } catch (error) {
        event.preventDefault(); event.stopImmediatePropagation(); report(error.message, true); return;
      }
      dialog.close();
    });
    configureMusicAppLink(link, row.album.url, { query: `${album.artist} ${album.name}`, report, storage });
    if (row.provider === preferred) link.textContent += " (ultima scelta)";
    const paragraph = document.createElement("p"); paragraph.append(link); dialog.append(paragraph);
  }
  if (!editions.length) {
    const empty = document.createElement("p");
    empty.textContent = "Non ci sono altri servizi gia' collegati. Associa prima un'edizione dal menu dell'album.";
    dialog.append(empty);
  }
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Annulla";
  cancel.addEventListener("click", () => dialog.close()); dialog.append(cancel);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog); dialog.showModal();
  return dialog;
}

export function associationLinkId(provider, value) {
  let text = String(value).trim();
  if (text.startsWith("https://")) text = nativeMusicLink(text, { desktop: true });
  const prefix = { spotify: "spotify:album:", tidal: "tidal://album/", qobuz: "qobuzapp://album/" }[provider];
  if (prefix && text.startsWith(prefix)) {
    const id = text.slice(prefix.length);
    text = provider === "spotify" ? id : `${provider}:${id}`;
  }
  if (!validEdition(provider, text)) throw new Error("Incolla un link album del servizio scelto, non un brano o una playlist.");
  return text;
}

export function openEditionChooser({ provider, load, selected, search, query = "", sourceAlbum = null, observed = () => {},
  searchNow = false, focusLink = false }) {
  const dialog = document.createElement("dialog"); dialog.setAttribute("aria-label", "Associa edizione");
  const heading = document.createElement("h2"); heading.textContent = `Associa edizione · ${provider.toUpperCase()}`;
  const notice = document.createElement("p");
  notice.textContent = "Cerca nel catalogo oppure incolla il link dell'album, poi scegli l'edizione da associare. Nessuna aggiunta ai preferiti.";
  const searchLabel = document.createElement("label"); searchLabel.textContent = "Artista o titolo nel catalogo";
  const searchInput = document.createElement("input"); searchInput.type = "text"; searchInput.value = query;
  searchLabel.append(searchInput);
  const catalog = document.createElement("button"); catalog.type = "button"; catalog.textContent = "Cerca nel catalogo";
  const label = document.createElement("label"); label.textContent = "Link album del servizio scelto";
  const input = document.createElement("input"); input.type = "text"; input.placeholder = `Link album ${provider.toUpperCase()}`;
  label.append(input);
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const results = document.createElement("div"); results.className = "association-results";
  const compare = document.createElement("button"); compare.type = "button";
  compare.textContent = "Confronta edizioni selezionate (2–4)"; compare.disabled = true;
  compare.hidden = !["tidal", "qobuz"].includes(provider);
  let compared = [];
  compare.addEventListener("click", () => {
    try { showEditionComparison(compared.filter(row => row.check.checked).map(row => row.album), provider); }
    catch (error) { status.textContent = error.message; }
  });
  const actions = document.createElement("div"); actions.className = "dialog-actions";
  const read = document.createElement("button"); read.type = "button"; read.textContent = "Leggi album dal link";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Annulla";
  label.append(read);
  actions.append(compare, cancel);
  dialog.append(heading, notice, searchLabel, catalog, label, status, results, actions); document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  cancel.addEventListener("click", () => dialog.close());
  const readCatalog = async (fromLink) => {
    if (read.disabled) return;
    read.disabled = true;
    catalog.disabled = true;
    results.replaceChildren(); compared = []; compare.disabled = true;
    status.textContent = "Lettura del catalogo in corso...";
    try {
      let page;
      if (fromLink) {
        const id = associationLinkId(provider, input.value);
        const album = await load(id);
        if (album?.id !== id) throw new Error("Il catalogo ha restituito un album diverso dal link.");
        page = { albums: [album], complete: true };
      } else {
        const text = searchInput.value.trim();
        if (!text) throw new Error("Inserisci artista o titolo da cercare.");
        page = await search(text);
      }
      if (!dialog.open) return;
      if (page.albums.some(album => !validEdition(provider, album.id))) throw new Error("Risposta del catalogo con identita' album non valida.");
      const compatible = page.albums.filter(record => sourceAlbum
        && normalized(record.artist) === normalized(sourceAlbum.artist) && normalized(record.name) === normalized(sourceAlbum.name)
        && (!sourceAlbum.year || !record.year || String(sourceAlbum.year) === String(record.year)));
      observed(page.complete !== true ? "incomplete" : compatible.length > 1 ? "ambiguous"
        : page.albums.length ? "review" : "missing");
      for (const album of page.albums) {
        const row = document.createElement("article");
        const title = document.createElement("p");
        title.textContent = `${album.artist} · ${album.name} · ${album.year || "Anno sconosciuto"}`;
        const choose = document.createElement("button"); choose.type = "button"; choose.textContent = "Associa questa edizione";
        choose.addEventListener("click", () => { if (dialog.open) { dialog.close(); selected(album); } });
        row.append(title, choose);
        if (!compare.hidden) {
          const label = document.createElement("label"); label.className = "check";
          const check = document.createElement("input"); check.type = "checkbox"; check.checked = false;
          const caption = document.createElement("span"); caption.textContent = "Confronta";
          check.addEventListener("change", () => {
            const count = compared.filter(row => row.check.checked).length;
            compare.disabled = count < 2 || count > 4;
          });
          label.append(check, caption); row.append(label); compared.push({ album, check });
        }
        results.append(row);
      }
      status.textContent = `${page.albums.length} album trovati. Scegli un'edizione da associare.`
        + (page.complete ? "" : " Risultati parziali: affina la ricerca se necessario.");
    } catch (error) {
      if (dialog.open) {
        status.textContent = error.message;
        try { observed("error"); }
        catch (failure) { status.textContent += ` Esito non salvato: ${failure.message}`; }
      }
    } finally { read.disabled = false; catalog.disabled = false; }
  };
  read.addEventListener("click", () => readCatalog(true));
  catalog.addEventListener("click", () => readCatalog(false));
  input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void readCatalog(true); } });
  searchInput.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void readCatalog(false); } });
  dialog.showModal();
  if (focusLink) input.focus();
  if (searchNow) void readCatalog(false);
  return dialog;
}

export async function prepareAssociations(albums, links, provider, search, guard = () => {}, progress = () => {}, targetIds = null, unavailableIds = []) {
  if (!["spotify", "tidal", "qobuz"].includes(provider)) throw new Error("Scegli Spotify, TIDAL o Qobuz.");
  if (!links || typeof links !== "object" || Array.isArray(links)) throw new Error("Associazioni locali non leggibili.");
  albums = structuredClone(albums); links = structuredClone(links);
  const identifiers = targetIds === null ? null : new Set(targetIds);
  const targets = identifiers === null ? albums : albums.filter(album => identifiers.has(album.id));
  const rows = [];
  for (const [index, album] of targets.entries()) {
    guard(); progress(`Ricerca ${index + 1}/${targets.length}: ${album.artist} · ${album.name}`);
    const entry = links[album.id];
    if (entry !== undefined && (!entry || typeof entry !== "object" || Array.isArray(entry))) {
      throw new Error("Associazioni locali non leggibili.");
    }
    const row = { album, state: "native", selected: null };
    if (unavailableIds.includes(album.id)) row.state = "unavailable";
    else if (!validEdition(provider, album.id)) {
      const saved = links[album.id]?.[provider];
      if (saved) {
        if (!validEdition(provider, saved.id)) throw new Error("Associazione locale non valida.");
        row.state = saved.source === sourceIdentity(album) ? "linked" : "stale";
      } else {
        let page;
        try { page = await search(album); }
        catch (error) {
          guard();
          row.state = "error"; rows.push(row); break;
        }
        guard();
        const candidates = new Map();
        for (const candidate of page.albums) {
          if (!validEdition(provider, candidate.id)) throw new Error("Identita' album del catalogo non valida.");
          if (normalized(candidate.artist) === normalized(album.artist) && normalized(candidate.name) === normalized(album.name)
              && (!album.year || !candidate.year || String(album.year) === String(candidate.year))) candidates.set(candidate.id, candidate);
        }
        row.state = page.complete !== true ? "incomplete" : candidates.size === 1 ? "found"
          : candidates.size ? "ambiguous" : "missing";
        if (row.state === "found") row.selected = [...candidates.values()][0];
      }
    }
    rows.push(row);
  }
  return { provider, albums, links, rows };
}

export function associationUpdates(plan, albums, links) {
  if (identity(albums) !== identity(plan.albums) || JSON.stringify(links) !== JSON.stringify(plan.links)) {
    throw new Error("Raccolta o associazioni cambiate: ripeti la ricerca prima di confermare.");
  }
  const updated = structuredClone(links);
  for (const { album, selected, state } of plan.rows) {
    if (state !== "found") continue;
    if (!validEdition(plan.provider, selected.id)) throw new Error("Associazione al catalogo non valida.");
    if (updated[album.id]?.[plan.provider]) throw new Error("Associazione gia' presente: nessuna sostituzione automatica.");
    updated[album.id] ||= {};
    updated[album.id][plan.provider] = { id: selected.id, name: selected.name, source: sourceIdentity(album) };
  }
  return updated;
}

export function openEditionAssociationDialog({ album, edition, provider, save, open, report }) {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "Associa edizione");
  const heading = document.createElement("h2"); heading.textContent = "Associa edizione";
  const notice = document.createElement("p");
  notice.textContent = `Associare ${album.artist} · ${album.name} a ${edition.artist} · ${edition.name}? `
    + "Collegamento locale. Nessun album unito, nessun voto trasferito.";
  const label = document.createElement("label"); label.className = "check";
  const check = document.createElement("input"); check.type = "checkbox"; check.checked = false;
  const caption = document.createElement("span");
  caption.textContent = `Apri anche il link album ${provider === "tidal" ? "TIDAL" : provider === "qobuz" ? "Qobuz" : "Spotify"}`;
  label.append(check, caption);
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const actions = document.createElement("div"); actions.className = "dialog-actions";
  const confirm = document.createElement("button"); confirm.type = "button"; confirm.textContent = "Associa";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Annulla";
  actions.append(confirm, cancel); dialog.append(heading, notice, label, status, actions);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  cancel.addEventListener("click", () => dialog.close());
  confirm.addEventListener("click", () => {
    if (confirm.disabled) return;
    confirm.disabled = true;
    try { save(); }
    catch (error) {
      status.textContent = error.message; report(error.message, true); confirm.disabled = false;
      return;
    }
    dialog.close();
    report("Edizione associata sul dispositivo. Album e voti invariati.");
    if (check.checked) {
      try { open(); }
      catch (error) { report(`Associazione salvata; apertura non riuscita: ${error.message}`, true); }
    }
  });
  dialog.showModal();
  return dialog;
}

export function openAssociationDialog({ albums, links, provider, search, guard, save, report, closed, targetIds = null,
  unavailableIds = [], observed = () => {} }) {
  const count = targetIds === null ? albums.length : albums.filter(album => targetIds.includes(album.id)).length;
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "Associa gli album filtrati");
  const heading = document.createElement("h2"); heading.textContent = `Associa tutti a ${provider.toUpperCase()}`;
  const notice = document.createElement("p");
  notice.textContent = `${count} album nei filtri attivi, su tutte le pagine. Solo letture del catalogo e collegamenti locali. `
    + "Artista e titolo esatti, anno compatibile e una sola edizione. Associazioni esistenti, album, voti e preferiti non cambiano. "
    + "Gli esiti delle letture restano locali anche annullando. Dopo un errore le letture si fermano: gli album successivi non sono stati cercati.";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const preview = document.createElement("pre"); preview.className = "association-preview";
  const actions = document.createElement("div"); actions.className = "dialog-actions";
  const start = document.createElement("button"); start.type = "button"; start.textContent = "Cerca negli album filtrati";
  const apply = document.createElement("button"); apply.type = "button"; apply.textContent = "Associa corrispondenze"; apply.disabled = true;
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Annulla";
  actions.append(start, apply, cancel); dialog.append(heading, notice, status, preview, actions); document.body.append(dialog);
  let running = false, cancelled = false, plan = null;
  const check = () => { if (cancelled || !dialog.open) throw new Error("Ricerca annullata: nessuna associazione salvata."); guard(); };
  const close = () => { cancelled = true; if (!running) dialog.close(); else status.textContent = "Interruzione: attendo la lettura corrente. Nessuna modifica salvata."; };
  cancel.addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => { dialog.remove(); closed(); }, { once: true });
  start.addEventListener("click", async () => {
    if (running) return;
    running = true; start.disabled = true; apply.disabled = true; plan = null;
    try {
      plan = await prepareAssociations(albums, links, provider, search, check, message => { status.textContent = message; }, targetIds, unavailableIds);
      check();
      observed(plan);
      const found = plan.rows.filter(row => row.state === "found").length;
      status.textContent = `${found} nuove associazioni su ${plan.rows.length} album. I casi dubbi restano da verificare.`;
      preview.textContent = plan.rows.map(row => `${row.album.artist} · ${row.album.name}: ${captions[row.state]}`).join("\n");
      apply.textContent = `Associa ${found} album`; apply.disabled = !found;
    } catch (error) {
      status.textContent = `${error.message} Nessuna associazione salvata.`;
      report(status.textContent, true);
    } finally { running = false; if (cancelled) dialog.close(); }
  });
  apply.addEventListener("click", () => {
    if (apply.disabled || !plan || running) return;
    apply.disabled = true;
    try {
      check(); save(plan); dialog.close();
      report(`${plan.rows.filter(row => row.state === "found").length} album associati localmente a ${provider.toUpperCase()}. Nessuna modifica al servizio.`);
    } catch (error) { status.textContent = error.message; report(error.message, true); }
  });
  dialog.showModal();
  return dialog;
}
