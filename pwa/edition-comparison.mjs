import { isoDurationMs } from "./music-completion.mjs?v=5";

function availableInteger(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}

function durationLabel(record) {
  if (record.duration_iso && !record.duration_ms) {
    try {
      const duration = isoDurationMs(record.duration_iso);
      return `${Math.floor(duration / 60000)} min ${Math.floor(duration / 1000) % 60} s`;
    } catch { return "Durata catalogo non valida"; }
  }
  const milliseconds = availableInteger(record, ["duration_ms", "durationMs"]);
  const seconds = availableInteger(record, ["duration_seconds", "durationSeconds", "duration"]);
  const total = milliseconds > 0 ? Math.floor(milliseconds / 1000) : seconds;
  if (total === null || total <= 0) return "Non disponibile";
  return `${Math.floor(total / 60)} min ${total % 60} s`;
}

export function editionComparisonData(records, provider) {
  const validId = provider === "tidal" ? /^tidal:[1-9][0-9]*$/
    : provider === "qobuz" ? /^qobuz:[A-Za-z0-9]{1,120}$/ : provider === "spotify" ? /^[A-Za-z0-9]{22}$/ : null;
  if (!validId || !Array.isArray(records) || records.length < 2 || records.length > 4
      || records.some((record) => !record || !validId.test(record.id)
        || typeof record.name !== "string" || !record.name.trim()
        || typeof record.artist !== "string" || !record.artist.trim())) {
    throw new Error("Confronta da 2 a 4 album verificati nello stesso catalogo.");
  }
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error("Il confronto richiede identità di catalogo distinte.");
  }
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    artist: record.artist,
    year: record.year || "Non disponibile",
    tracks: availableInteger(record, ["track_count", "tracks_count", "numberOfTracks", "trackCount", "total_tracks"])
      ?? "Non disponibile",
    duration: durationLabel(record),
  }));
}

export function showEditionComparison(records, provider) {
  const editions = editionComparisonData(records, provider);
  const dialog = document.createElement("dialog");
  dialog.className = "album-comparison-dialog";
  const heading = document.createElement("h2");
  heading.textContent = `Confronto edizioni · ${{ spotify: "Spotify", tidal: "TIDAL", qobuz: "Qobuz" }[provider]}`;
  const note = document.createElement("p");
  note.textContent = "Differenze in evidenza. Solo metadati disponibili; quelli mancanti non vengono stimati. Chiudi per tornare alla scelta, senza aggiunte o associazioni.";
  const table = document.createElement("table");
  const fields = [
    ["Artista", (edition) => edition.artist],
    ["Titolo", (edition) => edition.name],
    ["Anno", (edition) => edition.year],
    ["Numero brani", (edition) => edition.tracks],
    ["Durata", (edition) => edition.duration],
    ["Identità catalogo", (edition) => edition.id],
  ];
  const thead = document.createElement("thead"), header = document.createElement("tr");
  header.append(document.createElement("th"));
  for (const [index, edition] of editions.entries()) {
    const cell = document.createElement("th");
    cell.scope = "col"; cell.textContent = edition.name;
    const url = records[index].cover_url;
    if (typeof url === "string") {
      let safe = false;
      try {
        const parsed = new URL(url);
        safe = parsed.protocol === "https:" && !parsed.username && !parsed.password
          && (["resources.tidal.com", "static.qobuz.com", "scdn.co", "spotifycdn.com"].includes(parsed.hostname)
            || parsed.hostname.endsWith(".scdn.co") || parsed.hostname.endsWith(".spotifycdn.com"));
      } catch { safe = false; }
      if (safe) {
        const image = document.createElement("img");
        image.src = url; image.alt = `Copertina: ${edition.name}`; image.referrerPolicy = "no-referrer";
        image.width = image.height = 112; image.className = "comparison-artwork";
        cell.append(image);
      }
    }
    header.append(cell);
  }
  thead.append(header);
  const tbody = document.createElement("tbody");
  for (const [label, value] of fields) {
    const row = document.createElement("tr"), name = document.createElement("th");
    name.scope = "row"; name.textContent = label; row.append(name);
    const different = new Set(editions.map((edition) => String(value(edition)))).size > 1;
    for (const edition of editions) {
      const cell = document.createElement("td");
      cell.textContent = String(value(edition)); row.append(cell);
      if (different) { cell.className = "edition-difference"; cell.title = "Differenza tra le edizioni confrontate"; }
    }
    tbody.append(row);
  }
  table.append(thead, tbody);
  const tableWrapper = document.createElement("div");
  tableWrapper.className = "edition-comparison-table";
  tableWrapper.append(table);
  const close = document.createElement("button");
  close.type = "button"; close.className = "secondary"; close.textContent = "Chiudi";
  close.addEventListener("click", () => dialog.close());
  dialog.append(heading, note, tableWrapper, close);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  return dialog;
}
