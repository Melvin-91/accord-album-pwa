export const normalized = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

export function musicalAlbumTags(tags) {
  const musical = /\b(metal|metalcore|deathcore|hardcore|grindcore|rock|postrock|jazz|punk|folk|electronic|electronica|ambient|blues|classical|soul|funk|soundtrack|pop|hip hop|rap|trance|techno|house|dance|industrial|synthwave|chiptune|reggae|ska|disco|country|bluegrass|opera|orchestral|drum and bass|dubstep|idm|ebm|nwobhm)\b/;
  const names = new Map(tags.filter((tag) => typeof tag?.name === "string")
    .map((tag) => tag.name.replaceAll("-", " ").trim().replace(/\s+/g, " "))
    .filter((name) => name && name.length <= 80 && musical.test(name.toLowerCase()))
    .map((name) => [name.toLowerCase(), name]));
  for (const broad of ["metal", "rock", "pop", "jazz", "folk", "punk"]) {
    if (names.has(broad) && [...names.keys()].some((name) => name !== broad && new RegExp(`\\b${broad}\\b`).test(name))) names.delete(broad);
  }
  return [...names.values()].slice(0, 12);
}

export function genreAllowed(genres, filters) {
  const included = (filters.includedGenres || []).map(normalized);
  const excluded = (filters.excludedGenres || []).map(normalized);
  if (!included.length && !excluded.length) return true;
  const names = genres.map(normalized);
  if (!names.length) return false;
  const matches = (terms, mode) => terms.some((term) => names.some((name) =>
    mode === "contains" ? name.includes(term) : name === term));
  return (!included.length || matches(included, filters.includedGenresMatch || "contains"))
    && !matches(excluded, filters.excludedGenresMatch || "exact");
}

