import test from "node:test";
import assert from "node:assert/strict";
import { CatalogSuggestions, genreAllowed, musicalAlbumTags } from "./catalog-suggestions.mjs";
import { initializeCatalogSuggestionsUI } from "./suggestions-ui.mjs";

test("the shared browser controller can be imported without side effects", () => {
  assert.equal(typeof initializeCatalogSuggestionsUI, "function");
});

const album = (id = "tidal:1", artist = "New artist", name = "Album") => ({ id, artist, name });
const step = (state, overrides = {}) => state.step({
  similar: async () => [], topAlbums: async () => [], search: async () => [],
  genres: async () => [], ...overrides,
});
const discovery = (rows) => ({
  similar: async () => [{ name: "New artist", match: .8 }],
  topAlbums: async () => [{ name: "Album" }], search: async () => rows,
});

test("catalog suggestions retain native identity only for one exact edition", async () => {
  const state = new CatalogSuggestions({ seeds: [{ name: "Seed" }] });
  const result = await step(state, discovery([{ album: album() }]));
  assert.equal(result.albums[0].album.id, "tidal:1");
  assert.equal(result.reads, 3);
  assert.match(result.albums[0].reason, /affine a Seed/);
  for (const [rows, statistic] of [
    [[{ album: album() }, { album: album("tidal:2") }], "ambiguous"],
    [[{ album: album("tidal:1", "New artist", "Album (Deluxe)") }], "unmatched"],
  ]) {
    const result = await step(new CatalogSuggestions({ seeds: [{ name: "Seed" }] }), discovery(rows));
    assert.equal(result.albums.length, 0); assert.equal(result.stats[statistic], 1);
  }
});

test("continuation limits each pass to twenty reads and does not repeat finished seeds", async () => {
  let seedReads = 0, calls = 0;
  const state = new CatalogSuggestions({ seeds: [{ name: "Seed" }], filters: { includedGenres: ["jazz"] } });
  const callbacks = {
    similar: async () => { seedReads += 1; return Array.from({ length: 25 }, (_, i) => ({ name: `Artist ${i}` })); },
    topAlbums: async () => { calls += 1; return [{ name: "Album" }]; },
    search: async (query) => { calls += 1; return [{ album: album(query, query.replace(/ Album$/, "")) }]; },
    genres: async () => { calls += 1; return ["rock"]; },
  };
  const first = await step(state, callbacks), second = await step(state, callbacks);
  assert.equal(first.stepReads, 20); assert.equal(second.stepReads, 20);
  assert.equal(second.reads, 40); assert.equal(seedReads, 1); assert.equal(calls, 39);
});

test("genre filters require actual tags and distinguish exact versus contains", () => {
  assert.equal(genreAllowed([], { excludedGenres: ["rock"] }), false);
  assert.equal(genreAllowed(["jazz rock"], { includedGenres: ["jazz"] }), true);
  assert.equal(genreAllowed(["jazz rock"], { includedGenres: ["jazz"], includedGenresMatch: "exact" }), false);
});

test("community album tags are filtered to musical labels without inventing classifications", () => {
  assert.deepEqual(musicalAlbumTags([{ name: "seen live" }, { name: "favorite" }, { name: "Rock" },
    { name: "progressive-rock" }, { name: "jazz" }]), ["progressive rock", "jazz"]);
});

test("incomplete search samples cannot establish a unique edition", async () => {
  const state = new CatalogSuggestions({ seeds: [{ name: "Seed" }] });
  const result = await step(state, { ...discovery([]),
    search: async () => ({ rows: [{ album: album() }], complete: false }) });
  assert.equal(result.albums.length, 0); assert.equal(result.stats.partial, 1);
});

test("failed attempts count against totals and only explicit continuation retries pending work", async () => {
  const state = new CatalogSuggestions({ seeds: [{ name: "Seed" }] });
  await assert.rejects(step(state, { similar: async () => { throw new Error("cooldown"); } }), /cooldown/);
  assert.equal(state.reads, 1); assert.equal(state.canContinue, true);
  assert.equal((await step(state)).reads, 2);
});

test("native sources exclude known identities across services and individual credits", async () => {
  const state = new CatalogSuggestions({ albums: [
    { album: album() }, { album: album("tidal:2", "Heard") },
    { album: album("tidal:3", "Other"), artistNames: ["Other", "Blocked"] },
    { album: album("tidal:4", "Good") }, { album: album("tidal:5", "Good", "Other") },
  ], known: [album("qobuz:abc")], heard: ["Heard"], filters: { excludedArtists: ["Blocked"] } });
  const result = await step(state);
  assert.deepEqual(result.albums.map((row) => row.album.id), ["tidal:4"]);
  assert.equal(result.stats.known, 4);
});

test("ten albums means ten distinct artists; no manufactured extra results", async () => {
  const state = new CatalogSuggestions({ albums: Array.from({ length: 15 }, (_, i) => ({ album: album(`tidal:${i}`, `Artist ${i}`) })) });
  const result = await step(state);
  assert.equal(result.albums.length, 10); assert.equal(result.canContinue, false); assert.equal(result.reads, 0);
});

test("manual artist browsing shows separate native editions without an automatic match", async () => {
  const state = new CatalogSuggestions({ albums: [{ album: album() }, { album: album("tidal:2") }], uniqueArtists: false });
  const result = await step(state);
  assert.equal(result.albums.length, 2); assert.equal(result.uniqueArtists, false);
});

test("provider changes during a read discard its result", async () => {
  let active = true;
  const state = new CatalogSuggestions({ seeds: [{ name: "Seed" }] });
  await assert.rejects(step(state, { similar: async () => { active = false; return [{ name: "New artist" }]; },
    guard: () => { if (!active) throw new Error("changed"); } }), /changed/);
  assert.equal(state.artists.length, 0); assert.equal(state.results.length, 0);
});
