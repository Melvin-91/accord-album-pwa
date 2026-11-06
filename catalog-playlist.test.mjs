import test from "node:test";
import assert from "node:assert/strict";
import { CatalogPlaylist, createCatalogPlaylist } from "./catalog-playlist.mjs";
import { CatalogSuggestions } from "./catalog-suggestions.mjs";
import { initializeCatalogPlaylistUI } from "./playlist-ui.mjs";

const discovery = (count = 1) => ({
  target: count, source: "Archivio locale", reads: 0, stats: {}, filters: {}, canContinue: false,
  results: Array.from({ length: count }, (_, i) => ({ album: { id: `qobuz:album${i}`, artist: `Artist ${i}`, name: "Album" } })),
});

test("native playlist order, deduplication and unavailable tracks use real album data", async () => {
  const state = new CatalogPlaylist(discovery(2), 2);
  const pages = [{ tracks: [{ id: "1", name: "Unavailable", streamable: false },
    { id: "2", name: "First" }, { id: "3", name: "Second" }] },
  { tracks: [{ id: "2", name: "Duplicate" }, { id: "4", name: "Third" }] }];
  const result = await state.step({ albumTracks: async () => pages.shift() });
  assert.deepEqual(result.tracks.map((row) => row.id), ["2", "3", "4"]);
  assert.deepEqual(result.artists.map((row) => row.tracks), [2, 1]);
  assert.equal(result.hasMore, false);
  assert.ok(result.partialReason);
});

test("only ten album reads per pass and continuation never repeats completed albums", async () => {
  const state = new CatalogPlaylist(discovery(12), 1); let reads = 0;
  const albumTracks = async (id) => ({ tracks: [{ id: String(++reads), name: id }] });
  const first = await state.step({ albumTracks });
  assert.equal(first.tracks.length, 10); assert.equal(first.hasMore, true);
  const second = await state.step({ albumTracks });
  assert.equal(second.tracks.length, 12); assert.equal(reads, 12); assert.equal(second.hasMore, false);
});

test("manual continuation resumes the failed page without duplicating verified tracks", async () => {
  const state = new CatalogPlaylist(discovery(), 2);
  const pages = [{ tracks: [{ id: "1", name: "First" }], next: 1 }, new Error("offline"),
    { tracks: [{ id: "2", name: "Second" }], next: null }];
  const offsets = [];
  const albumTracks = async (id, offset) => {
    offsets.push(offset); const page = pages.shift(); if (page instanceof Error) throw page; return page;
  };
  await assert.rejects(state.step({ albumTracks }), /offline/);
  const result = await state.step({ albumTracks });
  assert.deepEqual(offsets, [0, 1, 1]); assert.deepEqual(result.tracks.map((row) => row.id), ["1", "2"]);
});

test("the fifty artist, ten track boundary produces exactly five hundred verified tracks", async () => {
  const state = new CatalogPlaylist(discovery(50), 10);
  const albumTracks = async (id) => {
    const artist = Number(id.split("album")[1]);
    return { tracks: Array.from({ length: 10 }, (_, i) => ({ id: String(artist * 10 + i + 1), name: `Track ${i}` })) };
  };
  let result;
  for (const count of [100, 200, 300, 400, 500]) {
    result = await state.step({ albumTracks });
    assert.equal(result.tracks.length, count);
  }
  assert.equal(result.artists.length, 50); assert.ok(result.artists.every((row) => row.tracks === 10));
  assert.equal(result.hasMore, false);
  const f = writer(50); f.options.tracks = result.tracks;
  await createCatalogPlaylist(f.options);
  assert.equal(f.calls.slice(1).length, 10);
  f.options.tracks.push({ id: "501" });
  await assert.rejects(createCatalogPlaylist(f.options), /non validi/);
});

test("late catalogue responses are discarded after an account or provider change", async () => {
  const state = new CatalogPlaylist(discovery(), 1); let active = true;
  await assert.rejects(state.step({ guard: () => { if (!active) throw new Error("changed"); },
    albumTracks: async () => { active = false; return { tracks: [{ id: "1", name: "A" }] }; } }), /changed/);
  assert.equal(state.tracks.length, 0);
});

test("playlist discovery supports fifty artists without changing the ten-album suggestions default", () => {
  assert.equal(new CatalogSuggestions({}).target, 10);
  assert.equal(new CatalogSuggestions({ target: 50 }).maxArtists, 150);
  for (const target of [0, 51, true, 2.5]) assert.throws(() => new CatalogSuggestions({ target }), /1 a 50/);
});

function writer(batchSize = 50) {
  const calls = []; let pending = false;
  const options = { name: "New", tracks: Array.from({ length: 121 }, (_, i) => ({ id: String(i + 1) })),
    guard: () => {}, lock: async (run) => run(),
    uncertain: { get: () => pending, set: (value) => { pending = value; } },
    api: { batchSize, preflight: async () => {}, create: async () => { calls.push("create"); return { id: "p1", name: "New" }; },
      add: async (id, tracks) => { calls.push(tracks); } } };
  return { calls, options, pending: () => pending };
}
test("create plus add is one protected operation with provider-specific batch sizes", async () => {
  for (const batchSize of [50, 100]) {
    const f = writer(batchSize);
    await createCatalogPlaylist(f.options);
    assert.deepEqual(f.calls.slice(1).map((ids) => ids.length), batchSize === 50 ? [50, 50, 21] : [100, 21]);
    assert.equal(f.pending(), false);
  }
});

