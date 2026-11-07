import test from "node:test";
import assert from "node:assert/strict";
import { openMusicCompletion } from "./music-completion-ui.mjs";
import { COMPLETION_KEY } from "./music-completion.mjs";

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = new Map(); this.textContent = ""; }
  append(...items) { this.children.push(...items); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  async dispatch(name) {
    for (const callback of this.listeners.get(name) || []) await callback({ preventDefault() {} });
  }
  showModal() { this.open = true; }
  close() { this.open = false; void this.dispatch("close"); }
  remove() { this.removed = true; }
}
const ID = "a".repeat(22), SECOND = "b".repeat(22);
function fixture(ids = [ID]) {
  const albums = ids.map((id) => ({ id, name: "Album", artist: "Band", genres: [], rating: 4.5 }));
  const map = new Map([["accord-album-pwa-v1", JSON.stringify({ albums })]]);
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key) };
  const document = { body: new Node("body"), createElement: (tag) => new Node(tag) };
  const calls = [];
  const read = async (row, consume) => {
    consume(); calls.push(row.album.id);
    return { id: row.target, total: 1, next: null, tracks: [{ id: row.album.id, duration_ms: 100 }] };
  };
  const options = { storage, document, albums, ids, provider: "spotify", read, guard: () => {} };
  const walk = (node) => [node, ...node.children.flatMap(walk)];
  const find = (dialog, text) => {
    const node = walk(dialog).find((item) => item.textContent === text);
    assert.ok(node, text); return node;
  };
  return { options, calls, walk, find, storage };
}

test("PWA completion dialog opening and checkbox changes perform no reads or checkpoint writes", async () => {
  const f = fixture();
  const dialog = openMusicCompletion(f.options);
  assert.equal(dialog.open, true);
  assert.deepEqual(f.calls, []);
  assert.equal(f.storage.getItem(COMPLETION_KEY), null);
  const checkboxes = f.walk(dialog).filter((node) => node.type === "checkbox");
  assert.equal(checkboxes.length, 3);
  checkboxes[1].checked = false; await checkboxes[1].dispatch("change");
  const listing = f.walk(dialog).find((node) => node.tag === "pre");
  assert.ok(!listing.textContent.includes("Generi Last.fm"));
  assert.deepEqual(f.calls, []);
  assert.equal(f.storage.getItem(COMPLETION_KEY), null);
  assert.throws(() => openMusicCompletion(f.options), /gia' aperto/);
  await f.find(dialog, "Chiudi").dispatch("click");
  assert.equal(dialog.removed, true);
});

test("duration-only confirmation reads exactly selected albums and preserves published result in the dialog", async () => {
  const f = fixture();
  const dialog = openMusicCompletion({ ...f.options, durationsOnly: true });
  const checkboxes = f.walk(dialog).filter((node) => node.type === "checkbox");
  assert.deepEqual(checkboxes.map((node) => node.checked), [true, false, false]);
  assert.ok(checkboxes.every((node) => node.disabled));
  await f.find(dialog, "Avvia letture esplicite").dispatch("click");
  assert.deepEqual(f.calls, [ID]);
  assert.equal(JSON.parse(f.storage.getItem(COMPLETION_KEY)).rows[0].status, "completed");
  assert.match(f.walk(dialog).find((node) => node.tag === "pre").textContent, /100 ms/);
  await f.find(dialog, "Chiudi").dispatch("click");
});

test("Stop during the current page saves pending state and Continue resumes after reopening", async () => {
  const f = fixture([ID, SECOND]);
  let release, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const hold = new Promise((resolve) => { release = resolve; });
  const dialog = openMusicCompletion({ ...f.options, durationsOnly: true, read: async (row, consume) => {
    entered(); await hold; return f.options.read(row, consume);
  } });
  const action = f.find(dialog, "Avvia letture esplicite").dispatch("click");
  await started;
  await f.find(dialog, "Stop").dispatch("click");
  release(); await action;
  assert.equal(JSON.parse(f.storage.getItem(COMPLETION_KEY)).state, "stopped");
  assert.deepEqual(f.calls, []);
  await f.find(dialog, "Chiudi").dispatch("click");
  const resumed = openMusicCompletion({ ...f.options, resume: true });
  await f.find(resumed, "Continua letture").dispatch("click");
  assert.deepEqual(f.calls, [ID, SECOND]);
  await f.find(resumed, "Chiudi").dispatch("click");
});

test("active Retry-After blocks Start without reads; failure is explicit and Continue remains available", async () => {
  const f = fixture();
  f.storage.setItem("accord-spotify-rate-limit-until-v1", String(Date.now() + 120000));
  const dialog = openMusicCompletion({ ...f.options, durationsOnly: true });
  await f.find(dialog, "Avvia letture esplicite").dispatch("click");
  assert.deepEqual(f.calls, []);
  assert.equal(f.storage.getItem(COMPLETION_KEY), null);
  assert.match(f.walk(dialog).find((node) => node.role === "status").textContent, /Pausa condivisa/);
  f.storage.removeItem("accord-spotify-rate-limit-until-v1");
  await f.find(dialog, "Avvia letture esplicite").dispatch("click");
  assert.deepEqual(f.calls, [ID]);
  await f.find(dialog, "Chiudi").dispatch("click");
});

test("unavailable evidence stays pending with explicit error and source tooltip; no fake score", async () => {
  const f = fixture();
  const dialog = openMusicCompletion({ ...f.options, read: async () => { throw new Error("Discogs HTTP 403 non disponibile"); } });
  const checks = f.walk(dialog).filter((node) => node.type === "checkbox");
  checks[0].checked = false; checks[1].checked = false; await checks[1].dispatch("change");
  const evidenceLabel = f.walk(dialog).find((node) => node.title?.includes("Discogs"));
  assert.match(evidenceLabel.title, /nessuno scraping o dato simulato/);
  await f.find(dialog, "Avvia letture esplicite").dispatch("click");
  const saved = JSON.parse(f.storage.getItem(COMPLETION_KEY));
  assert.equal(saved.rows[0].status, "pending");
  assert.equal(saved.state, "paused");
  assert.match(f.walk(dialog).find((node) => node.role === "status").textContent, /403/);
  await f.find(dialog, "Chiudi").dispatch("click");
});
