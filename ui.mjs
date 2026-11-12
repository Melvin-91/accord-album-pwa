const LOCAL_LAYOUTS = new Set(["comfortable", "compact"]);

export function installSelectWheelGuard(document) {
  const wheel = (event) => {
    const select = event.target.closest?.("select");
    if (!select || select.multiple || select.size > 1 || document.activeElement === select
        || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    event.preventDefault();
    const view = document.defaultView;
    const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.innerHeight : 1;
    let dx = event.deltaX * factor, dy = event.deltaY * factor;
    if (event.shiftKey && !dx) { dx = dy; dy = 0; }
    for (let node = select.parentElement; node && (dx || dy); node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (/(auto|scroll|overlay)/.test(style.overflowX) && node.scrollWidth > node.clientWidth) {
        const before = node.scrollLeft;
        node.scrollLeft += dx;
        dx -= node.scrollLeft - before;
      }
      if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
        const before = node.scrollTop;
        node.scrollTop += dy;
        dy -= node.scrollTop - before;
      }
    }
    if (dx || dy) view.scrollBy(dx, dy);
  };
  document.addEventListener("wheel", wheel, { passive: false });
  return () => document.removeEventListener("wheel", wheel);
}

export function controlHelp(label) {
  const key = label.trim().replace(/[.\u2026]+$/, "").toLocaleLowerCase();
  const descriptions = {
    "sincronizza": "Confronta la raccolta locale con il repository GitHub configurato e sincronizza le modifiche.",
    "filtri": "Scegli quali album mostrare senza modificare la raccolta salvata.",
    "vista": "Regola presentazione, ordinamento e viste salvate; non modifica gli album.",
    "ascolto": "Raccoglie i comandi per scegliere e aprire la musica da ascoltare.",
    "catalogo e dati": "Raccoglie associazioni, classificazione, completamento dei metadati e controlli della raccolta.",
    "salvataggio": "Raccoglie sincronizzazione, backup, cronologia e bozze locali.",
    "altre azioni": "Apri i comandi aggiuntivi, raggruppati per funzione.",
    "preferiti": "Mostra solo gli album contrassegnati con la stellina.",
    "album preferiti": "Mostra solo gli album contrassegnati con la stellina.",
    "senza voto": "Mostra gli album a cui non hai ancora assegnato un voto.",
    "note presenti": "Mostra gli album con una nota salvata.",
    "associazione mancante": "Mostra gli album non ancora collegati al catalogo del servizio selezionato.",
    "dettagli": "Mostra le informazioni e i comandi di questo album.",
    "fissa": "Mantiene questo album prima degli altri nella raccolta, indipendentemente dall'ordinamento.",
    "non fissare": "Riporta questo album nell'ordinamento normale della raccolta.",
    "salva": "Salva i valori inseriti nel modulo corrente.",
    "annulla": "Esci da questa operazione senza confermare le modifiche proposte.",
    "chiudi": "Chiudi questo pannello o questa finestra.",
    "impostazioni": "Configura i servizi collegati e le preferenze di questo dispositivo.",
    "statistiche": "Mostra un riepilogo della raccolta usando i dati locali.",
    "comandi": "Cerca e apri un comando senza navigare nei menu.",
    "seleziona visibili": "Seleziona solo gli album attualmente mostrati dopo i filtri.",
    "azzera filtri": "Mostra tutta la raccolta mantenendo ordinamento e presentazione.",
    "selezione": "Mostra le azioni applicabili soltanto agli album selezionati.",
    "applica filtri": "Ricalcola i risultati usando i criteri selezionati.",
    "applica ricetta": "Usa i criteri della ricetta selezionata per la ricerca dei suggerimenti.",
    "indietro": "Ritorna alla vista precedente mantenendone i criteri di visualizzazione.",
    "pagina precedente": "Mostra il gruppo precedente di risultati mantenendo gli stessi filtri.",
    "pagina successiva": "Mostra il gruppo successivo di risultati mantenendo gli stessi filtri.",
    "riproduci": "Avvia la riproduzione del brano o album selezionato con il player configurato.",
    "pausa": "Mette in pausa la riproduzione corrente senza svuotare la coda.",
    "ferma": "Interrompe la riproduzione corrente.",
    "valuta": "Assegna il tuo voto all'album selezionato.",
    "segna ascoltato": "Cambia lo stato d'ascolto dell'album selezionato.",
    "fissa in evidenza": "Mantiene l'album prima degli altri senza cambiare il suo voto o la stellina.",
    "sposta all'inizio": "Porta gli album selezionati all'inizio dell'ordine manuale della raccolta.",
    "sposta in fondo": "Porta gli album selezionati alla fine dell'ordine manuale della raccolta.",
    "dettagli ricerca": "Mostra criteri e informazioni aggiuntive sulla ricerca dei suggerimenti.",
    "scorciatoie": "Mostra le combinazioni di tasti disponibili nell'interfaccia.",
    "attivit\u00e0": "Mostra le operazioni in corso e gli esiti delle operazioni recenti.",
    "preferenze e collegamenti": "Configura i servizi collegati e le preferenze di questo dispositivo.",
    "raccolta album": "Mostra gli album salvati sul dispositivo, con filtri e comandi di modifica.",
    "suggerimenti": "Cerca nuova musica usando i riferimenti e i criteri selezionati.",
    "chiudi il pannello della raccolta": "Nasconde il pannello laterale lasciando invariata la raccolta e i suoi filtri.",
    "cosa ascolto adesso?": "Sceglie un album tra quelli filtrati, senza avviare automaticamente la riproduzione.",
    "coda per tempo disponibile": "Prepara una sequenza di album con durate note entro il tempo scelto.",
    "confronta possibili duplicati": "Confronta le edizioni simili della raccolta senza unirle automaticamente.",
    "controllo qualit\u00e0 locale": "Mostra possibili anomalie nei dati della raccolta senza interrogare i servizi.",
    "statistiche locali": "Mostra un riepilogo della raccolta usando soltanto i dati del dispositivo.",
    "uniforma etichette locali": "Prepara la revisione delle varianti equivalenti di generi, collezioni e tag.",
    "cronologia modifiche locali": "Mostra le modifiche locali con il comando per ripristinarle.",
    "modifiche da sincronizzare": "Confronta i dati musicali con la base GitHub salvata, senza contattare il server.",
    "disponibilita' offline": "Controlla quali parti dell'app e della raccolta sono gia' disponibili senza rete.",
    "gestisci copertine offline": "Mostra lo spazio usato dalle immagini e permette di rimuoverle senza cancellare gli album.",
    "scarica backup locale": "Prepara il file di backup dei dati musicali locali, senza credenziali o token.",
  };
  if (descriptions[key]) return descriptions[key];
  for (const [prefix, explanation] of [
    ["esporta", "Prepara un file con i dati indicati"],
    ["importa", "Legge i dati da una fonte o da un file da scegliere"],
    ["ripristina", "Apre il recupero dei dati indicati da un salvataggio precedente"],
    ["elimina", "Rimuove gli elementi indicati"],
    ["rimuovi", "Toglie gli elementi o il collegamento indicati"],
    ["aggiungi", "Apre l'inserimento degli elementi indicati"],
    ["modifica", "Apre la modifica dei dati indicati"],
    ["aggiorna", "Rilegge i dati del pannello corrente"],
    ["cerca", "Cerca gli elementi indicati usando i criteri del modulo"],
    ["associa", "Collega l'elemento selezionato alla destinazione indicata"],
    ["completa", "Prepara il completamento dei dati mancanti indicati"],
    ["apri", "Apre la pagina, il collegamento o il pannello indicato"],
    ["mostra", "Visualizza le informazioni indicate"],
    ["copia", "Copia negli appunti il contenuto indicato"],
    ["salva", "Salva le impostazioni o i dati indicati"],
    ["carica", "Legge dalla fonte indicata i dati da usare nel pannello"],
    ["elenca", "Legge e mostra l'elenco richiesto"],
    ["leggi", "Recupera i dati indicati per mostrarli o prepararne l'anteprima"],
    ["scegli", "Apre la scelta dell'elemento indicato"],
    ["prepara", "Costruisce un'anteprima degli elementi indicati"],
    ["crea", "Crea il nuovo elemento indicato usando i dati del modulo"],
    ["genera", "Costruisce il risultato indicato usando i criteri del modulo"],
    ["avvia", "Inizia l'operazione indicata"],
    ["verifica", "Controlla lo stato o la validita' degli elementi indicati"],
    ["torna", "Ritorna all'elenco di provenienza"],
    ["continua", "Prosegue la ricerca dal punto in cui era stata interrotta"],
    ["riprendi", "Riapre lo stato dell'operazione precedentemente conservato"],
    ["scopri", "Usa l'elemento selezionato come riferimento per cercare suggerimenti"],
    ["rivedi", "Apre la revisione degli elementi indicati"],
    ["escludi", "Toglie gli elementi indicati dai criteri della ricerca corrente"],
    ["pulisci", "Rimuove i dati locali indicati dalla selezione del pannello"],
    ["dettagli di", "Mostra informazioni e comandi dell'album indicato"],
    ["fissa", "Mantiene l'album indicato prima degli altri nell'ordinamento"],
    ["non fissare", "Riporta l'album indicato nell'ordinamento normale della raccolta"],
    ["bozze locali", "Mostra le modifiche lasciate in bozza per riprenderle o scartarle"],
    ["svuota", "Svuota l'elenco o il contenuto locale indicato"],
    ["dimentica", "Rimuove la copia o la credenziale salvata su questo dispositivo, senza cancellare la fonte originale"],
    ["collega", "Avvia il collegamento o l'autorizzazione al servizio indicato"],
    ["scollega", "Interrompe l'accesso locale al servizio indicato"],
    ["seleziona", "Include gli elementi indicati nella selezione corrente"],
    ["deseleziona", "Toglie gli elementi dalla selezione senza cancellarli"],
    ["imposta", "Sceglie il valore da applicare agli elementi indicati"],
    ["applica", "Applica i valori e i criteri indicati dal modulo corrente"],
    ["conferma", "Conferma le scelte mostrate nel modulo corrente"],
  ]) if (key.startsWith(prefix)) return `${explanation}: ${label}.`;
  return `Comando del pannello corrente: ${label}.`;
}

