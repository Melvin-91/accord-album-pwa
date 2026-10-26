export const ALBUM_STATES = new Set(["queued", "listening", "heard", "liked", "hidden"]);
const ALBUM_FIELDS_V1 = ["id", "name", "artist", "url", "year", "status", "rating", "genres"];
const ALBUM_FIELDS_V2 = [...ALBUM_FIELDS_V1, "collections", "tags", "cover_sha256"];
export const ALBUM_FIELDS = [...ALBUM_FIELDS_V2, "primary_genre"];
export const NO_PRIMARY_GENRE_FILTER = "__accord_no_primary_genre__";
export const NO_SECONDARY_GENRE_FILTER = "__accord_no_secondary_genre__";

export function musicBrainzCoverArtUrl(mbid) {
  const id = String(mbid || "").trim();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return null;
  return `https://coverartarchive.org/release-group/${id.toLocaleLowerCase()}/front-250`;
}

export function primaryAlbumGenres(genres) {
  if (!Array.isArray(genres)) return [];
  const unique = new Map();
  for (const value of genres) {
    if (typeof value !== "string") continue;
    const label = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    const key = label.toLowerCase();
    if (label && !unique.has(key)) unique.set(key, label);
    if (unique.size === 3) break;
  }
  return [...unique.values()];
}

export function bestSpotifyAlbumSuggestionMatch(source, candidates) {
  if (!source || typeof source !== "object" || !Array.isArray(candidates)) {
    throw new Error("Corrispondenze Spotify non valide.");
  }
  const normalize = (value) => String(value || "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const similarity = (left, right) => {
    const a = normalize(left).split(/\s+/).filter(Boolean);
    const b = normalize(right).split(/\s+/).filter(Boolean);
    if (!a.length || !b.length) return 0;
    const leftSet = new Set(a);
    const rightSet = new Set(b);
    const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
    const overlap = intersection / new Set([...leftSet, ...rightSet]).size;
    const contained = [...leftSet].every((token) => rightSet.has(token))
      || [...rightSet].every((token) => leftSet.has(token));
    return contained ? Math.max(overlap, 0.88) : overlap;
  };
  const sourceArtists = (Array.isArray(source.artist_names) ? source.artist_names : [source.artist])
    .map((artist) => String(artist || "").trim()).filter(Boolean);
  const sourceYear = Number(source.year);
  return candidates.map((candidate, index) => {
    const titleScore = similarity(source.name, candidate?.name);
    const candidateArtists = Array.isArray(candidate?.artist_names)
      ? candidate.artist_names : [candidate?.artist];
    const artistScore = Math.max(0, ...sourceArtists.flatMap((sourceArtist) =>
      candidateArtists.map((candidateArtist) => similarity(sourceArtist, candidateArtist))));
    const candidateYear = Number(candidate?.year);
    const yearScore = !sourceYear || !candidateYear ? 0.5
      : sourceYear === candidateYear ? 1
        : Math.abs(sourceYear - candidateYear) <= 1 ? 0.75
          : Math.abs(sourceYear - candidateYear) <= 3 ? 0.4 : 0;
    return { candidate, index, titleScore, artistScore, score: titleScore * 0.62 + artistScore * 0.25 + yearScore * 0.13 };
  })
    .filter((match) => match.titleScore >= 0.6 && match.artistScore >= 0.65)
    .sort((left, right) => right.score - left.score
      || right.titleScore - left.titleScore
      || right.artistScore - left.artistScore
      || left.index - right.index)[0]?.candidate || null;
}

export function spotifyRedirectUriForPage(pageUrl) {
  return new URL("./", pageUrl).href;
}

