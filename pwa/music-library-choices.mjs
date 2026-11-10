export const LIBRARY_CHOICES_KEY = "accord-music-library-choices-v1";
export const associationCaptions = {
  never: "Mai cercato", native: "Album nativo del servizio", linked: "Edizione associata",
  stale: "Associazione da verificare", found: "Corrispondenza trovata, non ancora confermata",
  missing: "Nessun risultato compatibile", ambiguous: "Piu' edizioni compatibili: scegli manualmente",
  incomplete: "Ricerca parziale: scegli manualmente", review: "Risultati da verificare manualmente",
  error: "Errore del servizio: riprova o verifica l'accesso", unavailable: "Non disponibile: indicazione manuale",
};
const providers = ["spotify", "tidal", "qobuz"];
export const choiceSource = album => [album.id, album.artist, album.name, album.year ?? null];
export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
function validDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
export function validateLibraryChoices(values) {
  if (!isObject(values)) throw new Error("Scelte musicali locali non leggibili.");
  for (const [id, row] of Object.entries(values)) {
    if (!isObject(row) || !Array.isArray(row.source) || row.source.length !== 4 || row.source[0] !== id
        || row.source.slice(0, 3).some(value => typeof value !== "string")
        || row.source[3] !== null && typeof row.source[3] !== "string" && !Number.isInteger(row.source[3])
        || Object.keys(row).some(key => !["source", "services", "unavailable", "snoozed_until", "preferred"].includes(key))
        || row.preferred !== undefined && !providers.includes(row.preferred)
        || row.snoozed_until !== undefined && !validDay(row.snoozed_until)) throw new Error("Scelte musicali locali non valide.");
    for (const key of ["services", "unavailable"]) {
      if (row[key] === undefined) continue;
      if (!isObject(row[key])) throw new Error("Scelte del servizio non valide.");
      for (const [provider, value] of Object.entries(row[key])) {
        if (!providers.includes(provider) || (key === "unavailable" ? typeof value !== "boolean"
          : !isObject(value) || Object.keys(value).sort().join() !== "checked_at,state"
            || typeof value.state !== "string" || !Object.hasOwn(associationCaptions, value.state) || typeof value.checked_at !== "string")) {
          throw new Error("Esito dell'associazione non valido.");
        }
      }
    }
  }
  return values;
}
export const readLibraryChoices = storage => validateLibraryChoices(JSON.parse(storage.getItem(LIBRARY_CHOICES_KEY) || "{}"));
export function libraryChoice(values, album) {
  const row = values[album.id];
  return row && JSON.stringify(row.source) === JSON.stringify(choiceSource(album)) ? row : {};
}
export const manuallyUnavailable = (values, album, provider) => libraryChoice(values, album).unavailable?.[provider] === true;
export const albumDeferred = (values, album, today = localDay()) => (libraryChoice(values, album).snoozed_until || "") > today;
export function deferredSuggestion(values, album, today = localDay()) {
  const normalize = value => String(value || "").normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
  return Object.values(values).some(row => (row.snoozed_until || "") > today
    && normalize(row.source[1]) === normalize(album.artist) && normalize(row.source[2]) === normalize(album.name));
}
export function libraryAssociationState(values, album, provider, { native = false, linked = false, stale = false } = {}) {
  if (manuallyUnavailable(values, album, provider)) return "unavailable";
  return native ? "native" : linked ? "linked" : stale ? "stale"
    : libraryChoice(values, album).services?.[provider]?.state || "never";
}
export function changeLibraryChoice(values, album, changes, today = localDay()) {
  validateLibraryChoices(values);
  const updated = structuredClone(values), row = structuredClone(libraryChoice(values, album));
  row.source = choiceSource(album);
  const { provider, state, unavailable, snoozedUntil, preferred } = changes;
  if (provider !== undefined && !providers.includes(provider)) throw new Error("Servizio musicale non valido.");
  if (state !== undefined) {
    if (!provider || !Object.hasOwn(associationCaptions, state)) throw new Error("Esito dell'associazione non valido.");
    (row.services ||= {})[provider] = { state, checked_at: new Date().toISOString() };
  }
  if (unavailable !== undefined) {
    if (!provider || typeof unavailable !== "boolean") throw new Error("Indicazione di disponibilita' non valida.");
    (row.unavailable ||= {})[provider] = unavailable;
  }
  if (snoozedUntil !== undefined) {
    if (snoozedUntil === "") delete row.snoozed_until;
    else {
      if (!validDay(snoozedUntil) || snoozedUntil <= today) throw new Error("Scegli una data futura per il rinvio.");
      row.snoozed_until = snoozedUntil;
    }
  }
  if (preferred !== undefined) {
    if (!providers.includes(preferred)) throw new Error("Preferenza di riproduzione non valida.");
    row.preferred = preferred;
  }
  Object.defineProperty(updated, album.id, { value: row, enumerable: true, writable: true, configurable: true });
  return validateLibraryChoices(updated);
}
export function writeLibraryChoice(storage, album, changes) {
  const values = changeLibraryChoice(readLibraryChoices(storage), album, changes);
  storage.setItem(LIBRARY_CHOICES_KEY, JSON.stringify(values));
  return values;
}

export function groupEditionRows(albums, groups) {
  const grouped = new Map(groups.flatMap(group => group.map(album => [album.id, group])));
  const seen = new Set(), result = [];
  for (const album of albums) for (const member of grouped.get(album.id) || [album]) {
    if (!seen.has(member.id)) { result.push(member); seen.add(member.id); }
  }
  return result;
}
