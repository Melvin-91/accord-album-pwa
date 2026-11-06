const normalized = (value) => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

function editionTitle(value) {
  const edition = "(?:deluxe|remaster(?:ed)?|expanded|anniversary|special edition|bonus|legacy edition)";
  const marker = new RegExp(`\\b${edition}\\b`);
  let title = normalized(value);
  for (const [open, close] of [["(", ")"], ["[", "]"]]) {
    let start = title.indexOf(open);
    while (start >= 0) {
      const end = title.indexOf(close, start + 1);
      if (end < 0) break;
      if (marker.test(title.slice(start + 1, end))) {
        title = title.slice(0, start) + title.slice(end + 1);
        start = title.indexOf(open, start);
      } else {
        start = title.indexOf(open, end + 1);
      }
    }
  }
  return title.replace(new RegExp(`\\s*[-:]\\s*(?:\\d{4}\\s+)?${edition}\\b.*$`), "").trim().replace(/\s+/g, " ");
}

function duplicateKeys(albums) {
  const groups = new Map();
  for (const album of albums) {
    const artist = normalized(album.artist), title = editionTitle(album.name);
    if (!artist || !title) continue;
    const key = `${artist}|${title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(album.id);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}

export function suggestDurationQueue(albums, durations, budgetMs, alreadyQueued = []) {
  if (!Array.isArray(albums) || !durations || typeof durations !== "object"
      || !Number.isSafeInteger(budgetMs) || budgetMs <= 0
      || Object.values(durations).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("Durate o tempo disponibile non validi.");
  }
  const queued = new Set(alreadyQueued);
  const priorities = { queued: 0, listening: 1, neutral: 2, liked: 3, disliked: 4 };
  const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  const candidates = albums.filter((album) => album.status !== "disliked" && !queued.has(album.id))
    .sort((left, right) => (priorities[left.status] ?? 5) - (priorities[right.status] ?? 5)
      || (Number(right.rating) || 0) - (Number(left.rating) || 0)
      || compareText(normalized(left.artist), normalized(right.artist))
      || compareText(normalized(left.name), normalized(right.name))
      || compareText(left.id, right.id));
  const duplicateIds = new Set(duplicateKeys(candidates).flat());
  const chosen = [], duplicateSkipped = [], overBudget = [], chosenGroups = new Set();
  let total = 0;
  for (const album of candidates) {
    const duration = durations[album.id];
    if (duration === undefined) continue;
    const group = `${normalized(album.artist)}|${editionTitle(album.name)}`;
    if (duplicateIds.has(album.id) && chosenGroups.has(group)) {
      duplicateSkipped.push(album.id);
      continue;
    }
    if (total + duration > budgetMs) {
      overBudget.push(album.id);
      continue;
    }
    chosen.push(album.id);
    total += duration;
    if (duplicateIds.has(album.id)) chosenGroups.add(group);
  }
  return {
    ids: chosen,
    orderedIds: candidates.map((album) => album.id),
    durationMs: total,
    missingDurationIds: candidates.filter((album) => durations[album.id] === undefined).map((album) => album.id),
    overBudgetIds: overBudget,
    duplicateSkippedIds: duplicateSkipped,
  };
}

function voteSummary(album) {
  if (Number.isFinite(album.discogs) && Number.isInteger(album.discogs_votes) && album.discogs_votes > 0) {
    return `Discogs ${album.discogs}/5 · ${album.discogs_votes} voti`
      + (album.discogs_sampled_versions && album.discogs_versions
        ? ` · ${album.discogs_sampled_versions}/${album.discogs_versions} edizioni campionate` : "");
  }
  return "Nessun voto esterno presente nel risultato";
}

function collectionSummary(album, collection) {
  let match = collection.find((entry) => entry.id === album.id);
  let kind = "ID";
  if (!match) {
    match = collection.find((entry) => normalized(entry.artist) === normalized(album.artist)
      && normalized(entry.name) === normalized(album.name));
    kind = "titolo e artista";
  }
  if (!match) return "Non presente nella raccolta locale";
  return `Presente (${kind}) · ${match.status} · `
    + (match.rating === null || match.rating === undefined
      ? "senza voto personale" : `voto personale ${match.rating}/5`);
}

export function createAlbumComparisonToolbar(container, collection, status, source) {
  const toolbar = document.createElement("div");
  toolbar.className = "qol-actions";
  toolbar.setAttribute("aria-label", "Confronto album suggeriti");
  const count = document.createElement("span");
  count.setAttribute("aria-live", "polite");
  const compare = document.createElement("button");
  compare.type = "button";
  compare.className = "secondary";
  compare.textContent = "Confronta selezionati (2–4)";
  compare.disabled = true;
  toolbar.append(count, compare);
  container.before(toolbar);
  const selected = new Map();
  const checkboxes = new Set();

  function refresh() {
    count.textContent = `${selected.size}/4 album selezionati`;
    compare.disabled = selected.size < 2 || selected.size > 4;
    for (const checkbox of checkboxes) {
      checkbox.disabled = !checkbox.checked && selected.size >= 4;
    }
  }

  function append(card, album) {
    const label = document.createElement("label");
    label.className = "check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("aria-label", `Seleziona ${album.name} per il confronto`);
    input.addEventListener("change", () => {
      if (input.checked) selected.set(album.id, album);
      else selected.delete(album.id);
      refresh();
    });
    label.append(input, document.createTextNode("Confronta"));
    card.append(label);
    checkboxes.add(input);
  }

  compare.addEventListener("click", () => {
    const records = [...selected.values()];
    if (records.length < 2 || records.length > 4) return;
    const dialog = document.createElement("dialog");
    dialog.className = "album-comparison-dialog";
    const heading = document.createElement("h2");
    heading.textContent = `Confronto album · ${source}`;
    const note = document.createElement("p");
    note.textContent = "Dati già presenti nei risultati o nella raccolta locale. Nessuna richiesta remota.";
    const table = document.createElement("table");
    const fields = [
      ["Artista", (album) => album.artist || "Non disponibile"],
      ["Anno", (album) => album.year || "Non disponibile"],
      ["Generi", (album) => Array.isArray(album.genres) && album.genres.length ? album.genres.join(", ") : "Non disponibili"],
      ["Motivo / fonte", (album) => [album.source, album.reason || album.matchReason].filter(Boolean).join("\n") || "Non disponibile"],
      ["Voti disponibili", voteSummary],
      ["Presenza e voto personale", (album) => collectionSummary(album, collection())],
    ];
    const head = document.createElement("thead"), headRow = document.createElement("tr");
    const blank = document.createElement("th");
    blank.scope = "col";
    headRow.append(blank);
    for (const album of records) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = album.name || "Album";
      headRow.append(cell);
    }
    head.append(headRow);
    const body = document.createElement("tbody");
    for (const [label, value] of fields) {
      const row = document.createElement("tr"), name = document.createElement("th");
      name.scope = "row";
      name.textContent = label;
      row.append(name);
      for (const album of records) {
        const cell = document.createElement("td");
        cell.textContent = String(value(album));
        row.append(cell);
      }
      body.append(row);
    }
    table.append(head, body);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "secondary";
    close.textContent = "Chiudi";
    close.addEventListener("click", () => dialog.close());
    dialog.append(heading, note, table, close);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
  });
  refresh();
  return {
    append,
    destroy() {
      toolbar.remove();
      selected.clear();
      checkboxes.clear();
    },
  };
}
