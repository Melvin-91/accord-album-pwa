import test from "node:test";
import assert from "node:assert/strict";
import { initializeTidalUI as initialize } from "./tidal-ui.mjs";
import { createMusicServiceGate } from "./tidal.mjs";
import { artistIsExcluded, excludedArtistNames } from "./music-suggestion-filters.mjs";

let time = Date.now();
const initializeTidalUI = (options) => initialize({ ...options, requestOptions: {
  now: () => time, sleep: async (ms) => { time += ms; }, jitter: () => 0,
} });

test("artist exclusions match normalized whole names without splitting commas", () => {
  const excluded = excludedArtistNames("  earth, wind & FIRE ; OTHER   Artist ;;");
  assert.equal(artistIsExcluded("Earth, Wind & Fire", excluded), true);
  assert.equal(artistIsExcluded("other artist", excluded), true);
  assert.equal(artistIsExcluded("Other", excluded), false);
  assert.equal(artistIsExcluded("", excluded), false);
});

class Node {
  constructor(tag, text = "") {
    this.tag = tag; this.textContent = text; this.children = []; this.dataset = {};
    this.attributes = {}; this.listeners = new Map(); this.value = ""; this.hidden = false; this.checked = false;
  }
  get textContent() { return (this._text || "") + (this.children || []).map((node) => node.textContent).join(""); }
  set textContent(value) { this._text = value; this.children = []; }
  setAttribute(name, value) {
    this.attributes[name] = value;
    if (name === "hidden") this.hidden = true;
    if (name === "value") this.value = value;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }
  async dispatch(name) { for (const listener of this.listeners.get(name) || []) await listener({ target: this }); }
  focus() { this.focused = true; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node);
      this.children.push(node); node.parent = this;
      if (this.tag === "select" && this.children.length === 1) this.value = node.value;
    }
  }
  prepend(...nodes) {
    const previous = [...this.children]; this.children = [];
    for (const node of [...nodes, ...previous]) this.append(node);
  }
  before(node) { this.parent?.prepend(node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  get selectedOptions() { return this.children.filter((node) => node.value === this.value); }
}
const store = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key), map };
};
const albumDocument = {
  data: [{ type: "albums", id: "123" }],
  included: [
    { type: "albums", id: "123", attributes: { title: "Test Album", releaseDate: "2026-01-01" },
      relationships: { artists: { data: [{ type: "artists", id: "9" }] } } },
    { type: "artists", id: "9", attributes: { name: "Test Artist" } },
  ],
};
const playlistDocument = {
  data: [{ type: "tracks", id: "456", meta: { itemId: "occurrence-one" } },
    { type: "tracks", id: "456", meta: { itemId: "occurrence-two" } }],
  included: [...albumDocument.included,
    { type: "tracks", id: "456", attributes: { title: "Test Track" },
      relationships: { albums: { data: [{ type: "albums", id: "123" }] } } }],
};

