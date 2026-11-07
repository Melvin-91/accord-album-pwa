import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPLETION_KEY, COMPLETION_EVIDENCE_KEY, COMPLETION_PROVENANCE_KEY, createCompletionPlan,
  continueCompletion, acceptDurationPage, applyCompletion, runCompletion, readCatalogPage, isoDurationMs,
} from "./music-completion.mjs";
import { setEditionLink } from "./music-continuity.mjs";
import { createTidalTransport } from "./tidal.mjs";
import { createSpotifyJsonReader, createSpotifyTransport } from "./core.mjs";
import { createQobuzClient } from "./qobuz.mjs";

const ID = "a".repeat(22), SECOND = "b".repeat(22);
const COLLECTION = "accord-album-pwa-v1", DURATIONS = "accord-listening-album-durations-v1";
const album = (id = ID) => ({ id, name: "Album", artist: "Band", genres: [], primary_genre: "", rating: 4.5 });
const store = (albums = [album()]) => {
  const map = new Map([[COLLECTION, JSON.stringify({ albums, base: [], preferences: { keep: true } })]]);
  return { map, getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
};
const json = (storage, key, fallback = {}) => JSON.parse(storage.getItem(key) || JSON.stringify(fallback));
const plan = (storage, categories = ["duration"], provider = "spotify") =>
  createCompletionPlan(storage, json(storage, COLLECTION).albums, provider, categories);
const page = (id = ID, total = 1, tracks = [{ id: "track1", duration_ms: 120001 }], next = null) =>
  ({ id, total, tracks, next });
const read = async (row, consume) => { consume(); return page(row.target); };
const run = (storage, current, limit = 1, reader = read, options = {}) =>
  runCompletion({ storage, plan: current, limit, read: reader, ...options });

test("local planning and opening selections require no fetch and do not save a checkpoint", () => {
  const storage = store(), current = plan(storage);
  assert.equal(current.rows[0].target, ID);
  assert.deepEqual(continueCompletion(current, plan(storage)), current);
  assert.equal(storage.getItem(COMPLETION_KEY), null);
});

test("no silent title matching: cross-service albums require explicit current-edition links", async () => {
  const storage = store(), current = plan(storage, ["duration"], "tidal");
  assert.equal(current.rows[0].status, "blocked");
  await run(storage, current, 10, () => { throw new Error("unexpected read"); });
  setEditionLink(storage, album(), "tidal", { id: "tidal:42", name: "Chosen" });
  assert.equal(plan(storage, ["duration"], "tidal").rows[0].target, "tidal:42");
  const changed = album(); changed.name = "Other";
  storage.setItem(COLLECTION, JSON.stringify({ albums: [changed] }));
  assert.equal(plan(storage, ["duration"], "tidal").rows[0].status, "blocked");
});

test("durations are exact positive ms, with complete-track provenance and personal fields unchanged", async () => {
  const storage = store(), before = json(storage, COLLECTION);
  const result = await run(storage, plan(storage));
  assert.equal(result.state, "completed");
  assert.equal(result.reads, 1);
  assert.equal(json(storage, DURATIONS)[ID], 120001);
  const saved = json(storage, COLLECTION);
  assert.deepEqual(saved.albums, before.albums);
  assert.deepEqual(saved.base, before.base);
  assert.deepEqual(saved.preferences, before.preferences);
  assert.equal(saved.collectionHistory.length, 1);
  assert.equal(saved.collectionHistory[0].storageChanges[0].field, "durata");
  assert.equal(json(storage, COMPLETION_PROVENANCE_KEY)[ID].duration.complete_tracks, 1);
  assert.equal(json(storage, COMPLETION_PROVENANCE_KEY)[ID].duration.target, ID);
});

test("budget and restart resume only missing albums; completed results are reusable without requests", async () => {
  const storage = store([album(), album(SECOND)]), calls = [];
  const reader = async (row, consume) => { calls.push(row.target); return read(row, consume); };
  await run(storage, plan(storage), 1, reader);
  assert.equal(json(storage, COMPLETION_KEY).state, "budget");
  assert.equal(Object.keys(json(storage, DURATIONS)).length, 1);
  const resumed = continueCompletion(json(storage, COMPLETION_KEY), plan(storage));
  await run(storage, resumed, 1, reader);
  assert.deepEqual(calls, [ID, SECOND]);
  await run(storage, plan(storage), 10, () => { throw new Error("unexpected request"); });
});

test("partial track lists are checkpointed but never published as a full duration", async () => {
  const storage = store(), calls = [];
  const reader = async (row, consume) => {
    consume(); calls.push(row.cursor);
    return row.cursor === null ? page(ID, 2, [{ id: "one", duration_ms: 100 }], 1)
      : page(ID, 2, [{ id: "two", duration_ms: 200 }]);
  };
  await run(storage, plan(storage), 1, reader);
  assert.deepEqual(json(storage, DURATIONS), {});
  assert.equal(json(storage, COMPLETION_KEY).rows[0].tracks.length, 1);
  await run(storage, json(storage, COMPLETION_KEY), 1, reader);
  assert.deepEqual(calls, [null, 1]);
  assert.equal(json(storage, DURATIONS)[ID], 300);
});

test("wrong identity, invalid durations, missing tracks, duplicates and overflows never mutate accepted pages", () => {
  const storage = store();
  for (const invalid of [
    page(SECOND), page(ID, 2), page(ID, 1, [{ id: "one", duration_ms: true }]),
    page(ID, 1, [{ id: "one", duration_ms: 0 }]),
    page(ID, 2, [{ id: "one", duration_ms: 1 }, { id: "one", duration_ms: 2 }]),
    page(ID, 2, [{ id: "one", duration_ms: Number.MAX_SAFE_INTEGER }, { id: "two", duration_ms: 2 }]),
  ]) {
    const row = plan(storage).rows[0];
    assert.throws(() => acceptDurationPage(row, invalid));
    assert.deepEqual(row.tracks, []);
  }
});

test("changing totals and cyclic cursors cannot publish partial or duplicate totals", () => {
  const row = plan(store()).rows[0];
  acceptDurationPage(row, page(ID, 3, [{ id: "one", duration_ms: 1 }], 1));
  const before = structuredClone(row);
  assert.throws(() => acceptDurationPage(row, page(ID, 4, [{ id: "two", duration_ms: 1 }], 2)));
  assert.throws(() => acceptDurationPage(row, page(ID, 3, [{ id: "two", duration_ms: 1 }], 1)));
  assert.deepEqual(row, before);
});

test("manual and queued durations win even if added during an in-flight read", async () => {
  const storage = store();
  await run(storage, plan(storage), 1, async (row, consume) => {
    consume(); storage.setItem(DURATIONS, JSON.stringify({ [ID]: 777 }));
    return page();
  });
  assert.equal(json(storage, DURATIONS)[ID], 777);
  assert.equal(json(storage, COMPLETION_KEY).rows[0].status, "preserved");
  storage.removeItem(DURATIONS);
  storage.setItem("accord-listening-queue-v1", JSON.stringify({ durations: { [ID]: 444 } }));
  await run(storage, plan(storage), 1, () => { throw new Error("request despite queue duration"); });
  assert.equal(storage.getItem(DURATIONS), null);
});

test("manual genres including explicitly empty choices are preserved", async () => {
  const storage = store([{ ...album(), genre_source: "manual" }]);
  await run(storage, plan(storage, ["genres"]), 1, () => { throw new Error("request despite manual choice"); });
  assert.deepEqual(json(storage, COLLECTION).albums[0].genres, []);
});

test("missing genres and supported evidence preserve ratings, tags, base and provenance", async () => {
  const storage = store([{ ...album(), tags: ["Keep"] }]);
  const before = json(storage, COLLECTION);
  await run(storage, plan(storage, ["genres", "evidence"]), 2, async (row, consume) => {
    consume();
    return row.category === "genres" ? ["Power metal"] : { source: "Discogs", detail: "Campione 5/20" };
  });
  const saved = json(storage, COLLECTION);
  assert.equal(saved.albums[0].rating, 4.5);
  assert.deepEqual(saved.albums[0].tags, ["Keep"]);
  assert.deepEqual(saved.albums[0].genres, ["Power metal"]);
  assert.deepEqual(saved.base, before.base);
  assert.deepEqual(saved.preferences, before.preferences);
  assert.equal(json(storage, COMPLETION_EVIDENCE_KEY)[ID].detail, "Campione 5/20");
});

test("empty responses are explicitly unavailable, not fabricated completions", async () => {
  const storage = store();
  await run(storage, plan(storage, ["genres"]), 1, async (_row, consume) => { consume(); return []; });
  assert.equal(json(storage, COMPLETION_KEY).rows[0].status, "unavailable");
  assert.equal(storage.getItem(COMPLETION_PROVENANCE_KEY), null);
});

test("Stop preserves completed results and prevents the next read", async () => {
  const storage = store([album(), album(SECOND)]), controller = new AbortController();
  let calls = 0;
  await run(storage, plan(storage), 10, async (row, consume) => {
    consume(); calls += 1; return page(row.target);
  }, { signal: controller.signal, committed: () => controller.abort() });
  assert.equal(calls, 1);
  assert.equal(json(storage, COMPLETION_KEY).state, "stopped");
  assert.equal(json(storage, DURATIONS)[ID], 120001);
  await run(storage, json(storage, COMPLETION_KEY), 1);
  assert.equal(Object.keys(json(storage, DURATIONS)).length, 2);
});

test("stale identity, stale association and changed service are rejected without more requests", async () => {
  const storage = store(), current = plan(storage);
  storage.setItem(COLLECTION, JSON.stringify({ albums: [{ ...album(), name: "Other" }] }));
  await assert.rejects(run(storage, current, 1, () => { throw new Error("unexpected request"); }), /cambiati/);
  assert.throws(() => continueCompletion(current, plan(storage)), /cambiate/);
  assert.throws(() => applyCompletion(storage, current.rows[0], 123), /cambiato/);
  await assert.rejects(run(storage, plan(storage), 1, read, { guard: () => { throw new Error("service changed"); } }), /service changed/);
});

test("save failure rolls back only completion writes without altering collection or manual values", () => {
  const storage = store(), row = plan(storage).rows[0], before = storage.getItem(COLLECTION);
  const set = storage.setItem;
  storage.setItem = (key, value) => { if (key === COMPLETION_PROVENANCE_KEY) throw new Error("full"); set(key, value); };
  assert.throws(() => applyCompletion(storage, row, 123), /full/);
  assert.equal(storage.getItem(COLLECTION), before);
  assert.equal(storage.getItem(DURATIONS), null);
});

test("Spotify pages verify album ID, exact count, cursor and duration milliseconds", async () => {
  const storage = store(), calls = [];
  const api = { request: async (path) => {
    calls.push(path);
    return calls.length === 1 ? { id: ID, total_tracks: 2, tracks: { total: 2, offset: 0,
      items: [{ id: "one", duration_ms: 11 }], next: `https://api.spotify.com/v1/albums/${ID}/tracks?offset=1&limit=1` } }
      : { offset: 1, total: 2, items: [{ id: "two", duration_ms: 22 }], next: null };
  } };
  const reader = (row, consume) => readCatalogPage("spotify", api, row, consume);
  await run(storage, plan(storage), 1, reader);
  assert.equal(calls.length, 1); assert.equal(storage.getItem(DURATIONS), null);
  await run(storage, json(storage, COMPLETION_KEY), 1, reader);
  assert.equal(calls.length, 2); assert.equal(json(storage, DURATIONS)[ID], 33);
});

test("TIDAL metadata and tracks are independently budgeted and do not hydrate hidden resources", async () => {
  const storage = store(), calls = [];
  setEditionLink(storage, album(), "tidal", { id: "tidal:42", name: "Chosen" });
  const api = { completionPage: async (path) => {
    calls.push(path);
    return calls.length === 1 ? { data: { type: "albums", id: "42", attributes: { numberOfTracks: 1 } } }
      : { data: [{ type: "tracks", id: "7" }], included: [{ type: "tracks", id: "7", attributes: { duration: "PT1M2.003S" } }] };
  } };
  const reader = (row, consume) => readCatalogPage("tidal", api, row, consume);
  await run(storage, plan(storage, ["duration"], "tidal"), 1, reader);
  assert.equal(calls.length, 1); assert.equal(storage.getItem(DURATIONS), null);
  await run(storage, json(storage, COMPLETION_KEY), 1, reader);
  assert.equal(calls.length, 2); assert.equal(json(storage, DURATIONS)[ID], 62003);
});

test("Qobuz native identities and millisecond conversion retain leading zeroes", async () => {
  const storage = store(), api = { albumTracks: async (id, offset) => {
    assert.equal(id, "qobuz:00123"); assert.equal(offset, 0);
    return { album: { album: { id } }, total: 1, next: null, tracks: [{ id: "7", duration: 99 }] };
  } };
  setEditionLink(storage, album(), "qobuz", { id: "qobuz:00123", name: "Chosen" });
  const reader = (row, consume) => readCatalogPage("qobuz", api, row, consume);
  await run(storage, plan(storage, ["duration"], "qobuz"), 1, reader);
  assert.equal(json(storage, DURATIONS)[ID], 99000);
});

test("cached Spotify and TIDAL reads reuse existing HTTP-aware caches without refetch", async () => {
  const storage = store(), calls = [];
  const transport = createTidalTransport({ storage, fetch: async (url) => {
    calls.push(url); return new Response(JSON.stringify({ data: { id: "42" } }), { headers: { "Cache-Control": "max-age=300" } });
  } });
  await transport.request("albums/42", "synthetic");
  await transport.request("albums/42", "synthetic");
  assert.equal(calls.length, 1);
  const reader = createSpotifyJsonReader();
  let spotifyCalls = 0;
  const response = async () => { spotifyCalls += 1; return new Response(JSON.stringify({ id: ID }),
    { headers: { "Cache-Control": "max-age=300" } }); };
  await reader.read(`https://api.spotify.com/v1/albums/${ID}`, "synthetic", response);
  await reader.read(`https://api.spotify.com/v1/albums/${ID}`, "synthetic", response);
  assert.equal(spotifyCalls, 1);
});

test("real Qobuz transport persists 429 cooldown; resume before deadline sends no request", async () => {
  const storage = store();
  let now = 100000, calls = 0;
  const api = createQobuzClient({ appId: "synthetic", token: "synthetic", storage, now: () => now,
    sleep: async (ms) => { now += ms; }, jitter: () => 0,
    fetch: async () => {
      calls += 1;
      if (calls === 1) return new Response("{}", { status: 429, headers: { "Retry-After": "120" } });
      return new Response(JSON.stringify({ id: "00123", title: "Album", artist: { name: "Band" },
        tracks: { offset: 0, total: 1, items: [{ id: 7, title: "Track", duration: 99 }] } }));
    } });
  setEditionLink(storage, album(), "qobuz", { id: "qobuz:00123", name: "Chosen" });
  const reader = (row, consume) => readCatalogPage("qobuz", api, row, consume);
  await assert.rejects(run(storage, plan(storage, ["duration"], "qobuz"), 5, reader), /429|attendi|limite/i);
  assert.equal(calls, 1); assert.equal(storage.getItem(DURATIONS), null);
  await assert.rejects(run(storage, json(storage, COMPLETION_KEY), 5, reader), /attendi/i);
  assert.equal(calls, 1);
  now += 121000;
  await run(storage, json(storage, COMPLETION_KEY), 5, reader);
  assert.equal(calls, 2); assert.equal(json(storage, DURATIONS)[ID], 99000);
});

test("real Spotify transport shares Retry-After across subsequent completions", async () => {
  const storage = store();
  let now = 100000, calls = 0;
  const transport = createSpotifyTransport({ storage, now: () => now, wait: async (ms) => { now += ms; },
    fetch: async () => { calls += 1; return new Response("{}", { status: 429, headers: { "Retry-After": "120" } }); } });
  await assert.rejects(transport.fetch(`https://api.spotify.com/v1/albums/${ID}`, {}, true), /120|limite|attendi/i);
  await assert.rejects(transport.fetch(`https://api.spotify.com/v1/albums/${ID}`, {}, true), /120|limite|attendi/i);
  assert.equal(calls, 1);
});

test("ISO durations reject missing and invalid values, retaining fractional milliseconds", () => {
  assert.equal(isoDurationMs("PT1H2M3.001S"), 3723001);
  for (const value of ["PT", "PT0S", "62", "-PT1S", null, "PT1Mgarbage"]) assert.throws(() => isoDurationMs(value));
});

test("actual Qobuz retries count HTTP attempts rather than pages and stop at the declared limit", async () => {
  const storage = store();
  let now = 100000, calls = 0;
  const api = createQobuzClient({ appId: "synthetic", token: "synthetic", storage, now: () => now,
    sleep: async (ms) => { now += ms; }, jitter: () => 0,
    fetch: async () => {
      calls += 1;
      if (calls === 1) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({ id: "00123", title: "Album", artist: { name: "Band" },
        tracks: { offset: 0, total: 1, items: [{ id: 7, title: "Track", duration: 99 }] } }));
    } });
  setEditionLink(storage, album(), "qobuz", { id: "qobuz:00123", name: "Chosen" });
  const reader = (row, consume) => readCatalogPage("qobuz", api, row, consume, true);
  await run(storage, plan(storage, ["duration"], "qobuz"), 1, reader);
  assert.equal(calls, 1);
  assert.equal(json(storage, COMPLETION_KEY).state, "budget");
  assert.equal(json(storage, COMPLETION_KEY).reads, 1);
  await run(storage, json(storage, COMPLETION_KEY), 1, reader);
  assert.equal(calls, 2);
  assert.equal(json(storage, DURATIONS)[ID], 99000);
});

