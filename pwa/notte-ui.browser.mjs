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
