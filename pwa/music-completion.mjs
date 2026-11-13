import { editionLink } from "./music-continuity.mjs?v=13";
import { commitLocalRestore } from "./ui.mjs?v=25";

export const COMPLETION_KEY = "accord-music-completion-v1";
export const COMPLETION_EVIDENCE_KEY = "accord-music-completion-evidence-v1";
export const COMPLETION_PROVENANCE_KEY = "accord-music-completion-provenance-v1";
export const COMPLETION_CATEGORIES = { duration: "Durata", genres: "Generi Last.fm", evidence: "Evidenze Discogs" };
const COLLECTION = "accord-album-pwa-v1", DURATIONS = "accord-listening-album-durations-v1";
const QUEUE = "accord-listening-queue-v1";
const identity = (album) => [album.id, album.artist, album.name];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const stored = (storage, key, fallback) => JSON.parse(storage.getItem(key) || JSON.stringify(fallback));

export class CompletionBudget extends Error {}

export function catalogTarget(storage, album, provider) {
  const patterns = { spotify: /^[A-Za-z0-9]{22}$/, tidal: /^tidal:[1-9][0-9]*$/, qobuz: /^qobuz:[A-Za-z0-9]{1,120}$/ };
  if (!patterns[provider]) throw new Error("Servizio musicale non valido.");
  if (patterns[provider].test(album.id)) return album.id;
  return ["tidal", "qobuz"].includes(provider) ? editionLink(storage, album, provider)?.id || null : null;
}

export function createCompletionPlan(storage, albums, provider, categories) {
  if (!albums.length || albums.length > 200 || !categories.length
      || categories.some((key) => !Object.hasOwn(COMPLETION_CATEGORIES, key))) {
    throw new Error("Seleziona da 1 a 200 album e almeno una categoria.");
  }
  const durations = { ...stored(storage, QUEUE, {}).durations, ...stored(storage, DURATIONS, {}) };
  if (Object.values(durations).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("Le durate locali salvate non sono valide.");
  }
  const evidence = stored(storage, COMPLETION_EVIDENCE_KEY, {});
  const provenance = stored(storage, COMPLETION_PROVENANCE_KEY, {});
  const rows = [];
  for (const album of new Map(albums.map((row) => [row.id, row])).values()) {
    for (const category of [...new Set(categories)].sort()) {
      const target = category === "duration" ? catalogTarget(storage, album, provider) : null;
      const known = category === "duration" ? Object.hasOwn(durations, album.id)
        : category === "genres" ? album.genres?.length || album.primary_genre || album.genre_source === "manual"
          || provenance[album.id]?.genres?.source === "manual" : evidence[album.id];
      rows.push({ album: { id: album.id, artist: album.artist, name: album.name }, category, target,
        source: category === "duration" ? provider : category === "genres" ? "Last.fm" : "Discogs",
        status: known ? "preserved" : category === "duration" && !target ? "blocked" : "pending",
        detail: known ? "Valore locale conservato." : category === "duration" && !target
          ? "Associa esplicitamente l'edizione nel servizio attivo." : "",
        cursor: null, seen: [], tracks: [], total: null, pages: 0 });
    }
  }
  return { schema: 1, provider, signature: JSON.stringify(rows.map((row) =>
    [row.album, row.category, row.source, row.target])), rows, state: "planned", reads: 0, updated: Date.now() };
}

export function continueCompletion(previous, proposed) {
  if (previous?.schema !== 1 || previous.signature !== proposed.signature) {
    throw new Error("Selezione, categorie o associazioni cambiate: prepara un nuovo piano.");
  }
  return structuredClone(previous);
}

export function acceptDurationPage(row, page) {
  if (page.id !== row.target) throw new Error("Il catalogo ha restituito un'edizione diversa.");
  if (!Number.isSafeInteger(page.total) || page.total <= 0 || page.total > 10000
      || !Array.isArray(page.tracks) || !page.tracks.length || row.total !== null && row.total !== page.total) {
    throw new Error("Elenco brani incompleto o conteggio instabile: nessuna durata salvata.");
  }
  const ids = new Set(row.tracks.map((track) => track.id));
  const additions = [];
  for (const track of page.tracks) {
    if (typeof track.id !== "string" || !track.id || ids.has(track.id)
        || !Number.isSafeInteger(track.duration_ms) || track.duration_ms <= 0) {
      throw new Error("Brani duplicati o durate non valide: nessun totale parziale salvato.");
    }
    ids.add(track.id);
    additions.push({ id: track.id, duration_ms: track.duration_ms });
  }
  const next = page.next ?? null;
  if (next !== null && (row.seen.includes(next) || next === row.cursor)) throw new Error("Cursore del catalogo ripetuto.");
  const tracks = [...row.tracks, ...additions];
  if (tracks.length > page.total || next === null && tracks.length !== page.total
      || next !== null && tracks.length >= page.total) throw new Error("Elenco brani non completo o paginazione incoerente.");
  const total = tracks.reduce((sum, track) => sum + track.duration_ms, 0);
  if (!Number.isSafeInteger(total)) throw new Error("Totale durata fuori intervallo.");
  Object.assign(row, { total: page.total, tracks, cursor: next, pages: row.pages + 1 });
  if (next !== null) { row.seen.push(next); return null; }
  return total;
}

