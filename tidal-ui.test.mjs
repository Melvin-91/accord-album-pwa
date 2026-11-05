import test from "node:test";
import assert from "node:assert/strict";
import { initializeTidalUI } from "./tidal-ui.mjs";
import { createMusicServiceGate } from "./tidal.mjs";

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
      if (path === "/v2/userCollectionPlaylists/me/relationships/items") document = {
        data: [{ type: "playlists", id: "playlist-one" }],
        included: [{ type: "playlists", id: "playlist-one", attributes: { name: "Saved TIDAL playlist" } }],
      };
      else if (path.includes("NoMatch")) document = { data: [] };
      if (options.method === "POST" && path === "/v2/playlists") document = { data: { type: "playlists", id: "created-id" } };
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
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].url, /searchResults\/Test\/relationships\/albums/);
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
    assert.equal(f.calls.length, 1);
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
    assert.equal(f.field("Playlist TIDAL da importare · ID o link").focused, true);
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
    f.local.setItem("accord-tidal-cooldown-until-v1", String(Date.now() + 60000));
    await f.find("Anteprima album della playlist TIDAL").dispatch("click");
    assert.equal(f.calls.length, 0);
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
    assert.equal(f.calls.length, 1);
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
    assert.equal(f.calls.length, 1);
    const commit = f.find("Conferma e invia UNA volta a TIDAL");
    await Promise.all([commit.dispatch("click"), commit.dispatch("click")]);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].method, "POST");
    assert.deepEqual(JSON.parse(f.calls[1].body), { data: [{ type: "albums", id: "123" }] });
    await f.find("Prepara creazione UNLISTED").dispatch("click");
    assert.equal(f.calls.length, 2);
    await commit.dispatch("click");
    assert.equal(f.calls.length, 3);
    assert.equal(JSON.parse(f.calls[2].body).data.attributes.accessType, "UNLISTED");
    assert.equal(f.field("ID / link playlist TIDAL").value, "created-id");
    await f.find("Leggi playlist · anteprima importazione album / brani").dispatch("click");
    const occurrences = f.walk().filter((node) => node.tag === "label" && node.textContent.startsWith("tracks · Test Track · itemId"));
    assert.equal(occurrences.length, 2);
    occurrences[1].children[0].checked = true;
    await f.find("Prepara rimozione occorrenze dalla playlist letta").dispatch("click");
    assert.equal(f.calls.length, 4);
    await commit.dispatch("click");
    assert.equal(f.calls.length, 5);
    assert.equal(f.calls[4].method, "DELETE");
    assert.deepEqual(JSON.parse(f.calls[4].body), { data: [{ type: "tracks", id: "456", meta: { itemId: "occurrence-two" } }] });
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
