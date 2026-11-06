export function desktopAppLinks(navigator = globalThis.navigator) {
  const agent = navigator?.userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(agent)
    || (/Macintosh/.test(agent) && navigator?.maxTouchPoints > 1);
  return !ios && /Windows|Macintosh|Linux/.test(agent) && !/Android/.test(agent);
}

export function nativeMusicLink(value, { desktop = desktopAppLinks() } = {}) {
  const url = new URL(value);
  if (["spotify:", "tidal:"].includes(url.protocol)) return value;
  if (url.protocol === "qobuzapp:") return desktop ? value : null;
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Collegamento musicale non valido.");
  }
  const path = url.pathname.replace(/^\/(?:intl-[A-Za-z-]+\/|embed\/)/, "/");
  if (url.hostname === "open.spotify.com") {
    if (path === "/") return "spotify:";
    const match = path.match(/^\/(album|artist|track|playlist|show|episode|collection|user)\/([A-Za-z0-9]+)\/?$/);
    if (match) return `spotify:${match[1]}:${match[2]}`;
    if (path.startsWith("/search/") && path.length > 8) return `spotify:search:${path.slice(8)}`;
  }
  if (["tidal.com", "www.tidal.com", "listen.tidal.com"].includes(url.hostname)) {
    const match = path.match(/^\/(?:browse\/)?(album|artist|track|playlist|video)\/([A-Za-z0-9-]+)\/?$/);
    if (match) return `tidal://${match[1]}/${match[2]}`;
  }
  if (["play.qobuz.com", "open.qobuz.com"].includes(url.hostname)) {
    const match = path.match(/^\/(album|artist|track|playlist)\/([A-Za-z0-9-]+)\/?$/);
    if (match) return desktop ? `qobuzapp://${match[1]}/${match[2]}` : null;
  }
  throw new Error("Apertura nell'app non disponibile per questo collegamento. Nessun web player aperto.");
}

export function configureMusicAppLink(link, value, { query = "", report = () => {}, desktop } = {}) {
  const uri = nativeMusicLink(value, { desktop });
  link.target = "_self";
  link.rel = "noopener noreferrer";
  if (uri) {
    link.href = uri;
    link.title = "Apri nell'app installata. Nessun ripiego sul web player.";
    return link;
  }
  link.removeAttribute("href");
  link.setAttribute("role", "button");
  link.tabIndex = 0;
  link.textContent = "Copia per cercare in Qobuz";
  link.title = "Apertura diretta Qobuz non verificata su questo dispositivo. Copia artista e titolo, senza aprire il web player.";
  const copy = async (event) => {
    event.preventDefault();
    try {
      if (!query.trim()) throw new Error("Titolo da cercare non disponibile.");
      await globalThis.navigator.clipboard.writeText(query);
      report("Artista e titolo copiati. Incollali nella ricerca dell'app Qobuz.");
    } catch (error) {
      report(`Copia non riuscita: ${error.message} Cerca nell'app Qobuz: ${query}`);
    }
  };
  link.addEventListener("click", copy);
  link.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") void copy(event);
  });
  return link;
}
