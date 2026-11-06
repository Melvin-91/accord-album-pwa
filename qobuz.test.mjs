import test from "node:test";
import assert from "node:assert/strict";
import { createQobuzClient, qobuzAlbum, qobuzAlbumId, qobuzCoverUrl } from "./qobuz.mjs";
import { validateAlbum, validateDocument, createSyncDocument, encodeCoverArchive, decodeCoverArchive } from "./core.mjs";
import { createLocalBackup, validateLocalBackup } from "./ui.mjs";

const source = { id: "00123", title: "Title", artist: { name: "Artist" },
  release_date_original: "2021-01-02", image: { large: "https://static.qobuz.com/images/a.jpg" } };
const album = qobuzAlbum(source).album;

test("Qobuz IDs preserve leading zeroes, exact links, backup and cover archives", async () => {
  assert.equal(album.id, "qobuz:00123");
  assert.equal(validateAlbum(album).url, "https://play.qobuz.com/album/00123");
  assert.equal(qobuzAlbumId(album.url), "00123");
  assert.equal(validateDocument({ format: "accord-album-collection", version: 4, albums: [album] })[0].id, album.id);
  const spotify = { ...album, id: "00123", url: "https://open.spotify.com/album/00123" };
  assert.equal(createSyncDocument([spotify]).version, 3);
  const remote = createSyncDocument([spotify, album], "2026-01-02T00:00:00Z");
  assert.equal(remote.version, 4);
  assert.equal(remote.format, "accord-album-collection");
  assert.equal(remote.updated_at, "2026-01-02T00:00:00Z");
  assert.deepEqual(new Set(remote.albums.map((item) => item.id)), new Set(["00123", "qobuz:00123"]));
  const backup = createLocalBackup([album], {}, validateAlbum);
  assert.equal(validateLocalBackup(backup, validateDocument).albums[0].url, album.url);
  const image = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const archive = await encodeCoverArchive(new Map([[album.id, image]]));
  assert.deepEqual((await decodeCoverArchive(archive)).get(album.id).data, image);
  for (const id of ["qobuz:../1", "https://play.qobuz.com.evil.test/album/1",
    "https://user@play.qobuz.com/album/1", "https://play.qobuz.com/album/1?token=x"]) {
    assert.throws(() => qobuzAlbumId(id));
  }
  for (const url of ["https://static.qobuz.com.evil.test/a.jpg", "https://user@static.qobuz.com/a.jpg",
    "http://static.qobuz.com/a.jpg"]) assert.equal(qobuzCoverUrl(url), null);
});

test("pagination and writes use fixed endpoints, private headers and no automatic retries", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    const body = options.method === "GET"
      ? { albums: { items: [source], total: 4795, offset: Number(new URL(url).searchParams.get("offset")) } }
      : { status: "success" };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const client = createQobuzClient({ appId: "app", token: "secret", fetch: request });
  assert.equal((await client.favorites(0)).next, 1);
  assert.equal((await client.search("Artist", 100)).offset, 100);
  await client.setFavorite(album.id, true);
  await client.setFavorite(album.id, false);
  assert.deepEqual(calls.map((call) => call.options.method), ["GET", "GET", "POST", "POST"]);
  assert.equal(new URL(calls[2].url).pathname, "/api.json/0.2/favorite/create");
  assert.equal(calls[2].options.body.get("album_ids"), "00123");
  assert.equal(calls[2].options.body.get("artist_ids"), "");
  assert.ok(calls.every((call) => !call.url.includes("secret") && call.options.credentials === "omit"
    && call.options.redirect === "error" && call.options.headers["X-User-Auth-Token"] === "secret"));
  let attempts = 0;
  const failing = createQobuzClient({ appId: "app", token: "secret", fetch: async () => { attempts += 1; throw new Error("secret"); } });
  await assert.rejects(failing.setFavorite("00123", true), (error) => /incerto/.test(error.message) && !error.message.includes("secret"));
  assert.equal(attempts, 1);
});

test("invalid or incomplete Qobuz pages fail explicitly", async () => {
  const client = createQobuzClient({ appId: "app", token: "secret",
    fetch: async () => new Response(JSON.stringify({ albums: { items: [], total: 10, offset: 0 } })) });
  await assert.rejects(client.favorites(), /Paginazione/);
  assert.throws(() => qobuzAlbum({ ...source, artist: {} }), /incompleti/);
});

