import test from "node:test";
import assert from "node:assert/strict";
import { createServiceRequests, retryMilliseconds } from "./service-requests.mjs?v=1";
import { createTidalTransport } from "./tidal.mjs";
import { createQobuzClient } from "./qobuz.mjs";

function fixture(service = "qobuz") {
  const data = new Map(), storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
  let time = 1_800_000_000_000;
  const options = { service, storage, now: () => time, sleep: async (ms) => { time += ms; }, jitter: () => 0 };
  return { options, policy: createServiceRequests(options), time: () => time, data };
}
const json = (body = {}, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

test("shared provider queue spaces concurrent clients by at least 500ms", async () => {
  const f = fixture(), other = createServiceRequests(f.options), times = [];
  const request = async () => { times.push(f.time()); return json(); };
  await Promise.all([f.policy.send(request), other.send(request), f.policy.send(request, { read: false })]);
  assert.deepEqual(times.map((time) => time - times[0]), [0, 500, 1000]);
});

test("429 respects Retry-After and retries a read without another parallel request", async () => {
  const f = fixture(), times = [];
  await f.policy.send(async () => {
    times.push(f.time());
    return times.length === 1 ? json({}, 429, { "Retry-After": "2" }) : json();
  });
  assert.deepEqual(times.map((time) => time - times[0]), [0, 2000]);
});

test("long server cooldown is persistent and blocks new clients and writes", async () => {
  const f = fixture();
  const result = await f.policy.send(async () => json({}, 429, { "Retry-After": "120" }));
  assert.equal(result.status, 429);
  assert.equal(f.time(), 1_800_000_000_000);
  const recreated = createServiceRequests(f.options);
  await assert.rejects(recreated.send(() => assert.fail("cooldown reached network"), { read: false }), /120 secondi/);
  assert.equal(f.data.get("accord-qobuz-cooldown-until-v1"), "1800000120000");
});

test("HTTP-date, invalid and absent Retry-After have explicit conservative handling", () => {
  const now = 1_800_000_000_000;
  assert.equal(retryMilliseconds(new Date(now + 9000).toUTCString(), now), 9000);
  assert.equal(retryMilliseconds("1.2", now), 1200);
  for (const header of [null, "", "invalid", "Infinity"]) assert.equal(retryMilliseconds(header, now), 60_000);
});

test("network errors and 5xx reads stop after three attempts; auth failures never retry", async () => {
  for (const kind of ["network", "server", "auth"]) {
    const f = fixture(), start = f.time();
    let attempts = 0;
    const run = f.policy.send(async () => {
      attempts += 1;
      if (kind === "network") throw new TypeError("offline");
      return json({}, kind === "server" ? 503 : 401);
    });
    if (kind === "network") await assert.rejects(run, /offline/);
    else await run;
    assert.equal(attempts, kind === "auth" ? 1 : 3);
    if (kind !== "auth") assert.ok(f.time() - start >= 3000);
  }
});

test("writes and token-style POSTs never retry after network, 429 or server failure", async () => {
  for (const kind of ["network", "server", "limited"]) {
    const f = fixture();
    let attempts = 0;
    const run = f.policy.send(async () => {
      attempts += 1;
      if (kind === "network") throw new TypeError("offline");
      return json({}, kind === "server" ? 503 : 429, { "Retry-After": "1" });
    }, { read: false });
    if (kind === "network") await assert.rejects(run);
    else await run;
    assert.equal(attempts, 1);
  }
});

test("abort or service/account change during backoff prevents further network calls", async () => {
  for (const abort of [true, false]) {
    const f = fixture(), controller = new AbortController();
    let active = true, attempts = 0;
    await assert.rejects(f.policy.send(async () => {
      attempts += 1;
      if (abort) controller.abort(); else active = false;
      return json({}, 503);
    }, { signal: controller.signal, check: () => {
      if (!active) throw new Error("account changed");
    } }));
    assert.equal(attempts, 1);
  }
});

test("TIDAL adapter retries short read pauses, never playlist creation", async () => {
  const f = fixture("tidal");
  let reads = 0, writes = 0;
  const transport = createTidalTransport({ ...f.options, fetch: async (_url, init) => {
    if (init.method === "GET") return ++reads === 1 ? json({}, 429, { "Retry-After": "2" }) : json({ data: [] });
    writes += 1;
    return json({}, 503);
  } });
  assert.deepEqual(await transport.request("albums/123", "token"), { data: [] });
  await assert.rejects(transport.request("playlists", "token", { method: "POST", body: { data: [] } }));
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});

test("a queued read can be cancelled immediately without waiting for another response", async () => {
  const f = fixture(), controller = new AbortController();
  let release, secondCalls = 0;
  const first = f.policy.send(() => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  const second = f.policy.send(() => { secondCalls += 1; return json(); }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(second, { name: "AbortError" });
  release(json());
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondCalls, 0);
});

test("Qobuz adapter shares pacing across instances, retries reads and preserves write uncertainty", async () => {
  const f = fixture();
  let reads = 0, writes = 0;
  const options = { ...f.options, appId: "app", token: "synthetic-token", fetch: async (_url, init) => {
    if (init.method === "POST") { writes += 1; throw new TypeError("private credentials"); }
    return ++reads === 1 ? json({}, 503) : json({ albums: { items: [], total: 0, offset: 0 } });
  } };
  await createQobuzClient(options).favorites();
  await createQobuzClient(options).favorites();
  await assert.rejects(createQobuzClient(options).createPlaylist("Lista", "", false), /incerto/i);
  assert.equal(reads, 3);
  assert.equal(writes, 1);
});

test("invalid persistent throttle state fails explicitly before sending", async () => {
  const f = fixture();
  f.data.set("accord-qobuz-cooldown-until-v1", "broken");
  await assert.rejects(f.policy.send(() => assert.fail("invalid state reached network")), /non valido/);
});
