import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { qobuzBundleSecrets, qobuzMd5, qobuzStreamUrl } from "./qobuz-playback.mjs";

test("Qobuz signature MD5 matches reference vectors and byte lengths", () => {
  for (const text of ["", "a", "abc", "message digest", "x".repeat(55), "x".repeat(56),
    "x".repeat(64), "Música", "x".repeat(1000)]) {
    assert.equal(qobuzMd5(text), createHash("md5").update(text).digest("hex"));
  }
});

test("public Qobuz bundle parsing validates app identity without exposing keys", () => {
  const encoded = btoa("synthetic-secret");
  const bundle = `production:{api:{appId:"123456789" a.initialSeed("${encoded.slice(0, 4)}",window.utimezone.alpha)`
    + ` name:"America/Alpha",info:"${encoded.slice(4, 8)}",extras:"${encoded.slice(8)}${"A".repeat(44)}"`;
  assert.deepEqual(qobuzBundleSecrets(bundle, "123456789"), ["synthetic-secret"]);
  assert.throws(() => qobuzBundleSecrets(bundle, "000000000"), /non corrisponde/);
  assert.throws(() => qobuzBundleSecrets("bad", "123456789"), /non corrisponde/);
});

test("stream request signs the exact track, authenticates in headers and accepts only verified CDN hosts", async () => {
  let response = { url: "https://streaming-qobuz-std.akamaized.net/audio?synthetic=1" }, call;
  const request = async (url, options) => { call = { url, options }; return new Response(JSON.stringify(response)); };
  const args = { appId: "123456789", token: "private-token", trackId: "42",
    secret: "synthetic-secret", timestamp: 1234567890, request };
  assert.match(await qobuzStreamUrl(args), /^https:\/\/streaming-qobuz-std/);
  const url = new URL(call.url);
  assert.equal(url.searchParams.get("track_id"), "42");
  assert.equal(url.searchParams.get("request_sig"), createHash("md5").update(
    "trackgetFileUrlformat_id5intentstreamtrack_id421234567890synthetic-secret").digest("hex"));
  assert.equal(call.options.headers["X-User-Auth-Token"], "private-token");
  assert.ok(!url.href.includes("private-token") && !url.href.includes("synthetic-secret"));
  response = { url: "https://streaming-qobuz-std.akamaized.net.evil.example/audio" };
  await assert.rejects(qobuzStreamUrl(args), /origine verificata/);
  response = { url: "https://streaming-qobuz-std.akamaized.net/audio", sample: true };
  await assert.rejects(qobuzStreamUrl(args), /origine verificata/);
  await assert.rejects(qobuzStreamUrl({ ...args, signal: AbortSignal.abort(), request: async (_url, options) => {
    assert.equal(options.signal.aborted, true); throw new Error("cancelled");
  } }), /interrotta/);
});