async function uiFixture(run, albumResponse = albumDocument) {
  const root = new Node("main"), tabs = new Node("nav"), existing = new Map();
  const settingsDialog = new Node("dialog"), settingsScroll = new Node("div");
  settingsDialog.append(settingsScroll);
  existing.set("settingsDialog", settingsDialog);
  root.append(tabs);
  for (const id of ["collectionPanel", "suggestionsPanel", "playlistBuilderPanel", "manualAlbumButton",
    "playlistImportButton", "openSpotifyForm", "loadCoversButton", "manualAlbumDialog", "playlistDialog"]) {
    const node = new Node("section"); existing.set(id, node); root.append(node);
    if (id.endsWith("Panel")) node.append(new Node("old-content"));
  }
  for (const id of ["suggestionsPanel", "playlistBuilderPanel"]) {
    const node = new Node("section");
    node.setAttribute("data-qobuz-panel", id);
    existing.get(id).append(node);
  }
  const collectionMount = new Node("div");
  existing.set("tidalCollectionMount", collectionMount);
  existing.get("collectionPanel").append(collectionMount);
  const selectedTab = new Node("button"); selectedTab.setAttribute("aria-controls", "collectionPanel");
  const walk = (node = root) => [node, ...node.children.flatMap((child) => walk(child))];
  const find = (text) => {
    const found = walk().find((node) => node._text === text) || walk().find((node) => node.textContent === text);
    assert.ok(found, `UI element: ${text}`); return found;
  };
  const field = (label) => find(label).children[0];
  const local = store(), session = store(), calls = [], imported = [];
  local.setItem("accord-tidal-client-id-v1", "demo");
  local.setItem("accord-spotify-client-id", "preserved");
  session.setItem("accord-spotify-access-token", "preserved-session");
  session.setItem("accord-tidal-token-v1", JSON.stringify({ clientId: "demo", access_token: "synthetic",
    expires: Date.now() + 3600000 }));
  const overrides = {
    localStorage: local, sessionStorage: session,
    document: {
      createElement: (tag) => new Node(tag), createTextNode: (text) => new Node("text", text),
      getElementById: (id) => existing.get(id),
      querySelector: (selector) => selector === ".view-tabs" ? tabs
        : selector === "#settingsDialog .dialog-scroll" ? settingsScroll : selectedTab,
    },
    navigator: { locks: { request: async (_name, action) => action() } },
    window: { addEventListener() {} }, location: { href: "https://example.test/accord/", pathname: "/accord/", hash: "" },
    history: { replaceState() {} }, confirm: () => true,
    fetch: async (url, options) => {
      calls.push({ url: String(url), ...options });
      assert.match(String(url), /^https:\/\/openapi\.tidal\.com\/v2\//);
      const path = new URL(url).pathname;
      let document = albumResponse;
      if (path === "/v2/searchResults") document = {
        data: [{ type: "searchResults", id: `opaque/${new URL(url).searchParams.get("filter[query]")}` }],
      };
      else if (path === "/v2/userCollectionPlaylists/me/relationships/items") document = {
        data: [{ type: "playlists", id: "playlist-one" }],
        included: [{ type: "playlists", id: "playlist-one", attributes: { name: "Saved TIDAL playlist" } }],
      };
      else if (path === "/v2/albums/123/relationships/items") document = {
        data: [{ type: "tracks", id: "456" }, { type: "tracks", id: "456" }, { type: "tracks", id: "457" }],
        included: [{ type: "tracks", id: "456", attributes: { title: "Test Track" } },
          { type: "tracks", id: "457", attributes: { title: "Another Track" } }],
      };
      else if (path.includes("NoMatch")) document = { data: [] };
      if (options.method === "POST" && path === "/v2/playlists") document = {
        data: { type: "playlists", id: "created-id", attributes: { name: "New", accessType: "UNLISTED" } } };
      else if (options.method !== "GET") return new Response(null, { status: 204 });
      else if (path.includes("Mixes/me")) document = { data: { type: "userDailyMixes", id: "me" },
        included: [{ type: "playlists", id: "mix-playlist", attributes: { name: "Daily" } }] };
      else if (path.includes("/playlists/") && path.endsWith("/items")) document = playlistDocument;
      return new Response(JSON.stringify(document), { headers: { "Content-Type": "application/vnd.api+json" } });
    },
  };
  const originals = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  try {
    const gate = createMusicServiceGate(local);
    const views = [];
    const ui = initializeTidalUI({ gate, addAlbum: (album) => { imported.push(album); return true; },
      changed() {}, selectView: (view) => views.push(view) });
    await run({ root, walk, find, field, local, session, calls, imported, gate, existing, ui, views });
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}

test("targeted completion page adapter performs one explicit catalog read with country and no writes", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal";
    await f.field("Servizio musicale").dispatch("change");
    const before = f.calls.length;
    await f.ui.playlistAPI.completionPage("albums/123");
    assert.equal(f.calls.length, before + 1);
    const request = f.calls.at(-1), url = new URL(request.url);
    assert.equal(request.method, "GET");
    assert.equal(url.pathname, "/v2/albums/123");
    assert.ok(url.searchParams.get("countryCode"));
    await assert.rejects(f.ui.playlistAPI.completionPage("https://elsewhere.test/albums/123"), /non valida/);
    assert.equal(f.calls.length, before + 1);
  });
});

test("the shared playlist adapter reads real tracks and writes only UNLISTED through public API paths", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal";
    await f.field("Servizio musicale").dispatch("change");
    const api = f.ui.playlistAPI;
    await api.preflight();
    const page = await api.albumTracks("tidal:123");
    assert.deepEqual(page.tracks.map((row) => row.id), ["456", "457"]);
    assert.equal(page.tracks[0].artist, "");
    const playlist = await api.create("New");
    assert.equal(playlist.id, "created-id");
    await api.add(playlist.id, ["456", "457"]);
    const writes = f.calls.filter((call) => call.method === "POST");
    assert.equal(writes.length, 2);
    assert.equal(JSON.parse(writes[0].body).data.attributes.accessType, "UNLISTED");
    assert.match(writes[1].url, /\/v2\/playlists\/created-id\/relationships\/items$/);
    assert.equal(JSON.parse(writes[1].body).meta.onDuplicates, "SKIP");
    const changed = () => { throw new Error("account changed"); };
    await assert.rejects(api.create("Other", changed), /account changed/);
    await assert.rejects(api.add(playlist.id, ["457"], changed), /account changed/);
    assert.equal(f.calls.filter((call) => call.method === "POST").length, 2);
  });
});

