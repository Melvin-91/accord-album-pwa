import test from "node:test";
import assert from "node:assert/strict";

import { suggestDurationQueue } from "./music-qol.mjs";

test("duration queue uses known runtimes, deterministic order, and skips duplicate editions", () => {
  const albums = [
    { id: "queued", name: "Album", artist: "Band", status: "queued", rating: 2 },
    { id: "favorite", name: "Favorite", artist: "Artist", status: "liked", rating: 5 },
    { id: "edition", name: "Album (Deluxe Edition)", artist: "Band", status: "queued", rating: null },
    { id: "unknown", name: "Unknown", artist: "Other", status: "queued", rating: null },
    { id: "disliked", name: "Disliked", artist: "Other", status: "disliked", rating: null },
  ];
  const result = suggestDurationQueue(albums,
    { queued: 1_500_000, favorite: 1_200_000, edition: 900_000 }, 2_700_000);
  assert.deepEqual(result.ids, ["queued", "favorite"]);
  assert.equal(result.durationMs, 2_700_000);
  assert.deepEqual(result.missingDurationIds, ["unknown"]);
  assert.deepEqual(result.duplicateSkippedIds, ["edition"]);
});

test("duration queue rejects invalid or missing budgets and durations", () => {
  const albums = [{ id: "a", name: "Album", artist: "Band", status: "queued" }];
  assert.throws(() => suggestDurationQueue(albums, { a: 10 }, 0));
  assert.throws(() => suggestDurationQueue(albums, { a: true }, 100));
});