export function validateAlbum(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || ![ALBUM_FIELDS_V1, ALBUM_FIELDS_V2, ALBUM_FIELDS].some((fields) =>
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
  if (typeof value.primary_genre !== "string" && Object.hasOwn(value, "primary_genre")) {
    throw new Error("Genere principale album non valido.");
  }
  const requestedPrimary = String(value.primary_genre || "").trim().replace(/\s+/g, " ");
  const primaryGenre = genres.find((genre) => genre.toLocaleLowerCase() === requestedPrimary.toLocaleLowerCase())
    || genres[0] || "";
  if (requestedPrimary && !genres.some((genre) => genre.toLocaleLowerCase() === requestedPrimary.toLocaleLowerCase())) {
    throw new Error("Il genere principale deve essere assegnato all'album.");
  }
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
  return { ...value, genres, primary_genre: primaryGenre, ...groups };
}

export function validateDocument(document) {
  if (!document || document.format !== "accord-album-collection"
      || ![1, 2, 3].includes(document.version) || !Array.isArray(document.albums)) {
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

export async function findSpotifyPlaylistMatches(name, fetchPage) {
  const wanted = String(name || "").trim().toLocaleLowerCase();
  if (!wanted || typeof fetchPage !== "function") throw new Error("Nome playlist o richiesta non valida.");
  let offset = 0;
  let expectedTotal = null;
  while (offset < 2000) {
    const page = await fetchPage(offset);
    if (!page || !Array.isArray(page.items) || page.items.length > 50
        || (page.offset !== undefined && Number(page.offset) !== offset)) {
      throw new Error("Risposta elenco playlist incompleta.");
    }
    if (page.total !== undefined && page.total !== null) {
      const total = Number(page.total);
      if (!Number.isSafeInteger(total) || total < 0 || offset + page.items.length > total
          || (expectedTotal !== null && total !== expectedTotal)) {
        throw new Error("Conteggio playlist non valido.");
      }
      expectedTotal = total;
    }
    const matches = page.items.filter((playlist) => typeof playlist?.name === "string"
      && playlist.name.trim().toLocaleLowerCase() === wanted
      && typeof playlist.id === "string" && /^[A-Za-z0-9]{22}$/.test(playlist.id));
    if (matches.length) return matches;

    const nextOffset = offset + page.items.length;
    if (page.next === null || page.next === undefined) {
      if (expectedTotal !== null && nextOffset !== expectedTotal) {
        throw new Error("Lettura elenco playlist incompleta.");
      }
      return [];
    }
    if (typeof page.next !== "string" || !page.next || !page.items.length) {
      throw new Error("Paginazione elenco playlist incompleta.");
    }
    let next;
    try {
      next = new URL(page.next);
    } catch {
      throw new Error("Indirizzo di paginazione playlist non valido.");
    }
    const nextPageOffset = Number(next.searchParams.get("offset"));
    const nextLimit = next.searchParams.get("limit");
    if (next.origin !== "https://api.spotify.com" || next.pathname !== "/v1/me/playlists"
        || nextPageOffset !== nextOffset || (nextLimit && Number(nextLimit) !== 50)) {
      throw new Error("Indirizzo di paginazione playlist non valido.");
    }
    if (nextOffset >= 2000) {
      throw new Error("Oltre 2000 playlist: usa l’ID o il link Spotify per evitare altre richieste.");
    }
    offset = nextOffset;
  }
  throw new Error("Ricerca playlist interrotta prima di completare la pagina richiesta.");
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

export function summarizeLastFmTracks(tracks) {
  if (!Array.isArray(tracks)) throw new Error("Cronologia Last.fm non valida.");
  const normalize = (value) => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const artists = new Map();
  const knownAlbums = new Set();
  let trackCount = 0;
  for (const track of tracks) {
    const artistValue = track?.artist;
    const artist = String(typeof artistValue === "string"
      ? artistValue : artistValue?.name || artistValue?.["#text"] || "").trim();
    const albumValue = track?.album;
    const album = String(typeof albumValue === "string"
      ? albumValue : albumValue?.name || albumValue?.["#text"] || "").trim();
    const timestamp = track?.date?.uts;
    if (!artist || timestamp === undefined || timestamp === null
        || String(timestamp).trim() === "" || !Number.isFinite(Number(timestamp))) continue;
    trackCount += 1;
    const key = normalize(artist);
    const previous = artists.get(key);
    artists.set(key, { name: previous?.name || artist, plays: (previous?.plays || 0) + 1 });
    if (album) knownAlbums.add(JSON.stringify([key, normalize(album)]));
  }
  return {
    artists: [...artists.values()].sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name)),
    knownAlbums,
    trackCount,
  };
}

export function lastFmSuggestionRange(period, startValue = "", endValue = "", now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Data Last.fm non valida.");
  }
  const to = Math.floor(now.getTime() / 1000);
  if (period === "all") return { from: null, to };
  if (["7", "30", "90", "365"].includes(period)) {
    return { from: to - Number(period) * 86400, to };
  }
  if (period !== "custom") throw new Error("Seleziona un intervallo Last.fm valido.");
  const parseDate = (value) => {
    const match = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1
      && date.getDate() === Number(match[3]) ? date : null;
  };
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end) throw new Error("Scegli le date iniziale e finale dell’intervallo.");
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (start > end || end > today) {
    throw new Error("L’intervallo personalizzato non può terminare nel futuro o precedere la data iniziale.");
  }
  const nextDay = new Date(end);
  nextDay.setDate(nextDay.getDate() + 1);
  const from = Math.floor(start.getTime() / 1000);
  const rangeEnd = Math.min(to, Math.floor(nextDay.getTime() / 1000) - 1);
  if (rangeEnd < from) throw new Error("L’intervallo Last.fm selezionato non contiene date valide.");
  return { from, to: rangeEnd };
}

