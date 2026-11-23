// Accord: possesso di CD e vinili. Separato dallo schema degli album musicali.
import { collectionAlbumIdentity } from './core.mjs?v=54';

export const PHYSICAL_KEY = 'accord-physical-collection-v1';
export const PHYSICAL_FORMAT = 'accord-physical-collection';
export const PHYSICAL_VERSION = 1;

export function physicalKey(artist, title) {
  const names = [artist, title].map((name) => String(name ?? '').normalize('NFKC').trim().replace(/\s+/g, ' '));
  if (names.some((name) => !name)) throw new Error('Inserisci artista e titolo dell’album.');
  const identity = collectionAlbumIdentity({ artist: names[0], name: names[1] });
  // Conserva anche i nomi composti soltanto da simboli, ad esempio il gruppo !!!.
  return JSON.stringify([identity.artist || names[0].toLowerCase(), identity.title || names[1].toLowerCase()]);
}

function validateName(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 250) {
    throw new Error(`${label} non valido (massimo 250 caratteri).`);
  }
  return value.trim().replace(/\s+/g, ' ');
}
export function validatePhysicalRecords(records) {
  if (!Array.isArray(records) || records.length > 20000) throw new Error('Elenco dei supporti non valido.');
  const unique = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
        || Object.keys(record).some((key) => !['artist', 'title', 'cd', 'vinyl'].includes(key))) {
      throw new Error('Voce di collezione non valida.');
    }
    const artist = validateName(record.artist, 'Artista');
    const title = validateName(record.title, 'Album');
    if (typeof record.cd !== 'boolean' || typeof record.vinyl !== 'boolean') {
      throw new Error('Il possesso CD/vinile deve essere vero o falso.');
    }
    const key = physicalKey(artist, title);
    if (unique.has(key)) throw new Error(`Album ripetuto nel catalogo fisico: ${artist} — ${title}.`);
    unique.set(key, { artist, title, cd: record.cd, vinyl: record.vinyl });
  }
  return [...unique.keys()].sort().map((key) => unique.get(key));
}

export function physicalDocument(records) {
  return { format: PHYSICAL_FORMAT, version: PHYSICAL_VERSION,
    albums: validatePhysicalRecords(records) };
}
export function readPhysicalDocument(value) {
  if (!value || value.format !== PHYSICAL_FORMAT || value.version !== PHYSICAL_VERSION
      || !Array.isArray(value.albums)) throw new Error('Formato del catalogo fisico non supportato.');
  return validatePhysicalRecords(value.albums);
}
export function summaryPhysical(records) {
  const active = records.filter((r) => r.cd || r.vinyl);
  return { albums: active.length, cd: active.filter((r) => r.cd).length,
    vinyl: active.filter((r) => r.vinyl).length };
}
const byKey = (records) => new Map(records.map((record) => [physicalKey(record.artist, record.title), record]));

export function addPhysicalRecords(records, rows) {
  const all = byKey(records);
  for (const input of rows) {
    const artist = validateName(input.artist, 'Artista');
    const title = validateName(input.title, 'Album');
    if (typeof input.cd !== 'boolean' || typeof input.vinyl !== 'boolean') throw new Error('Valori CD/vinile non validi.');
    const key = physicalKey(artist, title);
    const existing = all.get(key);
    const cd = Boolean(existing?.cd || input.cd), vinyl = Boolean(existing?.vinyl || input.vinyl);
    if (cd || vinyl) all.set(key, { artist: existing?.artist || artist, title: existing?.title || title, cd, vinyl });
  }
  return validatePhysicalRecords([...all.values()]);
}

export function setPhysicalRecordFormat(records, artist, title, format, checked) {
  if (!['cd', 'vinyl'].includes(format) || typeof checked !== 'boolean') throw new Error('Formato non valido.');
  const key = physicalKey(artist, title), all = byKey(records);
  const current = all.get(key);
  if (!current && !checked) return records;
  const record = current || { artist: validateName(artist, 'Artista'),
    title: validateName(title, 'Album'), cd: false, vinyl: false };
  all.set(key, { ...record, [format]: checked });
  return validatePhysicalRecords([...all.values()]);
}

