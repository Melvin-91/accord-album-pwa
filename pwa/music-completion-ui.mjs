import { COMPLETION_KEY, COMPLETION_CATEGORIES, createCompletionPlan, continueCompletion, runCompletion } from "./music-completion.mjs?v=14";
import { pauseRemaining } from "./music-continuity.mjs?v=12";

const openPlans = new WeakMap();

export function openMusicCompletion({ storage, albums, ids, provider, read, guard, changed = () => {},
  durationsOnly = false, resume = false, document = globalThis.document }) {
  if (openPlans.has(storage)) throw new Error("Un piano di completamento e' gia' aperto: usa quella finestra.");
  const previous = resume ? JSON.parse(storage.getItem(COMPLETION_KEY) || "null") : null;
  const selectedIds = resume ? previous?.rows.map((row) => row.album.id) || [] : ids;
  const selected = albums.filter((album) => selectedIds.includes(album.id));
  if (!selected.length) throw new Error("Seleziona gli album della raccolta da completare.");
  const dialog = document.createElement("dialog");
  dialog.className = "album-comparison-dialog";
  const make = (tag, text) => { const element = document.createElement(tag); element.textContent = text; return element; };
  const title = make("h2", "Completa solo questi album");
  const hint = make("p", "Anteprima locale: aprire o selezionare non interroga servizi. "
    + "Solo campi mancanti, nessuna scrittura remota o sostituzione delle scelte personali. "
    + "Durate: edizione nativa o associata esplicitamente, tutti i brani validi. "
    + "Generi: tag musicali Last.fm. Evidenze: Discogs, campione dichiarato, mai voto personale.");
  const explanation = make("p", "Costo di paginazione ignoto: da 0 al limite locale scelto per avvio. "
    + "Si contano tentativi HTTP di lettura inclusi i retry, non le autorizzazioni. "
    + "Cache valide e risultati completati non consumano letture. "
    + "Cache, pacing e Retry-After esistenti restano attivi; nessuna quota garantita. "
    + "Stop attende la richiesta corrente. Risultati completi e cursori restano sul dispositivo: "
    + "Continua dopo il cooldown, anche dopo aver riaperto l'app. "
    + "Un nuovo avvio sostituisce solo il checkpoint precedente, non i dati completati.");
  const categories = new Map(), previousCategories = new Set(previous?.rows.map((row) => row.category));
  const fields = make("div", "");
  for (const [key, name] of Object.entries(COMPLETION_CATEGORIES)) {
    const label = make("label", ""); label.className = "check";
    const input = document.createElement("input"); input.type = "checkbox"; input.value = key;
    input.checked = resume ? previousCategories.has(key) : key === "duration" || !durationsOnly;
    input.disabled = resume || durationsOnly;
    label.title = key === "evidence" ? "Discogs puo' non offrire dati o accesso API. L'indisponibilita' resta visibile; "
      + "nessuno scraping o dato simulato. Il campione non e' un voto personale." : "Nessuna lettura prima di Avvia.";
    label.append(input, make("span", name)); fields.append(label); categories.set(key, input);
  }
  const budgetLabel = make("label", "Limite locale di letture per avvio ");
  const budget = document.createElement("input");
  budget.type = "number"; budget.min = "1"; budget.max = "200"; budget.step = "1"; budget.value = "20";
  budget.setAttribute("aria-label", "Limite locale di letture per avvio"); budgetLabel.append(budget);
  const listing = make("pre", ""); listing.className = "qol-details";
  listing.setAttribute("aria-label", "Piano album fonti categorie e risultati");
  const status = make("p", ""); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const start = make("button", resume ? "Continua letture" : "Avvia letture esplicite");
  const stop = make("button", "Stop"); stop.disabled = true;
  const close = make("button", "Chiudi");
  const footer = make("div", ""); footer.className = "dialog-actions"; footer.append(start, stop, close);
  dialog.append(title, hint, explanation, fields, budgetLabel, listing, status, footer);
  document.body.append(dialog);
  openPlans.set(storage, dialog);
  let plan, running = false, controller;
  const renderPlan = () => {
    listing.textContent = plan.rows.map((row) => `${row.album.artist} / ${row.album.name} · `
      + `${COMPLETION_CATEGORIES[row.category]} · ${row.source} · ${row.target || (row.category === "duration"
        ? "associazione richiesta" : "ricerca mirata artista/album")} · ${row.status} ${row.detail}`).join("\n");
    status.textContent = `Stato: ${plan.state} · letture cumulative: ${plan.reads}. ${plan.detail || ""}`;
    if (plan.state !== "planned") start.textContent = "Continua letture";
    start.disabled = running || !plan.rows.some((row) => row.status === "pending");
  };
  const rebuild = () => {
    try {
      const proposed = createCompletionPlan(storage, selected, provider,
        [...categories].filter(([, input]) => input.checked).map(([key]) => key));
      plan = resume ? continueCompletion(previous, proposed) : proposed;
      renderPlan();
    } catch (error) { status.textContent = error.message; start.disabled = true; }
  };
  for (const input of categories.values()) input.addEventListener("change", rebuild);
  start.addEventListener("click", async () => {
    if (running) return;
    controller = new AbortController();
    running = true; start.disabled = true; stop.disabled = false;
    for (const input of categories.values()) input.disabled = true;
    try {
      guard();
      const remaining = pauseRemaining(storage, provider);
      if (remaining > 0) throw new Error(`Pausa condivisa attiva: attendi ${remaining} secondi, poi Continua.`);
      const execute = () => runCompletion({ storage, plan, limit: Number(budget.value), read, guard,
        signal: controller.signal, committed: changed, progress: (text) => { status.textContent = text; } });
      if (globalThis.navigator?.locks?.request) await globalThis.navigator.locks.request("accord-music-completion-v1", execute);
      else await execute();
    } catch (error) {
      plan.detail = error.message;
    } finally {
      running = false; stop.disabled = true;
      renderPlan();
      try { changed(); } catch (error) { status.textContent += ` Dati salvati, vista non aggiornata: ${error.message}`; }
    }
  });
  stop.addEventListener("click", () => { controller?.abort(); stop.disabled = true; status.textContent = "Stop richiesto; attendo la richiesta corrente."; });
  close.addEventListener("click", () => {
    if (running) { controller.abort(); status.textContent = "Stop richiesto; chiudi dopo la richiesta corrente."; return; }
    dialog.close();
  });
  dialog.addEventListener("cancel", (event) => {
    if (running) { event.preventDefault(); controller.abort(); }
  });
  dialog.addEventListener("close", () => { openPlans.delete(storage); dialog.remove(); }, { once: true });
  rebuild(); dialog.showModal();
  return dialog;
}