export function normalizeHeardArtistNames(names = []) {
  if (!Array.isArray(names)) throw new Error("Elenco artisti ascoltati non valido.");
  const unique = new Map();
  for (const value of names) {
    if (typeof value !== "string") continue;
    const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    const key = name.toLowerCase();
    if (key && !unique.has(key)) unique.set(key, name);
  }
  return [...unique.values()].sort((left, right) => left.localeCompare(right));
}

export async function readLastFmAllTimeArtists(fetchPage) {
  if (typeof fetchPage !== "function") throw new Error("Richiesta Last.fm non valida.");
  const first = await fetchPage(1, 1000);
  const pages = Number(first?.topartists?.["@attr"]?.totalPages);
  if (!Number.isSafeInteger(pages) || pages < 0) {
    throw new Error("Last.fm non ha restituito le pagine degli artisti ascoltati complessivi.");
  }
  const names = [];
  for (let page = 1; page <= Math.max(pages, 1); page += 1) {
    const data = page === 1 ? first : await fetchPage(page, 1000);
    const currentPages = Number(data?.topartists?.["@attr"]?.totalPages);
    if (!Number.isSafeInteger(currentPages) || currentPages !== pages) {
      throw new Error("La cronologia Last.fm è cambiata durante la lettura. Riprova.");
    }
    let artists = data.topartists?.artist || [];
    if (!Array.isArray(artists)) artists = [artists];
    for (const artist of artists) {
      if (typeof artist?.name === "string" && artist.name.trim()) names.push(artist.name);
    }
  }
  return normalizeHeardArtistNames(names);
}

export function filterUnheardArtists(artists, heardArtists = []) {
  if (!Array.isArray(artists)) throw new Error("Elenco artisti consigliati non valido.");
  const heard = new Set(normalizeHeardArtistNames(heardArtists).map((name) => name.toLowerCase()));
  return artists.filter((artist) => {
    const name = normalizeHeardArtistNames([artist?.name])[0];
    return !name || !heard.has(name.toLowerCase());
  });
}

