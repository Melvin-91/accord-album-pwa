export function excludedArtistNames(value) {
  return new Set(value.split(";").map((name) => name.trim().replace(/\s+/g, " ").toLowerCase()).filter(Boolean));
}

export function artistIsExcluded(name, excluded) {
  return excluded.has(name.trim().replace(/\s+/g, " ").toLowerCase());
}

export function shortReleaseKind(album) {
  const kinds = [album.album_type, album.release_type].map(value => String(value || "").trim().toLowerCase());
  if (kinds.some(kind => ["ep", "eps"].includes(kind))) return { kind: "ep", estimated: false };
  if (kinds.some(kind => ["single", "singles"].includes(kind))) {
    if (!String(album.id || "").startsWith("tidal:") && !String(album.id || "").startsWith("qobuz:")) {
      const count = album.total_tracks;
      if (Number.isSafeInteger(count) && count > 0) return { kind: count <= 3 ? "single" : "ep", estimated: true };
      return { kind: "short", estimated: false };
    }
    return { kind: "single", estimated: false };
  }
  const match = /(?:\(\s*(single|ep)\s*\)|[-:]\s*(single|ep))\s*$/i.exec(String(album.name || ""));
  return { kind: match ? (match[1] || match[2]).toLowerCase() : null, estimated: false };
}

export function albumSearchMatch(album, { includeLive = true, includeShort = true,
  includeSingle = includeShort, includeEp = includeShort } = {}) {
  const title = String(album.name || "");
  const kinds = [album.album_type, album.release_type].map(value => String(value || "").toLowerCase());
  if (!includeLive && (kinds.includes("live")
    || /(?:\blive\s+(?:at|in|from)\b|\(live\b|\blive\s*$|\bconcert\b)/i.test(title))) return false;
  const { kind } = shortReleaseKind(album);
  return !kind || kind === "single" && includeSingle || kind === "ep" && includeEp
    || kind === "short" && (includeSingle || includeEp);
}

export function albumSearchControls(parent, { changed = () => {}, prefix = "albumSearch" } = {}) {
  const group = document.createElement("fieldset");
  const legend = document.createElement("legend"); legend.textContent = "Includi nella ricerca album";
  group.append(legend);
  const options = {};
  for (const [key, caption] of [["includeLive", "Live"], ["includeShort", "Singoli / EP"]]) {
    const label = document.createElement("label");
    label.textContent = caption; label.className = "check";
    const check = document.createElement("input"); check.setAttribute("type", "checkbox");
    check.id = `${prefix}_${key}`; check.checked = true;
    check.addEventListener("change", changed);
    label.prepend(check); group.append(label); options[key] = check;
  }
  const note = document.createElement("p"); note.className = "summary";
  note.textContent = "Filtri sui risultati letti, per tipo dichiarato e titolo. Singoli ed EP sono raggruppati; i tipi non riconosciuti restano visibili.";
  group.append(note); parent.append(group);
  return () => ({ includeLive: options.includeLive.checked, includeShort: options.includeShort.checked });
}
