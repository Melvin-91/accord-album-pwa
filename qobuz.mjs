import { createServiceRequests } from "./service-requests.mjs?v=2";
export const QOBUZ_API = "https://www.qobuz.com/api.json/0.2/";
export const QOBUZ_PAGE_SIZE = 100;

export function qobuzCredentials(appId, token) {
  if (![appId, token].every((value) => typeof value === "string" && /^[!-~]{1,512}$/.test(value))) {
    throw new Error("Inserisci App ID e token della sessione Qobuz, senza spazi o password.");
  }
  return { appId, token };
}

export function qobuzAlbumId(value) {
  let text = String(value || "").trim();
  if (text.startsWith("qobuz:")) text = text.slice(6);
  else if (text.startsWith("https://")) {
    let url;
    try { url = new URL(text); } catch { throw new Error("Link album Qobuz non valido."); }
    const match = url.pathname.match(/^\/album\/([A-Za-z0-9]{1,120})$/);
    if (url.protocol !== "https:" || url.host !== "play.qobuz.com" || url.username || url.password
        || url.search || url.hash || !match) throw new Error("Link album Qobuz non valido.");
    text = match[1];
  }
  if (!/^[A-Za-z0-9]{1,120}$/.test(text)) throw new Error("ID album Qobuz non valido.");
  return text;
}

export function qobuzCoverUrl(value) {
  if (typeof value !== "string" || value.includes("\\")) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.host === "static.qobuz.com" && !url.username
      && !url.password && !url.hash ? url.href : null;
  } catch { return null; }
}

export function qobuzAlbum(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Album Qobuz non valido.");
  const id = qobuzAlbumId(value.id), name = value.title,
    artist = value.artist?.name || (Array.isArray(value.artists) ? value.artists.find((entry) => entry?.name)?.name : null);
  if (typeof name !== "string" || !name.trim() || typeof artist !== "string" || !artist.trim()) {
    throw new Error("Qobuz ha restituito metadati album incompleti.");
  }
  const coverUrl = ["large", "small", "thumbnail"].map((key) => qobuzCoverUrl(value.image?.[key])).find(Boolean) || null;
  return {
    album: { id: `qobuz:${id}`, name: name.trim(), artist: artist.trim(),
      url: `https://play.qobuz.com/album/${id}`,
      year: String(value.release_date_original || value.release_date_stream || value.dates?.original || value.dates?.stream || "").slice(0, 4),
      status: "queued", rating: null, genres: [], primary_genre: "", collections: [], tags: [], cover_sha256: null },
    coverUrl,
  };
}

export function qobuzNumericId(value, kind) {
  let text = String(value || "").trim();
  if (kind === "playlist" && text.startsWith("https://")) {
    let url;
    try { url = new URL(text); } catch { throw new Error("Link playlist Qobuz non valido."); }
    const match = url.pathname.match(/^\/playlist\/([1-9][0-9]{0,15})$/);
    if (url.protocol !== "https:" || url.host !== "play.qobuz.com" || url.username || url.password
        || url.search || url.hash || !match) throw new Error("Link playlist Qobuz non valido.");
    text = match[1];
  }
  if (!/^[1-9][0-9]{0,15}$/.test(text)) throw new Error(`ID ${kind} Qobuz non valido.`);
  return text;
}

export function qobuzPlaylist(value) {
  if (!value || typeof value.name !== "string" || !value.name.trim()
      || !Number.isSafeInteger(value.tracks_count) || value.tracks_count < 0 || typeof value.is_public !== "boolean") {
    throw new Error("Qobuz ha restituito una playlist non valida.");
  }
  const id = qobuzNumericId(value.id, "playlist");
  const description = Object.hasOwn(value, "description") ? (value.description ?? "") : null;
  if (description !== null && typeof description !== "string") throw new Error("Qobuz ha restituito una descrizione playlist non valida.");
  return { id, name: value.name.trim(), description, tracksCount: value.tracks_count,
    url: `https://play.qobuz.com/playlist/${id}`, public: value.is_public === true };
}

export function qobuzTrack(value, fallbackAlbum = null) {
  if (!value || typeof value.title !== "string" || !value.title.trim()) throw new Error("Qobuz ha restituito un brano non valido.");
  const id = qobuzNumericId(value.id, "brano");
  return { id, name: value.title.trim(), artist: value.performer?.name || "",
    album: value.album ? qobuzAlbum(value.album) : fallbackAlbum,
    playlistTrackId: value.playlist_track_id ? qobuzNumericId(value.playlist_track_id, "occorrenza") : null,
    duration: Number.isSafeInteger(value.duration) ? value.duration : 0, streamable: value.streamable !== false };
}

