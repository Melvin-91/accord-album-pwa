import { createSpotifyJsonReader, createSpotifyTransport, spotifyAlbumSearchRecords, spotifyRedirectUriForPage } from "./core.mjs?v=54";
import { createMusicServiceGate, createTidalAuth, createTidalTransport, tidalAlbumRecords, tidalAlbumArtwork,
  tidalAlbumId, tidalResources } from "./tidal.mjs?v=17";
import { createQobuzClient, qobuzAlbumId, qobuzCredentials, qobuzCoverUrl } from "./qobuz.mjs?v=12";
import { abortable } from "./service-requests.mjs?v=4";
import { catalogTarget, readAlbumDuration } from "./music-completion.mjs?v=7";
import { catalogCriteriaMatch, catalogNameKey } from "./collection-qol.mjs?v=4";

const TIDAL_CLIENT = "accord-tidal-client-id-v1";
const QOBUZ_SESSION = "accord-qobuz-session-v1";
const SPOTIFY_KEYS = ["access-token", "refresh-token", "token-expires", "token-client-id"];
const AUTH_REVISION = "accord-music-auth-revision-v1";
const SAVED_ACCESS = new Set(["accord-tidal-token-v1", QOBUZ_SESSION,
  ...SPOTIFY_KEYS.map((key) => `accord-spotify-${key}`)]);
function spotifyCoverUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "scdn.co" || host.endsWith(".scdn.co")
      || host === "spotifycdn.com" || host.endsWith(".spotifycdn.com"))
      && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function tidalCoverUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "resources.tidal.com"
      && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function tidalArtistPhoto(artist, artworks) {
  const data = artist.relationships?.profileArt?.data;
  for (const ref of Array.isArray(data) ? data : data ? [data] : []) {
    if (ref?.type !== "artworks") continue;
    const files = artworks.get(ref.id)?.attributes?.files;
    if (!Array.isArray(files)) continue;
    for (const file of files) {
      const href = file?.href;
      if (typeof href !== "string" || href.includes("\\") || !href.startsWith("https://resources.tidal.com/images/")) continue;
      const url = new URL(href);
      if (url.pathname.startsWith("/images/") && !url.hash) return url.href;
    }
  }
  return null;
}
const random = (length) => base64url(crypto.getRandomValues(new Uint8Array(length)));
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function createCollectionServices({ storage, session: tabSession, pageUrl, fetch: request = globalThis.fetch,
  spotifyTiming = {} }) {
  for (const key of SAVED_ACCESS) {
    const previous = tabSession.getItem(key);
    if (previous !== null) {
      if (storage.getItem(key) === null) storage.setItem(key, previous);
      tabSession.removeItem(key);
    }
  }
  // Only credentials persist; OAuth state and PKCE verifiers remain tab-bound.
  const session = {
    getItem: (key) => (SAVED_ACCESS.has(key) ? storage : tabSession).getItem(key),
    setItem: (key, value) => (SAVED_ACCESS.has(key) ? storage : tabSession).setItem(key, value),
    removeItem(key) {
      if (SAVED_ACCESS.has(key)) storage.removeItem(key);
      tabSession.removeItem(key);
    },
  };
  const accountRevision = () => storage.getItem(AUTH_REVISION);
  const changeAccount = () => storage.setItem(AUTH_REVISION, random(16));
  const gate = createMusicServiceGate(storage);
  let spotifyRefreshing = null;
  const lock = (name, run, signal) => globalThis.navigator?.locks?.request
    ? signal ? navigator.locks.request(name, { signal }, run) : navigator.locks.request(name, run) : run();
  const tidal = createTidalTransport({ storage, fetch: request, active: () => gate.service === "tidal",
    revision: accountRevision, lock });
  const tidalAuth = createTidalAuth({ session, transport: tidal, scopes: "user.read search.read",
    revision: accountRevision });
  const spotify = createSpotifyTransport({ storage, fetch: request, lock, ...spotifyTiming });
  const spotifyReader = createSpotifyJsonReader();
  const coverUrls = new Map(), releaseMetadata = new Map();
  function tidalClientId() {
    let id = (storage.getItem(TIDAL_CLIENT) || "").trim();
    if (!id) {
      id = tidalAuth.clientId();
      if (id) storage.setItem(TIDAL_CLIENT, id);
    }
    return id;
  }
  function spotifySettings() {
    const clientId = (storage.getItem("accord-spotify-client-id") || "").trim();
    const expected = spotifyRedirectUriForPage(pageUrl);
    const saved = storage.getItem("accord-spotify-redirect-uri") || expected;
    const redirectUri = saved === new URL("index.html", expected).href ? expected : saved;
    if (redirectUri !== expected) throw new Error(`Redirect Spotify diverso da questa PWA. Usa ${expected}.`);
    return { clientId, redirectUri };
  }
  function clearSpotify() {
    spotifyReader.clear();
    SPOTIFY_KEYS.forEach((key) => session.removeItem(`accord-spotify-${key}`));
    ["oauth-state", "code-verifier", "oauth-redirect", "oauth-at", "oauth-client"]
      .forEach((key) => session.removeItem(`accord-spotify-${key}`));
  }
  function storeSpotify(value, clientId, revision) {
    if (revision !== accountRevision()) throw new Error("Account cambiato durante l'accesso Spotify.");
    if (typeof value.access_token !== "string" || !value.access_token
        || !Number.isFinite(value.expires_in) || value.expires_in <= 0) throw new Error("Sessione Spotify non valida.");
    session.setItem("accord-spotify-access-token", value.access_token);
    session.setItem("accord-spotify-token-expires", String(Date.now() + value.expires_in * 1000));
    session.setItem("accord-spotify-token-client-id", clientId);
    if (value.refresh_token) session.setItem("accord-spotify-refresh-token", value.refresh_token);
    return value.access_token;
  }
  async function spotifyToken(params, signal) {
    const response = await spotify.fetch("https://accounts.spotify.com/api/token", { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params),
      credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal }, false);
    if (!response.ok) throw new Error(`Accesso Spotify HTTP ${response.status}: ricollega nelle impostazioni.`);
    return abortable(response.json(), signal);
  }
  async function spotifyAccess(signal) {
    signal?.throwIfAborted();
    const { clientId } = spotifySettings(), bound = session.getItem("accord-spotify-token-client-id");
    if (bound && bound !== clientId) throw new Error("Client ID Spotify cambiato: ricollega l'account.");
    const access = session.getItem("accord-spotify-access-token");
    if (access && Number(session.getItem("accord-spotify-token-expires")) > Date.now() + 60_000) return access;
    const refresh = session.getItem("accord-spotify-refresh-token");
    if (!clientId || !refresh) throw new Error("Accesso Spotify non attivo: premi Collega Spotify nelle impostazioni.");
    if (!spotifyRefreshing) {
      const revision = accountRevision();
      spotifyRefreshing = spotifyToken({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId }, signal)
        .then((value) => { signal?.throwIfAborted(); return storeSpotify(value, clientId, revision); })
        .finally(() => { spotifyRefreshing = null; });
    }
    return abortable(spotifyRefreshing, signal);
  }
  async function spotifyRead(path, token, signal, duration = false) {
    const url = `https://api.spotify.com/v1/${path}`;
    return abortable(spotifyReader.read(url, token, async (etag) => {
      const response = await spotify.fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(etag ? { "If-None-Match": etag } : {}) },
        credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal }, true, null, { duration });
      if (!response.ok && response.status !== 304) {
        throw new Error(`Spotify HTTP ${response.status}. Verifica l'accesso nelle impostazioni.`);
      }
      return response;
    }), signal);
  }
  function qobuz(signal, allowed = () => gate.service === "qobuz") {
    const value = JSON.parse(session.getItem(QOBUZ_SESSION) || "null");
    if (!value) throw new Error("Collega Qobuz nelle impostazioni.");
    const revision = accountRevision(), epoch = gate.epoch;
    return createQobuzClient({ ...qobuzCredentials(value.appId, value.token), storage, fetch: request, lock, signal,
      active: () => revision === accountRevision() && gate.epoch === epoch && allowed() });
  }
  return {
    get provider() { return gate.service; },
    select(provider) { gate.select(provider); },
    settings(provider) {
      if (provider === "tidal") {
        const clientId = tidalClientId(), status = tidalAuth.status(clientId);
        return { clientId, connected: status.connected, text: status.connected ? "TIDAL collegato."
          : !clientId ? "Inserisci il Client ID, poi premi Collega TIDAL."
            : !status.matches && tidalAuth.clientId() ? "Client ID diverso: ricollega TIDAL."
              : status.expired ? "Accesso scaduto: ricollega TIDAL."
                : "Client ID salvato. Collega TIDAL." };
      }
      if (provider === "qobuz") {
        const connected = !!session.getItem(QOBUZ_SESSION);
        return { connected, text: connected ? "Qobuz collegato."
          : "Inserisci App ID e token di sessione, poi collega Qobuz." };
      }
      const settings = spotifySettings();
      const bound = session.getItem("accord-spotify-token-client-id");
      const connected = (!bound || bound === settings.clientId) && !!session.getItem("accord-spotify-access-token")
        && (Number(session.getItem("accord-spotify-token-expires")) > Date.now() + 60_000
          || !!session.getItem("accord-spotify-refresh-token"));
      return { ...settings, connected, text: connected ? "Spotify collegato."
        : settings.clientId ? "Client ID salvato. Collega Spotify."
          : "Inserisci il Client ID della tua applicazione Spotify." };
    },
    async connect(provider, values = {}) {
      gate.select(provider);
      if (provider === "qobuz") {
        const value = qobuzCredentials(values.appId.trim(), values.token.trim());
        const revision = accountRevision();
        const client = createQobuzClient({ ...value, storage, fetch: request, lock,
          active: () => accountRevision() === revision && gate.service === "qobuz" });
        await client.verifyAccess();
        changeAccount();
        session.setItem(QOBUZ_SESSION, JSON.stringify(value));
        return null;
      }
      const clientId = values.clientId.trim();
      if (!clientId) throw new Error("Inserisci il Client ID prima di collegare.");
      const key = provider === "tidal" ? TIDAL_CLIENT : "accord-spotify-client-id";
      if (storage.getItem(key) !== clientId) {
        changeAccount();
        if (provider === "tidal") tidalAuth.disconnect(); else clearSpotify();
      }
      storage.setItem(key, clientId);
      if (provider === "tidal") return tidalAuth.authorize(clientId, pageUrl);
      const { redirectUri } = spotifySettings(), verifier = random(64), state = random(32);
      session.setItem("accord-spotify-code-verifier", verifier);
      session.setItem("accord-spotify-oauth-state", state);
      session.setItem("accord-spotify-oauth-redirect", redirectUri);
      session.setItem("accord-spotify-oauth-client", clientId);
      session.setItem("accord-spotify-oauth-at", String(Date.now()));
      const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      const url = new URL("https://accounts.spotify.com/authorize");
      url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri,
        state, code_challenge_method: "S256", code_challenge: challenge });
      return url.href;
    },
    disconnect(provider) {
      changeAccount();
      if (provider === "tidal") tidalAuth.disconnect();
      else if (provider === "qobuz") session.removeItem(QOBUZ_SESSION);
      else clearSpotify();
    },
    async finish(url) {
      const callback = new URL(url);
      if (!callback.searchParams.has("code") && !callback.searchParams.has("error")) return false;
      if (callback.searchParams.get("state")?.startsWith("tidal.")) {
        gate.select("tidal");
        const result = await tidalAuth.finish(url, storage.getItem(TIDAL_CLIENT)?.trim() || null);
        tidalClientId();
        return result;
      }
      const state = session.getItem("accord-spotify-oauth-state");
      const verifier = session.getItem("accord-spotify-code-verifier");
      const redirect = session.getItem("accord-spotify-oauth-redirect");
      const at = Number(session.getItem("accord-spotify-oauth-at"));
      const clientId = session.getItem("accord-spotify-oauth-client") || spotifySettings().clientId;
      ["oauth-state", "code-verifier", "oauth-redirect", "oauth-at", "oauth-client"]
        .forEach((key) => session.removeItem(`accord-spotify-${key}`));
      const clean = new URL(callback); clean.search = ""; clean.hash = "";
      if (!state || !verifier || state !== callback.searchParams.get("state") || redirect !== clean.href
          || at && (Date.now() - at > 600_000 || at > Date.now())) throw new Error("Verifica OAuth Spotify non riuscita. Ricollega l'account.");
      if (callback.searchParams.has("error")) throw new Error("Autorizzazione Spotify annullata.");
      if (!callback.searchParams.get("code") || clientId !== spotifySettings().clientId) throw new Error("Codice OAuth o Client ID Spotify non valido.");
      gate.select("spotify");
      const revision = accountRevision();
      storeSpotify(await spotifyToken({ grant_type: "authorization_code", code: callback.searchParams.get("code"),
        client_id: clientId, code_verifier: verifier, redirect_uri: redirect }), clientId, revision);
      return true;
    },
    async search(query, { signal: externalSignal, reference, criteria, chooseArtists, withCompleteness = false } = {}) {
      query = query.trim();
      if (!query || query.length > 100) throw new Error("Inserisci titolo, artista o link album (massimo 100 caratteri).");
      const requestSignal = () => {
        const timeout = AbortSignal.timeout(45_000);
        return externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
      };
      let signal = requestSignal();
      signal.throwIfAborted();
      const provider = gate.service, epoch = gate.epoch, revision = accountRevision();
      const direct = reference ?? (/^https:/i.test(query) || new RegExp(`^${provider}:`, "i").test(query)
        || provider === "tidal" && /^\d+$/.test(query));
      let records, complete = true, byTidalArtist = false;
      coverUrls.clear();
      releaseMetadata.clear();
      if (provider === "qobuz") {
        const id = direct ? qobuzAlbumId(query) : null;
        const client = qobuz(signal);
        const page = id ? null : await client.search(query);
        const rows = id ? [await client.album(id)] : page.rows;
        complete = id !== null || page.next === null;
        records = rows.map((row) => {
          if (row.coverUrl) coverUrls.set(row.album.id, qobuzCoverUrl(row.coverUrl));
          releaseMetadata.set(row.album.id, row.edition || {});
          return row.album;
        });
      } else if (provider === "tidal") {
        const id = direct ? tidalAlbumId(query) : null;
        const token = await tidalAuth.access(tidalClientId(), { signal });
        const profile = await tidal.request("users/me", token, { signal }), countryCode = profile.data?.attributes?.country;
        if (!/^[A-Z]{2}$/.test(countryCode || "")) throw new Error("Paese dell'account TIDAL non verificabile.");
        const include = "albums.artists,albums.coverArt";
        const limits = { maxPages: 12, maxItems: 500 };
        byTidalArtist = !direct && Boolean(criteria?.artist);
        let paths;
        if (byTidalArtist) {
          const path = await tidal.searchPath(criteria.artist, "artists", token, {
            countryCode, include: "artists,artists.profileArt", signal });
          const page = await tidal.pages(path, token, { ...limits, signal });
          const key = catalogNameKey(criteria.artist);
          const artistIds = new Set(page.documents.flatMap(({ data }) => data).slice(0, limits.maxItems).map((row) => {
            if (row?.type !== "artists") throw new Error("Risultati artista TIDAL non validi.");
            return tidalAlbumId(row.id);
          }));
          const resources = tidalResources(page.documents);
          const artists = resources.filter((row) => row.type === "artists" && artistIds.has(row.id));
          if (artists.some((row) => typeof row.attributes?.name !== "string" || !row.attributes.name.trim())) {
            throw new Error("Metadati degli artisti TIDAL incompleti.");
          }
          const complete = page.complete && page.count <= limits.maxItems;
          const exact = artists.filter((row) => catalogNameKey(row.attributes.name) === key);
          const similar = artists.filter((row) => {
            const name = catalogNameKey(row.attributes.name);
            return key && name !== key && name.includes(key);
          });
          const matches = exact.length ? exact : similar;
          let selected = matches.map(({ id }) => id);
          if (!complete && !matches.length) {
            throw new Error("Nessuna corrispondenza tra le pagine artista lette. L'elenco TIDAL è parziale.");
          }
          if (matches.length > 5 || !complete) {
            signal.throwIfAborted();
            const artworks = new Map(resources.filter((row) => row.type === "artworks").map((row) => [row.id, row]));
            const candidates = [...exact, ...similar].map((artist) => ({
              id: artist.id, name: artist.attributes.name, photoUrl: tidalArtistPhoto(artist, artworks),
            }));
            if (!chooseArtists) throw new Error("Seleziona gli artisti prima di leggere le discografie TIDAL.");
            const allowed = new Set(candidates.map(({ id }) => id));
            const selection = await chooseArtists(candidates, { complete });
            externalSignal?.throwIfAborted();
            gate.assert(provider, epoch);
            if (revision !== accountRevision()) throw new Error("Account cambiato: risultati scartati.");
            if (!Array.isArray(selection) || !selection.length || selection.length > 5
                || new Set(selection).size !== selection.length || selection.some((id) => !allowed.has(id))) {
              throw new Error("Selezione degli artisti TIDAL non valida.");
            }
            selected = selection;
            signal = requestSignal();
          }
          paths = selected.map((id) =>
            `artists/${id}/relationships/albums?${new URLSearchParams({ countryCode, include })}`);
        } else {
          paths = [id ? `albums?${new URLSearchParams({ "filter[id]": id, countryCode, include: "artists" })}`
            : await tidal.searchPath(query, "albums", token, { countryCode, include, signal })];
        }
        const documents = [];
        for (const path of paths) {
          const page = await tidal.pages(path, token,
            byTidalArtist ? { ...limits, signal } : { maxPages: 1, maxItems: 50, signal });
          if (byTidalArtist && !page.complete) {
            throw new Error("Discografia TIDAL non completa: raggiunto il limite di lettura.");
          }
          complete &&= page.complete;
          documents.push(...page.documents);
        }
        const ids = [...new Set(documents.flatMap(({ data }) => Array.isArray(data) ? data : [data])
          .map((row) => {
            if (row?.type !== "albums") throw new Error("Risultati album TIDAL non validi.");
            return tidalAlbumId(row.id);
          }))];
        const present = new Set(tidalAlbumRecords(documents).map((album) => album.id.slice(6)));
        const missing = ids.filter((id) => !present.has(id));
        for (let start = 0; start < missing.length; start += 20) {
          const params = new URLSearchParams({ "filter[id]": missing.slice(start, start + 20).join(","),
            countryCode, include: "artists,coverArt" });
          documents.push(await tidal.request(`albums?${params}`, token, { signal }));
        }
        const wanted = new Set(ids.map((id) => `tidal:${id}`));
        records = tidalAlbumRecords(documents).filter((album) => wanted.has(album.id));
        for (const resource of tidalResources(documents).filter((item) => item.type === "albums")) {
          releaseMetadata.set(`tidal:${resource.id}`, { album_type: resource.attributes?.albumType,
            track_count: resource.attributes?.numberOfTracks, duration_iso: resource.attributes?.duration });
        }
        for (const [id, url] of tidalAlbumArtwork(documents)) coverUrls.set(id, url);
        if (records.length !== wanted.size) {
          throw new Error("Metadati degli album TIDAL incompleti. Nessun album aggiunto: riprova la ricerca o il link.");
        }
      } else {
        let id = null;
        if (direct) {
          const identifier = query.match(/^(?:spotify:album:)?([A-Za-z0-9]{22})$/);
          if (identifier) id = identifier[1];
          else if (URL.canParse(query)) {
            const url = new URL(query);
            id = url.protocol === "https:" && url.host === "open.spotify.com" && !url.username && !url.password
              ? url.pathname.match(/^\/(?:intl-[a-z]+\/)?album\/([A-Za-z0-9]{22})$/)?.[1] : null;
          }
          if (!id) throw new Error("Link album Spotify non valido.");
        }
        const token = await spotifyAccess(signal);
        const scopedQuery = !direct && criteria
          ? [["artist", criteria.artist], ["album", criteria.title]].filter(([, term]) => term)
            .map(([field, term]) => `${field}:${JSON.stringify(term)}`).join(" ")
          : query;
        const result = await spotifyRead(id ? `albums/${id}` : `search?${new URLSearchParams({ q: scopedQuery, type: "album", limit: "30" })}`, token, signal);
        if (!id && !Array.isArray(result.albums?.items)) throw new Error("Ricerca Spotify non leggibile.");
        const entries = id ? [result] : result.albums.items;
        complete = id !== null || Number.isSafeInteger(result.albums.total)
          && result.albums.total === entries.length && !result.albums.next;
        for (const entry of entries) {
          releaseMetadata.set(entry.id, { album_type: entry.album_type, total_tracks: entry.total_tracks });
          const image = (Array.isArray(entry.images) ? entry.images : [])
            .filter((item) => spotifyCoverUrl(item?.url))
            .sort((a, b) => Math.abs((a.width || 300) - 300) - Math.abs((b.width || 300) - 300))[0];
          if (image) coverUrls.set(entry.id, spotifyCoverUrl(image.url));
        }
        records = spotifyAlbumSearchRecords(entries.map((album) => ({ item: { type: "track", album } })));
      }
      signal.throwIfAborted();
      gate.assert(provider, epoch);
      if (revision !== accountRevision()) throw new Error("Account cambiato: risultati scartati.");
      const albums = !direct && criteria ? records.filter((album) =>
        catalogCriteriaMatch(album, byTidalArtist ? { title: criteria.title } : criteria)) : records;
      return withCompleteness ? { albums, complete } : albums;
    },
    coverUrl(album) {
      const url = coverUrls.get(album?.id);
      if (!url) return null;
      return album.id.startsWith("tidal:") ? tidalCoverUrl(url)
        : album.id.startsWith("qobuz:") ? qobuzCoverUrl(url) : spotifyCoverUrl(url);
    },
    releaseMetadata(album) { return releaseMetadata.get(album?.id) || {}; },
    async albumDuration(album, { signal: externalSignal, withProvenance = false, provider: requestedProvider } = {}) {
      const selected = gate.service, epoch = gate.epoch, revision = accountRevision();
      const primary = requestedProvider || selected;
      if (!["spotify", "tidal", "qobuz"].includes(primary)) throw new Error("Servizio musicale non valido.");
      const candidates = [...new Set([primary, ...["spotify", "tidal", "qobuz"].filter((service) =>
        catalogTarget(storage, album, service) === album.id), "tidal", "qobuz", "spotify"])]
        .map((service) => [service, catalogTarget(storage, album, service)]).filter(([, id]) => id);
      if (!candidates.length) throw new Error("Nessuna edizione identificata per recuperare la durata.");
      const attempts = candidates.slice(0, candidates[0][0] === primary ? 2 : 1);
      const attempted = [];
      let missingEdition;
      for (const [index, [provider, target]] of attempts.entries()) {
        attempted.push(provider);
        try {
          return await read(provider, target);
        } catch (error) {
          if (index + 1 === attempts.length || error !== missingEdition) {
            error.durationAttempts = [...attempted];
            throw error;
          }
          missingEdition = error;
        }
      }

      async function read(provider, target) {
        const timeout = AbortSignal.timeout(provider === "spotify" ? 1_800_000 : 90_000);
        const signal = externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
        const guard = () => {
          signal.throwIfAborted();
          gate.assert(selected, epoch);
          if (revision !== accountRevision()) throw new Error("Account cambiato: durata scartata.");
          if (catalogTarget(storage, album, provider) !== target) throw new Error("Associazione edizione cambiata: durata scartata.");
        };
        guard();
        let api;
        if (provider === "qobuz") {
          api = qobuz(signal, () => !signal.aborted && gate.service === selected);
        } else if (provider === "spotify") {
          const token = await spotifyAccess(signal);
          api = { request: async (path) => { guard(); const result = await spotifyRead(path, token, signal, true); guard(); return result; } };
        } else {
          const transport = provider === selected ? tidal : createTidalTransport({
            storage, fetch: request, lock, revision: accountRevision,
            active: () => !signal.aborted && gate.service === selected && gate.epoch === epoch,
          });
          const token = await tidalAuth.access(tidalClientId(), { signal });
          guard();
          const profile = await transport.request("users/me", token, { signal });
          const country = profile.data?.attributes?.country;
          if (!/^[A-Z]{2}$/.test(country || "")) throw new Error("Paese dell'account TIDAL non verificabile.");
          api = { completionPage: async (path) => {
            guard();
            const url = new URL(path, "https://openapi.tidal.com/v2/");
            url.searchParams.set("countryCode", country);
            const result = await transport.request(url.href, token, { signal });
            guard();
            return result;
          } };
        }
        guard();
        let result;
        try {
          result = await readAlbumDuration(provider, api, target, { signal, maxReads: 20 });
        } catch (error) {
          guard();
          if (/\bHTTP 404\b/.test(error.message)) missingEdition = error;
          throw error;
        }
        guard();
        return withProvenance ? { duration: result.duration, provenance: { source: provider, target,
          identity: [album.id, album.artist, album.name], complete_tracks: result.total,
          updated: new Date().toISOString(), duration_ms: result.duration } } : result.duration;
      }
    },
  };
}
