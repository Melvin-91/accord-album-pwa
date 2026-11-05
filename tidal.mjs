// Only the THIRD_PARTY operations in the official TIDAL OpenAPI are exposed.
export const TIDAL_API = "https://openapi.tidal.com/v2/";
export const TIDAL_SCOPES = "user.read search.read collection.read collection.write playlists.read playlists.write recommendations.read";
const COOLDOWN = "accord-tidal-cooldown-until-v1";
const PENDING = "accord-tidal-pkce-v1";
const TOKEN = "accord-tidal-token-v1";
export function createMusicServiceGate(storage) {
  let service = storage.getItem("accord-music-service-v1") === "tidal" ? "tidal" : "spotify", epoch = 0;
  return {
    get service() { return service; },
    get epoch() { return epoch; },
    select(value) {
      if (!["spotify", "tidal"].includes(value)) throw new Error("Servizio musicale non valido.");
      if (value !== service) { service = value; epoch += 1; }
      storage.setItem("accord-music-service-v1", value);
    },
    assert(value, expectedEpoch = epoch) {
      if (service !== value || expectedEpoch !== epoch) throw new Error("Servizio musicale cambiato: operazione scartata.");
    },
  };
}
const PUBLIC_PATHS = [
  [/^(albums|artists|tracks)\/[1-9][0-9]*$/, ["GET"]],
  [/^albums\/[1-9][0-9]*\/relationships\/(artists|coverArt|items|similarAlbums)$/, ["GET"]],
  [/^artists\/[1-9][0-9]*\/relationships\/(albums|similarArtists)$/, ["GET"]],
  [/^tracks\/[1-9][0-9]*\/relationships\/(albums|artists|similarTracks)$/, ["GET"]],
  [/^users\/me$/, ["GET"]],
  [/^searchResults(?:\/[^/]+\/relationships\/(albums|artists|tracks|playlists))?$/, ["GET"]],
  [/^userCollectionAlbums\/me$/, ["GET"]],
  [/^userCollectionAlbums\/me\/relationships\/items$/, ["GET", "POST", "DELETE"]],
  [/^playlists$/, ["GET", "POST"]],
  [/^playlists\/[A-Za-z0-9-]+$/, ["GET", "PATCH", "DELETE"]],
  [/^playlists\/[A-Za-z0-9-]+\/relationships\/items$/, ["GET", "POST", "PATCH", "DELETE"]],
  [/^user(Daily|Discovery|NewRelease)Mixes\/me(?:\/relationships\/items)?$/, ["GET"]],
];

export function tidalApiUrl(path, method = "GET") {
  const url = new URL(path, TIDAL_API);
  const resource = url.pathname.slice("/v2/".length);
  if (url.origin !== new URL(TIDAL_API).origin || !url.pathname.startsWith("/v2/")
      || url.username || url.password || url.hash
      || !PUBLIC_PATHS.some(([pattern, methods]) => pattern.test(resource) && methods.includes(method))) {
    throw new Error("Operazione TIDAL non supportata dall’API pubblica.");
  }
  return url;
}

export function tidalAlbumId(value) {
  const text = String(value || "").trim();
  if (/^(?:tidal:)?[1-9][0-9]*$/.test(text)) return text.replace(/^tidal:/, "");
  const url = new URL(text);
  const match = url.pathname.match(/^\/(?:browse\/)?album\/([1-9][0-9]*)\/?$/);
  if (url.protocol !== "https:" || !["tidal.com", "www.tidal.com"].includes(url.host)
      || url.username || url.password || !match) throw new Error("Link album TIDAL non valido.");
  return match[1];
}

export function tidalPlaylistId(value) {
  const text = String(value || "").trim();
  if (/^[A-Za-z0-9-]+$/.test(text)) return text;
  const url = new URL(text);
  const match = url.pathname.match(/^\/(?:browse\/)?playlist\/([A-Za-z0-9-]+)\/?$/);
  if (url.protocol !== "https:" || !["tidal.com", "www.tidal.com"].includes(url.host)
      || url.username || url.password || !match) throw new Error("Link playlist TIDAL non valido.");
  return match[1];
}

