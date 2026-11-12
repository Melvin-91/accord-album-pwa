const linkUpdates = new WeakMap();
const tidalAlbumResolvers = new WeakMap();

export function setTidalAlbumLinkResolver(storage, resolve) {
  tidalAlbumResolvers.set(storage, resolve);
}

export function refreshMusicAppLinks(root = globalThis.document) {
  for (const link of root.querySelectorAll("a[data-music-link]")) linkUpdates.get(link)?.();
}

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
    const match = path.match(/^\/(?:browse\/)?(album|artist|track|playlist|video)\/([A-Za-z0-9-]+)(?:\/u)?\/?$/);
    if (match) return `tidal://${match[1]}/${match[2]}`;
  }
  if (["play.qobuz.com", "open.qobuz.com"].includes(url.hostname)) {
    const match = path.match(/^\/(album|artist|track|playlist)\/([A-Za-z0-9-]+)\/?$/);
    if (match) return desktop ? `qobuzapp://${match[1]}/${match[2]}` : null;
  }
  throw new Error("Apertura nell'app non disponibile per questo collegamento. Nessun web player aperto.");
}

export function configureMusicAppLink(link, value, { query = "", report = () => {}, desktop,
  storage = globalThis.localStorage } = {}) {
  const originalText = link.textContent;
  let copying = false, opening = false;
  const update = () => {
    const web = musicLinkTarget(storage) === "web";
    const uri = web ? webMusicLink(value) : nativeMusicLink(value, { desktop });
    link.target = web ? "_blank" : "_self";
    if (uri) {
      link.href = uri;
      link.removeAttribute("role");
      link.title = web ? "Apri nello streamer web." : "Apri nell'app installata. Nessun ripiego sul web player.";
      if (copying) link.textContent = originalText;
    } else {
      link.removeAttribute("href");
      link.setAttribute("role", "button");
      link.tabIndex = 0;
      link.textContent = "Copia per cercare in Qobuz";
      link.title = "Apertura diretta Qobuz non verificata su questo dispositivo. Copia artista e titolo, senza aprire il web player.";
    }
    copying = !uri;
    return uri;
  };
  link.rel = "noopener noreferrer";
  link.setAttribute("data-music-link", "");
  linkUpdates.set(link, update);
  update();
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
  link.addEventListener("click", async (event) => {
    if (opening) { event.preventDefault(); return; }
    let tab = null;
    try {
      if (!update()) { await copy(event); return; }
      const resolve = tidalAlbumResolvers.get(storage);
      if (!resolve || !/^tidal:\/\/album\/[1-9][0-9]*$/.test(nativeMusicLink(value, { desktop: true }))) return;
      event.preventDefault();
      opening = true;
      link.setAttribute("aria-busy", "true");
      const target = musicLinkTarget(storage);
      if (target === "web") {
        tab = globalThis.open("about:blank", "_blank");
        if (!tab) throw new Error("Consenti l'apertura della scheda TIDAL nel browser e riprova.");
        tab.opener = null;
        tab.document.title = "Verifica edizione TIDAL";
        tab.document.body.textContent = "Verifica della disponibilita' TIDAL in corso...";
      }
      const verified = await resolve(value);
      if (!verified) { tab?.close(); return; }
      if (musicLinkTarget(storage) !== target) throw new Error("Apertura App/Web cambiata: riprova.");
      const uri = target === "web" ? webMusicLink(verified) : nativeMusicLink(verified, { desktop });
      value = verified;
      update();
      if (target === "web") {
        if (tab.closed) throw new Error("Scheda TIDAL chiusa: nessun collegamento aperto.");
        tab.location.replace(uri);
      } else if (globalThis.navigator?.userActivation && !globalThis.navigator.userActivation.isActive) {
        const dialog = document.createElement("dialog");
        const caption = document.createElement("p");
        caption.textContent = "Edizione TIDAL verificata.";
        const open = document.createElement("a");
        open.href = uri; open.textContent = "Apri nell'app TIDAL"; open.target = "_self";
        open.addEventListener("click", () => dialog.close());
        const cancel = document.createElement("button");
        cancel.type = "button"; cancel.textContent = "Annulla";
        cancel.addEventListener("click", () => dialog.close());
        dialog.append(caption, open, cancel);
        dialog.setAttribute("aria-label", "Apri edizione TIDAL verificata");
        dialog.addEventListener("close", () => dialog.remove());
        document.body.append(dialog);
        dialog.showModal();
      } else globalThis.location.assign(uri);
    } catch (error) {
      event.preventDefault();
      tab?.close();
      report(error.message);
    } finally {
      opening = false;
      link.removeAttribute("aria-busy");
    }
  });
  link.addEventListener("keydown", (event) => {
    if (copying && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      link.click();
    }
  });
  return link;
}
export const MUSIC_LINK_TARGET_KEY = "accord-music-link-target-v1";

export function musicLinkTarget(storage = globalThis.localStorage) {
  return storage?.getItem(MUSIC_LINK_TARGET_KEY) === "web" ? "web" : "app";
}

export function webMusicLink(value) {
  const url = new URL(value);
  if (url.protocol === "spotify:") {
    const match = value.match(/^spotify:(album|artist|track|playlist|show|episode|search):(.+)$/);
    if (match) return `https://open.spotify.com/${match[1]}/${match[2]}`;
    if (value === "spotify:") return "https://open.spotify.com/";
  } else if (["tidal:", "qobuzapp:"].includes(url.protocol)) {
    if (/^(album|artist|track|playlist|video)$/.test(url.hostname) && /^\/[A-Za-z0-9-]+$/.test(url.pathname)
        && !url.username && !url.password && !url.search && !url.hash) {
      return `https://${url.protocol === "tidal:" ? "listen.tidal.com" : "play.qobuz.com"}/${url.hostname}${url.pathname}`;
    }
  } else {
    // Validate the same catalogue paths as native links, including mobile Qobuz.
    return webMusicLink(nativeMusicLink(value, { desktop: true }));
  }
  throw new Error("Collegamento musicale non valido.");
}
