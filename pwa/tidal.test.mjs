import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  TIDAL_SCOPES, tidalApiUrl, tidalAlbumId, tidalPlaylistId, createMusicServiceGate, musicAlbumLink,
  createTidalTransport, createTidalAuth, tidalAlbumRecords, tidalResources, tidalAlbumArtwork,
} from "./tidal.mjs";
import { validateAlbum, validateDocument, encodeCoverArchive, decodeCoverArchive } from "./core.mjs";
import { createLocalBackup, validateLocalBackup, portablePreferences } from "./ui.mjs";

const storage = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key), map };
};

test("collection album links always follow the selected provider without mixing catalog identifiers", () => {
  const spotify = { id: "abc123", name: "An Album", artist: "An Artist" };
  const tidal = { ...spotify, id: "tidal:123" };
  assert.equal(musicAlbumLink(tidal, "tidal"), "tidal://album/123");
  assert.equal(musicAlbumLink(spotify, "spotify"), "spotify:album:abc123");
  assert.equal(musicAlbumLink(spotify, "tidal"), null);
  assert.match(musicAlbumLink(tidal, "spotify"), /^spotify:search:/);
  const qobuz = { ...spotify, id: "qobuz:00123", url: "https://play.qobuz.com/album/00123" };
  assert.equal(musicAlbumLink(qobuz, "qobuz", { desktop: true }), "qobuzapp://album/00123");
  assert.equal(musicAlbumLink(spotify, "qobuz"), null);
  assert.throws(() => musicAlbumLink(tidal, "invalid"), /non valido/);
  assert.equal(tidalApiUrl("userCollectionPlaylists/me/relationships/items").hostname, "openapi.tidal.com");
  assert.throws(() => tidalApiUrl("userCollectionPlaylists/me/relationships/items", "POST"), /non supportata/);
});
const json = (value, { status = 200, headers = {} } = {}) => new Response(
  status === 204 || status === 304 ? null : JSON.stringify(value), { status, headers });
const fixture = (respond, options = {}) => {
  const calls = [], local = options.storage || storage();
  let time = 1_800_000_000_000;
  const transport = createTidalTransport({ storage: local, now: () => time,
    sleep: async (ms) => { time += ms; }, jitter: () => 0,
    fetch: async (url, init) => { calls.push({ url: String(url), ...init }); return respond(url, init, calls.length); },
    ...options });
  return { transport, calls, local, advance: (ms) => { time += ms; } };
};

test("playlist album import reads all pages beyond search limits and deduplicates in playlist order", async () => {
  const playlist = "4e17b836-f114-46e2-a2cf-70ec1b0e4c43";
  const progress = [];
  const f = fixture((url) => {
    const page = Number(new URL(url).searchParams.get("page") || 1);
    const tracks = Array.from({length: 25}, (_, index) => {
      const id = String((page - 1) * 25 + index + 1);
      return {type: "tracks", id, relationships: {albums: {data: [{type: "albums", id}]}}};
    });
    const albums = tracks.map(track => ({type: "albums", id: track.id,
      attributes: {title: `Album ${track.id}`, releaseDate: "2026-01-01"},
      relationships: {artists: {data: [{type: "artists", id: "artist"}]}}}));
    return json({data: [...tracks, tracks[0]], included: [...albums,
      {type: "artists", id: "artist", attributes: {name: "Artist"}}],
      links: {next: page < 15 ? `?page=${page + 1}` : null}});
  });
  const result = await f.transport.playlistAlbums(playlist, "token",
    {progress: (items, albums) => progress.push([items, albums])});
  assert.equal(result.albums.length, 375);
  assert.deepEqual(result.albums.slice(0, 3).map(album => album.id), ["tidal:1", "tidal:2", "tidal:3"]);
  assert.equal(result.albums.at(-1).id, "tidal:375");
  assert.deepEqual(progress.at(-1), [390, 375]);
  assert.equal(f.calls.length, 15);
  assert.ok(f.calls.every(call => call.method === "GET"));
});

