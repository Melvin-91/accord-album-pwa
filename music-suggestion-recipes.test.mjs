import test from "node:test";
import assert from "node:assert/strict";
import { validateSuggestionCriteria, validateSuggestionRecipes } from "./music-suggestion-recipes.mjs";
import { editionComparisonData } from "./edition-comparison.mjs";
test("Spotify edition comparison preserves reported counts and does not fabricate durations", () => {
  const rows = editionComparisonData([
    { id: "A".repeat(22), name: "Original", artist: "Artist", total_tracks: 10 },
    { id: "B".repeat(22), name: "Deluxe", artist: "Artist", total_tracks: 14, duration_iso: "PT1H" },
  ], "spotify");
  assert.equal(rows[0].tracks, 10);
  assert.equal(rows[1].tracks, 14);
  assert.equal(rows[0].duration, "Non disponibile");
  assert.equal(rows[1].duration, "60 min 0 s");
  assert.throws(() => editionComparisonData([
    { id: "A".repeat(22), name: "Original", artist: "Artist" },
    { id: "tidal:42", name: "Deluxe", artist: "Artist" },
  ], "spotify"), /stesso catalogo/);
});

const criteria = {
  tool: "history", period: "30", start: "", end: "", exclusion: "all",
  artistFilter: "", included: "metal", excluded: "", includedMode: "contains",
  excludedMode: "exact", playlistArtists: 20, playlistTracks: 2,
};

test("saved recipes contain only strictly validated criteria, not accounts, results, or runtime objects", () => {
  assert.deepEqual(validateSuggestionRecipes([{ name: "Metal", criteria }]), [{ name: "Metal", criteria }]);
  for (const key of ["token", "account", "results", "callback", "unexpected"]) {
    assert.throws(() => validateSuggestionCriteria({ ...criteria, [key]: "synthetic" }), /solo criteri/);
  }
  assert.throws(() => validateSuggestionCriteria({ ...criteria, playlistArtists: 51 }), /Numero artisti/);
  assert.throws(() => validateSuggestionCriteria({ ...criteria, period: "custom" }), /entrambe le date/);
  assert.throws(() => validateSuggestionRecipes([
    { name: "Metal", criteria }, { name: " metal ", criteria },
  ]), /già una ricetta/);
});

test("edition comparison preserves exact provider identity and marks missing metadata", () => {
  const rows = editionComparisonData([
    { id: "tidal:1", artist: "Artist", name: "Album", year: "2001", track_count: 12, duration_seconds: 3600 },
    { id: "tidal:2", artist: "Artist", name: "Album (Deluxe)", year: "", track_count: 0 },
  ], "tidal");
  assert.deepEqual(rows.map(({ id, year, tracks, duration }) => ({ id, year, tracks, duration })), [
    { id: "tidal:1", year: "2001", tracks: 12, duration: "60 min 0 s" },
    { id: "tidal:2", year: "Non disponibile", tracks: 0, duration: "Non disponibile" },
  ]);
  assert.throws(() => editionComparisonData([
    { id: "tidal:1", artist: "Artist", name: "Album" },
    { id: "qobuz:2", artist: "Artist", name: "Album" },
  ], "tidal"), /verificati nello stesso catalogo/);
  assert.throws(() => editionComparisonData([
    { id: "qobuz:1", artist: "Artist", name: "Album" },
    { id: "qobuz:1", artist: "Artist", name: "Album Deluxe" },
  ], "qobuz"), /identità di catalogo distinte/);
});
