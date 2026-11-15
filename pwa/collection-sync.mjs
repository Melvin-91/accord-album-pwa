import { validateDocument, createSyncDocument, threeWayMerge, decodeCoverArchive, encodeCoverArchive,
  findCollectionAlbum, archiveAlbumNoteVersions } from "./core.mjs?v=52";

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
  function client() {
    const settings = githubCollectionSettings(storage);
    const root = `${API}/repos/${encodeURIComponent(settings.owner)}/accord-music-data`;
    function assertCurrent() {
      store.assertCurrent();
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
      assertCurrent();
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
      let albums = [], sha = null, deletionSync = false;
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
      }
      const remote = { albums, sha, branch, deletionSync, covers: new Map(), coversSha: null, archive: new Uint8Array() };
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
      const connection = client(), before = store.state, remote = await connection.read(true);
      connection.assertCurrent();
      if (before.syncOwner && before.syncOwner !== connection.settings.owner && before.pendingRemovals.length) {
        throw new Error("Le rimozioni pendenti appartengono al precedente collegamento GitHub. Ripristina quel proprietario e sincronizza prima di cambiarlo.");
      }
      if (before.base.length && !remote.sha) throw new Error("albums.json non e' piu' presente. Ripristinalo su GitHub prima di sincronizzare: nessuna cancellazione automatica.");
      const base = new Map((!before.syncOwner || before.syncOwner === connection.settings.owner ? before.base : []).map((album) => [album.id, album]));
      before.pendingRemovals.forEach((album) => { if (!base.has(album.id)) base.set(album.id, album); });
      const remoteIds = new Set(remote.albums.map((album) => album.id)), links = store.links();
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
      const outgoing = !equalAlbums(remote.albums, merged.albums), incoming = !equalAlbums(before.albums, merged.albums);
      if ((outgoing || incoming || !remote.deletionSync) && !await confirm({ local: before.albums, remote: remote.albums, albums: merged.albums })) return false;
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
      let coversWritten = false, albumsWritten = false;
      try {
        connection.assertCurrent();
        if ((selected.size || remote.archive.length) && (archive.length !== remote.archive.length
            || archive.some((byte, index) => byte !== remote.archive[index]))) {
          await connection.write("covers.bin", archive, remote.coversSha, remote.branch);
          coversWritten = true;
        }
        if (outgoing || !remote.deletionSync) {
          const document = { ...createSyncDocument(merged.albums), deletion_sync: true };
          await connection.write("albums.json", new TextEncoder().encode(JSON.stringify(document, null, 2)), remote.sha, remote.branch);
          albumsWritten = true;
        }
        connection.assertCurrent();
        store.commit({ ...before, albums: merged.albums, base: merged.albums, pendingRemovals: [],
          syncOwner: connection.settings.owner, lastSync: new Date().toISOString() });
      } catch (error) {
        throw new Error(`${error.message}${coversWritten || albumsWritten
          ? " Invio parziale gia' completato su GitHub; copia locale non confermata. Rileggi con Sincronizza." : ""}`);
      }
      return true;
    },
  };
}
