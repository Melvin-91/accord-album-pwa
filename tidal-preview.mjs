export function tidalEmbedUrl(album) {
  const match = /^tidal:([1-9][0-9]*)$/.exec(album?.id || "");
  if (!match) throw new Error("L'anteprima richiede un album TIDAL.");
  const url = new URL(album.url);
  if (url.protocol !== "https:" || !["tidal.com", "www.tidal.com", "listen.tidal.com"].includes(url.hostname)
      || url.username || url.password || url.port
      || ![`/browse/album/${match[1]}`, `/album/${match[1]}`].includes(url.pathname.replace(/\/$/, ""))) {
    throw new Error("Il collegamento non corrisponde all'album TIDAL.");
  }
  return `https://embed.tidal.com/albums/${match[1]}`;
}

export function openTidalPreview(document, album) {
  const url = tidalEmbedUrl(album);
  if (globalThis.navigator?.onLine === false) throw new Error("L'anteprima TIDAL richiede una connessione Internet.");
  document.querySelector(".tidal-preview-dialog")?.close();
  const dialog = document.createElement("dialog");
  dialog.className = "tidal-preview-dialog";
  dialog.setAttribute("aria-label", "Anteprima ufficiale TIDAL");
  const heading = document.createElement("div");
  heading.className = "dialog-heading";
  const title = document.createElement("h2");
  title.textContent = `${album.artist} · ${album.name}`;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Chiudi anteprima";
  close.addEventListener("click", () => dialog.close());
  heading.append(title, close);
  const note = document.createElement("p");
  note.textContent = "Anteprime ufficiali di 30 secondi. Premi Play nel lettore TIDAL. "
    + "Non controlla l'app TIDAL aperta e non aggiorna la raccolta. Richiede Internet; "
    + "la chiusura interrompe l'anteprima.";
  const frame = document.createElement("iframe");
  frame.title = "Anteprima ufficiale TIDAL";
  frame.src = url;
  frame.setAttribute("allow", "encrypted-media");
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
  frame.referrerPolicy = "no-referrer";
  const external = document.createElement("a");
  external.textContent = "Apri anteprima nel browser";
  external.href = url;
  external.target = "_blank";
  external.rel = "noopener noreferrer";
  dialog.append(heading, note, external, frame);
  dialog.addEventListener("close", () => {
    frame.src = "about:blank";
    frame.remove();
    dialog.remove();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
