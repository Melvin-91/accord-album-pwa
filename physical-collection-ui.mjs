// La vista CD/vinili non modifica le schede della raccolta musicale né albums.json.
import { createPhysicalStore, physicalKey, PHYSICAL_KEY, summaryPhysical, csvPhysical,
  parsePhysicalCsv, physicalDocument } from './physical-collection.mjs?v=1';
import { createPhysicalSync, withPhysicalCollectionLock } from './physical-collection-sync.mjs?v=1';

export function initializePhysicalCollection({ getAlbums, report }) {
  const $ = (id) => document.getElementById(id);
  const main = $('collection'), dock = $('collectionDock');
  const home = $('collectionHome');
  let limit = 80;
  let syncing = false;

  const physicalButton = $('physicalOpen');
  const section = document.createElement('main');
  section.id = 'physicalSection';
  section.hidden = true;
  section.setAttribute('aria-labelledby', 'physicalTitle');
  // Solo markup statico; artista e titoli sono inseriti tramite textContent.
  section.innerHTML = `
    <div class="physical-heading">
      <h2 id="physicalTitle" tabindex="-1">CD e vinili</h2>
    </div>
    <p id="physicalCount" class="physical-count" aria-live="polite"></p>
    <div class="physical-filter">
      <label>Cerca artista o album <input type="search" id="physicalSearch" placeholder="Cerca nella collezione" autocomplete="off"></label>
      <label>Formato <select id="physicalFilter"><option value="all">Tutti</option><option value="cd">CD</option><option value="vinyl">Vinile</option></select></label>
    </div>
    <form id="physicalAddForm" class="physical-form">
      <h3>Aggiungi alla collezione</h3>
      <div class="physical-form-columns">
        <label>Artista <input name="artist" required maxlength="250" autocomplete="off"></label>
        <label>Album <input name="title" required maxlength="250" autocomplete="off"></label>
      </div>
      <div class="physical-form-actions">
        <label><input type="checkbox" name="cd"> CD</label>
        <label><input type="checkbox" name="vinyl"> Vinile</label>
        <button type="submit">Aggiungi / aggiorna</button>
      </div>
      <p class="physical-help">Per un album già presente vengono aggiunti i formati selezionati.</p>
    </form>
    <div class="physical-actions">
      <button id="physicalSync" type="button">Sincronizza supporti</button>
      <button id="physicalExportCsv" type="button" class="secondary">Esporta CSV</button>
      <button id="physicalExportJson" type="button" class="secondary">Backup JSON</button>
      <label class="physical-import">Importa CSV <input id="physicalImportCsv" type="file" accept=".csv,text/csv"></label>
    </div>
    <p class="physical-help">La sincronizzazione dei supporti è separata da quella degli album musicali e usa il repository privato accord-music-data.</p>
    <p id="physicalStatus" role="status" aria-live="polite"></p>
    <div id="physicalList" class="physical-list"></div>
    <button id="physicalMore" type="button" class="secondary" hidden>Mostra altri album</button>
  `;
  dock.before(section);

  function store() { return createPhysicalStore(localStorage); }
  function notice(message, error = false) {
    const el = $('physicalStatus');
    el.textContent = message;
    el.setAttribute('role', error ? 'alert' : 'status');
    el.classList.toggle('error', error);
  }
  function setSyncing(value) {
    syncing = value;
    document.querySelectorAll('#physicalSync, #physicalAddForm input, #physicalAddForm button, #physicalImportCsv, #physicalList input, .physical-card-control input')
      .forEach((control) => { control.disabled = value; });
  }
  function showPhysical() {
    main.hidden = true;
    section.hidden = false;
    home.removeAttribute('aria-current');
    physicalButton.setAttribute('aria-current', 'page');
    renderPhysical();
    window.scrollTo({ top: 0, behavior: 'auto' });
    $('physicalTitle').focus({ preventScroll: true });
  }
  function showMusic() {
    section.hidden = true;
    main.hidden = false;
    physicalButton.removeAttribute('aria-current');
    home.setAttribute('aria-current', 'page');
  }
  physicalButton.addEventListener('click', showPhysical);

  function addFormatControl(container, artist, title, format, checked, notify) {
    const formatLabel = format === 'cd' ? 'CD' : 'Vinile';
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.format = format;
    input.checked = checked;
    input.disabled = syncing;
    input.setAttribute('aria-label', `${formatLabel} · ${artist} — ${title}`);
    input.addEventListener('change', async () => {
      const next = input.checked;
      try {
        await withPhysicalCollectionLock(() => store().setFormat(artist, title, format, next));
        notify('Possesso aggiornato su questo dispositivo.');
        refresh();
      } catch (error) {
        input.checked = !next;
        notify(error.message, true);
      }
    });
    label.append(input, document.createTextNode(` ${formatLabel}`));
    container.append(label);
  }

  function row(artist, title, flags) {
    const div = document.createElement('article');
    div.className = 'physical-row';
    div.dataset.albumKey = physicalKey(artist, title);
    const info = document.createElement('div');
    info.className = 'physical-row-info';
    const h = document.createElement('h3'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = artist;
    info.append(h, p); div.append(info);
    for (const format of ['cd', 'vinyl']) {
      addFormatControl(div, artist, title, format, flags[format], notice);
    }
    return div;
  }

  function renderPhysical() {
    try {
      const records = store().all();
      const counts = summaryPhysical(records);
      $('physicalCount').textContent = `${counts.albums} album · ${counts.cd} CD · ${counts.vinyl} vinili`;
      const query = $('physicalSearch').value.toLocaleLowerCase().trim();
      const format = $('physicalFilter').value;
      const filtered = records.filter((record) => (!query
        || `${record.artist} ${record.title}`.toLocaleLowerCase().includes(query))
        && (format === 'all' || record[format])).sort((a, b) =>
        a.artist.localeCompare(b.artist, 'it') || a.title.localeCompare(b.title, 'it'));
      const list = $('physicalList');
      const focused = document.activeElement;
      const focusedKey = focused.closest('.physical-row')?.dataset.albumKey;
      const focusedFormat = focused.dataset.format;
      list.replaceChildren();
      for (const record of filtered.slice(0, limit)) list.append(row(record.artist, record.title, record));
      if (!filtered.length) {
        const empty = document.createElement('p'); empty.className = 'physical-empty';
        empty.textContent = records.length ? 'Nessun album corrisponde ai filtri.'
          : 'Nessun disco inserito. Aggiungi un album oppure importa un CSV.';
        list.append(empty);
      }
      const remaining = filtered.length - limit;
      $('physicalMore').hidden = remaining <= 0;
      if (remaining > 0) $('physicalMore').textContent = `Mostra altri album (${Math.min(80, remaining)} di ${remaining})`;
      if (focusedKey && focusedFormat) {
        const replacement = [...list.children].find((item) => item.dataset.albumKey === focusedKey)
          ?.querySelector(`input[data-format="${focusedFormat}"]`);
        (replacement || $('physicalSearch')).focus({ preventScroll: true });
      }
    } catch (error) { notice(error.message, true); }
  }
  function decorateAlbumCards() {
    const albums = new Map(getAlbums().map((album) => [album.id, album]));
    let library;
    try { library = store(); }
    catch (error) { notice(error.message, true); return; }
    const physicalIndex = new Map(library.state.records.map((entry) =>
      [physicalKey(entry.artist, entry.title), entry]));
    for (const card of document.querySelectorAll('#albumList .album-card')) {
      const album = albums.get(card.dataset.id);
      if (!album) continue;
      const flags = physicalIndex.get(physicalKey(album.artist, album.name)) || { cd: false, vinyl: false };
      let badge = card.querySelector('.physical-badges');
      if (!badge) {
        badge = document.createElement('span'); badge.className = 'physical-badges';
        const line = card.querySelector('.album-metadata');
        line?.append(badge);
      }
      badge.textContent = [flags.cd ? 'CD' : '', flags.vinyl ? 'Vinile' : ''].filter(Boolean).join(' · ');
      badge.hidden = !(flags.cd || flags.vinyl);
      if (card.dataset.physicalAttached === 'true') {
        card.querySelectorAll('.physical-card-control input').forEach((input) => {
          input.checked = flags[input.dataset.format];
        });
        continue;
      }
      const options = card.querySelector('.album-options');
      if (!options) continue;
      const container = document.createElement('div');
      container.className = 'physical-card-control';
      const heading = document.createElement('span'); heading.textContent = 'Possiedo in:';
      container.append(heading);
      for (const format of ['cd', 'vinyl']) {
        addFormatControl(container, album.artist, album.name, format, flags[format], report);
      }
      options.append(container);
      card.dataset.physicalAttached = 'true';
    }
  }
  function refresh() { renderPhysical(); decorateAlbumCards(); }
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; decorateAlbumCards(); });
  });
  observer.observe($('albumList'), { childList: true });

  $('physicalSearch').addEventListener('input', () => { limit = 80; renderPhysical(); });
  $('physicalFilter').addEventListener('change', () => { limit = 80; renderPhysical(); });
  $('physicalMore').addEventListener('click', () => { limit += 80; renderPhysical(); });
  $('physicalAddForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const artist = form.elements.namedItem('artist').value, title = form.elements.namedItem('title').value;
    const cd = form.elements.cd.checked, vinyl = form.elements.vinyl.checked;
    if (!cd && !vinyl) return notice('Seleziona CD, vinile oppure entrambi.', true);
    try {
      await withPhysicalCollectionLock(() => store().addMany([{ artist, title, cd, vinyl }]));
      notice('Album aggiornato.');
      form.reset(); refresh();
    } catch (error) { notice(error.message, true); }
  });
  $('physicalSync').addEventListener('click', async () => {
    setSyncing(true);
    try {
      const result = await createPhysicalSync({ storage: localStorage, store: store(), progress: notice }).synchronize();
      if (!result.cancelled) refresh();
    } catch (error) { notice(error.message, true); }
    finally { setSyncing(false); }
  });
  function download(name, value, type) {
    const blob = new Blob([value], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  $('physicalExportCsv').addEventListener('click', () => {
    try { download('accord-cd-vinili.csv', csvPhysical(store().all()), 'text/csv;charset=utf-8'); }
    catch (error) { notice(error.message, true); }
  });
  $('physicalExportJson').addEventListener('click', () => {
    try { download('accord-physical-library.json', JSON.stringify(physicalDocument(store().state.records), null, 2),
      'application/json;charset=utf-8'); }
    catch (error) { notice(error.message, true); }
  });
  $('physicalImportCsv').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error('CSV troppo grande (massimo 10 MB).');
      const rows = parsePhysicalCsv(await file.text());
      const valid = rows.filter((r) => r.cd || r.vinyl);
      if (!valid.length) throw new Error('Il CSV non contiene CD o vinili contrassegnati.');
      if (!confirm(`Importare ${valid.length} righe? Gli album già presenti saranno aggiornati, senza duplicati.`)) return;
      await withPhysicalCollectionLock(() => store().addMany(valid));
      notice(`Importazione conclusa: ${valid.length} righe elaborate.`);
      refresh();
    } catch (error) { notice(error.message, true); }
    finally { event.target.value = ''; }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === PHYSICAL_KEY || event.key === null) refresh();
  });
  refresh();
  return { showMusic };
}
