import assert from "node:assert/strict";
import test from "node:test";
import {
  addPlaylistAlbums,
  decodeCoverArchive,
  encodeCoverArchive,
  filterAlbums,
  listenBrainzRecommendations,
  moveAlbumInManualOrder,
  playlistAlbumRecords,
  sortAlbumsByManualOrder,
  spotifyPlaylistId,
  threeWayMerge,
  validateAlbum,
  validateDocument,
} from "./core.mjs";

const album = (id, overrides = {}) => ({
  id,
  name: `Album ${id}`,
  artist: "Artist",
  url: `https://open.spotify.com/album/${id}`,
  year: "2020",
  status: "queued",
  rating: null,
  genres: [],
  collections: [],
  tags: [],
  cover_sha256: null,
  ...overrides,
});

test("validates only the supported Spotify album fields and rating range", () => {
  assert.equal(validateAlbum(album("abc")).id, "abc");
  assert.throws(() => validateAlbum({ ...album("abc"), extra: "private data" }), /Record album non valido/);
  assert.throws(() => validateAlbum(album("abc", { url: "https://example.com/album/abc" })), /link Spotify non valido/);
  assert.throws(() => validateAlbum(album("abc", { rating: 4.2 })), /voto/);
});

test("requires an explicit choice for divergent edits to the same album", () => {
  const base = album("abc");
  const local = album("abc", { rating: 4 });
  const remote = album("abc", { genres: ["Jazz"] });
  const merged = threeWayMerge([base], [local], [remote]);
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.albums.length, 0);
  assert.equal(threeWayMerge([base], [local], [remote], { abc: "local" }).albums[0].rating, 4);
  assert.deepEqual(threeWayMerge([base], [local], [remote], { abc: "remote" }).albums[0].genres, ["Jazz"]);

  const conflict = threeWayMerge([base], [local], [album("abc", { rating: 3 })]);
  assert.equal(conflict.albums.length, 0);
  assert.equal(conflict.conflicts[0].id, "abc");
  assert.equal(threeWayMerge([base], [local], [album("abc", { rating: 3 })], { abc: "local" }).albums[0].rating, 4);
  assert.equal(threeWayMerge([base], [local], [album("abc", { rating: 3 })], { abc: "remote" }).albums[0].rating, 3);
});

test("merges independent additions without propagating deletions", () => {
  const merged = threeWayMerge([], [album("local")], [album("remote")]);
  assert.deepEqual(merged.albums.map((item) => item.id), ["local", "remote"]);
  const retained = threeWayMerge([album("gone")], [], [album("gone")]);
  assert.deepEqual(retained.albums.map((item) => item.id), ["gone"]);
});

test("searches genres and filters state while sorting ratings and names", () => {
  const albums = [
    album("a", { name: "Beta", artist: "Zed", rating: 3, genres: ["Jazz"] }),
    album("b", { name: "Alpha", artist: "Ada", rating: 4, genres: ["Rock"], status: "heard" }),
  ];
  assert.deepEqual(filterAlbums(albums, { search: "jazz" }).map((item) => item.id), ["a"]);
  assert.deepEqual(filterAlbums(albums, { status: "heard", genre: "rock" }).map((item) => item.id), ["b"]);
  assert.deepEqual(filterAlbums(albums, { order: "name" }).map((item) => item.id), ["b", "a"]);
  assert.deepEqual(filterAlbums(albums, { order: "rating" }).map((item) => item.id), ["b", "a"]);
  assert.deepEqual(filterAlbums(albums, { order: "genre" }).map((item) => item.id), ["a", "b"]);
  assert.deepEqual(filterAlbums(albums, { order: "manual" }).map((item) => item.id), ["a", "b"]);
});

test("sorts by collection and keeps a local manual order while reordering filtered albums", () => {
  const albums = [
    album("a", { collections: ["Zeta"] }),
    album("b", { collections: ["Alpha"] }),
    album("c", { collections: ["Beta"] }),
  ];
  assert.deepEqual(filterAlbums(albums, { order: "collection" }).map((item) => item.id), ["b", "c", "a"]);
  assert.deepEqual(sortAlbumsByManualOrder(albums, ["c", "a", "b"]).map((item) => item.id), ["c", "a", "b"]);
  assert.deepEqual(
    moveAlbumInManualOrder(["a", "hidden", "b", "c"], ["a", "b", "c"], "a", 2),
    ["b", "hidden", "c", "a"],
  );
});