test("actual TIDAL cache hits are free and retries cannot exceed the declared HTTP budget", async () => {
  const storage = store();
  let now = 100000, calls = 0;
  const transport = createTidalTransport({ storage, now: () => now, sleep: async (ms) => { now += ms; }, jitter: () => 0,
    fetch: async (url) => {
      calls += 1;
      if (String(url).endsWith("/albums/42")) return new Response(JSON.stringify({
        data: { type: "albums", id: "42", attributes: { numberOfTracks: 1 } },
      }), { headers: { "Cache-Control": "max-age=300" } });
      if (calls === 2) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({ data: [{ type: "tracks", id: "7", attributes: { duration: "PT3S" } }] }));
    } });
  const api = { completionPage: (path, beforeRead) => transport.request(path, "synthetic", { beforeRead }) };
  setEditionLink(storage, album(), "tidal", { id: "tidal:42", name: "Chosen" });
  const reader = (row, consume) => readCatalogPage("tidal", api, row, consume, true);
  await run(storage, plan(storage, ["duration"], "tidal"), 2, reader);
  assert.equal(calls, 2);
  assert.equal(json(storage, COMPLETION_KEY).state, "budget");
  await run(storage, json(storage, COMPLETION_KEY), 1, reader);
  assert.equal(calls, 3);
  assert.equal(json(storage, DURATIONS)[ID], 3000);
  await transport.request("albums/42", "synthetic", { beforeRead: () => { throw new Error("cache budget"); } });
  assert.equal(calls, 3);
});

test("track metadata explicitly naming another edition cannot create an album duration", async () => {
  const storage = store();
  setEditionLink(storage, album(), "qobuz", { id: "qobuz:00123", name: "Chosen" });
  const api = { albumTracks: async () => ({ album: { album: { id: "qobuz:00123" } }, total: 1, next: null,
    tracks: [{ id: "7", duration: 99, album: { album: { id: "qobuz:other" } } }] }) };
  await assert.rejects(run(storage, plan(storage, ["duration"], "qobuz"), 1,
    (row, consume) => readCatalogPage("qobuz", api, row, consume)), /edizione diversa/);
  assert.equal(storage.getItem(DURATIONS), null);
});

test("saved cross-album cursors are rejected before contacting either catalog", async () => {
  const storage = store(), row = plan(storage).rows[0];
  row.cursor = `albums/${SECOND}/tracks?offset=0`;
  await assert.rejects(readCatalogPage("spotify", { request() { throw new Error("unexpected request"); } },
    row, () => {}), /conservato/);
  row.target = "tidal:42"; row.cursor = "albums/43/relationships/items";
  await assert.rejects(readCatalogPage("tidal", { completionPage() { throw new Error("unexpected request"); } },
    row, () => {}), /conservato/);
});
