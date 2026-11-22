import { githubCollectionSettings } from './collection-sync.mjs?v=9';
import { mergePhysicalRecords, PHYSICAL_KEY, physicalDocument, readPhysicalDocument,
  summaryPhysical } from './physical-collection.mjs?v=1';

const API = 'https://api.github.com';
const DATA_REPOSITORY = 'accord-music-data';
const DATA_FILE = 'physical-library.json';
const PENDING_WRITE_KEY = 'accord-physical-sync-pending-v1';

class UncertainPhysicalWrite extends Error {}

async function withLock(operation, locks = globalThis.navigator?.locks) {
  if (!locks) return operation();
  return locks.request(PHYSICAL_KEY, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('Un’altra operazione sul catalogo fisico è in corso. Riprova tra poco.');
    return operation();
  });
}

export function withPhysicalCollectionLock(operation, { storage = globalThis.localStorage, locks } = {}) {
  return withLock(() => {
    if (storage.getItem(PENDING_WRITE_KEY) !== null) {
      throw new Error('Usa Sincronizza supporti per verificare l’ultimo invio GitHub prima di modificare il catalogo.');
    }
    return operation();
  }, locks);
}

function pendingWrite(storage) {
  const saved = storage.getItem(PENDING_WRITE_KEY);
  if (saved === null) return null;
  const marker = JSON.parse(saved);
  if (!marker || typeof marker.owner !== 'string' || typeof marker.branch !== 'string'
      || !/^[a-f0-9]{40}$/.test(marker.blobSha || '')) {
    throw new Error('Il registro dell’ultimo invio GitHub non è leggibile.');
  }
  return marker;
}

function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

async function gitBlobSha(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const blob = new Uint8Array(header.length + bytes.length);
  blob.set(header);
  blob.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', blob);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function counts(records) {
  const { albums, cd, vinyl } = summaryPhysical(records);
  return `${albums} album, ${cd} CD, ${vinyl} vinili`;
}

