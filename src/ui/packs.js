// Paketverwaltung und Ersteinrichtung: Was ist lokal, was kann geladen werden, welche Ordner gehören dazu.
import { clear, confirmDialog, formatBytes, h, modal, promptDialog, toast } from './dom.js';
import { registerCustomPacks, registerUserFolders } from '../engine.js';

const statusLine = (pack) => {
  if (pack.bundled) return `In der App enthalten · ${pack.fileCount} Dateien`;
  const size = pack.bytes ? ` · ca. ${formatBytes(pack.bytes)}` : '';
  if (pack.cachedFiles >= pack.fileCount) return `Vollständig lokal · ${pack.fileCount} Dateien · ${formatBytes(pack.cachedBytes)}`;
  if (pack.cachedFiles > 0) return `${pack.cachedFiles} von ${pack.fileCount} Dateien lokal${size}`;
  return `Noch nicht geladen · ${pack.fileCount} Dateien${size}`;
};

const progressListeners = new Set();
const progressState = new Map();
let listening = false;

function ensureListening() {
  if (listening) return;
  listening = true;
  window.desktop.packs.onProgress((data) => {
    if (data.state === 'running') progressState.set(data.id, data);
    else progressState.delete(data.id);
    progressListeners.forEach((fn) => fn(data));
  });
}

export function onPackProgress(fn) {
  ensureListening();
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

export const activeDownloads = () => [...progressState.values()];

export async function openPackManager({ onChanged }) {
  ensureListening();
  const packList = h('div', { class: 'pack-list' });
  const folderList = h('div', { class: 'pack-list' });

  async function render() {
    const packs = await window.desktop.packs.list();
    clear(packList);
    for (const pack of packs) {
      const progress = progressState.get(pack.id);
      const complete = pack.cachedFiles >= pack.fileCount;
      const actions = [];
      if (progress) {
        actions.push(h('button', { class: 'mini-btn', onclick: () => window.desktop.packs.cancel(pack.id) }, 'Abbrechen'));
      } else if (!pack.bundled) {
        if (!complete) {
          actions.push(
            h(
              'button',
              {
                class: 'mini-btn btn-primary',
                onclick: () => {
                  window.desktop.packs.download(pack.id);
                  progressState.set(pack.id, { id: pack.id, done: 0, total: pack.fileCount });
                  render();
                },
              },
              pack.cachedFiles ? 'Rest laden' : 'Laden',
            ),
          );
        }
        if (pack.cachedFiles > 0) {
          actions.push(
            h(
              'button',
              {
                class: 'mini-btn',
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: 'Lokale Dateien löschen?',
                    message: `Die heruntergeladenen Dateien von „${pack.name}“ werden entfernt. Sie lassen sich jederzeit neu laden.`,
                    confirm: 'Löschen',
                    danger: true,
                  });
                  if (ok) {
                    await window.desktop.packs.removeCache(pack.id);
                    render();
                  }
                },
              },
              'Löschen',
            ),
          );
        }
        if (pack.custom) {
          actions.push(
            h(
              'button',
              {
                class: 'mini-btn',
                onclick: async () => {
                  await window.desktop.packs.removeCustom(pack.id);
                  render();
                },
              },
              'Entfernen',
            ),
          );
        }
      }
      packList.append(
        h(
          'div',
          { class: 'pack-row', dataset: { pack: pack.id } },
          h(
            'div',
            { class: 'pack-info' },
            h('strong', {}, pack.name),
            h('div', { class: 'muted small' }, pack.description),
            h('div', { class: 'small pack-status' }, statusLine(pack)),
            progress ? h('progress', { max: progress.total, value: progress.done }) : null,
            h('div', { class: 'muted small' }, `Lizenz: ${pack.license}`),
          ),
          h('div', { class: 'pack-actions' }, actions),
        ),
      );
    }
    const folders = await window.desktop.folders.list();
    clear(folderList);
    if (!folders.length) folderList.append(h('p', { class: 'muted small' }, 'Noch keine eigenen Ordner. Jeder Unterordner wird zu einem Sound, die Dateien darin zu Varianten.'));
    for (const folder of folders) {
      const sounds = Object.keys(folder.sounds);
      folderList.append(
        h(
          'div',
          { class: 'pack-row' },
          h(
            'div',
            { class: 'pack-info' },
            h('strong', {}, folder.name),
            h('div', { class: 'muted small' }, folder.path),
            h('div', { class: 'small' }, folder.missing ? 'Ordner nicht gefunden' : `${sounds.length} Sounds: ${sounds.slice(0, 8).join(', ')}${sounds.length > 8 ? ' …' : ''}`),
          ),
          h(
            'div',
            { class: 'pack-actions' },
            h(
              'button',
              {
                class: 'mini-btn',
                onclick: async () => {
                  await window.desktop.folders.remove(folder.id);
                  render();
                },
              },
              'Entfernen',
            ),
          ),
        ),
      );
    }
  }

  const unsubscribe = onPackProgress(() => render());

  const body = h(
    'div',
    {},
    h('p', { class: 'muted' }, 'Fehlende Samples werden beim ersten Abspielen automatisch geladen und danach lokal gespeichert. Mit „Laden“ holst du ein ganzes Paket vorab, damit es auch ohne Internet vollständig ist.'),
    packList,
    h('h3', {}, 'Eigene Sample-Ordner'),
    folderList,
    h(
      'div',
      { class: 'detail-actions' },
      h(
        'button',
        {
          class: 'mini-btn',
          onclick: async () => {
            const added = await window.desktop.folders.add();
            if (added) {
              await registerUserFolders();
              render();
              onChanged?.();
            }
          },
        },
        'Ordner hinzufügen',
      ),
      h(
        'button',
        {
          class: 'mini-btn',
          onclick: async () => {
            const input = await promptDialog({
              title: 'Paket hinzufügen',
              label: 'GitHub-Repo mit strudel.json oder Adresse der JSON-Datei',
              value: 'github:',
              confirm: 'Hinzufügen',
            });
            if (!input) return;
            try {
              await window.desktop.packs.addRemote(input);
              await registerCustomPacks();
              render();
              onChanged?.();
            } catch (err) {
              toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
            }
          },
        },
        'Paket von GitHub',
      ),
      h(
        'button',
        {
          class: 'mini-btn',
          onclick: async () => {
            await registerUserFolders();
            render();
            onChanged?.();
            toast('Ordner neu eingelesen');
          },
        },
        'Ordner neu einlesen',
      ),
    ),
  );

  modal({
    title: 'Sample-Pakete',
    wide: true,
    body,
    onClose: () => {
      unsubscribe();
      onChanged?.();
    },
  });
  render();
}