export function createTidalTransport({
  fetch: request = (...args) => globalThis.fetch(...args), storage, writeStorage = storage,
  now = () => Date.now(), active = () => true, lock = (_name, run) => run(),
} = {}) {
  const cache = new Map(), pending = new Map(), writes = new Set();
  let queue = Promise.resolve();
  function guard() {
    if (!active()) throw new Error("TIDAL non è il servizio selezionato.");
    const remaining = Number(storage?.getItem(COOLDOWN) || 0) - now();
    if (remaining > 0) throw new Error(`TIDAL: attendi ${Math.ceil(remaining / 1000)} secondi (Retry-After).`);
  }
  async function response(url, options, beforeSend) {
    const queued = queue.then(() => lock("accord-tidal-request-v1", async () => {
      guard();
      beforeSend?.();
      const result = await request(url, { ...options, redirect: "error", credentials: "omit",
        referrerPolicy: "no-referrer", cache: "no-store" });
      if (result.status === 429) {
        const retry = result.headers.get("Retry-After");
        const until = retry && /^\s*\d+(?:\.\d+)?\s*$/.test(retry)
          ? now() + Number(retry) * 1000 : Date.parse(retry || "");
        storage?.setItem(COOLDOWN, String(Math.max(Number(storage?.getItem(COOLDOWN) || 0),
          Number.isFinite(until) && until > now() ? until : now() + 60_000)));
      }
      if (!active()) throw new Error("Servizio cambiato: risposta TIDAL scartata.");
      return result;
    }));
    queue = queued.catch(() => {});
    return queued;
  }
  async function requestJson(path, token, { method = "GET", body } = {}) {
    const url = tidalApiUrl(path, method).href;
    guard();
    const key = `${token}|${url}`;
    if (method === "GET" && pending.has(key)) return pending.get(key);
    const task = async () => {
      const entry = cache.get(key);
      if (method === "GET" && entry && entry.until > now()) return structuredClone(entry.data);
      const headers = { Accept: "application/vnd.api+json", Authorization: `Bearer ${token}` };
      if (body !== undefined) headers["Content-Type"] = "application/vnd.api+json";
      if (method === "GET" && entry?.etag) headers["If-None-Match"] = entry.etag;
      const fingerprint = method === "GET" ? "" : base64url(new Uint8Array(await globalThis.crypto.subtle.digest(
        "SHA-256", new TextEncoder().encode(`${method}|${url}|${JSON.stringify(body)}`))));
      const writeKey = `accord-tidal-write-v1:${fingerprint}`;
      const lastWriteKey = `accord-tidal-last-write-v1:${url}`;
      if (method !== "GET") {
        if (writes.has(fingerprint) || writeStorage?.getItem(writeKey)
            || writeStorage?.getItem(lastWriteKey) === fingerprint) {
          throw new Error("Scrittura già inviata o dall’esito incerto: verifica prima lo stato remoto. Nessun nuovo invio.");
        }
        writes.add(fingerprint);
      }
      let result;
      try {
        result = await response(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
          method === "GET" ? null : () => {
            if (writeStorage?.getItem(writeKey) || writeStorage?.getItem(lastWriteKey) === fingerprint) {
              throw new Error("Scrittura TIDAL già inviata da un’altra operazione: verifica lo stato remoto.");
            }
            writeStorage?.setItem(writeKey, "pending");
          });
      } catch (error) {
        if (method !== "GET") {
          writeStorage?.setItem(writeKey, "uncertain");
          throw new Error(`Esito TIDAL incerto: verifica lo stato remoto; non ripetere la scrittura. ${error.message}`);
        }
        throw error;
      }
      if (method !== "GET") {
        cache.clear();
        if (result.ok) {
          writes.delete(fingerprint);
          writeStorage?.removeItem(writeKey);
          writeStorage?.setItem(lastWriteKey, fingerprint);
        } else if (result.status < 500) {
          writes.delete(fingerprint);
          writeStorage?.removeItem(writeKey);
        }
        else writeStorage?.setItem(writeKey, "uncertain");
      }
      if (!result.ok && result.status !== 304) {
        const suffix = method !== "GET" && result.status >= 500 ? " Esito incerto: non ripetere la scrittura." : "";
        throw new Error(`TIDAL HTTP ${result.status}.${result.status === 429 ? " Cooldown Retry-After condiviso attivo." : ""}${suffix}`);
      }
      if (result.status === 204) return {};
      if (result.status === 304 && !entry) throw new Error("TIDAL: risposta 304 senza cache.");
      const data = result.status === 304 ? entry.data : await result.json();
      if (method === "GET") {
        const policy = result.headers.get("Cache-Control") || entry?.policy || "";
        const maxAge = /(?:^|,)\s*max-age="?(\d+)"?/i.exec(policy);
        const date = Date.parse(result.headers.get("Date") || "");
        const age = Math.max(0, Number(result.headers.get("Age") || 0) * 1000,
          Number.isFinite(date) ? now() - date : 0);
        if (!/\bno-store\b/i.test(policy)) cache.set(key, {
          data, policy, etag: result.headers.get("ETag") || entry?.etag,
          until: now() + (/\bno-cache\b/i.test(policy) ? 0 : Math.max(0, Number(maxAge?.[1] || 0) * 1000 - age)),
        });
        else cache.delete(key);
        while (cache.size > 256) cache.delete(cache.keys().next().value);
      }
      return structuredClone(data);
    };
    if (method !== "GET") return task();
    const promise = task().finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }
  return {
    request: requestJson,
    async token(parameters) {
      const result = await response("https://auth.tidal.com/v1/oauth2/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(parameters),
      });
      if (!result.ok) throw new Error(`Autorizzazione TIDAL HTTP ${result.status}.`);
      return result.json();
    },
    clear() { cache.clear(); },
    async pages(path, token, { maxPages = 5, maxItems = 250 } = {}) {
      const documents = [], seen = new Set();
      let next = tidalApiUrl(path).href, complete = true, count = 0;
      const pathname = new URL(next).pathname;
      while (next) {
        const url = tidalApiUrl(next);
        if (url.pathname !== pathname || seen.has(url.href)) throw new Error("Paginazione TIDAL non sicura o ciclica.");
        seen.add(url.href);
        const document = await requestJson(url.href, token);
        const size = Array.isArray(document.data) ? document.data.length : document.data ? 1 : 0;
        documents.push(document);
        count += size;
        const link = document.links?.next;
        next = typeof link === "string" ? link : link?.href;
        if (next) next = new URL(next, url).href;
        if (next && (documents.length >= maxPages || count >= maxItems)) { complete = false; break; }
      }
      return { documents, complete, count };
    },
  };
}

