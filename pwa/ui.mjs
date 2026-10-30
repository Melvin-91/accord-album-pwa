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
