// Prudential client pacing, not a claim about either provider's quota.
const storageQueues = new WeakMap(), memoryQueues = new Map();
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function retryMilliseconds(value, now = Date.now()) {
  const numeric = typeof value === "string" && /^\s*\d+(?:\.\d+)?\s*$/.test(value) ? Number(value) : NaN;
  const until = Number.isFinite(numeric) ? now + Math.max(1, numeric) * 1000 : Date.parse(value || "");
  return Number.isFinite(until) ? Math.max(1000, until - now) : 60_000;
}

export function createServiceRequests({
  service, storage = globalThis.localStorage, now = () => Date.now(), sleep = defaultSleep,
  jitter = Math.random,
  lock = (name, run) => globalThis.navigator?.locks?.request
    ? globalThis.navigator.locks.request(name, run) : run(),
}) {
  const queues = storage
    ? storageQueues.get(storage) || storageQueues.set(storage, new Map()).get(storage) : memoryQueues;
  if (!queues.has(service)) queues.set(service, { queue: Promise.resolve(), next: 0, cooldown: 0, interval: 1000 });
  const state = queues.get(service);
  const cooldownKey = `accord-${service}-cooldown-until-v1`, nextKey = `accord-${service}-next-request-v1`;
  const intervalKey = `accord-${service}-request-interval-v1`, adaptive = service === "tidal";
  function number(key, fallback) {
    const raw = storage?.getItem(key);
    const result = raw == null ? fallback : Number(raw);
    if (!Number.isFinite(result) || result < 0) throw new Error(`Stato richieste ${service} non valido.`);
    return result;
  }
  function save(key, value) { storage?.setItem(key, String(value)); }
  function interval() {
    const previousLimit = adaptive && number(cooldownKey, state.cooldown) > 0;
    const value = adaptive ? number(intervalKey, Math.max(state.interval, previousLimit ? 5000 : 1000)) : 500;
    if (adaptive && (value < 1000 || value > 60_000)) throw new Error("Stato richieste tidal non valido.");
    return value;
  }
  function ready() {
    interval();
    const remaining = number(cooldownKey, state.cooldown) - now();
    if (remaining > 0) throw new Error(`${service.toUpperCase()}: attendi ${Math.ceil(remaining / 1000)} secondi (Retry-After).`);
  }
  return {
    ready,
    send(request, { read = true, signal, check = () => {}, beforeSend = () => {} } = {}) {
      const guard = () => {
        signal?.throwIfAborted();
        check();
      };
      const pause = async (ms) => {
        const until = now() + ms;
        while (until > now()) {
          guard();
          await sleep(Math.min(100, until - now()));
        }
        guard();
      };
      const run = async () => {
        guard();
        ready();
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await pause(Math.max(0, number(nextKey, state.next) - now()));
          beforeSend?.();
          state.next = now() + interval();
          save(nextKey, state.next);
          let response;
          try { response = await request(); }
          catch (error) {
            guard();
            if (!read || attempt === 2) throw error;
            await pause(1000 * 2 ** attempt + jitter() * 250);
            continue;
          }
          let retry = null;
          if (response.status === 429) {
            retry = retryMilliseconds(response.headers.get("Retry-After"), now());
            if (adaptive) {
              const slower = Math.min(60_000, Math.max(5000, interval() * 2));
              state.interval = slower;
              save(intervalKey, slower);
              retry = Math.max(retry, slower);
              state.next = Math.max(number(nextKey, state.next), now() + slower);
              save(nextKey, state.next);
            }
            state.cooldown = Math.max(number(cooldownKey, state.cooldown), now() + retry);
            save(cooldownKey, state.cooldown);
          }
          if (read) guard();
          if (!read || attempt === 2 || !(response.status === 429 || response.status >= 500 && response.status < 600)
              || retry !== null && retry > 30_000) return response;
          await response.body?.cancel();
          await pause((retry ?? 1000 * 2 ** attempt) + jitter() * 250);
        }
      };
      const result = state.queue.then(() => {
        guard();
        return lock(`accord-${service}-request-v1`, run);
      });
      state.queue = result.catch(() => {});
      if (!signal) return result;
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new DOMException("Interrotto", "AbortError"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
        result.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
    },
  };
}
