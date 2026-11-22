import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PHYSICAL_KEY, physicalKey, createPhysicalStore, mergePhysicalRecords,
  physicalDocument, readPhysicalDocument, csvPhysical, parsePhysicalCsv, summaryPhysical } from './physical-collection.mjs';
import { createPhysicalSync, withPhysicalCollectionLock } from './physical-collection-sync.mjs';

class MemoryStorage {
  #items = new Map();
  getItem(key) { return this.#items.has(key) ? this.#items.get(key) : null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
}
const row = (artist = 'Pink Floyd', title = 'The Dark Side of the Moon', cd = false, vinyl = false) =>
  ({ artist, title, cd, vinyl });

test('edizioni, maiuscole e accenti individuano un solo album', () => {
  assert.equal(physicalKey('Beyoncé', 'Renaissance (Deluxe Edition)'),
    physicalKey('BEYONCE', 'renaissance'));
  assert.equal(physicalKey('Pink Floyd', 'Animals - 2018 Remastered'),
    physicalKey('pink floyd', 'Animals'));
  assert.equal(physicalKey('!!!', 'Louden Up Now (Deluxe Edition)'), physicalKey('！！！', 'louden up now'));
});

test('aggiungere CD e vinile produce un solo record e non modifica la raccolta album', () => {
  const storage = new MemoryStorage();
  storage.setItem('accord-album-pwa-v1', '{"albums":[{"id":"abc"}]}');
  const before = storage.getItem('accord-album-pwa-v1');
  const store = createPhysicalStore(storage);
  store.addMany([row('Pink Floyd', 'Animals', true, false)]);
  store.addMany([row('PINK FLOYD', 'Animals (Remastered)', false, true)]);
  assert.deepEqual(summaryPhysical(store.all()), { albums: 1, cd: 1, vinyl: 1 });
  assert.equal(store.get('Pink Floyd', 'Animals').vinyl, true);
  assert.equal(storage.getItem('accord-album-pwa-v1'), before);
});

test('togliere entrambi i formati conserva un tombstone utile alla sincronizzazione', () => {
  const storage = new MemoryStorage(), store = createPhysicalStore(storage);
  store.addMany([row('Radiohead', 'OK Computer', true, true)]);
  store.setFormat('Radiohead', 'OK Computer', 'cd', false);
  store.setFormat('Radiohead', 'OK Computer', 'vinyl', false);
  assert.equal(store.all().length, 0);
  assert.equal(store.state.records.length, 1);
  assert.equal(store.state.records[0].cd, false);
  assert.ok(storage.getItem(PHYSICAL_KEY));
});

test('la modifica concorrente della stessa scheda viene bloccata', () => {
  const storage = new MemoryStorage();
  const old = createPhysicalStore(storage);
  createPhysicalStore(storage).addMany([row('Artist', 'Album', true, false)]);
  assert.throws(() => old.addMany([row('Other', 'Another', false, true)]), /altra scheda/);
});

test('la fusione a tre vie preserva le modifiche indipendenti ai due formati', () => {
  const base = [row('Artist', 'Album', true, false)];
  const local = [row('ARTIST', 'Album (Deluxe Edition)', true, true)];
  const remote = [row('Artist', 'Album', false, false)];
  const merged = mergePhysicalRecords(base, local, remote);
  assert.deepEqual(merged, [row('Artist', 'Album', false, true)]);
});

test('il CSV italiano importa virgolette e righe ripetute senza creare duplicati', () => {
  const text = `Artista;Album;CD;Vinile\n"A, B";"L'album";1;0\n"A, B";"L'album";0;1\n`;
  const parsed = parsePhysicalCsv(text);
  const storage = new MemoryStorage(), store = createPhysicalStore(storage);
  store.addMany(parsed);
  assert.deepEqual(summaryPhysical(store.all()), { albums: 1, cd: 1, vinyl: 1 });
  assert.match(csvPhysical(store.all()), /"A, B"/);
});

test('il formato remoto rifiuta record duplicati e dati inaspettati', () => {
  assert.deepEqual(readPhysicalDocument(physicalDocument([row()])), [row()]);
  assert.throws(() => physicalDocument([row(), row()]), /ripetuto/);
  assert.throws(() => readPhysicalDocument({ format: 'bad', version: 1, albums: [] }), /non supportato/);
});

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, async json() { return body; } };
}
function remoteLibrary(records) {
  return response(200, { type: 'file', sha: 'old-sha', encoding: 'base64',
    content: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(physicalDocument(records))))) });
}
function contentSha(content) {
  const bytes = Buffer.from(content, 'base64');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
function setupAuth(storage) {
  storage.setItem('accord-album-owner', 'melvin');
  storage.setItem('accord-album-token', 'not-a-real-token');
}

test('sincronizzazione invia solo physical-library.json, mai albums.json', async () => {
  const storage = new MemoryStorage(); setupAuth(storage);
  const store = createPhysicalStore(storage);
  store.addMany([row('Radiohead', 'Amnesiac', true, false)]);
  const calls = [];
  let uploadedSha;
  async function fakeFetch(url, options) {
    calls.push([url, options]);
    if (url.endsWith('/accord-music-data')) return response(200, { private: true, default_branch: 'main' });
    if (url.endsWith('/contents/physical-library.json?ref=main')) return response(404, {});
    if (url.endsWith('/contents/physical-library.json')) {
      const payload = JSON.parse(options.body);
      assert.match(payload.message, /physical/);
      assert.equal(JSON.parse(atob(payload.content)).albums[0].cd, true);
      uploadedSha = contentSha(payload.content);
      return response(201, { content: { sha: uploadedSha } });
    }
    throw Error('Unexpected endpoint: ' + url);
  }
  let confirmed = false;
  const result = await createPhysicalSync({ storage, store, fetch: fakeFetch,
    confirm: async () => { confirmed = true; return true; } }).synchronize();
  assert.equal(confirmed, true);
  assert.equal(result.uploaded, true);
  assert.ok(calls.every(([url]) => !url.includes('/albums.json')));
  assert.equal(store.state.sha, uploadedSha);
});

test('sincronizzazione può ricevere dati senza riscrivere GitHub', async () => {
  const storage = new MemoryStorage(); setupAuth(storage);
  const store = createPhysicalStore(storage);
  const fetch = async (url, options) => {
    if (url.endsWith('/accord-music-data')) return response(200, { private: true, default_branch: 'main' });
    if (url.endsWith('/contents/physical-library.json?ref=main')) return remoteLibrary([row('Bowie', 'Low', true, true)]);
    throw Error(`Unexpected write ${options?.method}`);
  };
  const outcome = await createPhysicalSync({ storage, store, fetch, confirm: async () => true }).synchronize();
  assert.deepEqual({ uploaded: outcome.uploaded, received: outcome.received }, { uploaded: false, received: true });
  assert.equal(store.all().length, 1);
});

test('annullare la sincronizzazione lascia invariati lo stato e i dati', async () => {
  const storage = new MemoryStorage(); setupAuth(storage);
  const store = createPhysicalStore(storage); store.addMany([row('Bowie', 'Low', false, true)]);
  const previous = storage.getItem(PHYSICAL_KEY);
  const fetch = async (url) => url.endsWith('/accord-music-data')
    ? response(200, { private: true, default_branch: 'main' }) : response(404, {});
  const result = await createPhysicalSync({ storage, store, fetch,
    confirm: async () => false }).synchronize();
  assert.equal(result.cancelled, true);
  assert.equal(storage.getItem(PHYSICAL_KEY), previous);
});

test('repository pubblico viene rifiutato prima di ogni scrittura', async () => {
  const storage = new MemoryStorage(); setupAuth(storage);
  const store = createPhysicalStore(storage);
  const fetch = async () => response(200, { private: false, default_branch: 'main' });
  await assert.rejects(() => createPhysicalSync({ storage, store, fetch }).synchronize(), /privato/);
});

test('un altro proprietario non riceve il catalogo del collegamento precedente', async () => {
  const storage = new MemoryStorage(); setupAuth(storage);
  const store = createPhysicalStore(storage);
  store.commitSync([row('Bowie', 'Low', true, false)], 'altro-proprietario', 'old-sha');
  const saved = storage.getItem(PHYSICAL_KEY);
  const fetch = async () => assert.fail('Chiamata GitHub prima del controllo del proprietario');
  await assert.rejects(() => createPhysicalSync({ storage, store, fetch }).synchronize(), /altro proprietario/);
  assert.equal(storage.getItem(PHYSICAL_KEY), saved);
});

test('la base è mantenuta se cambia soltanto il maiuscolo del proprietario', async () => {
  const storage = new MemoryStorage(); setupAuth(storage);
  const store = createPhysicalStore(storage);
  const records = [row('Bowie', 'Low', true, false)];
  store.commitSync(records, 'MELVIN', 'old-sha');
  const fetch = async (url, { method }) => {
    assert.match(url, /\/melvin\//);
    assert.equal(method, 'GET');
    return url.endsWith('/accord-music-data')
      ? response(200, { private: true, default_branch: 'main' }) : remoteLibrary([row('Bowie', 'Low')]);
  };
  const result = await createPhysicalSync({ storage, store, fetch, confirm: async () => true }).synchronize();
  assert.equal(result.received, true);
  assert.deepEqual(store.all(), []);
});

test('cambiare le credenziali durante la lettura impedisce il commit anche senza differenze', async () => {
  const storage = new MemoryStorage(); setupAuth(storage);
  const store = createPhysicalStore(storage);
  const records = [row('Bowie', 'Low', true, false)];
  store.addMany(records);
  const saved = storage.getItem(PHYSICAL_KEY);
  const fetch = async (url) => {
    if (url.endsWith('/accord-music-data')) return response(200, { private: true, default_branch: 'main' });
    return { ok: true, async json() {
      storage.setItem('accord-album-token', 'changed');
      return remoteLibrary(records).json();
    } };
  };
  await assert.rejects(() => createPhysicalSync({ storage, store, fetch }).synchronize(), /configurazione GitHub/);
  assert.equal(storage.getItem(PHYSICAL_KEY), saved);
});

test('un archivio oltre 1 MiB viene letto in UTF-8 e verificato tramite SHA', async () => {
  const storage = new MemoryStorage(); setupAuth(storage);
  const store = createPhysicalStore(storage);
  const records = [row('Beyoncé', 'Renaissance', false, true)];
  const bytes = new TextEncoder().encode(JSON.stringify(physicalDocument(records)) + ' '.repeat(1024 * 1024));
  const metadata = { type: 'file', sha: 'wrong-sha', encoding: 'none' };
  const requests = [];
  const fetch = async (url, { method, headers }) => {
    assert.equal(method, 'GET');
    if (url.endsWith('/accord-music-data')) return response(200, { private: true, default_branch: 'main' });
    requests.push(headers.Accept);
    if (headers.Accept === 'application/vnd.github.raw+json') {
      return { status: 200, ok: true, async arrayBuffer() { return bytes.buffer; } };
    }
    return response(200, metadata);
  };
  const sync = createPhysicalSync({ storage, store, fetch, confirm: async () => true });
  await assert.rejects(() => sync.synchronize(), /cambiato durante la lettura/);
  assert.equal(storage.getItem(PHYSICAL_KEY), null);
  metadata.sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const result = await sync.synchronize();
  assert.equal(result.received, true);
  assert.deepEqual(store.all(), records);
  assert.deepEqual(requests, ['application/vnd.github+json', 'application/vnd.github.raw+json',
    'application/vnd.github+json', 'application/vnd.github.raw+json']);
});

test('un file remoto già sincronizzato e poi scomparso non cancella il catalogo', async () => {
  const storage = new MemoryStorage(); setupAuth(storage);
  const store = createPhysicalStore(storage);
  store.commitSync([row('Bowie', 'Low', true, false)], 'melvin', 'old-sha');
  const saved = storage.getItem(PHYSICAL_KEY);
  const fetch = async (url, { method }) => {
    assert.equal(method, 'GET');
    return url.endsWith('/accord-music-data')
      ? response(200, { private: true, default_branch: 'main' }) : response(404, {});
  };
  await assert.rejects(() => createPhysicalSync({ storage, store, fetch }).synchronize(), /assente su GitHub/);
  assert.equal(storage.getItem(PHYSICAL_KEY), saved);
});

test('un invio interrotto si verifica in sola lettura prima di riprendere le modifiche', async () => {
  const storage = new MemoryStorage(); setupAuth(storage);
  const store = createPhysicalStore(storage);
  store.addMany([row('Bowie', 'Low', true, false)]);
  let uploaded, sends = 0;
  const fetch = async (url, { method, body }) => {
    if (url.endsWith('/accord-music-data')) return response(200, { private: true, default_branch: 'main' });
    if (method === 'PUT') {
      sends++;
      const { content } = JSON.parse(body);
      uploaded = { type: 'file', sha: contentSha(content), encoding: 'base64', content };
      throw new Error('Connection lost after upload');
    }
    return uploaded ? response(200, uploaded) : response(404, {});
  };
  const confirm = async () => true;
  await assert.rejects(() => createPhysicalSync({ storage, store, fetch, confirm }).synchronize(), /esito incerto/);
  const edit = () => createPhysicalStore(storage).setFormat('Bowie', 'Low', 'cd', false);
  await assert.rejects(() => withPhysicalCollectionLock(edit, { storage }), /verificare l’ultimo invio/);
  await createPhysicalSync({ storage, store: createPhysicalStore(storage), fetch,
    confirm: async () => assert.fail('Un invio verificato non richiede un nuovo invio') }).synchronize();
  assert.equal(sends, 1);
  assert.equal(createPhysicalStore(storage).state.sha, uploaded.sha);
  await withPhysicalCollectionLock(edit, { storage });
  assert.deepEqual(createPhysicalStore(storage).all(), []);
});
