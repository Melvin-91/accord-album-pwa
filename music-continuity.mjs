// Local-only checkpoints: no credentials, signed URLs, callbacks, or write queue.
import { commitLocalRestore } from "./ui.mjs?v=17";

export async function fingerprint(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function pack(value) {
  if (value instanceof Set) return { $collection: "set", items: [...value].map(pack) };
  if (value instanceof Map) return { $collection: "map", items: [...value].map(pack) };
  if (Array.isArray(value)) return value.map(pack);
  if (value && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Oggetto runtime non salvabile nel checkpoint.");
    return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
      !/token|secret|password|authorization|cookie|url|href|image|^cover/i.test(key)
      && !(typeof item === "string" && /https?:\/\//i.test(item))).map(([key, item]) => [key, pack(item)]));
  }
  if (value == null || ["string", "boolean"].includes(typeof value) || typeof value === "number" && Number.isFinite(value)) return value ?? null;
  throw new Error("Stato di lettura non serializzabile.");
}

export function unpack(value) {
  if (Array.isArray(value)) return value.map(unpack);
  if (value && typeof value === "object") {
    if (value.$collection === "set") return new Set(value.items.map(unpack));
    if (value.$collection === "map") return new Map(value.items.map(unpack));
    if (value.$collection) throw new Error("Checkpoint musicale non valido.");
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
  }
  return value;
}

const checkpointKey = (provider) => `accord-playlist-checkpoint-${provider}-v1`;
export function saveCheckpoint(storage, provider, identity, criteria, parameters, preview, state) {
  storage.setItem(checkpointKey(provider), JSON.stringify(pack({
    schema: 1, provider, identity, criteria, parameters, preview, state, saved: Date.now(),
  })));
}
export function readCheckpoint(storage, provider) {
  const record = JSON.parse(storage.getItem(checkpointKey(provider)) || "null");
  if (!record) return null;
  if (record.schema !== 1 || record.provider !== provider || !record.preview || !record.parameters) {
    throw new Error("Anteprima conservata non valida.");
  }
  return unpack(record);
}
export function validateCheckpoint(record, identity, criteria) {
  if (!identity || record.identity !== identity || record.criteria !== criteria) {
    throw new Error("Account o criteri diversi: ripristina i parametri o genera una nuova anteprima.");
  }
  return record;
}
export function clearCheckpoint(storage, provider) { storage.removeItem(checkpointKey(provider)); }

const sourceIdentity = (album) => JSON.stringify([album.id, album.artist, album.name]);
const validEdition = (provider, id) => provider === "tidal" ? /^tidal:[1-9][0-9]*$/.test(id)
  : provider === "qobuz" && /^qobuz:[A-Za-z0-9]{1,120}$/.test(id);
export function editionLink(storage, album, provider) {
  const links = JSON.parse(storage.getItem("accord-music-edition-links-v1") || "{}");
  const record = links[album.id]?.[provider];
  if (!record || record.source !== sourceIdentity(album)) return null;
  if (!validEdition(provider, record.id)) throw new Error("Associazione edizione non valida.");
  return { id: record.id, name: record.name, artist: album.artist,
    url: `${provider === "tidal" ? "https://tidal.com/browse/album/" : "https://play.qobuz.com/album/"}${record.id.split(":")[1]}` };
}
export function setEditionLink(storage, album, provider, selected = null) {
  if (!["tidal", "qobuz"].includes(provider) || selected && !validEdition(provider, selected.id)) {
    throw new Error("Scegli un album verificato nel catalogo del servizio.");
  }
  const links = JSON.parse(storage.getItem("accord-music-edition-links-v1") || "{}");
  links[album.id] ||= {};
  if (selected) links[album.id][provider] = { id: selected.id, name: selected.name, source: sourceIdentity(album) };
  else delete links[album.id][provider];
  const key = "accord-album-pwa-v1";
  const collection = JSON.parse(storage.getItem(key) || "{}");
  commitLocalRestore(storage, key, collection, collection,
    { "accord-music-edition-links-v1": links }, "Associazione esplicita di edizione");
}

export function pauseRemaining(storage, provider, now = Date.now()) {
  const keys = [provider === "spotify" ? "accord-spotify-rate-limit-until-v1" : `accord-${provider}-cooldown-until-v1`,
    "accord-lastfm-cooldown-until-v1", "accord-discogs-cooldown-until-v1"];
  return Math.max(0, ...keys.map((key) => {
    const value = Number(storage.getItem(key) || 0);
    if (!Number.isFinite(value) || value < 0) throw new Error("Stato pausa non valido.");
    return Math.ceil((value - now) / 1000);
  }));
}

export function bindPauseNotice(anchor, { storage, provider, describe, clock = Date.now,
  timers = globalThis, events = globalThis }) {
  const notice = document.createElement("p");
  notice.className = "summary music-pause-notice";
  notice.setAttribute("role", "timer");
  notice.setAttribute("aria-live", "off");
  anchor.before(notice);
  let timer = null, active = true;
  function refresh() {
    timers.clearTimeout(timer);
    if (!active) return;
    try {
      const remaining = pauseRemaining(storage, provider(), clock());
      notice.hidden = remaining === 0;
      notice.textContent = remaining ? `Pausa delle letture: ${remaining} s. Risultati verificati conservati. `
        + `Alla scadenza: ${describe()} Nessuna richiesta o scrittura riparte automaticamente; verifica gli invii incerti.` : "";
    } catch (error) {
      notice.hidden = false;
      notice.textContent = `Stato pausa non disponibile: ${error.message}`;
    }
    timer = timers.setTimeout(refresh, 1000);
    timer?.unref?.();
  }
  const pause = () => { active = false; timers.clearTimeout(timer); };
  const resume = () => { active = true; refresh(); };
  events.addEventListener?.("pagehide", pause);
  events.addEventListener?.("pageshow", resume);
  refresh();
  return { notice, refresh, dispose() {
    pause();
    events.removeEventListener?.("pagehide", pause);
    events.removeEventListener?.("pageshow", resume);
  } };
}