export function filterListeningAlbumSuggestions(albums, {
  knownAlbums = new Set(), collection = [], excludedArtists = [],
  includedGenres = [], excludedGenres = [], includedGenresMatch = "exact",
  excludedGenresMatch = "exact", heardArtists = [],
} = {}) {
  const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const excluded = new Set(excludedArtists.map(normalize).filter(Boolean));
  const heard = new Set(normalizeHeardArtistNames(heardArtists).map((name) => name.toLowerCase()));
  const genreIncludes = new Set(includedGenres.map(normalize).filter(Boolean));
  const genreExcludes = new Set(excludedGenres.map(normalize).filter(Boolean));
  const matchesGenre = (genre, terms, mode) => mode === "contains"
    ? [...terms].some((term) => genre.includes(term))
    : terms.has(genre);
  const saved = new Set(collection.map((album) =>
    JSON.stringify([normalize(album.artist), normalize(album.name)])));
  const seen = new Set();
  return albums.filter((album) => {
    const artists = [...new Set([album.artist, ...(Array.isArray(album.artist_names) ? album.artist_names : [])]
      .map(normalize).filter(Boolean))];
    const genres = (Array.isArray(album.genres) ? album.genres : []).map(normalize);
    const identity = JSON.stringify([normalize(album.artist), normalize(album.name)]);
    const alreadyHeard = knownAlbums.has(identity) || artists.some((artist) =>
      knownAlbums.has(JSON.stringify([artist, normalize(album.name)])));
    const artistAlreadyHeard = artists.some((artist) => heard.has(artist));
    const albumId = album.id || identity;
    if (!album.name || !album.artist || alreadyHeard || artistAlreadyHeard || saved.has(identity)
        || seen.has(albumId) || artists.some((artist) => excluded.has(artist))
        || genreIncludes.size && !genres.some((genre) => matchesGenre(genre, genreIncludes, includedGenresMatch))
        || genres.some((genre) => matchesGenre(genre, genreExcludes, excludedGenresMatch))) return false;
    seen.add(albumId);
    return true;
  });
}

export async function readMusicBrainzCatalog(fetchPage, maximum = 300) {
  if (typeof fetchPage !== "function" || !Number.isInteger(maximum) || maximum < 1 || maximum > 300) {
    throw new Error("Limite o richiesta MusicBrainz non validi.");
  }
  const groups = [];
  const seen = new Set();
  let total = null;
  let fetched = 0;
  let pages = 0;
  let incomplete = false;
  while (fetched < maximum) {
    const limit = Math.min(100, maximum - fetched);
    const page = await fetchPage(fetched, limit);
    const rows = page?.["release-groups"];
    if (!Array.isArray(rows) || rows.length > limit) {
      throw new Error("Risposta MusicBrainz senza risultati album verificabili.");
    }
    if (page.count !== undefined) {
      const pageTotal = Number(page.count);
      if (!Number.isSafeInteger(pageTotal) || pageTotal < 0 || fetched + rows.length > pageTotal) {
        throw new Error("Conteggio risultati MusicBrainz non valido.");
      }
      if (total !== null && total !== pageTotal) {
        incomplete = true;
        break;
      }
      total = pageTotal;
    } else {
      incomplete = true;
    }
    pages += 1;
    fetched += rows.length;
    for (const group of rows) {
      if (typeof group?.id !== "string" || !group.id || seen.has(group.id)) {
        incomplete = true;
        continue;
      }
      seen.add(group.id);
      groups.push(group);
    }
    if (!rows.length || rows.length < limit || total !== null && fetched >= total) break;
  }
  const truncated = incomplete || total === null || total > fetched;
  return { groups, total, fetched, pages, truncated };
}

