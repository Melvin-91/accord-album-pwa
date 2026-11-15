import { validateAlbum, validateDocument, findCollectionAlbum, collectionAlbumIdentity } from "./core.mjs?v=52";

export const COLLECTION_KEY = "accord-album-pwa-v1";
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

export function createCollectionStore(storage) {
  let serialized = storage.getItem(COLLECTION_KEY);
  const raw = serialized === null ? {} : JSON.parse(serialized);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Raccolta locale non leggibile. Nessun dato sovrascritto.");
  let state = { ...raw, albums: albums(raw.albums === undefined ? [] : raw.albums), base: albums(raw.base === undefined ? [] : raw.base),
    pendingRemovals: albums(raw.pendingRemovals === undefined ? [] : raw.pendingRemovals),
    syncOwner: raw.syncOwner || storage.getItem("accord-album-owner") || null,
    preferences: raw.preferences === undefined ? JSON.parse(storage.getItem("accord-collection-ui-v1") || "{}") : raw.preferences };
  if (!state.preferences || typeof state.preferences !== "object" || Array.isArray(state.preferences)) {
    throw new Error("Preferenze locali non leggibili. Nessun dato sovrascritto.");
  }
  const links = () => JSON.parse(storage.getItem("accord-music-edition-links-v1") || "{}");
  function assertCurrent() {
    if (storage.getItem(COLLECTION_KEY) !== serialized) throw new Error("Raccolta cambiata in un'altra scheda. Ricarica prima di continuare.");
  }
  function commit(next) {
    assertCurrent();
    const value = JSON.stringify(next);
    storage.setItem(COLLECTION_KEY, value);
    serialized = value;
    state = next;
  }
  function removeFrom(next, identifiers) {
    const ids = new Set(identifiers), removed = next.albums.filter((album) => ids.has(album.id));
    if (removed.length !== ids.size) throw new Error("Selezione cambiata: riapri il confronto.");
    const pending = new Map(next.pendingRemovals.map((album) => [album.id, album]));
    removed.forEach((album) => pending.set(album.id, album));
    return { ...next, albums: next.albums.filter((album) => !ids.has(album.id)), pendingRemovals: [...pending.values()] };
  }
  return {
    get state() { return state; }, links, assertCurrent, commit,
    duplicate: (candidate) => findCollectionAlbum(state.albums, candidate, links()),
    groups: () => duplicateCollectionGroups(state.albums, links()),
    add(candidate, { replaceId = null, distinct = false } = {}) {
      assertCurrent();
      const record = validateAlbum(candidate), found = findCollectionAlbum(state.albums, record, links());
      if (found && (!distinct || found.album.id === record.id) && found.album.id !== replaceId) return found;
      let next = replaceId ? removeFrom(state, [replaceId]) : state;
      if (next.albums.some((album) => album.id === record.id)) throw new Error("Questo identificativo e' gia' presente.");
      next = { ...next, albums: [...next.albums, record],
        pendingRemovals: next.pendingRemovals.filter((album) => album.id !== record.id) };
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
        request.onsuccess = () => resolve(request.result ? new Uint8Array(request.result.data) : null);
        request.onerror = () => reject(new Error("Copertina locale non leggibile."));
      });
    },
    async put(id, data) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("covers", "readwrite");
        transaction.objectStore("covers").put({ id, data: data.slice().buffer });
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(new Error("Copertina non salvata offline."));
      });
    },
  };
}