export function mergePhysicalRecords(base, local, remote) {
  // Merge a tre vie, campo per campo, con marcatori tombstone (CD e vinile false).
  const original = byKey(validatePhysicalRecords(base));
  const mine = byKey(validatePhysicalRecords(local));
  const theirs = byKey(validatePhysicalRecords(remote));
  const all = new Set([...original.keys(), ...mine.keys(), ...theirs.keys()]);
  const merged = [];
  for (const id of all) {
    const before = original.get(id), current = mine.get(id), other = theirs.get(id);
    const value = (field) => {
      const b = before?.[field] ?? false, l = current?.[field] ?? false, r = other?.[field] ?? false;
      return l === b ? r : l;
    };
    const info = other || current || before;
    merged.push({ artist: info.artist, title: info.title, cd: value('cd'), vinyl: value('vinyl') });
  }
  return validatePhysicalRecords(merged);
}

export function createPhysicalStore(storage) {
  const rawText = storage.getItem(PHYSICAL_KEY);
  const saved = rawText === null ? {} : JSON.parse(rawText);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    throw new Error('Catalogo fisico locale non valido; nessun dato sovrascritto.');
  }
  let state = { records: validatePhysicalRecords(saved.records === undefined ? [] : saved.records),
    base: validatePhysicalRecords(saved.base === undefined ? [] : saved.base),
    owner: typeof saved.owner === 'string' ? saved.owner : '',
    sha: typeof saved.sha === 'string' ? saved.sha : null };
  let serialized = rawText;
  function commit(next) {
    if (storage.getItem(PHYSICAL_KEY) !== serialized) {
      throw new Error('Catalogo modificato in un’altra scheda. Ricarica prima di continuare.');
    }
    const nextState = { records: validatePhysicalRecords(next.records),
      base: validatePhysicalRecords(next.base), owner: next.owner, sha: next.sha };
    const text = JSON.stringify(nextState);
    storage.setItem(PHYSICAL_KEY, text);
    serialized = text;
    state = nextState;
  }
  function addMany(rows) {
    commit({ ...state, records: addPhysicalRecords(state.records, rows) });
  }
  return {
    get state() { return state; },
    assertCurrent() {
      if (storage.getItem(PHYSICAL_KEY) !== serialized) throw new Error('Catalogo cambiato in un’altra scheda. Ricarica.');
    },
    all() { return state.records.filter((record) => record.cd || record.vinyl); },
    get(artist, title) { return byKey(state.records).get(physicalKey(artist, title)) || null; },
    addMany,
    setFormat(artist, title, format, checked) {
      commit({ ...state, records: setPhysicalRecordFormat(state.records, artist, title, format, checked) });
    },
    pending() { return JSON.stringify(state.records) !== JSON.stringify(state.base); },
    commitSync(records, owner, sha) {
      commit({ records, base: records, owner, sha });
    },
  };
}

export function csvPhysical(records) {
  const q = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const rows = validatePhysicalRecords(records).filter((x) => x.cd || x.vinyl);
  return ['Artista;Album;CD;Vinile', ...rows.map((r) =>
    `${q(r.artist)};${q(r.title)};${r.cd ? '1' : '0'};${r.vinyl ? '1' : '0'}`)].join('\n') + '\n';
}
export function parsePhysicalCsv(source) {
  if (typeof source !== 'string' || source.length > 10_000_000) throw new Error('CSV troppo grande.');
  const first = source.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
  const delim = first.includes(';') ? ';' : ',';
  const rows = [], current = [];
  let value = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (c === delim && !quoted) { current.push(value); value = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && source[i + 1] === '\n') i++;
      current.push(value); value = '';
      if (current.some((x) => x.trim())) rows.push(current.splice(0));
      else current.length = 0;
    } else value += c;
  }
  if (quoted) throw new Error('CSV con virgolette non chiuse.');
  current.push(value); if (current.some((x) => x.trim())) rows.push(current);
  if (rows.length < 2) throw new Error('CSV vuoto o privo di dati.');
  const normalize = (header) => header.trim().toLowerCase();
  const header = rows.shift().map(normalize);
  const idx = (names) => header.findIndex((x) => names.includes(x));
  const artist = idx(['artista', 'artist']), title = idx(['album', 'titolo', 'title']);
  const cd = idx(['cd']), vinyl = idx(['vinile', 'vinyl', 'lp']);
  if ([artist, title, cd, vinyl].some((i) => i < 0)) throw new Error('Colonne richieste: Artista;Album;CD;Vinile.');
  const yes = (text) => ['1', 'si', 'sì', 'yes', 'true', 'x'].includes(text.trim().toLowerCase());
  return rows.map((row) => ({ artist: row[artist] || '', title: row[title] || '',
    cd: yes(row[cd] || ''), vinyl: yes(row[vinyl] || '') }));
}
