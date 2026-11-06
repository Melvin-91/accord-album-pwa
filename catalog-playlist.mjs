import { normalized } from "./catalog-suggestions.mjs?v=3";

export class CatalogPlaylist {
  constructor(discovery, tracksPerArtist) {
    if (!Number.isInteger(tracksPerArtist) || tracksPerArtist < 1 || tracksPerArtist > 10) {
      throw new Error("Scegli da 1 a 10 brani per artista.");
    }

    this.discovery = discovery; this.perArtist = tracksPerArtist;
    this.tracks = []; this.artists = []; this.processed = new Set();
    this.current = null; this.offset = 0; this.trackReads = 0; this.partial = false;
  }
  get canContinue() {
    return this.discovery.canContinue || this.current !== null
      || this.discovery.results.some((row) => !this.processed.has(row.album.id));
  }
  checkpoint() {
    return { ...this, discovery: this.discovery.checkpoint() };
  }
  static restore(saved, discovery) {
    const state = new CatalogPlaylist(discovery, saved.perArtist);
    if (Object.keys(saved).sort().join() !== Object.keys(state.checkpoint()).sort().join()) throw new Error("Stato playlist non valido.");
    return Object.assign(state, saved, { discovery });
  }
  async step({ discover, albumTracks, guard = () => {} }) {
    guard();
    if (this.discovery.canContinue) await discover();
    let used = 0;
    while (used < 10) {
      guard();
      if (!this.current) {
        this.current = this.discovery.results.find((row) => !this.processed.has(row.album.id)) || null;
        this.offset = 0;
      }
      if (!this.current) break;
      const { album, reason } = this.current;
      used += 1; this.trackReads += 1;
      const page = await albumTracks(album.id, this.offset); guard();
      let group = this.artists.find((row) => row.albumId === album.id);
      if (!group) {
        group = { name: album.artist, id: album.id, albumId: album.id, tracks: 0, reason, suggestedAlbum: album };
        this.artists.push(group);
      }
      const ids = new Set(this.tracks.map((track) => track.id));
      for (const track of page.tracks) {
        if (group.tracks >= this.perArtist) break;
        const id = String(track.id || "");
        if (!/^[1-9][0-9]*$/.test(id) || !track.name) throw new Error("Brano del catalogo non verificabile.");
        if (track.streamable === false || ids.has(id)) continue;
        if (track.artist && (this.discovery.filters.excludedArtists || []).some((name) =>
          normalized(track.artist) === normalized(name))) continue;
        this.tracks.push({ ...track, id, sourceArtistId: album.id }); ids.add(id); group.tracks += 1;
      }
      if (group.tracks < this.perArtist && page.next != null) {
        if (!Number.isInteger(page.next) || page.next <= this.offset) throw new Error("Paginazione brani non valida.");
        this.offset = page.next;
      } else {
        this.partial ||= group.tracks < this.perArtist || page.complete === false;
        this.processed.add(album.id); this.current = null;
      }
    }
    return this.preview();
  }
  preview() {
    return { artists: this.artists.filter((row) => row.tracks).map((row) => ({ ...row })), tracks: [...this.tracks],
      hasMore: this.canContinue, requestedArtists: this.discovery.target,
      source: this.discovery.source, reads: this.discovery.reads, trackReads: this.trackReads,
      stats: { ...this.discovery.stats }, partialReason: this.partial || this.artists.length < this.discovery.target
        ? "Campione parziale o brani verificati insufficienti." : "" };
  }
}

export async function createCatalogPlaylist({ api, name, tracks, guard, uncertain, lock }) {
  const ids = tracks.map((track) => String(track.id));
  if (!name?.trim() || name.trim().length > 100 || !ids.length || ids.length > 500
      || ids.some((id) => !/^[1-9][0-9]*$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("Nome o anteprima playlist non validi.");
  }
  return lock(async () => {
    guard();
    if (uncertain.get()) throw new Error("Verifica prima l'esito della scrittura precedente.");
    await api.preflight(); guard();
    uncertain.set(true);
    let playlist, confirmed = 0;
    try {
      playlist = await api.create(name.trim(), guard); guard();
      for (let start = 0; start < ids.length; start += api.batchSize) {
        guard();
        const batch = ids.slice(start, start + api.batchSize);
        await api.add(playlist.id, batch, guard);
        confirmed += batch.length;
        guard();
      }
      uncertain.set(false);
      return playlist;
    } catch (error) {
      throw new Error(`Esito da verificare nell'app${playlist ? `: playlist «${playlist.name || name}» (${confirmed}/${ids.length} brani confermati)` : ""}. `
        + `${error.message} Nessun nuovo invio automatico; non ricreare la playlist senza controllarla.`);
    }
  });
}