test("the collection stays available on TIDAL, configuration shares account settings, and local import never contacts Spotify", async () => {
  await uiFixture(async (f) => {
    assert.equal(f.calls.length, 0);
    const tidalCollection = f.existing.get("tidalCollectionMount").children[0];
    assert.ok(tidalCollection);
    assert.equal(tidalCollection.hidden, true);
    assert.equal(f.existing.get("settingsDialog").children[0].children.some((node) => node.getAttribute("id") === "tidalConfiguration"), true);
    const collectionDetails = tidalCollection.children.find((node) => node.getAttribute("class") === "tidal-collection-details");
    assert.equal(collectionDetails.open, undefined);
    f.field("Servizio musicale").value = "tidal";
    await f.field("Servizio musicale").dispatch("change");
    for (const id of ["manualAlbumButton", "playlistImportButton", "openSpotifyForm", "loadCoversButton"]) {
      assert.equal(f.existing.get(id).hidden, false);
    }
    assert.equal(tidalCollection.hidden, false);
    assert.equal(collectionDetails.open, undefined);
    assert.equal(f.session.getItem("accord-spotify-access-token"), "preserved-session");
    assert.equal(f.local.getItem("accord-spotify-client-id"), "preserved");
    assert.equal(f.walk().some((node) => /^(Riproduci|Pausa|Now playing|Cronologia TIDAL)$/.test(node.textContent)), false);
    f.field("Titolo, artista o link album TIDAL").value = "Test";
    assert.equal(f.calls.length, 0);
    assert.equal(f.find("Importa album selezionati nella raccolta locale").disabled, true);
    await f.find("Cerca · anteprima").dispatch("click");
    assert.equal(collectionDetails.open, true);
    assert.equal(f.calls.length, 2);
    assert.equal(new URL(f.calls[0].url).searchParams.get("filter[query]"), "Test");
    assert.match(f.calls[1].url, /searchResults\/opaque%2FTest\/relationships\/albums/);
    const card = f.walk().find((node) => node.getAttribute("class") === "suggestion-album tidal-album-result");
    assert.ok(card);
    assert.match(card.textContent, /Test Album/);
    assert.match(card.textContent, /Test Artist/);
    assert.match(card.textContent, /2026/);
    card.children[0].children[0].checked = true;
    await card.children[0].children[0].dispatch("change");
    assert.equal(f.find("Importa album selezionati nella raccolta locale").disabled, false);
    assert.equal(f.find("1 elemento selezionato").textContent, "1 elemento selezionato");
    await f.find("Annulla selezione").dispatch("click");
    assert.equal(f.find("Importa album selezionati nella raccolta locale").disabled, true);
    card.children[0].children[0].checked = true;
    await card.children[0].children[0].dispatch("change");
    await f.find("Importa album selezionati nella raccolta locale").dispatch("click");
    assert.equal(f.imported.length, 1); assert.equal(f.imported[0].id, "tidal:123");
    assert.equal(f.calls.length, 2);
  });
});

test("Qobuz uses the shared selector without exposing Spotify or TIDAL views", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "qobuz";
    await f.field("Servizio musicale").dispatch("change");
    assert.equal(f.gate.service, "qobuz");
    assert.equal(f.local.getItem("accord-music-service-v1"), "qobuz");
    assert.equal(f.existing.get("tidalCollectionMount").children[0].hidden, true);
    assert.equal(f.existing.get("playlistImportButton").hidden, false);
    assert.match(f.existing.get("playlistImportButton").textContent, /Qobuz/);
    for (const id of ["suggestionsPanel", "playlistBuilderPanel"]) {
      const children = f.existing.get(id).children;
      assert.equal(children.find((node) => node.dataset.qobuzPanel).hidden, id === "suggestionsPanel");
      assert.equal(children.find((node) => node.dataset.tidalPanel).hidden, true);
      assert.equal(children.find((node) => node.tag === "old-content").hidden, false);
    }
    assert.equal(f.calls.length, 0);
    f.field("Servizio musicale").value = "spotify";
    await f.field("Servizio musicale").dispatch("change");
    assert.equal(f.existing.get("playlistImportButton").hidden, false);
    assert.equal(f.existing.get("suggestionsPanel").children.find((node) => node.tag === "old-content").hidden, false);
  });
});

