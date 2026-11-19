import { validateDocument, createSyncDocument, threeWayMerge, decodeCoverArchive, encodeCoverArchive,
  findCollectionAlbum, archiveAlbumNoteVersions } from "./core.mjs?v=54";
import { validateDurationDocument, validateDurationEntries, durationDocument, mergeDurations } from "./duration-sync.mjs?v=1";

const API = "https://api.github.com";
const UNCERTAIN_WRITE_KEY = "accord-album-sync-uncertain-v1";
class UncertainGitHubWrite extends Error {}

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
async function gitBlobSha(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const blob = new Uint8Array(header.length + bytes.length);
  blob.set(header); blob.set(bytes, header.length);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-1", blob))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createCollectionSync({ storage, store, covers, fetch: request = globalThis.fetch }) {
  const uncertainWrite = () => {
    const saved = storage.getItem(UNCERTAIN_WRITE_KEY);
    if (saved === null) return null;
    const marker = JSON.parse(saved);
    if (!marker || typeof marker !== "object" || Array.isArray(marker)
        || !["albums.json", "covers.bin", "durations.json"].includes(marker.file)
        || typeof marker.owner !== "string" || typeof marker.branch !== "string"
        || !/^[a-f0-9]{40}$/.test(marker.blobSha)) {
      throw new Error("Registro dell'invio GitHub incerto non valido. Nessun invio eseguito.");
    }
    return marker;
  };
  function client(assertExtra = () => {}, progress = () => {}) {
    const settings = githubCollectionSettings(storage);
    const root = `${API}/repos/${encodeURIComponent(settings.owner)}/accord-music-data`;
    function assertCurrent() {
      store.assertCurrent();
      assertExtra();
      const current = githubCollectionSettings(storage);
      if (current.owner !== settings.owner || current.token !== settings.token) throw new Error("Collegamento GitHub cambiato: operazione interrotta.");
    }
    async function send(url, { method = "GET", body, missing = false, raw = false, label } = {}) {
      assertCurrent();
      const writing = method === "PUT", timeout = writing || raw ? 120_000 : 30_000;
      let response;
      function transferFailure(error) {
        const interrupted = error?.name === "TimeoutError" || error?.name === "AbortError";
        const detail = interrupted ? `Trasferimento interrotto o tempo limite raggiunto (${timeout / 1000} s).`
          : "Connessione interrotta o bloccata dal browser.";
        if (writing) return new UncertainGitHubWrite(`Esito dell'invio GitHub incerto. ${detail}`);
        return new Error(`Lettura GitHub di ${label} non completata. ${detail} Riprova Sincronizza.`);
      }
      try {
        response = await request(url, { method, body, headers: {
          Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
          Authorization: `Bearer ${settings.token}`, ...(writing ? { "Content-Type": "application/json" } : {}) },
          signal: AbortSignal.timeout(timeout),
          cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
      } catch (error) {
        throw transferFailure(error);
      }
      function assertAfterResponse() {
        try { assertCurrent(); } catch (error) {
          if (writing) throw new Error(`${error.message} Invio GitHub forse completato; rileggi con Sincronizza.`);
          throw error;
        }
      }
      assertAfterResponse();
      if (missing && response.status === 404) return null;
      if (!response.ok) {
        if (response.headers.get("Retry-After") || response.headers.get("X-RateLimit-Remaining") === "0") {
          throw new Error(`GitHub HTTP ${response.status}. Il server richiede un'attesa: riprova Sincronizza piu' tardi.`
            + (writing && response.status >= 500 ? " Esito dell'invio incerto; nessun invio ripetuto." : ""));
        }
        if (response.status >= 500 && writing) {
          throw new UncertainGitHubWrite(`GitHub HTTP ${response.status}. Esito dell'invio incerto.`);
        }
        throw new Error(`GitHub HTTP ${response.status}. `
          + (response.status === 409 ? "Il file e' cambiato: aggiorna l'anteprima."
            : "Verifica repository privato e permesso Contents del token."));
      }
      let result;
      try {
        result = raw ? new Uint8Array(await response.arrayBuffer()) : await response.json();
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw transferFailure(error);
        if (writing) throw new UncertainGitHubWrite("Risposta dell'invio GitHub non leggibile.");
        throw new Error(`Risposta GitHub non valida per ${label}.`);
      }
      assertAfterResponse();
      if (!raw && (!result || typeof result !== "object" || Array.isArray(result))) {
        if (writing) throw new UncertainGitHubWrite("Risposta dell'invio GitHub non leggibile.");
        throw new Error(`Risposta GitHub non valida per ${label}.`);
      }
      return result;
    }
    async function read(withCovers = false) {
      const repository = await send(root, { label: "accord-music-data" });
      if (repository.private !== true || typeof repository.default_branch !== "string" || !repository.default_branch) {
        throw new Error("accord-music-data deve essere un repository privato con un branch predefinito.");
      }
      const branch = repository.default_branch;
      function readFile(file, options) {
        if (options?.raw) progress(`Download GitHub: ${file}. Attesa massima: 120 s.`);
        return send(`${root}/contents/${file}?ref=${encodeURIComponent(branch)}`, { label: file, ...options });
      }
      const metadata = await readFile("albums.json", { missing: true });
      let albums = [], deletedAlbums = [], sha = null, deletionSync = false, deletionHistory = false;
      if (metadata !== null) {
        if (metadata.type !== "file" || typeof metadata.sha !== "string" || !metadata.sha) throw new Error("albums.json non leggibile.");
        let bytes;
        if (metadata.encoding === "none") {
          bytes = await readFile("albums.json", { raw: true });
          const current = await readFile("albums.json");
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
        const coverMetadata = await readFile("covers.bin", { missing: true });
        if (coverMetadata !== null) {
          if (coverMetadata.type !== "file" || typeof coverMetadata.sha !== "string") throw new Error("covers.bin non leggibile.");
          remote.coversSha = coverMetadata.sha;
          remote.archive = await readFile("covers.bin", { raw: true });
          remote.covers = await decodeCoverArchive(remote.archive);
        }
        const metadata = await readFile("durations.json", { missing: true });
        if (metadata !== null) {
          if (metadata.type !== "file" || typeof metadata.sha !== "string" || !metadata.sha) throw new Error("Archivio durate non leggibile.");
          let bytes;
          if (metadata.encoding === "none") {
            bytes = await readFile("durations.json", { raw: true });
            const current = await readFile("durations.json");
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
      progress(`Invio GitHub: ${file} (${(bytes.length / 1024 / 1024).toFixed(2)} MiB). Attesa massima: 120 s.`);
      const marker = { owner: connectionOwner, branch, file, blobSha: await gitBlobSha(bytes),
        createdAt: new Date().toISOString() };
      assertCurrent();
      if (uncertainWrite()) throw new Error("Un altro invio GitHub richiede una verifica. Nessun nuovo invio eseguito.");
      storage.setItem(UNCERTAIN_WRITE_KEY, JSON.stringify(marker));
      try {
        const result = await send(`${root}/contents/${file}`, { method: "PUT", body: JSON.stringify(payload) });
        if (typeof result?.content?.sha !== "string" || !result.content.sha
            || typeof result?.commit?.sha !== "string" || !result.commit.sha) {
          throw new UncertainGitHubWrite("Conferma dell'invio GitHub incompleta.");
        }
        storage.removeItem(UNCERTAIN_WRITE_KEY);
      } catch (error) {
        if (!(error instanceof UncertainGitHubWrite)) {
          storage.removeItem(UNCERTAIN_WRITE_KEY);
          throw new Error(`${file}: ${error.message}`);
        }
        const detail = `${file} (${(bytes.length / 1024 / 1024).toFixed(2)} MiB): ${error.message}`;
        let verified = false;
        try {
          progress(`Verifica in sola lettura di ${file}: nessun reinvio.`);
          const metadata = await send(`${root}/contents/${file}?ref=${encodeURIComponent(branch)}`, { label: file, missing: true });
          if (metadata) {
            verified = metadata.type === "file" && metadata.sha === await gitBlobSha(bytes);
          }
          assertCurrent();
        } catch (verificationError) {
          throw new Error(`${detail} Verifica in sola lettura non riuscita: ${verificationError.message} `
            + "Nessun invio ripetuto. Usa Verifica su GitHub; non cancellare i dati locali.");
        }
        if (!verified) throw new Error(`${detail} Il contenuto remoto non conferma l'invio. `
          + "Nessun invio ripetuto. Usa Verifica su GitHub; non cancellare i dati locali.");
        storage.removeItem(UNCERTAIN_WRITE_KEY);
      }
    }
    async function verify(marker) {
      const url = `${root}/contents/${marker.file}?ref=${encodeURIComponent(marker.branch)}`;
      return send(url, { label: marker.file, missing: true });
    }
    const connectionOwner = settings.owner;
    return { read, write, verify, assertCurrent, settings };
  }
  return {
    uncertainWrite,
    async verifyUncertainWrite() {
      const saved = storage.getItem(UNCERTAIN_WRITE_KEY);
      const marker = uncertainWrite();
      if (!marker) return { pending: false, verified: false };
      const connection = client();
      if (marker.owner !== connection.settings.owner) {
        throw new Error("L'invio incerto appartiene a un altro account GitHub. Ripristina quel collegamento prima di verificare.");
      }
      const metadata = await connection.verify(marker);
      if (metadata !== null && (metadata.type !== "file" || !/^[a-f0-9]{40}$/.test(metadata.sha || ""))) {
        throw new Error(`Verifica di ${marker.file} non conclusa: metadati GitHub non validi.`);
      }
      if (storage.getItem(UNCERTAIN_WRITE_KEY) !== saved) {
        throw new Error("Lo stato dell'invio e' cambiato durante la verifica. Nessun dato inviato.");
      }
      const verified = metadata?.sha === marker.blobSha;
      storage.removeItem(UNCERTAIN_WRITE_KEY);
      return { pending: true, verified, missing: metadata === null, file: marker.file };
    },
    async checkAddition(album) {
      if (!storage.getItem("accord-album-owner") && !storage.getItem("accord-album-token")) return null;
      const connection = client(), remote = await connection.read();
      return findCollectionAlbum(remote.albums, album, store.links());
    },
    async sync({ chooseConflicts, confirm, onProgress = () => {} }) {
      if (uncertainWrite()) throw new Error("Usa Verifica su GitHub prima di sincronizzare.");
      const durationSnapshot = store.durationSnapshot(), before = store.state;
      const connection = client(() => {
        store.assertDurationSnapshot(durationSnapshot);
        if (store.state !== before) throw new Error("Raccolta cambiata durante la sincronizzazione. Riapri Sincronizza.");
      }, onProgress), remote = await connection.read(true);
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
      const selected = new Map();
      for (const album of merged.albums) {
        if (!album.cover_sha256) continue;
        const local = await covers.get(album.id);
        const data = local && await hash(local) === album.cover_sha256 ? local : remote.covers.get(album.id)?.data;
        if (!data || await hash(data) !== album.cover_sha256) throw new Error(`Copertina non verificabile per ${album.name}. Sincronizza prima dal desktop; nessun invio eseguito.`);
        selected.set(album.id, data);
      }
      const archive = await encodeCoverArchive(selected);
      await decodeCoverArchive(archive);
      const coversOutgoing = Boolean((selected.size || remote.archive.length) && (archive.length !== remote.archive.length
        || archive.some((byte, index) => byte !== remote.archive[index])));
      if ((outgoing || incoming || durationOutgoing.length || durationIncoming.length || deletionsChanged
          || !remote.deletionSync || !remote.deletionHistory || coversOutgoing)
          && !await confirm({ local: before.albums, remote: remote.albums, albums: merged.albums,
            durationOutgoing, durationIncoming, coversOutgoing })) return false;
      connection.assertCurrent();
      for (const [id, data] of selected) await covers.put(id, data);
      let coversWritten = false, albumsWritten = false, durationsWritten = false;
      try {
        connection.assertCurrent();
        if (coversOutgoing) {
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
