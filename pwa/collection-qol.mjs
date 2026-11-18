export const RECENT_CATALOG_SEARCHES = "accord-catalog-searches-v1";
const providers = ["spotify", "tidal", "qobuz"];
const normalized = (text) => text.normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g, " ");
const catalogFields = ["artist", "title", "reference"];
const validCatalogText = (value) => typeof value === "string" && value.length <= 100;
const validSearch = (value) => typeof value === "string"
  ? validCatalogText(value) && Boolean(value.trim())
  : value && typeof value === "object" && !Array.isArray(value)
    && catalogFields.every((key) => validCatalogText(value[key]))
    && catalogFields.some((key) => value[key].trim());

export function catalogSearchFields(provider, value) {
  if (typeof value !== "string") return value;
  const reference = /^(?:https:|qobuz:|tidal:|spotify:)/i.test(value) || provider === "tidal" && /^\d+$/.test(value);
  return { artist: "", title: reference ? "" : value, reference: reference ? value : "" };
}

export function catalogSearchInput(provider, fields) {
  const criteria = Object.fromEntries(catalogFields.map((key) => [key, fields[key].trim()]));
  const { artist, title, reference } = criteria;
  if (!validSearch(criteria)) throw new Error("Inserisci un artista, un titolo album o un link/ID (massimo 100 caratteri per campo).");
  if (reference && (artist || title)) throw new Error("Usa artista e titolo oppure il link/ID, non entrambi.");
  const query = reference || [artist, title].filter(Boolean).join(" ");
  if (query.length > 100) throw new Error("Artista e titolo insieme possono contenere al massimo 100 caratteri.");
  if (reference && (!providers.includes(provider) ||
      !new RegExp(`^(?:https://|${provider}:|[A-Za-z0-9]+$)`, "i").test(reference))) {
    throw new Error("Inserisci un link album o un ID del catalogo selezionato.");
  }
  return { criteria, query, reference: Boolean(reference) };
}

export function catalogCriteriaMatch(album, { artist = "", title = "" }) {
  const key = (text) => normalized(text.normalize("NFKD").replace(/\p{M}/gu, ""));
  return (!artist || key(album.artist).includes(key(artist)))
    && (!title || key(album.name).includes(key(title)));
}

function searches(storage) {
  const saved = JSON.parse(storage.getItem(RECENT_CATALOG_SEARCHES) || "{}");
  if (!saved || typeof saved !== "object" || Array.isArray(saved)
      || Object.entries(saved).some(([provider, values]) => !providers.includes(provider)
        || !Array.isArray(values) || values.length > 20
        || values.some((value) => !validSearch(value)))) {
    throw new Error("Ricerche recenti non leggibili. Nessuna ricerca avviata.");
  }
  return saved;
}
export function recentCatalogSearches(storage, provider) {
  if (!providers.includes(provider)) throw new Error("Catalogo non valido.");
  return searches(storage)[provider] || [];
}
export function rememberCatalogSearch(storage, provider, query) {
  if (!providers.includes(provider) || !validSearch(query)) {
    throw new Error("Criteri di ricerca non validi.");
  }
  const saved = searches(storage), text = typeof query === "string" ? query.trim() : query;
  const key = (value) => {
    const fields = catalogSearchFields(provider, value);
    return JSON.stringify([normalized(fields.artist), normalized(fields.title), fields.reference.trim()]);
  };
  storage.setItem(RECENT_CATALOG_SEARCHES, JSON.stringify({ ...saved,
    [provider]: [text, ...(saved[provider] || []).filter((value) => key(value) !== key(text))].slice(0, 20) }));
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