test("create succeeded but add failed leaves sticky uncertainty and blocks a second creation", async () => {
  const f = writer(); f.options.api.add = async () => { throw new Error("offline"); };
  await assert.rejects(createCatalogPlaylist(f.options), /non ricreare/);
  assert.equal(f.pending(), true);
  await assert.rejects(createCatalogPlaylist(f.options), /Verifica prima/);
  assert.deepEqual(f.calls, ["create"]);
});

test("cooldown preflight prevents creation without marking a write as uncertain", async () => {
  const f = writer();
  f.options.api.preflight = async () => { throw new Error("TIDAL: attendi 120 secondi"); };
  await assert.rejects(createCatalogPlaylist(f.options), /attendi 120/);
  assert.equal(f.pending(), false);
  assert.deepEqual(f.calls, []);
});

test("playlist UI preserves its preview after preflight cooldown and can create after the pause", async (t) => {
  const globals = ["document", "window", "navigator", "localStorage", "confirm"];
  const previous = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const nodes = new Map(), data = new Map(), created = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { value: "", textContent: "", parentElement: { append() {} },
      listeners: new Map(), addEventListener(name, callback) { this.listeners.set(name, callback); },
      setAttribute() {}, before() {}, replaceChildren() {}, querySelector: (selector) => node(selector) });
    return nodes.get(id);
  }
  const settings = {
    document: { getElementById: node, createElement: (tag) => {
      const result = node(`created-${tag}-${created.length}`); created.push(result); return result;
    }, querySelector: () => node("root") },
    window: { addEventListener() {} }, confirm: () => true,
    localStorage: { getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) },
    navigator: { locks: { request: async (_name, run) => run() } },
  };
  for (const [name, value] of Object.entries(settings)) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  for (const service of ["tidal", "qobuz"]) {
    let paused = true, creations = 0, additions = 0, preparations = 0;
    const api = {
      revision: () => "account", batchSize: service === "tidal" ? 50 : 100,
      identity: () => "account",
      preflight: async () => { if (paused) throw new Error("attendi 120 secondi"); },
      create: async () => { creations += 1; return { id: "p1", name: "New" }; },
      add: async () => { additions += 1; },
      prepare: async () => { preparations += 1; return { tracks: [{ id: "1", name: "First" }] }; },
      adopt() {},
    };
    const ui = initializeCatalogPlaylistUI({
      gate: { service, epoch: 1, assert() {} }, providers: { [service]: { playlistAPI: api } },
      discoveryUI: { playlistSignature: () => "filters", playlistDurableSignature: () => "filters" },
      render() {}, clearSpotifyPreview() {}, selectView() {},
    });
    node("playlistBuilderName").value = "New";
    await ui.prepareRecords([{}]);
    await ui.create();
    assert.equal(creations, 0);
    assert.equal(data.size, 1);
    assert.equal(node("playlistCreateButton").disabled, false);
    assert.match(node("playlistBuilderStatus").textContent, /Creazione non avviata.*attendi 120/);
    let historical = null;
    initializeCatalogPlaylistUI({
      gate: { service, epoch: 2, assert() {} }, providers: { [service]: { playlistAPI: api } },
      discoveryUI: { playlistSignature: () => "filters", playlistDurableSignature: () => "filters" },
      render: (preview) => { historical = preview; }, clearSpotifyPreview() {}, selectView() {},
    });
    const resume = created.filter((item) => item.textContent === "Riprendi anteprima conservata").at(-1);
    await resume.listeners.get("click")();
    assert.equal(historical.tracks[0].name, "First");
    assert.match(node("playlistBuilderStatus").textContent, /Risultati storici/);
    assert.equal(preparations, 1);
    assert.equal(creations, 0);
    assert.equal(node("playlistCreateButton").disabled, false);
    paused = false;
    await ui.create();
    assert.equal(creations, 1);
    assert.equal(additions, 1);
    assert.equal(preparations, 1);
    assert.equal(data.size, 0);
    assert.equal(node("playlistCreateButton").disabled, true);
  }
});

test("rate limit on the second batch preserves confirmed progress and never resends", async () => {
  const f = writer(50);
  f.options.api.add = async (_id, ids) => {
    f.calls.push(ids);
    if (f.calls.length === 3) throw new Error("TIDAL: attendi 120 secondi");
  };
  await assert.rejects(createCatalogPlaylist(f.options), /50\/121 brani confermati.*attendi 120.*non ricreare/);
  assert.equal(f.pending(), true);
  await assert.rejects(createCatalogPlaylist(f.options), /Verifica prima/);
  assert.equal(f.calls.length, 3);
});

test("provider changes while waiting for the lock prevent every remote write", async () => {
  const f = writer(); let active = true;
  f.options.lock = async (run) => { active = false; return run(); };
  f.options.guard = () => { if (!active) throw new Error("changed"); };
  await assert.rejects(createCatalogPlaylist(f.options), /changed/);
  assert.equal(f.pending(), false); assert.deepEqual(f.calls, []);
});

test("provider changes after create prevent add and retain uncertainty", async () => {
  const f = writer(); let active = true;
  f.options.api.create = async () => { active = false; f.calls.push("create"); return { id: "p1" }; };
  f.options.guard = () => { if (!active) throw new Error("changed"); };
  await assert.rejects(createCatalogPlaylist(f.options), /changed/);
  assert.equal(f.pending(), true); assert.deepEqual(f.calls, ["create"]);
});