export async function expandSimilarArtists(seeds, loadSimilarArtists, {
  maximumArtists = 30, maximumSeeds = 30, initialSeedCount = 5, excludedNames = [],
} = {}) {
  if (!Array.isArray(seeds) || typeof loadSimilarArtists !== "function"
      || !Number.isInteger(maximumArtists) || maximumArtists < 1
      || !Number.isInteger(maximumSeeds) || maximumSeeds < 1
      || !Number.isInteger(initialSeedCount) || initialSeedCount < 1
      || !Array.isArray(excludedNames) || excludedNames.some((name) => typeof name !== "string")) {
    throw new Error("Parametri di ricerca artisti simili non validi.");
  }
  const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const availableSeeds = [];
  const seenSeeds = new Set();
  for (const seed of seeds) {
    const name = String(seed?.name || "").trim();
    const key = normalize(name);
    if (key && !seenSeeds.has(key)) {
      seenSeeds.add(key);
      availableSeeds.push({ ...seed, name });
    }
  }
  const limitedSeeds = availableSeeds.slice(0, maximumSeeds);
  const excluded = new Set([...excludedNames, ...limitedSeeds.map((seed) => seed.name)].map(normalize));
  const related = new Map();
  let seedsUsed = 0;
  for (const seed of limitedSeeds) {
    const rows = await loadSimilarArtists(seed);
    if (!Array.isArray(rows)) throw new Error("Risposta Last.fm degli artisti simili non valida.");
    seedsUsed += 1;
    const seenForSeed = new Set();
    for (const candidate of rows) {
      const name = String(candidate?.name || "").trim();
      const key = normalize(name);
      const match = Number(candidate?.match);
      if (!key || seenForSeed.has(key) || !Number.isFinite(match) || match <= 0 || match > 1) continue;
      seenForSeed.add(key);
      const entry = related.get(key) || { ...candidate, name, seeds: [], support: 0 };
      entry.support += 1;
      entry.seeds.push(seed.name);
      entry.match = Math.max(entry.match, match);
      related.set(key, entry);
    }
    const eligibleCount = [...related.keys()].filter((key) => !excluded.has(key)).length;
    if (seedsUsed >= Math.min(initialSeedCount, limitedSeeds.length) && eligibleCount >= maximumArtists) break;
  }
  const artists = [...related.entries()]
    .filter(([key]) => !excluded.has(key))
    .map(([, artist]) => artist)
    .sort((left, right) => right.support - left.support || right.match - left.match
      || normalize(left.name).localeCompare(normalize(right.name)))
    .slice(0, maximumArtists);
  return {
    artists,
    seedsUsed,
    exhausted: seedsUsed === availableSeeds.length,
    seedLimitReached: availableSeeds.length > maximumSeeds && seedsUsed === maximumSeeds,
  };
}