export async function openFirstRun() {
  const packs = await window.desktop.packs.list();
  const optional = packs.filter((p) => !p.bundled);
  const checks = new Map(optional.map((p) => [p.id, h('input', { type: 'checkbox', checked: !!p.recommended })]));
  const total = h('strong', {});
  const updateTotal = () => {
    const bytes = optional.filter((p) => checks.get(p.id).checked).reduce((sum, p) => sum + p.bytes, 0);
    total.textContent = bytes ? `Auswahl: ca. ${formatBytes(bytes)}` : 'Nichts ausgewählt';
  };
  checks.forEach((c) => (c.onchange = updateTotal));
  updateTotal();

  const dialog = modal({
    title: 'Willkommen bei Strudel Desktop',
    wide: true,
    body: h(
      'div',
      {},
      h('p', {}, 'Strudel läuft ab sofort komplett lokal. Drumkit, TR-808, TR-909, Klavier und alle Synths sind schon dabei. Für den vollen Klangumfang kannst du weitere Pakete laden.'),
      h(
        'div',
        { class: 'pack-list' },
        optional.map((p) =>
          h(
            'label',
            { class: 'pack-row pack-check' },
            checks.get(p.id),
            h(
              'div',
              { class: 'pack-info' },
              h('strong', {}, p.name),
              h('span', { class: 'muted small' }, p.bytes ? ` · ca. ${formatBytes(p.bytes)}` : ''),
              h('div', { class: 'muted small' }, p.description),
            ),
          ),
        ),
      ),
      h('p', { class: 'small' }, total),
      h('p', { class: 'muted small' }, 'Du kannst das jederzeit unter „Samples → Pakete & Ordner“ ändern. Nicht geladene Samples werden bei Bedarf einzeln nachgeholt, solange du online bist.'),
    ),
    onClose: () => window.desktop.firstRunDone(),
  });
  dialog.box.append(
    h(
      'div',
      { class: 'modal-actions' },
      h('button', { onclick: () => dialog.close() }, 'Später'),
      h(
        'button',
        {
          class: 'btn-primary',
          onclick: () => {
            for (const p of optional) if (checks.get(p.id).checked) window.desktop.packs.download(p.id);
            dialog.close();
          },
        },
        'Herunterladen',
      ),
    ),
  );
}
