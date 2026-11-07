const LOCAL_LAYOUTS = new Set(["comfortable", "compact"]);

export function normalizeCollectionPreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    layout: LOCAL_LAYOUTS.has(source.layout) ? source.layout : "comfortable",
    pinnedIds: [...new Set((Array.isArray(source.pinnedIds) ? source.pinnedIds : [])
      .filter((id) => typeof id === "string" && /^(?:[A-Za-z0-9]+|tidal:[1-9][0-9]*|qobuz:[A-Za-z0-9]{1,120})$/.test(id)))],
  };
}

export function visibleSelection(selectedIds, albums) {
  const visible = new Set(albums.map((album) => album.id));
  return new Set([...selectedIds].filter((id) => visible.has(id)));
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
      const validId = provider === "tidal" ? /^tidal:[1-9][0-9]*$/.test(record?.id || "")
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
        !["layout", "pinnedIds", "textScale", "contrast", "density"].includes(key))) {
    if (value?.format === "accord-local-backup" && [2, 3].includes(value.version)
        && value.preferences && typeof value.preferences === "object" && !Array.isArray(value.preferences)
        && Object.keys(value).every((key) => ["format", "version", "albums", "preferences",
          "manualOrder", "listeningQueue", "durations",
          ...(value.version === 3 ? ["suggestionRecipes", "completionProvenance", "completionEvidence"] : [])].includes(key))
        && Object.keys(value.preferences).every((key) =>
          ["layout", "pinnedIds", "textScale", "contrast", "density"].includes(key))) {
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
  const entry = historyLabel !== null && (key === COLLECTION_STORAGE_KEY || historyChanges.length)
    ? createCollectionHistoryEntry(beforeAlbums, afterAlbums, historyLabel, new Date().toISOString(), historyChanges)
    : null;
  if (collectionWrite && historyLabel === null) {
    next = { ...next, collectionHistory: savedCollection.collectionHistory || [] };
  }
  if (entry) {
    let history = Array.isArray(savedCollection.collectionHistory) ? savedCollection.collectionHistory : [];
    if (collectionWrite && Array.isArray(next.collectionHistory)) {
      const marked = new Map(next.collectionHistory.filter((row) => row?.restoredAt).map((row) => [row.id, row.restoredAt]));
      history = history.map((row) => marked.has(row.id) ? { ...row, restoredAt: marked.get(row.id) } : row);
    }
    history = appendCollectionHistory(history, entry);
    if (collectionWrite) next = { ...next, collectionHistory: history };
    else candidateRecords[COLLECTION_STORAGE_KEY] = { ...savedCollection, collectionHistory: history };
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
import { validateSuggestionRecipes } from "./music-suggestion-recipes.mjs?v=1";