export function topListenedAlbums(albums, rankings, maximumPerArtist = 1) {
  if (!Array.isArray(albums) || !Array.isArray(rankings)
      || !Number.isInteger(maximumPerArtist) || maximumPerArtist < 1) {
    throw new Error("Classifica album non valida.");
  }
  const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const validMbid = (value) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(value || ""));
  const entries = [];
  const ranking = new Map();
  for (const entry of rankings) {
    const artist = normalize(entry?.artist);
    const name = normalize(entry?.name);
    const playcount = Number(entry?.playcount);
    if (!artist || !name || !Number.isFinite(playcount) || playcount < 0) continue;
    const mbid = validMbid(entry?.mbid) ? String(entry.mbid).toLocaleLowerCase() : "";
    const key = JSON.stringify([artist, mbid || name]);
    const previous = ranking.get(key);
    if (previous) previous.playcount = Math.max(previous.playcount, playcount);
    else {
      const value = { artist, name, mbid, playcount, key };
      ranking.set(key, value);
      entries.push(value);
    }
  }
  const matches = albums.map((album, index) => {
    const artists = (Array.isArray(album.artist_names) ? album.artist_names : [album.artist]).map(normalize);
    const artistMbids = Array.isArray(album.artist_mbids) ? album.artist_mbids : [];
    const limitKeys = new Set(artists.flatMap((artist, artistIndex) => {
      if (!artist) return [];
      const mbid = artistMbids[artistIndex];
      const keys = [`name:${artist}`];
      if (validMbid(mbid)) keys.push(`mbid:${String(mbid).toLocaleLowerCase()}`);
      return keys;
    }));
    const albumMbid = validMbid(album.mbid || album.sourceId) ? String(album.mbid || album.sourceId).toLocaleLowerCase() : "";
    const found = entries.flatMap((entry) => {
      if (!artists.includes(entry.artist)) return [];
      if (entry.mbid && albumMbid) {
        if (entry.mbid === albumMbid) return [{ ...entry, evidence: "mbid" }];
        return entry.name === normalize(album.name) ? [{ ...entry, evidence: "mbid-conflict" }] : [];
      }
      return entry.name === normalize(album.name) ? [{ ...entry, evidence: "title" }] : [];
    });
    const best = found.sort((left, right) => right.playcount - left.playcount
      || Number(right.evidence === "mbid") - Number(left.evidence === "mbid")
      || Number(right.evidence === "mbid-conflict") - Number(left.evidence === "mbid-conflict"))[0];
    return best ? { album, index, artist: best.artist, score: best.playcount,
      rankKey: best.key, evidence: best.evidence,
      limitKeys: limitKeys.size ? [...limitKeys] : [`name:${best.artist}`] } : null;
  }).filter(Boolean);
  const rankCandidates = new Map();
  for (const match of matches) {
    if (match.evidence === "mbid") continue;
    if (!rankCandidates.has(match.rankKey)) rankCandidates.set(match.rankKey, new Set());
    rankCandidates.get(match.rankKey).add(match.album.id || `index:${match.index}`);
  }
  const counts = new Map();
  const selectedRankKeys = new Set();
  return matches.sort((left, right) => right.score - left.score || left.index - right.index)
    .filter((match) => {
      if (selectedRankKeys.has(match.rankKey)) {
        return match.evidence === "mbid-conflict"
          || (rankCandidates.get(match.rankKey)?.size || 0) > 1;
      }
      if (match.limitKeys.some((key) => (counts.get(key) || 0) >= maximumPerArtist)) return false;
      selectedRankKeys.add(match.rankKey);
      for (const key of match.limitKeys) counts.set(key, (counts.get(key) || 0) + 1);
      return true;
    })
    .map((match) => {
      const alternatives = rankCandidates.get(match.rankKey)?.size || 0;
      const matchConfidence = match.evidence === "mbid-conflict" || alternatives > 1 ? "ambiguous" : "high";
      const matchReason = matchConfidence === "ambiguous"
        ? match.evidence === "mbid-conflict"
          ? "Titolo e artista coincidono, ma gli identificativi MusicBrainz non concordano; scegli la corrispondenza Spotify."
          : `Titolo e artista coincidono, ma il catalogo contiene ${alternatives} edizioni o gruppi; scegli la corrispondenza Spotify.`
        : match.evidence === "mbid"
          ? "Artista e identificativo MusicBrainz coincidono con Last.fm."
          : `Artista e titolo coincidono; anno MusicBrainz: ${match.album.year || "non disponibile"}.`;
      return { ...match.album, matchConfidence, matchReason };
    });
}

function relatedCatalogAlternatives(albums, artists, maximumPerArtist) {
  if (!Array.isArray(albums) || !Array.isArray(artists)
      || !Number.isInteger(maximumPerArtist) || maximumPerArtist < 1) {
    throw new Error("Alternative album correlate non valide.");
  }
  const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const artistPriority = new Map();
  artists.forEach((artist, index) => {
    const displayName = String(artist?.name || "").trim();
    const name = normalize(displayName);
    if (name && !artistPriority.has(name)) {
      artistPriority.set(name, { name, displayName, index });
    }
  });
  const candidates = albums.flatMap((album, index) => {
    const credited = [...new Set([album.artist, ...(Array.isArray(album.artist_names) ? album.artist_names : [])]
      .map(normalize).filter(Boolean))];
    const matchedArtists = credited.map((name) => artistPriority.get(name)).filter(Boolean)
      .sort((left, right) => left.index - right.index);
    return matchedArtists.length ? [{ album, index, matchedArtists }] : [];
  }).sort((left, right) => left.matchedArtists[0].index - right.matchedArtists[0].index
    || left.index - right.index);
  const counts = new Map();
  const seen = new Set();
  const alternatives = [];
  for (const { album, matchedArtists } of candidates) {
    const names = [...new Set(matchedArtists.map((artist) => artist.name))];
    if (names.some((name) => (counts.get(name) || 0) >= maximumPerArtist)) continue;
    const id = album.id || JSON.stringify([normalize(album.artist), normalize(album.name)]);
    if (seen.has(id)) continue;
    seen.add(id);
    for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
    alternatives.push({
      ...album,
      matchConfidence: "related",
      matchReason: `Nessun album della classifica Last.fm corrisponde. Alternativa dal catalogo MusicBrainz per l'artista simile ${matchedArtists[0].displayName}; non e' una corrispondenza Last.fm.`,
    });
  }
  return alternatives;
}

