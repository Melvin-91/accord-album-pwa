import test from "node:test";
import assert from "node:assert/strict";
import { configureMusicAppLink, desktopAppLinks, nativeMusicLink } from "./music-app-links.mjs";
import { musicAlbumLink } from "./tidal.mjs";

test("music content links are native only, including tracks and playlists", () => {
  for (const [url, expected] of [
    ["https://open.spotify.com/intl-it/album/abc?si=shared", "spotify:album:abc"],
    ["https://open.spotify.com/playlist/abc", "spotify:playlist:abc"],
    ["https://tidal.com/browse/album/123", "tidal://album/123"],
    ["https://listen.tidal.com/track/123", "tidal://track/123"],
    ["https://tidal.com/browse/playlist/abc-123", "tidal://playlist/abc-123"],
    ["https://play.qobuz.com/album/00123", "qobuzapp://album/00123"],
  ]) assert.equal(nativeMusicLink(url, { desktop: true }), expected);
  for (const url of ["https://evil.test/album/123", "https://play.qobuz.com/invalid",
    "https://user@tidal.com/browse/album/123", "https://tidal.com/search?q=Album"]) {
    assert.throws(() => nativeMusicLink(url), /non valido|non disponibile/);
  }
});

test("iPhones, iPads in desktop mode and Android never receive unverified Qobuz links", () => {
  for (const navigator of [
    { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
    { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", maxTouchPoints: 5 },
    { userAgent: "Mozilla/5.0 (Linux; Android 15)" },
  ]) {
    assert.equal(desktopAppLinks(navigator), false);
    assert.equal(nativeMusicLink("https://play.qobuz.com/album/abc", {
      desktop: desktopAppLinks(navigator),
    }), null);
  }
  assert.equal(desktopAppLinks({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }), true);
});

class Link {
  constructor() { this.listeners = {}; this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
}

test("native anchors have no new web tab or delayed browser fallback", () => {
  const link = configureMusicAppLink(new Link(), "https://tidal.com/browse/album/123");
  assert.equal(link.href, "tidal://album/123");
  assert.equal(link.target, "_self");
  assert.deepEqual(link.listeners, {});
});

test("Qobuz iPhone fallback copies the query on user gesture and exposes copy errors", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const messages = [], copied = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    clipboard: { writeText: async (value) => copied.push(value) },
  } });
  try {
    const link = configureMusicAppLink(new Link(), "https://play.qobuz.com/album/00123", {
      desktop: false, query: "Artist Album", report: (message) => messages.push(message),
    });
    assert.equal(link.href, undefined);
    assert.equal(link.attributes.role, "button");
    assert.equal(link.tabIndex, 0);
    assert.equal(copied.length, 0);
    let prevented = false;
    await link.listeners.click({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(copied, ["Artist Album"]);
    assert.match(messages.pop(), /copiati/);
    globalThis.navigator.clipboard.writeText = async () => { throw new Error("Permission denied"); };
    await link.listeners.click({ preventDefault() {} });
    assert.match(messages.pop(), /Copia non riuscita: Permission denied.*Artist Album/);
    assert.equal(link.href, undefined);
  } finally {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else delete globalThis.navigator;
  }
});

test("cross-catalogue albums require an explicit catalogue choice, never web search", () => {
  const album = { id: "abc", artist: "Artist", name: "Album" };
  assert.equal(musicAlbumLink(album, "tidal"), null);
  assert.equal(musicAlbumLink(album, "qobuz"), null);
  const qobuz = { ...album, id: "qobuz:00123", url: "https://play.qobuz.com/album/00123" };
  assert.equal(musicAlbumLink(qobuz, "qobuz", { desktop: false }), null);
  assert.equal(musicAlbumLink(qobuz, "qobuz", { desktop: true }), "qobuzapp://album/00123");
  assert.equal(musicAlbumLink(qobuz, "spotify"), "spotify:search:Artist%20Album");
});