test("playlist album import hydrates every missing album in batches and preserves verified partial results", async () => {
  const playlist = "4e17b836-f114-46e2-a2cf-70ec1b0e4c43";
  for (const failNext of [false, true]) {
    const f = fixture((url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get("page") === "2") return json({}, {status: 403});
      if (parsed.pathname === "/v2/albums") {
        return json({data: parsed.searchParams.get("filter[id]").split(",").map(id => ({
          type: "albums", id, attributes: {title: `Album ${id}`},
          relationships: {artists: {data: [{type: "artists", id: "artist"}]}}
        })), included: [{type: "artists", id: "artist", attributes: {name: "Artist"}}]});
      }
      return json({data: Array.from({length: 31}, (_, index) => ({type: "tracks", id: String(index + 1),
        relationships: {albums: {data: [{type: "albums", id: String(index + 1)}]}}})),
        links: {next: failNext ? "?page=2" : null}});
    });
    if (failNext) await assert.rejects(f.transport.playlistAlbums(playlist, "token"), error => {
      assert.equal(error.partialResults.length, 31);
      assert.match(error.message, /403/);
      return true;
    });
    else assert.equal((await f.transport.playlistAlbums(playlist, "token")).albums.length, 31);
    const batches = f.calls.filter(call => new URL(call.url).pathname === "/v2/albums");
    assert.deepEqual(batches.map(call => new URL(call.url).searchParams.get("filter[id]").split(",").length), [20, 11]);
  }
});

