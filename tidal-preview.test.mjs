import test from "node:test";
import assert from "node:assert/strict";
import { tidalEmbedUrl, openTidalPreview } from "./tidal-preview.mjs";

const album = { id: "tidal:42", url: "https://tidal.com/browse/album/42", artist: "<Artist>", name: "<Album>" };

test("official preview binds the same TIDAL album and never forwards tokens or enables autoplay", () => {
  assert.equal(tidalEmbedUrl(album), "https://embed.tidal.com/albums/42");
  assert.equal(tidalEmbedUrl({ ...album, url: album.url + "/?tracking=discarded" }),
    "https://embed.tidal.com/albums/42");
  for (const bad of [{ ...album, id: "spotify:42" }, { ...album, id: "tidal:0" },
    { ...album, url: "https://tidal.com/browse/album/43" },
    { ...album, url: "https://tidal.com.evil.test/browse/album/42" },
    { ...album, url: "https://secret@tidal.com/browse/album/42" },
    { ...album, url: "http://tidal.com/browse/album/42" }]) assert.throws(() => tidalEmbedUrl(bad));
});

class Element extends EventTarget {
  constructor(tagName) {
    super(); this.tagName = tagName; this.children = []; this.attributes = new Map();
  }
  append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
  setAttribute(name, value) { this.attributes.set(name, value); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event("close")); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
}
test("preview is explicit, text-safe and tears down the iframe on close and when replaced", () => {
  const document = { body: new Element("body"), createElement: (tag) => new Element(tag),
    querySelector: () => document.body.children.find((child) => child.className === "tidal-preview-dialog") };
  const before = structuredClone(album);
  const first = openTidalPreview(document, album), frame = first.children.at(-1);
  assert.equal(frame.tagName, "iframe");
  assert.equal(frame.src, "https://embed.tidal.com/albums/42");
  assert.equal(frame.attributes.get("allow"), "encrypted-media");
  assert.ok(!frame.src.includes("autoplay"));
  assert.equal(first.children[0].children[0].textContent, "<Artist> · <Album>");
  const next = openTidalPreview(document, album);
  assert.equal(frame.src, "about:blank");
  assert.equal(document.body.children.length, 1);
  next.children[0].children[1].dispatchEvent(new Event("click"));
  assert.equal(document.body.children.length, 0);
  assert.deepEqual(album, before);
});