export function installControlHelp(root) {
  const generated = new WeakMap();
  const explain = (event) => {
    const control = event.target.closest?.("button, input, select, textarea, summary, a");
    if (!control) return;
    if (!control.title && control.labels?.[0]?.title) {
      control.title = control.labels[0].title;
      return;
    }
    const caption = control.labels?.[0]?.cloneNode(true);
    caption?.querySelectorAll("input,select,textarea,button").forEach(node => node.remove());
    const label = (control.getAttribute("aria-label") || caption?.textContent
      || (control.tagName === "SELECT" ? "" : control.textContent) || control.placeholder || "").trim();
    if (!label || control.title && control.title !== label && control.title !== generated.get(control)) return;
    let text;
    if (control.getAttribute("role") === "tab") text = `Apri la sezione ${label}, senza eseguire operazioni.`;
    else if (control.tagName === "SELECT") text = `Scegli un valore per ${label} dal menu a tendina.`;
    else if (control.matches("input[type=checkbox], input[type=radio]")) {
      text = controlHelp(label);
      if (text.startsWith("Comando del pannello")) text = `Attiva o disattiva: ${label}.`;
    }
    else if (control.matches("input[type=range]")) text = `Regola ${label} trascinando il cursore o usando i tasti freccia.`;
    else if (control.matches("input, textarea")) text = `Inserisci o modifica ${label}.`;
    else text = controlHelp(label);
    if (text.startsWith("Comando del pannello") && control.tagName === "SUMMARY") {
      text = `Mostra o nasconde le opzioni e le spiegazioni di questa sezione: ${label}.`;
    } else if (text.startsWith("Comando del pannello") && control.tagName === "A") {
      text = `Apri il collegamento indicato: ${label}.`;
    }
    control.title = text;
    generated.set(control, text);
  };
  root.addEventListener("pointerover", explain);
  root.addEventListener("focusin", explain);
  return () => {
    root.removeEventListener("pointerover", explain);
    root.removeEventListener("focusin", explain);
  };
}