export function applyCompletion(storage, row, value) {
  const collection = stored(storage, COLLECTION, {});
  const album = collection.albums?.find((item) => item.id === row.album.id);
  if (!album || !same(identity(album), identity(row.album))) throw new Error("Album cambiato durante la lettura.");
  const provenance = stored(storage, COMPLETION_PROVENANCE_KEY, {});
  const related = {};
  if (row.category === "duration") {
    if (catalogTarget(storage, album, row.source) !== row.target) throw new Error("Associazione edizione cambiata.");
    const durations = stored(storage, DURATIONS, {}), queue = stored(storage, QUEUE, {});
    if (Object.hasOwn(durations, album.id) || Object.hasOwn(queue.durations || {}, album.id)) return "preserved";
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Durata completa non valida.");
    related[DURATIONS] = { ...durations, [album.id]: value };
  } else if (row.category === "genres") {
    if (album.genres?.length || album.primary_genre || album.genre_source === "manual"
        || provenance[album.id]?.genres?.source === "manual") return "preserved";
    if (!Array.isArray(value) || value.length > 20 || value.some((genre) => typeof genre !== "string" || !genre.trim())) {
      throw new Error("Generi della fonte non validi.");
    }
    if (!value.length) return "unavailable";
    album.genres = value; album.primary_genre = value[0];
  } else if (row.category === "evidence") {
    const evidence = stored(storage, COMPLETION_EVIDENCE_KEY, {});
    if (Object.hasOwn(evidence, album.id)) return "preserved";
    if (!value) return "unavailable";
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("Evidenza della fonte non valida.");
    related[COMPLETION_EVIDENCE_KEY] = { ...evidence, [album.id]: value };
  } else throw new Error("Categoria non valida.");
  provenance[album.id] ||= {};
  provenance[album.id][row.category] = { source: row.source, target: row.target,
    identity: identity(row.album), updated: new Date().toISOString(),
    complete_tracks: row.category === "duration" ? row.total : null };
  related[COMPLETION_PROVENANCE_KEY] = provenance;
  commitLocalRestore(storage, COLLECTION, {}, collection, related,
    `Completamento locale: ${COMPLETION_CATEGORIES[row.category]}`);
  return "completed";
}

export async function runCompletion({ storage, plan, limit, read, guard = () => {}, signal, progress = () => {},
  committed = () => {} }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("Limite locale di letture: scegli da 1 a 200.");
  let used = 0;
  const check = () => { signal?.throwIfAborted(); guard(); };
  const persist = () => {
    plan.updated = Date.now();
    storage.setItem(COMPLETION_KEY, JSON.stringify(plan));
  };
  const consume = () => {
    check();
    if (used >= limit) throw new CompletionBudget("Limite locale raggiunto; continua con un nuovo budget esplicito.");
    used += 1; plan.reads += 1; persist();
  };
  plan.state = "running"; persist();
  try {
    for (const row of plan.rows) {
      while (row.status === "pending") {
        check();
        if (used >= limit) throw new CompletionBudget("Limite locale raggiunto; risultati completati conservati.");
        const albums = stored(storage, COLLECTION, {}).albums || [];
        const album = albums.find((item) => item.id === row.album.id);
        if (!album || !same(identity(album), identity(row.album))
            || row.category === "duration" && catalogTarget(storage, album, plan.provider) !== row.target) {
          throw new Error("Album o associazione cambiati: prepara un nuovo piano.");
        }
        const current = createCompletionPlan(storage, [album], plan.provider, [row.category]).rows[0];
        if (current.status === "preserved") {
          Object.assign(row, { status: "preserved", detail: "Scelta aggiunta nel frattempo: conservata." }); persist(); break;
        }
        progress(`${row.album.name} · ${COMPLETION_CATEGORIES[row.category]} · letture ${used}/${limit}`);
        const page = await read(row, consume, limit - used, check);
        check();
        const value = row.category === "duration" ? acceptDurationPage(row, page) : page;
        if (row.category === "duration" && value === null) { persist(); continue; }
        const status = applyCompletion(storage, row, value);
        Object.assign(row, { status, detail: status === "completed" ? "Dato mancante completato."
          : status === "unavailable" ? "Nessun dato disponibile dalla fonte." : "Scelta locale conservata." });
        if (status === "completed") {
          row.detail += row.category === "duration" ? ` ${value} ms · ${row.total} brani completi.`
            : row.category === "genres" ? ` ${value.join(", ")}.` : ` ${value.detail || ""}`;
        }
        persist();
        committed();
      }
    }
    plan.state = plan.rows.some((row) => ["blocked", "unavailable"].includes(row.status)) ? "partial" : "completed";
    delete plan.detail;
  } catch (error) {
    plan.state = signal?.aborted ? "stopped" : error instanceof CompletionBudget ? "budget" : "paused";
    plan.detail = signal?.aborted ? "Interrotto: risultati completati conservati." : error.message;
    persist();
    if (!(error instanceof CompletionBudget) && !signal?.aborted) throw error;
  }
  persist();
  return plan;
}

