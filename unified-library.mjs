import { createSyncDocument, validateDocument } from "./core.mjs?v=54";
import { durationDocument, validateDurationDocument } from "./duration-sync.mjs?v=1";
import { physicalDocument, readPhysicalDocument } from "./physical-collection.mjs?v=2";

export const LIBRARY_FILE = "library.json";
export const LEGACY_LIBRARY_FILES = {
  albums_sha: "albums.json",
  physical_sha: "physical-library.json",
  durations_sha: "durations.json",
};
const FORMAT = "accord-library";
const VERSION = 1;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasOnlyKeys = (value, keys) => isRecord(value) && Object.keys(value).every((key) => keys.includes(key));

export function readMusicDocument(document) {
  const albums = validateDocument(document);
  const deletedAlbums = document.deleted_albums === undefined ? [] : validateDocument({
    format: document.format, version: 4, albums: document.deleted_albums,
  });
  const activeIds = new Set(albums.map(({ id }) => id));
  if (deletedAlbums.some(({ id }) => activeIds.has(id))) {
    throw new Error("Archivio rimozioni incoerente con gli album presenti. Nessun dato modificato.");
  }
  return { albums, deletedAlbums, deletionSync: document.deletion_sync === true,
    deletionHistory: document.deletion_history === true };
}

function validateMigration(migration) {
  const keys = Object.keys(LEGACY_LIBRARY_FILES);
  if (!isRecord(migration) || Object.keys(migration).length !== keys.length
      || keys.some((key) => migration[key] !== null && !/^[0-9a-f]{40}$/.test(migration[key] || ""))) {
    throw new Error("Riferimenti alla migrazione del catalogo non validi.");
  }
  return Object.fromEntries(keys.map((key) => [key, migration[key]]));
}

function validateExtensions(extensions) {
  if (!isRecord(extensions)) throw new Error("Estensioni del catalogo non valide.");
  return extensions;
}

export function readUnifiedLibrary(document) {
  if (!hasOnlyKeys(document, ["format", "version", "music", "physical", "durations", "migration", "extensions"])
      || document.format !== FORMAT || document.version !== VERSION
      || !hasOnlyKeys(document.music, ["format", "version", "updated_at", "albums", "deletion_sync", "deletion_history", "deleted_albums"])
      || !hasOnlyKeys(document.physical, ["format", "version", "albums"])) {
    throw new Error("Formato del catalogo condiviso non supportato.");
  }
  return {
    ...readMusicDocument(document.music),
    physical: readPhysicalDocument(document.physical),
    durations: validateDurationDocument(document.durations),
    migration: validateMigration(document.migration),
    extensions: validateExtensions(document.extensions === undefined ? {} : document.extensions),
  };
}

export function createUnifiedLibrary({ albums, deletedAlbums, physical, durations, migration, extensions = {} }) {
  const music = { ...createSyncDocument(albums), deletion_sync: true, deletion_history: true,
    deleted_albums: validateDocument({ format: "accord-album-collection", version: 4, albums: deletedAlbums }) };
  readMusicDocument(music);
  return { format: FORMAT, version: VERSION, music, physical: physicalDocument(physical),
    durations: durationDocument(durations), migration: validateMigration(migration), extensions: validateExtensions(extensions) };
}