test("each music service shows the same capability categories for its own features", async () => {
  await uiFixture(async (f) => {
    const summaries = ["spotify", "tidal", "qobuz"].map((name) =>
      f.walk().find((node) => node.getAttribute("id") === `${name}Capabilities`));
    for (const summary of summaries) {
      assert.ok(summary);
      assert.match(summary.textContent, /Cerca musica, scopri album, .*playlist e /i);
    }
    for (const [index, provider] of ["spotify", "tidal", "qobuz"].entries()) {
      f.field("Servizio musicale").value = provider;
      await f.field("Servizio musicale").dispatch("change");
      assert.deepEqual(summaries.map((node) => node.hidden), summaries.map((_node, i) => i !== index));
    }
  });
});

test("TIDAL prepares selected album tracks for playlists without writing remotely", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal";
    await f.field("Servizio musicale").dispatch("change");
    f.field("Titolo, artista o link album TIDAL").value = "Test";
    await f.find("Cerca · anteprima").dispatch("click");
    const card = f.walk().find((node) => node.getAttribute("class") === "suggestion-album tidal-album-result");
    card.children[0].children[0].checked = true;
    await card.children[0].children[0].dispatch("change");
    await f.find("Prepara brani dagli album selezionati").dispatch("click");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.views.at(-1), "playlists");
    assert.match(f.calls.at(-1).url, /albums\/123\/relationships\/items/);
    assert.equal(f.calls.every((call) => call.method === "GET"), true);
    assert.ok(f.find("Brano · Test Track"));
    assert.ok(f.find("Brano · Another Track"));
    assert.equal(f.walk().filter((node) => node.getAttribute("aria-label") === "Seleziona Brano · Test Track").length, 1);
    const track = f.walk().find((node) => node.getAttribute("aria-label") === "Seleziona Brano · Test Track");
    track.checked = true; await track.dispatch("change");
    await f.find("Carica playlist di destinazione").dispatch("click");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(track.checked, true);
    const destination = f.field("Playlist di destinazione");
    destination.value = "playlist-one"; await destination.dispatch("change");
    assert.equal(f.field("ID / link playlist TIDAL").value, "playlist-one");
    await f.find("Prepara aggiunta brani alla playlist").dispatch("click");
    assert.match(f.find("Anteprima pronta. Nessuna scrittura ancora eseguita.").textContent, /Anteprima pronta/);
    assert.equal(f.calls.every((call) => call.method === "GET"), true);
    await f.find("Conferma e invia UNA volta a TIDAL").dispatch("click");
    const writes = f.calls.filter((call) => call.method === "POST");
    assert.equal(writes.length, 1);
    assert.match(writes[0].url, /playlists\/playlist-one\/relationships\/items/);
    assert.deepEqual(JSON.parse(writes[0].body), { data: [{ type: "tracks", id: "456" }], meta: { onDuplicates: "SKIP" } });
  });
});

test("TIDAL album track preview reports bounded pagination and missing metadata", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal";
    await f.field("Servizio musicale").dispatch("change");
    f.field("Titolo, artista o link album TIDAL").value = "Test";
    await f.find("Cerca · anteprima").dispatch("click");
    const card = f.walk().find((node) => node.getAttribute("class") === "suggestion-album tidal-album-result");
    card.children[0].children[0].checked = true;
    await card.children[0].children[0].dispatch("change");
    const originalFetch = globalThis.fetch;
    let pages = 0;
    globalThis.fetch = async (url, options) => {
      if (new URL(url).pathname !== "/v2/albums/123/relationships/items") return originalFetch(url, options);
      pages += 1;
      return new Response(JSON.stringify({
        data: [{ type: "tracks", id: pages === 1 ? "456" : "457" }],
        included: pages === 1 ? [{ type: "tracks", id: "456", attributes: { title: "Test Track" } }] : [],
        links: { next: `https://openapi.tidal.com/v2/albums/123/relationships/items?page=${pages + 1}` },
      }), { headers: { "Content-Type": "application/vnd.api+json" } });
    };
    await f.find("Prepara brani dagli album selezionati").dispatch("click");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pages, 2);
    assert.ok(f.find("Brano · Test Track"));
    assert.match(f.walk().find((node) => node.getAttribute("id") === "tidalStatus").textContent, /Risultato parziale/);
    assert.equal(f.calls.every((call) => call.method === "GET"), true);
  });
});