test("rejects invalid or duplicate repository documents", () => {
  assert.deepEqual(validateDocument({ format: "accord-album-collection", version: 1, albums: [] }), []);
  assert.throws(() => validateDocument({ format: "accord-album-collection", version: 1, albums: [album("a"), album("a")] }), /duplicati/);
});

test("migrates v1 records and validates synced collections, tags, and cover hashes", () => {
  const { collections, tags, cover_sha256, ...legacy } = album("a");
  const migrated = validateDocument({ format: "accord-album-collection", version: 1, albums: [legacy] });
  assert.deepEqual(migrated[0].collections, []);
  assert.deepEqual(migrated[0].tags, []);
  assert.equal(migrated[0].cover_sha256, null);
  assert.throws(() => validateAlbum(album("a", { tags: ["x".repeat(81)] })), /80 caratteri/);
});

test("filters albums by collection and tag and searches both fields", () => {
  const record = album("a", { collections: ["Favorites"], tags: ["mobile"] });
  assert.deepEqual(filterAlbums([record], { collection: "favorites", tag: "mobile" }), [record]);
  assert.deepEqual(filterAlbums([record], { search: "favorites" }), [record]);
  assert.deepEqual(filterAlbums([record], { search: "mobile" }), [record]);
});

test("round-trips verified JPEG cover thumbnails in the desktop archive format", async () => {
  const data = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]);
  const archive = await encodeCoverArchive(new Map([["abc123", data]]));
  const decoded = await decodeCoverArchive(archive);
  assert.deepEqual(decoded.get("abc123").data, data);
  assert.equal(decoded.get("abc123").hash.length, 64);
  const corrupted = archive.slice();
  corrupted[corrupted.length - 1] ^= 1;
  await assert.rejects(decodeCoverArchive(corrupted), /Verifica copertina/);
});

test("accepts Spotify playlist names, IDs, links, and URIs without accepting other hosts", () => {
  const id = "0123456789012345678901";
  assert.equal(spotifyPlaylistId(id), id);
  assert.equal(spotifyPlaylistId(`spotify:playlist:${id}`), id);
  assert.equal(spotifyPlaylistId(`https://open.spotify.com/intl-it/playlist/${id}?si=example`), id);
  assert.equal(spotifyPlaylistId("La mia playlist"), null);
  assert.throws(() => spotifyPlaylistId(`https://example.com/playlist/${id}`), /link Spotify valido/);
});

test("extracts and deduplicates only valid full albums from playlist items", () => {
  const id = "0123456789012345678901";
  const albumItem = {
    type: "track",
    album: {
      id,
      name: "Record",
      album_type: "album",
      artists: [{ name: "Artist" }],
      external_urls: { spotify: `https://open.spotify.com/album/${id}` },
      release_date: "2024-01-02",
    },
  };
  const albums = playlistAlbumRecords([
    { item: albumItem },
    { track: albumItem },
    { item: { ...albumItem, album: { ...albumItem.album, album_type: "single" } } },
    { item: { ...albumItem, album: { ...albumItem.album, id: "bad" } } },
  ]);
  assert.deepEqual(albums, [album(id, { name: "Record", artist: "Artist", year: "2024" })]);

  const existing = album(id, { rating: 4, genres: ["Jazz"] });
  const result = addPlaylistAlbums([existing], albums);
  assert.equal(result.added, 0);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.albums, [existing]);
  const added = addPlaylistAlbums([], albums);
  assert.equal(added.added, 1);
  assert.deepEqual(added.albums, albums);
});

test("normalizes ListenBrainz recommendations and rejects unrelated or invalid rows", () => {
  const rows = [
    { reference_mbid: "seed", artist_mbid: "b", name: "Artist B", score: 2 },
    { reference_mbid: "seed", artist_mbid: "a", name: "Artist A", score: 4 },
    { reference_mbid: "seed", artist_mbid: "a", name: "Duplicate", score: 3 },
    { reference_mbid: "other", artist_mbid: "c", name: "Wrong seed", score: 10 },
    { reference_mbid: "seed", artist_mbid: "seed", name: "Seed", score: 10 },
    { reference_mbid: "seed", artist_mbid: "d", name: "Invalid score", score: Infinity },
  ];
  assert.deepEqual(listenBrainzRecommendations(rows, "seed"), [
    { name: "Artist A", mbid: "a", score: 4, match: 1 },
    { name: "Artist B", mbid: "b", score: 2, match: 0.5 },
  ]);
  assert.throws(() => listenBrainzRecommendations({}, "seed"), /ListenBrainz/);
});
