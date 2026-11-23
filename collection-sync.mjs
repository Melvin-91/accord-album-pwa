import { createSyncDocument, threeWayMerge, decodeCoverArchive, encodeCoverArchive,
  findCollectionAlbum, archiveAlbumNoteVersions } from "./core.mjs?v=54";
import { validateDurationDocument, validateDurationEntries, durationDocument, mergeDurations } from "./duration-sync.mjs?v=1";
import { readPhysicalDocument, mergePhysicalRecords } from "./physical-collection.mjs?v=2";
import { createUnifiedLibrary, readUnifiedLibrary, readMusicDocument, LIBRARY_FILE,
  LEGACY_LIBRARY_FILES } from "./unified-library.mjs?v=1";

const API = "https://api.github.com";
const UNCERTAIN_WRITE_KEY = "accord-album-sync-uncertain-v1";
const LEGACY_PHYSICAL_WRITE_KEY = "accord-physical-sync-pending-v1";
const LIBRARY_WRITE_KEY = "accord-library-sync-pending-v1";
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
const equalPhysical = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const hasOtherOwner = (saved, owner) => Boolean(saved) && (typeof saved !== "string" || saved.toLowerCase() !== owner);
const hash = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");
async function gitBlobSha(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const blob = new Uint8Array(header.length + bytes.length);
  blob.set(header); blob.set(bytes, header.length);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-1", blob))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readPendingLibraryWrite(text) {
  if (text === null) return null;
  let marker;
  try { marker = JSON.parse(text); } catch { /* handled below */ }
  if (!marker || typeof marker.owner !== "string" || !marker.owner || typeof marker.branch !== "string"
      || !marker.branch || !/^[0-9a-f]{40}$/.test(marker.blobSha || "")
      || (marker.confirmed !== undefined && typeof marker.confirmed !== "boolean")) {
    throw new Error("Registro dell’ultimo invio del catalogo condiviso non valido. Nessun invio eseguito.");
  }
  return marker;
}

