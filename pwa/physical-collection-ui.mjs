import { csvPhysical, parsePhysicalCsv, physicalDocument } from './physical-collection.mjs?v=2';

const formats = [['cd', 'CD'], ['vinyl', 'Vinile']];

export function initializePhysicalCollection({ store, report, render }) {
  const openTools = document.getElementById('openPhysicalTools');
  const albumList = document.getElementById('albumList');
  const dialog = document.createElement('dialog');
  dialog.id = 'physicalToolsDialog';
  dialog.setAttribute('aria-labelledby', 'physicalToolsTitle');
  dialog.innerHTML = `
    <div class="dialog-heading">
      <h2 id="physicalToolsTitle">Aggiungi CD o vinile</h2>
      <button type="button" class="secondary" id="closePhysicalTools">Chiudi</button>
    </div>
    <form id="physicalAddForm">
      <div class="physical-form-columns">
        <label>Artista <input name="artist" required maxlength="250" autocomplete="off" autofocus></label>
        <label>Album <input name="title" required maxlength="250" autocomplete="off"></label>
      </div>
      <fieldset class="physical-formats">
        <legend>Formati posseduti</legend>
        <label class="physical-check"><input type="checkbox" name="cd"> CD</label>
        <label class="physical-check"><input type="checkbox" name="vinyl"> Vinile</label>
      </fieldset>
      <button type="submit">Aggiungi alla raccolta</button>
    </form>
    <details class="physical-import-export">
      <summary>Importa o esporta supporti</summary>
      <label>Importa CSV <input id="physicalImportCsv" type="file" accept=".csv,text/csv"></label>
      <div class="dialog-actions">
        <button id="physicalExportCsv" type="button" class="secondary">Esporta CSV</button>
        <button id="physicalExportJson" type="button" class="secondary">Backup JSON</button>
      </div>
    </details>
    <p id="physicalStatus" role="status" aria-live="polite"></p>
  `;
  document.body.append(dialog);

  const select = (id) => document.getElementById(id);
  const form = select('physicalAddForm'), inputFile = select('physicalImportCsv');
  const status = select('physicalStatus');
  let busy = false;
  let importing = false;

  function notice(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function updateBusy() {
    const locked = busy || importing;
    dialog.setAttribute('aria-busy', String(locked));
    dialog.querySelectorAll('input, button:not(#closePhysicalTools)').forEach((control) => {
      control.disabled = locked;
    });
    openTools.disabled = locked;
    albumList.querySelectorAll('.physical-card-control input').forEach((control) => {
      control.disabled = locked;
    });
  }

  function setBusy(value) {
    busy = value;
    updateBusy();
  }

  openTools.setAttribute('aria-controls', dialog.id);
  openTools.setAttribute('aria-haspopup', 'dialog');
  openTools.addEventListener('click', () => {
    notice('');
    dialog.showModal();
  });
  select('closePhysicalTools').addEventListener('click', () => dialog.close());

  function decorateCard(card, album, flags) {
    let controls = card.querySelector('.physical-card-control');
    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'physical-card-control';
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', 'Formati posseduti');
      for (const [format, labelText] of formats) {
        const label = document.createElement('label');
        label.className = 'physical-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.format = format;
        input.dataset.control = `physical-${format}`;
        input.setAttribute('aria-label', `${labelText} · ${album.artist} — ${album.name}`);
        input.addEventListener('change', () => {
          const checked = input.checked;
          try {
            store.setPhysicalFormat(album.artist, album.name, format, checked);
          } catch (error) {
            input.checked = !checked;
            report(error.message, true);
            return;
          }
          render();
          report('Possesso aggiornato.');
        });
        label.append(input, document.createTextNode(` ${labelText}`));
        controls.append(label);
      }
      const options = card.querySelector('.album-options');
      (options || card).append(controls);
      const metadata = card.querySelector('.album-metadata');
      if (metadata) {
        const badges = document.createElement('span');
        badges.className = 'physical-badges';
        for (const [format, labelText] of formats) {
          const badge = document.createElement('span');
          badge.className = 'physical-badge';
          badge.dataset.format = format;
          badge.textContent = labelText;
          badges.append(badge);
        }
        metadata.append(badges);
      }
    }
    for (const input of controls.querySelectorAll('input')) {
      input.checked = Boolean(flags?.[input.dataset.format]);
      input.disabled = busy || importing;
    }
    const badges = card.querySelector('.physical-badges');
    if (badges) {
      badges.hidden = !flags?.cd && !flags?.vinyl;
      for (const badge of badges.children) badge.hidden = !flags?.[badge.dataset.format];
    }
  }

  function physicalCard(record, flags = record) {
    const card = document.createElement('article');
    card.className = 'album-card physical-only-card';
    const artwork = document.createElement('div');
    artwork.className = 'artwork';
    const initial = document.createElement('span');
    initial.textContent = [...record.title][0].toUpperCase();
    initial.setAttribute('aria-hidden', 'true');
    artwork.append(initial);
    const title = document.createElement('h2');
    title.textContent = record.title;
    const artist = document.createElement('p');
    artist.textContent = record.artist;
    card.append(artwork, title, artist);
    decorateCard(card, { artist: record.artist, name: record.title }, flags);
    return card;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = (name) => form.elements.namedItem(name);
    const row = {
      artist: value('artist').value,
      title: value('title').value,
      cd: value('cd').checked,
      vinyl: value('vinyl').checked,
    };
    if (!row.cd && !row.vinyl) {
      notice('Seleziona CD, Vinile o entrambi.', true);
      value('cd').focus();
      return;
    }
    try { store.addPhysical([row]); }
    catch (error) { notice(error.message, true); return; }
    form.reset();
    render();
    notice('Supporti salvati.');
    value('artist').focus();
  });

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  select('physicalExportCsv').addEventListener('click', () => {
    try { download('accord-cd-vinili.csv', csvPhysical(store.state.physical), 'text/csv;charset=utf-8'); }
    catch (error) { notice(error.message, true); }
  });
  select('physicalExportJson').addEventListener('click', () => {
    try {
      download('accord-physical-library.json', JSON.stringify(physicalDocument(store.state.physical), null, 2),
        'application/json;charset=utf-8');
    } catch (error) { notice(error.message, true); }
  });

  inputFile.addEventListener('change', async () => {
    const file = inputFile.files?.[0];
    if (!file) return;
    importing = true;
    updateBusy();
    try {
      if (file.size > 10_000_000) throw new Error('CSV troppo grande (massimo 10 MB).');
      const rows = parsePhysicalCsv(await file.text()).filter((row) => row.cd || row.vinyl);
      if (!dialog.open || busy) return;
      if (!rows.length) throw new Error('Il CSV non contiene CD o vinili contrassegnati.');
      if (!confirm(`Importare ${rows.length} righe nella raccolta?`)) return;
      store.addPhysical(rows);
      render();
      notice(`Importazione conclusa: ${rows.length} righe elaborate.`);
    } catch (error) { notice(error.message, true); }
    finally {
      inputFile.value = '';
      importing = false;
      updateBusy();
    }
  });

  return { decorateCard, physicalCard, setBusy };
}