export function listeningAlbumSuggestions(albums, rankings, artists, maximumPerArtist = 1) {
  const matches = topListenedAlbums(albums, rankings, maximumPerArtist);
  return matches.length ? matches : relatedCatalogAlternatives(albums, artists, maximumPerArtist);
}

export function topDiscogsVersions(versions, maximumVersions = 5) {
  if (!Array.isArray(versions) || !Number.isInteger(maximumVersions)
      || maximumVersions < 1 || maximumVersions > 100) {
    throw new Error("Campione versioni Discogs non valido.");
  }
  const seen = new Set();
  const popularity = (value) => {
    if (value === undefined || value === null) return 0;
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Conteggio raccolta Discogs non valido.");
    return count;
  };
  return versions.map((version) => {
    const id = Number(version?.id);
    if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)) {
      throw new Error("Edizione Discogs mancante o duplicata.");
    }
    seen.add(id);
    return {
      id,
      collection: popularity(version?.stats?.community?.in_collection),
      wantlist: popularity(version?.stats?.community?.in_wantlist),
      version,
    };
  }).sort((left, right) => right.collection - left.collection || right.wantlist - left.wantlist
    || left.id - right.id).slice(0, maximumVersions).map((entry) => entry.version);
}

export function aggregateDiscogsEditionRatings(versions, ratings, maximumVersions = 5) {
  if (!(ratings instanceof Map)) throw new Error("Campione voti Discogs non valido.");
  const ranked = topDiscogsVersions(versions, maximumVersions);
  let weighted = 0;
  let votes = 0;
  let editions = 0;
  for (const version of ranked) {
    const rating = ratings.get(Number(version.id));
    const count = Number(rating?.count);
    const average = Number(rating?.average);
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(average)
        || (count > 0 && (average < 1 || average > 5))) {
      throw new Error("Voto Discogs mancante o non valido.");
    }
    if (count) {
      weighted += average * count;
      votes += count;
      editions += 1;
    }
  }
  return {
    discogs: votes >= 2 ? Math.round(weighted / votes * 100) / 100 : null,
    discogs_votes: votes,
    discogs_editions: editions,
    discogs_versions: versions.length,
    discogs_sampled_versions: ranked.length,
    discogs_sampled: true,
  };
}

export function rankDiscogsSuggestionAlbums(albums) {
  if (!Array.isArray(albums)) throw new Error("Suggerimenti Discogs non validi.");
  const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const validMbid = (value) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(value || ""));
  const ranked = albums.map((album, index) => {
    if (!album || typeof album !== "object" || Array.isArray(album)) {
      throw new Error("Album suggerito Discogs non valido.");
    }
    const votes = Number(album.discogs_votes);
    const rating = Number(album.discogs);
    const hasDiscogs = Number.isSafeInteger(votes) && votes >= 2
      && Number.isFinite(rating) && rating >= 1 && rating <= 5;
    const score = hasDiscogs ? Math.round(((votes * rating + 5 * 3.5) / (votes + 5)) * 100) / 100 : null;
    const artists = (Array.isArray(album.artist_names) ? album.artist_names : [album.artist]).map(normalize);
    const artistMbids = Array.isArray(album.artist_mbids) ? album.artist_mbids : [];
    const limitKeys = new Set(artists.flatMap((artist, artistIndex) => {
      if (!artist) return [];
      const keys = [`name:${artist}`];
      if (validMbid(artistMbids[artistIndex])) keys.push(`mbid:${String(artistMbids[artistIndex]).toLocaleLowerCase()}`);
      return keys;
    }));
    return { album, index, score, votes: hasDiscogs ? votes : 0,
      limitKeys: limitKeys.size ? [...limitKeys] : [`name:${normalize(album.artist)}`] };
  }).sort((left, right) => Number(right.score !== null) - Number(left.score !== null)
    || (right.score ?? 0) - (left.score ?? 0) || right.votes - left.votes || left.index - right.index);
  const used = new Set();
  const selected = [];
  for (const entry of ranked) {
    if (entry.limitKeys.some((key) => used.has(key))) continue;
    for (const key of entry.limitKeys) used.add(key);
    selected.push(entry.score === null
      ? entry.album
      : { ...entry.album, discogs_rank_score: entry.score });
  }
  return selected;
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