test("TIDAL discards album preview if the selection or service changes during the read", async () => {
  for (const change of ["selection", "service"]) await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal";
    await f.field("Servizio musicale").dispatch("change");
    f.field("Titolo, artista o link album TIDAL").value = "Test";
    await f.find("Cerca · anteprima").dispatch("click");
    const card = f.walk().find((node) => node.getAttribute("class") === "suggestion-album tidal-album-result");
    const check = card.children[0].children[0];
    check.checked = true; await check.dispatch("change");
    const originalFetch = globalThis.fetch;
    let release, started;
    const pending = new Promise((resolve) => { release = resolve; });
    const requested = new Promise((resolve) => { started = resolve; });
    globalThis.fetch = async (url, options) => {
      const response = await originalFetch(url, options);
      if (new URL(url).pathname === "/v2/albums/123/relationships/items") { started(); await pending; }
      return response;
    };
    await f.find("Prepara brani dagli album selezionati").dispatch("click");
    await requested;
    if (change === "selection") { check.checked = false; await check.dispatch("change"); }
    else {
      f.field("Servizio musicale").value = "qobuz"; await f.field("Servizio musicale").dispatch("change");
      f.field("Servizio musicale").value = "tidal"; await f.field("Servizio musicale").dispatch("change");
    }
    release(); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.walk().some((node) => node._text === "Brano · Test Track"), false);
    assert.equal(f.views.includes("playlists"), false);
    assert.equal(f.calls.every((call) => call.method === "GET"), true);
  });
});

test("dedicated TIDAL playlist import opens in collection without requests, lists saved playlists and imports only previewed albums", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal";
    await f.field("Servizio musicale").dispatch("change");
    assert.match(f.existing.get("playlistImportButton").textContent, /TIDAL/);
    f.ui.openImport();
    assert.deepEqual(f.views, ["collection"]);
    assert.equal(f.calls.length, 0);
    assert.equal(f.find("Elenca playlist TIDAL da importare").focused, true);
    assert.equal(f.find("Importa album da una playlist TIDAL").parent.open, true);
    await f.find("Elenca playlist TIDAL da importare").dispatch("click");
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].url, /userCollectionPlaylists\/me\/relationships\/items/);
    await f.find("Usa questa playlist").dispatch("click");
    assert.equal(f.calls.length, 2);
    assert.match(f.calls[1].url, /playlists\/playlist-one\/relationships\/items/);
    const cards = f.walk().filter((node) => node.getAttribute("class") === "suggestion-album tidal-album-result");
    assert.equal(cards.length, 1, "duplicate track occurrences import one album");
    cards[0].children[0].children[0].checked = true;
    await cards[0].children[0].children[0].dispatch("change");
    await f.find("Importa album selezionati nella raccolta locale").dispatch("click");
    assert.equal(f.imported.length, 1);
    assert.equal(f.imported[0].id, "tidal:123");
    assert.equal(f.calls.length, 2, "local import performs no remote writes or additional reads");
    assert.ok(f.calls.every((call) => call.method === "GET"));
    assert.equal(f.session.getItem("accord-spotify-access-token"), "preserved-session");
    f.field("Servizio musicale").value = "spotify";
    await f.field("Servizio musicale").dispatch("change");
    assert.match(f.existing.get("playlistImportButton").textContent, /Spotify/);
    assert.throws(() => f.ui.openImport(), /cambiato/);
  });
});

test("TIDAL playlist import supports pasted links and respects the shared cooldown before any read", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal";
    await f.field("Servizio musicale").dispatch("change");
    f.ui.openImport();
    f.field("Playlist TIDAL da importare · ID o link").value = "https://tidal.com/browse/playlist/playlist-one";
    await f.find("Anteprima album della playlist TIDAL").dispatch("click");
    assert.equal(f.calls.length, 1);
    const output = f.walk().find((node) => node.attributes.class === "tidal-results");
    const verifiedRows = [...output.children];
    assert.ok(verifiedRows.length > 0);
    f.local.setItem("accord-tidal-cooldown-until-v1", String(Date.now() + 60000));
    await f.find("Anteprima album della playlist TIDAL").dispatch("click");
    assert.equal(f.calls.length, 1);
    assert.deepEqual(output.children, verifiedRows);
    assert.match(f.walk().find((node) => node.attributes.id === "tidalStatus").textContent, /attend|limite|429/i);
    assert.equal(f.imported.length, 0);
  });
});