const base64url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function createTidalAuth({ session, transport, crypto = globalThis.crypto, now = () => Date.now() }) {
  let refreshing = null;
  function store(value, clientId) {
    if (typeof value.access_token !== "string" || !value.access_token
        || !Number.isFinite(value.expires_in) || value.expires_in <= 0) throw new Error("Token TIDAL non valido.");
    session.setItem(TOKEN, JSON.stringify({ ...value, clientId, expires: now() + value.expires_in * 1000 }));
    transport.clear();
    return value.access_token;
  }
  return {
    async authorize(clientId, pageUrl) {
      if (!String(clientId).trim()) throw new Error("Configura il Client ID TIDAL.");
      const redirect = new URL(pageUrl);
      redirect.search = ""; redirect.hash = "";
      if (redirect.protocol !== "https:" && !(redirect.protocol === "http:"
          && ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname))) throw new Error("OAuth TIDAL richiede HTTPS o localhost.");
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
      const state = `tidal.${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
      const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      session.setItem(PENDING, JSON.stringify({ state, verifier, redirect: redirect.href, clientId, at: now() }));
      const url = new URL("https://login.tidal.com/authorize");
      url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect.href,
        code_challenge_method: "S256", code_challenge: challenge, scope: TIDAL_SCOPES, state });
      return url.href;
    },
    async finish(pageUrl) {
      const url = new URL(pageUrl), state = url.searchParams.get("state") || "";
      if (!state.startsWith("tidal.")) return false;
      const saved = JSON.parse(session.getItem(PENDING) || "null");
      session.removeItem(PENDING);
      const clean = new URL(url); clean.search = ""; clean.hash = "";
      if (!saved || saved.state !== state || saved.redirect !== clean.href
          || now() - saved.at > 10 * 60_000 || now() < saved.at) throw new Error("Vérifica state OAuth TIDAL non riuscita.");
      if (url.searchParams.has("error")) throw new Error("Autorizzazione TIDAL annullata; nessuna operazione eseguita.");
      const code = url.searchParams.get("code");
      if (!code) throw new Error("Codice OAuth TIDAL mancante.");
      store(await transport.token({ grant_type: "authorization_code", client_id: saved.clientId,
        redirect_uri: saved.redirect, code_verifier: saved.verifier, code }), saved.clientId);
      return true;
    },
    async access(clientId) {
      const saved = JSON.parse(session.getItem(TOKEN) || "null");
      if (!saved) throw new Error("Collega prima TIDAL con il tuo Client ID.");
      if (saved.clientId !== clientId) throw new Error("Client ID cambiato: salva e ricollega TIDAL.");
      if (saved.expires > now() + 60_000) return saved.access_token;
      if (!saved.refresh_token) throw new Error("Sessione TIDAL scaduta: ricollega l’account.");
      if (!refreshing) refreshing = transport.token({ grant_type: "refresh_token", client_id: clientId,
        refresh_token: saved.refresh_token }).then((value) => store({ ...saved, ...value }, clientId))
        .finally(() => { refreshing = null; });
      return refreshing;
    },
    disconnect() { session.removeItem(TOKEN); session.removeItem(PENDING); transport.clear(); },
  };
}

export function tidalResources(documents) {
  const resources = new Map();
  for (const document of documents) for (const item of [
    ...(Array.isArray(document.data) ? document.data : document.data ? [document.data] : []),
    ...(document.included || []),
  ]) {
    const key = `${item.type}:${item.id}`;
    const previous = resources.get(key);
    resources.set(key, { ...previous, ...item,
      attributes: { ...previous?.attributes, ...item.attributes },
      relationships: { ...previous?.relationships, ...item.relationships } });
  }
  return [...resources.values()];
}

export function tidalAlbumRecords(documents) {
  const resources = tidalResources(documents);
  const index = new Map(resources.map((resource) => [`${resource.type}:${resource.id}`, resource]));
  return resources.filter((resource) => resource.type === "albums" && /^[1-9][0-9]*$/.test(resource.id)
    && resource.attributes?.title).map((album) => {
    const refs = album.relationships?.artists?.data || [];
    const artist = refs.map((ref) => index.get(`artists:${ref.id}`)?.attributes?.name).filter(Boolean).join(", ");
    if (!artist) return null;
    return { id: `tidal:${album.id}`, name: album.attributes.title, artist,
      url: `https://tidal.com/browse/album/${album.id}`, year: String(album.attributes.releaseDate || "").slice(0, 4),
      status: "queued", rating: null, genres: [], primary_genre: "", collections: [], tags: [], cover_sha256: null };
  }).filter(Boolean);
}

export function tidalAlbumArtwork(documents) {
  const resources = tidalResources(documents), artwork = new Map(), index = new Map(
    resources.map((resource) => [`${resource.type}:${resource.id}`, resource]));
  for (const album of resources.filter((resource) => resource.type === "albums")) {
    const data = album.relationships?.coverArt?.data;
    for (const ref of Array.isArray(data) ? data : data ? [data] : []) {
      const files = index.get(`${ref.type}:${ref.id}`)?.attributes?.files || [];
      for (const file of [...files].sort((a, b) => Math.abs((a.meta?.width || 320) - 320) - Math.abs((b.meta?.width || 320) - 320))) {
        let url;
        try { url = new URL(file.href); } catch { continue; }
        if (url.protocol === "https:" && url.host === "resources.tidal.com" && !url.username && !url.password) {
          artwork.set(`tidal:${album.id}`, url.href); break;
        }
      }
      if (artwork.has(`tidal:${album.id}`)) break;
    }
  }
  return artwork;
}
