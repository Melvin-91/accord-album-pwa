const KEYS = ["artistFilter", "end", "excluded", "excludedMode", "exclusion", "included",
  "includedMode", "period", "playlistArtists", "playlistTracks", "start", "tool"];
const TOOLS = new Set(["spotify", "lastfm", "history", "album", "favorites", "mix", "discovery", "daily", "new"]);
const PERIODS = new Set(["7", "30", "90", "365", "all", "custom", "short_term", "medium_term", "long_term"]);
const EXCLUSIONS = new Set(["none", "all", "30", "90", "365", "short_term", "medium_term", "long_term"]);
const MODES = new Set(["contains", "exact"]);
const ownKeys = (value) => Object.keys(value).sort();

export function validateSuggestionCriteria(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
      || ownKeys(value).join("|") !== KEYS.join("|")) {
    throw new Error("Ricetta non valida: sono ammessi solo criteri musicali.");
  }
  if (typeof value.tool !== "string" || !TOOLS.has(value.tool)
      || typeof value.period !== "string" || !PERIODS.has(value.period)
      || typeof value.exclusion !== "string" || !EXCLUSIONS.has(value.exclusion)) {
    throw new Error("Fonte, periodo o esclusione della ricetta non validi.");
  }
  for (const [key, maximum] of [["start", 10], ["end", 10], ["artistFilter", 500], ["included", 300], ["excluded", 300]]) {
    if (typeof value[key] !== "string" || value[key].length > maximum || value[key].includes("\0")) {
      throw new Error("Testo dei criteri della ricetta non valido.");
    }
  }
  for (const key of ["start", "end"]) {
    if (value[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(value[key])
        || Number.isNaN(Date.parse(`${value[key]}T00:00:00Z`))
        || new Date(`${value[key]}T00:00:00Z`).toISOString().slice(0, 10) !== value[key])) {
      throw new Error("Data della ricetta non valida.");
    }
  }
  if (value.period === "custom" && (!value.start || !value.end)) {
    throw new Error("L’intervallo personalizzato della ricetta richiede entrambe le date.");
  }
  if (value.start && value.end && value.start > value.end) throw new Error("Intervallo date della ricetta non valido.");
  if (typeof value.includedMode !== "string" || !MODES.has(value.includedMode)
      || typeof value.excludedMode !== "string" || !MODES.has(value.excludedMode)) {
    throw new Error("Modalità genere della ricetta non valida.");
  }
  if (!Number.isInteger(value.playlistArtists) || value.playlistArtists < 1 || value.playlistArtists > 50
      || !Number.isInteger(value.playlistTracks) || value.playlistTracks < 1 || value.playlistTracks > 10) {
    throw new Error("Numero artisti o brani della ricetta non valido.");
  }
  return { ...value };
}

export function validateSuggestionRecipes(value) {
  if (!Array.isArray(value) || value.length > 20) throw new Error("Elenco ricette non valido.");
  const names = new Set();
  return value.map((recipe) => {
    if (!recipe || Object.getPrototypeOf(recipe) !== Object.prototype
        || ownKeys(recipe).join("|") !== "criteria|name"
        || typeof recipe.name !== "string" || !recipe.name.trim() || recipe.name.trim().length > 60) {
      throw new Error("Ricetta non valida: sono ammessi solo nome e criteri.");
    }
    const name = recipe.name.trim(), key = name.toLocaleLowerCase().replace(/\s+/g, " ");
    if (names.has(key)) throw new Error("Esiste già una ricetta con questo nome.");
    names.add(key);
    return { name, criteria: validateSuggestionCriteria(recipe.criteria) };
  });
}
