const LOCAL_LAYOUTS = new Set(["comfortable", "compact"]);

export function normalizeCollectionPreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    layout: LOCAL_LAYOUTS.has(source.layout) ? source.layout : "comfortable",
    pinnedIds: [...new Set((Array.isArray(source.pinnedIds) ? source.pinnedIds : [])
      .filter((id) => typeof id === "string" && /^[A-Za-z0-9]+$/.test(id)))],
  };
}

export function visibleSelection(selectedIds, albums) {
  const visible = new Set(albums.map((album) => album.id));
  return new Set([...selectedIds].filter((id) => visible.has(id)));
}

export function prepareAlbumUpdates(albums, selectedIds, changes, validate) {
  return albums.map((album) => selectedIds.has(album.id)
    ? validate({ ...album, ...changes }) : album);
}

export function localCommandResults(query, commands, albums, limit = 30) {
  const terms = String(query || "").normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = (value) => terms.every((term) => value.normalize("NFKC").toLocaleLowerCase().includes(term));
  const actions = commands.filter((command) => matches(command.label));
  const records = terms.length ? albums.filter((album) => matches(
    `${album.name} ${album.artist} ${(album.genres || []).join(" ")} ${(album.collections || []).join(" ")} ${(album.tags || []).join(" ")}`,
  )).map((album) => ({
    id: `album:${album.id}`, albumId: album.id, label: `${album.name} · ${album.artist}`, kind: "album",
  })) : [];
  return [...actions, ...records].slice(0, limit);
}

export function editionTitle(value) {
  const edition = "(?:deluxe|remaster(?:ed)?|expanded|anniversary|special edition|bonus|legacy edition)";
  return String(value).normalize("NFKC").toLocaleLowerCase()
    .replace(new RegExp(`[\\(\\[][^\\)\\]]*\\b${edition}\\b[^\\)\\]]*[\\)\\]]`, "g"), "")
    .replace(new RegExp(`\\s*[-:]\\s*(?:\\d{4}\\s+)?${edition}\\b.*$`), "")
    .trim().replace(/\s+/g, " ");
}

