import test from "node:test";
import assert from "node:assert/strict";
import { CatalogSuggestions } from "./catalog-suggestions.mjs";
import { CatalogPlaylist } from "./catalog-playlist.mjs";
import { pack, unpack, fingerprint, saveCheckpoint, readCheckpoint, validateCheckpoint,
  clearCheckpoint, editionLink, setEditionLink, pauseRemaining, bindPauseNotice } from "./music-continuity.mjs";

const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key), values };
};
test("reopen resumes only the failed read page, keeping verified tracks and discovery cursors", async () => {
  const db = storage();
  const discovery = new CatalogSuggestions({ albums: [{ id: "qobuz:edition", name: "Album", artist: "Artist" }] });
  const state = new CatalogPlaylist(discovery, 2);
  await assert.rejects(state.step({
    discover: () => discovery.step({}),
    albumTracks: async (_id, offset) => {
      if (offset) throw new Error("offline");
      return { tracks: [{ id: "1", name: "First" }], next: 1 };
    },
  }), /offline/);
  saveCheckpoint(db, "qobuz", "account", "criteria", { name: "Saved" }, state.preview(), state.checkpoint());
  const saved = validateCheckpoint(readCheckpoint(db, "qobuz"), "account", "criteria");
  const restored = CatalogPlaylist.restore(saved.state, CatalogSuggestions.restore(saved.state.discovery));
  const reads = [];
  const result = await restored.step({ discover: () => {}, albumTracks: async (id, offset) => {
    reads.push([id, offset]); return { tracks: [{ id: "2", name: "Second" }] };
  } });
  assert.deepEqual(reads, [["qobuz:edition", 1]]);
  assert.deepEqual(result.tracks.map((track) => track.id), ["1", "2"]);
  assert.equal(result.hasMore, false);
  assert.equal(saved.parameters.name, "Saved");
});
test("checkpoints redact credentials and URLs without dropping discovery; maps and sets survive", async () => {
  const saved = pack({ discovery: { tasks: [["search", { name: "Album" }]], candidates: new Map([["a", { id: "a" }]]),
    processed: new Set(["a"]) }, token: "secret", access_token: "secret", password: "secret",
    coverUrl: "https://host/?token=secret", href: "https://host/?secret" });
  assert.doesNotMatch(JSON.stringify(saved), /secret|https:\/\//);
  const value = unpack(saved);
  assert.deepEqual(value.discovery.candidates, new Map([["a", { id: "a" }]]));
  assert.deepEqual(value.discovery.processed, new Set(["a"]));
  assert.throws(() => pack({ callback: () => {} }), /serializzabile/);
  assert.match(await fingerprint(["account", "token"]), /^[a-f0-9]{64}$/);
});
test("changed accounts, criteria, providers and broken data are rejected without writes", () => {
  const db = storage();
  saveCheckpoint(db, "tidal", "account", "criteria", {}, { tracks: [] }, null);
  const saved = readCheckpoint(db, "tidal");
  assert.throws(() => validateCheckpoint(saved, "different", "criteria"), /Account/);
  assert.throws(() => validateCheckpoint(saved, "account", "different"), /criteri/);
  assert.equal(readCheckpoint(db, "qobuz"), null);
  db.setItem("accord-playlist-checkpoint-qobuz-v1", "{broken");
  assert.throws(() => readCheckpoint(db, "qobuz"));
  clearCheckpoint(db, "tidal");
  assert.equal(readCheckpoint(db, "tidal"), null);
});
test("edition links reopen and remain editable without merging albums, copying ratings, or accepting wrong providers", () => {
  const db = storage(), local = { id: "local", artist: "Artist", name: "Album", rating: 4 };
  const selected = { id: "tidal:123", artist: "Artist", name: "Edition", rating: 5 };
  const before = structuredClone([local, selected]);
  setEditionLink(db, local, "tidal", selected);
  assert.equal(editionLink(db, local, "tidal").id, "tidal:123");
  setEditionLink(db, local, "tidal", { ...selected, id: "tidal:456" });
  assert.equal(editionLink(db, local, "tidal").id, "tidal:456");
  assert.deepEqual([local, selected], before);
  assert.equal(editionLink(db, { ...local, name: "Changed" }, "tidal"), null);
  assert.throws(() => setEditionLink(db, local, "qobuz", selected), /verificato/);
  setEditionLink(db, local, "tidal");
  assert.equal(editionLink(db, local, "tidal"), null);
});
test("countdown respects the longest persistent provider/source pause and expires without requests", () => {
  const db = storage();
  db.setItem("accord-tidal-cooldown-until-v1", "120000");
  db.setItem("accord-lastfm-cooldown-until-v1", "140000");
  assert.equal(pauseRemaining(db, "tidal", 100000), 40);
  assert.equal(pauseRemaining(db, "tidal", 139001), 1);
  assert.equal(pauseRemaining(db, "tidal", 140000), 0);
  db.setItem("accord-discogs-cooldown-until-v1", "broken");
  assert.throws(() => pauseRemaining(db, "tidal", 140000), /non valido/);
});
test("contextual countdown preserves results, explains the manual read, and stops while the page is closed", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => ({ setAttribute() {} }),
  } });
  const db = storage(), listeners = new Map(), pending = new Map();
  let now = 100000, timerId = 0;
  db.setItem("accord-qobuz-cooldown-until-v1", "102000");
  const timers = { setTimeout: (callback) => { pending.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => pending.delete(id) };
  const events = { addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name) };
  const anchor = { textContent: "Risultati verificati", before() {} };
  try {
    const pause = bindPauseNotice(anchor, { storage: db, provider: () => "qobuz",
      describe: () => "Pagina successiva legge la pagina seguente.", timers, events, clock: () => now });
    assert.match(pause.notice.textContent, /2 s.*Pagina successiva.*Nessuna richiesta o scrittura riparte/);
    assert.equal(anchor.textContent, "Risultati verificati");
    now = 101001;
    pause.refresh();
    assert.match(pause.notice.textContent, /1 s/);
    listeners.get("pagehide")();
    assert.equal(pending.size, 0);
    now = 102000;
    listeners.get("pageshow")();
    assert.equal(pause.notice.hidden, true);
    assert.equal(anchor.textContent, "Risultati verificati");
    db.setItem("accord-discogs-cooldown-until-v1", "broken");
    pause.refresh();
    assert.match(pause.notice.textContent, /Stato pausa non disponibile/);
    pause.dispose();
    assert.equal(pending.size, 0);
    assert.equal(listeners.size, 0);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original); else delete globalThis.document;
  }
});
