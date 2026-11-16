import { installCommandIcons } from "./command-icons.mjs?v=1";
import { installSelectWheelGuard } from "./ui.mjs?v=25";

export async function runNotteUIBrowserTests(document) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-label", "Verifica UI isolata");
  frame.hidden = true;
  document.body.append(frame);
  const local = frame.contentDocument, root = local.body;
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  let stopIcons, stopWheel;
  try {
    const button = local.createElement("button");
    button.textContent = "Sincronizza";
    button.disabled = true;
    root.append(button);
    stopIcons = installCommandIcons(root);
    assert(button.querySelectorAll("svg").length === 1, "Il comando iniziale deve avere una sola icona.");
    assert(button.disabled && button.textContent === "Sincronizza", "Icone e stato del comando devono restare indipendenti.");
    const before = button.querySelector("path").getAttribute("d");
    button.textContent = "Interrompi durate";
    await tick();
    assert(button.querySelectorAll("svg").length === 1, "L'icona va ripristinata dopo il cambio di testo.");
    assert(button.querySelector("path").getAttribute("d") !== before, "Il cambio di azione deve aggiornare il simbolo.");
    assert(button.querySelector("svg").getAttribute("aria-hidden") === "true", "L'icona non deve duplicare il nome accessibile.");
    const details = local.createElement("details"), summary = local.createElement("summary");
    summary.textContent = "Strumenti avanzati";
    details.append(summary);
    root.append(details);
    await tick();
    assert(summary.querySelectorAll("svg").length === 1, "Anche i menu dinamici devono avere un'icona.");
    summary.click();
    assert(details.open, "L'icona non deve interrompere l'apertura del menu.");
    let clicks = 0;
    button.disabled = false;
    button.addEventListener("click", () => { clicks += 1; });
    for (let count = 0; count < 10; count += 1) {
      button.textContent = count % 2 ? "Sincronizza" : "Chiudi";
      await tick();
    }

    button.querySelector("svg").dispatchEvent(new frame.contentWindow.MouseEvent("click", { bubbles: true }));
    assert(clicks === 1 && button.querySelectorAll("svg").length === 1, "Gli aggiornamenti non devono duplicare icone o callback.");
    const select = local.createElement("select"), option = local.createElement("option");
    option.textContent = "Primo"; select.append(option);
    root.append(select);
    stopWheel = installSelectWheelGuard(local);
    const wheel = () => new frame.contentWindow.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
    const unfocused = wheel();
    select.dispatchEvent(unfocused);
    assert(unfocused.defaultPrevented && select.selectedIndex === 0, "Passare sul menu con la rotella non deve cambiare il valore.");
    // A hidden frame cannot receive focus, so expose only this isolated test surface.
    frame.hidden = false;
    select.focus();
    const focused = wheel();
    select.dispatchEvent(focused);
    assert(local.activeElement === select && !focused.defaultPrevented, "La rotella deve essere disponibile dopo l'attivazione esplicita.");
    return { passed: 7, scope: "Icone dinamiche, accessibilita, callback, menu e rotella" };
  } finally {
    stopIcons?.();
    stopWheel?.();
    frame.remove();
  }
}

export async function runOrbitaUIBrowserTests(document) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const dock = document.getElementById("collectionDock");
  assert(dock && dock.querySelectorAll("button:not([hidden])").length >= 4, "Il dock deve mantenere tutti i comandi musicali.");
  assert(getComputedStyle(dock).position === "fixed", "Il dock deve restare raggiungibile durante lo scorrimento.");
  const padding = Number.parseFloat(getComputedStyle(document.body).paddingBottom);
  assert(padding > dock.getBoundingClientRect().height + 20, "Il fondo della pagina deve riservare lo spazio del dock.");
  const panels = [...document.querySelectorAll("#albumList .album-options")];
  assert(panels.length >= 2, "Servono almeno due album dimostrativi per verificare i pannelli.");
  const opened = panels.find(panel => panel.open);
  try {
    panels[0].querySelector("summary").click();
    panels[1].querySelector("summary").click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(panels[1].open && panels.filter(panel => panel.open).length === 1,
      "L'ultimo album richiesto deve essere l'unico pannello aperto.");
    assert(panels[1].querySelectorAll("select").length === 2, "Stato e voto devono essere disponibili nel pannello.");
    assert(panels[1].querySelector("[data-control=remove]"), "La rimozione deve restare disponibile.");
    const filter = document.getElementById("filters").querySelector("details");
    const wasOpen = filter.open;
    filter.open = true;
    try {
      const bounds = filter.querySelector(".filter-controls").getBoundingClientRect();
      assert(bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth + 1,
        "I filtri aperti devono rimanere dentro lo schermo.");
    } finally { filter.open = wasOpen; }
    return { passed: 7, scope: "Dock, spazio riservato, pannelli esclusivi, controlli album e filtri" };
  } finally {
    panels.forEach(panel => { panel.open = panel === opened; });
  }
}
