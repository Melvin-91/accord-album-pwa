import { createSpotifyTransport, spotifyAlbumSearchRecords, spotifyRedirectUriForPage } from "./core.mjs?v=51";
import { createMusicServiceGate, createTidalAuth, createTidalTransport, tidalAlbumRecords, tidalAlbumId } from "./tidal.mjs?v=14";
import { createQobuzClient, qobuzCredentials } from "./qobuz.mjs?v=11";

const TIDAL_CLIENT = "accord-tidal-client-id-v1";
const QOBUZ_SESSION = "accord-qobuz-session-v1";
const SPOTIFY_KEYS = ["access-token", "refresh-token", "token-expires", "token-client-id"];
const random = (length) => base64url(crypto.getRandomValues(new Uint8Array(length)));
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function createCollectionServices({ storage, session, pageUrl, fetch: request = globalThis.fetch }) {
  const gate = createMusicServiceGate(storage);
  let accountRevision = 0, spotifyRefreshing = null;
  const lock = (name, run) => globalThis.navigator?.locks?.request ? navigator.locks.request(name, run) : run();
  const tidal = createTidalTransport({ storage, fetch: request, active: () => gate.service === "tidal",
    revision: () => accountRevision, lock });
  const tidalAuth = createTidalAuth({ session, transport: tidal, scopes: "user.read search.read" });
  const spotify = createSpotifyTransport({ storage, fetch: request, lock });
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
    SPOTIFY_KEYS.forEach((key) => session.removeItem(`accord-spotify-${key}`));
    ["oauth-state", "code-verifier", "oauth-redirect", "oauth-at", "oauth-client"]
      .forEach((key) => session.removeItem(`accord-spotify-${key}`));
  }
  function storeSpotify(value, clientId, revision) {
    if (revision !== accountRevision) throw new Error("Account cambiato durante l'accesso Spotify.");
    if (typeof value.access_token !== "string" || !value.access_token
        || !Number.isFinite(value.expires_in) || value.expires_in <= 0) throw new Error("Sessione Spotify non valida.");
    session.setItem("accord-spotify-access-token", value.access_token);
    session.setItem("accord-spotify-token-expires", String(Date.now() + value.expires_in * 1000));
    session.setItem("accord-spotify-token-client-id", clientId);
    if (value.refresh_token) session.setItem("accord-spotify-refresh-token", value.refresh_token);
    return value.access_token;
  }
  async function spotifyToken(params) {
    const response = await spotify.fetch("https://accounts.spotify.com/api/token", { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params),
      credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" }, false);
    if (!response.ok) throw new Error(`Accesso Spotify HTTP ${response.status}: ricollega nelle impostazioni.`);
    return response.json();
  }
  async function spotifyAccess() {
    const { clientId } = spotifySettings(), bound = session.getItem("accord-spotify-token-client-id");
    if (bound && bound !== clientId) throw new Error("Client ID Spotify cambiato: ricollega l'account.");
    const access = session.getItem("accord-spotify-access-token");
    if (access && Number(session.getItem("accord-spotify-token-expires")) > Date.now() + 60_000) return access;
    const refresh = session.getItem("accord-spotify-refresh-token");
    if (!clientId || !refresh) throw new Error("Accesso Spotify non attivo in questa scheda: premi Collega Spotify nelle impostazioni.");
    if (!spotifyRefreshing) {
      const revision = accountRevision;
      spotifyRefreshing = spotifyToken({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId })
        .then((value) => storeSpotify(value, clientId, revision)).finally(() => { spotifyRefreshing = null; });
    }
    return spotifyRefreshing;
  }
  async function spotifyRead(path, token) {
    const response = await spotify.fetch(`https://api.spotify.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" }, true);
    if (!response.ok) throw new Error(`Spotify HTTP ${response.status}. Verifica l'accesso nelle impostazioni.`);
    return response.json();
  }
  function qobuz() {
    const value = JSON.parse(session.getItem(QOBUZ_SESSION) || "null");
    if (!value) throw new Error("Collega Qobuz nelle impostazioni.");
    const revision = accountRevision, epoch = gate.epoch;
    return createQobuzClient({ ...qobuzCredentials(value.appId, value.token), storage, fetch: request, lock,
      active: () => revision === accountRevision && gate.epoch === epoch && gate.service === "qobuz" });
  }
  return {
    get provider() { return gate.service; },
    select(provider) { gate.select(provider); },
    settings(provider) {
      if (provider === "tidal") {
        const clientId = tidalClientId(), status = tidalAuth.status(clientId);
        return { clientId, connected: status.connected, text: status.connected ? "TIDAL collegato in questa scheda."
          : !clientId ? "Inserisci il Client ID, poi premi Collega TIDAL."
            : !status.matches && tidalAuth.clientId() ? "Client ID diverso dalla sessione: ricollega TIDAL."
              : status.expired ? "Accesso scaduto: ricollega TIDAL. Il Client ID e' gia' salvato."
                : "Client ID salvato. Premi Collega TIDAL per autorizzare questa scheda." };
      }
      if (provider === "qobuz") {
        const connected = !!session.getItem(QOBUZ_SESSION);
        return { connected, text: connected ? "Sessione Qobuz salvata in questa scheda."
          : "Inserisci App ID e token della sessione web Qobuz, poi verifica l'accesso." };
      }
      const settings = spotifySettings();
      const bound = session.getItem("accord-spotify-token-client-id");
      const connected = (!bound || bound === settings.clientId) && !!session.getItem("accord-spotify-access-token")
        && (Number(session.getItem("accord-spotify-token-expires")) > Date.now() + 60_000
          || !!session.getItem("accord-spotify-refresh-token"));
      return { ...settings, connected, text: connected ? "Spotify collegato in questa scheda."
        : settings.clientId ? "Client ID salvato. Premi Collega Spotify per autorizzare questa scheda."
          : "Inserisci il Client ID della tua applicazione Spotify." };
    },
    async connect(provider, values = {}) {
      gate.select(provider);
      if (provider === "qobuz") {
        const value = qobuzCredentials(values.appId.trim(), values.token.trim());
        const revision = accountRevision;
        const client = createQobuzClient({ ...value, storage, fetch: request, lock,
          active: () => accountRevision === revision && gate.service === "qobuz" });
        await client.verifyAccess();
        accountRevision += 1;
        session.setItem(QOBUZ_SESSION, JSON.stringify(value));
        return null;
      }
      const clientId = values.clientId.trim();
      if (!clientId) throw new Error("Inserisci il Client ID prima di collegare.");
      const key = provider === "tidal" ? TIDAL_CLIENT : "accord-spotify-client-id";
      if (storage.getItem(key) !== clientId) {
        accountRevision += 1;
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
      accountRevision += 1;
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
      const revision = accountRevision;
      storeSpotify(await spotifyToken({ grant_type: "authorization_code", code: callback.searchParams.get("code"),
        client_id: clientId, code_verifier: verifier, redirect_uri: redirect }), clientId, revision);
      return true;
    },
    async search(query) {
      query = query.trim();
      if (!query || query.length > 100) throw new Error("Inserisci titolo, artista o link album (massimo 100 caratteri).");
      const provider = gate.service, epoch = gate.epoch, revision = accountRevision;
      let records;
      if (provider === "qobuz") {
        const client = qobuz();
        records = /^https:|^qobuz:/i.test(query) ? [(await client.album(query)).album]
          : (await client.search(query)).rows.map((row) => row.album);
      } else if (provider === "tidal") {
        const token = await tidalAuth.access(tidalClientId());
        const profile = await tidal.request("users/me", token), countryCode = profile.data?.attributes?.country;
        if (!/^[A-Z]{2}$/.test(countryCode || "")) throw new Error("Paese dell'account TIDAL non verificabile.");
        const include = "albums.artists";
        const path = /^https:|^tidal:|^\d+$/i.test(query)
          ? `albums?${new URLSearchParams({ "filter[id]": tidalAlbumId(query), countryCode, include: "artists" })}`
          : await tidal.searchPath(query, "albums", token, { countryCode, include });
        const page = await tidal.pages(path, token, { maxPages: 1, maxItems: 50 });
        records = tidalAlbumRecords(page.documents);
      } else {
        const token = await spotifyAccess();
        let id = null;
        if (/^https:|^spotify:/i.test(query)) {
          const uri = query.match(/^spotify:album:([A-Za-z0-9]{22})$/);
          if (uri) id = uri[1];
          else {
            const url = new URL(query);
            id = url.protocol === "https:" && url.host === "open.spotify.com" && !url.username && !url.password
              ? url.pathname.match(/^\/(?:intl-[a-z]+\/)?album\/([A-Za-z0-9]{22})$/)?.[1] : null;
          }
          if (!id) throw new Error("Link album Spotify non valido.");
        }
        const result = await spotifyRead(id ? `albums/${id}` : `search?${new URLSearchParams({ q: query, type: "album", limit: "30" })}`, token);
        if (!id && !Array.isArray(result.albums?.items)) throw new Error("Ricerca Spotify non leggibile.");
        records = spotifyAlbumSearchRecords(id ? [result] : result.albums.items);
      }
      gate.assert(provider, epoch);
      if (revision !== accountRevision) throw new Error("Account cambiato: risultati scartati.");
      return records;
    },
  };
}
