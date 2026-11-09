import { validEdition, sourceIdentity } from "./music-continuity.mjs?v=6";

const normalized = (value) => String(value || "").normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
const identity = (albums) => JSON.stringify(albums.map(album =>
  [album.id, album.artist, album.name, album.year ?? null, album.url ?? null])
  .sort((a, b) => a[0].localeCompare(b[0])));
const captions = { native: "Gia' nel catalogo", linked: "Gia' associato", stale: "Associazione da verificare",
  found: "Corrispondenza unica", missing: "Non trovato", ambiguous: "Piu' edizioni: verifica manuale",
  incomplete: "Ricerca parziale: verifica manuale" };

export async function prepareAssociations(albums, links, provider, search, guard = () => {}, progress = () => {}) {
  if (!["spotify", "tidal", "qobuz"].includes(provider)) throw new Error("Scegli Spotify, TIDAL o Qobuz.");
  if (!links || typeof links !== "object" || Array.isArray(links)) throw new Error("Associazioni locali non leggibili.");
  albums = structuredClone(albums); links = structuredClone(links);
  const rows = [];
  for (const [index, album] of albums.entries()) {
    guard(); progress(`Ricerca ${index + 1}/${albums.length}: ${album.artist} · ${album.name}`);
    const entry = links[album.id];
    if (entry !== undefined && (!entry || typeof entry !== "object" || Array.isArray(entry))) {
      throw new Error("Associazioni locali non leggibili.");
    }
    const row = { album, state: "native", selected: null };
    if (!validEdition(provider, album.id)) {
      const saved = links[album.id]?.[provider];
      if (saved) {
        if (!validEdition(provider, saved.id)) throw new Error("Associazione locale non valida.");
        row.state = saved.source === sourceIdentity(album) ? "linked" : "stale";
      } else {
        const page = await search(album); guard();
        const candidates = new Map();
        for (const candidate of page.albums) {
          if (!validEdition(provider, candidate.id)) throw new Error("Identita' album del catalogo non valida.");
          if (normalized(candidate.artist) === normalized(album.artist) && normalized(candidate.name) === normalized(album.name)
              && (!album.year || !candidate.year || String(album.year) === String(candidate.year))) candidates.set(candidate.id, candidate);
        }
        row.state = page.complete !== true ? "incomplete" : candidates.size === 1 ? "found"
          : candidates.size ? "ambiguous" : "missing";
        if (row.state === "found") row.selected = [...candidates.values()][0];
      }
    }
    rows.push(row);
  }
  return { provider, albums, links, rows };
}

export function associationUpdates(plan, albums, links) {
  if (identity(albums) !== identity(plan.albums) || JSON.stringify(links) !== JSON.stringify(plan.links)) {
    throw new Error("Raccolta o associazioni cambiate: ripeti la ricerca prima di confermare.");
  }
  const updated = structuredClone(links);
  for (const { album, selected, state } of plan.rows) {
    if (state !== "found") continue;
    if (!validEdition(plan.provider, selected.id)) throw new Error("Associazione al catalogo non valida.");
    if (updated[album.id]?.[plan.provider]) throw new Error("Associazione gia' presente: nessuna sostituzione automatica.");
    updated[album.id] ||= {};
    updated[album.id][plan.provider] = { id: selected.id, name: selected.name, source: sourceIdentity(album) };
  }
  return updated;
}

export function openAssociationDialog({ albums, links, provider, search, guard, save, report, closed }) {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "Associa tutta la raccolta");
  const heading = document.createElement("h2"); heading.textContent = `Associa tutti a ${provider.toUpperCase()}`;
  const notice = document.createElement("p");
  notice.textContent = `${albums.length} album, inclusi quelli nascosti dai filtri. Solo letture del catalogo e collegamenti locali. `
    + "Artista e titolo esatti, anno compatibile e una sola edizione. Associazioni esistenti, album, voti e preferiti non cambiano.";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const preview = document.createElement("pre"); preview.className = "association-preview";
  const actions = document.createElement("div"); actions.className = "dialog-actions";
  const start = document.createElement("button"); start.type = "button"; start.textContent = "Cerca in tutta la raccolta";
  const apply = document.createElement("button"); apply.type = "button"; apply.textContent = "Associa corrispondenze"; apply.disabled = true;
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Annulla";
  actions.append(start, apply, cancel); dialog.append(heading, notice, status, preview, actions); document.body.append(dialog);
  let running = false, cancelled = false, plan = null;
  const check = () => { if (cancelled || !dialog.open) throw new Error("Ricerca annullata: nessuna associazione salvata."); guard(); };
  const close = () => { cancelled = true; if (!running) dialog.close(); else status.textContent = "Interruzione: attendo la lettura corrente. Nessuna modifica salvata."; };
  cancel.addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => { dialog.remove(); closed(); }, { once: true });
  start.addEventListener("click", async () => {
    if (running) return;
    running = true; start.disabled = true; apply.disabled = true; plan = null;
    try {
      plan = await prepareAssociations(albums, links, provider, search, check, message => { status.textContent = message; });
      check();
      const found = plan.rows.filter(row => row.state === "found").length;
      status.textContent = `${found} nuove associazioni su ${plan.rows.length} album. I casi dubbi restano da verificare.`;
      preview.textContent = plan.rows.map(row => `${row.album.artist} · ${row.album.name}: ${captions[row.state]}`).join("\n");
      apply.textContent = `Associa ${found} album`; apply.disabled = !found;
    } catch (error) {
      status.textContent = `${error.message} Nessuna associazione salvata.`;
      report(status.textContent, true);
    } finally { running = false; if (cancelled) dialog.close(); }
  });
  apply.addEventListener("click", () => {
    if (apply.disabled || !plan || running) return;
    apply.disabled = true;
    try {
      check(); save(plan); dialog.close();
      report(`${plan.rows.filter(row => row.state === "found").length} album associati localmente a ${provider.toUpperCase()}. Nessuna modifica al servizio.`);
    } catch (error) { status.textContent = error.message; report(error.message, true); }
  });
  dialog.showModal();
  return dialog;
}
