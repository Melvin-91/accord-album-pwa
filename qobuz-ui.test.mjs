import test from "node:test";
import assert from "node:assert/strict";
import { initializeQobuzUI as initialize } from "./qobuz-ui.mjs";
import { createMusicServiceGate } from "./tidal.mjs";

let time = Date.now();
const initializeQobuzUI = (options) => initialize({ ...options, requestOptions: {
  now: () => time, sleep: async (ms) => { time += ms; }, jitter: () => 0,
} });

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.value = ""; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) { for (const node of nodes) node.parentNode = this; this.children.push(...nodes); }
  prepend(...nodes) { for (const node of nodes) node.parentNode = this; this.children.unshift(...nodes); }
  before(node) {
    node.parentNode = this.parentNode;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 0, node);
  }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  removeAttribute(name) { delete this.attributes[name]; if (name === "src") this.src = ""; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  async click() { await this.listeners.click?.(); }
  focus() { this.focused = true; }
  pause() { this.paused = true; }
  load() {}
  async play() { this.paused = false; }
}
const storage = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key) };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("Qobuz UI imports locally and blocks retries after an uncertain remote write", async () => {
  const root = new Node("main"), local = storage(), session = storage(), calls = [], imported = [];
  const source = { id: "00123", title: "Test", artist: { name: "Artist" } };
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
    localStorage: local, sessionStorage: session, confirm: () => true,
    navigator: { locks: { request: async (_name, run) => run() } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return options.method === "GET"
        ? new Response(JSON.stringify(new URL(url).pathname.endsWith("/album/get")
          ? source : { albums: { items: [source], total: 1, offset: 0 } }))
        : new Response("error", { status: 503 });
    },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const gate = createMusicServiceGate(local);
    gate.select("qobuz");
    const ui = initializeQobuzUI({ gate, addAlbum: (album) => { imported.push(album); return true; } });
    const all = (node = root) => [node, ...node.children.flatMap(all)];
    const find = (label) => {
      const item = all().find((node) => node.text === label);
      assert.ok(item, label); return item;
    };
    find("X-App-Id della sessione web").children[0].value = "app";
    find("X-User-Auth-Token (non password)").children[0].value = "secret";
    assert.equal(calls.length, 0);
    await find("Collega Qobuz").click();
    assert.equal(calls.length, 1);
    assert.equal(local.getItem("accord-qobuz-session-v1"), null);
    assert.ok(session.getItem("accord-qobuz-session-v1"));
    await find("Leggi preferiti").click();
    await tick();
    const checkbox = all().find((node) => node.attributes.type === "checkbox");
    assert.ok(checkbox); checkbox.checked = true;
    const before = calls.length;
    await find("Importa selezionati in Accord").click();
    assert.equal(imported[0].id, "qobuz:00123");
    assert.equal(calls.length, before);
    await find("Aggiungi preferito Qobuz").click();
    await tick();
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), "1");
    const count = calls.length;
    await find("Aggiungi preferito Qobuz").click();
    await tick();
    assert.equal(calls.length, count);
    await find("Ho verificato l'esito su Qobuz").click();
    await tick();
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), null);
    all().find((node) => node.attributes.placeholder === "Titolo, artista, ID o link album Qobuz").value = "00123";
    await find("Leggi ID / link album").click();
    await tick();
    assert.equal(new URL(calls.at(-1).url).searchParams.get("album_id"), "00123");
    await find("Scollega Qobuz").click();
    assert.equal(session.getItem("accord-qobuz-session-v1"), null);
    gate.select("spotify");
    ui.setActive();
    assert.equal(root.children[0].hidden, true);
    const remaining = calls.length;
    await find("Leggi preferiti").click();
    await tick();
    assert.equal(calls.length, remaining);
    assert.throws(() => ui.openCatalog(), /cambiato/);
    gate.select("qobuz");
    ui.setActive();
    ui.openCatalog("Test");
    assert.equal(root.children[0].hidden, false);
    assert.equal(all().find((node) => node.attributes.placeholder === "Titolo, artista, ID o link album Qobuz").value, "Test");
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("verification in another tab cannot clear an in-flight write's guard", async () => {
  const first = new Node("main"), second = new Node("main"), local = storage(), session = storage();
  const source = { id: "00123", title: "Test", artist: { name: "Artist" } };
  let root = first, releaseWrite, confirmations = 0, pending = Promise.resolve();
  session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "app", token: "secret" }));
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
    localStorage: local, sessionStorage: session, confirm: () => { confirmations += 1; return true; },
    navigator: { locks: { request: (name, run) => {
      if (name === "accord-qobuz-request-v1") return run();
      const current = pending.then(run); pending = current.catch(() => {}); return current;
    } } },
    fetch: async (_url, options) => options.method === "GET"
      ? new Response(JSON.stringify({ albums: { items: [source], total: 1, offset: 0 } }))
      : new Promise((resolve) => { releaseWrite = resolve; }),
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const gate = createMusicServiceGate(local);
    gate.select("qobuz");
    initializeQobuzUI({ gate, addAlbum: () => true });
    root = second;
    initializeQobuzUI({ gate, addAlbum: () => true });
    const all = (node) => [node, ...node.children.flatMap(all)];
    const find = (tree, label) => {
      const item = all(tree).find((node) => node.text === label);
      assert.ok(item, label); return item;
    };
    await find(first, "Leggi preferiti").click();
    await tick();
    all(first).find((node) => node.attributes.type === "checkbox").checked = true;
    await find(first, "Aggiungi preferito Qobuz").click();
    await tick();
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), "1");
    await find(second, "Ho verificato l'esito su Qobuz").click();
    await tick();
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), "1");
    assert.equal(confirmations, 1);
    releaseWrite(new Response("error", { status: 503 }));
    await tick();
    await tick();
    assert.equal(confirmations, 2);
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), null);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("switching service discards a late Qobuz read even after switching back", async () => {
  const root = new Node("main"), local = storage(), session = storage();
  session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "app", token: "secret" }));
  let release, calls = 0;
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
    localStorage: local, sessionStorage: session, confirm: () => true,
    navigator: { locks: { request: async (_name, run) => run() } },
    fetch: async () => { calls += 1; return new Promise((resolve) => { release = resolve; }); },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const gate = createMusicServiceGate(local);
    gate.select("qobuz");
    const ui = initializeQobuzUI({ gate, addAlbum: () => true });
    const all = (node = root) => [node, ...node.children.flatMap(all)];
    await all().find((node) => node.text === "Leggi preferiti").click();
    await tick();
    assert.equal(calls, 1);
    gate.select("tidal"); ui.setActive();
    gate.select("qobuz"); ui.setActive();
    release(new Response(JSON.stringify({ albums: { items: [
      { id: "00123", title: "Test", artist: { name: "Artist" } },
    ], total: 1, offset: 0 } })));
    await tick();
    await tick();
    assert.equal(all().filter((node) => node.attributes.type === "checkbox").length, 0);
    assert.match(root.textContent, /Servizio musicale cambiato/);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("a Qobuz write waiting for the lock is not sent after changing service", async () => {
  const root = new Node("main"), local = storage(), session = storage();
  session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "app", token: "secret" }));
  let release, writes = 0;
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
    localStorage: local, sessionStorage: session, confirm: () => true,
    navigator: { locks: { request: async (name, run) => {
      if (name === "accord-qobuz-request-v1") return run();
      await new Promise((resolve) => { release = resolve; }); return run();
    } } },
    fetch: async (_url, options) => {
      if (options.method === "POST") { writes += 1; return new Response('{"status":"success"}'); }
      return new Response(JSON.stringify({ albums: { items: [
        { id: "00123", title: "Test", artist: { name: "Artist" } },
      ], total: 1, offset: 0 } }));
    },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const gate = createMusicServiceGate(local);
    gate.select("qobuz");
    const ui = initializeQobuzUI({ gate, addAlbum: () => true });
    const all = (node = root) => [node, ...node.children.flatMap(all)];
    await all().find((node) => node.text === "Leggi preferiti").click();
    await tick();
    all().find((node) => node.attributes.type === "checkbox").checked = true;
    await all().find((node) => node.text === "Aggiungi preferito Qobuz").click();
    await tick();
    gate.select("spotify"); ui.setActive();
    release();
    await tick();
    assert.equal(writes, 0);
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), null);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("in-flight Qobuz writes retain an uncertain guard unless their response confirms success", async () => {
  for (const success of [true, false]) {
    const root = new Node("main"), local = storage(), session = storage();
    session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "app", token: "secret" }));
    let release;
    const overrides = {
      document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
      localStorage: local, sessionStorage: session, confirm: () => true,
      navigator: { locks: { request: async (_name, run) => run() } },
      fetch: async (_url, options) => options.method === "POST"
        ? new Promise((resolve) => { release = resolve; })
        : new Response(JSON.stringify({ albums: { items: [
          { id: "00123", title: "Test", artist: { name: "Artist" } },
        ], total: 1, offset: 0 } })),
    };
    const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
    try {
      const gate = createMusicServiceGate(local);
      gate.select("qobuz");
      const ui = initializeQobuzUI({ gate, addAlbum: () => true });
      const all = (node = root) => [node, ...node.children.flatMap(all)];
      await all().find((node) => node.text === "Leggi preferiti").click();
      await tick();
      all().find((node) => node.attributes.type === "checkbox").checked = true;
      await all().find((node) => node.text === "Aggiungi preferito Qobuz").click();
      await tick();
      assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), "1");
      gate.select("tidal"); ui.setActive();
      release(success ? new Response('{"status":"success"}') : new Response("error", { status: 503 }));
      await tick();
      await tick();
      assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), success ? null : "1");
    } finally {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    }
  }
});

