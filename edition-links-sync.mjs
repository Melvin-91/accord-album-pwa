import { validEdition } from "./music-continuity.mjs?v=13";

export const EDITION_LINKS_KEY = "accord-music-edition-links-v1";
const providers = ["spotify", "tidal", "qobuz"];
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (value, key) => Object.hasOwn(value, key) ? value[key] : undefined;

export function validateEditionLinks(links, local = false) {
  if (!record(links)) throw new Error("Associazioni edizione non valide. Nessun dato modificato.");
  const result = [];
  for (const [albumId, entries] of Object.entries(links)) {
    if (!albumId || !record(entries)) {
      throw new Error("Associazioni edizione non valide. Nessun dato modificato.");
    }
    const validated = [];
    for (const [provider, entry] of Object.entries(entries)) {
      if (!providers.includes(provider) || !record(entry)
          || Object.keys(entry).length !== 3 || !validEdition(provider, entry.id) || typeof entry.name !== "string") {
        throw new Error("Associazione edizione non valida. Nessun dato modificato.");
      }
      let source = entry.source;
      if (local) {
        try { source = JSON.parse(source); } catch { throw new Error("Identita dell'associazione locale non leggibile. Nessun dato modificato."); }
      }
      if (!Array.isArray(source) || source.length !== 3 || source.some((part) => typeof part !== "string")
          || source[0] !== albumId) throw new Error("Identita dell'associazione non valida. Nessun dato modificato.");
      validated.push([provider, { id: entry.id, name: entry.name, source }]);
    }
    if (validated.length) result.push([albumId, Object.fromEntries(validated.sort(([a], [b]) => a.localeCompare(b)))]);
  }
  return Object.fromEntries(result.sort(([a], [b]) => a.localeCompare(b)));
}

export function readEditionLinksDocument(document) {
  if (!record(document) || Object.keys(document).length !== 3 || document.format !== "accord-edition-links"
      || document.version !== 1 || !Object.hasOwn(document, "links")) {
    throw new Error("Formato associazioni edizione non supportato. Nessun dato modificato.");
  }
  return validateEditionLinks(document.links);
}

export function editionLinksDocument(links) {
  return { format: "accord-edition-links", version: 1, links: validateEditionLinks(links) };
}

export function localEditionLinks(links) {
  return Object.fromEntries(Object.entries(validateEditionLinks(links)).map(([id, entries]) => [id,
    Object.fromEntries(Object.entries(entries).map(([provider, entry]) => [provider,
      { ...entry, source: JSON.stringify(entry.source) }]))]));
}

export function mergeEditionLinks(base, local, remote, choices = {}) {
  base = validateEditionLinks(base); local = validateEditionLinks(local); remote = validateEditionLinks(remote);
  const ids = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])].sort();
  const output = [], conflicts = [];
  for (const id of ids) {
    const merged = [], fields = [];
    for (const provider of providers) {
      const before = own(base, id)?.[provider] ?? null, left = own(local, id)?.[provider] ?? null,
        right = own(remote, id)?.[provider] ?? null;
      let selected;
      if (equal(left, right)) selected = left;
      else if (equal(left, before)) selected = right;
      else if (equal(right, before)) selected = left;
      else {
        const field = `edition_link:${provider}`, choice = own(choices, id)?.[field];
        if (choice !== undefined && !["local", "remote"].includes(choice)) throw new Error("Scelta associazione non valida.");
        if (!choice) { fields.push({ field, base: before, local: left, remote: right }); continue; }
        selected = choice === "local" ? left : right;
      }
      if (selected) merged.push([provider, selected]);
    }
    if (merged.length) output.push([id, Object.fromEntries(merged)]);
    if (fields.length) {
      const source = (fields[0].local || fields[0].remote || fields[0].base).source;
      const album = { id, artist: source[1], name: source[2] };
      conflicts.push({ id, base: album, local: album, remote: album, fields });
    }
  }
  return { links: validateEditionLinks(Object.fromEntries(output)), conflicts };
}