export function createPhysicalSync({ storage, store, fetch: request = globalThis.fetch,
  confirm: ask = (message) => globalThis.confirm(message), progress = () => {} }) {
  async function synchronize() {
    const creds = githubCollectionSettings(storage);
    const owner = creds.owner.toLowerCase();
    const initial = store.state;
    const pending = pendingWrite(storage);
    if ((initial.owner && initial.owner.toLowerCase() !== owner) || (pending && pending.owner !== owner)) {
      throw new Error('Il catalogo fisico è associato a un altro proprietario GitHub. Ripristina il collegamento precedente.');
    }
    const repoUrl = `${API}/repos/${encodeURIComponent(owner)}/${DATA_REPOSITORY}`;
    const validateUnchanged = () => {
      store.assertCurrent();
      if (store.state !== initial) throw new Error('Il catalogo è cambiato durante la sincronizzazione. Riapri Sincronizza supporti.');
      const current = githubCollectionSettings(storage);
      if (current.owner.toLowerCase() !== owner || current.token !== creds.token) {
        throw new Error('La configurazione GitHub è cambiata durante la sincronizzazione.');
      }
    };

    async function send(url, { method = 'GET', payload, missing = false, raw = false } = {}) {
      validateUnchanged();
      const writing = method === 'PUT';
      function transferError(detail) {
        return writing
          ? new UncertainPhysicalWrite(`${detail} Usa Sincronizza supporti per verificare l’invio su GitHub.`)
          : new Error(detail);
      }
      function validateAfterResponse() {
        try { validateUnchanged(); }
        catch (error) { throw transferError(error.message); }
      }

      let response;
      try {
        response = await request(url, {
          method, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
          headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
            Authorization: `Bearer ${creds.token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
          signal: AbortSignal.timeout(writing || raw ? 120_000 : 30_000),
        });
      } catch {
        throw transferError(writing ? 'Invio GitHub interrotto: esito incerto.' : 'Lettura GitHub interrotta.');
      }
      validateAfterResponse();
      if (missing && response.status === 404) return null;
      if (!response.ok) {
        if (writing && response.status >= 500) {
          throw transferError(`GitHub HTTP ${response.status}: esito dell’invio incerto.`);
        }
        const detail = response.status === 409 || response.status === 422
          ? 'Riapri Sincronizza supporti per rileggere il catalogo remoto.'
          : 'Verifica accesso e permessi Contents sul repository privato.';
        throw new Error(`GitHub HTTP ${response.status}. ${detail}`);
      }
      let result;
      try { result = raw ? await response.arrayBuffer() : await response.json(); }
      catch { throw transferError('Risposta GitHub non leggibile.'); }
      validateAfterResponse();
      if (!raw && (!result || typeof result !== 'object' || Array.isArray(result))) {
        throw transferError('Risposta GitHub non valida.');
      }
      return result;
    }

    progress('Lettura del catalogo fisico su GitHub…');
    const repo = await send(repoUrl);
    if (repo.private !== true || typeof repo.default_branch !== 'string' || !repo.default_branch) {
      throw new Error('accord-music-data deve essere un repository privato con un branch predefinito.');
    }
    const branch = repo.default_branch;
    if (pending && pending.branch !== branch) {
      throw new Error('Il branch predefinito è cambiato dopo l’ultimo invio. Ripristinalo per verificare la sincronizzazione.');
    }
    const url = `${repoUrl}/contents/${DATA_FILE}?ref=${encodeURIComponent(branch)}`;
    const remoteFile = await send(url, { missing: true });
    let remoteRecords = [], sha = null;
    if (remoteFile) {
      if (remoteFile.type !== 'file' || typeof remoteFile.sha !== 'string' || !remoteFile.sha) {
        throw new Error('Il file GitHub non è leggibile.');
      }
      sha = remoteFile.sha;
      let bytes;
      if (remoteFile.encoding === 'none') {
        bytes = new Uint8Array(await send(url, { raw: true }));
        if (await gitBlobSha(bytes) !== sha) {
          throw new Error('Il catalogo GitHub è cambiato durante la lettura. Riprova Sincronizza supporti.');
        }
      } else if (remoteFile.encoding === 'base64' && typeof remoteFile.content === 'string') {
        bytes = Uint8Array.from(atob(remoteFile.content.replace(/\s/g, '')), (char) => char.charCodeAt(0));
      } else {
        throw new Error('Il file GitHub non è leggibile.');
      }
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      remoteRecords = readPhysicalDocument(JSON.parse(content));
    } else if (initial.sha || initial.base.length) {
      throw new Error('physical-library.json è assente su GitHub. Ripristinalo prima di sincronizzare.');
    }

    validateUnchanged();
    if (pending?.blobSha === sha) {
      const received = JSON.stringify(remoteRecords) !== JSON.stringify(initial.records);
      store.commitSync(remoteRecords, owner, sha);
      storage.removeItem(PENDING_WRITE_KEY);
      progress('L’invio precedente è stato verificato su GitHub.');
      return { changed: true, uploaded: false, received };
    }
    if (pending) storage.removeItem(PENDING_WRITE_KEY);

    const merged = mergePhysicalRecords(initial.base, initial.records, remoteRecords);
    const outgoing = JSON.stringify(merged) !== JSON.stringify(remoteRecords);
    const incoming = JSON.stringify(merged) !== JSON.stringify(initial.records);
    if (!outgoing && !incoming) {
      if (sha || initial.owner) store.commitSync(merged, owner, sha);
      progress('Archivio fisico già sincronizzato.');
      return { changed: false, uploaded: false, received: false };
    }
    const verification = pending ? 'Il contenuto attuale di GitHub differisce dall’ultimo invio tentato.\n\n' : '';
    const message = `${verification}Sincronizzazione dei supporti con ${owner}/${DATA_REPOSITORY} (${branch}):\n\n`
      + `Su questo dispositivo: ${counts(initial.records)}\n`
      + `Su GitHub: ${counts(remoteRecords)}\n`
      + `Dopo l’unione: ${counts(merged)}\n\n`
      + `${outgoing ? 'Verrà aggiornato physical-library.json nel repository privato.' : 'Solo ricezione di dati da GitHub.'}\n`
      + 'Continuare?';
    if (!await ask(message)) {
      progress('Sincronizzazione annullata.');
      return { changed: false, cancelled: true };
    }
    validateUnchanged();
    if (outgoing) {
      progress('Invio del catalogo fisico al repository privato…');
      const bytes = new TextEncoder().encode(JSON.stringify(physicalDocument(merged)) + '\n');
      const blobSha = await gitBlobSha(bytes);
      validateUnchanged();
      if (pendingWrite(storage)) throw new Error('Verifica il precedente invio prima di sincronizzare.');
      storage.setItem(PENDING_WRITE_KEY, JSON.stringify({ owner, branch, blobSha }));
      let result;
      try {
        result = await send(`${repoUrl}/contents/${DATA_FILE}`, { method: 'PUT', payload: {
          message: 'Sync Accord physical CD/vinyl ownership', content: base64(bytes), branch, ...(sha ? { sha } : {}),
        } });
      } catch (error) {
        if (!(error instanceof UncertainPhysicalWrite)) storage.removeItem(PENDING_WRITE_KEY);
        throw error;
      }
      if (result.content?.sha !== blobSha) {
        throw new UncertainPhysicalWrite('GitHub non ha confermato il contenuto. Usa Sincronizza supporti per verificare l’invio.');
      }
      validateUnchanged();
      store.commitSync(merged, owner, blobSha);
      storage.removeItem(PENDING_WRITE_KEY);
    } else {
      store.commitSync(merged, owner, sha);
    }
    progress('Supporti fisici sincronizzati.');
    return { changed: true, uploaded: outgoing, received: incoming };
  }

  return { synchronize: () => withLock(synchronize) };
}
