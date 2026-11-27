import { validateAlbum, validateDocument, findCollectionAlbum, collectionAlbumIdentity } from "./core.mjs?v=54";
import { catalogTarget } from "./music-completion.mjs?v=7";
import { addPhysicalRecords, createPhysicalStore, PHYSICAL_KEY, physicalKey,
  setPhysicalRecordFormat, validatePhysicalRecords } from "./physical-collection.mjs?v=2";
import { EDITION_LINKS_KEY, localEditionLinks, validateEditionLinks } from "./edition-links-sync.mjs?v=1";

export const COLLECTION_KEY = "accord-album-pwa-v1";
const DURATIONS_KEY = "accord-listening-album-durations-v1";
const QUEUE_KEY = "accord-listening-queue-v1";
const PROVENANCE_KEY = "accord-music-completion-provenance-v1";
const PENDING_LIBRARY_KEY = "accord-library-sync-pending-v1";
const albums = (records) => validateDocument({ format: "accord-album-collection", version: 4, albums: records });

export function duplicateCollectionGroups(records, links = {}) {
  if (!links || typeof links !== "object" || Array.isArray(links)) throw new Error("Associazioni album non valide.");
  const groups = new Map(), byId = new Map();
  for (const album of records) {
    const identity = collectionAlbumIdentity(album), key = JSON.stringify([identity.artist, identity.title]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(album); byId.set(album.id, key);
  }
  for (const album of records) for (const link of Object.values(links[album.id] || {})) {
    if (link?.source !== JSON.stringify([album.id, album.artist, album.name]) || !byId.has(link.id)) continue;
    const left = byId.get(album.id), right = byId.get(link.id);
    if (left === right) continue;
    const group = [...groups.get(left), ...groups.get(right)];
    groups.set(left, group); groups.delete(right);
    group.forEach((record) => byId.set(record.id, left));
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function suggestDuplicateMerge(records, favoriteIds = []) {
  if (records.length < 2 || new Set(records.map((album) => album.id)).size !== records.length) {
    throw new Error("Scegli almeno due copie distinte.");
  }
  const favorites = new Set(favoriteIds);
  const score = (album) => (album.cover_sha256 ? 100 : 0) + (favorites.has(album.id) ? 16 : 0)
    + (album.notes ? 8 : 0) + (album.rating !== null ? 4 : 0) + (album.status !== "queued" ? 2 : 0);
  const originals = records.map(validateAlbum).sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1));
  const keeper = originals[0], merged = { ...keeper };
  for (const field of ["genres", "collections", "tags"]) {
    const values = new Map();
    for (const album of originals) for (const value of album[field]) {
      if (!values.has(value.toLowerCase())) values.set(value.toLowerCase(), value);
    }
    merged[field] = [...values.values()];
  }
  if (!merged.primary_genre) merged.primary_genre = originals.find((album) => album.primary_genre)?.primary_genre || merged.genres[0] || "";
  if (merged.rating === null) merged.rating = originals.find((album) => album.rating !== null)?.rating ?? null;
  if (merged.status === "queued") merged.status = originals.find((album) => album.status !== "queued")?.status || "queued";
  const notes = new Map();
  for (const album of originals) if (album.notes?.trim() && !notes.has(album.notes)) notes.set(album.notes, album.id);
  const parts = [...notes].map(([note, id]) => notes.size > 1 ? `${id}:\n${note}` : note);
  const labels = { queued: "Da ascoltare", listening: "In ascolto", liked: "Mi piace", neutral: "Neutro", disliked: "Non mi piace" };
  for (const album of originals) {
    if (album.rating !== null && album.rating !== merged.rating) parts.push(`Voto originale (${album.id}): ${album.rating}/5`);
    if (album.status !== "queued" && album.status !== merged.status) parts.push(`Stato originale (${album.id}): ${labels[album.status]}`);
  }
  merged.notes = parts.join("\n\n---\n\n");
  return { album: validateAlbum(merged), originals, removeIds: originals.slice(1).map((album) => album.id),
    favorite: originals.some((album) => favorites.has(album.id)) };
}

export function createCollectionStore(storage) {
  let serialized = storage.getItem(COLLECTION_KEY);
  const raw = serialized === null ? {} : JSON.parse(serialized);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Raccolta locale non leggibile. Nessun dato sovrascritto.");
  const legacySnapshot = raw.physical === undefined ? storage.getItem(PHYSICAL_KEY) : undefined;
  const legacy = raw.physical === undefined ? createPhysicalStore(storage).state : null;
  let state = { ...raw, albums: albums(raw.albums === undefined ? [] : raw.albums), base: albums(raw.base === undefined ? [] : raw.base),
    pendingRemovals: albums(raw.pendingRemovals === undefined ? [] : raw.pendingRemovals),
    deletedAlbums: albums(raw.deletedAlbums === undefined ? [] : raw.deletedAlbums),
    physical: legacy ? legacy.records : validatePhysicalRecords(raw.physical),
    physicalBase: legacy ? legacy.base : validatePhysicalRecords(raw.physicalBase === undefined ? [] : raw.physicalBase),
    physicalOwner: legacy ? legacy.owner : raw.physicalOwner || "",
    physicalSha: legacy ? legacy.sha : raw.physicalSha || null,
    libraryOwner: raw.libraryOwner || "",
    syncOwner: raw.syncOwner || storage.getItem("accord-album-owner") || null,
    preferences: raw.preferences === undefined ? JSON.parse(storage.getItem("accord-collection-ui-v1") || "{}") : raw.preferences };
  if (!state.preferences || typeof state.preferences !== "object" || Array.isArray(state.preferences)) {
    throw new Error("Preferenze locali non leggibili. Nessun dato sovrascritto.");
  }
  const links = () => JSON.parse(storage.getItem(EDITION_LINKS_KEY) || "{}");
  function linksSnapshot() {
    const saved = storage.getItem(EDITION_LINKS_KEY);
    return { saved, values: validateEditionLinks(saved === null ? {} : JSON.parse(saved), true) };
  }
  function assertLinksSnapshot(snapshot) {
    if (storage.getItem(EDITION_LINKS_KEY) !== snapshot.saved) {
      throw new Error("Le associazioni sono cambiate durante la sincronizzazione. Riprova.");
    }
  }
  function durations() {
    const saved = JSON.parse(storage.getItem(DURATIONS_KEY) || "{}");
    const queue = JSON.parse(storage.getItem(QUEUE_KEY) || "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)
        || !queue || typeof queue !== "object" || Array.isArray(queue)
        || (queue.durations !== undefined && (!queue.durations || typeof queue.durations !== "object"
          || Array.isArray(queue.durations)))) throw new Error("Durate locali non leggibili.");
    const result = { ...queue.durations, ...saved };
    if (Object.values(result).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      throw new Error("Durate locali non valide.");
    }
    return result;
  }
  function assertCurrent() {
    if (storage.getItem(COLLECTION_KEY) !== serialized) throw new Error("Raccolta cambiata in un'altra scheda. Ricarica prima di continuare.");
    if (legacySnapshot !== undefined && storage.getItem(PHYSICAL_KEY) !== legacySnapshot) {
      throw new Error("I supporti sono cambiati nell’archivio precedente. Ricarica Accord prima di continuare.");
    }
  }
  function assertPhysicalEditable() {
    if (storage.getItem("accord-physical-sync-pending-v1") !== null) {
      throw new Error("Apri Sincronizza per verificare l’ultimo invio dei supporti.");
    }
  }
  function assertLibraryEditable() {
    if (storage.getItem(PENDING_LIBRARY_KEY) !== null) {
      throw new Error("Completa la verifica su GitHub e poi sincronizza prima di modificare la raccolta.");
    }
  }
  function durationSnapshot() {
    return { saved: storage.getItem(DURATIONS_KEY), queue: storage.getItem(QUEUE_KEY),
      provenance: storage.getItem(PROVENANCE_KEY), values: durations() };
  }
  function assertDurationSnapshot(snapshot) {
    if (storage.getItem(DURATIONS_KEY) !== snapshot.saved || storage.getItem(QUEUE_KEY) !== snapshot.queue
        || storage.getItem(PROVENANCE_KEY) !== snapshot.provenance) {
      throw new Error("Le durate o la coda sono cambiate durante la sincronizzazione. Riprova.");
    }
  }
  function commit(next) {
    assertCurrent();
    if (next.albums !== state.albums || next.physical !== state.physical) assertLibraryEditable();
    const value = JSON.stringify(next);
    storage.setItem(COLLECTION_KEY, value);
    serialized = value;
    state = next;
  }
  function writeLocalState(items, finish = () => {}) {
    const written = [];
    try {
      for (const [key, value] of items) {
        const previous = storage.getItem(key);
        storage.setItem(key, JSON.stringify(value));
        written.push([key, previous]);
      }
      finish();
    } catch (error) {
      for (const [key, previous] of written.reverse()) {
        try {
          if (previous === null) storage.removeItem(key); else storage.setItem(key, previous);
        } catch (rollback) {
          throw new Error(`Salvataggio locale incompleto: ${error.message}. Ripristino non riuscito: ${rollback.message}.`);
        }
      }
      throw error;
    }
  }
  function writeDurationState(saved, provenance, finish = () => {}) {
    writeLocalState([[DURATIONS_KEY, saved], [PROVENANCE_KEY, provenance]], finish);
  }
  function provenanceRecords() {
    const value = JSON.parse(storage.getItem(PROVENANCE_KEY) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.values(value).some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
      throw new Error("Provenienza delle durate non leggibile.");
    }
    return value;
  }
  function removeFrom(next, identifiers) {
    const ids = new Set(identifiers), removed = next.albums.filter((album) => ids.has(album.id));
    if (removed.length !== ids.size) throw new Error("Selezione cambiata: riapri il confronto.");
    const pending = new Map(next.pendingRemovals.map((album) => [album.id, album]));
    removed.forEach((album) => pending.set(album.id, album));
    return { ...next, albums: next.albums.filter((album) => !ids.has(album.id)), pendingRemovals: [...pending.values()] };
  }
  return {
    get state() { return state; }, links, linksSnapshot, assertLinksSnapshot, assertCurrent, commit, durations, durationSnapshot, assertDurationSnapshot,
    addPhysical(rows) {
      assertPhysicalEditable();
      commit({ ...state, physical: addPhysicalRecords(state.physical, rows) });
    },
    associateSupport(albumId, support, previous = null) {
      assertCurrent();
      assertPhysicalEditable();
      const album = state.albums.find(row => row.id === albumId);
      if (!album) throw new Error("Scheda cambiata. Ripeti la scelta.");
      let records = state.physical;
      let formats = support;
      if (previous) {
        const key = physicalKey(previous.artist, previous.title);
        const original = records.find(row => physicalKey(row.artist, row.title) === key);
        if (!original || original.cd !== previous.cd || original.vinyl !== previous.vinyl)
          throw new Error("Supporti cambiati. Riapri la scheda.");
        records = records.filter(row => row !== original);
        formats = original;
      }
      commit({ ...state, physical: addPhysicalRecords(records, [{ artist: album.artist, title: album.name,
        cd: formats.cd, vinyl: formats.vinyl }]) });
    },
    setPhysicalFormat(artist, title, format, checked) {
      assertPhysicalEditable();
      commit({ ...state, physical: setPhysicalRecordFormat(state.physical, artist, title, format, checked) });
    },
    pendingChanges() {
      const changed = new Set(), base = new Map(state.base.map((album) => [album.id, album]));
      const current = new Map(state.albums.map((album) => [album.id, album]));
      for (const id of new Set([...base.keys(), ...current.keys()])) {
        if (JSON.stringify(base.get(id) ?? null) !== JSON.stringify(current.get(id) ?? null)) changed.add(id);
      }
      state.pendingRemovals.forEach((album) => changed.add(album.id));
      const durationBase = new Map((state.durationBase?.albums || []).map((row) => [row.id, row.duration_ms]));
      const localDurations = durations();
      for (const id of new Set([...durationBase.keys(), ...Object.keys(localDurations)])) {
        if ((durationBase.get(id) ?? null) !== (localDurations[id] ?? null)) changed.add(id);
      }
      const currentLinks = links();
      const linkBase = localEditionLinks(state.editionLinksBase?.links ?? {});
      for (const id of new Set([...Object.keys(currentLinks), ...Object.keys(linkBase)])) {
        const current = Object.hasOwn(currentLinks, id) ? currentLinks[id] : {};
        const previous = Object.hasOwn(linkBase, id) ? linkBase[id] : {};
        for (const provider of new Set([...Object.keys(current || {}), ...Object.keys(previous)])) {
          if (JSON.stringify(current?.[provider] ?? null) !== JSON.stringify(previous[provider] ?? null)) changed.add(id);
        }
      }
      const physicalBase = new Map(state.physicalBase.map((row) => [physicalKey(row.artist, row.title), row]));
      for (const row of state.physical) {
        const key = physicalKey(row.artist, row.title);
        const previous = physicalBase.get(key);
        if (row.cd !== (previous?.cd ?? false) || row.vinyl !== (previous?.vinyl ?? false)) changed.add(`physical:${key}`);
      }
      return changed.size;
    },
    commitSync(next, snapshot, entries, linkSnapshot = null, syncedLinks = null) {
      assertCurrent();
      assertDurationSnapshot(snapshot);
      if (linkSnapshot) assertLinksSnapshot(linkSnapshot);
      const saved = JSON.parse(snapshot.saved || "{}");
      const provenance = provenanceRecords();
      for (const row of entries) {
        if (snapshot.values[row.id] !== row.duration_ms && provenance[row.id]) delete provenance[row.id].duration;
        saved[row.id] = row.duration_ms;
      }
      const value = JSON.stringify(next);
      const updates = [];
      if (entries.length) updates.push([DURATIONS_KEY, saved], [PROVENANCE_KEY, provenance]);
      if (linkSnapshot && JSON.stringify(syncedLinks) !== JSON.stringify(JSON.parse(linkSnapshot.saved || "{}"))) {
        updates.push([EDITION_LINKS_KEY, syncedLinks]);
      }
      writeLocalState(updates, () => storage.setItem(COLLECTION_KEY, value));
      serialized = value;
      state = next;
    },
    saveMissingDuration(album, duration, provenance = null) {
      assertCurrent();
      assertLibraryEditable();
      const current = state.albums.find((item) => item.id === album.id);
      if (!current || current.artist !== album.artist || current.name !== album.name || current.url !== album.url) {
        throw new Error("Album cambiato durante la lettura: durata non salvata.");
      }
      if (!Number.isSafeInteger(duration) || duration <= 0) throw new Error("Durata non valida.");
      if (Object.hasOwn(durations(), album.id)) return false;
      const saved = JSON.parse(storage.getItem(DURATIONS_KEY) || "{}");
      const records = provenanceRecords();
      if (provenance) {
        if (provenance.duration_ms !== duration || !["spotify", "tidal", "qobuz"].includes(provenance.source)
            || JSON.stringify(provenance.identity) !== JSON.stringify([album.id, album.artist, album.name])
            || catalogTarget(storage, album, provenance.source) !== provenance.target) {
          throw new Error("Provenienza della durata incoerente.");
        }
        records[album.id] = { ...records[album.id], duration: provenance };
      } else if (records[album.id]) delete records[album.id].duration;
      writeDurationState({ ...saved, [album.id]: duration }, records);
      return true;
    },
    duplicate: (candidate) => findCollectionAlbum(state.albums, candidate, links()),
    groups: () => duplicateCollectionGroups(state.albums, links()),
    suggestMerge: (group) => suggestDuplicateMerge(group, state.preferences.favoriteIds || []),
    merge(group, expected = state) {
      if (expected !== state) throw new Error("Raccolta cambiata: cerca di nuovo i duplicati.");
      const current = group.map((album) => state.albums.find((record) => record.id === album.id));
      if (current.some((album, index) => !album || JSON.stringify(album) !== JSON.stringify(group[index]))) {
        throw new Error("Copie cambiate: cerca di nuovo i duplicati.");
      }
      const proposal = suggestDuplicateMerge(current, state.preferences.favoriteIds || []);
      const next = removeFrom(state, proposal.removeIds);
      const favorites = new Set((state.preferences.favoriteIds || []).filter((id) => !proposal.removeIds.includes(id)));
      if (proposal.favorite) favorites.add(proposal.album.id);
      commit({ ...next, albums: next.albums.map((album) => album.id === proposal.album.id ? proposal.album : album),
        preferences: { ...state.preferences, favoriteIds: [...favorites] },
        duplicateMergeHistory: [...(state.duplicateMergeHistory || []), { originals: current, merged: proposal.album,
          at: new Date().toISOString() }] });
      return proposal;
    },
    add(candidate, { replaceId = null, distinct = false, physical = null } = {}) {
      assertCurrent();
      const record = validateAlbum(candidate), found = findCollectionAlbum(state.albums, record, links());
      if (physical !== null && (!physical || typeof physical !== "object" || Array.isArray(physical)
          || Object.keys(physical).some((key) => !["cd", "vinyl"].includes(key))
          || typeof physical.cd !== "boolean" || typeof physical.vinyl !== "boolean")) {
        throw new Error("Formati posseduti non validi.");
      }
      const withPhysical = (records) => {
        if (!physical || (!physical.cd && !physical.vinyl)) return records;
        const next = addPhysicalRecords(records, [{ artist: record.artist, title: record.name,
          cd: physical.cd, vinyl: physical.vinyl }]);
        if (JSON.stringify(next) === JSON.stringify(records)) return records;
        assertPhysicalEditable();
        return next;
      };
      if (found && (!distinct || found.album.id === record.id) && found.album.id !== replaceId) return found;
      let next = replaceId ? removeFrom(state, [replaceId]) : state;
      if (next.albums.some((album) => album.id === record.id)) throw new Error("Questo identificativo e' gia' presente.");
      next = { ...next, albums: [...next.albums, record], physical: withPhysical(next.physical),
        pendingRemovals: next.pendingRemovals.filter((album) => album.id !== record.id),
        restoredAlbumIds: [...new Set([...(next.restoredAlbumIds || []),
          ...next.deletedAlbums.filter((album) => album.id === record.id).map((album) => album.id)])] };
      if (distinct && found) next.distinctAlbumPairs = [...(next.distinctAlbumPairs || []),
        [record, found.album].map((album) => JSON.stringify([album.id, album.artist, album.name, album.year])).sort()];
      commit(next);
      return null;
    },
    update(id, changes) {
      const previous = state.albums.find((album) => album.id === id);
      if (!previous) throw new Error("Album non piu' presente.");
      const record = validateAlbum({ ...previous, ...changes });
      commit({ ...state, albums: state.albums.map((album) => album.id === id ? record : album) });
    },
    updateMany(ids, changes) {
      if(!Array.isArray(ids)||!ids.length||Object.keys(changes).some(k=>!["status","genres","primary_genre"].includes(k)))throw new Error("Modifica multipla non valida.");
      const selected=new Set(ids);
      if([...selected].some(id=>!state.albums.some(a=>a.id===id)))throw new Error("Raccolta cambiata.");
      commit({...state,albums:state.albums.map(a=>selected.has(a.id)?validateAlbum({...a,...changes}):a)});
    },
    addGenreMany(ids, genre) {
      const selected=new Set(ids);
      if(!selected.size||typeof genre!=="string"||!genre.trim()||genre.length>80||[...selected].some(id=>!state.albums.some(a=>a.id===id)))throw Error("Selezione o genere non validi.");
      commit({...state,albums:state.albums.map(a=>selected.has(a.id)?validateAlbum({...a,genres:[...new Set([...a.genres,genre.trim()])]}):a)});
    },
    addPhysicalMany(ids, format) {
      const selected=new Set(ids);
      if(!selected.size||!["cd","vinyl"].includes(format)||[...selected].some(id=>!state.albums.some(a=>a.id===id)))throw Error("Selezione o formato non validi.");
      assertPhysicalEditable();
      commit({...state,physical:addPhysicalRecords(state.physical,state.albums.filter(a=>selected.has(a.id)).map(a=>({artist:a.artist,title:a.name,cd:format==="cd",vinyl:format==="vinyl"})))});
    },
    favorite(id) {
      if (!state.albums.some((album) => album.id === id)) throw new Error("Album non piu' presente.");
      const favorites = new Set(state.preferences.favoriteIds || []);
      if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
      commit({ ...state, preferences: { ...state.preferences, favoriteIds: [...favorites] } });
    },
    remove(ids, expected = state) {
      if (expected !== state) throw new Error("Raccolta cambiata: riapri il confronto.");
      commit(removeFrom(state, ids));
    },
    identity: collectionAlbumIdentity,
  };
}

export function createCollectionCoverCache(indexedDB) {
  let opening;
  async function database() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open("accord-album-covers-v1", 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("covers")) request.result.createObjectStore("covers", { keyPath: "id" });
        if (!request.result.objectStoreNames.contains("lastfm-history")) request.result.createObjectStore("lastfm-history", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Archivio copertine non disponibile."));
      request.onblocked = () => reject(new Error("Archivio copertine bloccato da un'altra scheda."));
    });
    return opening;
  }
  return {
    async get(id) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const request = db.transaction("covers").objectStore("covers").get(id);
        request.onsuccess = () => resolve(request.result?.data ? new Uint8Array(request.result.data) : null);
        request.onerror = () => reject(new Error("Copertina locale non leggibile."));
      });
    },
    async put(id, data) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("covers", "readwrite"), objectStore = transaction.objectStore("covers");
        const request = objectStore.get(id);
        request.onsuccess = () => objectStore.put({ ...(request.result || { id }), data: data.slice().buffer });
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(new Error("Copertina non salvata offline."));
      });
    },
    async getUrl(id) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const request = db.transaction("covers").objectStore("covers").get(id);
        request.onsuccess = () => resolve(typeof request.result?.url === "string" ? request.result.url : null);
        request.onerror = () => reject(new Error("Indirizzo copertina non leggibile."));
      });
    },
    async putUrl(id, url) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("covers", "readwrite"), objectStore = transaction.objectStore("covers");
        const request = objectStore.get(id);
        request.onsuccess = () => objectStore.put({ ...(request.result || { id }), url });
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(new Error("Indirizzo copertina non salvato."));
      });
    },
  };
}