export function createQobuzClient({ appId, token, fetch: request = (...args) => globalThis.fetch(...args),
  storage = globalThis.localStorage, now, sleep, jitter, lock, active = () => true, signal }) {
  const auth = qobuzCredentials(appId, token);
  const requests = createServiceRequests({ service: "qobuz", storage, now, sleep, jitter, lock });
  function check() {
    if (!active()) throw new Error("Servizio musicale cambiato o account modificato: richiesta Qobuz interrotta.");
  }
  async function send(path, { params, data } = {}) {
    if (!["album/search", "album/get", "album/suggest", "favorite/getUserFavorites", "favorite/create", "favorite/delete",
      "playlist/getUserPlaylists", "playlist/get", "playlist/create", "playlist/update", "playlist/delete",
      "playlist/addTracks", "playlist/deleteTracks", "playlist/updateTracksPosition"].includes(path)) {
      throw new Error("Operazione Qobuz non supportata.");
    }
    const write = data !== undefined, url = new URL(path, QOBUZ_API);
    if (params) url.search = new URLSearchParams(params).toString();
    check();
    let response;
    try {
      response = await requests.send(async () => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.throwIfAborted();
        signal?.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(abort, 30_000);
        try {
          return await request(url.href, {
            method: write ? "POST" : "GET",
            headers: { "X-App-Id": auth.appId, "X-User-Auth-Token": auth.token, Accept: "application/json" },
            ...(write ? { body: new URLSearchParams(data) } : {}),
            signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store",
            referrerPolicy: "no-referrer",
          });
        } finally {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", abort);
        }
      }, { read: !write, signal, check });
    } catch (error) {
      check();
      signal?.throwIfAborted();
      if (/Retry-After|Stato richieste/.test(error.message)) throw error;
      throw new Error("Connessione Qobuz non riuscita." + (write ? " Esito incerto: verifica su Qobuz." : ""));
    }
    if (response.status !== 200) throw new Error(`Qobuz ha risposto HTTP ${response.status}.`
      + (response.status === 429 ? " Pausa Retry-After condivisa attiva." : "")
      + (write ? " Verifica lo stato remoto prima di riprovare." : ""));
    let result;
    try { result = await response.json(); }
    catch { throw new Error("Risposta Qobuz non leggibile." + (write ? " Verifica lo stato remoto." : "")); }
    if (!write) check();
    const verifiedWrite = ["favorite/create", "favorite/delete", "playlist/delete"].includes(path)
      ? result?.status === "success"
      : result?.id != null && (!data?.playlist_id || String(result.id) === data.playlist_id);
    if (!result || typeof result !== "object" || Array.isArray(result) || result.error
        || result.status === "error" || (write && result.status != null && result.status !== "success")
        || (write && !verifiedWrite)) {
      throw new Error("Qobuz ha rifiutato l'operazione o restituito una risposta non valida."
        + (write ? " Verifica lo stato remoto." : ""));
    }
    return result;
  }
  async function page(path, params, offset) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Pagina Qobuz non valida.");
    const result = await send(path, { params: { ...params, limit: QOBUZ_PAGE_SIZE, offset } });
    const albums = result.albums;
    if (!albums || !Array.isArray(albums.items) || !Number.isSafeInteger(albums.total) || albums.total < 0
        || albums.offset !== offset || albums.items.length > QOBUZ_PAGE_SIZE
        || (!albums.items.length && offset < albums.total)
        || (albums.items.length > 0 && offset + albums.items.length > albums.total)) {
      throw new Error("Paginazione Qobuz non valida: nessun album importato.");
    }
    const rows = albums.items.map(qobuzAlbum);
    return { rows, offset, total: albums.total,
      next: offset + rows.length < albums.total ? offset + rows.length : null };
  }
  function itemsPage(result, key, offset) {
    const group = result[key];
    if (!group || !Array.isArray(group.items) || !Number.isSafeInteger(group.total) || group.total < 0
        || group.offset !== offset || group.items.length > QOBUZ_PAGE_SIZE
        || (!group.items.length && offset < group.total)
        || (group.items.length > 0 && offset + group.items.length > group.total)) throw new Error(`Paginazione ${key} Qobuz non valida.`);
    return group;
  }
  function validOffset(offset) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Pagina Qobuz non valida.");
  }
  return {
    favorites: (offset = 0) => page("favorite/getUserFavorites", { type: "albums" }, offset),
    search: (value, offset = 0) => {
      const query = String(value || "").trim();
      if (!query || query.length > 100) throw new Error("Inserisci una ricerca Qobuz da 1 a 100 caratteri.");
      return page("album/search", { query }, offset);
    },
    album: async (value) => {
      const id = qobuzAlbumId(value), album = qobuzAlbum(await send("album/get", { params: { album_id: id } }));
      if (album.album.id !== `qobuz:${id}`) throw new Error("Qobuz ha restituito un album diverso.");
      return album;
    },
    similarAlbums: async (id) => {
      const result = await send("album/suggest", { params: { album_id: qobuzAlbumId(id) } });
      if (!Array.isArray(result.albums?.items) || result.albums.items.length > 100) throw new Error("Suggerimenti Qobuz non validi.");
      return result.albums.items.map(qobuzAlbum);
    },
    playlists: async (offset = 0) => {
      validOffset(offset);
      const page = itemsPage(await send("playlist/getUserPlaylists", { params: { limit: QOBUZ_PAGE_SIZE, offset } }), "playlists", offset);
      const playlists = page.items.map(qobuzPlaylist);
      return { playlists, offset, total: page.total,
        next: offset + playlists.length < page.total ? offset + playlists.length : null };
    },
    playlistTracks: async (value, offset = 0) => {
      validOffset(offset);
      const id = qobuzNumericId(value, "playlist");
      const result = await send("playlist/get", { params: { playlist_id: id, extra: "tracks", limit: QOBUZ_PAGE_SIZE, offset } });
      const playlist = qobuzPlaylist(result);
      if (playlist.id !== id) throw new Error("Qobuz ha restituito una playlist diversa.");
      const page = itemsPage(result, "tracks", offset), tracks = page.items.map((row) => qobuzTrack(row));
      return { playlist, tracks, offset, total: page.total, next: offset + tracks.length < page.total ? offset + tracks.length : null };
    },
    albumTracks: async (value, offset = 0) => {
      validOffset(offset);
      const id = qobuzAlbumId(value);
      const result = await send("album/get", { params: { album_id: id, limit: QOBUZ_PAGE_SIZE, offset } });
      const album = qobuzAlbum(result);
      if (album.album.id !== `qobuz:${id}`) throw new Error("Qobuz ha restituito un album diverso.");
      const page = itemsPage(result, "tracks", offset), tracks = page.items.map((row) => qobuzTrack(row, album));
      return { album, tracks, offset, total: page.total, next: offset + tracks.length < page.total ? offset + tracks.length : null };
    },
    createPlaylist: async (name, description = "") => {
      if (typeof name !== "string" || !name.trim() || name.trim().length > 200
          || typeof description !== "string" || description.length > 500) throw new Error("Inserisci nome e descrizione validi per la playlist Qobuz.");
      const playlist = qobuzPlaylist(await send("playlist/create", { data: { name: name.trim(), description, is_public: "false", is_collaborative: "false" } }));
      if (playlist.public) throw new Error("Qobuz ha creato una playlist pubblica: verifica lo stato remoto.");
      return playlist;
    },
    updatePlaylist: (value, name, description = "") => {
      if (typeof name !== "string" || !name.trim() || name.trim().length > 200
          || typeof description !== "string" || description.length > 500) throw new Error("Inserisci nome e descrizione validi per la playlist Qobuz.");
      return send("playlist/update", { data: { playlist_id: qobuzNumericId(value, "playlist"), name: name.trim(), description } });
    },
    deletePlaylist: (value) => send("playlist/delete", { data: { playlist_id: qobuzNumericId(value, "playlist") } }),
    addPlaylistTracks: (value, tracks) => {
      if (!Array.isArray(tracks) || !tracks.length || tracks.length > 100) throw new Error("Seleziona da 1 a 100 brani Qobuz.");
      return send("playlist/addTracks", { data: { playlist_id: qobuzNumericId(value, "playlist"),
        track_ids: tracks.map((id) => qobuzNumericId(id, "brano")).join(","), no_duplicate: "true" } });
    },
    removePlaylistTracks: (value, occurrences) => {
      if (!Array.isArray(occurrences) || !occurrences.length || occurrences.length > 100) throw new Error("Seleziona da 1 a 100 occorrenze della playlist.");
      const ids = occurrences.map((id) => qobuzNumericId(id, "occorrenza"));
      if (new Set(ids).size !== ids.length) throw new Error("Seleziona occorrenze distinte della playlist.");
      return send("playlist/deleteTracks", { data: { playlist_id: qobuzNumericId(value, "playlist"), playlist_track_ids: ids.join(",") } });
    },
    movePlaylistTracks: (value, occurrences, beginning, total) => {
      if (!Array.isArray(occurrences) || !occurrences.length || occurrences.length > 100)
        throw new Error("Seleziona da 1 a 100 occorrenze distinte della playlist.");
      const ids = occurrences.map((id) => qobuzNumericId(id, "occorrenza"));
      if (new Set(ids).size !== ids.length) throw new Error("Seleziona occorrenze distinte della playlist.");
      if (typeof beginning !== "boolean" || !Number.isSafeInteger(total) || total < ids.length || total >= Number.MAX_SAFE_INTEGER)
        throw new Error("Posizione playlist Qobuz non valida: rileggi la playlist.");
      return send("playlist/updateTracksPosition", { data: {
        playlist_id: qobuzNumericId(value, "playlist"), playlist_track_ids: ids.join(","),
        insert_before: beginning ? "0" : String(total + 1),
      } });
    },
    setFavorite: (id, favorite) => {
      if (typeof favorite !== "boolean") throw new Error("Operazione preferiti Qobuz non valida.");
      return send(favorite ? "favorite/create" : "favorite/delete",
        { data: { album_ids: qobuzAlbumId(id), artist_ids: "", track_ids: "" } });
    },
  };
}
