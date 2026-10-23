export const ALBUM_STATES = new Set(["queued", "listening", "heard", "liked", "hidden"]);
const ALBUM_FIELDS_V1 = ["id", "name", "artist", "url", "year", "status", "rating", "genres"];
export const ALBUM_FIELDS = [...ALBUM_FIELDS_V1, "collections", "tags", "cover_sha256"];

export function validateAlbum(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || ![ALBUM_FIELDS_V1, ALBUM_FIELDS].some((fields) =>
        Object.keys(value).sort().join("|") === [...fields].sort().join("|"))) {
    throw new Error("Record album non valido.");
  }
  value = {
    ...value,
    collections: value.collections === undefined ? [] : value.collections,
    tags: value.tags === undefined ? [] : value.tags,
    cover_sha256: value.cover_sha256 === undefined ? null : value.cover_sha256,
  };
  for (const key of ["id", "name", "artist", "url", "year", "status"]) {
    if (typeof value[key] !== "string") throw new Error(`Campo album non valido: ${key}.`);
  }
  const url = new URL(value.url);
  const match = url.pathname.match(/^\/album\/([A-Za-z0-9]+)$/);
  if (url.protocol !== "https:" || url.host !== "open.spotify.com" || url.username || url.password
      || !match || match[1] !== value.id
      || !value.name || !value.artist || !ALBUM_STATES.has(value.status)) {
    throw new Error("Album o link Spotify non valido.");
  }
  if (value.rating !== null && (!Number.isFinite(value.rating) || value.rating < 0.5 || value.rating > 5
      || !Number.isInteger(value.rating * 2))) throw new Error("Il voto deve andare da 0,5 a 5.");
  if (!Array.isArray(value.genres) || value.genres.some((genre) => typeof genre !== "string")) {
    throw new Error("Generi album non validi.");
  }
  const genres = [];
  const seen = new Set();
  for (const genre of value.genres) {
    const label = genre.trim().replace(/\s+/g, " ");
    if (label.length > 80) throw new Error("Un genere puo' avere al massimo 80 caratteri.");
    if (label && !seen.has(label.toLocaleLowerCase())) {
      seen.add(label.toLocaleLowerCase());
      genres.push(label);
    }
  }
  if (genres.length > 20) throw new Error("Un album puo' avere al massimo 20 generi.");
  const groups = {};
  for (const key of ["collections", "tags"]) {
    if (!Array.isArray(value[key]) || value[key].some((label) => typeof label !== "string")) {
      throw new Error(`Elenco ${key} album non valido.`);
    }
    const labels = [];
    const groupSeen = new Set();
    for (const entry of value[key]) {
      const label = entry.trim().replace(/\s+/g, " ");
      if (label.length > 80) throw new Error(`Ogni elemento di ${key} puo' avere al massimo 80 caratteri.`);
      const normalized = label.toLocaleLowerCase();
      if (label && !groupSeen.has(normalized)) {
        groupSeen.add(normalized);
        labels.push(label);
      }
    }
    if (labels.length > 20) throw new Error(`Un album puo' avere al massimo 20 elementi in ${key}.`);
    groups[key] = labels;
  }
  if (value.cover_sha256 !== null && (typeof value.cover_sha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(value.cover_sha256))) throw new Error("Impronta copertina album non valida.");
  return { ...value, genres, ...groups };
}

export function validateDocument(document) {
  if (!document || document.format !== "accord-album-collection"
      || ![1, 2].includes(document.version) || !Array.isArray(document.albums)) {
    throw new Error("File del repository non supportato.");
  }
  const albums = document.albums.map(validateAlbum);
  if (new Set(albums.map((album) => album.id)).size !== albums.length) throw new Error("Album duplicati nel repository.");
  return albums.sort((a, b) => a.id.localeCompare(b.id));
}

export function spotifyPlaylistId(input) {
  const value = String(input || "").trim();
  const uri = value.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  if (/^[A-Za-z0-9]{22}$/.test(value)) return value;
  if (!/^https?:\/\//i.test(value)) return null;
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0]?.startsWith("intl-")) parts.shift();
  const id = parts[1];
  if (url.protocol !== "https:" || url.host !== "open.spotify.com" || url.username || url.password
      || parts.length !== 2 || parts[0] !== "playlist" || !/^[A-Za-z0-9]{22}$/.test(id || "")) {
    throw new Error("Inserisci un nome, ID o link Spotify valido di una playlist.");
  }
  return id;
}

