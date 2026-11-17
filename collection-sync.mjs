import { validateDocument, createSyncDocument, threeWayMerge, decodeCoverArchive, encodeCoverArchive,
  findCollectionAlbum, archiveAlbumNoteVersions } from "./core.mjs?v=54";
import { validateDurationDocument, validateDurationEntries, durationDocument, mergeDurations } from "./duration-sync.mjs?v=1";

const API = "https://api.github.com";
export function githubCollectionSettings(storage) {
  const owner = (storage.getItem("accord-album-owner") || "").trim();
  const token = (storage.getItem("accord-album-token") || "").trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) || !token || /[\r\n]/.test(token)) {
    throw new Error("Configura proprietario e token GitHub nelle impostazioni.");
  }
  return { owner, token };
}
function base64(bytes) {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
const equalAlbums = (left, right) => JSON.stringify([...left].sort((a, b) => a.id.localeCompare(b.id)))
  === JSON.stringify([...right].sort((a, b) => a.id.localeCompare(b.id)));
const hash = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");

export function createCollectionSync({ storage, store, covers, fetch: request = globalThis.fetch }) {
  function client(assertExtra = () => {}) {
    const settings = githubCollectionSettings(storage);
    const root = `${API}/repos/${encodeURIComponent(settings.owner)}/accord-music-data`;
    function assertCurrent() {
      store.assertCurrent();
      assertExtra();
      const current = githubCollectionSettings(storage);
      if (current.owner !== settings.owner || current.token !== settings.token) throw new Error("Collegamento GitHub cambiato: operazione interrotta.");
    }
    async function send(url, options = {}, missing = false) {
      assertCurrent();
      let response;
      try {
        response = await request(url, { ...options, headers: { Accept: "application/vnd.github+json",
          Authorization: `Bearer ${settings.token}`, ...options.headers },
          signal: AbortSignal.timeout(30_000), credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
      } catch {
        throw new Error(options.method === "PUT"
          ? "Esito dell'invio GitHub incerto. Nessun invio ripetuto: rileggi con Sincronizza prima di riprovare."
          : "GitHub non raggiungibile. Nessuna modifica applicata.");
      }
      try { assertCurrent(); } catch (error) {
        if (options.method === "PUT") throw new Error(`${error.message} Invio GitHub forse completato; rileggi con Sincronizza.`);
        throw error;
      }
      if (missing && response.status === 404) return null;
      if (!response.ok) throw new Error(`GitHub HTTP ${response.status}. `
        + (response.status >= 500 && options.method === "PUT" ? "Esito incerto: nessun invio ripetuto."
          : response.status === 409 ? "Il file e' cambiato: aggiorna l'anteprima."
            : "Verifica repository privato e permesso Contents del token."));
      return response;
    }
    async function read(withCovers = false) {
      const repository = await (await send(root)).json();
      if (repository.private !== true || typeof repository.default_branch !== "string" || !repository.default_branch) {
        throw new Error("accord-music-data deve essere un repository privato con un branch predefinito.");
      }
      const branch = repository.default_branch, path = (file) => `${root}/contents/${file}?ref=${encodeURIComponent(branch)}`;
      const response = await send(path("albums.json"), {}, true);
      let albums = [], deletedAlbums = [], sha = null, deletionSync = false, deletionHistory = false;
      if (response) {
        const metadata = await response.json();
        if (metadata.type !== "file" || typeof metadata.sha !== "string" || !metadata.sha) throw new Error("albums.json non leggibile.");
        let bytes;
        if (metadata.encoding === "none") {
          bytes = new Uint8Array(await (await send(path("albums.json"), {
            headers: { Accept: "application/vnd.github.raw+json" } })).arrayBuffer());
          const current = await (await send(path("albums.json"))).json();
          if (current.sha !== metadata.sha) throw new Error("albums.json e' cambiato durante la lettura. Riprova Sincronizza.");
        } else {
          if (typeof metadata.content !== "string" || !metadata.content) throw new Error("albums.json non leggibile.");
          bytes = Uint8Array.from(atob(metadata.content.replace(/\s/g, "")), (char) => char.charCodeAt(0));
        }
        const document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        albums = validateDocument(document); sha = metadata.sha; deletionSync = document.deletion_sync === true;
        deletionHistory = document.deletion_history === true;
        if (document.deleted_albums !== undefined) deletedAlbums = validateDocument({
          format: document.format, version: 4, albums: document.deleted_albums });
        if (deletedAlbums.some((album) => albums.some((live) => live.id === album.id))) {
          throw new Error("Archivio rimozioni incoerente con gli album presenti. Nessun dato modificato.");
        }
      }
      const remote = { albums, deletedAlbums, sha, branch, deletionSync, deletionHistory, covers: new Map(), coversSha: null, archive: new Uint8Array(),
        durations: [], durationsSha: null };
      if (withCovers) {
        const metadataResponse = await send(path("covers.bin"), {}, true);
        if (metadataResponse) {
          const metadata = await metadataResponse.json();
          if (metadata.type !== "file" || typeof metadata.sha !== "string") throw new Error("covers.bin non leggibile.");
          remote.coversSha = metadata.sha;
          remote.archive = new Uint8Array(await (await send(path("covers.bin"), {
            headers: { Accept: "application/vnd.github.raw+json" } })).arrayBuffer());
          remote.covers = await decodeCoverArchive(remote.archive);
        }
        const durationsResponse = await send(path("durations.json"), {}, true);
        if (durationsResponse) {
          const metadata = await durationsResponse.json();
          if (metadata.type !== "file" || typeof metadata.sha !== "string" || !metadata.sha) throw new Error("Archivio durate non leggibile.");
          let bytes;
          if (metadata.encoding === "none") {
            bytes = new Uint8Array(await (await send(path("durations.json"), {
              headers: { Accept: "application/vnd.github.raw+json" } })).arrayBuffer());
            const current = await (await send(path("durations.json"))).json();
            if (current.sha !== metadata.sha) throw new Error("Le durate GitHub sono cambiate durante la lettura. Riprova.");
          } else {
            if (typeof metadata.content !== "string" || !metadata.content) throw new Error("Archivio durate non leggibile.");
            bytes = Uint8Array.from(atob(metadata.content.replace(/\s/g, "")), (char) => char.charCodeAt(0));
          }
          remote.durations = validateDurationDocument(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
          remote.durationsSha = metadata.sha;
        }
      }
      return remote;
    }
    async function write(file, bytes, sha, branch) {
      const payload = { message: `Sync Accord ${file}`, content: base64(bytes), branch, ...(sha ? { sha } : {}) };
      const response = await send(`${root}/contents/${file}`, { method: "PUT",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      let result;
      try { result = await response.json(); } catch { throw new Error("Invio GitHub non verificabile: rileggi con Sincronizza."); }
      if (typeof result?.content?.sha !== "string" || typeof result?.commit?.sha !== "string") {
        throw new Error("Conferma dell'invio GitHub incompleta: rileggi con Sincronizza.");
      }
    }
    return { read, write, assertCurrent, settings };
  }
  return {
    async checkAddition(album) {
      if (!storage.getItem("accord-album-owner") && !storage.getItem("accord-album-token")) return null;
      const connection = client(), remote = await connection.read();
      return findCollectionAlbum(remote.albums, album, store.links());
    },
    async sync({ chooseConflicts, confirm }) {
      const durationSnapshot = store.durationSnapshot();
      const connection = client(() => store.assertDurationSnapshot(durationSnapshot)), before = store.state, remote = await connection.read(true);
      connection.assertCurrent();
      const durationState = before.durationBase ?? { owner: connection.settings.owner, albums: [] };
      if (!durationState || typeof durationState !== "object" || Array.isArray(durationState)
          || typeof durationState.owner !== "string") throw new Error("Base durate locale non valida.");
      const durationBase = durationState.owner === connection.settings.owner ? validateDurationEntries(durationState.albums) : [];
      if (durationBase.length && !remote.durationsSha) throw new Error("L'archivio durate non e' piu' presente su GitHub. Ripristinalo prima di sincronizzare.");
      if (before.syncOwner && before.syncOwner !== connection.settings.owner && (before.pendingRemovals.length || before.deletedAlbums.length)) {
        throw new Error("Le rimozioni pendenti appartengono al precedente collegamento GitHub. Ripristina quel proprietario e sincronizza prima di cambiarlo.");
      }
      if ((before.base.length || before.deletedAlbums.length) && !remote.sha) throw new Error("albums.json non e' piu' presente. Ripristinalo su GitHub prima di sincronizzare: nessuna cancellazione automatica.");
      const base = new Map((!before.syncOwner || before.syncOwner === connection.settings.owner ? before.base : []).map((album) => [album.id, album]));
      before.pendingRemovals.forEach((album) => { if (!base.has(album.id)) base.set(album.id, album); });
      const remoteIds = new Set(remote.albums.map((album) => album.id));
      // A history-aware peer can deliberately restore an ID already absent from our base.
      const deleted = new Map([...before.deletedAlbums.filter((album) =>
        !remote.deletionHistory || !remoteIds.has(album.id) || base.has(album.id)), ...remote.deletedAlbums].map((album) => [album.id, album]));
      for (const album of deleted.values()) if (!base.has(album.id)) base.set(album.id, album);
      for (const id of before.restoredAlbumIds || []) base.delete(id);
      const links = store.links();
      const removedIds = new Set(before.pendingRemovals.map((album) => album.id));
      const distinctPairs = new Set((before.distinctAlbumPairs || []).map((pair) => JSON.stringify(pair)));
      for (const album of before.albums) {
        if (base.has(album.id) || remoteIds.has(album.id)) continue;
        const found = findCollectionAlbum(remote.albums, album, links);
        const pair = found && [album, found.album].map((record) => JSON.stringify([record.id, record.artist, record.name, record.year])).sort();
        const distinct = pair && distinctPairs.has(JSON.stringify(pair));
        if (found && !distinct && !removedIds.has(found.album.id)) {
          throw new Error(`${album.artist} - ${album.name} e' gia' nella raccolta condivisa con un altro ID. `
            + "Confronta le copie prima di sincronizzare: nessun duplicato inviato.");
        }
      }
      const options = { propagateDeletions: true };
      let merged = threeWayMerge([...base.values()], before.albums, remote.albums, {}, options);
      if (merged.conflicts.length) {
        archiveAlbumNoteVersions(storage, merged.conflicts, remote.sha);
        const choices = await chooseConflicts(merged.conflicts);
        if (!choices) return false;
        merged = threeWayMerge([...base.values()], before.albums, remote.albums, choices, options);
        if (merged.conflicts.length) throw new Error("Completa tutte le scelte prima di sincronizzare.");
      }
      const localIds = new Set(before.albums.map((row) => row.id));
      const durationLocal = [...before.albums];
      for (const row of merged.albums) {
        if (localIds.has(row.id) || !Object.hasOwn(durationSnapshot.values, row.id)) continue;
        const previous = base.get(row.id) || before.deletedAlbums.find((album) => album.id === row.id);
        if (!previous || ["id", "url"].some((key) => previous[key] !== row[key])) {
          throw new Error("Durata locale senza album corrispondente: verifica la raccolta prima di sincronizzare.");
        }
        durationLocal.push(row);
      }
      let durationMerge = mergeDurations(merged.albums, durationLocal, durationSnapshot.values, remote.durations, durationBase);
      if (durationMerge.conflicts.length) {
        const choices = await chooseConflicts(durationMerge.conflicts);
        if (!choices) return false;
        durationMerge = mergeDurations(merged.albums, durationLocal, durationSnapshot.values, remote.durations, durationBase, choices);
        if (durationMerge.conflicts.length) throw new Error("Completa tutte le scelte prima di sincronizzare.");
      }
      const outgoing = !equalAlbums(remote.albums, merged.albums), incoming = !equalAlbums(before.albums, merged.albums);
      const retained = new Set(merged.albums.map((album) => album.id));
      const remoteDurations = new Map(remote.durations.map((row) => [row.id, row]));
      const durationOutgoing = durationMerge.entries.filter((row) => JSON.stringify(remoteDurations.get(row.id)) !== JSON.stringify(row));
      const durationIncoming = durationMerge.entries.filter((row) => retained.has(row.id)
        && durationSnapshot.values[row.id] !== row.duration_ms);
      for (const album of base.values()) if (!retained.has(album.id) && !deleted.has(album.id)) deleted.set(album.id, album);
      for (const id of retained) deleted.delete(id);
      const deletedAlbums = [...deleted.values()].sort((a, b) => a.id.localeCompare(b.id));
      const deletionsChanged = !equalAlbums(remote.deletedAlbums, deletedAlbums);
      if ((outgoing || incoming || durationOutgoing.length || durationIncoming.length || deletionsChanged || !remote.deletionSync || !remote.deletionHistory)
          && !await confirm({ local: before.albums, remote: remote.albums, albums: merged.albums, durationOutgoing, durationIncoming })) return false;
      connection.assertCurrent();
      if (store.state !== before) throw new Error("Raccolta cambiata durante l'anteprima. Riapri Sincronizza.");
      const selected = new Map();
      for (const album of merged.albums) {
        if (!album.cover_sha256) continue;
        const local = await covers.get(album.id);
        const data = local && await hash(local) === album.cover_sha256 ? local : remote.covers.get(album.id)?.data;
        if (!data || await hash(data) !== album.cover_sha256) throw new Error(`Copertina non verificabile per ${album.name}. Sincronizza prima dal desktop; nessun invio eseguito.`);
        selected.set(album.id, data);
      }
      for (const [id, data] of selected) await covers.put(id, data);
      const archive = await encodeCoverArchive(selected);
      await decodeCoverArchive(archive);
      let coversWritten = false, albumsWritten = false, durationsWritten = false;
      try {
        connection.assertCurrent();
        if ((selected.size || remote.archive.length) && (archive.length !== remote.archive.length
            || archive.some((byte, index) => byte !== remote.archive[index]))) {
          await connection.write("covers.bin", archive, remote.coversSha, remote.branch);
          coversWritten = true;
        }
        if (outgoing || deletionsChanged || !remote.deletionSync || !remote.deletionHistory) {
          const document = { ...createSyncDocument(merged.albums), deletion_sync: true, deletion_history: true, deleted_albums: deletedAlbums };
          await connection.write("albums.json", new TextEncoder().encode(JSON.stringify(document, null, 2)), remote.sha, remote.branch);
          albumsWritten = true;
        }
        if (durationOutgoing.length) {
          await connection.write("durations.json", new TextEncoder().encode(JSON.stringify(durationDocument(durationMerge.entries), null, 2)),
            remote.durationsSha, remote.branch);
          durationsWritten = true;
        }
        connection.assertCurrent();
        store.commitSync({ ...before, albums: merged.albums, base: merged.albums, pendingRemovals: [],
          deletedAlbums, restoredAlbumIds: [],
          durationBase: { owner: connection.settings.owner, albums: durationMerge.entries },
          syncOwner: connection.settings.owner, lastSync: new Date().toISOString() }, durationSnapshot,
        durationMerge.entries.filter((row) => retained.has(row.id)));
      } catch (error) {
        throw new Error(`${error.message}${coversWritten || albumsWritten || durationsWritten
          ? " Invio parziale gia' completato su GitHub; copia locale non confermata. Rileggi con Sincronizza." : ""}`);
      }
      return true;
    },
  };
}
