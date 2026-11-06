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
  constructor({ seeds = [], albums = [], filters = {}, heard = [], known = [], excludedIds = [], source = "", allowed = () => true, uniqueArtists = true, target = 10 }) {
    if (!Number.isInteger(target) || target < 1 || target > 50) throw new Error("Scegli da 1 a 50 artisti.");
    this.target = target; this.maxArtists = Math.max(30, target * 3);
    this.filters = structuredClone(filters);
    this.heard = new Set(heard.map(normalized));
    this.excluded = new Set((filters.excludedArtists || []).map(normalized));
    this.knownIds = new Set([...known.map((album) => album.id), ...excludedIds]);
    this.knownNames = new Set(known.map((album) => JSON.stringify([normalized(album.artist), normalized(album.name)])));
    this.source = source; this.allowed = allowed; this.uniqueArtists = uniqueArtists;
    this.results = []; this.artists = []; this.tasks = [];
    this.reads = 0; this.stats = { known: 0, filtered: 0, ambiguous: 0, unmatched: 0, partial: 0 };
    this.seenArtists = new Set(); this.seenAlbums = new Set();
    this.seedNames = new Set(seeds.map((seed) => normalized(seed.name)));
    this.limited = seeds.length > 10;
    for (const seed of seeds.slice(0, 10)) {
      if (!this.excluded.has(normalized(seed.name))) this.tasks.push(["similar", seed]);
    }
    for (const row of albums) this.tasks.push(["verify", row.album ? row : { album: row }]);
  }
  get canContinue() { return this.tasks.length > 0 && this.results.length < this.target; }
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
          if (!matches.complete) { this.stats.partial += 1; continue; }
          matches = matches.rows;
        }
        const exact = new Map(matches.filter((row) =>
          normalized(row.album.artist) === normalized(entry.artist)
          && normalized(row.album.name) === normalized(entry.name)).map((row) => [row.album.id, row]));
        if (exact.size !== 1) { this.stats[exact.size ? "ambiguous" : "unmatched"] += 1; continue; }
        this.tasks.unshift(["verify", { ...exact.values().next().value, reason: entry.reason }]);
      } else {
        const album = entry.album, artistNames = entry.artistNames || [album.artist];
        if (!this.allowed(album) || this.seenAlbums.has(album.id) || this.knownIds.has(album.id)
            || this.knownNames.has(JSON.stringify([normalized(album.artist), normalized(album.name)]))
            || artistNames.some((name) => this.heard.has(normalized(name)) || this.excluded.has(normalized(name)))
            || this.uniqueArtists && this.results.some((row) => normalized(row.album.artist) === normalized(album.artist))) {
          this.tasks.shift(); this.stats.known += 1; continue;
        }
        let tags = entry.genres || [];
        if (((this.filters.includedGenres || []).length || (this.filters.excludedGenres || []).length) && !tags.length) {
          used += 1; this.reads += 1;
          tags = await genres(album.artist, album.name); guard();
        }
        this.tasks.shift(); this.seenAlbums.add(album.id);
        if (!genreAllowed(tags, this.filters)) { this.stats.filtered += 1; continue; }
        this.results.push({ ...entry, genres: tags, source: this.source, reason: entry.reason || this.source });
      }
    }
    return { albums: [...this.results], artists: [...this.artists], reads: this.reads, stepReads: used,
      canContinue: this.canContinue, stats: { ...this.stats }, limited: this.limited, source: this.source, uniqueArtists: this.uniqueArtists };
  }
}
