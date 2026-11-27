const paths = {
  sort: "M8 4v16m-4-4 4 4 4-4M16 20V4m-4 4 4-4 4 4",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  list: "M4 5h3m3 0h10M4 12h3m3 0h10M4 19h3m3 0h10",
  mosaic: "M3 3h10v10H3zM16 3h5v10h-5zM3 16h5v5H3zM11 16h10v5H11z",
  album: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  record: "M4 3h12v18H4zM16 7h4v10h-4m-1-5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm-3 0h.01",
  plus: "M12 5v14M5 12h14",
  search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6",
  sync: "M20 9A8 8 0 0 0 6 5L3 8m0-5v5h5m-4 7a8 8 0 0 0 14 4l3-3m0 5v-5h-5",
  retry: "M20 11a8 8 0 0 0-14-5L4 8m0-4v4h4m-4 5a8 8 0 0 0 14 5",
  settings: "M9 3 8 6 5 7l-2 4 2 2-1 4 4 3 3-1 3 2 4-2v-4l3-2-1-5-3-1-2-3Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  controls: "M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-5 2v4",
  close: "m6 6 12 12M6 18 18 6",
  stop: "M6 6h12v12H6z",
  skip: "M5 5v14l9-7ZM19 5v14",
  filter: "M4 5h16l-6 7v7l-4 2v-9Z",
  star: "m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z",
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
  calendar: "M4 5h16v16H4zM8 3v4m8-4v4M4 10h16m-12 4h.01m4 0h.01m4 0h.01m-8 4h.01m4 0h.01",
  merge: "M5 3v4c0 5 7 4 7 9v5M19 3v4c0 5-7 4-7 9m-3 2 3 3 3-3",
  link: "m9 8 3-3a5 5 0 0 1 7 7l-3 3m-1 1-3 3a5 5 0 0 1-7-7l3-3m0 7 8-8",
  unlink: "m3 3 18 18M9 5l3-2a5 5 0 0 1 7 7l-1 2M6 9l-3 3a5 5 0 0 0 7 7l2-2",
  open: "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  copy: "M8 8h12v13H8zM16 8V3H4v13h4",
  check: "m5 12 4 4L19 6",
  save: "M4 3h13l4 4v14H3V3ZM7 3v6h10V3M7 21v-8h10v8",
  shield: "m12 2-9 4v6c0 5 9 10 9 10s9-5 9-10V6Zm-4 10 3 3 5-6",
  warning: "M12 3 2 21h20L12 3Zm0 7v4m0 3h.01",
  wand: "M15 4l1.2 3.8L20 9l-3.8 1.2L15 14l-1.2-3.8L10 9l3.8-1.2L15 4Zm-8 9 .9 2.8L11 17l-3.1 1.2L7 21l-.9-2.8L3 17l3.1-1.2L7 13Z",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
  left: "m14 5-7 7 7 7",
  right: "m10 5 7 7-7 7",
  play: "m8 5 12 7-12 7Z",
  compare: "M3 4h7v16H3ZM14 4h7v16h-7ZM12 2v20",
  playlist: "M4 5h11M4 10h11M4 15h7m3-2v7l5-3.5Z",
  choose: "M4 3v18l5-5 3 6 3-1-3-6h7z",
  headphones: "M3 14v-3a9 9 0 0 1 18 0v3M3 13h4v8H3Zm14 0h4v8h-4Z",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10v1",
  edit: "m4 15 12-12 5 5L9 20l-6 1Zm10-10 5 5M4 15l5 5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  review: "M8 3h8l1 2h3v16H4V5h3Zm0 7h8m-8 4h8m-8 4h5",
  read: "M5 3h10l4 4v14H5zM15 3v5h5m-11 4h6m-6 4h6",
  linkCheck: "m9 8 3-3a5 5 0 0 1 7 7l-2 2m-2 2-3 3a5 5 0 0 1-7-7l2-2m4 1 2 2 4-4",
  neutral: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9 10h.01M15 10h.01M9 15h6",
  thumbsUp: "M7 10v12H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3Zm0 0 5-9 2 1-1 6h6a2 2 0 0 1 2 2l-2 10a2 2 0 0 1-2 2H7",
  thumbsDown: "M7 14V2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3Zm0 0 5 9 2-1-1-6h6a2 2 0 0 0 2-2l-2-10a2 2 0 0 0-2-2H7",
};

export function commandIconName(label) {
  const key = String(label).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  for (const [pattern, name] of [
    [/^griglia$/, "grid"],
    [/^lista(?: compatta)?$/, "list"],
    [/^mosaico$/, "mosaic"],
    [/inverti ordine|ordinamento/, "sort"],
    [/non mi piace|non piace|non piaciut|disliked|dislik/, "thumbsDown"],
    [/\bmi piace\b|\bpiaciut|\bliked?\b/, "thumbsUp"],
    [/\bneutro\b|\bneutral\b/, "neutral"],
    [/da ascoltare|\bqueued\b/, "clock"],
    [/in ascolto|\blistening\b/, "headphones"],
    [/interrompi|ferma|stop/, "stop"],
    [/durat|tempo disponibile/, "clock"],
    [/unisci|unione/, "merge"],
    [/duplicat|confront|copie|copia distinta/, "compare"],
    [/aggiorna pwa/, "download"],
    [/album non presente nei servizi/, "record"],
    [/controlla collegamenti|verifica collegamenti/, "linkCheck"],
    [/sincronizz|aggiorna|ricarica/, "sync"],
    [/scollega|disconnett|rimuovi collegament/, "unlink"],
    [/gestisci album|gestione album|opzioni album/, "controls"],
    [/collega|collegament|servizio|associa/, "link"],
    [/preferit/, "heart"],
    [/\bcd\b|vinile|supporto fisico/, "record"],
    [/revisione rapida|revisione/, "review"],
    [/leggi album|leggi dal link/, "read"],
    [/rimanda|rinvio/, "calendar"],
    [/elimina|rimuovi|scarta|svuota/, "trash"],
    [/annulla|chiudi/, "close"],
    [/cerca|ricerca|trova/, "search"],
    [/voto/, "star"],
    [/salva|sostituisci|mantieni/, "save"],
    [/apri|browser/, "open"],
    [/conferma|applica|verifica/, "check"],
    [/riprov|ritenta/, "retry"],
    [/aggiungi|nuovo|nuova|crea/, "plus"],
    [/filtr/, "filter"],
    [/impostazion|opzion|configur/, "settings"],
    [/anomal|problema/, "warning"],
    [/usa per/, "choose"],
    [/correzion|suggerit/, "wand"],
    [/backup|ripristin|strumenti avanzati/, "shield"],
    [/scarica|esporta/, "download"],
    [/importa|carica/, "upload"],
    [/indietro|precedent|torna|ritorna/, "left"],
    [/salta/, "skip"],
    [/avanti|successiv|mostra altri/, "right"],
    [/copia/, "copy"],
    [/scegli|seleziona\b|selezionare\b/, "choose"],
    [/playlist|elenca le mie/, "playlist"],
    [/riproduci|anteprima/, "play"],
    [/player/, "headphones"],
    [/ascolt/, "headphones"],
    [/modifica/, "edit"],
    [/dettagli|informaz/, "info"],
    [/album|raccolta/, "album"],
  ]) if (pattern.test(key)) return name;
  return "more";
}

export function commandIconElement(name, document) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "command-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.dataset.name = name;
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name] || paths.more);
  svg.append(path);
  return svg;
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
    control.prepend(commandIconElement(name, document));
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