test("TIDAL add-album command opens the actual catalog controls without requesting Spotify", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal";
    await f.field("Servizio musicale").dispatch("change");
    f.ui.openCatalog("https://tidal.com/browse/album/123");
    assert.deepEqual(f.views, ["collection"]);
    assert.equal(f.field("Titolo, artista o link album TIDAL").value, "https://tidal.com/browse/album/123");
    assert.equal(f.field("Titolo, artista o link album TIDAL").focused, true);
    assert.equal(f.calls.length, 0);
    await f.find("Leggi album dal link / ID").dispatch("click");
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].url, /albums\/123/);
  });
});

test("manual TIDAL cover lookup is bounded, deduplicated and never resolves Spotify identifiers", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal";
    await f.field("Servizio musicale").dispatch("change");
    const empty = await f.ui.loadArtwork([{ id: "spotify123" }]);
    assert.equal(empty.size, 0);
    assert.equal(f.calls.length, 0);
    const albums = [{ id: "tidal:123" }, ...Array.from({ length: 11 }, (_, i) => ({ id: `tidal:${i + 1}` }))];
    const artwork = await f.ui.loadArtwork([...albums, albums[0], { id: "spotify123" }]);
    assert.equal(artwork.get("tidal:123"), "https://resources.tidal.com/images/test.jpg");
    assert.equal(f.calls.length, 10);
    assert.ok(f.calls.every((call) => call.method === "GET" && /\/albums\/[1-9][0-9]*\?/.test(call.url)));
    assert.match(f.walk().find((node) => node.attributes.id === "tidalStatus").textContent, /PARZIALE/);
    f.local.setItem("accord-tidal-cooldown-until-v1", String(Date.now() + 60000));
    await f.ui.loadArtwork(albums);
    assert.equal(f.calls.length, 10);
  }, {
    data: albumDocument.data,
    included: [
      { ...albumDocument.included[0], relationships: { ...albumDocument.included[0].relationships,
        coverArt: { data: { type: "artworks", id: "cover" } } } },
      albumDocument.included[1],
      { type: "artworks", id: "cover", attributes: {
        files: [{ href: "https://resources.tidal.com/images/test.jpg", meta: { width: 320 } }] } },
    ],
  });
});

test("shared account settings explain provider scope restrictions without authorizing or making API requests", async () => {
  await uiFixture(async (f) => {
    const help = f.walk(f.existing.get("settingsDialog")).find(
      (node) => node.getAttribute("id") === "tidalAuthorizationHelp");
    assert.ok(help);
    assert.match(help.textContent, /Allowed scopes: None/);
    assert.match(help.textContent, /1002/);
    assert.match(help.textContent, /supporto TIDAL Developer/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.local.getItem("accord-spotify-client-id"), "preserved");
    assert.equal(f.session.getItem("accord-spotify-access-token"), "preserved-session");
  });
});

test("TIDAL authorization failures remain visible inside the shared account settings", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal";
    await f.field("Servizio musicale").dispatch("change");
    const accountNodes = f.walk(f.existing.get("settingsDialog"));
    accountNodes.find((node) => node.id === "tidalClientIdInput").value = "";
    await accountNodes.find((node) => node.id === "tidalConnectButton").dispatch("click");
    const accountStatus = accountNodes.find(
      (node) => node.attributes.id === "tidalAuthStatus");
    assert.match(accountStatus.textContent, /Client ID/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.session.getItem("accord-spotify-access-token"), "preserved-session");
  });
});

test("TIDAL search is manual and empty results have an accessible status", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal"; await f.field("Servizio musicale").dispatch("change");
    f.field("Titolo, artista o link album TIDAL").value = "NoMatch";
    assert.equal(f.calls.length, 0);
    await f.find("Cerca · anteprima").dispatch("click");
    assert.equal(f.calls.length, 2);
    assert.ok(f.walk().some((node) => node.textContent === "Nessun risultato TIDAL disponibile per questa ricerca."));
    assert.ok(f.walk().some((node) => node.attributes.id === "tidalStatus" && node.textContent.includes("0 risultati mostrati")));
  });
});

