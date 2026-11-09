import { QOBUZ_API, qobuzCredentials, qobuzNumericId } from "./qobuz.mjs?v=9";
import { createServiceRequests } from "./service-requests.mjs?v=2";

const AUDIO_HOSTS = new Set(["streaming-qobuz-sec.akamaized.net", "streaming-qobuz-std.akamaized.net"]);
const BUNDLE_LIMIT = 16 * 1024 * 1024;

export function qobuzBundleSecrets(bundle, appId) {
  if (typeof bundle !== "string" || bundle.length > BUNDLE_LIMIT) throw new Error("Bundle Qobuz non valido o troppo grande.");
  const match = bundle.match(/production:\{api:\{appId:"(\d{9})"/);
  if (!match || match[1] !== appId) throw new Error("Il bundle Qobuz non corrisponde all'App ID della sessione.");
  const secrets = [];
  for (const [, seed, zone] of bundle.matchAll(/[a-z]\.initialSeed\("([\w=]+)",window\.utimezone\.([a-z]+)\)/g)) {
    const name = zone[0].toUpperCase() + zone.slice(1);
    const info = bundle.match(new RegExp(`name:"\\w+/${name}",info:"([\\w=]+)",extras:"([\\w=]+)"`));
    if (!info) throw new Error("Struttura del bundle Qobuz non riconosciuta.");
    try {
      const secret = atob((seed + info[1] + info[2]).slice(0, -44));
      if (!/^[!-~]{1,512}$/.test(secret)) throw new Error();
      secrets.push(secret);
    } catch { throw new Error("Chiave del bundle Qobuz non leggibile."); }
  }
  if (!secrets.length || secrets.length > 10) throw new Error("Nessuna chiave utilizzabile nel bundle Qobuz.");
  return secrets;
}

// MD5 is required by Qobuz's private request signature, not used as a security primitive.
export function qobuzMd5(text) {
  const bytes = new TextEncoder().encode(text);
  const size = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(size);
  padded.set(bytes); padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(size - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(size - 4, Math.floor(bytes.length / 0x20000000), true);
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let block = 0; block < size; block += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i += 1) {
      const round = Math.floor(i / 16);
      const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c)
        : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const index = round === 0 ? i : round === 1 ? (5 * i + 1) % 16
        : round === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
      const n = (a + f + constants[i] + view.getUint32(block + index * 4, true)) >>> 0;
      const shift = shifts[round * 4 + i % 4];
      [a, d, c, b] = [d, c, b, (b + ((n << shift) | (n >>> (32 - shift)))) >>> 0];
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map((word) =>
    [0, 8, 16, 24].map((shift) => ((word >>> shift) & 255).toString(16).padStart(2, "0")).join("")).join("");
}

export async function qobuzStreamUrl({ appId, token, trackId, secret, format = 5,
  request = (...args) => globalThis.fetch(...args), signal, timestamp = Math.floor(Date.now() / 1000),
  storage = globalThis.localStorage, now, sleep, jitter, active = () => true }) {
  const auth = qobuzCredentials(appId, token), id = qobuzNumericId(trackId, "brano");
  if (typeof secret !== "string" || !/^[!-~]{1,512}$/.test(secret)
      || ![5, 6].includes(format) || !Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error("Parametri player Qobuz non validi.");
  }
  const signature = qobuzMd5(`trackgetFileUrlformat_id${format}intentstreamtrack_id${id}${timestamp}${secret}`);
  const url = new URL("track/getFileUrl", QOBUZ_API);
  url.search = new URLSearchParams({ track_id: id, format_id: String(format), intent: "stream",
    request_ts: String(timestamp), request_sig: signature }).toString();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 30_000);
  const requests = createServiceRequests({ service: "qobuz", storage, now, sleep, jitter });
  try {
    let response;
    try {
      response = await requests.send(() => request(url.href, { method: "GET", signal: controller.signal, credentials: "omit",
        redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
        headers: { "X-App-Id": auth.appId, "X-User-Auth-Token": auth.token, Accept: "application/json" } }),
      { signal: controller.signal, check: () => {
        if (!active()) throw new Error("Riproduzione Qobuz interrotta.");
      } });
    } catch (error) {
      if (/Retry-After|Stato richieste/.test(error.message)) throw error;
      throw new Error("Lettura audio Qobuz non riuscita o interrotta.");
    }
    if (response.status !== 200) throw new Error(`Lettura audio Qobuz non riuscita (HTTP ${response.status}).`);
    let data;
    try { data = await response.json(); } catch { throw new Error("Risposta audio Qobuz non leggibile."); }
    let audio;
    try { audio = new URL(data?.url); } catch { throw new Error("Indirizzo audio Qobuz non valido."); }
    if (audio.protocol !== "https:" || !AUDIO_HOSTS.has(audio.host) || audio.username || audio.password || audio.hash
        || data.sample === true || data.preview === true) throw new Error("Audio Qobuz non disponibile su un'origine verificata.");
    return audio.href;
  } finally {
    clearTimeout(timeout); signal?.removeEventListener("abort", abort);
  }
}