export function isoDurationMs(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d{1,3})?)S)?$/.exec(String(value));
  const result = match && Math.round((Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)) * 1000);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error("Durata TIDAL assente o non valida.");
  return result;
}

export async function readCatalogPage(provider, api, row, consume, countHttp = false) {
  if (!countHttp) consume();
  const id = row.target, cursor = row.cursor;
  if (provider === "qobuz") {
    const page = await api.albumTracks(id, cursor || 0, countHttp ? consume : undefined);
    if (page.tracks.some((track) => track.album && track.album.album.id !== id)) {
      throw new Error("Un brano Qobuz dichiara un'edizione diversa.");
    }
    return { id: page.album.album.id, total: page.total, next: page.next,
      tracks: page.tracks.map((track) => ({ id: track.id, duration_ms: track.duration * 1000 })) };
  }
  if (provider === "spotify") {
    let page, total;
    if (cursor === null) {
      const document = await api.request(`albums/${id}`);
      if (document.id !== id || !Number.isSafeInteger(document.total_tracks)) throw new Error("Identita' album Spotify non confermata.");
      page = document.tracks; total = document.total_tracks;
    } else {
      const url = new URL(cursor, "https://api.spotify.com/v1/");
      if (url.origin !== "https://api.spotify.com" || url.username || url.password || url.hash
          || url.pathname !== `/v1/albums/${id}/tracks`
          || !url.searchParams.has("offset") || Number(url.searchParams.get("offset")) !== row.tracks.length) {
        throw new Error("Cursore Spotify conservato non valido per questo album.");
      }
      page = await api.request(cursor); total = row.total;
    }
    if (page?.total !== total || page.offset !== row.tracks.length || !Array.isArray(page.items)) {
      throw new Error("Conteggio o pagina Spotify incoerenti.");
    }
    let next = page.next;
    if (next) {
      const url = new URL(next);
      if (url.origin !== "https://api.spotify.com" || url.username || url.password || url.hash
          || url.pathname !== `/v1/albums/${id}/tracks`
          || Number(url.searchParams.get("offset")) !== row.tracks.length + page.items.length) {
        throw new Error("Cursore Spotify non valido.");
      }
      next = `albums/${id}/tracks${url.search}`;
    }
    return { id, total, next, tracks: page.items.map((track) => ({ id: track.id, duration_ms: track.duration_ms })) };
  }
  const number = id.slice("tidal:".length);
  if (cursor === null) {
    const document = await api.completionPage(`albums/${number}`, countHttp ? consume : undefined);
    if (document.data?.type !== "albums" || String(document.data.id) !== number
        || !Number.isSafeInteger(document.data.attributes?.numberOfTracks) || document.data.attributes.numberOfTracks <= 0) {
      throw new Error("Identita' o conteggio brani TIDAL non confermati.");
    }
    row.total = document.data.attributes.numberOfTracks;
    row.cursor = `albums/${number}/relationships/items?include=items`;
    return readCatalogPage(provider, api, row, consume, countHttp);
  }
  const savedUrl = new URL(cursor, "https://openapi.tidal.com/v2/");
  if (savedUrl.origin !== "https://openapi.tidal.com" || savedUrl.username || savedUrl.password || savedUrl.hash
      || savedUrl.pathname !== `/v2/albums/${number}/relationships/items`) {
    throw new Error("Cursore TIDAL conservato non valido per questo album.");
  }
  const document = await api.completionPage(cursor, countHttp ? consume : undefined);
  if (!Array.isArray(document.data) || !Array.isArray(document.included || [])) throw new Error("Elenco TIDAL non valido.");
  const resources = new Map([...(document.included || []), ...document.data].filter((item) => item.attributes)
    .map((item) => [`${item.type}:${item.id}`, item]));
  const tracks = document.data.map((item) => {
    if (item.type !== "tracks" || !item.id) throw new Error("L'album TIDAL contiene elementi diversi dai brani.");
    const resource = resources.get(`tracks:${item.id}`);
    const refs = resource?.relationships?.albums?.data;
    const related = Array.isArray(refs) ? refs : refs ? [refs] : [];
    if (related.length && !related.some((album) => String(album.id) === number)) {
      throw new Error("Un brano TIDAL dichiara un'edizione diversa.");
    }
    return { id: String(item.id), duration_ms: isoDurationMs(resource?.attributes?.duration) };
  });
  let next = typeof document.links?.next === "string" ? document.links.next : document.links?.next?.href || null;
  if (next) {
    const url = new URL(next, "https://openapi.tidal.com/v2/");
    if (url.origin !== "https://openapi.tidal.com" || url.username || url.password || url.hash
        || ![`/v2/albums/${number}/relationships/items`, `/albums/${number}/relationships/items`].includes(url.pathname)) {
      throw new Error("Cursore TIDAL cambia album.");
    }
    next = `albums/${number}/relationships/items${url.search}`;
  }
  return { id, total: row.total, next, tracks };
}