test("actual favourites and playlist UI requires preview/confirmation and sends each mutation once", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal"; await f.field("Servizio musicale").dispatch("change");
    assert.equal(f.find("Dati e letture playlist TIDAL").parent.open, true);
    assert.ok(f.find("Mostra gestione playlist esistenti"));
    f.field("Titolo, artista o link album TIDAL").value = "Test"; await f.find("Cerca · anteprima").dispatch("click");
    const albumCard = f.walk().find((node) => node.getAttribute("class") === "suggestion-album tidal-album-result");
    albumCard.children[0].children[0].checked = true;
    await albumCard.children[0].children[0].dispatch("change");
    await f.find("Prepara aggiunta album ai preferiti TIDAL").dispatch("click");
    const technical = f.find("Dettagli tecnici della modifica").parent;
    assert.equal(technical.hidden, false);
    assert.notEqual(technical.open, true);
    assert.ok(technical.textContent.includes("POST"));
    assert.equal(f.calls.length, 2);
    const commit = f.find("Conferma e invia UNA volta a TIDAL");
    await Promise.all([commit.dispatch("click"), commit.dispatch("click")]);
    assert.equal(f.calls.length, 3);
    assert.equal(f.calls[2].method, "POST");
    assert.deepEqual(JSON.parse(f.calls[2].body), { data: [{ type: "albums", id: "123" }] });
    await f.find("Prepara creazione UNLISTED").dispatch("click");
    assert.equal(f.calls.length, 3);
    await commit.dispatch("click");
    assert.equal(f.calls.length, 4);
    assert.equal(JSON.parse(f.calls[3].body).data.attributes.accessType, "UNLISTED");
    assert.equal(f.field("ID / link playlist TIDAL").value, "created-id");
    await f.find("Leggi playlist · anteprima importazione album / brani").dispatch("click");
    const occurrences = f.walk().filter((node) => node.tag === "label" && node.textContent.startsWith("Brano · Test Track · posizione"));
    assert.equal(occurrences.length, 2);
    assert.ok(occurrences.every((node) => !node.textContent.includes("itemId")));
    occurrences[1].children[0].checked = true;
    await f.find("Prepara rimozione occorrenze dalla playlist letta").dispatch("click");
    assert.equal(f.calls.length, 5);
    await commit.dispatch("click");
    assert.equal(f.calls.length, 6);
    assert.equal(f.calls[5].method, "DELETE");
    assert.deepEqual(JSON.parse(f.calls[5].body), { data: [{ type: "tracks", id: "456", meta: { itemId: "occurrence-two" } }] });
  });
});

test("suggestions can use a catalog album without typing an ID", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal"; await f.field("Servizio musicale").dispatch("change");
    f.field("Titolo, artista o link album TIDAL").value = "Test";
    await f.find("Cerca · anteprima").dispatch("click");
    const card = f.walk().find((node) => node.getAttribute("class") === "suggestion-album tidal-album-result");
    const choose = card.children.find((node) => node.textContent === "Usa per suggerimenti");
    await choose.dispatch("click");
    assert.deepEqual(f.views, ["suggestions"]);
    assert.ok(f.walk().some((node) => node.textContent === "Selezionato: Test Artist · Test Album"));
    const advanced = f.find("Usa un link o ID").parent;
    assert.notEqual(advanced.open, true);
    assert.equal(f.calls.length, 2);
    await f.find("Leggi suggerimenti ufficiali · anteprima").dispatch("click");
    assert.match(f.calls[2].url, /albums\/123\/relationships\/similarAlbums/);
  });
});

test("saved artist exclusions apply to suggestions but not the catalog", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal"; await f.field("Servizio musicale").dispatch("change");
    f.field("Titolo, artista o link album TIDAL").value = "Test";
    await f.find("Cerca · anteprima").dispatch("click");
    const card = f.walk().find((node) => node.getAttribute("class") === "suggestion-album tidal-album-result");
    await card.children.find((node) => node.textContent === "Usa per suggerimenti").dispatch("click");
    await f.find("Leggi suggerimenti ufficiali · anteprima").dispatch("click");
    assert.ok(f.walk().some((node) => node.getAttribute("class") === "suggestion-album tidal-album-result"));
    f.field("Artisti da escludere").value = "  TEST   ARTIST ; Another, Artist";
    await f.find("Salva filtri").dispatch("click");
    assert.equal(f.local.getItem("accord-tidal-suggestion-excluded-artists-v1"), "  TEST   ARTIST ; Another, Artist");
    assert.equal(f.walk().filter((node) => node.getAttribute("class") === "suggestion-album tidal-album-result").length, 0);
    await f.find("Leggi suggerimenti ufficiali · anteprima").dispatch("click");
    assert.equal(f.walk().filter((node) => node.getAttribute("class") === "suggestion-album tidal-album-result").length, 0);
    assert.equal(f.walk().some((node) => node.textContent === "Artista · Test Artist"), false);
    await f.find("Cerca · anteprima").dispatch("click");
    assert.ok(f.walk().some((node) => node.getAttribute("class") === "suggestion-album tidal-album-result"));
  });
});