test("search resolves the opaque API identifier before reading album relationships", async () => {
  const f = fixture((url) => new URL(url).pathname === "/v2/searchResults"
    ? json({ data: [{ type: "searchResults", id: "opaque/id+not-the-query" }] })
    : json({ data: [] }));
  const path = await f.transport.searchPath("Artist Album", "albums", "token", {
    countryCode: "IT", include: "albums.artists,albums.coverArt",
  });
  const page = await f.transport.pages(path, "token");
  assert.equal(page.complete, true);
  assert.equal(f.calls.length, 2);
  assert.equal(new URL(f.calls[0].url).searchParams.get("filter[query]"), "Artist Album");
  assert.equal(new URL(f.calls[1].url).pathname,
    "/v2/searchResults/opaque%2Fid%2Bnot-the-query/relationships/albums");
  assert.equal(new URL(f.calls[1].url).searchParams.get("countryCode"), "IT");
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("search rejects missing or ambiguous search identifiers without a relationship read or retry", async () => {
  for (const data of [[], [{ type: "albums", id: "1" }],
    [{ type: "searchResults", id: "a" }, { type: "searchResults", id: "b" }]]) {
    const f = fixture(() => json({ data }));
    await assert.rejects(f.transport.searchPath("Album", "albums", "token"), /identificatore/);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(() => json({}, { status: 404 }));
  await assert.rejects(f.transport.searchPath("Album", "albums", "token"), /HTTP 404/);
  assert.equal(f.calls.length, 1);
});
const document = {
  data: [{ type: "albums", id: "123", meta: { addedAt: "today" } }],
  included: [
    { type: "albums", id: "123", attributes: { title: "Test", releaseDate: "2026-03-01" },
      relationships: { artists: { data: [{ type: "artists", id: "9" }] } } },
    { type: "artists", id: "9", attributes: { name: "Artist" } },
  ],
};

test("strict TIDAL namespace and canonical URL survive validation, backup, preferences and cover archive", async () => {
  const album = validateAlbum(tidalAlbumRecords([document])[0]);
  assert.equal(album.id, "tidal:123");
  assert.equal(album.url, "https://tidal.com/browse/album/123");
  assert.equal(album.artist, "Artist");
  for (const patch of [
    { id: "tidal:0123" }, { id: "tidal:0" }, { id: "tidal:-1" }, { id: "TIDAL:123" },
    { url: "https://tidal.com/browse/album/124" }, { url: "https://open.spotify.com/album/123" },
    { url: "https://tidal.com/browse/album/123?token=x" }, { url: "https://tidal.com/browse/album/123#x" },
    { url: "https://tidal.com.evil.test/browse/album/123" }, { url: "https://user@tidal.com/browse/album/123" },
    { url: "https://tidal.com:8443/browse/album/123" }, { id: "123", url: album.url },
  ]) assert.throws(() => validateAlbum({ ...album, ...patch }));
  const preferences = portablePreferences({ pinnedIds: ["tidal:123", "a", "tidal:01"] });
  assert.deepEqual(preferences.pinnedIds, ["tidal:123", "a"]);
  const backup = createLocalBackup([album], preferences, validateAlbum);
  assert.equal(backup.albums[0].url, album.url);
  assert.deepEqual(validateLocalBackup(backup, validateDocument).albums, [album]);
  const covers = new Map([[album.id, new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]]);
  const decoded = await decodeCoverArchive(await encodeCoverArchive(covers));
  assert.deepEqual(decoded.get(album.id).data, covers.get(album.id));
  assert.match(decoded.get(album.id).hash, /^[0-9a-f]{64}$/);
});

test("manual TIDAL links reject foreign hosts, non-decimal IDs and credential URLs", () => {
  for (const value of ["123", "tidal:123", "https://tidal.com/browse/album/123?u", "https://www.tidal.com/album/123"]) {
    assert.equal(tidalAlbumId(value), "123");
  }
  for (const value of ["0", "01", "tidal:01", "-1", "1.5", "https://open.spotify.com/album/123",
    "https://tidal.com.evil/album/123", "https://user@tidal.com/album/123", "http://tidal.com/album/123"]) {
    assert.throws(() => tidalAlbumId(value));
  }
  assert.equal(tidalPlaylistId("https://tidal.com/browse/playlist/abc-123"), "abc-123");
  assert.throws(() => tidalPlaylistId("https://other.test/playlist/abc"));
});

test("JSON:API linkage merges preserve metadata; missing artists are never invented or looked up on Spotify", () => {
  assert.equal(tidalResources([document]).length, 2);
  assert.equal(tidalAlbumRecords([{ data: { type: "albums", id: "1", attributes: { title: "No artist" } } }]).length, 0);
  assert.equal(tidalAlbumRecords([document])[0].genres.length, 0);
});

test("artwork uses only official response href on the verified TIDAL image domain", () => {
  const album = structuredClone(document);
  album.included[0].relationships.coverArt = { data: { type: "artworks", id: "cover" } };
  for (const href of ["https://resources.tidal.com/cover.jpg", "https://evil.test/image.jpg",
    "https://resources.tidal.com.evil/image.jpg", "https://user@resources.tidal.com/image.jpg",
    "http://resources.tidal.com/image.jpg", "https://resources.tidal.com:8443/image.jpg", "not a URL"]) {
    const artwork = tidalAlbumArtwork([album, { data: { type: "artworks", id: "cover",
      attributes: { files: [{ href, meta: { width: 320 } }] } } }]);
    assert.equal(artwork.get("tidal:123"), href === "https://resources.tidal.com/cover.jpg" ? href : undefined);
  }
});

test("only official supported paths are accepted; INTERNAL playback/recommendation controls cannot send requests", async () => {
  const f = fixture(() => { assert.fail("unsupported endpoint reached network"); });
  for (const path of [
    "https://evil.test/v2/albums/123", "https://openapi.tidal.com.evil/v2/albums/123",
    "https://user@openapi.tidal.com/v2/albums/123", "https://openapi.tidal.com/v1/albums/123",
    "playbackStates/me", "userRecommendationBlocks/me", "me", "recommendations", "albums/0",
    "albums/01", "albums/123#fragment",
  ]) await assert.rejects(f.transport.request(path, "token"), /non supportata/);
  await assert.rejects(f.transport.request("albums/123", "token", { method: "DELETE" }), /non supportata/);
  await assert.rejects(f.transport.request("userCollectionAlbums/me", "token", { method: "POST" }), /non supportata/);
  assert.equal(f.calls.length, 0);
  for (const path of ["users/me", "searchResults/hello%20world/relationships/albums",
    "albums/123/relationships/similarAlbums", "artists/4/relationships/similarArtists",
    "userDailyMixes/me", "userDiscoveryMixes/me", "userNewReleaseMixes/me"]) {
    assert.equal(tidalApiUrl(path).origin, "https://openapi.tidal.com");
  }
  assert.doesNotMatch(TIDAL_SCOPES, /(?:^|\s)(r_usr|w_usr|playback)(?:\s|$)/);
});

test("GET concurrency deduplicates reads and respects per-token cache isolation", async () => {
  let release;
  const f = fixture(() => new Promise((resolve) => { release = resolve; }));
  const a = f.transport.request("albums/123", "a");
  const b = f.transport.request("albums/123", "a");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  release(json(document, { headers: { "Cache-Control": "max-age=120" } }));
  const [left, right] = await Promise.all([a, b]);
  assert.deepEqual(left, right);
  left.data[0].id = "changed";
  assert.equal((await f.transport.request("albums/123", "a")).data[0].id, "123");
  const other = f.transport.request("albums/123", "b");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.length, 2);
  release(json(document));
  await other;
});

test("HTTP no-store/no-cache, ETag 304, Age and Date control freshness without invented TTL", async () => {
  const f = fixture((_url, init, count) => {
    if (count === 1) return json(document, { headers: { "Cache-Control": "max-age=60", Age: "59", ETag: '"v1"' } });
    assert.equal(init.headers["If-None-Match"], '"v1"');
    return json(null, { status: 304, headers: { "Cache-Control": "no-cache", ETag: '"v1"' } });
  });
  await f.transport.request("albums/123", "token");
  await f.transport.request("albums/123", "token");
  assert.equal(f.calls.length, 1);
  f.advance(1001);
  await f.transport.request("albums/123", "token");
  await f.transport.request("albums/123", "token");
  assert.equal(f.calls.length, 3);
  for (const headers of [{ "Cache-Control": "no-store, max-age=100", ETag: '"private"' }, {},
    { "Cache-Control": "max-age=100", Date: new Date(1_800_000_000_000 - 101_000).toUTCString() }]) {
    const g = fixture(() => json(document, { headers }));
    await g.transport.request("albums/123", "token");
    await g.transport.request("albums/123", "token");
    assert.equal(g.calls.length, 2);
  }
});

test("long 429 pauses persist across transports/features/tabs and block auth and writes", async () => {
  const shared = storage();
  const f = fixture(() => json({}, { status: 429, headers: { "Retry-After": "120" } }), { storage: shared });
  await assert.rejects(f.transport.request("albums/123", "token"), /429/);
  const g = fixture(() => { assert.fail("cooldown reached network"); }, { storage: shared });
  await assert.rejects(g.transport.request("playlists", "token"), /120 secondi/);
  await assert.rejects(g.transport.request("playlists", "token", { method: "POST", body: { data: [] } }), /120 secondi/);
  await assert.rejects(g.transport.token({ grant_type: "authorization_code" }), /120 secondi/);
  assert.equal(f.calls.length, 1);
  assert.equal(g.calls.length, 0);
  f.advance(120_001);
  await assert.rejects(f.transport.request("albums/123", "token"), /429/);
  assert.equal(f.calls.length, 2);
});

test("HTTP-date and absent Retry-After use a conservative shared cooldown", async () => {
  for (const retry of [new Date(1_800_000_000_000 + 90_000).toUTCString(), "invalid"]) {
    const f = fixture(() => json({}, { status: 429, headers: { "Retry-After": retry } }));
    await assert.rejects(f.transport.request("albums/123", "token"), /429/);
    await assert.rejects(f.transport.request("artists/9", "token"), /secondi/);
    assert.equal(f.calls.length, 1);
  }
});

test("read retries are bounded; HTTP errors and malformed JSON remain visible", async () => {
  for (const [respond, attempts] of [[() => json({}, { status: 503 }), 3],
    [() => { throw new Error("offline"); }, 3], [() => new Response("not JSON"), 1]]) {
    const f = fixture(respond);
    await assert.rejects(f.transport.request("albums/123", "token"));
    assert.equal(f.calls.length, attempts);
  }
});

test("uncertain writes are never retried, concurrently, after errors or after recreating transport", async () => {
  const shared = storage(), write = { method: "POST", body: { data: { type: "playlists", attributes: { name: "X" } } } };
  const f = fixture(() => { throw new Error("connection lost after send"); }, { storage: shared });
  const results = await Promise.allSettled([f.transport.request("playlists", "token", write),
    f.transport.request("playlists", "token", write)]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(f.calls.length, 1);
  const g = fixture(() => { assert.fail("duplicate sent"); }, { storage: shared });
  await assert.rejects(g.transport.request("playlists", "new-token", write), /esito incerto/);
  assert.equal(g.calls.length, 0);
});

test("pending write is durable before dispatch completes, preventing duplicate after navigation or a closed tab", async () => {
  const shared = storage();
  let release;
  const f = fixture(() => new Promise((resolve) => { release = resolve; }), { storage: shared });
  const options = { method: "POST", body: { data: { type: "playlists", attributes: { name: "Pending" } } } };
  const pending = f.transport.request("playlists", "token", options);
  while (!release) await new Promise(setImmediate);
  const g = fixture(() => assert.fail("duplicate pending write"), { storage: shared });
  await assert.rejects(g.transport.request("playlists", "token", options), /esito incerto/);
  release(json({}, { status: 204 }));
  await pending;
  assert.equal(f.calls.length, 1); assert.equal(g.calls.length, 0);
});

test("successful mutations invalidate reads and prevent accidental duplicate writes; 5xx stays uncertain", async () => {
  for (const status of [204, 500]) {
    const f = fixture((_url, options) => options.method === "GET"
      ? json(document, { headers: { "Cache-Control": "max-age=600" } }) : json({}, { status }));
    await f.transport.request("albums/123", "token");
    const operation = { method: "POST", body: { data: [{ type: "albums", id: "123" }] } };
    const send = f.transport.request("userCollectionAlbums/me/relationships/items", "token", operation);
    if (status === 500) await assert.rejects(send, /incerto/); else await send;
    await assert.rejects(f.transport.request("userCollectionAlbums/me/relationships/items", "token", operation), /già inviata/);
    await f.transport.request("albums/123", "token");
    assert.equal(f.calls.length, 3);
  }
});

test("pagination follows same-origin same-resource cursors, reports bounded partial results and detects cycles", async () => {
  const f = fixture((_url, _init, count) => json({ data: [{ type: "albums", id: String(count) }],
    links: { next: { href: `/v2/albums/123/relationships/similarAlbums?page[cursor]=${count}` } } }));
  const page = await f.transport.pages("albums/123/relationships/similarAlbums", "token", { maxPages: 2 });
  assert.equal(page.complete, false); assert.equal(page.count, 2); assert.equal(f.calls.length, 2);
  for (const next of ["https://evil.test/v2/albums/123", "https://openapi.tidal.com/v2/playbackStates/me",
    "https://openapi.tidal.com/v2/artists/9", "https://openapi.tidal.com/v2/albums/123"]) {
    const g = fixture(() => json({ data: [], links: { next } }));
    await assert.rejects(g.transport.pages("albums/123", "token"), /non supportata|non sicura|ciclica/);
    assert.equal(g.calls.length, 1);
  }
});

test("pagination restores missing v2 only for the same origin and identical opaque search resource", async () => {
  const path = "/searchResults/opaque%2Fvalue/relationships/albums";
  for (const link of [path + "?page[cursor]=second",
    "https://openapi.tidal.com" + path + "?page[cursor]=second"]) {
    const f = fixture((_url, _init, count) => json({ data: [{ type: "albums", id: String(count) }],
      links: { next: count === 1 ? link : null } }));
    const result = await f.transport.pages("https://openapi.tidal.com/v2" + path, "token");
    assert.equal(result.complete, true);
    assert.equal(result.count, 2);
    assert.equal(f.calls.length, 2);
    const next = new URL(f.calls[1].url);
    assert.equal(next.pathname, "/v2" + path);
    assert.equal(next.searchParams.get("page[cursor]"), "second");
  }
  for (const link of ["https://evil.test" + path, "http://openapi.tidal.com" + path,
    "https://user@openapi.tidal.com" + path, path + "#fragment",
    "/searchResults/other/relationships/albums", "/albums", "/v1" + path, "/v3" + path]) {
    const f = fixture(() => json({ data: [], links: { next: link } }));
    await assert.rejects(f.transport.pages("https://openapi.tidal.com/v2" + path, "token"));
    assert.equal(f.calls.length, 1);
  }
});

const authFixture = () => {
  const session = storage(), tokens = [];
  let time = 100_000;
  const auth = createTidalAuth({ session, crypto: webcrypto, now: () => time,
    transport: { clear() {}, token: async (parameters) => {
      tokens.push(parameters); return { access_token: "access", refresh_token: "refresh", expires_in: 3600 };
    } } });
  return { auth, session, tokens, advance: (ms) => { time += ms; } };
};

test("OAuth uses official PKCE S256, public scopes, exact redirect and session-only single-use state", async () => {
  const f = authFixture(), redirect = "https://example.test/accord/index.html";
  const url = new URL(await f.auth.authorize("client", `${redirect}?old=true#section`));
  assert.equal(url.origin, "https://login.tidal.com");
  assert.equal(url.searchParams.get("redirect_uri"), redirect);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), TIDAL_SCOPES);
  assert.match(url.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.match(url.searchParams.get("state"), /^tidal\./);
  const callback = `${redirect}?code=code&state=${url.searchParams.get("state")}`;
  assert.equal(await f.auth.finish(callback), true);
  assert.equal(await f.auth.access("client"), "access");
  assert.equal(f.tokens.length, 1);
  assert.equal(f.tokens[0].redirect_uri, redirect);
  assert.match(f.tokens[0].code_verifier, /^[A-Za-z0-9_-]{86}$/);
  assert.equal("client_secret" in f.tokens[0], false);
  await assert.rejects(f.auth.finish(callback), /state/);
  assert.equal(f.tokens.length, 1);
});

test("OAuth rejects forged/expired/wrong-redirect callbacks and disambiguates Spotify without token calls", async () => {
  for (const type of ["forged", "expired", "redirect", "denied", "missing"]) {
    const f = authFixture();
    const authorize = new URL(await f.auth.authorize("client", "https://example.test/accord/"));
    const callback = new URL("https://example.test/accord/");
    callback.searchParams.set("state", type === "forged" ? "tidal.forged" : authorize.searchParams.get("state"));
    callback.searchParams.set("code", "test");
    if (type === "expired") f.advance(601_000);
    if (type === "redirect") callback.pathname = "/other/";
    if (type === "denied") callback.searchParams.set("error", "access_denied");
    if (type === "missing") callback.searchParams.delete("code");
    await assert.rejects(f.auth.finish(callback.href));
    assert.equal(f.tokens.length, 0);
  }
  const f = authFixture();
  assert.equal(await f.auth.finish("https://example.test/?state=spotify-state&code=x"), false);
  await assert.rejects(f.auth.authorize("", "https://example.test/"), /Client ID/);
  await assert.rejects(f.auth.authorize("client", "http://example.test/"), /HTTPS/);
  assert.equal(f.tokens.length, 0);
});

test("refresh concurrency deduplicates, binds client ID and disconnect clears session credentials", async () => {
  const f = authFixture(), redirect = "https://example.test/";
  const url = new URL(await f.auth.authorize("client", redirect));
  await f.auth.finish(`${redirect}?code=x&state=${url.searchParams.get("state")}`);
  f.advance(3_600_000);
  await Promise.all([f.auth.access("client"), f.auth.access("client")]);
  assert.equal(f.tokens.length, 2);
  assert.equal(f.tokens[1].grant_type, "refresh_token");
  await assert.rejects(f.auth.access("changed"), /Client ID/);
  f.auth.disconnect();
  await assert.rejects(f.auth.access("client"), /Collega/);
});

test("provider epoch blocks already queued work and stale final responses even if toggled back; Spotify preferences stay intact", async () => {
  const local = storage();
  local.setItem("accord-spotify-client-id", "preserved");
  const gate = createMusicServiceGate(local), before = gate.epoch;
  gate.select("tidal"); assert.throws(() => gate.assert("spotify"), /cambiato/);
  assert.equal(local.getItem("accord-spotify-client-id"), "preserved");
  gate.select("spotify"); assert.throws(() => gate.assert("spotify", before), /cambiato/);
  assert.equal(createMusicServiceGate(local).service, "spotify");
  gate.select("qobuz");
  assert.equal(createMusicServiceGate(local).service, "qobuz");
  assert.throws(() => gate.assert("spotify"), /cambiato/);
  gate.select("tidal");
  let enabled = false, release;
  const f = fixture(() => new Promise((resolve) => { release = resolve; }), { active: () => enabled });
  await assert.rejects(f.transport.request("albums/123", "token"), /selezionato/);
  assert.equal(f.calls.length, 0);
  enabled = true;
  const read = f.transport.request("albums/123", "token");
  await new Promise((resolve) => setImmediate(resolve)); enabled = false; release(json(document));
  await assert.rejects(read, /scartata/);
});

test("actual Spotify request and cached result paths reject other services before any Spotify request", async () => {
  const source = readFileSync(new URL("./app.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function spotifyApiFetch("), end = source.indexOf("\nasync function spotifyWriteRequest(", start);
  const gate = createMusicServiceGate(storage());
  let calls = 0;
  const request = runInNewContext(`${source.slice(start, end)}\nspotifyRequest;`, {
    URL, SPOTIFY_API: "https://api.spotify.com/v1", musicService: gate,
    spotifyTransport: { fetch() { calls += 1; assert.fail("Spotify network reached"); } },
    spotifyJsonReader: { read() { calls += 1; return {}; } },
  });
  for (const service of ["tidal", "qobuz"]) {
    gate.select(service);
    await assert.rejects(request("albums/123", "spotify-token"), /cambiato/);
  }
  assert.equal(calls, 0);
});

test("actual queued Spotify network wrapper and late response are blocked by provider epoch", async () => {
  const source = readFileSync(new URL("./app.mjs", import.meta.url), "utf8");
  const start = source.indexOf("fetch: async (url, { accordServiceEpoch");
  const end = source.indexOf("\n  lock:", start);
  const gate = createMusicServiceGate(storage());
  let calls = 0, release;
  const network = runInNewContext(`({${source.slice(start, end)}}).fetch;`, {
    musicService: gate, fetch: async () => { calls += 1; return new Promise((resolve) => { release = resolve; }); },
  });
  const oldEpoch = gate.epoch;
  gate.select("tidal");
  await assert.rejects(network("https://api.spotify.com/v1/albums/123", { accordServiceEpoch: oldEpoch }), /cambiato/);
  assert.equal(calls, 0);
  gate.select("spotify");
  const pending = network("https://api.spotify.com/v1/albums/123", { accordServiceEpoch: gate.epoch });
  await Promise.resolve();
  gate.select("tidal"); gate.select("spotify");
  release({ ok: true });
  await assert.rejects(pending, /cambiato/);
  assert.equal(calls, 1);
});

test("active root/copy modules and tests match; precache covers modules, versions and only necessary TIDAL CSP origins", () => {
  const mirrors = [...new Set(["./pwa/", "../", "../../accord-pwa-site/", "../accord/pwa/", "../../accord/pwa/"]
    .map((path) => new URL(path, import.meta.url).href))]
    .filter((url) => url !== new URL("./", import.meta.url).href && existsSync(new URL("tidal.mjs", url)));
  assert.ok(mirrors.length > 0, "At least one published/development mirror is present");
  for (const mirror of mirrors) for (const file of ["app.mjs", "core.mjs", "ui.mjs", "tidal.mjs", "tidal-ui.mjs",
    "qobuz.mjs", "qobuz-ui.mjs", "qobuz-playback.mjs", "music-suggestion-filters.mjs", "catalog-suggestions.mjs",
    "suggestions-ui.mjs", "music-suggestion-recipes.mjs", "music-suggestion-recipes.test.mjs", "edition-comparison.mjs",
    "music-qol.mjs", "music-qol.test.mjs", "music-app-links.mjs", "music-app-links.test.mjs",
    "album-association.mjs", "album-association.test.mjs",
    "music-library-choices.mjs", "music-library-choices.test.mjs",
    "music-completion.mjs", "music-completion.test.mjs", "music-completion-ui.mjs", "music-completion-ui.test.mjs",
    "catalog-suggestions.test.mjs", "suggestions-ui.browser.mjs", "style.css", "core.test.mjs",
    "tidal.test.mjs", "tidal-ui.test.mjs", "qobuz.test.mjs", "qobuz-ui.test.mjs", "qobuz-playback.test.mjs",
    "service-requests.mjs", "service-requests.test.mjs", "music-continuity.mjs", "music-continuity.test.mjs",
    "catalog-playlist.mjs", "playlist-ui.mjs", "catalog-playlist.test.mjs", "runtime-status.mjs", "runtime-status.test.mjs"]) {
    assert.equal(readFileSync(new URL(file, import.meta.url), "utf8"), readFileSync(new URL(file, mirror), "utf8"), `${file} in ${mirror}`);
  }
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /body \{ margin: 0; min-width: 0; \}/);
  assert.match(html, /v1\.25\.0/); assert.match(sw, /v1\.25\.0/);
  assert.match(html, /connect-src[^;]*https:\/\/openapi\.tidal\.com https:\/\/auth\.tidal\.com/);
  assert.match(sw, /app\.mjs\?v=121/); assert.match(sw, /style\.css\?v=43/);
  assert.match(sw, /tidal\.mjs\?v=12/); assert.match(sw, /tidal-ui\.mjs\?v=35/);
  for (const mirror of mirrors) {
    const mirrorHtml = readFileSync(new URL("index.html", mirror), "utf8");
    const mirrorWorker = readFileSync(new URL("sw.js", mirror), "utf8");
    const assetPrefix = new URL(mirror).pathname.endsWith("/pwa/") ? "../assets/" : "./assets/";
    assert.match(mirrorHtml, /v1\.25\.0/); assert.match(mirrorWorker, /v1\.25\.0/);
    assert.ok(mirrorHtml.includes(`href="${assetPrefix}malt_metal.ico"`));
    assert.ok(mirrorWorker.includes(`"${assetPrefix}malt_metal.ico"`));
    assert.match(mirrorHtml, /media-src 'self' https:\/\/streaming-qobuz-sec\.akamaized\.net https:\/\/streaming-qobuz-std\.akamaized\.net;/);
    for (const file of ["app.mjs?v=121", "style.css?v=43", "tidal-ui.mjs?v=35", "qobuz.mjs?v=11", "qobuz-ui.mjs?v=29",
      "catalog-suggestions.mjs?v=5", "suggestions-ui.mjs?v=19", "music-suggestion-recipes.mjs?v=2",
      "edition-comparison.mjs?v=2", "music-qol.mjs?v=9", "catalog-playlist.mjs?v=5", "playlist-ui.mjs?v=14",
      "music-app-links.mjs?v=3", "qobuz-playback.mjs?v=10", "music-suggestion-filters.mjs?v=3", "service-requests.mjs?v=3",
      "music-continuity.mjs?v=11", "album-association.mjs?v=10",
      "music-completion.mjs?v=13", "music-completion-ui.mjs?v=13", "runtime-status.mjs?v=2"]) {
      assert.ok(mirrorWorker.includes(file), `${file} is cached by the PWA mirror at ${mirror}`);
    }
  }
  const ui = readFileSync(new URL("./tidal-ui.mjs", import.meta.url), "utf8");
  assert.match(ui, /UNLISTED/);
  assert.match(ui, /confirm\(/);
  assert.match(ui, /itemId/); assert.match(ui, /onDuplicates: "SKIP"/);
  assert.doesNotMatch(ui, /spotifyRequest|api\.spotify\.com|playbackStates|userRecommendationBlocks/);
});