export function createCollectionSync({ storage, store, covers, unified = false, fetch: request = globalThis.fetch }) {
  const uncertainWrite = () => {
    const saved = storage.getItem(UNCERTAIN_WRITE_KEY);
    if (saved === null) return null;
    const marker = JSON.parse(saved);
    if (!marker || typeof marker !== "object" || Array.isArray(marker)
        || !["albums.json", "covers.bin", "durations.json", LIBRARY_FILE].includes(marker.file)
        || typeof marker.owner !== "string" || typeof marker.branch !== "string"
        || !/^[a-f0-9]{40}$/.test(marker.blobSha)) {
      throw new Error("Registro dell'invio GitHub incerto non valido. Nessun invio eseguito.");
    }
    return marker;
  };
  function client(assertExtra = () => {}, progress = () => {}) {
    const settings = githubCollectionSettings(storage);
    if (unified) settings.owner = settings.owner.toLowerCase();
    const root = `${API}/repos/${encodeURIComponent(settings.owner)}/accord-music-data`;
    function assertCurrent() {
      store.assertCurrent();
      assertExtra();
      const current = githubCollectionSettings(storage);
      const currentOwner = unified ? current.owner.toLowerCase() : current.owner;
      if (currentOwner !== settings.owner || current.token !== settings.token) throw new Error("Collegamento GitHub cambiato: operazione interrotta.");
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
          if (writing) {
            const Failure = unified ? UncertainGitHubWrite : Error;
            throw new Failure(`${error.message} Invio GitHub forse completato; rileggi con Sincronizza.`);
          }
          throw error;
        }
      }
      assertAfterResponse();
      if (missing && response.status === 404) return null;
      if (!response.ok) {
        if (response.headers.get("Retry-After") || response.headers.get("X-RateLimit-Remaining") === "0") {
          const Failure = unified && writing && response.status >= 500 ? UncertainGitHubWrite : Error;
          throw new Failure(`GitHub HTTP ${response.status}. Il server richiede un'attesa: riprova Sincronizza piu' tardi.`
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
    function readFile(file, branch, options) {
      if (options?.raw) progress(`Download GitHub: ${file}. Attesa massima: 120 s.`);
      return send(`${root}/contents/${file}?ref=${encodeURIComponent(branch)}`, { label: file, ...options });
    }
    function fileSha(metadata, file) {
      if (metadata === null) return null;
      if (metadata.type !== "file" || typeof metadata.sha !== "string" || !metadata.sha
          || (unified && !/^[a-f0-9]{40}$/.test(metadata.sha))) throw new Error(`${file} non leggibile.`);
      return metadata.sha;
    }
    async function readJson(file, branch, metadata) {
      const sha = fileSha(metadata, file);
      let bytes;
      if (metadata.encoding === "none") {
        bytes = await readFile(file, branch, { raw: true });
        const currentSha = unified ? await gitBlobSha(bytes) : (await readFile(file, branch)).sha;
        if (currentSha !== sha) throw new Error(`${file} e' cambiato durante la lettura. Riprova Sincronizza.`);
      } else {
        if (typeof metadata.content !== "string" || !metadata.content || (unified && metadata.encoding !== "base64")) {
          throw new Error(`${file} non leggibile.`);
        }
        bytes = Uint8Array.from(atob(metadata.content.replace(/\s/g, "")), (char) => char.charCodeAt(0));
        if (unified && await gitBlobSha(bytes) !== sha) throw new Error(`${file} non corrisponde alla revisione GitHub.`);
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    }
    async function verifyLegacy(branch, expected) {
      const files = Object.entries(LEGACY_LIBRARY_FILES);
      const revisions = await Promise.all(files.map(async ([key, file]) => {
        const metadata = await readFile(file, branch, { missing: true });
        return { file, matches: fileSha(metadata, file) === expected[key] };
      }));
      const changed = revisions.filter(({ matches }) => !matches).map(({ file }) => file);
      if (changed.length) {
        throw new Error(`Gli archivi precedenti sono cambiati: ${changed.join(", ")}. `
          + "Sospendi la sincronizzazione dai dispositivi con la versione precedente e riconcilia gli archivi prima di continuare.");
      }
    }
    async function read(withCovers = false, requireLibrary = false) {
      const repository = await send(root, { label: "accord-music-data" });
      if (repository.private !== true || typeof repository.default_branch !== "string" || !repository.default_branch) {
        throw new Error("accord-music-data deve essere un repository privato con un branch predefinito.");
      }
      const branch = repository.default_branch;
      const remote = { albums: [], deletedAlbums: [], sha: null, branch, deletionSync: false, deletionHistory: false,
        covers: new Map(), coversSha: null, archive: new Uint8Array(), durations: [], durationsSha: null,
        librarySha: null, physical: [], migration: null, extensions: {} };
      const libraryMetadata = unified ? await readFile(LIBRARY_FILE, branch, { missing: true }) : null;
      if (libraryMetadata) {
        const library = readUnifiedLibrary(await readJson(LIBRARY_FILE, branch, libraryMetadata));
        const sha = libraryMetadata.sha;
        Object.assign(remote, library, { librarySha: sha, sha, durationsSha: sha });
        if (withCovers) await verifyLegacy(branch, remote.migration);
      } else {
        if (unified && (store.state.libraryOwner || requireLibrary)) {
          throw new Error("library.json e' assente su GitHub. Ripristinalo prima di sincronizzare di nuovo.");
        }
        const metadata = await readFile("albums.json", branch, { missing: true });
        if (metadata) {
          const music = readMusicDocument(await readJson("albums.json", branch, metadata));
          Object.assign(remote, music, { sha: metadata.sha });
        }
        if (withCovers) {
          const durationsMetadata = await readFile("durations.json", branch, { missing: true });
          if (durationsMetadata) {
            remote.durations = validateDurationDocument(await readJson("durations.json", branch, durationsMetadata));
            remote.durationsSha = durationsMetadata.sha;
          }
          if (unified) {
            const physicalMetadata = await readFile("physical-library.json", branch, { missing: true });
            if (physicalMetadata) {
              remote.physical = readPhysicalDocument(await readJson("physical-library.json", branch, physicalMetadata));
            }
            remote.migration = { albums_sha: remote.sha, durations_sha: remote.durationsSha,
              physical_sha: physicalMetadata?.sha || null };
          }
        }
      }
      if (withCovers) {
        const coverMetadata = await readFile("covers.bin", branch, { missing: true });
        if (coverMetadata) {
          remote.coversSha = fileSha(coverMetadata, "covers.bin");
          remote.archive = await readFile("covers.bin", branch, { raw: true });
          if (unified && await gitBlobSha(remote.archive) !== remote.coversSha) {
            throw new Error("covers.bin e' cambiato durante la lettura. Riprova Sincronizza.");
          }
          remote.covers = await decodeCoverArchive(remote.archive);
        }
      }
      return remote;
    }
    async function write(file, bytes, sha, branch, blobSha) {
      const payload = { message: `Sync Accord ${file}`, content: base64(bytes), branch, ...(sha ? { sha } : {}) };
      progress(`Invio GitHub: ${file} (${(bytes.length / 1024 / 1024).toFixed(2)} MiB). Attesa massima: 120 s.`);
      const marker = { owner: connectionOwner, branch, file, blobSha: blobSha ?? await gitBlobSha(bytes),
        createdAt: new Date().toISOString() };
      assertCurrent();
      if (uncertainWrite()) throw new Error("Un altro invio GitHub richiede una verifica. Nessun nuovo invio eseguito.");
      storage.setItem(UNCERTAIN_WRITE_KEY, JSON.stringify(marker));
      try {
        const result = await send(`${root}/contents/${file}`, { method: "PUT", body: JSON.stringify(payload) });
        if (typeof result?.content?.sha !== "string" || !result.content.sha
            || typeof result?.commit?.sha !== "string" || !result.commit.sha
            || (unified && result.content.sha !== marker.blobSha)) {
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
    return { read, write, verify, verifyLegacy, assertCurrent, settings };
  }
  return {
    uncertainWrite,
    async verifyUncertainWrite() {
      const saved = storage.getItem(UNCERTAIN_WRITE_KEY);
      const marker = uncertainWrite();
      if (!marker) return { pending: false, verified: false };
      const connection = client();
      if (unified ? hasOtherOwner(marker.owner, connection.settings.owner) : marker.owner !== connection.settings.owner) {
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
      if (unified && verified && marker.file === LIBRARY_FILE) {
        const pending = readPendingLibraryWrite(storage.getItem(LIBRARY_WRITE_KEY));
        if (!pending || pending.owner !== marker.owner || pending.branch !== marker.branch || pending.blobSha !== marker.blobSha) {
          throw new Error("Il registro dell’ultimo invio del catalogo è cambiato. Riapri Verifica su GitHub.");
        }
        storage.setItem(LIBRARY_WRITE_KEY, JSON.stringify({ ...pending, confirmed: true }));
      }
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
      const physicalPendingText = unified ? storage.getItem(LEGACY_PHYSICAL_WRITE_KEY) : null;
      const previousLibraryWrite = unified ? storage.getItem(LIBRARY_WRITE_KEY) : null;
      const pendingLibrary = readPendingLibraryWrite(previousLibraryWrite);
      let expectedLibraryWrite = previousLibraryWrite;
      const connection = client(() => {
        store.assertDurationSnapshot(durationSnapshot);
        if (store.state !== before) throw new Error("Raccolta cambiata durante la sincronizzazione. Riapri Sincronizza.");
        if (unified && (storage.getItem(LEGACY_PHYSICAL_WRITE_KEY) !== physicalPendingText
            || storage.getItem(LIBRARY_WRITE_KEY) !== expectedLibraryWrite)) {
          throw new Error("Sta cambiando lo stato dell’ultimo invio. Riapri Sincronizza.");
        }
      }, onProgress);
      const owner = connection.settings.owner;
      if (unified && [before.libraryOwner, before.syncOwner, before.physicalOwner, before.durationBase?.owner, pendingLibrary?.owner]
        .some((previous) => hasOtherOwner(previous, owner))) {
        throw new Error("Il catalogo locale è associato a un altro proprietario GitHub. Ripristina il collegamento precedente.");
      }
      const remote = await connection.read(true, pendingLibrary?.confirmed === true);
      connection.assertCurrent();
      if (pendingLibrary && pendingLibrary.branch !== remote.branch) {
        throw new Error("Il branch predefinito è cambiato dopo l’ultimo invio. Ripristinalo prima di sincronizzare.");
      }
      const migrating = unified && !remote.librarySha;
      if (migrating && (before.physicalSha || before.physicalBase?.length) && !remote.migration.physical_sha) {
        throw new Error("physical-library.json è assente su GitHub. Ripristinalo prima di migrare.");
      }
      if (physicalPendingText !== null) {
        const pending = JSON.parse(physicalPendingText);
        if (!pending || typeof pending.owner !== "string" || !pending.owner || hasOtherOwner(pending.owner, owner)
            || pending.branch !== remote.branch || !/^[0-9a-f]{40}$/.test(pending.blobSha || "")
            || pending.blobSha !== remote.migration.physical_sha) {
          throw new Error("Non è possibile confermare l’ultimo invio dei supporti. Verificalo con Sincronizza supporti nella versione precedente di Accord prima di migrare.");
        }
      }
      const localPhysical = unified ? before.physical : [];
      const physical = unified ? mergePhysicalRecords(before.physicalBase, localPhysical, remote.physical) : [];
      const physicalOutgoing = unified && !equalPhysical(physical, remote.physical);
      const physicalIncoming = unified && !equalPhysical(physical, localPhysical);
      const durationState = before.durationBase ?? { owner, albums: [] };
      if (!durationState || typeof durationState !== "object" || Array.isArray(durationState)
          || typeof durationState.owner !== "string") throw new Error("Base durate locale non valida.");
      const durationOwnerMatches = unified ? !hasOtherOwner(durationState.owner, owner) : durationState.owner === owner;
      const durationBase = durationOwnerMatches ? validateDurationEntries(durationState.albums) : [];
      if (durationBase.length && !remote.durationsSha) throw new Error("L'archivio durate non e' piu' presente su GitHub. Ripristinalo prima di sincronizzare.");
      if (!unified && before.syncOwner && before.syncOwner !== owner && (before.pendingRemovals.length || before.deletedAlbums.length)) {
        throw new Error("Le rimozioni pendenti appartengono al precedente collegamento GitHub. Ripristina quel proprietario e sincronizza prima di cambiarlo.");
      }
      if ((before.base.length || before.deletedAlbums.length) && !remote.sha) throw new Error("albums.json non e' piu' presente. Ripristinalo su GitHub prima di sincronizzare: nessuna cancellazione automatica.");
      const base = new Map((unified || !before.syncOwner || before.syncOwner === owner ? before.base : []).map((album) => [album.id, album]));
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
      const musicOutgoing = outgoing || deletionsChanged || !remote.deletionSync || !remote.deletionHistory;
      const libraryOutgoing = unified && (migrating || musicOutgoing || durationOutgoing.length || physicalOutgoing);
      if ((musicOutgoing || incoming || durationOutgoing.length || durationIncoming.length || coversOutgoing
          || migrating || physicalOutgoing || physicalIncoming)
          && !await confirm({ local: before.albums, remote: remote.albums, albums: merged.albums,
            durationOutgoing, durationIncoming, coversOutgoing,
            ...(unified ? { physicalOutgoing, physicalIncoming, migrating } : {}) })) return false;
      connection.assertCurrent();
      const libraryBytes = libraryOutgoing ? new TextEncoder().encode(JSON.stringify(createUnifiedLibrary({
        albums: merged.albums, deletedAlbums, physical, durations: durationMerge.entries,
        migration: remote.migration, extensions: remote.extensions,
      })) + "\n") : null;
      if (libraryBytes?.length > 100 * 1024 * 1024) throw new Error("library.json supera il limite GitHub di 100 MiB.");
      if (unified) await connection.verifyLegacy(remote.branch, remote.migration);
      for (const [id, data] of selected) await covers.put(id, data);
      let coversWritten = false, albumsWritten = false, durationsWritten = false, libraryWritten = false;
      try {
        connection.assertCurrent();
        if (coversOutgoing) {
          await connection.write("covers.bin", archive, remote.coversSha, remote.branch);
          coversWritten = true;
        }
        if (unified) {
          if (libraryBytes) {
            const blobSha = await gitBlobSha(libraryBytes);
            connection.assertCurrent();
            expectedLibraryWrite = JSON.stringify({ owner, branch: remote.branch, blobSha });
            storage.setItem(LIBRARY_WRITE_KEY, expectedLibraryWrite);
            try {
              await connection.write(LIBRARY_FILE, libraryBytes, remote.librarySha, remote.branch, blobSha);
            } catch (error) {
              if (!uncertainWrite() && storage.getItem(LIBRARY_WRITE_KEY) === expectedLibraryWrite) {
                if (previousLibraryWrite === null) storage.removeItem(LIBRARY_WRITE_KEY);
                else storage.setItem(LIBRARY_WRITE_KEY, previousLibraryWrite);
              }
              throw error;
            }
            libraryWritten = true;
            connection.assertCurrent();
            expectedLibraryWrite = JSON.stringify({ owner, branch: remote.branch, blobSha, confirmed: true });
            storage.setItem(LIBRARY_WRITE_KEY, expectedLibraryWrite);
          }
          if (coversWritten || libraryWritten) await connection.verifyLegacy(remote.branch, remote.migration);
        } else {
          if (musicOutgoing) {
            const document = { ...createSyncDocument(merged.albums), deletion_sync: true, deletion_history: true, deleted_albums: deletedAlbums };
            await connection.write("albums.json", new TextEncoder().encode(JSON.stringify(document, null, 2)), remote.sha, remote.branch);
            albumsWritten = true;
          }
          if (durationOutgoing.length) {
            await connection.write("durations.json", new TextEncoder().encode(JSON.stringify(durationDocument(durationMerge.entries), null, 2)),
              remote.durationsSha, remote.branch);
            durationsWritten = true;
          }
        }
        connection.assertCurrent();
        store.commitSync({ ...before, albums: merged.albums, base: merged.albums, pendingRemovals: [],
          deletedAlbums, restoredAlbumIds: [],
          durationBase: { owner, albums: durationMerge.entries },
          syncOwner: owner, lastSync: new Date().toISOString(),
          ...(unified ? { physical, physicalBase: physical, physicalOwner: owner, libraryOwner: owner,
            physicalSha: remote.migration.physical_sha } : {}) }, durationSnapshot,
        durationMerge.entries.filter((row) => retained.has(row.id)));
        if (physicalPendingText !== null) storage.removeItem(LEGACY_PHYSICAL_WRITE_KEY);
        if (expectedLibraryWrite !== null) storage.removeItem(LIBRARY_WRITE_KEY);
      } catch (error) {
        throw new Error(`${error.message}${coversWritten || albumsWritten || durationsWritten || libraryWritten
          ? " Invio parziale gia' completato su GitHub; copia locale non confermata. Rileggi con Sincronizza." : ""}`);
      }
      return true;
    },
  };
}
