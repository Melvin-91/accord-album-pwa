import { CatalogPlaylist, createCatalogPlaylist } from "./catalog-playlist.mjs?v=4";
import { fingerprint, saveCheckpoint, readCheckpoint, validateCheckpoint, clearCheckpoint, pauseRemaining } from "./music-continuity.mjs?v=6";

export function initializeCatalogPlaylistUI({ gate, providers, discoveryUI, render, clearSpotifyPreview, selectView,
  spotifyPreview = () => null }) {
  const field = (id) => document.getElementById(id);
  const root = document.querySelector("#playlistBuilderPanel > .playlist-builder");
  const status = field("playlistBuilderStatus"), previewButton = field("playlistPreviewButton");
  const createButton = field("playlistCreateButton"), previewOutput = field("playlistBuilderPreview");
  const inputs = ["playlistArtistCount", "playlistTracksPerArtist", "playlistBuilderName"].map(field);
  const privateControl = field("playlistPrivate"), privacyLabel = privateControl.parentElement;
  const description = root.querySelector(".tab-intro > p"), explanation = field("playlistBuilderExplanation");
  const spotifyExplanation = explanation.textContent;
  const verify = field("playlistVerifyButton"), management = field("playlistManageButton");
  const details = field("playlistBuilderDetails");
  const referenceDetails = field("playlistReferences"), referenceList = field("playlistReferenceList");
  const references = new Map(), excludedReferences = new Set();
  let service = "", busy = false, state = null, preview = null, source = null, signature = "";
  let historical = false, checkpointContext = null, pauseTimer = null;
  const resume = document.createElement("button"), pause = document.createElement("p");
  resume.type = "button"; resume.className = "secondary"; resume.textContent = "Riprendi anteprima conservata";
  management.parentElement.append(resume);
  pause.className = "notice"; pause.setAttribute("aria-live", "polite"); status.before(pause);
  const parameters = () => inputs.map((input) => input.value);
  const durableCriteria = () => JSON.stringify([gate.service, inputs.slice(0, 2).map((input) => input.value),
    discoveryUI.playlistDurableSignature(), [...excludedReferences]]);
  window.addEventListener("accord:discovery-criteria-changed", () => {
    clearCheckpoint(localStorage, gate.service);
    reset();
    status.textContent = "Criteri di suggerimento o playlist cambiati. Genera una nuova anteprima.";
  });
  for (const input of inputs.slice(0, 2)) input.addEventListener("change", () => {
    window.dispatchEvent(new CustomEvent("accord:discovery-criteria-changed"));
  });
  async function identity() { return fingerprint(await api().identity()); }
  inputs[2].addEventListener("input", () => {
    try { persist(); } catch (error) { status.textContent = `Parametri non conservati: ${error.message}`; }
  });
  function persist() {
    if (!preview || !checkpointContext) return;
    saveCheckpoint(localStorage, checkpointContext.provider, checkpointContext.identity, checkpointContext.criteria,
      { inputs: parameters(), excludedReferences: [...excludedReferences], references: [...references],
        discovery: discoveryUI.playlistParameters?.() || null },
      preview, state?.checkpoint() || null);
  }
  function updatePause() {
    clearTimeout(pauseTimer); pauseTimer = null;
    try {
      const remaining = pauseRemaining(localStorage, gate.service);
      const continuing = gate.service === "spotify" ? spotifyPreview()?.hasMore : state?.canContinue;
      pause.hidden = !remaining;
      pause.textContent = remaining ? `Pausa letture: ${remaining} s. Risultati verificati conservati. `
        + (continuing ? "Alla scadenza Continua riprende solo le letture mancanti. "
          : "Alla scadenza potrai avviare una nuova lettura. ")
        + "Nessun invio o riavvio automatico." : "";
      if (gate.service !== "spotify") {
        previewButton.disabled = busy || remaining > 0;
        createButton.disabled = busy || remaining > 0 || !preview?.tracks.length || uncertain.get();
      }
      if (remaining > 0) pauseTimer = setTimeout(updatePause, 1000);
      return remaining;
    } catch (error) { pause.hidden = false; pause.textContent = error.message; return Infinity; }
  }
  const api = () => providers[gate.service].playlistAPI;
  const key = () => gate.service === "qobuz" ? "accord-qobuz-write-uncertain-v1" : "accord-catalog-playlist-uncertain-tidal-v1";
  const uncertain = { get: () => Boolean(localStorage.getItem(key())),
    set: (value) => value ? localStorage.setItem(key(), "pending") : localStorage.removeItem(key()) };
  const currentSignature = () => JSON.stringify([gate.service, gate.epoch, api().revision(),
    inputs.slice(0, 2).map((input) => input.value), discoveryUI.playlistSignature(), [...excludedReferences]]);
  function controls() {
    if (gate.service === "spotify") return;
    for (const input of inputs) input.disabled = busy;
    previewButton.disabled = busy;
    management.disabled = busy;
    verify.hidden = !uncertain.get(); verify.disabled = busy;
    createButton.disabled = busy || !preview?.tracks.length || uncertain.get();
    previewButton.textContent = state?.canContinue ? "Continua anteprima" : "Genera anteprima";
    try { resume.disabled = busy || !readCheckpoint(localStorage, gate.service); }
    catch (error) { resume.disabled = false; status.textContent = error.message; }
    updatePause();
  }
  function reset() {
    state = null; source = null; preview = null; signature = "";
    historical = false; checkpointContext = null;
    previewOutput.replaceChildren(); details.textContent = ""; controls();
  }
  function configure() {
    if (service !== gate.service) {
      service = gate.service; reset(); clearSpotifyPreview();
      references.clear(); excludedReferences.clear(); referenceList.replaceChildren();
      status.textContent = "Genera un'anteprima nel servizio scelto. Nessuna playlist creata.";
    }
    const native = service !== "spotify", tidal = service === "tidal";
    resume.hidden = !native;
    root.hidden = false;
    root.querySelector(".eyebrow").textContent = `CREAZIONE ${service.toUpperCase()}`;
    description.textContent = "Nuovi artisti con lo stesso metodo di Suggerimenti. "
      + (tidal ? "Playlist non in elenco: accessibile a chi ha il link." : "Playlist privata, solo dopo conferma.");
    privateControl.checked = !tidal;
    privacyLabel.title = tidal ? "Non disponibile: l'API TIDAL crea UNLISTED, non playlist private. Chi ha il link può accedere."
      : "Accord crea sempre playlist private.";
    createButton.textContent = tidal ? "Crea playlist non in elenco" : "Crea playlist privata";
    field("playlistTracksPerArtist").title = native
      ? "Primi N brani verificati nell'ordine dell'album suggerito, non una classifica di popolarità."
      : "Brani verificati dagli album suggeriti su Spotify.";
    explanation.textContent = native
      ? "Stesso metodo di Suggerimenti: cronologia Last.fm disponibile (anche multi-servizio), artisti affini Last.fm, "
        + "album verificati nel catalogo scelto. Impostazioni periodo, generi ed esclusioni nella scheda Suggerimenti; "
        + "nessuna richiesta Spotify. Nessuna classifica personale nativa simulata e nessun ripiego sugli artisti ascoltati. "
        + "Obiettivo fino a 50 artisti, non garantito. Primi N brani in ordine album, saltando i non disponibili e i duplicati. "
        + "Per passaggio: 20 letture logiche scoperta + 10 letture brani, oltre alla preparazione cronologia. "
        + "Ogni lettura può richiedere più pagine entro i limiti del client. "
        + "I filtri automatici Spotify/Discogs non equivalenti non vengono simulati; restano i tag Last.fm di Suggerimenti."
      : spotifyExplanation;
    referenceDetails.hidden = !native; details.parentElement.hidden = !native;
    field("playlistUnsupportedRating").hidden = !native;
    management.disabled = !native || busy;
    management.title = native ? "Apri la gestione delle playlist esistenti in un pannello secondario."
      : "Gestione remota delle playlist esistenti non disponibile nella PWA Spotify; usa l'app Spotify.";
    verify.hidden = !native || !uncertain.get();
    controls();
  }
  for (const input of inputs.slice(0, 2)) input.addEventListener("change", () => {
    if (gate.service !== "spotify") { reset(); status.textContent = "Criteri modificati. Genera una nuova anteprima."; }
  });
  function renderReferences() {
    referenceList.replaceChildren();
    for (const [name, plays] of references) {
      const label = document.createElement("label"), choice = document.createElement("input");
      choice.type = "checkbox"; choice.checked = !excludedReferences.has(name);
      choice.addEventListener("change", () => {
        if (choice.checked) excludedReferences.delete(name); else excludedReferences.add(name);
        reset(); status.textContent = "Riferimenti modificati. Genera una nuova anteprima.";
      });
      label.append(choice, document.createTextNode(`${name} · ${plays} ascolti`)); referenceList.append(label);
    }
  }
  async function run(continuing = Boolean(state?.canContinue)) {
    if (busy || gate.service === "spotify") return;
    const provider = gate.service, epoch = gate.epoch, account = api().revision();
    const expected = currentSignature();
    const guard = () => {
      gate.assert(provider, epoch);
      if (account !== providers[provider].playlistAPI.revision() || expected !== currentSignature()) {
        throw new Error("Account o criteri cambiati: genera una nuova anteprima.");
      }
    };
    busy = true; preview = null; controls();
    status.textContent = "Cerco nuovi artisti e verifico i brani nel catalogo scelto…";
    try {
      if (continuing && signature !== expected) throw new Error("Criteri cambiati: genera una nuova anteprima.");
      if (!continuing) {
        state = null; previewOutput.replaceChildren();
        const target = Number(inputs[0].value), perArtist = Number(inputs[1].value);
        if (!Number.isInteger(perArtist) || perArtist < 1 || perArtist > 10
            || !Number.isInteger(target) || target < 1 || target > 50) throw new Error("Scegli 1–50 artisti e 1–10 brani per artista.");
        source = await discoveryUI.playlistSource(target, guard, [...excludedReferences]); guard();
        state = new CatalogPlaylist(source.discovery, perArtist);
        for (const row of source.references) references.set(row.name, row.plays ?? row.count ?? 0);
        renderReferences();
        signature = expected;
        checkpointContext = { provider, identity: await identity(), criteria: durableCriteria() };
        historical = false;
      }
      if (!state || !source) throw new Error("Genera una nuova anteprima.");
      preview = await state.step({ discover: source.discover, albumTracks: api().albumTracks, guard: source.guard });
      guard(); render(preview); api().adopt(preview.tracks);
      if (historical) status.textContent += " Include risultati storici conservati, non riletti oggi.";
      details.textContent = `${preview.source}. Letture scoperta: ${preview.reads}; letture brani: ${preview.trackReads}. `
        + `Noti/duplicati: ${preview.stats.known}; ambigui: ${preview.stats.ambiguous}; non trovati: ${preview.stats.unmatched}. `
        + "I primi brani seguono l'ordine dell'album, non classifiche native. Durata, artisti e brani già noti: solo dati disponibili.";
    } catch (error) {
      if (gate.service === provider && gate.epoch === epoch) {
        if (expected === currentSignature() && state) { preview = state.preview(); render(preview); }
        else reset();
        status.textContent = `Anteprima non completata: ${error.message}`;
      }
    } finally {
      if (gate.service === provider && expected === currentSignature()) {
        try { persist(); } catch (error) { status.textContent += ` Ripresa non salvata: ${error.message}`; }
      }
      busy = false; configure(); controls();
    }
  }
  async function create() {
    if (busy || gate.service === "spotify" || !preview?.tracks.length) return;
    const provider = gate.service, epoch = gate.epoch, expected = signature, selectedAPI = api();
    const name = inputs[2].value.trim();
    if (!name || name.length > 100) { status.textContent = "Inserisci un nome di massimo 100 caratteri."; return; }
    const guard = () => {
      gate.assert(provider, epoch);
      if (expected !== currentSignature()) throw new Error("Account o criteri cambiati: genera una nuova anteprima.");
    };
    try { guard(); } catch (error) { reset(); status.textContent = error.message; return; }
    const privacy = provider === "tidal" ? "non in elenco, accessibile a chi ha il link (NON privata)" : "privata";
    if (!confirm(`Creare «${name}» ${privacy} con ${preview.tracks.length} brani verificati?`)) return;
    if (historical && !confirm("Sono risultati storici conservati, non riletti oggi. Confermi l'uso di questi brani? Nessuna scrittura precedente verrà ripresa.")) return;
    const savedPreview = preview, tracks = preview.tracks;
    busy = true; preview = null; controls();
    status.textContent = "Creo la playlist e aggiungo i brani verificati…";
    try {
      const playlist = await createCatalogPlaylist({ api: selectedAPI, name, tracks, guard, uncertain,
        lock: (action) => {
          if (!navigator.locks?.request) throw new Error("Browser senza blocco scritture sicuro: creazione non disponibile.");
          return navigator.locks.request(provider === "qobuz" ? "accord-qobuz-write-v1" : "accord-tidal-playlist-builder-v1", action);
        } });
      guard();
      status.textContent = `Playlist ${privacy} creata: ${playlist.name || name} · ${tracks.length} brani.`;
      state = null; source = null;
      clearCheckpoint(localStorage, provider);
    } catch (error) {
      if (gate.service === provider && gate.epoch === epoch) {
        const pending = uncertain.get();
        if (!pending && expected === currentSignature()) preview = savedPreview;
        status.textContent = `${pending ? "Creazione non completata" : "Creazione non avviata"}: ${error.message}`;
      }
    } finally { busy = false; configure(); controls(); }
  }
  verify.addEventListener("click", async () => {
    if (busy || gate.service === "spotify") return;
    const provider = gate.service, epoch = gate.epoch;
    busy = true; controls();
    try {
      if (!navigator.locks?.request) throw new Error("Browser senza blocco scritture sicuro: verifica non disponibile.");
      await navigator.locks.request(provider === "qobuz" ? "accord-qobuz-write-v1" : "accord-tidal-playlist-builder-v1",
        { ifAvailable: true }, (lock) => {
          gate.assert(provider, epoch);
          if (!lock) throw new Error("Scrittura ancora in corso in un'altra scheda. Attendi prima di verificare.");
          if (!confirm("Hai controllato nell'app la playlist e i brani, anche parziali? "
              + "Confermare sblocca nuove scritture, non ripete l'operazione.")) return;
          uncertain.set(false); clearCheckpoint(localStorage, provider); reset();
          status.textContent = "Verifica confermata. Genera una nuova anteprima prima di creare.";
        });
    } catch (error) {
      if (gate.service === provider && gate.epoch === epoch) status.textContent = `Verifica non completata: ${error.message}`;
    } finally { busy = false; controls(); }
  });
  management.addEventListener("click", () => {
    if (gate.service !== "spotify") api().management();
  });
  async function prepareRecords(records) {
    if (busy || gate.service === "spotify") throw new Error("Attendi il completamento dell'operazione.");
    const provider = gate.service, epoch = gate.epoch, expected = currentSignature();
    const guard = () => {
      gate.assert(provider, epoch);
      if (expected !== currentSignature()) throw new Error("Account o criteri cambiati.");
    };
    busy = true; reset(); controls();
    try {
      const result = await api().prepare(records, guard); guard();
      const groups = new Map();
      const tracks = result.tracks.map((track) => {
        const name = track.artist || "Crediti non disponibili";
        const id = name;
        if (!groups.has(id)) groups.set(id, { id, name, tracks: 0 });
        groups.get(id).tracks += 1;
        return { ...track, sourceArtistId: id };
      });
      preview = { artists: [...groups.values()], tracks, requestedArtists: groups.size, hasMore: false,
        source: "Album selezionati esplicitamente", partialReason: result.partial ? "Limite di lettura album raggiunto." : "" };
      signature = expected;
      api().adopt(tracks);
      render(preview); selectView("playlists");
      checkpointContext = { provider, identity: await identity(), criteria: durableCriteria() };
      persist();
      return "Anteprima pronta nella scheda Crea playlist. Nessuna scrittura eseguita.";
    } finally { busy = false; controls(); }
  }
  window.addEventListener("storage", () => { if (gate.service !== "spotify") controls(); });
  resume.addEventListener("click", async () => {
    if (busy || gate.service === "spotify") return;
    const provider = gate.service, epoch = gate.epoch;
    let displayed = false;
    busy = true; controls();
    try {
      const record = readCheckpoint(localStorage, provider);
      if (!record) throw new Error("Nessuna anteprima conservata.");
      record.parameters.inputs.forEach((value, index) => { inputs[index].value = value; });
      if (record.parameters.discovery) discoveryUI.restorePlaylistParameters(record.parameters.discovery);
      excludedReferences.clear(); references.clear();
      for (const name of record.parameters.excludedReferences || []) excludedReferences.add(name);
      for (const [name, plays] of record.parameters.references || []) references.set(name, plays);
      state = null; source = null; preview = null; checkpointContext = null;
      render(record.preview); controls();
      displayed = true;
      status.textContent += " Risultati storici conservati, non riletti oggi; verifico l'account prima di abilitare i comandi.";
      const account = await identity(); gate.assert(provider, epoch);
      validateCheckpoint(record, account, durableCriteria());
      signature = currentSignature();
      const expected = signature;
      const guard = () => {
        gate.assert(provider, epoch);
        if (expected !== currentSignature()) throw new Error("Account o criteri cambiati.");
      };
      source = record.state ? discoveryUI.restorePlaylistSource(record.state.discovery, guard) : null;
      state = record.state ? CatalogPlaylist.restore(record.state, source.discovery) : null;
      checkpointContext = { provider, identity: account, criteria: durableCriteria() };
      preview = record.preview; historical = true;
      renderReferences(); render(preview); api().adopt(preview.tracks);
      status.textContent += " Risultati storici, non riletti oggi. Continua riprende solo le letture; creazione solo dopo nuova conferma.";
      controls();
    } catch (error) { status.textContent = `${displayed ? "Risultati conservati consultabili. " : ""}Ripresa non disponibile: ${error.message}`; }
    finally { busy = false; controls(); }
  });
  window.addEventListener("pagehide", () => clearTimeout(pauseTimer));
  window.addEventListener("pageshow", updatePause);
  configure();
  return { configure, run, create, prepareRecords, isBusy: () => busy };
}
