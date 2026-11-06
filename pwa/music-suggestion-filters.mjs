export function excludedArtistNames(value) {
  return new Set(value.split(";").map((name) => name.trim().replace(/\s+/g, " ").toLowerCase()).filter(Boolean));
}

export function artistIsExcluded(name, excluded) {
  return excluded.has(name.trim().replace(/\s+/g, " ").toLowerCase());
}
