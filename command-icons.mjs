const paths = {
  album: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  plus: "M12 5v14M5 12h14",
  search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6",
  sync: "M20 9A8 8 0 0 0 6 5L3 8m0-5v5h5m-4 7a8 8 0 0 0 14 4l3-3m0 5v-5h-5",
  settings: "M9 3 8 6 5 7l-2 4 2 2-1 4 4 3 3-1 3 2 4-2v-4l3-2-1-5-3-1-2-3Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  close: "m6 6 12 12M6 18 18 6",
  filter: "M4 5h16l-6 7v7l-4 2v-9Z",
  star: "m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
  merge: "M5 3v4c0 5 7 4 7 9v5M19 3v4c0 5-7 4-7 9m-3 2 3 3 3-3",
  link: "m9 8 3-3a5 5 0 0 1 7 7l-3 3m-1 1-3 3a5 5 0 0 1-7-7l3-3m0 7 8-8",
  unlink: "m3 3 18 18M9 5l3-2a5 5 0 0 1 7 7l-1 2M6 9l-3 3a5 5 0 0 0 7 7l2-2",
  open: "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  check: "m5 12 4 4L19 6",
  save: "M4 3h13l4 4v14H3V3ZM7 3v6h10V3M7 21v-8h10v8",
  shield: "m12 2-9 4v6c0 5 9 10 9 10s9-5 9-10V6Zm-4 10 3 3 5-6",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
  left: "m14 5-7 7 7 7",
  right: "m10 5 7 7-7 7",
  compare: "M3 4h7v16H3ZM14 4h7v16h-7ZM12 2v20",
  headphones: "M3 14v-3a9 9 0 0 1 18 0v3M3 13h4v8H3Zm14 0h4v8h-4Z",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10v1",
  edit: "m4 15 12-12 5 5L9 20l-6 1Zm10-10 5 5M4 15l5 5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

export function commandIconName(label) {
  const key = String(label).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  for (const [pattern, name] of [
    [/durat|tempo disponibile/, "clock"],
    [/duplicat|unisci|unione/, "merge"],
    [/confront|copie|copia distinta/, "compare"],
    [/sincronizz|aggiorna|ricarica/, "sync"],
    [/scollega/, "unlink"],
    [/collega|collegament|servizio/, "link"],
    [/elimina|rimuovi|scarta|svuota/, "trash"],
    [/interrompi|annulla|chiudi/, "close"],
    [/cerca|ricerca|trova/, "search"],
    [/preferit|voto/, "star"],
    [/salva|sostituisci|mantieni/, "save"],
    [/conferma|applica|verifica/, "check"],
    [/aggiungi|nuovo|nuova|crea/, "plus"],
    [/filtr/, "filter"],
    [/impostazion|opzion|configur/, "settings"],
    [/backup|ripristin|strumenti avanzati/, "shield"],
    [/scarica|esporta/, "download"],
    [/importa|carica/, "upload"],
    [/indietro|precedent/, "left"],
    [/avanti|successiv|mostra altri/, "right"],
    [/apri|player|browser/, "open"],
    [/ascolt/, "headphones"],
    [/modifica/, "edit"],
    [/dettagli|informaz/, "info"],
    [/album|raccolta/, "album"],
  ]) if (pattern.test(key)) return name;
  return "more";
}

export function decorateCommandIcons(root) {
  const document = root.ownerDocument || root;
  const controls = [];
  if (root.matches?.("button, summary, .card-actions a, .comparison-card a")) controls.push(root);
  controls.push(...root.querySelectorAll("button, summary, .card-actions a, .comparison-card a"));
  for (const control of controls) {
    const name = control.dataset.commandIcon || commandIconName(control.getAttribute("aria-label") || control.textContent);
    const old = control.querySelector(":scope > .command-icon");
    if (old?.dataset.name === name) continue;
    old?.remove();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "command-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.dataset.name = name;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", paths[name] || paths.more);
    svg.append(path);
    control.prepend(svg);
  }
}

export function installCommandIcons(root) {
  decorateCommandIcons(root);
  const document = root.ownerDocument || root;
  const observer = new document.defaultView.MutationObserver((mutations) => {
    const pending = new Set();
    for (const mutation of mutations) {
      const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
      if (target?.closest(".command-icon")) continue;
      const control = target?.closest("button, summary, .card-actions a, .comparison-card a");
      if (control) pending.add(control);
      for (const node of mutation.addedNodes) if (node.nodeType === 1 && !node.matches(".command-icon")) pending.add(node);
    }
    for (const node of pending) if (node.isConnected) decorateCommandIcons(node);
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ["aria-label", "data-command-icon"] });
  return () => observer.disconnect();
}