export function duplicateAlbumGroups(albums) {
  const groups = new Map();
  for (const album of albums) {
    const key = `${album.artist.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ")}|${editionTitle(album.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(album);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function albumFieldChanges(before, after) {
  return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter((key) => !["id", "updated_at"].includes(key)
      && JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])).sort();
}

export function albumChanges(before, after) {
  const old = new Map(before.map((album) => [album.id, album]));
  const next = new Map(after.map((album) => [album.id, album]));
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap((id) => {
    const left = old.get(id), right = next.get(id);
    const fields = albumFieldChanges(left, right);
    return !left || !right || fields.length
      ? [{ id, before: left, after: right, fields, kind: !left ? "added" : !right ? "removed" : "updated" }] : [];
  });
}

export function smartAlbumMatch(key, album, changedAt = {}, now = Date.now()) {
  const changed = Date.parse(changedAt[album.id] || "");
  const listened = ["liked", "neutral", "disliked"].includes(album.status);
  if (key === "stale_queue") return album.status === "queued" && Number.isFinite(changed)
    && now - changed >= 30 * 86400000;
  if (key === "unrated") return listened && album.rating === null;
  if (key === "recent") return Number.isFinite(changed) && now - changed >= 0 && now - changed <= 7 * 86400000;
  if (key === "favorites_unrated") return album.status === "liked" && album.rating === null;
  return true;
}

export function albumStatistics(albums, changedAt = {}, now = Date.now()) {
  const states = {}, genres = {};
  const ratings = [];
  for (const album of albums) {
    states[album.status] = (states[album.status] || 0) + 1;
    const genre = album.primary_genre || album.genres?.[0] || "Senza genere";
    genres[genre] = (genres[genre] || 0) + 1;
    if (album.rating !== null && album.rating !== undefined) ratings.push(album.rating);
  }
  const month = new Date(now).toISOString().slice(0, 7);
  return { total: albums.length, states, genres,
    unratedListened: albums.filter((album) => ["liked", "neutral", "disliked"].includes(album.status)
      && album.rating === null).length,
    changedThisMonth: albums.filter((album) => String(changedAt[album.id] || "").startsWith(month)).length,
    rated: ratings.length, average: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null };
}

export function suggestionIdentity(album) {
  return [album.artist, album.name].map((value) =>
    String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase()).join("|");
}

export function suggestionWhy(album) {
  if (album.spotifySimilarTo?.length) return `Somiglianza Last.fm con: ${album.spotifySimilarTo.join(", ")}`;
  if (album.similar_to?.length) return `Somiglianza Last.fm con: ${album.similar_to.join(", ")}`;
  if (album.reason || album.matchReason) return [album.reason, album.matchReason].filter(Boolean).join("\n");
  if (album.spotifyArtistId) return `Ripiego Spotify per generi condivisi: ${(album.genres || []).join(", ") || "non comunicati"}`;
  return "Riferimenti non disponibili nel risultato salvato. Nessuna nuova ricerca eseguita.";
}

export function batchAlbumChanges(album, values, mode = "replace") {
  const result = { ...values };
  for (const field of ["genres", "collections", "tags"]) {
    if (!Object.hasOwn(values, field) || mode === "replace") continue;
    const requested = new Set(values[field].map((value) => value.toLocaleLowerCase()));
    result[field] = mode === "remove"
      ? album[field].filter((value) => !requested.has(value.toLocaleLowerCase()))
      : [...album[field], ...values[field].filter((value) =>
        !album[field].some((existing) => existing.toLocaleLowerCase() === value.toLocaleLowerCase()))];
  }
  if (Object.hasOwn(result, "genres")) {
    result.primary_genre = mode !== "replace"
      ? result.genres.find((genre) => genre.toLocaleLowerCase() === String(album.primary_genre || "").toLocaleLowerCase())
        || result.genres[0] || ""
      : result.genres[0] || "";
  }
  return result;
}

export function normalizeAccessibility(value = {}) {
  return {
    textScale: ["normal", "large", "larger"].includes(value?.textScale) ? value.textScale : "normal",
    contrast: value?.contrast === "high" ? "high" : "standard",
    density: value?.density === "compact" ? "compact" : "touch",
  };
}

export function adjacentAlbumIds(albums, id) {
  const index = albums.findIndex((album) => album.id === id);
  return { previous: index > 0 ? albums[index - 1].id : null,
    next: index >= 0 && index < albums.length - 1 ? albums[index + 1].id : null };
}

export function spotifyAlbumIntent(input) {
  const text = String(input || "").trim();
  const candidates = text.match(/https:\/\/open\.spotify\.com\/[^\s<>]+|spotify:album:[A-Za-z0-9]+/g) || [];
  const ids = new Set();
  for (const candidate of candidates) {
    if (/^spotify:album:[A-Za-z0-9]{22}$/.test(candidate)) {
      ids.add(candidate.slice("spotify:album:".length));
      continue;
    }
    let url;
    try { url = new URL(candidate); } catch { continue; }
    const match = url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?album\/([A-Za-z0-9]{22})\/?$/);
    if (url.protocol === "https:" && url.host === "open.spotify.com"
        && !url.username && !url.password && match) ids.add(match[1]);
  }
  if (ids.size !== 1) throw new Error("Incolla o condividi un solo link album Spotify valido (non un brano o una playlist).");
  const id = [...ids][0];
  return { id, url: `https://open.spotify.com/album/${id}` };
}

export function playlistPreviewStatistics(tracks, availableTracks = []) {
  const metadata = new Map(availableTracks.map((track) => [track.uri, track]));
  const artists = new Set(), identities = new Set();
  let duration = 0, timed = 0, known = 0, classified = 0, repeats = 0, artistRows = 0, identified = 0;
  for (const entry of tracks) {
    const track = { ...metadata.get(entry.uri), ...entry };
    const identity = track.uri || track.id;
    if (identity) {
      identified += 1;
      if (identities.has(identity)) repeats += 1;
      identities.add(identity);
    }
    if (Number.isFinite(track.duration_ms) && track.duration_ms > 0) {
      duration += track.duration_ms;
      timed += 1;
    }
    if (Array.isArray(track.artists) && track.artists.length
        && track.artists.every((artist) => artist.id || artist.name)) {
      artistRows += 1;
      for (const artist of track.artists) artists.add(artist.id || artist.name.normalize("NFKC").toLocaleLowerCase());
    }
    if (typeof track.known === "boolean") {
      classified += 1;
      if (track.known) known += 1;
    }
  }
  return { total: tracks.length, duration, timed, uniqueArtists: artists.size, artistRows,
    repeats, identified, known, classified };
}

export function portablePreferences(value = {}) {
  return { ...normalizeCollectionPreferences(value), ...normalizeAccessibility(value) };
}

export function createLocalBackup(albums, preferences, validate) {
  return { format: "accord-local-backup", version: 1,
    albums: albums.map((album) => {
      const record = validate(album);
      return { ...record, url: `https://open.spotify.com/album/${record.id}` };
    }), preferences: portablePreferences(preferences) };
}

export function validateLocalBackup(value, validateDocument) {
  if (!value || value.format !== "accord-local-backup" || value.version !== 1
      || !value.preferences || typeof value.preferences !== "object" || Array.isArray(value.preferences)
      || Object.keys(value).some((key) => !["format", "version", "albums", "preferences"].includes(key))
      || Object.keys(value.preferences).some((key) =>
        !["layout", "pinnedIds", "textScale", "contrast", "density"].includes(key))) {
    throw new Error("Backup locale non valido o contenente campi non consentiti.");
  }
  const preferences = portablePreferences(value.preferences);
  if (Object.entries(value.preferences).some(([key, field]) =>
    JSON.stringify(field) !== JSON.stringify(preferences[key]))) throw new Error("Preferenze backup non valide.");
  return { albums: validateDocument({ format: "accord-album-collection", version: 3, albums: value.albums }),
    preferences };
}

export function prepareSelectiveRestore(current, backup, ids, validate) {
  const available = new Map(backup.albums.map((album) => [album.id, album]));
  for (const id of ids) if (!available.has(id)) throw new Error("Selezione ripristino non valida.");
  const next = new Map(current.map((album) => [album.id, album]));
  for (const id of ids) next.set(id, validate(available.get(id)));
  return [...next.values()];
}

export function commitLocalRestore(storage, key, current, next) {
  storage.setItem(key, JSON.stringify(next));
  Object.assign(current, next);
}
