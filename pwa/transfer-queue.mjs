const owner = "Melvin-91";
const own = "accord-music-data";
const peer = "music-wishlist-monitor";
const filename = "accord-transfers.json";
const empty = () => ({version: 1, sent: [], received: []});
const identity = row => JSON.stringify([row.artist, row.album, row.format].map(s => s.normalize("NFKC").trim().toLowerCase()));
function valid(row) {
  return typeof row?.id === "string" && /^[a-f0-9-]{36}$/.test(row.id) &&
    [row.artist,row.album].every(s => typeof s === "string" && s.trim() && s.length <= 200 && !/[\u0000-\u001f]/.test(s)) && ["CD","Vinyl"].includes(row.format);
}
async function request(repo, suffix, options = {}) {
  const token = localStorage.getItem("accord-album-token");
  if (!token || localStorage.getItem("accord-album-owner")?.toLowerCase() !== owner.toLowerCase())
    throw Error("Configura in Album l’account GitHub della suite per usare i trasferimenti.");
  return fetch("https://api.github.com/repos/" + owner + "/" + repo + suffix, {
    ...options, redirect:"error", cache:"no-store", headers:{Authorization:"Bearer " + token, Accept:"application/vnd.github+json","Content-Type":"application/json"}
  });
}
async function read(repo) {
  const meta = await request(repo,"");
  if (!meta.ok || (await meta.json()).private !== true) throw Error("Verifica che il token di Album possa leggere il repository privato " + repo + ".");
  const res = await request(repo,"/contents/" + filename + "?ref=main");
  if (res.status === 404 && repo === own) return {box:empty()};
  if (!res.ok) throw Error("Coda " + repo + " non disponibile (HTTP " + res.status + ").");
  const file = await res.json();
  const bytes = Uint8Array.from(atob(file.content), c => c.charCodeAt(0));
  const box = JSON.parse(new TextDecoder().decode(bytes));
  if (box.version !== 1 || !Array.isArray(box.sent) || !box.sent.every(valid) || !Array.isArray(box.received)) throw Error("Formato della coda non riconosciuto.");
  return {box,sha:file.sha};
}
async function update(change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const {box,sha} = await read(own);
    if (!change(box)) return;
    const raw = new TextEncoder().encode(JSON.stringify(box));
    if (raw.length > 650000) throw Error("Archivio trasferimenti pieno.");
    const content = btoa(Array.from(raw, b => String.fromCharCode(b)).join(""));
    const res = await request(own,"/contents/" + filename,{method:"PUT",body:JSON.stringify({message:"Aggiorna trasferimenti Accord",branch:"main",content,sha})});
    if (res.ok) return;
    if (res.status !== 409 && !(res.status === 422 && !sha)) throw Error("Salvataggio coda non riuscito (HTTP " + res.status + "). Verifica la scrittura su accord-music-data.");
  }
  throw Error("Coda modificata contemporaneamente. Riprova.");
}
export async function sendTransfer(artist,album,format) {
  const row = {id:crypto.randomUUID(),artist,album,format};
  if (!valid(row)) throw Error("Artista, titolo o formato non validi.");
  const {box:remote} = await read(peer);
  await update(box => {
    box.sent = box.sent.filter(x => !remote.received.includes(x.id));
    if (box.sent.some(x => identity(x) === identity(row))) return false;
    box.sent.push(row);
    return true;
  });
}
export async function pendingTransfers() {
  const [local,remote] = await Promise.all([read(own),read(peer)]);
  return remote.box.sent.filter(x => !local.box.received.includes(x.id));
}
export async function acknowledgeTransfers(rows) {
  await update(box => {
    const ids = rows.map(x => x.id).filter(id => !box.received.includes(id));
    box.received.push(...ids);
    return ids.length > 0;
  });
}