export function userFacingStatus(message) {
  const text = String(message).split("Dettagli tecnici:")[0];
  return text.split("\n").filter((line) =>
    !/^\s*(?:SQL\b|(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA|BEGIN|COMMIT|ROLLBACK)\b|Traceback\b|File ")/i.test(line))
    .map((line) => line.replace(/\s*\(?HTTP\s+[1-5]\d{2}\)?/gi, "")
      .replace(/\b(?:SQLite|database)\b/gi, "archivio locale")
      .replace(/^\s*(?:[A-Za-z_]\w*\.)*(?:\w*Error|Exception):\s*/, "").trim())
    .filter(Boolean).join("\n") || "Consulta Dettagli per l'esito dell'operazione.";
}

export function installTechnicalStatusDetails(root) {
  const document = root.ownerDocument || root;
  const Observer = document.defaultView.MutationObserver;
  const bind = (node) => {
    if (node.dataset.technicalDisclosure || node.children.length) return;
    node.dataset.technicalDisclosure = "true";
    const wrapper = document.createElement("div");
    wrapper.className = `${node.className} technical-status-wrapper`;
    const visible = document.createElement("p");
    visible.dataset.technicalDisclosure = "presentation";
    visible.setAttribute("role", node.getAttribute("role") || "status");
    visible.setAttribute("aria-live", node.getAttribute("aria-live") || "polite");
    const details = document.createElement("details");
    details.className = "technical-status-details";
    const toggle = document.createElement("summary");
    toggle.textContent = "ⓘ Dettagli";
    toggle.setAttribute("aria-label", "Mostra o nascondi i dettagli tecnici");
    details.append(toggle);
    node.before(wrapper);
    details.append(node);
    wrapper.append(visible, details);
    const update = () => {
      const text = node.textContent;
      visible.textContent = text.trim() ? userFacingStatus(text) : "";
      wrapper.hidden = node.hidden || !text.trim();
      wrapper.classList.toggle("feedback-error", node.classList.contains("feedback-error"));
      details.hidden = visible.textContent === text;
    };
    new Observer(update).observe(node, { childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ["hidden", "class"] });
    update();
  };
  const scan = () => root.querySelectorAll("p[role='status'], span[role='status'], p[role='alert'], [data-access-status]")
    .forEach(bind);
  scan();
  const additions = new Observer((records) => {
    if (records.some((record) => record.addedNodes.length)) scan();
  });
  additions.observe(root, { childList: true, subtree: true });
  return () => additions.disconnect();
}

export function installDialogLayout(root) {
  const document = root.ownerDocument || root;
  const prepare = (dialog) => {
    if (dialog.dataset.responsiveLayout) return;
    dialog.dataset.responsiveLayout = "true";
    dialog.classList.add("responsive-dialog");
    const form = [...dialog.children].find((child) => child.tagName === "FORM");
    if (form?.querySelector(":scope > .dialog-scroll")) {
      form.classList.add("responsive-dialog-body");
      return;
    }
    const body = form || document.createElement("div");
    body.classList.add("responsive-dialog-body");
    const content = document.createElement("div");
    content.className = "dialog-scroll";
    const footer = document.createElement("div");
    footer.className = "dialog-footer";
    const append = (child) => {
      (child.tagName === "BUTTON" || child.classList.contains("dialog-actions") ? footer : content).append(child);
    };
    for (const child of [...dialog.children]) {
      if (child === form) [...form.children].forEach(append);
      else append(child);
    }
    body.replaceChildren(content, footer);
    dialog.replaceChildren(body);
  };
  const scan = () => root.querySelectorAll("dialog").forEach(prepare);
  scan();
  const observer = new document.defaultView.MutationObserver((records) => {
    if (records.some((record) => record.addedNodes.length)) scan();
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export function reconcileAlbumCards(list, cards) {
  const retained = new Set(cards);
  for (const card of [...list.children]) if (!retained.has(card)) card.remove();
  for (const [index, card] of cards.entries()) {
    if (list.children[index] !== card) list.insertBefore(card, list.children[index] || null);
  }
}

export function installCollectionLayout(document) {
  const panel = document.getElementById("collectionPanel");
  const toolbar = panel.querySelector(".playlist-import");
  toolbar.classList.add("collection-toolbar");
  const actions = toolbar.querySelector(".playlist-import-actions");
  const search = panel.querySelector(".collection-search");
  actions.prepend(search);
  toolbar.append(document.getElementById("quickCollectionFilters"));
  const manualAlbum = document.getElementById("manualAlbumButton");
  manualAlbum.textContent = "Cerca album...";
  manualAlbum.setAttribute("aria-label", "Aggiungi album alla raccolta");
  manualAlbum.title = "Aggiungi album alla raccolta";
  const addMenu = document.createElement("details");
  addMenu.className = "collection-add-menu";
  const addSummary = document.createElement("summary");
  addSummary.textContent = "Aggiungi";
  addSummary.title = "Cerca album o importa gli album di una playlist.";
  const addContent = document.createElement("div");
  addContent.className = "collection-add-content";
  addContent.append(manualAlbum, document.getElementById("playlistImportButton"));
  addMenu.append(addSummary, addContent);
  addMenu.addEventListener("click", (event) => {
    if (event.target.closest("button")) addMenu.open = false;
  });
  actions.append(addMenu);
  const body = document.createElement("div");
  body.className = "collection-body";
  const results = document.createElement("div");
  results.className = "collection-results";
  const footer = document.createElement("div");
  footer.className = "collection-results-footer";
  const aside = document.createElement("dialog");
  aside.id = "collectionOptions";
  aside.className = "collection-options";
  aside.dataset.responsiveLayout = "true";
  aside.setAttribute("aria-label", "Opzioni della raccolta");
  const header = document.createElement("div");
  header.className = "collection-options-heading";
  const title = document.createElement("strong");
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Chiudi";
  closeButton.setAttribute("aria-label", "Chiudi il pannello della raccolta");
  header.append(title, closeButton);
  const scroll = document.createElement("div");
  scroll.className = "collection-options-scroll";
  aside.append(header, scroll);
  body.append(results, aside);
  panel.append(body);
  const pages = new Map();
  let active = null;
  const show = (key) => {
    if (!pages.has(key)) throw new Error("Pannello della raccolta non disponibile.");
    active = key;
    for (const [name, page] of pages) {
      page.details.open = name === key;
      page.details.hidden = name !== key;
      page.button.setAttribute("aria-expanded", String(name === key));
    }
    title.textContent = pages.get(key).title;
    aside.hidden = false;
    if (!aside.open) aside.showModal();
    body.dataset.optionsOpen = key;
  };
  const close = (focus = true) => {
    const page = pages.get(active);
    const button = page?.returnButton || page?.button;
    active = null;
    for (const page of pages.values()) {
      page.details.open = false;
      page.details.hidden = true;
      page.button.setAttribute("aria-expanded", "false");
    }
    aside.hidden = true;
    if (aside.open) aside.close();
    delete body.dataset.optionsOpen;
    if (focus) button?.focus();
  };
  const addPage = (key, details, caption, mount = actions) => {
    const button = document.createElement("button");
    button.id = `collection${key[0].toUpperCase() + key.slice(1)}Toggle`;
    button.type = "button";
    button.className = "secondary";
    button.textContent = caption;
    button.setAttribute("aria-controls", aside.id);
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      if (active === key) close();
      else { show(key); closeButton.focus(); }
    });
    mount.append(button);
    details.classList.add("collection-options-page");
    scroll.append(details);
    pages.set(key, { details, button, title: caption });
    details.addEventListener("toggle", () => {
      if (details.open && active !== key) show(key);
      else if (!details.open && active === key) close(false);
    });
    return button;
  };
  const filters = document.getElementById("collectionFilters");
  const filtersButton = addPage("filters", filters, "Filtri");
  filtersButton.append(document.getElementById("activeFilterCount"));
  toolbar.append(document.getElementById("collectionFilterChips"));
  const view = document.getElementById("viewMenu");
  const viewContent = view.querySelector(".view-menu-content");
  const tools = document.createElement("details");
  tools.className = "collection-tools";
  const toolsTitle = document.createElement("summary");
  toolsTitle.textContent = "Raccolta";
  const toolsContent = document.createElement("div");
  toolsContent.className = "collection-tools-content";
  tools.append(toolsTitle, toolsContent);
  for (const child of [...viewContent.children]) {
    const control = child.matches("label") ? child.querySelector("select, input") : child;
    if (!["savedCollectionView", "saveCollectionViewButton", "deleteCollectionViewButton",
      "collectionLayout", "pinnedOnlyInput", "groupEditionsInput"].includes(control?.id)) toolsContent.append(child);
  }
  const toolGroups = new Map();
  const toolHelp = {
    "Ascolto": "Scegli cosa ascoltare o prepara una coda dalla raccolta.",
    "Catalogo e dati": "Gestisci collegamenti, copertine, etichette e controlli della raccolta.",
    "Salvataggio": "Gestisci backup, sincronizzazione, bozze e spazio locale.",
  };
  for (const caption of ["Ascolto", "Catalogo e dati", "Salvataggio"]) {
    const group = document.createElement("details");
    const heading = document.createElement("summary");
    heading.textContent = caption;
    heading.title = toolHelp[caption];
    group.append(heading);
    if (caption === "Catalogo e dati") group.id = "collectionCatalogTools";
    toolGroups.set(caption, group);
  }
  for (const child of [...toolsContent.children]) {
    const id = child.id || child.querySelector?.("input, select")?.id;
    const group = ["pickAlbumButton", "durationQueueButton", "openSpotifyForm"].includes(id) ? "Ascolto"
      : ["backupButton", "verifyBackupButton", "verifyBackupInput", "restoreBackupInput", "backupStatus",
          "syncChangesButton", "collectionHistoryButton", "offlineStatusButton", "coverStorageButton", "draftListButton"].includes(id)
        ? "Salvataggio" : "Catalogo e dati";
    toolGroups.get(group).append(child);
  }
  toolsContent.append(...toolGroups.values());
  toolGroups.get("Catalogo e dati").append(document.getElementById("reviewMusicAssociations"));
  addPage("view", view, "Vista");
  const toolsButton = addPage("tools", tools, "Raccolta");
  toolsButton.title = "Ascolto, catalogo e salvataggio dell'intera raccolta.";
  panel.append(document.getElementById("tidalCollectionMount"));
  const storage = panel.querySelector(".collection-storage-details");
  const coverNotice = document.getElementById("coverSyncNotice");
  storage.append(document.getElementById("unratedSummary"), coverNotice);
  const stateButton = addPage("state", storage, "Stato locale", toolGroups.get("Salvataggio"));
  pages.get("state").returnButton = toolsButton;
  const updateCoverNotice = () => {
    stateButton.textContent = coverNotice.hidden ? "Stato locale" : "Stato locale !";
    stateButton.title = coverNotice.textContent || "Stato del salvataggio e delle copertine";
    stateButton.setAttribute("aria-label", `Stato del salvataggio: ${stateButton.title}`);
  };
  new document.defaultView.MutationObserver(updateCoverNotice).observe(coverNotice,
    { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  updateCoverNotice();
  const selection = document.getElementById("selectionToolbar");
  const secondary = selection.querySelector(".selection-secondary");
  const selectionOptions = secondary.querySelector(".selection-options");
  const selectionGroups = new Map();
  const selectionHelpText = {
    "Ascolto": "Aggiorna lo stato degli album selezionati.",
    "Organizza": "Gestisci generi, evidenza e rimozione degli album selezionati.",
    "Completa dati": "Cerca i dati mancanti degli album selezionati.",
    "Selezione": "Gestisci gli album selezionati, anche quelli nascosti dai filtri.",
  };
  for (const caption of ["Ascolto", "Organizza", "Completa dati", "Selezione"]) {
    const group = document.createElement("details");
    const heading = document.createElement("summary");
    heading.textContent = caption;
    heading.title = selectionHelpText[caption];
    group.append(heading); selectionGroups.set(caption, group);
  }
  selectionOptions.append(document.getElementById("bulkGenresButton"), document.getElementById("clearSelectionButton"));
  for (const child of [...selectionOptions.children]) {
    const id = child.id || child.querySelector?.("input, select")?.id;
    const group = ["bulkStatus", "applyBulkStatus"].includes(id) ? "Ascolto"
      : ["bulkGenresButton", "pinSelectedButton", "unpinSelectedButton", "removeSelectedButton"].includes(id)
        ? "Organizza" : "Selezione";
    selectionGroups.get(group).append(child);
  }
  for (const id of ["completeMusicButton", "completeDurationsButton", "resumeMusicCompletionButton"]) {
    const button = document.getElementById(id);
    if (button) selectionGroups.get("Completa dati").append(button);
  }
  selectionOptions.append(...selectionGroups.values());
  addPage("selection", secondary, "Azioni", selection.querySelector(".selection-primary"));
  pages.get("selection").title = "Album selezionati";
  document.getElementById("bulkGenresButton").textContent = "Generi";
  document.getElementById("bulkEditButton").textContent = "Modifica";
  const selectionHelp = panel.querySelector(".selection-help");
  selection.title = selectionHelp.textContent;
  selectionHelp.classList.add("sr-only");
  for (const id of ["manualOrderHint", "albumList", "emptyState"]) {
    results.append(document.getElementById(id));
  }
  footer.append(selection);
  footer.prepend(document.getElementById("collectionSummary"));
  results.append(footer);
  const actionCopy = {
    pickAlbumButton: ["Scegli un album...", "Propone un album dalla raccolta locale."],
    durationQueueButton: ["Coda per durata...", "Scegli album che entrano nel tempo disponibile."],
    musicChoicesButton: ["Collegamenti al catalogo...", "Gestisci edizioni associate, disponibilita' e rinvii."],
    completeMusicButton: ["Metadati mancanti...", "Cerca i dati mancanti degli album selezionati."],
    completeDurationsButton: ["Solo durate...", "Cerca le durate degli album selezionati."],
    resumeMusicCompletionButton: ["Riprendi lettura...", "Riprende il completamento interrotto."],
    duplicatesButton: ["Confronta edizioni...", "Confronta possibili duplicati senza unire gli album."],
    auditCollectionButton: ["Controlla dati...", "Mostra i dati mancanti e le incongruenze, senza modificarli."],
    normalizeLabelsButton: ["Uniforma generi e tag...", "Unifica etichette equivalenti dopo l'anteprima."],
    collectionHistoryButton: ["Cronologia modifiche...", "Consulta le modifiche locali e le possibilita' di annullamento."],
    draftListButton: ["Riprendi bozze...", "Riprendi o scarta le modifiche locali non salvate."],
    statisticsButton: ["Statistiche...", "Riepiloga stati, generi e voti della raccolta."],
    loadCoversButton: ["Cerca copertine mancanti...", "Scarica solo le copertine mancanti."],
    backupButton: ["Esporta backup...", "Salva una copia locale della raccolta."],
    verifyBackupButton: ["Verifica backup...", "Controlla un file senza ripristinarlo."],
    syncChangesButton: ["Modifiche da sincronizzare...", "Mostra le differenze rispetto alla base GitHub."],
    offlineStatusButton: ["Disponibilita' offline...", "Controlla app e copertine salvate sul dispositivo."],
    coverStorageButton: ["Spazio copertine...", "Misura o rimuovi le immagini offline, non gli album."],
  };
  for (const [id, [label, tip]] of Object.entries(actionCopy)) {
    const button = document.getElementById(id);
    if (button) { button.textContent = label; button.title = tip; }
  }
  const service = document.querySelector(".music-service-picker");
  const servicePosition = document.createComment("Servizio musicale");
  service.before(servicePosition);
  const updateView = () => {
    if (panel.hidden) servicePosition.after(service);
    else actions.prepend(service);
  };
  new document.defaultView.MutationObserver(() => {
    if (selection.hidden && active === "selection") close(false);
  }).observe(selection, { attributes: true, attributeFilter: ["hidden"] });
  closeButton.addEventListener("click", () => close());
  aside.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  aside.addEventListener("close", () => { if (active) close(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && active && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      close();
    }
  });
  close(false);
  updateView();
  return { show, close, updateView };
}

export function normalizeCollectionPreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    layout: LOCAL_LAYOUTS.has(source.layout) ? source.layout : "compact",
    pinnedIds: [...new Set((Array.isArray(source.pinnedIds) ? source.pinnedIds : [])
      .filter((id) => typeof id === "string" && /^(?:[A-Za-z0-9]+|tidal:[1-9][0-9]*|qobuz:[A-Za-z0-9]{1,120})$/.test(id)))],
    ...(Object.hasOwn(source, "favoriteIds") ? {
      favoriteIds: [...new Set((Array.isArray(source.favoriteIds) ? source.favoriteIds : [])
        .filter((id) => typeof id === "string" && /^(?:[A-Za-z0-9]+|tidal:[1-9][0-9]*|qobuz:[A-Za-z0-9]{1,120})$/.test(id)))],
    } : {}),
  };
}

export function visibleSelection(selectedIds, albums) {
  const visible = new Set(albums.map((album) => album.id));
  return new Set([...selectedIds].filter((id) => visible.has(id)));
}

export function selectCollectionAlbum(selectedIds, id, control = false, range = []) {
  const next = control ? new Set(selectedIds) : new Set();
  if (range.length) {
    for (const identifier of range) next.add(identifier);
    return next;
  }
  if (control && next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export async function runPlatformAccessChecks(checks, report) {
  for (const check of checks) {
    let result;
    try {
      const identity = check.identity();
      if (!check.configured()) {
        result = { state: "Non configurato; verifica non eseguita" };
      } else {
        report(check.key, { state: "Verifica in corso" });
        const guard = () => {
          if (check.identity() !== identity) throw new Error("Configurazione cambiata: verifica di nuovo l'accesso.");
        };
        guard();
        result = await check.check(guard);
        guard();
        result = { ...result, state: "Lettura verificata" };
      }
    } catch (error) {
      result = { state: "Verifica non riuscita", detail: error.message };
    }
    report(check.key, { ...result, checked: new Date().toLocaleString() });
  }
}

export function prepareAlbumUpdates(albums, selectedIds, changes, validate) {
  return albums.map((album) => selectedIds.has(album.id)
    ? validate({ ...album, ...changes }) : album);
}

export function prepareAlbumRemoval(albums, selectedIds) {
  const ids = new Set(selectedIds);
  if ([...ids].some((id) => !albums.some((album) => album.id === id))) {
    throw new Error("La selezione è cambiata. Aggiorna la raccolta prima di rimuovere gli album.");
  }
  return albums.filter((album) => !ids.has(album.id));
}

export function formatSyncSummary(summary) {
  return `Verso GitHub: ${summary.toGitHub} · verso questo dispositivo: ${summary.toDevice} · `
    + `invariati: ${summary.unchanged} · conflitti risolti: ${summary.conflictsResolved}`;
}

export function localCommandResults(query, commands, albums, limit = 30) {
  const terms = String(query || "").normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = (value) => terms.every((term) => value.normalize("NFKC").toLocaleLowerCase().includes(term));
  const actions = commands.filter((command) => matches(command.label));
  const records = terms.length ? albums.filter((album) => matches(
    `${album.name} ${album.artist} ${(album.genres || []).join(" ")} ${(album.collections || []).join(" ")} ${(album.tags || []).join(" ")}`,
  )).map((album) => ({
    id: `album:${album.id}`, albumId: album.id, label: `${album.name} · ${album.artist}`, kind: "album",
  })) : [];
  return [...actions, ...records].slice(0, limit);
}

export function editionTitle(value) {
  const edition = "(?:deluxe|remaster(?:ed)?|expanded|anniversary|special edition|bonus|legacy edition)";
  return String(value).normalize("NFKC").toLocaleLowerCase()
    .replace(new RegExp(`[\\(\\[][^\\)\\]]*\\b${edition}\\b[^\\)\\]]*[\\)\\]]`, "g"), "")
    .replace(new RegExp(`\\s*[-:]\\s*(?:\\d{4}\\s+)?${edition}\\b.*$`), "")
    .trim().replace(/\s+/g, " ");
}

export function duplicateAlbumGroups(albums) {
  const groups = new Map();
  for (const album of albums) {
    const key = `${album.artist.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ")}|${editionTitle(album.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(album);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function collectionAuditSummary(albums, coveredIds = new Set()) {
  const duplicateGroups = duplicateAlbumGroups(albums);
  return {
    total: albums.length,
    duplicateGroups: duplicateGroups.map((group) => group.map((album) => album.id)),
    duplicateIds: [...new Set(duplicateGroups.flatMap((group) => group.map((album) => album.id)))].sort(),
    missingCoverIds: albums.filter((album) => !coveredIds.has(album.id)).map((album) => album.id).sort(),
    missingYearIds: albums.filter((album) => !String(album.year || "").trim()).map((album) => album.id).sort(),
    missingGenreIds: albums.filter((album) => !(album.genres || []).length && !album.primary_genre)
      .map((album) => album.id).sort(),
  };
}

export function normalizeAlbumActivity(activity = {}) {
  if (!activity || typeof activity !== "object" || Array.isArray(activity)
      || Object.values(activity).some(dates => !dates || typeof dates !== "object" || Array.isArray(dates)
        || Object.keys(dates).some(field => !["added", "modified"].includes(field))
        || Object.values(dates).some(stamp => typeof stamp !== "string" || stamp && !Number.isFinite(Date.parse(stamp))))) {
    throw new Error("Date locali degli album non valide.");
  }
  return Object.fromEntries(Object.entries(activity).map(([id, dates]) => [id, { ...dates }]));
}

export function updateAlbumActivity(before, after, activity = {}, now = new Date().toISOString(), restoring = false) {
  const result = normalizeAlbumActivity(activity);
  const old = new Map(before.map(album => [album.id, album]));
  for (const album of after) {
    const previous = activity[album.id] || {};
    const changed = !old.has(album.id) || albumFieldChanges(old.get(album.id), album).length > 0;
    const dates = { ...previous };
    if (!old.has(album.id) && !restoring) dates.added = now;
    if (changed) dates.modified = now;
    if (Object.keys(dates).length) result[album.id] = dates;
  }
  return result;
}

export function sortAlbumsByActivity(albums, activity, field) {
  return [...albums].sort((a, b) => {
    const left = Date.parse(activity[a.id]?.[field] || "") || 0;
    const right = Date.parse(activity[b.id]?.[field] || "") || 0;
    return right - left || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

export function albumFieldChanges(before, after) {
  return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter((key) => !["id", "updated_at"].includes(key)
      && JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])).sort();
}

export function albumChanges(before, after) {
  const old = new Map(before.map((album) => [album.id, album]));
  const next = new Map(after.map((album) => [album.id, album]));
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap((id) => {
    const left = old.get(id), right = next.get(id);
    const fields = albumFieldChanges(left, right);
    return !left || !right || fields.length
      ? [{ id, before: left, after: right, fields, kind: !left ? "added" : !right ? "removed" : "updated" }] : [];
  });
}

const HISTORY_LIMIT = 200;
const COLLECTION_STORAGE_KEY = "accord-album-pwa-v1";
const EDITION_LINKS_KEY = "accord-music-edition-links-v1";
const HISTORY_STORAGE_LABELS = {
  "accord-listening-album-durations-v1": "durata",
  "accord-music-edition-links-v1": "associazione edizione",
  "accord-music-completion-provenance-v1": "provenienza dati",
  "accord-music-completion-evidence-v1": "evidenze",
};
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function historyAlbum(album) {
  const record = { ...album };
  const id = String(record.id || "");
  record.url = id.startsWith("tidal:") && /^tidal:[1-9][0-9]*$/.test(id)
    ? `https://tidal.com/browse/album/${id.slice(6)}`
    : id.startsWith("qobuz:") && /^qobuz:[A-Za-z0-9]{1,120}$/.test(id)
      ? `https://play.qobuz.com/album/${id.slice(6)}`
      : id.startsWith("mb:") && /^mb:[0-9a-f-]{36}$/i.test(id)
        ? `https://musicbrainz.org/release-group/${id.slice(3)}`
        : /^[A-Za-z0-9]+$/.test(id) ? `https://open.spotify.com/album/${id}` : "";
  return record;
}

export function createCollectionHistoryEntry(before, after, label, now = new Date().toISOString(),
  storageChanges = []) {
  const old = new Map(before.map((album, index) => [album.id, { album: historyAlbum(album), index }]));
  const next = new Map(after.map((album, index) => [album.id, { album: historyAlbum(album), index }]));
  const changes = [...new Set([...old.keys(), ...next.keys()])].sort().flatMap((id) => {
    const left = old.get(id), right = next.get(id);
    if (!left || !right) return [{
      id, kind: left ? "removed" : "added", fields: ["album"],
      before: left?.album ?? null, after: right?.album ?? null,
      beforeIndex: left?.index ?? null, afterIndex: right?.index ?? null,
    }];
    const fields = albumFieldChanges(left.album, right.album);
    return fields.length ? [{
      id, kind: "updated", fields,
      before: left.album, after: right.album,
      beforeIndex: left.index, afterIndex: right.index,
    }] : [];
  });
  return changes.length || storageChanges.length
    ? { id: crypto.randomUUID(), createdAt: now, label, changes, storageChanges } : null;
}

export function appendCollectionHistory(history, entry) {
  if (!entry) return Array.isArray(history) ? history : [];
  return [...(Array.isArray(history) ? history : []), entry].slice(-HISTORY_LIMIT);
}

export function prepareCollectionHistoryRestore(albums, entry, editionLinks = {}, storedRecords = {}) {
  if (!entry || !Array.isArray(entry.changes) || !Array.isArray(entry.storageChanges)
      || !entry.changes.length && !entry.storageChanges.length) {
    throw new Error("Voce di cronologia non valida.");
  }
  const next = albums.map((album) => ({ ...album }));
  const indexes = new Map(next.map((album, index) => [album.id, index]));
  const touched = new Set();
  for (const change of entry.changes) {
    touched.add(change.id);
    const currentIndex = indexes.get(change.id);
    const current = currentIndex === undefined ? null : next[currentIndex];
    if (change.kind === "added") {
      if (!current || !sameValue(current, change.after)) {
        throw new Error(`L'album ${change.id} è cambiato dopo l'operazione. Nessun ripristino applicato.`);
      }
    } else if (change.kind === "removed") {
      if (current) throw new Error(`L'ID ${change.id} è già presente. Nessun ripristino applicato.`);
    } else if (change.kind === "updated") {
      if (!current || change.fields.some((field) => !sameValue(current[field], change.after[field]))) {
        throw new Error(`Il campo di ${change.id} è cambiato dopo l'operazione. Nessun ripristino applicato.`);
      }
    } else throw new Error("Tipo di modifica storica non valido.");
  }
  for (const change of entry.changes.filter((row) => row.kind === "added")
    .sort((left, right) => (indexes.get(right.id) ?? -1) - (indexes.get(left.id) ?? -1))) {
    next.splice(next.findIndex((album) => album.id === change.id), 1);
  }
  for (const change of entry.changes.filter((row) => row.kind === "removed")
    .sort((left, right) => (left.beforeIndex ?? next.length) - (right.beforeIndex ?? next.length))) {
    next.splice(Math.min(change.beforeIndex ?? next.length, next.length), 0, { ...change.before });
  }
  for (const change of entry.changes.filter((row) => row.kind === "updated")) {
    const album = next.find((record) => record.id === change.id);
    for (const field of change.fields) {
      if (Object.hasOwn(change.before, field)) album[field] = change.before[field];
      else delete album[field];
    }
  }
  const storageUpdates = {};
  for (const change of entry.storageChanges) {
    const rawRecords = storedRecords[change.storageKey];
    const records = rawRecords && typeof rawRecords === "object" && !Array.isArray(rawRecords) ? rawRecords : {};
    const currentPresent = Object.hasOwn(records, change.id);
    if (currentPresent !== change.afterPresent
        || currentPresent && !sameValue(records[change.id], change.after)) {
      throw new Error(`Il campo ${change.field} di ${change.id} è cambiato dopo l'operazione. Nessun ripristino applicato.`);
    }
    storageUpdates[change.storageKey] ||= { ...records };
    if (change.beforePresent) storageUpdates[change.storageKey][change.id] = change.before;
    else delete storageUpdates[change.storageKey][change.id];
    touched.add(change.id);
  }
  const restoredLinks = storageUpdates[EDITION_LINKS_KEY] || editionLinks;
  for (const album of next.filter((record) => touched.has(record.id))) {
    const links = restoredLinks?.[album.id];
    if (!links || typeof links !== "object" || Array.isArray(links)) continue;
    for (const [provider, link] of Object.entries(links)) {
      if (!link || link.source !== JSON.stringify([album.id, album.artist, album.name])) {
        throw new Error(`Il ripristino renderebbe obsoleta l'associazione ${provider} di ${album.id}.`);
      }
    }
  }
  const restoredProvenance = storageUpdates["accord-music-completion-provenance-v1"]
    || storedRecords["accord-music-completion-provenance-v1"] || {};
  for (const id of touched) {
    const album = next.find((record) => record.id === id);
    for (const category of Object.values(restoredProvenance[id] || {})) {
      if (category?.identity && !sameValue(category.identity, [id, album?.artist, album?.name])) {
        throw new Error(`Il ripristino renderebbe obsoleta la provenienza dati di ${id}.`);
      }
      if (category?.target && category.target !== id && ["tidal", "qobuz"].includes(category.source)
          && restoredLinks?.[id]?.[category.source]?.id !== category.target) {
        throw new Error(`Il ripristino renderebbe obsoleta l'associazione di ${id}.`);
      }
    }
  }
  return { albums: next, storageUpdates };
}

export function collectionHealthSummary(albums, {
  rawAlbums = albums, durations = {}, editionLinks = {}, completionProvenance = {}, completionEvidence = {},
} = {}) {
  const byId = new Map(albums.filter((album) => typeof album?.id === "string")
    .map((album) => [album.id, album]));
  const malformedLinkIds = [];
  for (const [index, album] of rawAlbums.entries()) {
    const id = typeof album?.id === "string" ? album.id : `record#${index + 1}`;
    let valid = false;
    try {
      const url = new URL(album?.url);
      if (url.protocol === "https:" && !url.username && !url.password) {
        if (id.startsWith("tidal:")) {
          valid = /^tidal:[1-9][0-9]*$/.test(id) && url.host === "tidal.com"
            && url.pathname === `/browse/album/${id.slice(6)}` && !url.search && !url.hash;
        } else if (id.startsWith("qobuz:")) {
          valid = /^qobuz:[A-Za-z0-9]{1,120}$/.test(id) && url.host === "play.qobuz.com"
            && url.pathname === `/album/${id.slice(6)}` && !url.search && !url.hash;
        } else if (id.startsWith("mb:")) {
          valid = /^mb:[0-9a-f-]{36}$/i.test(id) && url.host === "musicbrainz.org"
            && url.pathname === `/release-group/${id.slice(3)}` && !url.search && !url.hash;
        } else if (id.startsWith("ann:")) valid = Boolean(url.host);
        else valid = /^[A-Za-z0-9]+$/.test(id) && url.host === "open.spotify.com"
          && url.pathname === `/album/${id}` && !url.search && !url.hash;
      }
    } catch { /* Invalid local URL is reported below. */ }
    if (!valid) malformedLinkIds.push(id);
  }

  const malformedEditionIds = new Set(), incoherentEditionIds = new Set();
  if (!editionLinks || typeof editionLinks !== "object" || Array.isArray(editionLinks)) {
    malformedEditionIds.add("registro associazioni non leggibile");
  } else for (const [id, providers] of Object.entries(editionLinks)) {
    const album = byId.get(id);
    if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
      malformedEditionIds.add(id);
      continue;
    }
    for (const [provider, record] of Object.entries(providers)) {
      const validId = provider === "spotify" ? /^[A-Za-z0-9]{22}$/.test(record?.id || "")
        : provider === "tidal" ? /^tidal:[1-9][0-9]*$/.test(record?.id || "")
        : provider === "qobuz" && /^qobuz:[A-Za-z0-9]{1,120}$/.test(record?.id || "");
      if (!validId || typeof record?.source !== "string") malformedEditionIds.add(id);
      else if (!album || record.source !== JSON.stringify([id, album.artist, album.name])) incoherentEditionIds.add(id);
    }
  }

  const staleDerivedIds = new Set();
  const provenance = completionProvenance && typeof completionProvenance === "object"
    && !Array.isArray(completionProvenance) ? completionProvenance : {};
  for (const [id, categories] of Object.entries(provenance)) {
    const album = byId.get(id);
    if (!album || !categories || typeof categories !== "object" || Array.isArray(categories)) {
      staleDerivedIds.add(id);
      continue;
    }
    for (const record of Object.values(categories)) {
      if (!record || typeof record !== "object"
          || record.identity && !sameValue(record.identity, [id, album.artist, album.name])) {
        staleDerivedIds.add(id);
        continue;
      }
      if (record.target && record.target !== id && ["tidal", "qobuz"].includes(record.source)
          && editionLinks?.[id]?.[record.source]?.id !== record.target) staleDerivedIds.add(id);
    }
  }
  if (completionEvidence && typeof completionEvidence === "object" && !Array.isArray(completionEvidence)) {
    for (const id of Object.keys(completionEvidence)) if (!byId.has(id)) staleDerivedIds.add(id);
  }
  const durationValues = durations && typeof durations === "object" && !Array.isArray(durations) ? durations : {};
  return {
    malformedLinkIds: [...new Set(malformedLinkIds)].sort(),
    malformedEditionIds: [...malformedEditionIds].sort(),
    incoherentEditionIds: [...incoherentEditionIds].sort(),
    missingDurationIds: [...byId.keys()].filter((id) => !Number.isSafeInteger(durationValues[id])
      || durationValues[id] <= 0).sort(),
    staleDerivedIds: [...staleDerivedIds].sort(),
  };
}

export function smartAlbumMatch(key, album, changedAt = {}, now = Date.now()) {
  const changed = Date.parse(changedAt[album.id] || "");
  const listened = ["liked", "neutral", "disliked"].includes(album.status);
  if (key === "stale_queue") return album.status === "queued" && Number.isFinite(changed)
    && now - changed >= 30 * 86400000;
  if (key === "unrated") return listened && album.rating === null;
  if (key === "recent") return Number.isFinite(changed) && now - changed >= 0 && now - changed <= 7 * 86400000;
  if (key === "favorites_unrated") return album.status === "liked" && album.rating === null;
  return true;
}

export function albumStatistics(albums, changedAt = {}, now = Date.now()) {
  const states = {}, genres = {};
  const ratings = [];
  for (const album of albums) {
    states[album.status] = (states[album.status] || 0) + 1;
    const genre = album.primary_genre || album.genres?.[0] || "Senza genere";
    genres[genre] = (genres[genre] || 0) + 1;
    if (album.rating !== null && album.rating !== undefined) ratings.push(album.rating);
  }
  const month = new Date(now).toISOString().slice(0, 7);
  return { total: albums.length, states, genres,
    unratedListened: albums.filter((album) => ["liked", "neutral", "disliked"].includes(album.status)
      && album.rating === null).length,
    changedThisMonth: albums.filter((album) => String(changedAt[album.id] || "").startsWith(month)).length,
    rated: ratings.length, average: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null };
}

export function suggestionIdentity(album) {
  return [album.artist, album.name].map((value) =>
    String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase()).join("|");
}

export function suggestionWhy(album) {
  if (album.spotifySimilarTo?.length) return `Somiglianza Last.fm con: ${album.spotifySimilarTo.join(", ")}`;
  if (album.similar_to?.length) return `Somiglianza Last.fm con: ${album.similar_to.join(", ")}`;
  if (album.reason || album.matchReason) return [album.reason, album.matchReason].filter(Boolean).join("\n");
  if (album.spotifyArtistId) return `Ripiego Spotify per generi condivisi: ${(album.genres || []).join(", ") || "non comunicati"}`;
  return "Riferimenti non disponibili nel risultato salvato. Nessuna nuova ricerca eseguita.";
}

export function batchAlbumChanges(album, values, mode = "replace") {
  const result = { ...values };
  for (const field of ["genres", "collections", "tags"]) {
    if (!Object.hasOwn(values, field) || mode === "replace") continue;
    const requested = new Set(values[field].map((value) => value.toLocaleLowerCase()));
    result[field] = mode === "remove"
      ? album[field].filter((value) => !requested.has(value.toLocaleLowerCase()))
      : [...album[field], ...values[field].filter((value) =>
        !album[field].some((existing) => existing.toLocaleLowerCase() === value.toLocaleLowerCase()))];
  }
  if (Object.hasOwn(result, "genres")) {
    result.primary_genre = mode !== "replace"
      ? result.genres.find((genre) => genre.toLocaleLowerCase() === String(album.primary_genre || "").toLocaleLowerCase())
        || result.genres[0] || ""
      : result.genres[0] || "";
  }
  return result;
}

export function exactAlbumFacet(album, facet) {
  if (!facet) return true;
  return facet.field === "artist" ? album.artist === facet.value
    : ["genres", "tags", "collections"].includes(facet.field)
      && album[facet.field].includes(facet.value);
}

export function normalizeAlbumFacet(value) {
  if (value === null || value === undefined) return null;
  if (!["artist", "genres", "tags", "collections"].includes(value?.field)
      || typeof value.value !== "string" || !value.value) throw new Error("Filtro locale esatto non valido.");
  return { field: value.field, value: value.value };
}

export function prepareAlbumReview(albums, ids, transform) {
  const selected = albums.filter((album) => ids.has(album.id));
  if (selected.length !== ids.size) throw new Error("Selezione cambiata: riapri l'anteprima.");
  const next = albums.map((album) => ids.has(album.id) ? transform(album) : album);
  const changes = albumChanges(albums, next);
  return { snapshot: JSON.stringify(albums), next, changes,
    selectedIds: [...ids],
    selected: selected.length, changed: changes.length, unchanged: selected.length - changes.length };
}

export function assertAlbumReviewCurrent(review, albums, persisted) {
  if (!review || review.snapshot !== JSON.stringify(albums)
      || persisted !== undefined && review.snapshot !== JSON.stringify(
        persisted === null ? [] : JSON.parse(persisted)?.albums)) {
    throw new Error("La raccolta è cambiata. Rigenera l'anteprima prima di confermare.");
  }
}

export function labelNormalizationProposals(albums) {
  const proposals = [];
  for (const field of ["genres", "tags", "collections"]) {
    const groups = new Map();
    for (const album of albums) for (const label of album[field]) {
      const key = label.normalize("NFKC").toLocaleLowerCase().trim().replace(/[-_\s]+/g, " ");
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(label);
    }
    for (const labels of groups.values()) if (labels.size > 1) {
      const variants = [...labels].sort((a, b) => a.localeCompare(b));
      proposals.push({ field, labels: variants,
        albumIds: albums.filter((album) => album[field].some((label) => labels.has(label))).map((album) => album.id) });
    }
  }
  return proposals;
}

export function normalizeAlbumLabels(album, field, variants, finalLabel, validate) {
  if (!["genres", "tags", "collections"].includes(field)) throw new Error("Tipo etichetta non valido.");
  const label = finalLabel.trim().replace(/\s+/g, " ");
  if (!label || label.length > 80) throw new Error("Scegli un'etichetta finale da 1 a 80 caratteri.");
  const affected = new Set(variants);
  const values = album[field].map((value) => affected.has(value) ? label : value);
  const changes = { [field]: values };
  if (field === "genres") {
    changes.primary_genre = affected.has(album.primary_genre) ? label : album.primary_genre;
  }
  return validate({ ...album, ...changes });
}

export function coverStorageInventory(records) {
  return records.map(({ id, data }) => {
    const bytes = data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data.byteLength
      : typeof Blob !== "undefined" && data instanceof Blob ? data.size : null;
    if (bytes === null) throw new Error(`Dimensione della copertina ${id} non verificabile.`);
    return { id, bytes };
  });
}

export function createCommandGuard() {
  const pending = new Set();
  return {
    acquire(key) {
      if (pending.has(key)) return false;
      pending.add(key);
      return true;
    },
    release(key) { pending.delete(key); },
    isBusy() { return pending.size > 0; },
  };
}

export function technicalDiagnostics({ stage, httpStatuses = [], counts = {} } = {}) {
  const stages = new Set(["message", "activity", "local-review"]);
  const statuses = [...new Set(httpStatuses.filter((status) =>
    Number.isInteger(status) && status >= 400 && status <= 599))].sort((a, b) => a - b);
  const safeCounts = {};
  for (const key of ["albums", "drafts", "failedCovers"]) {
    if (Number.isSafeInteger(counts[key]) && counts[key] >= 0) safeCounts[key] = counts[key];
  }
  return JSON.stringify({ product: "Accord PWA", version: "1.4.1",
    stage: stages.has(stage) ? stage : "message", httpStatuses: statuses, counts: safeCounts }, null, 2);
}

export function redactDiagnostics(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets.filter((entry) => typeof entry === "string" && entry.length)) {
    text = text.split(secret).join("[redatto]");
  }
  return text.replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}${parsed.search ? "?[redatto]" : ""}${parsed.hash ? "#[redatto]" : ""}`;
    } catch { return "[URL redatto]"; }
  }).replace(/(\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*)[^\r\n]+/gi, "$1[redatto]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redatto]")
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, "[redatto]")
    .replace(/((?:access_token|refresh_token|client_secret|api_key|authorization|token|code_verifier|password)\s*["']?\s*[:=]\s*["']?)[^\s,;"'}]+/gi, "$1[redatto]");
}

export function normalizeAccessibility(value = {}) {
  return {
    textScale: ["normal", "large", "larger"].includes(value?.textScale) ? value.textScale : "normal",
    contrast: value?.contrast === "high" ? "high" : "standard",
    density: value?.density === "compact" ? "compact" : "touch",
  };
}

export function adjacentAlbumIds(albums, id) {
  const index = albums.findIndex((album) => album.id === id);
  return { previous: index > 0 ? albums[index - 1].id : null,
    next: index >= 0 && index < albums.length - 1 ? albums[index + 1].id : null };
}

export function spotifyAlbumIntent(input) {
  const text = String(input || "").trim();
  const candidates = text.match(/https:\/\/open\.spotify\.com\/[^\s<>]+|spotify:album:[A-Za-z0-9]+/g) || [];
  const ids = new Set();
  for (const candidate of candidates) {
    if (/^spotify:album:[A-Za-z0-9]{22}$/.test(candidate)) {
      ids.add(candidate.slice("spotify:album:".length));
      continue;
    }
    let url;
    try { url = new URL(candidate); } catch { continue; }
    const match = url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?album\/([A-Za-z0-9]{22})\/?$/);
    if (url.protocol === "https:" && url.host === "open.spotify.com"
        && !url.username && !url.password && match) ids.add(match[1]);
  }
  if (ids.size !== 1) throw new Error("Incolla o condividi un solo link album Spotify valido (non un brano o una playlist).");
  const id = [...ids][0];
  return { id, url: `https://open.spotify.com/album/${id}` };
}

export function playlistPreviewStatistics(tracks, availableTracks = []) {
  const metadata = new Map(availableTracks.map((track) => [track.uri, track]));
  const artists = new Set(), identities = new Set();
  let duration = 0, timed = 0, known = 0, classified = 0, repeats = 0, artistRows = 0, identified = 0;
  for (const entry of tracks) {
    const track = { ...metadata.get(entry.uri), ...entry };
    const identity = track.uri || track.id;
    if (identity) {
      identified += 1;
      if (identities.has(identity)) repeats += 1;
      identities.add(identity);
    }
    if (Number.isFinite(track.duration_ms) && track.duration_ms > 0) {
      duration += track.duration_ms;
      timed += 1;
    }
    if (Array.isArray(track.artists) && track.artists.length
        && track.artists.every((artist) => artist.id || artist.name)) {
      artistRows += 1;
      for (const artist of track.artists) artists.add(artist.id || artist.name.normalize("NFKC").toLocaleLowerCase());
    }
    if (typeof track.known === "boolean") {
      classified += 1;
      if (track.known) known += 1;
    }
  }
  return { total: tracks.length, duration, timed, uniqueArtists: artists.size, artistRows,
    repeats, identified, known, classified };
}

export function portablePreferences(value = {}) {
  return { ...normalizeCollectionPreferences(value), ...normalizeAccessibility(value) };
}

const portableAlbumId = (id) => typeof id === "string"
  && /^(?:[A-Za-z0-9]+|tidal:[1-9][0-9]*|qobuz:[A-Za-z0-9]{1,120})$/.test(id);

function portableIds(value, knownIds, label) {
  if (!Array.isArray(value) || value.some((id) => !portableAlbumId(id) || !knownIds.has(id))) {
    throw new Error(`${label} non validi o riferiti ad album non presenti.`);
  }
  return [...new Set(value)];
}

function portableDurations(value, knownIds, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.entries(value).some(([id, duration]) =>
        !portableAlbumId(id) || !knownIds.has(id) || !Number.isSafeInteger(duration) || duration <= 0)) {
    throw new Error(`${label} non valide o riferite ad album non presenti.`);
  }
  return { ...value };
}

export function createLocalBackup(albums, preferences, validate, music = {}) {
  const records = albums.map((album) => {
    const record = validate(album);
    return { ...record, url: record.id.startsWith("tidal:")
      ? `https://tidal.com/browse/album/${record.id.slice(6)}`
      : record.id.startsWith("qobuz:")
        ? `https://play.qobuz.com/album/${record.id.slice(6)}`
      : `https://open.spotify.com/album/${record.id}` };
  });
  const knownIds = new Set(records.map((album) => album.id));
  const manualOrder = portableIds(music.manualOrder || [], knownIds, "Ordine manuale");
  const rawQueue = music.listeningQueue || { ids: [], resume: "", durations: {} };
  if (!rawQueue || typeof rawQueue !== "object" || Array.isArray(rawQueue)
      || Object.keys(rawQueue).some((key) => !["ids", "resume", "durations"].includes(key))) {
    throw new Error("Coda locale non valida.");
  }
  const queueIds = portableIds(rawQueue.ids || [], knownIds, "Coda locale");
  const queueDurations = portableDurations(rawQueue.durations || {}, knownIds, "Durate della coda");
  const resume = rawQueue.resume || "";
  if (resume && !queueIds.includes(resume)) throw new Error("Ripresa della coda non valida.");
  const suggestionRecipes = validateSuggestionRecipes(music.suggestionRecipes || []);
  const completionProvenance = validateCompletionProvenance(music.completionProvenance || {}, knownIds);
  const completionEvidence = validateCompletionEvidence(music.completionEvidence || {}, knownIds);
  return { format: "accord-local-backup", version: 3, albums: records,
    preferences: portablePreferences(preferences), manualOrder,
    listeningQueue: { ids: queueIds, resume, durations: queueDurations },
    durations: portableDurations(music.durations || {}, knownIds, "Durate locali"),
    suggestionRecipes, completionProvenance, completionEvidence };
}

export function backupReminderItems(backup) {
  const items = {};
  const add = (key, value) => { items[key] = JSON.stringify(value); };
  for (const album of backup.albums) add(`album:${album.id}`, album);
  for (const recipe of backup.suggestionRecipes || []) add(`recipe:${recipe.name}`, recipe);
  for (const [id, value] of Object.entries(backup.completionProvenance || {})) {
    add(`completion-provenance:${id}`, value);
  }
  for (const [id, value] of Object.entries(backup.completionEvidence || {})) {
    add(`completion-evidence:${id}`, value);
  }
  add("preferences", backup.preferences);
  add("manual-order", backup.manualOrder);
  add("listening-queue", backup.listeningQueue);
  add("durations", backup.durations);
  return items;
}

export function validateLocalBackup(value, validateDocument) {
  if (!value || value.format !== "accord-local-backup" || ![1, 2, 3].includes(value.version)
      || !value.preferences || typeof value.preferences !== "object" || Array.isArray(value.preferences)
      || Object.keys(value).some((key) => !["format", "version", "albums", "preferences",
        ...(value.version >= 2 ? ["manualOrder", "listeningQueue", "durations"] : []),
        ...(value.version === 3 ? ["suggestionRecipes", "completionProvenance", "completionEvidence"] : [])].includes(key))
      || Object.keys(value.preferences).some((key) =>
        !["layout", "pinnedIds", "favoriteIds", "textScale", "contrast", "density"].includes(key))) {
    if (value?.format === "accord-local-backup" && [2, 3].includes(value.version)
        && value.preferences && typeof value.preferences === "object" && !Array.isArray(value.preferences)
        && Object.keys(value).every((key) => ["format", "version", "albums", "preferences",
          "manualOrder", "listeningQueue", "durations",
          ...(value.version === 3 ? ["suggestionRecipes", "completionProvenance", "completionEvidence"] : [])].includes(key))
        && Object.keys(value.preferences).every((key) =>
          ["layout", "pinnedIds", "favoriteIds", "textScale", "contrast", "density"].includes(key))) {
      return validateVersionTwoBackup(value, validateDocument);
    }
    throw new Error("Backup locale non valido o contenente campi non consentiti.");
  }
  const preferences = portablePreferences(value.preferences);
  if (Object.entries(value.preferences).some(([key, field]) =>
    JSON.stringify(field) !== JSON.stringify(preferences[key]))) throw new Error("Preferenze backup non valide.");
  if (value.version >= 2) return validateVersionTwoBackup(value, validateDocument);
  const albums = validateDocument({ format: "accord-album-collection", version: 3, albums: value.albums });
  const knownIds = new Set(albums.map((album) => album.id));
  return { albums, preferences, manualOrder: albums.map((album) => album.id),
    listeningQueue: { ids: [], resume: "", durations: {} }, durations: {},
    suggestionRecipes: [], completionProvenance: {}, completionEvidence: {} };
}

function validateVersionTwoBackup(value, validateDocument) {
  if (!Array.isArray(value.albums) || !Array.isArray(value.manualOrder)
      || !value.listeningQueue || typeof value.listeningQueue !== "object"
      || Array.isArray(value.listeningQueue) || !value.durations || typeof value.durations !== "object"
      || Array.isArray(value.durations)) {
    throw new Error("Backup locale non valido o contenente campi non consentiti.");
  }
  const preferences = portablePreferences(value.preferences);
  if (Object.entries(value.preferences).some(([key, field]) =>
    JSON.stringify(field) !== JSON.stringify(preferences[key]))) throw new Error("Preferenze backup non valide.");
  const albums = validateDocument({ format: "accord-album-collection", version: 3, albums: value.albums });
  const knownIds = new Set(albums.map((album) => album.id));
  const manualOrder = portableIds(value.manualOrder, knownIds, "Ordine manuale");
  const queue = value.listeningQueue;
  if (Object.keys(queue).some((key) => !["ids", "resume", "durations"].includes(key))
      || typeof (queue.resume || "") !== "string") throw new Error("Coda locale non valida.");
  const queueIds = portableIds(queue.ids, knownIds, "Coda locale");
  const queueDurations = portableDurations(queue.durations, knownIds, "Durate della coda");
  const resume = queue.resume || "";
  if (resume && !queueIds.includes(resume)) throw new Error("Ripresa della coda non valida.");
  const versionThree = value.version === 3;
  const suggestionRecipes = versionThree ? validateSuggestionRecipes(value.suggestionRecipes) : [];
  const completionProvenance = versionThree
    ? validateCompletionProvenance(value.completionProvenance, knownIds) : {};
  const completionEvidence = versionThree ? validateCompletionEvidence(value.completionEvidence, knownIds) : {};
  return { albums, preferences, manualOrder, listeningQueue: { ids: queueIds, resume, durations: queueDurations },
    durations: portableDurations(value.durations, knownIds, "Durate locali"),
    suggestionRecipes, completionProvenance, completionEvidence };
}

function validateCompletionProvenance(value, knownIds) {
  const categories = new Set(["duration", "genres", "evidence"]);
  const sources = new Set(["manual", "spotify", "tidal", "qobuz", "Last.fm", "Discogs"]);
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((id) => !knownIds.has(id))) {
    throw new Error("Provenienza del completamento musicale non valida.");
  }
  const result = {};
  for (const [id, records] of Object.entries(value)) {
    if (!records || typeof records !== "object" || Array.isArray(records)
        || Object.keys(records).some((category) => !categories.has(category))) {
      throw new Error("Provenienza del completamento musicale non valida.");
    }
    result[id] = {};
    for (const [category, record] of Object.entries(records)) {
      if (!record || typeof record !== "object" || Array.isArray(record)
          || Object.keys(record).some((key) =>
            !["source", "target", "identity", "updated", "complete_tracks"].includes(key))
          || !sources.has(record.source)
          || Object.hasOwn(record, "target") && record.target !== null && typeof record.target !== "string"
          || Object.hasOwn(record, "identity") && (!Array.isArray(record.identity)
            || record.identity.length !== 3 || record.identity.some((item) => typeof item !== "string"))
          || Object.hasOwn(record, "updated") && typeof record.updated !== "string"
          || Object.hasOwn(record, "complete_tracks") && record.complete_tracks !== null
            && (!Number.isSafeInteger(record.complete_tracks) || record.complete_tracks < 0)) {
        throw new Error("Record di provenienza del completamento musicale non valido.");
      }
      result[id][category] = { ...record };
    }
  }
  return result;
}

function validateCompletionEvidence(value, knownIds) {
  const dataFields = new Set(["discogs", "discogs_votes", "discogs_editions", "discogs_versions",
    "discogs_sampled_versions", "discogs_sampled", "discogs_master", "discogs_url",
    "discogs_complete", "discogs_updated"]);
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((id) => !knownIds.has(id))) {
    throw new Error("Evidenze del completamento musicale non valide.");
  }
  const result = {};
  for (const [id, record] of Object.entries(value)) {
    if (!record || typeof record !== "object" || Array.isArray(record)
        || Object.keys(record).sort().join("|") !== "data|detail|source|updated"
        || record.source !== "Discogs" || typeof record.updated !== "string"
        || typeof record.detail !== "string" || record.detail.length > 2000
        || !record.data || typeof record.data !== "object" || Array.isArray(record.data)
        || Object.keys(record.data).some((key) => !dataFields.has(key))) {
      throw new Error("Record di evidenza del completamento musicale non valido.");
    }
    result[id] = { source: "Discogs", updated: record.updated,
      detail: record.detail, data: { ...record.data } };
  }
  return result;
}

