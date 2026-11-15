const FORMAT = "accord-album-durations";
const fields = ["id", "artist", "name", "url", "year"];

export function validateDurationEntries(entries) {
  if (!Array.isArray(entries)) throw new Error("Archivio durate non valido.");
  const result = new Map();
  for (const row of entries) {
    if (!row || typeof row !== "object" || Array.isArray(row)
        || Object.keys(row).length !== fields.length + 1
        || fields.some((key) => typeof row[key] !== "string" || row[key].length > 2000)
        || !row.id || !row.artist || !row.name
        || !Number.isSafeInteger(row.duration_ms) || row.duration_ms <= 0 || result.has(row.id)) {
      throw new Error("Archivio durate non valido: nessun dato modificato.");
    }
    result.set(row.id, Object.fromEntries([...fields, "duration_ms"].map((key) => [key, row[key]])));
  }
  return [...result.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function validateDurationDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)
      || Object.keys(document).length !== 3 || document.format !== FORMAT || document.version !== 1) {
    throw new Error("Formato archivio durate non supportato.");
  }
  return validateDurationEntries(document.albums);
}

export function durationDocument(entries) {
  return { format: FORMAT, version: 1, albums: validateDurationEntries(entries) };
}

export function mergeDurations(albums, localAlbums, localValues, remote, base, choices = {}) {
  const remoteMap = new Map(validateDurationEntries(remote).map((row) => [row.id, row]));
  const baseMap = new Map(validateDurationEntries(base).map((row) => [row.id, row]));
  const localIds = new Set(localAlbums.map((row) => row.id)), result = new Map(remoteMap), conflicts = [];
  for (const album of albums) {
    const identity = Object.fromEntries(fields.map((key) => [key, album[key]]));
    const right = remoteMap.get(album.id);
    let previous = baseMap.get(album.id);
    const matches = (entry) => ["id", "url"].every((key) => entry[key] === identity[key]);
    if (right && !matches(right)) {
      throw new Error(`Edizione diversa nell'archivio durate: ${album.artist} - ${album.name}. Nessun dato modificato.`);
    }
    if (previous && !matches(previous)) previous = null;
    const value = localIds.has(album.id) ? localValues[album.id] ?? null : null;
    const left = value === null ? null : { ...identity, duration_ms: value };
    if (left) validateDurationEntries([left]);
    const before = previous?.duration_ms ?? null, remoteValue = right?.duration_ms ?? null;
    let selected;
    if (value === null) selected = remoteValue;
    else if (remoteValue === null || value === remoteValue || remoteValue === before) selected = value;
    else if (value === before) selected = remoteValue;
    else {
      const choice = typeof choices[album.id] === "object" ? choices[album.id]?.duration_ms : choices[album.id];
      if (choice !== undefined && !["local", "remote"].includes(choice)) throw new Error("Scelta durata non valida.");
      if (!choice) {
        conflicts.push({ id: album.id, base: previous, local: left, remote: right,
          fields: [{ field: "duration_ms", base: before, local: value, remote: remoteValue }] });
        continue;
      }
      selected = choice === "local" ? value : remoteValue;
    }
    if (selected !== null) result.set(album.id, { ...identity, duration_ms: selected });
  }
  return { entries: validateDurationEntries([...result.values()]), conflicts };
}
