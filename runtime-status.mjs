const musicalFields = ["name", "artist", "url", "year", "status", "rating", "genres",
  "primary_genre", "collections", "tags", "notes"];

export function musicalRecords(albums) {
  return albums.map((album) => ({ id: album.id, ...Object.fromEntries(musicalFields.map((field) =>
    [field, album[field] ?? (["genres", "collections", "tags"].includes(field) ? [] : field === "rating" ? null : "")])) }));
}

export function musicalChanges(before, after) {
  const project = (albums) => new Map(musicalRecords(albums).map(({ id, ...album }) => [id, JSON.stringify(album)]));
  const old = project(before), next = project(after);
  return [...new Set([...old.keys(), ...next.keys()])].filter((id) => old.get(id) !== next.get(id)).length;
}

export function localCollectionStatus(storage, key, state, normalize = (albums) => albums) {
  const raw = storage.getItem(key);
  const saved = raw === null ? null : JSON.parse(raw);
  if (raw !== null && (!saved || !Array.isArray(saved.albums) || !Array.isArray(saved.base))) {
    throw new Error("Archivio raccolta non valido.");
  }
  const pending = musicalChanges(normalize(saved?.base || []), normalize(saved?.albums || []));
  const unsaved = ["albums", "base", "manualOrder", "sortOrder", "preferences"]
    .some((field) => {
      const stored = saved?.[field] ?? (
        ["albums", "base", "manualOrder"].includes(field) ? [] : field === "sortOrder" ? "artist" : undefined);
      const project = ["albums", "base"].includes(field) ? normalize : (value) => value;
      return JSON.stringify(project(state[field])) !== JSON.stringify(project(stored));
    });
  return { exists: saved !== null, pending, unsaved };
}

export function serviceFailure(error, online = true) {
  const status = error.response?.status ?? error.response?.status_code ?? error.status;
  const headers = error.response?.headers;
  if (status === 429 || status === 403 && (
    headers?.get?.("retry-after") || headers?.get?.("x-ratelimit-remaining") === "0")) {
    return "Limite del servizio / cooldown: attendi prima di riprovare";
  }
  if ([401, 403, 404].includes(status)) return "Accesso al servizio rifiutato: verifica autorizzazioni e permessi";
  if (status >= 500) return `Servizio non disponibile (HTTP ${status})`;
  if (error instanceof TypeError || error.name === "NetworkError") {
    return online ? "Servizio non raggiungibile: rete, CORS o servizio non disponibili"
      : "Offline: sincronizzazione non eseguita; i dati locali non sono un errore";
  }
  return "Operazione non completata: controlla i dettagli";
}

export function createUpdateLifecycle({ hasWork, prepare, confirm, reload, present, status,
  schedule = setTimeout, cancel = clearTimeout }) {
  let worker = null, activated = false, chosen = false, reloaded = false, timer = null;
  const reset = (text) => {
    chosen = false;
    if (timer !== null) cancel(timer);
    timer = null;
    status(text, false);
  };
  const restart = () => {
    if (reloaded) return;
    try {
      if (hasWork()) {
        reset("Riavvio rimandato: sono presenti modifiche o attivita'. Conferma di nuovo quando hai finito.");
        present();
        return;
      }
      prepare();
      reloaded = true;
      if (timer !== null) cancel(timer);
      reload();
    } catch (error) { reset(`Riavvio non eseguito: ${error.message}`); }
  };
  return {
    defer() { reset("Aggiornamento rimandato. Nessun riavvio automatico."); },
    ready(next) {
      worker = next;
      activated = next?.state === "activated";
      present();
      if (!chosen) status("Nuova versione pronta. Riavvio solo dopo conferma.", false);
    },
    apply() {
      if (chosen || reloaded) return;
      try {
        if (!worker && !activated) throw new Error("Nessun aggiornamento pronto.");
        if (hasWork()) throw new Error("Completa o scarta le bozze, attendi le attivita' e chiudi le finestre prima di riavviare.");
        if (!confirm()) return;
        if (hasWork()) throw new Error("Stato cambiato: riavvio rimandato.");
        prepare();
        chosen = true;
        status("Attivazione richiesta; attendo il riavvio.", true);
        if (activated || worker.state === "activated") {
          activated = true;
          restart();
        } else {
          worker.postMessage({ type: "accord-activate-update" });
          timer = schedule(() => reset("Attivazione non confermata. Nessun riavvio eseguito; riprova esplicitamente."), 15000);
        }
      } catch (error) { reset(error.message); }
    },
    controllerChanged(next, replacing = true) {
      if (!replacing) return;
      worker = next;
      activated = true;
      if (chosen) restart();
      else {
        present();
        status("Versione nuova attivata in un'altra scheda. Questa app resta aperta; riavvia solo su conferma.", false);
      }
    },
  };
}