export function topTracksPerAlbum(albumGroups, popularityById, tracksPerAlbum = 3) {
  if (!Array.isArray(albumGroups) || !(popularityById instanceof Map)
      || !Number.isInteger(tracksPerAlbum) || tracksPerAlbum < 1 || tracksPerAlbum > 10) {
    throw new Error("Selezione dei brani suggeriti non valida.");
  }
  const selected = [];
  const seen = new Set();
  for (const group of albumGroups) {
    if (!group || !Array.isArray(group.tracks)) throw new Error("Elenco brani album non valido.");
    const ranked = group.tracks.flatMap((track, index) => {
      const uri = track?.uri;
      if (track?.type !== "track" || typeof uri !== "string"
          || !/^spotify:track:[A-Za-z0-9]{22}$/.test(uri)) return [];
      const id = uri.slice("spotify:track:".length);
      const score = popularityById.get(id) ?? 0;
      if (!Number.isInteger(score) || score < 0 || score > 100) {
        throw new Error("Popolarita' brano Spotify non valida.");
      }
      return [{ uri, score, index }];
    }).sort((left, right) => right.score - left.score || left.index - right.index);
    let added = 0;
    for (const track of ranked) {
      if (seen.has(track.uri)) continue;
      selected.push(track.uri);
      seen.add(track.uri);
      added += 1;
      if (added === tracksPerAlbum) break;
    }
  }
  return selected;
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

const normalizeAlbumGenre = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();

export function albumPrimaryGenre(album) {
  const genres = Array.isArray(album?.genres) ? album.genres : [];
  const requested = normalizeAlbumGenre(album?.primary_genre);
  return genres.find((genre) => normalizeAlbumGenre(genre) === requested) || genres[0] || "";
}

export function albumSecondaryGenres(album) {
  const primary = normalizeAlbumGenre(albumPrimaryGenre(album));
  return (Array.isArray(album?.genres) ? album.genres : [])
    .filter((genre) => normalizeAlbumGenre(genre) !== primary);
}

export function filterAlbums(albums, {
  search = "", genre = "", primaryGenre = "", secondaryGenre = "",
  status = "", collection = "", tag = "", order = "artist",
} = {}) {
  const query = search.trim().toLocaleLowerCase();
  const legacyGenre = normalizeAlbumGenre(genre);
  const result = albums.filter((album) => (!status || album.status === status)
    && (!legacyGenre || album.genres.some((value) => normalizeAlbumGenre(value) === legacyGenre))
    && (!primaryGenre || (primaryGenre === NO_PRIMARY_GENRE_FILTER
      ? !albumPrimaryGenre(album) : normalizeAlbumGenre(albumPrimaryGenre(album)) === normalizeAlbumGenre(primaryGenre)))
    && (!secondaryGenre || (secondaryGenre === NO_SECONDARY_GENRE_FILTER
      ? !albumSecondaryGenres(album).length
      : albumSecondaryGenres(album).some((value) => normalizeAlbumGenre(value) === normalizeAlbumGenre(secondaryGenre))))
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