export class CatalogSuggestions {
  constructor({ seeds = [], albums = [], filters = {}, heard = [], known = [], excludedIds = [], source = "",
    allowed = () => true, decisionReason = null, uniqueArtists = true, target = 10 }) {
    if (!Number.isInteger(target) || target < 1 || target > 50) throw new Error("Scegli da 1 a 50 artisti.");
    this.target = target; this.maxArtists = Math.max(30, target * 3);
    this.filters = structuredClone(filters);
    this.heard = new Set(heard.map(normalized));
    this.excluded = new Set((filters.excludedArtists || []).map(normalized));
    this.collectionIds = new Set(known.map((album) => album.id));
    this.collectionNames = new Set(known.map((album) => JSON.stringify([normalized(album.artist), normalized(album.name)])));
    this.excludedIds = new Set(excludedIds);
    this.knownIds = new Set([...this.collectionIds, ...this.excludedIds]);
    this.source = source; this.allowed = allowed; this.decisionReason = decisionReason || allowed.reason || (() => "");
    this.uniqueArtists = uniqueArtists;
    this.results = []; this.artists = []; this.tasks = [];
    this.reads = 0; this.stats = { known: 0, filtered: 0, ambiguous: 0, unmatched: 0, partial: 0 };
    this.decisions = [];
    this.seenArtists = new Set(); this.seenAlbums = new Set();
    this.seedNames = new Set(seeds.map((seed) => normalized(seed.name)));
    this.limited = seeds.length > 10;
    for (const seed of seeds.slice(0, 10)) {
      if (!this.excluded.has(normalized(seed.name))) this.tasks.push(["similar", seed]);
    }
    for (const row of albums) this.tasks.push(["verify", row.album ? row : { album: row }]);
  }
  get canContinue() { return this.tasks.length > 0 && this.results.length < this.target; }
  checkpoint() {
    return Object.fromEntries(Object.entries(this).filter(([key]) => !["allowed", "decisionReason"].includes(key)));
  }
  static restore(saved, allowed = () => true) {
    const state = new CatalogSuggestions({ target: saved.target, allowed });
    if (Object.keys(saved).sort().join() !== Object.keys(state.checkpoint()).sort().join()) throw new Error("Stato scoperta non valido.");
    return Object.assign(state, saved);
  }
  async step({ similar, topAlbums, search, genres, guard = () => {} }) {
    let used = 0;
    while (this.canContinue && used < 20) {
      guard();
      const [kind, entry] = this.tasks[0];
      if (kind === "similar") {
        used += 1; this.reads += 1;
        const found = await similar(entry.name); guard(); this.tasks.shift();
        const pending = [];
        for (const artist of found) {
          const name = normalized(artist.name);
          if (this.seenArtists.has(name) || this.heard.has(name) || this.excluded.has(name) || this.seedNames.has(name)) continue;
          if (this.seenArtists.size >= this.maxArtists) { this.limited = true; break; }
          this.seenArtists.add(name);
          const candidate = { ...artist, reason: `Artista affine a ${entry.name} · Last.fm` };
          this.artists.push(candidate); pending.push(["top", candidate]);
        }
        this.tasks.unshift(...pending);
      } else if (kind === "top") {
        used += 1; this.reads += 1;
        const found = await topAlbums(entry.name); guard(); this.tasks.shift();
        this.tasks.unshift(...found.slice(0, 3).map((album) => ["search", {
          name: album.name, artist: entry.name, reason: entry.reason,
        }]));
      } else if (kind === "search") {
        used += 1; this.reads += 1;
        let matches = await search(`${entry.artist} ${entry.name}`); guard(); this.tasks.shift();
        if (!Array.isArray(matches)) {
          if (!matches.complete) {
            this.stats.partial += 1;
            this.decide(entry, "Catalogo non verificato: ricerca incompleta", "partial");
            continue;
          }
          matches = matches.rows;
        }
        const exact = new Map(matches.filter((row) =>
          normalized(row.album.artist) === normalized(entry.artist)
          && normalized(row.album.name) === normalized(entry.name)).map((row) => [row.album.id, row]));
        if (exact.size !== 1) {
          const kind = exact.size ? "ambiguous" : "unmatched";
          this.stats[kind] += 1;
          this.decide(entry, `Catalogo non verificato: ${exact.size ? "più edizioni corrispondenti" : "nessuna corrispondenza esatta"}`, kind);
          continue;
        }
        this.tasks.unshift(["verify", { ...exact.values().next().value, reason: entry.reason }]);
      } else {
        const album = entry.album, artistNames = entry.artistNames || [album.artist];
        const blockedArtist = artistNames.find((name) => this.excluded.has(normalized(name)));
        const heardArtist = artistNames.find((name) => this.heard.has(normalized(name)));
        let reason = "";
        if (!this.allowed(album)) reason = this.decisionReason(album) || "Escluso da una regola locale";
        else if (this.seenAlbums.has(album.id)) reason = "Duplicato nel risultato";
        else if (this.collectionIds.has(album.id)
            || this.collectionNames.has(JSON.stringify([normalized(album.artist), normalized(album.name)]))) reason = "Già in raccolta";
        else if (this.excludedIds.has(album.id)) reason = "Escluso localmente";
        else if (blockedArtist) reason = `Artista escluso: ${blockedArtist}`;
        else if (heardArtist) reason = `Artista già ascoltato: ${heardArtist}`;
        else if (this.uniqueArtists && this.results.some((row) => normalized(row.album.artist) === normalized(album.artist))) {
          reason = "Un altro album dello stesso artista è già nel risultato";
        }
        if (reason) {
          this.tasks.shift(); this.stats.known += 1; this.decide(entry, reason); continue;
        }
        let tags = entry.genres || [];
        if (((this.filters.includedGenres || []).length || (this.filters.excludedGenres || []).length) && !tags.length) {
          used += 1; this.reads += 1;
          tags = await genres(album.artist, album.name); guard();
        }
        this.tasks.shift(); this.seenAlbums.add(album.id);
        if (!genreAllowed(tags, this.filters)) {
          this.stats.filtered += 1;
          this.decide(entry, tags.length ? "Escluso dai filtri genere" : "Genere mancante");
          continue;
        }
        this.results.push({ ...entry, genres: tags, source: this.source, reason: entry.reason || this.source });
      }
    }
    const budgetLimited = used >= 20 && this.canContinue;
    const unexamined = budgetLimited ? this.tasks.flatMap(([kind, value]) => {
      const candidate = kind === "verify" ? value.album : kind === "search" ? value : null;
      return candidate ? [{ ...(candidate.id ? { id: candidate.id } : {}), name: candidate.name || "",
        artist: candidate.artist || "" }] : [];
    }).slice(0, 100) : [];
    return { albums: [...this.results], artists: [...this.artists], reads: this.reads, stepReads: used,
      canContinue: this.canContinue, stats: { ...this.stats }, limited: this.limited, source: this.source,
      uniqueArtists: this.uniqueArtists, decisions: [...this.decisions], unexamined, budgetLimited };
  }
  decide(candidate, reason, status = "excluded") {
    const album = candidate?.album && typeof candidate.album === "object" ? candidate.album : candidate;
    this.decisions.push({ id: album?.id || "", name: album?.name || "", artist: album?.artist || "", status, reason });
    if (this.decisions.length > 200) this.decisions.splice(0, this.decisions.length - 200);
  }
}