test("artist exclusions match individual TIDAL credits without splitting names", async () => {
  const collaborative = structuredClone(albumDocument);
  collaborative.included[0].relationships.artists.data.push({ type: "artists", id: "10" });
  collaborative.included[1].attributes.name = "Earth, Wind & Fire";
  collaborative.included.push({ type: "artists", id: "10", attributes: { name: "Guest Artist" } });
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal"; await f.field("Servizio musicale").dispatch("change");
    f.field("Titolo, artista o link album TIDAL").value = "Test";
    await f.find("Cerca · anteprima").dispatch("click");
    const card = f.walk().find((node) => node.getAttribute("class") === "suggestion-album tidal-album-result");
    await card.children.find((node) => node.textContent === "Usa per suggerimenti").dispatch("click");
    f.field("Artisti da escludere").value = "guest artist";
    await f.find("Salva filtri").dispatch("click");
    await f.find("Leggi suggerimenti ufficiali · anteprima").dispatch("click");
    assert.equal(f.walk().filter((node) => node.getAttribute("class") === "suggestion-album tidal-album-result").length, 0);
    f.field("Artisti da escludere").value = "Earth, Wind & Fire";
    await f.find("Salva filtri").dispatch("click");
    await f.find("Leggi suggerimenti ufficiali · anteprima").dispatch("click");
    assert.equal(f.walk().filter((node) => node.getAttribute("class") === "suggestion-album tidal-album-result").length, 0);
    f.field("Artisti da escludere").value = "Guest Artist";
    await f.find("Salva filtri").dispatch("click");
    f.field("Fonte dei suggerimenti").value = "similarArtists";
    f.field("ID / link album, oppure ID artista per artisti simili").value = "9";
    await f.find("Leggi suggerimenti ufficiali · anteprima").dispatch("click");
    await f.find("Album dell’artista").dispatch("click");
    assert.equal(f.walk().filter((node) => node.getAttribute("class") === "suggestion-album tidal-album-result").length, 0);
    await f.find("Cerca · anteprima").dispatch("click");
    const catalogCard = f.walk().find((node) => node.getAttribute("class") === "suggestion-album tidal-album-result");
    assert.ok(catalogCard);
    catalogCard.children[0].children[0].checked = true;
    await f.find("Importa album selezionati nella raccolta locale").dispatch("click");
    assert.equal(f.imported.length, 1);
    assert.equal(Object.hasOwn(f.imported[0], "artist_names"), false);
  }, collaborative);
});

test("the shared suggestions adapter searches native albums and prepares a playlist without writes", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal"; await f.field("Servizio musicale").dispatch("change");
    const page = await f.ui.suggestionAPI.search("Test Artist Test Album");
    assert.equal(page.rows[0].album.id, "tidal:123");
    assert.equal(page.complete, true);
    assert.equal(f.calls.length, 2);
    await f.ui.suggestionAPI.prepare(page.rows);
    assert.deepEqual(f.views, ["playlists"]);
    assert.equal(f.calls.filter((call) => call.method !== "GET").length, 0);
    const before = f.calls.length;
    await assert.rejects(f.ui.suggestionAPI.native("favorites", () => { throw new Error("account changed"); }), /account changed/);
    assert.equal(f.calls.length, before);
  });
});

test("actual daily/discovery/new-release mix UI resolves playlist tracks to importable albums with bounded official reads", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal"; await f.field("Servizio musicale").dispatch("change");
    for (const source of ["userDailyMixes", "userDiscoveryMixes", "userNewReleaseMixes"]) {
      f.field("Fonte dei suggerimenti").value = source;
      const before = f.calls.length;
      await f.find("Leggi suggerimenti ufficiali · anteprima").dispatch("click");
      assert.equal(f.calls.length - before, 2);
      assert.match(f.calls[before].url, new RegExp(`${source}/me`));
      assert.match(f.calls[before + 1].url, /playlists\/mix-playlist\/relationships\/items/);
      assert.ok(f.walk().some((node) => node.textContent.includes("Test Album") && node.textContent.includes("Test Artist")));
    }
  });
});

test("changing provider invalidates a prepared write and stale responses without any Spotify fallback", async () => {
  await uiFixture(async (f) => {
    f.field("Servizio musicale").value = "tidal"; await f.field("Servizio musicale").dispatch("change");
    await f.find("Prepara creazione UNLISTED").dispatch("click");
    assert.equal(f.find("Conferma e invia UNA volta a TIDAL").disabled, false);
    f.field("Servizio musicale").value = "spotify"; await f.field("Servizio musicale").dispatch("change");
    assert.equal(f.find("Conferma e invia UNA volta a TIDAL").disabled, true);
    await f.find("Conferma e invia UNA volta a TIDAL").dispatch("click");
    assert.equal(f.calls.length, 0);
  });
});
