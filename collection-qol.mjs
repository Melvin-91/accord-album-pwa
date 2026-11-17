export const RECENT_CATALOG_SEARCHES = "accord-catalog-searches-v1";
const providers = ["spotify", "tidal", "qobuz"];
const normalized = (text) => text.normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g, " ");

function searches(storage) {
  const saved = JSON.parse(storage.getItem(RECENT_CATALOG_SEARCHES) || "{}");
  if (!saved || typeof saved !== "object" || Array.isArray(saved)
      || Object.entries(saved).some(([provider, values]) => !providers.includes(provider)
        || !Array.isArray(values) || values.length > 20
        || values.some((value) => typeof value !== "string" || !value.trim() || value.length > 100))) {
    throw new Error("Ricerche recenti non leggibili. Nessuna ricerca avviata.");
  }
  return saved;
}
export function recentCatalogSearches(storage, provider) {
  if (!providers.includes(provider)) throw new Error("Catalogo non valido.");
  return searches(storage)[provider] || [];
}
export function rememberCatalogSearch(storage, provider, query) {
  if (!providers.includes(provider) || typeof query !== "string" || !query.trim() || query.trim().length > 100) {
    throw new Error("Criteri di ricerca non validi.");
  }
  const saved = searches(storage), text = query.trim();
  storage.setItem(RECENT_CATALOG_SEARCHES, JSON.stringify({ ...saved,
    [provider]: [text, ...(saved[provider] || []).filter((value) => normalized(value) !== normalized(text))].slice(0, 20) }));
}
export function clearCatalogSearches(storage, provider) {
  if (!providers.includes(provider)) throw new Error("Catalogo non valido.");
  storage.setItem(RECENT_CATALOG_SEARCHES, JSON.stringify({ ...searches(storage), [provider]: [] }));
}
export function catalogSearchCorrections(query, candidates) {
  const text = normalized(query);
  if (text.length < 3 || text.length > 100 || text.includes("://") || /^[A-Za-z0-9]{22}$|^[0-9]+$/.test(query.trim())) return [];
  const ranked = new Map();
  for (const candidate of candidates) {
    const right = normalized(candidate);
    if (!right || right === text || right.length > 200 || ranked.has(right)) continue;
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let left = 1; left <= text.length; left += 1) {
      const current = [left];
      for (let column = 1; column <= right.length; column += 1) current.push(Math.min(
        previous[column] + 1, current[column - 1] + 1, previous[column - 1] + (text[left - 1] === right[column - 1] ? 0 : 1)));
      previous = current;
    }
    const score = 1 - previous[right.length] / Math.max(text.length, right.length);
    if (score >= .78) ranked.set(right, { value: candidate.trim(), score });
  }
  return [...ranked.values()].sort((a, b) => b.score - a.score || a.value.localeCompare(b.value)).slice(0, 3).map(({ value }) => value);
}
export function filteredCollection(albums, { query = "", status = "", favoritesOnly = false, favoriteIds = [] } = {}) {
  const text = normalized(query), favorites = new Set(favoriteIds);
  return albums.filter((album) => (!text || normalized(`${album.artist} ${album.name}`).includes(text))
    && (!status || album.status === status) && (!favoritesOnly || favorites.has(album.id)))
    .sort((a, b) => a.artist.localeCompare(b.artist, "it") || a.name.localeCompare(b.name, "it"));
}
export function collectionAnomalies(albums, durations = {}, provenance = {}) {
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) throw new Error("Provenienza non leggibile.");
  return albums.flatMap((album) => {
    const reasons = [], duration = durations[album.id], record = provenance[album.id]?.duration;
    if (!album.year) reasons.push("Anno non specificato");
    if (!album.genres.length) reasons.push("Generi non assegnati");
    if (!Number.isSafeInteger(duration) || duration <= 0) reasons.push("Durata mancante o non valida");
    else if (duration < 60_000 || duration > 12 * 60 * 60_000) reasons.push("Durata insolita: sotto 1 minuto o sopra 12 ore, da verificare");
    if (record && (record.duration_ms !== undefined && record.duration_ms !== duration
        || record.identity && JSON.stringify(record.identity) !== JSON.stringify([album.id, album.artist, album.name]))) {
      reasons.push("Provenienza durata storica o non coerente");
    }
    return reasons.map((reason) => ({ id: album.id, reason }));
  });
}