test("Qobuz suggestions and playlists are explicit, paginated and use the shared write guard", async () => {
  const root = new Node("main"), local = storage(), session = storage(), calls = [], imported = [];
  session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "app", token: "secret" }));
  const album = { id: "00123", title: "Test Album", artist: { name: "Artist" } };
  const playlist = { id: 123, name: "My list", tracks_count: 2, is_public: false };
  const tracks = [1, 2].map((id) => ({
    id, playlist_track_id: id + 10, title: `Track ${id}`, performer: { name: "Artist" }, album,
  }));
  let failWrite = false, stalePlaylist = false, allow = true;
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
    localStorage: local, sessionStorage: session, confirm: () => allow,
    navigator: { locks: { request: async (_name, run) => run() } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (options.method === "POST") return failWrite
        ? new Response("error", { status: 503 }) : new Response(JSON.stringify(playlist));
      const path = new URL(url).pathname;
      if (path.endsWith("/album/suggest")) return new Response(JSON.stringify({ albums: { items: [album] } }));
      if (path.endsWith("/playlist/getUserPlaylists")) return new Response(JSON.stringify({
        playlists: { items: [playlist], offset: 0, total: 1 },
      }));
      if (path.endsWith("/playlist/get")) return new Response(JSON.stringify({
        ...playlist, tracks: { items: stalePlaylist ? [...tracks].reverse() : tracks, offset: 0, total: 2 },
      }));
      throw new Error("Unexpected request");
    },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const gate = createMusicServiceGate(local); gate.select("qobuz");
    const ui = initializeQobuzUI({ gate, addAlbum: (record) => { imported.push(record); return true; } });
    const all = (node = root) => [node, ...node.children.flatMap(all)];
    const find = (label, node = root) => {
      const found = all(node).find((child) => child.text === label); assert.ok(found, label); return found;
    };
    const suggestionPanel = all().find((node) => node.attributes["data-qobuz-panel"] === "suggestionsPanel");
    const playlistPanel = all().find((node) => node.attributes["data-qobuz-panel"] === "playlistBuilderPanel");
    find("ID / link album Qobuz", suggestionPanel).children[0].value = "00123";
    await find("Leggi suggerimenti · anteprima", suggestionPanel).click(); await tick();
    all(suggestionPanel).find((node) => node.attributes.type === "checkbox").checked = true;
    await find("Importa album selezionati", suggestionPanel).click(); await tick();
    assert.equal(imported[0].id, "qobuz:00123");
    const excluded = find("Artisti da escludere", suggestionPanel).children[0];
    excluded.value = "  artist ; Other, Artist ";
    await find("Salva filtri", suggestionPanel).click(); await tick();
    assert.equal(local.getItem("accord-qobuz-suggestion-excluded-artists-v1"), excluded.value);
    assert.equal(all(suggestionPanel).filter((node) => node.attributes.type === "checkbox").length, 0);
    await find("Leggi suggerimenti · anteprima", suggestionPanel).click(); await tick();
    assert.equal(all(suggestionPanel).filter((node) => node.attributes.type === "checkbox").length, 0);
    excluded.value = "Different Artist";
    await find("Salva filtri", suggestionPanel).click(); await tick();
    await find("Leggi suggerimenti · anteprima", suggestionPanel).click(); await tick();
    assert.equal(all(suggestionPanel).filter((node) => node.attributes.type === "checkbox").length, 1);
    await find("Elenca le mie playlist", playlistPanel).click(); await tick();
    await find("Scegli playlist", playlistPanel).click();
    assert.equal(find("ID / link playlist Qobuz", playlistPanel).children[0].value, "123");
    await find("Leggi playlist · anteprima", playlistPanel).click(); await tick();
    const choices = all(playlistPanel).filter((node) => node.attributes.type === "checkbox");
    assert.equal(choices.length, 2); choices.forEach((node) => { node.checked = true; });
    await find("Importa album selezionati", playlistPanel).click(); await tick();
    assert.equal(imported.length, 2, "two tracks from the same album import one album");
    const beforeCancel = calls.length;
    allow = false;
    await find("Sposta all'inizio", playlistPanel).click(); await tick();
    assert.equal(calls.length, beforeCancel, "canceling must not perform a fresh read or a write");
    allow = true; stalePlaylist = true;
    await find("Sposta all'inizio", playlistPanel).click(); await tick();
    assert.equal(calls.length, beforeCancel + 1, "stale playlist performs only the fresh read");
    assert.equal(calls.at(-1).options.method, "GET");
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), null);
    stalePlaylist = false;
    await find("Sposta all'inizio", playlistPanel).click(); await tick();
    assert.match(calls.at(-1).url, /playlist\/updateTracksPosition$/);
    assert.equal(calls.at(-1).options.body.get("playlist_track_ids"), "11,12");
    assert.equal(calls.at(-1).options.body.get("insert_before"), "0");
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), null);
    await find("Leggi playlist · anteprima", playlistPanel).click(); await tick();
    all(playlistPanel).filter((node) => node.attributes.type === "checkbox").forEach((node) => { node.checked = true; });
    await find("Sposta in fondo", playlistPanel).click(); await tick();
    assert.equal(calls.at(-1).options.body.get("insert_before"), "3");
    await find("Leggi playlist · anteprima", playlistPanel).click(); await tick();
    all(playlistPanel).filter((node) => node.attributes.type === "checkbox").forEach((node) => { node.checked = true; });
    failWrite = true;
    await find("Sposta all'inizio", playlistPanel).click(); await tick();
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), "1");
    const afterFailedMove = calls.length;
    await find("Sposta all'inizio", playlistPanel).click(); await tick();
    assert.equal(calls.length, afterFailedMove, "uncertain move blocks another read and write");
    await find("Ho verificato l'esito su Qobuz", playlistPanel).click(); await tick();
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), null);
    await find("Rimuovi brani selezionati", playlistPanel).click(); await tick();
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), "1");
    const last = calls.at(-1);
    assert.match(last.url, /playlist\/deleteTracks$/);
    assert.equal(last.options.body.get("playlist_track_ids"), "11,12");
    const count = calls.length;
    await find("Aggiungi brani selezionati", playlistPanel).click(); await tick();
    assert.equal(calls.length, count, "uncertain playlist write blocks subsequent writes");
    gate.select("tidal"); ui.setActive(); gate.select("qobuz"); ui.setActive();
    assert.equal(all(playlistPanel).filter((node) => node.attributes.type === "checkbox").length, 0);
    assert.equal(all(suggestionPanel).filter((node) => node.attributes.type === "checkbox").length, 0);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("Qobuz reorder does not write when the service changes during the fresh read", async () => {
  const root = new Node("main"), local = storage(), session = storage();
  session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "app", token: "secret" }));
  const track = { id: 1, playlist_track_id: 11, title: "Track", performer: { name: "Artist" } };
  const response = { id: 123, name: "Playlist", tracks_count: 1, is_public: false,
    tracks: { items: [track], offset: 0, total: 1 } };
  let release, reads = 0, writes = 0;
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
    localStorage: local, sessionStorage: session, confirm: () => true,
    navigator: { locks: { request: async (_name, run) => run() } },
    fetch: async (_url, options) => {
      if (options.method === "POST") { writes += 1; return new Response(JSON.stringify(response)); }
      reads += 1;
      if (reads === 2) return new Promise((resolve) => { release = resolve; });
      return new Response(JSON.stringify(response));
    },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const gate = createMusicServiceGate(local); gate.select("qobuz");
    const ui = initializeQobuzUI({ gate, addAlbum: () => true });
    const all = (node = root) => [node, ...node.children.flatMap(all)];
    const panel = all().find((node) => node.attributes["data-qobuz-panel"] === "playlistBuilderPanel");
    const find = (label) => { const node = all(panel).find((item) => item.text === label); assert.ok(node, label); return node; };
    find("ID / link playlist Qobuz").children[0].value = "123";
    await find("Leggi playlist · anteprima").click(); await tick();
    all(panel).find((node) => node.attributes.type === "checkbox").checked = true;
    await find("Sposta all'inizio").click(); await tick();
    assert.equal(reads, 2);
    gate.select("tidal"); ui.setActive();
    release(new Response(JSON.stringify(response)));
    await tick(); await tick();
    assert.equal(writes, 0);
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), null);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("Qobuz prepares tracks from suggested albums and keeps them when choosing a playlist", async () => {
  const root = new Node("main"), local = storage(), session = storage(), calls = [], views = [];
  session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "app", token: "secret" }));
  const albums = ["00123", "00456"].map((id, index) => ({
    id, title: `Album ${index + 1}`, artist: { name: "Artist" },
  }));
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
    localStorage: local, sessionStorage: session, confirm: () => true,
    navigator: { locks: { request: async (_name, run) => run() } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const request = new URL(url), path = request.pathname;
      if (path.endsWith("/album/suggest")) return new Response(JSON.stringify({ albums: { items: albums } }));
      if (path.endsWith("/album/get")) {
        const index = albums.findIndex((album) => album.id === request.searchParams.get("album_id"));
        return new Response(JSON.stringify({ ...albums[index],
          tracks: { items: index ? [{ id: 1, title: "First" }, { id: 101, title: "Last" }]
            : Array.from({ length: 100 }, (_, number) => ({ id: number + 1, title: `Track ${number + 1}` })),
            offset: 0, total: index ? 2 : 101 } }));
      }
      if (path.endsWith("/playlist/getUserPlaylists")) return new Response(JSON.stringify({
        playlists: { items: [{ id: 123, name: "Destination", tracks_count: 0, is_public: false }], offset: 0, total: 1 },
      }));
      if (path.endsWith("/playlist/addTracks") && options.method === "POST") return new Response('{"id":123}');
      throw new Error("Unexpected request");
    },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const gate = createMusicServiceGate(local); gate.select("qobuz");
    initializeQobuzUI({ gate, addAlbum: () => true, selectView: (view) => views.push(view) });
    const all = (node = root) => [node, ...node.children.flatMap(all)];
    const find = (label, node = root) => {
      const found = all(node).find((child) => child.text === label); assert.ok(found, label); return found;
    };
    const suggestions = all().find((node) => node.attributes["data-qobuz-panel"] === "suggestionsPanel");
    const playlists = all().find((node) => node.attributes["data-qobuz-panel"] === "playlistBuilderPanel");
    find("ID / link album Qobuz", suggestions).children[0].value = "00123";
    await find("Leggi suggerimenti · anteprima", suggestions).click(); await tick();
    all(suggestions).filter((node) => node.attributes.type === "checkbox").forEach((check) => { check.checked = true; });
    await find("Prepara playlist dagli album selezionati", suggestions).click(); await tick();
    assert.equal(views.at(-1), "playlists");
    assert.match(playlists.textContent, /Risultato parziale/);
    const checks = all(playlists).filter((node) => node.attributes.type === "checkbox");
    assert.equal(checks.length, 101);
    checks[0].checked = true;
    await find("Elenca le mie playlist", playlists).click(); await tick();
    await find("Scegli playlist", playlists).click();
    assert.equal(checks[0].checked, true);
    assert.equal(all(playlists).filter((node) => node.attributes.type === "checkbox").length, 101);
    assert.equal(calls.filter((call) => call.options.method === "POST").length, 0);
    checks.forEach((check) => { check.checked = true; });
    await find("Aggiungi brani selezionati", playlists).click(); await tick();
    assert.match(playlists.textContent, /Seleziona da 1 a 100 brani/);
    assert.equal(calls.filter((call) => call.options.method === "POST").length, 0);
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), null);
    checks.forEach((check, index) => { check.checked = index === 0; });
    await find("Aggiungi brani selezionati", playlists).click(); await tick();
    const writes = calls.filter((call) => call.options.method === "POST");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].options.body.get("playlist_id"), "123");
    assert.equal(writes[0].options.body.get("track_ids"), "1");
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("Qobuz keeps connection and player settings secondary and selects albums by name", async () => {
  const root = new Node("main"), settings = new Node("div"), local = storage(), session = storage();
  const mounts = new Map(["tidalCollectionMount", "suggestionsPanel", "playlistBuilderPanel"].map((id) => [id, new Node("section")]));
  root.append(...mounts.values(), settings);
  session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "app", token: "secret" }));
  const views = [], calls = [];
  let settingsOpened = false;
  const album = { id: "00123", title: "Test Album", artist: { name: "Artist" } };
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: (id) => mounts.get(id), querySelector: () => settings },
    localStorage: local, sessionStorage: session, confirm: () => true,
    navigator: { locks: { request: async (_name, run) => run() } },
    fetch: async (url) => {
      calls.push(String(url));
      const path = new URL(url).pathname;
      return new Response(JSON.stringify(path.endsWith("/album/suggest")
        ? { albums: { items: [album] } } : { albums: { items: [album], total: 1, offset: 0 } }));
    },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const gate = createMusicServiceGate(local); gate.select("qobuz");
    initializeQobuzUI({ gate, addAlbum: () => true, selectView: (view) => views.push(view),
      openSettings: () => { settingsOpened = true; } });
    const all = (node = root) => [node, ...node.children.flatMap(all)];
    const find = (label, node = root) => {
      const found = all(node).find((child) => child.text === label); assert.ok(found, label); return found;
    };
    const account = settings.children.find((node) => node.attributes.id === "qobuzConfiguration");
    assert.ok(account); assert.notEqual(account.open, true);
    await find("Collegamento Qobuz…").click();
    assert.equal(settingsOpened, true); assert.equal(account.open, true);
    const player = all().find((node) => node.attributes["aria-label"] === "Player Qobuz");
    const playerSettings = player.children.find((node) => node.tag === "details");
    assert.notEqual(playerSettings.open, true);
    await find("Leggi preferiti").click(); await tick();
    await find("Usa per suggerimenti", mounts.get("tidalCollectionMount")).click();
    assert.equal(views.at(-1), "suggestions");
    assert.ok(all().some((node) => node.text === "Album selezionato: Artist · Test Album"));
    await find("Leggi suggerimenti · anteprima").click(); await tick();
    assert.equal(new URL(calls.at(-1)).searchParams.get("album_id"), "00123");
    await find("Usa per playlist", mounts.get("tidalCollectionMount")).click();
    assert.equal(views.at(-1), "playlists");
    assert.equal(find("ID / link album Qobuz", mounts.get("playlistBuilderPanel")).children[0].value, "qobuz:00123");
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("Qobuz playlist edits preserve a loaded description and require an explicit value when unavailable", async () => {
  const root = new Node("main"), local = storage(), session = storage(), writes = [];
  session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "app", token: "secret" }));
  let description = "Original";
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
    localStorage: local, sessionStorage: session, confirm: () => true,
    navigator: { locks: { request: async (_name, run) => run() } },
    fetch: async (url, options) => {
      if (options.method === "POST") {
        writes.push(options.body);
        return new Response('{"id":"123","status":"success"}');
      }
      const result = { id: 123, name: "Existing", tracks_count: 0, is_public: false,
        tracks: { items: [], offset: 0, total: 0 } };
      if (description !== undefined) result.description = description;
      return new Response(JSON.stringify(result));
    },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const gate = createMusicServiceGate(local); gate.select("qobuz");
    initializeQobuzUI({ gate, addAlbum: () => true });
    const all = (node = root) => [node, ...node.children.flatMap(all)];
    const find = (label) => { const found = all().find((node) => node.text === label); assert.ok(found, label); return found; };
    const id = find("ID / link playlist Qobuz").children[0];
    const name = find("Nome playlist").children[0], field = find("Descrizione playlist").children[0];
    id.value = "123";
    await find("Leggi playlist · anteprima").click(); await tick();
    assert.equal(field.value, "Original");
    name.value = "Renamed";
    await find("Salva nome e descrizione").click(); await tick();
    assert.equal(writes.length, 1); assert.equal(writes[0].get("description"), "Original");
    assert.equal(local.getItem("accord-qobuz-write-uncertain-v1"), null);
    description = undefined;
    await find("Leggi playlist · anteprima").click(); await tick();
    name.value = "Another name";
    await find("Salva nome e descrizione").click(); await tick();
    assert.equal(writes.length, 1);
    field.value = "Replacement"; field.listeners.input();
    await find("Salva nome e descrizione").click(); await tick();
    assert.equal(writes.length, 2); assert.equal(writes[1].get("description"), "Replacement");
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("Qobuz suggestions from favorites are bounded, deduplicated and stop on provider change", async () => {
  const root = new Node("main"), local = storage(), session = storage(), seeds = [];
  session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "app", token: "secret" }));
  const album = (id) => ({ id, title: `Album ${id}`, artist: { name: "Artist" } });
  let gate, switchDuringRead = false;
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
    localStorage: local, sessionStorage: session, confirm: () => true,
    navigator: { locks: { request: async (_name, run) => run() } },
    fetch: async (url) => {
      if (new URL(url).pathname.endsWith("/favorite/getUserFavorites")) {
        return new Response(JSON.stringify({ albums: { items: Array.from({ length: 7 }, (_, i) => album(`00${i + 1}`)),
          total: 12, offset: 0 } }));
      }
      seeds.push(new URL(url).searchParams.get("album_id"));
      if (switchDuringRead) gate.select("tidal");
      return new Response(JSON.stringify({ albums: { items: [album("001"), album("0099"), album("0099")] } }));
    },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    gate = createMusicServiceGate(local); gate.select("qobuz");
    const ui = initializeQobuzUI({ gate, addAlbum: () => true });
    const all = (node = root) => [node, ...node.children.flatMap(all)];
    const panel = all().find((node) => node.attributes["data-qobuz-panel"] === "suggestionsPanel");
    const action = all(panel).find((node) => node.text === "Suggerimenti dai miei preferiti");
    const shared = await ui.suggestionAPI.native("favorites");
    assert.deepEqual(shared.rows.map((row) => row.album.id), ["qobuz:0099"]);
    assert.equal(shared.complete, false);
    assert.deepEqual(seeds, ["001", "002", "003", "004", "005"]);
    seeds.length = 0;
    await assert.rejects(ui.suggestionAPI.native("favorites", () => { throw new Error("account changed"); }), /account changed/);
    assert.equal(seeds.length, 0);
    await action.click(); await tick(); await tick();
    assert.deepEqual(seeds, ["001", "002", "003", "004", "005"]);
    assert.equal(all(panel).filter((node) => node.attributes.type === "checkbox").length, 1);
    assert.match(panel.textContent, /primi 7 letti su 12; non sono cronologia/);
    switchDuringRead = true;
    await action.click(); await tick(); await tick();
    assert.equal(seeds.length, 6);
    ui.setActive();
    assert.equal(all(panel).filter((node) => node.attributes.type === "checkbox").length, 0);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("Qobuz playlist pagination returns to actual offsets when pages are short", async () => {
  const root = new Node("main"), local = storage(), session = storage(), offsets = [];
  session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "app", token: "secret" }));
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
    localStorage: local, sessionStorage: session, confirm: () => true,
    navigator: { locks: { request: async (_name, run) => run() } },
    fetch: async (url) => {
      const offset = Number(new URL(url).searchParams.get("offset")); offsets.push(offset);
      return new Response(JSON.stringify({ playlists: { offset, total: 3, items: [
        { id: offset + 1, name: "Playlist", tracks_count: 0, is_public: false },
      ] } }));
    },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const gate = createMusicServiceGate(local); gate.select("qobuz");
    initializeQobuzUI({ gate, addAlbum: () => true });
    const all = (node) => [node, ...node.children.flatMap(all)];
    const panel = all(root).find((node) => node.attributes["data-qobuz-panel"] === "playlistBuilderPanel");
    const click = async (label) => { await all(panel).find((node) => node.text === label).click(); await tick(); };
    await click("Elenca le mie playlist"); await click("Pagina successiva");
    await click("Pagina successiva"); await click("Pagina precedente");
    assert.deepEqual(offsets, [0, 1, 2, 1]);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("Qobuz audio uses a local bundle and stops when the service changes", async () => {
  const root = new Node("main"), local = storage(), session = storage(), calls = [];
  let delayStream = false, finishStream, streamSignal;
  session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "123456789", token: "synthetic-token" }));
  const encoded = btoa("synthetic-secret");
  const bundle = `production:{api:{appId:"123456789" a.initialSeed("${encoded.slice(0, 4)}",window.utimezone.alpha)`
    + ` name:"America/Alpha",info:"${encoded.slice(4, 8)}",extras:"${encoded.slice(8)}${"A".repeat(44)}"`;
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
    localStorage: local, sessionStorage: session, confirm: () => true,
    navigator: { locks: { request: async (_name, run) => run() } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (new URL(url).pathname.endsWith("/track/getFileUrl")) {
        if (delayStream) {
          streamSignal = options.signal;
          await new Promise((resolve) => { finishStream = resolve; });
        }
        return new Response(JSON.stringify({ url: "https://streaming-qobuz-std.akamaized.net/audio?synthetic=1" }));
      }
      if (new URL(url).pathname.endsWith("/favorite/getUserFavorites")) {
        return new Response(JSON.stringify({ albums: { items: [], total: 0, offset: 0 } }));
      }
      return new Response(JSON.stringify({ id: 123, name: "Playlist", tracks_count: 1, is_public: false,
        tracks: { total: 1, offset: 0, items: [{ id: 42, playlist_track_id: 99,
          title: "Track", performer: { name: "Artist" } }] } }));
    },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const gate = createMusicServiceGate(local); gate.select("qobuz");
    const ui = initializeQobuzUI({ gate, addAlbum: () => true });
    const all = (node = root) => [node, ...node.children.flatMap(all)];
    const find = (label) => { const node = all().find((item) => item.text === label); assert.ok(node, label); return node; };
    const file = find("Bundle pubblico Qobuz (bundle.js)").children[0];
    file.files = [{ size: bundle.length, text: async () => bundle }];
    file.listeners.change(); await tick();
    find("ID / link playlist Qobuz").children[0].value = "123";
    await find("Leggi playlist · anteprima").click(); await tick();
    all().find((node) => node.attributes.type === "checkbox").checked = true;
    await find("Riproduci selezionati").click(); await tick();
    const audio = all().find((node) => node.tag === "audio");
    assert.match(audio.src, /^https:\/\/streaming-qobuz-std/);
    assert.equal(audio.paused, false);
    assert.equal(new URL(calls.at(-1).url).searchParams.get("track_id"), "42");
    find("X-App-Id della sessione web").children[0].value = "123456789";
    find("X-User-Auth-Token (non password)").children[0].value = "another-synthetic-token";
    await find("Collega Qobuz").click(); await tick();
    assert.equal(audio.src, "");
    assert.equal(find("Chiave del bundle").children[0].children.length, 0);
    file.files = [{ size: bundle.length, text: async () => bundle }];
    file.listeners.change(); await tick();
    find("ID / link playlist Qobuz").children[0].value = "123";
    await find("Leggi playlist · anteprima").click(); await tick();
    all().find((node) => node.attributes.type === "checkbox").checked = true;
    delayStream = true;
    await find("Riproduci selezionati").click(); await tick();
    assert.ok(streamSignal && !streamSignal.aborted);
    await find("Ferma player").click();
    assert.equal(streamSignal.aborted, true);
    finishStream(); await tick();
    assert.equal(audio.src, "");
    await find("Riproduci selezionati").click(); await tick();
    assert.equal(streamSignal.aborted, false);
    gate.select("spotify"); ui.setActive();
    assert.equal(streamSignal.aborted, true);
    gate.select("qobuz"); ui.setActive();
    finishStream(); await tick();
    assert.equal(audio.paused, true);
    assert.equal(audio.src, "");
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("Qobuz plays selected occurrences in order and advances locally", async () => {
  const root = new Node("main"), local = storage(), session = storage(), trackIds = [];
  session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "123456789", token: "synthetic-token" }));
  const encoded = btoa("synthetic-secret");
  const bundle = `production:{api:{appId:"123456789" a.initialSeed("${encoded.slice(0, 4)}",window.utimezone.alpha)`
    + ` name:"America/Alpha",info:"${encoded.slice(4, 8)}",extras:"${encoded.slice(8)}${"A".repeat(44)}"`;
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
    localStorage: local, sessionStorage: session, confirm: () => true,
    navigator: { locks: { request: async (_name, run) => run() } },
    fetch: async (url) => {
      if (new URL(url).pathname.endsWith("/track/getFileUrl")) {
        trackIds.push(new URL(url).searchParams.get("track_id"));
        return new Response(JSON.stringify({ url: "https://streaming-qobuz-std.akamaized.net/audio?synthetic=1" }));
      }
      return new Response(JSON.stringify({ id: 123, name: "Playlist", tracks_count: 3, is_public: false,
        tracks: { total: 3, offset: 0, items: [
          { id: 42, playlist_track_id: 1, title: "First" },
          { id: 43, playlist_track_id: 2, title: "Other" },
          { id: 42, playlist_track_id: 3, title: "First again" },
        ] } }));
    },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const gate = createMusicServiceGate(local); gate.select("qobuz");
    const ui = initializeQobuzUI({ gate, addAlbum: () => true });
    const all = (node = root) => [node, ...node.children.flatMap(all)];
    const find = (label) => { const node = all().find((item) => item.text === label); assert.ok(node, label); return node; };
    const file = find("Bundle pubblico Qobuz (bundle.js)").children[0];
    file.files = [{ size: bundle.length, text: async () => bundle }];
    file.listeners.change(); await tick();
    find("ID / link playlist Qobuz").children[0].value = "123";
    await find("Leggi playlist · anteprima").click(); await tick();
    const choices = all().filter((node) => node.attributes.type === "checkbox");
    choices[2].checked = true; choices[0].checked = true;
    await find("Riproduci selezionati").click(); await tick();
    const audio = all().find((node) => node.tag === "audio");
    const queue = all().find((node) => node.attributes["aria-label"] === "Brani preparati per il player Qobuz");
    assert.deepEqual(trackIds, ["42"]);
    assert.match(queue.children[0].textContent, /^Brano corrente: First /);
    audio.listeners.ended(); await tick(); await tick();
    assert.deepEqual(trackIds, ["42", "42"]);
    assert.match(queue.children[1].textContent, /^Brano corrente: First again /);
    audio.listeners.ended(); await tick();
    assert.equal(trackIds.length, 2);
    await find("Precedente").click(); await tick(); await tick();
    assert.equal(trackIds.length, 3);
    gate.select("tidal"); ui.setActive();
    assert.equal(audio.src, "");
    assert.equal(queue.children.length, 0);
    audio.listeners.ended(); await tick();
    assert.equal(trackIds.length, 3);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("Qobuz shuffle and repeat affect the local queue without changing the current track", async () => {
  const root = new Node("main"), local = storage(), session = storage(), trackIds = [];
  session.setItem("accord-qobuz-session-v1", JSON.stringify({ appId: "123456789", token: "synthetic-token" }));
  const encoded = btoa("synthetic-secret");
  const bundle = `production:{api:{appId:"123456789" a.initialSeed("${encoded.slice(0, 4)}",window.utimezone.alpha)`
    + ` name:"America/Alpha",info:"${encoded.slice(4, 8)}",extras:"${encoded.slice(8)}${"A".repeat(44)}"`;
  const overrides = {
    document: { createElement: (tag) => new Node(tag), getElementById: () => root, querySelector: () => root },
    localStorage: local, sessionStorage: session, confirm: () => true,
    navigator: { locks: { request: async (_name, run) => run() } },
    fetch: async (url) => {
      if (new URL(url).pathname.endsWith("/track/getFileUrl")) {
        trackIds.push(new URL(url).searchParams.get("track_id"));
        return new Response(JSON.stringify({ url: "https://streaming-qobuz-std.akamaized.net/audio?synthetic=1" }));
      }
      return new Response(JSON.stringify({ id: 123, name: "Playlist", tracks_count: 3, is_public: false,
        tracks: { total: 3, offset: 0, items: [
          { id: 41, title: "First" }, { id: 42, title: "Second" }, { id: 43, title: "Third" },
        ] } }));
    },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const originalRandom = Math.random;
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const gate = createMusicServiceGate(local); gate.select("qobuz");
    const ui = initializeQobuzUI({ gate, addAlbum: () => true });
    const all = (node = root) => [node, ...node.children.flatMap(all)];
    const find = (label) => { const node = all().find((item) => item.text === label); assert.ok(node, label); return node; };
    const file = find("Bundle pubblico Qobuz (bundle.js)").children[0];
    file.files = [{ size: bundle.length, text: async () => bundle }];
    file.listeners.change(); await tick();
    find("ID / link playlist Qobuz").children[0].value = "123";
    await find("Leggi playlist · anteprima").click(); await tick();
    all().filter((node) => node.attributes.type === "checkbox").forEach((choice) => { choice.checked = true; });
    await find("Riproduci selezionati").click(); await tick();
    const audio = all().find((node) => node.tag === "audio");
    const queue = all().find((node) => node.attributes["aria-label"] === "Brani preparati per il player Qobuz");
    const repeat = all().find((node) => node.attributes["aria-label"] === "Ripetizione del player Qobuz");
    Math.random = () => 0;
    await find("Casuale").click();
    assert.match(queue.children[0].textContent, /First/);
    assert.match(queue.children[1].textContent, /Third/);
    await find("Casuale").click();
    assert.match(queue.children[1].textContent, /Second/);
    repeat.value = "track"; repeat.listeners.change();
    audio.listeners.ended(); await tick(); await tick();
    assert.deepEqual(trackIds, ["41", "41"]);
    repeat.value = "context"; repeat.listeners.change();
    await find("Precedente").click(); await tick(); await tick();
    assert.equal(trackIds.at(-1), "43");
    audio.listeners.ended(); await tick(); await tick();
    assert.equal(trackIds.at(-1), "41");
    gate.select("spotify"); ui.setActive();
    assert.equal(audio.src, "");
  } finally {
    Math.random = originalRandom;
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