export function spotifyAlbumId(input) {
  const value = String(input || "").trim();
  const uri = value.match(/^spotify:album:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  if (/^[A-Za-z0-9]{22}$/.test(value)) return value;
  if (!/^https?:\/\//i.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Inserisci una ricerca, un ID o un link Spotify valido di un album.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0]?.startsWith("intl-")) parts.shift();
  const id = parts[1];
  if (url.protocol !== "https:" || url.host !== "open.spotify.com" || url.username || url.password
      || parts.length !== 2 || parts[0] !== "album" || !/^[A-Za-z0-9]{22}$/.test(id || "")) {
    throw new Error("Inserisci una ricerca, un ID o un link Spotify valido di un album.");
  }
  return id;
}

export function playlistAlbumRecords(entries, playlistName = "") {
  const albums = new Map();
  for (const entry of entries) {
    const item = entry?.item || entry?.track;
    const album = item?.album;
    const id = album?.id;
    const name = album?.name;
    const artist = (Array.isArray(album?.artists) ? album.artists : [])
      .map((value) => typeof value?.name === "string" ? value.name : "")
      .filter(Boolean).join(", ");
    const url = album?.external_urls?.spotify;
    const match = typeof url === "string"
      ? url.match(/^https:\/\/open\.spotify\.com\/album\/([A-Za-z0-9]{22})(?:[?#].*)?$/)
      : null;
    if (item?.type && item.type !== "track") continue;
    if (!album || album.album_type !== "album" || album.restrictions
        || typeof id !== "string" || id !== match?.[1]
        || typeof name !== "string" || !name || !artist || albums.has(id)) continue;
    albums.set(id, validateAlbum({
      id,
      name,
      artist,
      url: `https://open.spotify.com/album/${id}`,
      year: typeof album.release_date === "string" ? album.release_date.slice(0, 4) : "",
      status: "queued",
      rating: null,
      genres: [],
      collections: [],
      tags: [],
      cover_sha256: null,
    }));
  }
  return [...albums.values()];
}

export function listenBrainzRecommendations(rows, referenceMbid) {
  if (!Array.isArray(rows) || typeof referenceMbid !== "string" || !referenceMbid) {
    throw new Error("Risposta ListenBrainz non valida.");
  }
  const candidates = rows.filter((row) => row && typeof row === "object"
    && row.reference_mbid === referenceMbid
    && typeof row.artist_mbid === "string" && row.artist_mbid
    && row.artist_mbid !== referenceMbid
    && typeof row.name === "string" && row.name.trim()
    && typeof row.score === "number" && Number.isFinite(row.score) && row.score > 0);
  candidates.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const unique = candidates.filter((row) => {
    if (seen.has(row.artist_mbid)) return false;
    seen.add(row.artist_mbid);
    return true;
  }).slice(0, 20);
  const maximum = unique[0]?.score || 1;
  return unique.map((row) => ({
    name: row.name.trim(),
    mbid: row.artist_mbid,
    score: row.score,
    match: row.score / maximum,
  }));
}

export function addPlaylistAlbums(collection, additions) {
  const albums = new Map(collection.map((album) => [validateAlbum(album).id, album]));
  let added = 0;
  for (const album of additions) {
    const valid = validateAlbum(album);
    if (albums.has(valid.id)) continue;
    albums.set(valid.id, valid);
    added += 1;
  }
  return { albums: [...albums.values()], added, duplicates: additions.length - added };
}

function mapAlbums(albums) {
  return new Map(albums.map((value) => {
    const album = validateAlbum(value);
    return [album.id, album];
  }));
}

export function threeWayMerge(base, local, remote, choices = {}) {
  if (Object.values(choices).some((choice) => !["local", "remote"].includes(choice))) {
    throw new Error("Scelta di conflitto non valida.");
  }
  const old = mapAlbums(base);
  const here = mapAlbums(local);
  const there = mapAlbums(remote);
  const result = new Map();
  const conflicts = [];
  const ids = [...new Set([...old.keys(), ...here.keys(), ...there.keys()])].sort();
  for (const id of ids) {
    const previous = old.get(id);
    const left = here.get(id);
    const right = there.get(id);
    if (!left) {
      if (right) result.set(id, right);
      continue;
    }
    if (!right) {
      result.set(id, left);
      continue;
    }
    if (!previous) {
      if (JSON.stringify(left) === JSON.stringify(right)) result.set(id, left);
      else if (choices[id]) result.set(id, choices[id] === "local" ? left : right);
      else conflicts.push({ id, base: null, local: left, remote: right });
      continue;
    }
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (same(left, previous)) result.set(id, right);
    else if (same(right, previous) || same(left, right)) result.set(id, left);
    else if (choices[id]) result.set(id, choices[id] === "local" ? left : right);
    else conflicts.push({ id, base: previous, local: left, remote: right });
  }
  return { albums: [...result.values()].sort((a, b) => a.id.localeCompare(b.id)), conflicts };
}

export function filterAlbums(albums, {
  search = "", genre = "", status = "", collection = "", tag = "", order = "artist",
} = {}) {
  const query = search.trim().toLocaleLowerCase();
  const result = albums.filter((album) => (!status || album.status === status)
    && (!genre || album.genres.some((value) => value.toLocaleLowerCase() === genre))
    && (!collection || album.collections.some((value) => value.toLocaleLowerCase() === collection))
    && (!tag || album.tags.some((value) => value.toLocaleLowerCase() === tag))
    && (!query || [album.name, album.artist, ...album.genres, ...album.collections, ...album.tags]
      .join(" ").toLocaleLowerCase().includes(query)));
  const key = ["artist", "name", "year", "rating", "genre", "collection", "manual"].includes(order)
    ? order : "artist";
  if (key === "manual") return result;
  return result.sort((a, b) => {
    const left = key === "rating" ? (a.rating ?? -1)
      : key === "year" ? Number(a.year) || 0
        : key === "genre" ? (a.genres[0] || "").toLocaleLowerCase()
          : key === "collection" ? (a.collections[0] || "").toLocaleLowerCase()
            : a[key].toLocaleLowerCase();
    const right = key === "rating" ? (b.rating ?? -1)
      : key === "year" ? Number(b.year) || 0
        : key === "genre" ? (b.genres[0] || "").toLocaleLowerCase()
          : key === "collection" ? (b.collections[0] || "").toLocaleLowerCase()
            : b[key].toLocaleLowerCase();
    if (left === right) return a.name.localeCompare(b.name);
    if (["artist", "name", "genre", "collection"].includes(key)) return left < right ? -1 : 1;
    return left < right ? 1 : -1;
  });
}

export function sortAlbumsByManualOrder(albums, order) {
  const position = new Map(order.map((id, index) => [id, index]));
  return [...albums].sort((left, right) =>
    (position.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (position.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id));
}

export function moveAlbumInManualOrder(order, visibleIds, albumId, targetIndex) {
  const next = [...new Set(order)];
  const visible = [...new Set(visibleIds)];
  const known = new Set(next);
  for (const id of visible) {
    if (!known.has(id)) {
      next.push(id);
      known.add(id);
    }
  }
  if (!Number.isInteger(targetIndex) || !visible.includes(albumId)) return next;

  const visibleSet = new Set(visible);
  const visibleOrder = next.filter((id) => visibleSet.has(id));
  const sourceIndex = visibleOrder.indexOf(albumId);
  if (sourceIndex < 0) return next;
  const [moved] = visibleOrder.splice(sourceIndex, 1);
  visibleOrder.splice(Math.max(0, Math.min(targetIndex, visibleOrder.length)), 0, moved);

  let replacementIndex = 0;
  for (let index = 0; index < next.length; index += 1) {
    if (visibleSet.has(next[index])) next[index] = visibleOrder[replacementIndex++];
  }
  return next;
}

const COVER_MAGIC = new Uint8Array([65, 67, 67, 79, 82, 68, 45, 67, 79, 86, 69, 82, 83, 0, 1]);
const MAX_COVER_BYTES = 48 * 1024;
const MAX_COVER_ARCHIVE_BYTES = 50 * 1024 * 1024;

export async function encodeCoverArchive(covers) {
  const entries = [...covers.entries()].sort(([left], [right]) => left.localeCompare(right));
  const chunks = [COVER_MAGIC];
  let total = COVER_MAGIC.length;
  for (const [id, value] of entries) {
    const data = value instanceof Uint8Array ? value : value.data;
    if (!/^[A-Za-z0-9]+$/.test(id) || !(data instanceof Uint8Array)
        || data.length === 0 || data.length > MAX_COVER_BYTES) throw new Error("Miniatura album non valida.");
    const idBytes = new TextEncoder().encode(id);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, data.length);
    chunks.push(new Uint8Array([idBytes.length]), idBytes, digest, length, data);
    total += 1 + idBytes.length + digest.length + length.length + data.length;
    if (total > MAX_COVER_ARCHIVE_BYTES) throw new Error("L'archivio delle miniature supera il limite di 50 MB.");
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function decodeCoverArchive(archive) {
  if (!(archive instanceof Uint8Array) || archive.length > MAX_COVER_ARCHIVE_BYTES
      || COVER_MAGIC.some((value, index) => archive[index] !== value)) {
    throw new Error("Archivio copertine GitHub non supportato.");
  }
  const covers = new Map();
  let offset = COVER_MAGIC.length;
  while (offset < archive.length) {
    const idLength = archive[offset++];
    if (!idLength || offset + idLength + 36 > archive.length) throw new Error("Indice copertina non valido.");
    const id = new TextDecoder("ascii", { fatal: true }).decode(archive.subarray(offset, offset + idLength));
    offset += idLength;
    if (!/^[A-Za-z0-9]+$/.test(id) || covers.has(id)) throw new Error("Identificativo copertina duplicato o non valido.");
    const digest = archive.slice(offset, offset + 32);
    offset += 32;
    const dataLength = new DataView(archive.buffer, archive.byteOffset + offset, 4).getUint32(0);
    offset += 4;
    if (!dataLength || dataLength > MAX_COVER_BYTES || offset + dataLength > archive.length) {
      throw new Error("Dimensione copertina non valida.");
    }
    const data = archive.slice(offset, offset + dataLength);
    offset += dataLength;
    if (data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) throw new Error("Formato miniatura copertina non valido.");
    const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    if (digest.some((value, index) => value !== actual[index])) throw new Error("Verifica copertina non riuscita.");
    covers.set(id, { hash: [...actual].map((value) => value.toString(16).padStart(2, "0")).join(""), data });
  }
  return covers;
}
