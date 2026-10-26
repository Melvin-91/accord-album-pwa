import assert from "node:assert/strict";
import test from "node:test";
import {
  albumPrimaryGenre,
  albumSecondaryGenres,
  addPlaylistAlbums,
  bestSpotifyAlbumSuggestionMatch,
  decodeCoverArchive,
  encodeCoverArchive,
  expandSimilarArtists,
  filterAlbums,
  filterUnheardArtists,
  filterListeningAlbumSuggestions,
  findSpotifyPlaylistMatches,
  lastFmSuggestionRange,
  listeningAlbumSuggestions,
  listenBrainzRecommendations,
  musicBrainzCoverArtUrl,
  moveAlbumInManualOrder,
  normalizeHeardArtistNames,
  NO_PRIMARY_GENRE_FILTER,
  NO_SECONDARY_GENRE_FILTER,
  playlistAlbumRecords,
  primaryAlbumGenres,
  readLastFmAllTimeArtists,
  readMusicBrainzCatalog,
  sortAlbumsByManualOrder,
  spotifyAlbumId,
  spotifyHistoryArtistLastPlayed,
  spotifyHistoryArtistsInRange,
  spotifyHistoryArtistNames,
  spotifyPlaylistId,
  spotifyRedirectUriForPage,
  summarizeLastFmTracks,
  topTracksPerAlbum,
  topListenedAlbums,
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

test("builds a safe Cover Art Archive URL from a MusicBrainz release-group ID", () => {
  const mbid = "ABCDEF12-3456-7890-abcd-ef1234567890";
  assert.equal(
    musicBrainzCoverArtUrl(mbid),
    "https://coverartarchive.org/release-group/abcdef12-3456-7890-abcd-ef1234567890/front-250",
  );
  assert.equal(musicBrainzCoverArtUrl("https://example.com"), null);
  assert.equal(musicBrainzCoverArtUrl(""), null);
});

test("selects up to three distinct album genres in catalog order", () => {
  assert.deepEqual(
    primaryAlbumGenres([" Rock ", "rock", "Jazz", "", "Metal", "Pop"]),
    ["Rock", "Jazz", "Metal"],
  );
  assert.deepEqual(primaryAlbumGenres([]), []);
  assert.deepEqual(primaryAlbumGenres(null), []);
});

test("selects the closest Spotify album by title, artist, and release year", () => {
  const source = { name: "OK Computer", artist: "Radiohead", artist_names: ["Radiohead"], year: "1997" };
  const candidates = [
    { id: "wrong-artist", name: "OK Computer", artist: "Other Band", year: "1997" },
    { id: "wrong-year", name: "OK Computer", artist: "Radiohead", year: "2007" },
    { id: "best", name: "OK Computer (Remastered)", artist: "Radiohead", year: "1997" },
  ];
  assert.equal(bestSpotifyAlbumSuggestionMatch(source, candidates)?.id, "best");
  assert.equal(bestSpotifyAlbumSuggestionMatch(source, [{ name: "Different Album", artist: "Radiohead" }]), null);
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

test("filters primary and secondary genres independently, including albums without subgenres", () => {
  const albums = [
    album("a", { genres: ["Metal", "Death metal"], primary_genre: "Metal" }),
    album("b", { genres: ["Metal"], primary_genre: "Metal" }),
    album("c", { genres: ["Metal", "Black metal"], primary_genre: "Metal" }),
    album("d", { genres: ["Rock", "Alternative rock"], primary_genre: "Rock" }),
    album("e", { genres: [] }),
  ];
  assert.equal(albumPrimaryGenre(albums[0]), "Metal");
  assert.deepEqual(albumSecondaryGenres(albums[0]), ["Death metal"]);
  assert.deepEqual(filterAlbums(albums, { primaryGenre: "metal" }).map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(filterAlbums(albums, { primaryGenre: "metal", secondaryGenre: "death metal" })
    .map((item) => item.id), ["a"]);
  assert.deepEqual(filterAlbums(albums, { primaryGenre: "metal", secondaryGenre: NO_SECONDARY_GENRE_FILTER })
    .map((item) => item.id), ["b"]);
  assert.deepEqual(filterAlbums(albums, { secondaryGenre: "black metal" }).map((item) => item.id), ["c"]);
  assert.deepEqual(filterAlbums(albums, { primaryGenre: NO_PRIMARY_GENRE_FILTER }).map((item) => item.id), ["e"]);
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
  assert.equal(migrated[0].primary_genre, "");
  assert.throws(() => validateAlbum(album("a", { tags: ["x".repeat(81)] })), /80 caratteri/);
});

test("migrates older genre lists by assigning their first genre as primary", () => {
  const legacy = album("a", { genres: ["Death metal", "Progressive death metal"] });
  delete legacy.primary_genre;
  assert.equal(validateAlbum(legacy).primary_genre, "Death metal");
  assert.equal(validateAlbum(album("b", {
    genres: ["Death metal", "Progressive death metal"],
    primary_genre: "death metal",
  })).primary_genre, "Death metal");
  assert.throws(() => validateAlbum(album("c", {
    genres: ["Death metal"],
    primary_genre: "Rock",
  })), /deve essere assegnato/);
  assert.deepEqual(validateDocument({
    format: "accord-album-collection", version: 3,
    albums: [album("current", { genres: ["Metal"], primary_genre: "Metal" })],
  })[0].primary_genre, "Metal");
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

test("searches playlist pages only until the first page containing matching names", async () => {
  const playlists = (start, matchingIndex = -1) => Array.from({ length: 50 }, (_, index) => ({
    id: String(start + index).padStart(22, "0"),
    name: start + index === matchingIndex ? "Discovery" : `Playlist ${start + index}`,
  }));
  const pages = new Map([
    [0, {
      offset: 0,
      total: 150,
      items: playlists(0),
      next: "https://api.spotify.com/v1/me/playlists?offset=50&limit=50",
    }],
    [50, {
      offset: 50,
      total: 150,
      items: playlists(50, 63),
      next: "https://api.spotify.com/v1/me/playlists?offset=100&limit=50",
    }],
  ]);
  const requestedOffsets = [];
  const matches = await findSpotifyPlaylistMatches(" discovery ", async (offset) => {
    requestedOffsets.push(offset);
    const page = pages.get(offset);
    assert.ok(page, `unexpected playlist page request at offset ${offset}`);
    return page;
  });
  assert.deepEqual(requestedOffsets, [0, 50]);
  assert.deepEqual(matches.map((playlist) => playlist.id), ["0000000000000000000063"]);
});

test("keeps only the most listened suggested album per artist", () => {
  const albums = Array.from({ length: 5 }, (_, index) => ({
    name: `Album ${index + 1}`,
    artist: "Artist",
    artist_names: ["Artist"],
  }));
  const rankings = albums.map((album, index) => ({
    artist: album.artist,
    name: album.name,
    playcount: [3, 12, 8, 4, 1][index],
  }));
  assert.deepEqual(topListenedAlbums(albums, rankings).map((album) => album.name), [
    "Album 2",
  ]);
});

test("expands similar-artist discovery to 30 candidates before exhausting seeds", async () => {
  const seeds = Array.from({ length: 8 }, (_, index) => ({ name: `Seed ${index + 1}` }));
  const requested = [];
  const result = await expandSimilarArtists(seeds, async (seed) => {
    requested.push(seed.name);
    const index = Number(seed.name.slice(-1));
    return Array.from({ length: 5 }, (_, offset) => ({
      name: `Related ${index}-${offset + 1}`,
      match: 0.9 - offset / 100,
    }));
  });
  assert.equal(requested.length, 6);
  assert.equal(result.seedsUsed, 6);
  assert.equal(result.artists.length, 30);
  assert.equal(result.exhausted, false);

  const exhausted = await expandSimilarArtists(seeds.slice(0, 2),
    async (seed) => [{ name: `Related ${seed.name}`, match: 0.5 }]);
  assert.equal(exhausted.artists.length, 2);
  assert.equal(exhausted.exhausted, true);
});

test("falls back to one related catalog alternative per artist only when no direct album matches", () => {
  const albums = [
    { id: "other-1", name: "Other 1", artist: "Other", artist_names: ["Other"] },
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `artist-${index + 1}`,
      name: `Artist ${index + 1}`,
      artist: "Artist",
      artist_names: ["Artist"],
    })),
  ];
  const artists = [
    { name: "Artist" },
    { name: "Other" },
  ];
  const alternatives = listeningAlbumSuggestions(albums, [], artists);
  assert.deepEqual(alternatives.map((album) => album.id), ["artist-1", "other-1"]);
  assert.ok(alternatives.every((album) => album.matchConfidence === "related"));
  assert.ok(alternatives.every((album) => /non e' una corrispondenza Last\.fm/.test(album.matchReason)));
  const direct = listeningAlbumSuggestions(albums, [
    { artist: "Artist", name: "Artist 2", playcount: 20 },
  ], artists);
  assert.deepEqual(direct.map((album) => album.id), ["artist-2"]);
  assert.equal(direct[0].matchConfidence, "high");
  assert.throws(() => listeningAlbumSuggestions(albums, [], artists, 0), /Classifica album non valida/);
});

test("selects up to three most popular tracks per album without duplicate tracks", () => {
  const ids = Array.from({ length: 7 }, (_, index) => String(index + 1).repeat(22));
  const albumGroups = [
    { tracks: ids.slice(0, 4).map((id) => ({ type: "track", uri: `spotify:track:${id}` })) },
    { tracks: ids.slice(3).map((id) => ({ type: "track", uri: `spotify:track:${id}` })) },
  ];
  const popularity = new Map(ids.map((id, index) => [id, [10, 100, 80, 90, 95, 85, 70][index]]));
  assert.deepEqual(topTracksPerAlbum(albumGroups, popularity), [
    `spotify:track:${ids[1]}`,
    `spotify:track:${ids[3]}`,
    `spotify:track:${ids[2]}`,
    `spotify:track:${ids[4]}`,
    `spotify:track:${ids[5]}`,
    `spotify:track:${ids[6]}`,
  ]);
  assert.throws(() => topTracksPerAlbum(albumGroups, new Map([[ids[0], 101]])), /Popolarita'/);
});

test("excludes suggested albums already scrobbled by any credited artist", () => {
  const history = summarizeLastFmTracks([{
    artist: { name: "Guest Artist" },
    album: { name: "Already Heard" },
    date: { uts: "1700000000" },
  }]);
  const albums = [
    { id: "heard", name: "Already Heard", artist: "Lead Artist feat. Guest Artist",
      artist_names: ["Lead Artist", "Guest Artist"], genres: [] },
    { id: "fresh", name: "Fresh Record", artist: "Lead Artist",
      artist_names: ["Lead Artist"], genres: [] },
  ];
  assert.deepEqual(filterListeningAlbumSuggestions(albums, { knownAlbums: history.knownAlbums }), [albums[1]]);
});

test("matches included and excluded genres by exact value or contained text", () => {
  const albums = [
    { id: "technical", name: "Technical", artist: "Artist", genres: ["technical symphonic black metal"] },
    { id: "black", name: "Black", artist: "Artist", genres: ["black metal"] },
    { id: "thrash", name: "Thrash", artist: "Artist", genres: ["thrash metal"] },
    { id: "jazz", name: "Jazz", artist: "Artist", genres: ["jazz"] },
  ];
  assert.deepEqual(filterListeningAlbumSuggestions(albums, {
    includedGenres: ["metal"],
    includedGenresMatch: "contains",
    excludedGenres: ["thrash"],
    excludedGenresMatch: "contains",
  }).map((album) => album.id), ["technical", "black"]);
  assert.deepEqual(filterListeningAlbumSuggestions(albums, {
    includedGenres: ["technical symphonic black metal"],
    includedGenresMatch: "exact",
  }).map((album) => album.id), ["technical"]);
});

test("normalizes local Spotify history to artist names only", () => {
  const rows = [
    { master_metadata_album_artist_name: "  Cafe\u0301 Band ", ms_played: 1 },
    { artistName: "Café Band", msPlayed: 100 },
    { track: { artists: [{ name: "New Artist" }] }, ms_played: 1000 },
    { artistName: "Not Played", ms_played: 0 },
    { artistName: " " },
  ];
  assert.deepEqual(spotifyHistoryArtistNames(rows), ["Café Band", "New Artist"]);
  assert.deepEqual(normalizeHeardArtistNames(["Known", " known ", null]), ["Known"]);
  assert.throws(() => spotifyHistoryArtistNames({ invalid: true }), /Extended Streaming History/);
});

test("keeps latest dated Spotify listen per artist and filters it by window", () => {
  const history = [
    { ts: "2026-01-01T10:00:00Z", ms_played: 1000, artistName: "Old Artist" },
    { ts: "2026-02-01T10:00:00Z", ms_played: 1000, artistName: "Old Artist" },
    { endTime: "2026-01-20T10:00:00Z", ms_played: 1000,
      track: { artists: [{ name: "Recent Artist" }] } },
    { artistName: "Undated Artist", ms_played: 1000 },
    { artistName: "Skipped Artist", ts: "2026-02-10T10:00:00Z", ms_played: 0 },
  ];
  const dated = spotifyHistoryArtistLastPlayed(history);
  assert.deepEqual(dated, [
    { name: "Old Artist", playedAt: "2026-02-01T10:00:00.000Z" },
    { name: "Recent Artist", playedAt: "2026-01-20T10:00:00.000Z" },
  ]);
  assert.deepEqual(spotifyHistoryArtistsInRange(dated, 1769904000, 1770501600), ["Old Artist"]);
  assert.throws(() => spotifyHistoryArtistsInRange(dated, 10, 1), /Intervallo/);
});

test("excludes all-time heard artists from artist and album suggestions", () => {
  const heard = ["  Old Artist "];
  const suggested = [
    { name: "Old Artist", mbid: "heard" },
    { name: "New Artist", mbid: "new" },
  ];
  assert.deepEqual(filterUnheardArtists(suggested, heard), [suggested[1]]);
  const albums = [
    { id: "heard-artist", name: "New Album", artist: "Old Artist", artist_names: ["Old Artist"] },
    { id: "fresh", name: "Fresh Album", artist: "New Artist", artist_names: ["New Artist"] },
  ];
  assert.deepEqual(filterListeningAlbumSuggestions(albums, { heardArtists: heard }), [albums[1]]);
});

test("reads every paginated page of Last.fm overall artists", async () => {
  const pages = [];
  const artists = await readLastFmAllTimeArtists(async (page, limit) => {
    pages.push([page, limit]);
    return {
      topartists: {
        "@attr": { totalPages: "2" },
        artist: [{ name: page === 1 ? "Artist One" : "Artist Two" }],
      },
    };
  });
  assert.deepEqual(pages, [[1, 1000], [2, 1000]]);
  assert.deepEqual(artists, ["Artist One", "Artist Two"]);
  await assert.rejects(readLastFmAllTimeArtists(async (page) => ({
    topartists: { "@attr": { totalPages: page === 1 ? "2" : "1" }, artist: [] },
  })), /Last.fm è cambiata/);
});

test("builds bounded rolling and custom Last.fm date ranges", () => {
  const now = new Date(2026, 0, 15, 12, 0, 0);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  assert.deepEqual(lastFmSuggestionRange("all", "", "", now), { from: null, to: nowSeconds });
  assert.deepEqual(lastFmSuggestionRange("30", "", "", now), {
    from: nowSeconds - 30 * 86400,
    to: nowSeconds,
  });
  const start = new Date(2026, 0, 1);
  const nextDay = new Date(2026, 0, 3);
  assert.deepEqual(lastFmSuggestionRange("custom", "2026-01-01", "2026-01-02", now), {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(nextDay.getTime() / 1000) - 1,
  });
  assert.throws(() => lastFmSuggestionRange("custom", "2026-01-03", "2026-01-02", now), /futuro|data iniziale/);
  assert.throws(() => lastFmSuggestionRange("14", "", "", now), /intervallo/);
});

test("caps aliases and collaborations by canonical credited artist", () => {
  const artistMbid = "83d91898-7763-47d7-b03b-b92132375c47";
  const rows = [
    ["a1", "Artist", "Album 1", 30],
    ["a2", "Artist", "Album 2", 20],
    ["a3", "Artist", "Album 3", 10],
    ["b1", "Artist, The", "Album 4", 25],
    ["b2", "Artist, The", "Album 5", 15],
    ["b3", "Artist, The", "Album 6", 5],
  ];
  const albums = rows.map(([id, artist, name]) => ({
    id, name, artist, artist_names: [artist, "Guest"], artist_mbids: [artistMbid, "83d91898-7763-47d7-b03b-b92132375c48"],
  }));
  const rankings = rows.map(([, artist, name, playcount]) => ({ artist, name, playcount }));

  assert.deepEqual(topListenedAlbums(albums, rankings).map((album) => album.name), [
    "Album 1",
  ]);
});

test("paginates MusicBrainz in bounded pages, deduplicates, and reports incomplete samples", async () => {
  const offsets = [];
  const full = await readMusicBrainzCatalog(async (offset, limit) => {
    offsets.push([offset, limit]);
    const count = 205;
    const start = offset;
    const end = Math.min(offset + limit, count);
    return { count, "release-groups": Array.from({ length: end - start }, (_, index) => ({
      id: `group-${start + index}`,
    })) };
  });
  assert.deepEqual(offsets, [[0, 100], [100, 100], [200, 100]]);
  assert.equal(full.pages, 3);
  assert.equal(full.fetched, 205);
  assert.equal(full.total, 205);
  assert.equal(full.truncated, false);
  assert.equal(full.groups.length, 205);
  const duplicate = await readMusicBrainzCatalog(async () => ({
    count: 2,
    "release-groups": [{ id: "duplicate" }, { id: "duplicate" }],
  }), 2);
  assert.equal(duplicate.fetched, 2);
  assert.equal(duplicate.groups.length, 1);
  assert.equal(duplicate.truncated, true);

  const limited = await readMusicBrainzCatalog(async (offset, limit) => ({
    count: 401,
    "release-groups": Array.from({ length: limit }, (_, index) => ({ id: `limited-${offset + index}` })),
  }));
  assert.equal(limited.fetched, 300);
  assert.equal(limited.truncated, true);
  const unstable = await readMusicBrainzCatalog(async (offset, limit) => ({
    count: offset ? 201 : 200,
    "release-groups": Array.from({ length: limit }, (_, index) => ({ id: `unstable-${offset + index}` })),
  }));
  assert.equal(unstable.pages, 1);
  assert.equal(unstable.truncated, true);
  assert.equal(unstable.groups.length, 100);
  await assert.rejects(readMusicBrainzCatalog(async () => ({}), 301), /Limite o richiesta/);
});

test("uses MusicBrainz IDs and flags duplicate title matches for explicit selection", () => {
  const mbid = "83d91898-7763-47d7-b03b-b92132375c47";
  const albums = [
    { id: "exact", name: "Blue", artist: "Artist", artist_names: ["Artist"], mbid },
    { id: "other", name: "Blue", artist: "Artist", artist_names: ["Artist"],
      mbid: "83d91898-7763-47d7-b03b-b92132375c48" },
  ];
  const byId = topListenedAlbums(albums, [{ artist: "Artist", name: "Different title", mbid, playcount: 20 }]);
  assert.deepEqual(byId.map((album) => album.id), ["exact"]);
  assert.equal(byId[0].matchConfidence, "high");
  assert.match(byId[0].matchReason, /identificativo MusicBrainz/);

  const conflict = topListenedAlbums([
    { id: "conflict", name: "Blue", artist: "Artist", artist_names: ["Artist"],
      mbid: "83d91898-7763-47d7-b03b-b92132375c48" },
  ], [{ artist: "Artist", name: "Blue", mbid, playcount: 10 }]);
  assert.equal(conflict[0].matchConfidence, "ambiguous");
  assert.match(conflict[0].matchReason, /identificativi MusicBrainz non concordano/);

  const ambiguous = topListenedAlbums(albums.map((album) => ({ ...album, mbid: undefined })),
    [{ artist: "Artist", name: "Blue", playcount: 10 }]);
  assert.deepEqual(ambiguous.map((album) => album.matchConfidence), ["ambiguous", "ambiguous"]);
  assert.ok(ambiguous.every((album) => /scegli la corrispondenza Spotify/.test(album.matchReason)));
});

test("uses one canonical Spotify redirect URI for browser and installed PWA paths", () => {
  const canonical = "https://melvin-91.github.io/accord-album-pwa/";
  assert.equal(spotifyRedirectUriForPage(canonical), canonical);
  assert.equal(spotifyRedirectUriForPage(`${canonical}index.html`), canonical);
  assert.equal(spotifyRedirectUriForPage(`${canonical}index.html?source=installed`), canonical);
  assert.equal(spotifyRedirectUriForPage("https://example.test/pwa/index.html"), "https://example.test/pwa/");
});

test("accepts Spotify album IDs, links, and URIs without accepting other hosts", () => {
  const id = "0123456789012345678901";
  assert.equal(spotifyAlbumId(id), id);
  assert.equal(spotifyAlbumId(`spotify:album:${id}`), id);
  assert.equal(spotifyAlbumId(`https://open.spotify.com/intl-it/album/${id}?si=example`), id);
  assert.equal(spotifyAlbumId("Album e artista"), null);
  assert.throws(() => spotifyAlbumId(`https://example.com/album/${id}`), /link Spotify valido/);
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
  assert.deepEqual(albums, [album(id, {
    name: "Record", artist: "Artist", year: "2024", primary_genre: "",
  })]);

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