export function prepareSelectiveRestore(current, backup, ids, validate) {
  const available = new Map(backup.albums.map((album) => [album.id, album]));
  for (const id of ids) if (!available.has(id)) throw new Error("Selezione ripristino non valida.");
  const next = new Map(current.map((album) => [album.id, album]));
  for (const id of ids) next.set(id, validate(available.get(id)));
  return [...next.values()];
}

export function commitLocalRestore(storage, key, current, next, related = {}, historyLabel = "Modifica locale raccolta",
  normalize = (albums) => albums) {
  const savedCollection = JSON.parse(storage.getItem(COLLECTION_STORAGE_KEY) || "{}");
  const collectionWrite = key === COLLECTION_STORAGE_KEY;
  if (collectionWrite && (Object.hasOwn(current, "albums")
      && JSON.stringify(normalize(current.albums)) !== JSON.stringify(normalize(savedCollection.albums || []))
      || Object.hasOwn(current, "base")
      && JSON.stringify(normalize(current.base)) !== JSON.stringify(normalize(savedCollection.base || [])))) {
    throw new Error("La raccolta o la base salvata e' cambiata. Riapri l'anteprima: nessun dato locale sovrascritto.");
  }
  const historyChanges = [];
  const candidateRecords = { ...related };
  if (HISTORY_STORAGE_LABELS[key]) candidateRecords[key] = next;
  for (const [recordKey, updated] of Object.entries(candidateRecords)) {
    if (!HISTORY_STORAGE_LABELS[recordKey]) continue;
    const previous = JSON.parse(storage.getItem(recordKey) || "{}");
    const beforeRecords = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
    const afterRecords = updated && typeof updated === "object" && !Array.isArray(updated) ? updated : {};
    for (const id of new Set([...Object.keys(beforeRecords), ...Object.keys(afterRecords)])) {
      const beforePresent = Object.hasOwn(beforeRecords, id), afterPresent = Object.hasOwn(afterRecords, id);
      if (beforePresent === afterPresent && (!beforePresent || sameValue(beforeRecords[id], afterRecords[id]))) continue;
      historyChanges.push({ storageKey: recordKey, id, field: HISTORY_STORAGE_LABELS[recordKey],
        beforePresent, before: beforeRecords[id] ?? null,
        afterPresent, after: afterRecords[id] ?? null });
    }
  }
  const beforeAlbums = Array.isArray(savedCollection.albums) ? savedCollection.albums : [];
  const afterAlbums = collectionWrite && Array.isArray(next.albums) ? next.albums : beforeAlbums;
  const now = new Date().toISOString();
  const previousHistory = Array.isArray(savedCollection.collectionHistory) ? savedCollection.collectionHistory : [];
  const restoring = collectionWrite && Array.isArray(next.collectionHistory)
    && next.collectionHistory.some(entry => entry?.restoredAt
      && !previousHistory.find(previous => previous.id === entry.id)?.restoredAt);
  const activity = updateAlbumActivity(beforeAlbums, afterAlbums, savedCollection.activity, now,
    restoring);
  const knownIds = new Set(afterAlbums.map(album => album.id));
  for (const change of historyChanges) if (knownIds.has(change.id)) {
    activity[change.id] = { ...activity[change.id], modified: now };
  }
  if (collectionWrite) next = { ...next, activity };
  else if (historyChanges.length) candidateRecords[COLLECTION_STORAGE_KEY] = { ...savedCollection, activity };
  const entry = historyLabel !== null && (key === COLLECTION_STORAGE_KEY || historyChanges.length)
    ? createCollectionHistoryEntry(beforeAlbums, afterAlbums, historyLabel, new Date().toISOString(), historyChanges)
    : null;
  if (collectionWrite && historyLabel === null) {
    next = { ...next, collectionHistory: savedCollection.collectionHistory || [] };
  }
  if (entry) {
    let history = previousHistory;
    if (collectionWrite && Array.isArray(next.collectionHistory)) {
      const marked = new Map(next.collectionHistory.filter((row) => row?.restoredAt).map((row) => [row.id, row.restoredAt]));
      history = history.map((row) => marked.has(row.id) ? { ...row, restoredAt: marked.get(row.id) } : row);
    }
    history = appendCollectionHistory(history, entry);
    if (collectionWrite) next = { ...next, collectionHistory: history };
    else candidateRecords[COLLECTION_STORAGE_KEY] = {
      ...(candidateRecords[COLLECTION_STORAGE_KEY] || savedCollection), collectionHistory: history };
  }
  const writesByKey = new Map([[key, JSON.stringify(next)]]);
  for (const [relatedKey, value] of Object.entries(related)) {
    writesByKey.set(relatedKey, value === null ? null : JSON.stringify(value));
  }
  if (!collectionWrite && Object.hasOwn(candidateRecords, COLLECTION_STORAGE_KEY)) {
    writesByKey.set(COLLECTION_STORAGE_KEY, JSON.stringify(candidateRecords[COLLECTION_STORAGE_KEY]));
  }
  const writes = [...writesByKey];
  const originals = writes.map(([writeKey]) => [
    writeKey, typeof storage.getItem === "function" ? storage.getItem(writeKey) : undefined,
  ]);
  let written = 0;
  try {
    for (const [writeKey, value] of writes) {
      if (value === null) storage.removeItem(writeKey);
      else storage.setItem(writeKey, value);
      written += 1;
    }
  } catch (error) {
    let rollbackError = null;
    for (const [writeKey, value] of originals.slice(0, written).reverse()) {
      try {
        if (value === undefined || value === null) storage.removeItem(writeKey);
        else storage.setItem(writeKey, value);
      } catch (failure) { rollbackError ||= failure; }
    }
    if (rollbackError) throw new AggregateError([error, rollbackError], "Ripristino locale e recupero dei dati non riusciti.");
    throw error;
  }
  Object.assign(current, next);
}
import { validateSuggestionRecipes } from "./music-suggestion-recipes.mjs?v=2";
