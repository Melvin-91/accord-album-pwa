function availableInteger(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}

function durationLabel(record) {
  const milliseconds = availableInteger(record, ["duration_ms", "durationMs"]);
  const seconds = availableInteger(record, ["duration_seconds", "durationSeconds", "duration"]);
  const total = milliseconds > 0 ? Math.floor(milliseconds / 1000) : seconds;
  if (total === null || total <= 0) return "Non disponibile";
  return `${Math.floor(total / 60)} min ${total % 60} s`;
}

export function editionComparisonData(records, provider) {
  const validId = provider === "tidal" ? /^tidal:[1-9][0-9]*$/
    : provider === "qobuz" ? /^qobuz:[A-Za-z0-9]{1,120}$/ : null;
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
    tracks: availableInteger(record, ["track_count", "tracks_count", "numberOfTracks", "trackCount"])
      ?? "Non disponibile",
    duration: durationLabel(record),
  }));
}

export function showEditionComparison(records, provider) {
  const editions = editionComparisonData(records, provider);
  const dialog = document.createElement("dialog");
  dialog.className = "album-comparison-dialog";
  const heading = document.createElement("h2");
  heading.textContent = `Confronto edizioni · ${provider === "tidal" ? "TIDAL" : "Qobuz"}`;
  const note = document.createElement("p");
  note.textContent = "Solo metadati già disponibili. L'associazione resta separata e rimovibile; album, identità e voti non vengono uniti o trasferiti.";
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
  for (const edition of editions) {
    const cell = document.createElement("th");
    cell.scope = "col"; cell.textContent = edition.name;
    header.append(cell);
  }
  thead.append(header);
  const tbody = document.createElement("tbody");
  for (const [label, value] of fields) {
    const row = document.createElement("tr"), name = document.createElement("th");
    name.scope = "row"; name.textContent = label; row.append(name);
    for (const edition of editions) {
      const cell = document.createElement("td");
      cell.textContent = String(value(edition)); row.append(cell);
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