test("writes require an explicit success response and never retry ambiguous results", async () => {
  for (const body of [{}, { status: "partial" }, { status: "failed" }, { status: null }]) {
    let attempts = 0;
    const client = createQobuzClient({ appId: "app", token: "secret",
      fetch: async () => { attempts += 1; return new Response(JSON.stringify(body)); } });
    await assert.rejects(client.setFavorite("00123", true), /Verifica lo stato remoto/);
    assert.equal(attempts, 1);
  }
});

test("Qobuz suggestions and playlist tracks preserve distinct identities", async () => {
  const suggestion = { id: "abc", title: "Suggested", artists: [{ name: "Artist" }],
    dates: { original: "2023-02-01" }, image: {} };
  const playlist = { id: 123, name: "Test", tracks_count: 1, is_public: false };
  const track = { id: 42, title: "Track", performer: { name: "Artist" }, playlist_track_id: 99, album: source };
  const request = async (url) => {
    const path = new URL(url).pathname;
    return new Response(JSON.stringify(path.endsWith("album/suggest") ? { albums: { items: [suggestion] } }
      : path.endsWith("playlist/getUserPlaylists") ? { playlists: { items: [playlist], total: 1, offset: 0 } }
        : { ...playlist, tracks: { items: [track], total: 1, offset: 0 } }));
  };
  const client = createQobuzClient({ appId: "app", token: "secret", fetch: request });
  assert.equal((await client.similarAlbums("00123"))[0].album.year, "2023");
  assert.equal((await client.playlists()).playlists[0].id, "123");
  const result = await client.playlistTracks("https://play.qobuz.com/playlist/123");
  assert.equal(result.tracks[0].playlistTrackId, "99");
  assert.equal(result.tracks[0].album.album.id, "qobuz:00123");
  await assert.rejects(client.playlistTracks("https://play.qobuz.com/playlist/123?token=x"), /non valido/);
});

test("Qobuz playlist writes require matching response identity and private creation", async () => {
  let response = { id: 123, name: "Test", tracks_count: 0, is_public: false };
  const calls = [];
  const client = createQobuzClient({ appId: "app", token: "secret",
    fetch: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(response)); } });
  assert.equal((await client.createPlaylist("Test")).id, "123");
  assert.equal(calls.at(-1).options.body.get("is_public"), "false");
  await client.addPlaylistTracks("123", ["42"]);
  assert.equal(calls.at(-1).options.body.get("track_ids"), "42");
  await client.removePlaylistTracks("123", ["99"]);
  assert.equal(calls.at(-1).options.body.get("playlist_track_ids"), "99");
  response = { ...response, id: 456 };
  await assert.rejects(client.addPlaylistTracks("123", ["42"]), /Verifica lo stato remoto/);
  response = { id: 123, status: "partial" };
  await assert.rejects(client.removePlaylistTracks("123", ["99"]), /Verifica lo stato remoto/);
  response = { status: "success" };
  await client.deletePlaylist("123");
});

test("Qobuz reads reject a different album and invalid page totals", async () => {
  let response = { id: "different", title: "Test", artist: { name: "Artist" } };
  const client = createQobuzClient({ appId: "app", token: "secret",
    fetch: async () => new Response(JSON.stringify(response)) });
  await assert.rejects(client.album("00123"), /album diverso/);
  response = { albums: { items: [response], total: 0, offset: 0 } };
  await assert.rejects(client.favorites(), /Paginazione/);
});

test("Qobuz moves distinct occurrences with verified endpoint positions and no retry", async () => {
  const calls = [];
  const client = createQobuzClient({ appId: "app", token: "secret", fetch: async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify({ id: 123 }));
  } });
  await client.movePlaylistTracks("123", ["11", "12"], true, 3);
  assert.match(calls[0].url, /playlist\/updateTracksPosition$/);
  assert.equal(calls[0].options.body.get("playlist_track_ids"), "11,12");
  assert.equal(calls[0].options.body.get("insert_before"), "0");
  await client.movePlaylistTracks("123", ["12"], false, 3);
  assert.equal(calls[1].options.body.get("insert_before"), "4");
  for (const [ids, beginning, total] of [[[], true, 3], [["11", "11"], true, 3], [["11"], false, 0],
    [["11"], false, true], [["11"], "yes", 3], [["11"], false, Number.MAX_SAFE_INTEGER]]) {
    assert.throws(() => client.movePlaylistTracks("123", ids, beginning, total));
  }
  assert.equal(calls.length, 2);
});
