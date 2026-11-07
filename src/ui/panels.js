// Vorlagen, Funktionsreferenz, Projekte und Einstellungen.
import { codemirrorSettings, themes } from '@strudel/codemirror';
import { docs, docByName, plainDescription, renderDoc, signature } from '../code/docs.js';
import { snippets, templates } from '../templates.js';
import { clear, confirmDialog, h, promptDialog, toast } from './dom.js';

const USER_TEMPLATES_KEY = 'strudel-desktop:templates';

const loadUserTemplates = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_TEMPLATES_KEY) ?? '[]');
  } catch {
    return [];
  }
};
const saveUserTemplates = (list) => localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify(list));

export function createTemplatesPanel({ engine, openTemplate, insertCode, currentCode }) {
  let previewingId = null;
  const list = h('div', { class: 'template-list' });
  const search = h('input', {
    class: 'field',
    type: 'search',
    placeholder: 'Vorlage suchen …',
    'aria-label': 'Vorlage suchen',
    oninput: () => render(),
  });

  engine.onPreviewToggle = (started) => {
    if (!started) {
      previewingId = null;
      render();
    }
  };

  const togglePreview = async (template) => {
    if (previewingId === template.id) {
      engine.stopPreview();
      previewingId = null;
    } else {
      previewingId = template.id;
      try {
        await engine.preview(template.code);
      } catch (err) {
        previewingId = null;
        toast(err.message, 'error');
      }
    }
    render();
  };

  const card = (template, { removable } = {}) =>
    h(
      'div',
      { class: 'template-card', dataset: { template: template.id } },
      h(
        'div',
        { class: 'template-main' },
        h('strong', {}, template.name),
        template.description ? h('div', { class: 'muted small' }, template.description) : null,
      ),
      h(
        'div',
        { class: 'template-actions' },
        h(
          'button',
          {
            class: `mini-btn${previewingId === template.id ? ' active' : ''}`,
            'aria-label': previewingId === template.id ? `${template.name} stoppen` : `${template.name} anhören`,
            onclick: () => togglePreview(template),
          },
          previewingId === template.id ? '■ Stopp' : '▶ Anhören',
        ),
        h(
          'button',
          {
            class: 'mini-btn btn-primary',
            onclick: () => {
              engine.stopPreview();
              openTemplate(template);
            },
          },
          'Öffnen',
        ),
        removable
          ? h(
              'button',
              {
                class: 'mini-btn',
                onclick: async () => {
                  const ok = await confirmDialog({ title: 'Vorlage löschen?', message: `„${template.name}“ wird entfernt.`, confirm: 'Löschen', danger: true });
                  if (!ok) return;
                  saveUserTemplates(loadUserTemplates().filter((t) => t.id !== template.id));
                  render();
                },
              },
              'Löschen',
            )
          : null,
      ),
    );

  function render() {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const match = (t) => !q || `${t.name} ${t.description ?? ''} ${t.category ?? ''}`.toLowerCase().includes(q);
    const mine = loadUserTemplates().filter(match);
    if (mine.length) list.append(h('h3', {}, 'Eigene Vorlagen'), ...mine.map((t) => card(t, { removable: true })));
    const byCategory = new Map();
    for (const t of templates.filter(match)) (byCategory.get(t.category) ?? byCategory.set(t.category, []).get(t.category)).push(t);
    for (const [category, items] of byCategory) list.append(h('h3', {}, category), ...items.map((t) => card(t)));
    const foundSnippets = snippets.filter((s) => !q || s.name.toLowerCase().includes(q));
    if (foundSnippets.length) {
      list.append(
        h('h3', {}, 'Bausteine'),
        h(
          'div',
          { class: 'chip-row' },
          foundSnippets.map((s) =>
            h(
              'button',
              {
                class: 'chip',
                title: s.code,
                draggable: true,
                ondragstart: (e) => e.dataTransfer.setData('text/plain', s.code),
                onclick: () => insertCode(s.code, { chained: s.chained }),
              },
              s.name,
            ),
          ),
        ),
      );
    }
  }

  const root = h(
    'div',
    { class: 'panel' },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', {}, 'Vorlagen'),
      h(
        'button',
        {
          class: 'mini-btn',
          onclick: async () => {
            const name = await promptDialog({ title: 'Als Vorlage speichern', label: 'Name der Vorlage', confirm: 'Speichern' });
            if (!name) return;
            saveUserTemplates([...loadUserTemplates(), { id: `u${Date.now()}`, name, code: currentCode() }]);
            render();
          },
        },
        'Aktuellen Code sichern',
      ),
    ),
    search,
    list,
  );
  render();
  return { root, refresh: render, focus: () => search.focus() };
}

const CATEGORY_ORDER = ['Pattern', 'Klang & Effekte', 'Signale & Zufall', 'Euklidische Rhythmen', 'Harmonie & Tonleitern', 'Auswahl (pick)', 'Tempo & Ablauf', 'Samples', 'Visualisierung', 'MIDI & OSC', 'Sensoren', 'Sonstiges'];

export function createReferencePanel({ engine, insertCode }) {
  let category = 'Alle';
  let selected = null;
  const list = h('div', { class: 'ref-list', role: 'listbox', 'aria-label': 'Funktionen' });
  const detail = h('div', { class: 'ref-detail' });
  const search = h('input', {
    class: 'field',
    type: 'search',
    placeholder: 'Funktion suchen … (z. B. filter, delay, euclid)',
    'aria-label': 'Funktion suchen',
    oninput: () => renderList(),
  });
  const select = h(
    'select',
    {
      class: 'field',
      'aria-label': 'Kategorie',
      onchange: () => {
        category = select.value;
        renderList();
      },
    },
    ['Alle', ...CATEGORY_ORDER].map((c) => h('option', { value: c }, c)),
  );

  const actions = {
    preview: (code) => engine.preview(code).catch((err) => toast(err.message, 'error')),
    insert: (code) => insertCode(code),
  };

  function score(doc, q) {
    const names = [doc.name, ...doc.synonyms].map((n) => n.toLowerCase());
    if (names.includes(q)) return 0;
    if (names.some((n) => n.startsWith(q))) return 1;
    if (names.some((n) => n.includes(q))) return 2;
    if (plainDescription(doc).toLowerCase().includes(q)) return 3;
    return 9;
  }

  function renderList() {
    clear(list);
    const q = search.value.trim().toLowerCase();
    let items = docs.filter((d) => category === 'Alle' || d.category === category);
    if (q) {
      items = items
        .map((d) => [score(d, q), d])
        .filter(([s]) => s < 9)
        .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
        .map(([, d]) => d);
    }
    list.append(
      ...items.map((doc) =>
        h(
          'button',
          {
            class: `ref-item${selected === doc ? ' selected' : ''}`,
            role: 'option',
            onclick: () => show(doc),
          },
          h('code', {}, signature(doc.name, doc)),
          h('span', { class: 'muted small ellipsis' }, plainDescription(doc).split('\n')[0]),
        ),
      ),
    );
    if (!items.length) list.append(h('div', { class: 'muted pad' }, 'Nichts gefunden.'));
  }

  function show(doc, name) {
    selected = doc;
    clear(detail).append(
      renderDoc(doc, { name: name ?? doc.name, actions }),
      h(
        'div',
        { class: 'detail-actions' },
        h('button', { class: 'mini-btn', onclick: () => engine.stopPreview() }, '■ Beispiel stoppen'),
      ),
    );
    detail.scrollTop = 0;
    renderList();
  }

  const root = h('div', { class: 'panel panel-reference' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Referenz'), h('span', { class: 'muted small' }, `${docs.length} Funktionen`)), search, select, list, detail);
  renderList();
  return {
    root,
    focus: () => search.focus(),
    lookup(word) {
      const doc = docByName.get(word);
      if (doc) {
        search.value = '';
        category = 'Alle';
        select.value = 'Alle';
        show(doc, word);
        list.querySelector('.ref-item.selected')?.scrollIntoView({ block: 'center' });
      } else if (word) {
        search.value = word;
        renderList();
      }
    },
  };
}

export function createProjectsPanel({ project }) {
  const list = h('div', { class: 'project-list' });
  const location = h('div', { class: 'muted small path' });

  async function render() {
    const info = await window.desktop.info();
    location.textContent = info.libraryDir;
    const items = await window.desktop.projects.list();
    clear(list);
    if (!items.length) list.append(h('p', { class: 'muted pad' }, 'Noch keine Projekte. Mit Strg+S speicherst du das aktuelle Stück hier.'));
    for (const item of items) {
      const active = project.isLibraryProject(item.name);
      list.append(
        h(
          'div',
          { class: `project-row${active ? ' selected' : ''}` },
          h(
            'button',
            { class: 'project-open', title: 'Öffnen', onclick: () => project.openLibrary(item.name) },
            h('span', { class: 'sound-name' }, item.name),
            h('span', { class: 'muted small' }, new Date(item.modified).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })),
          ),
          h(
            'button',
            {
              class: 'mini-btn',
              onclick: async () => {
                const to = await promptDialog({ title: 'Projekt umbenennen', label: 'Neuer Name', value: item.name, confirm: 'Umbenennen' });
                if (!to || to === item.name) return;
                try {
                  await window.desktop.projects.rename(item.name, to);
                  project.onRenamed(item.name, to);
                  render();
                } catch (err) {
                  toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
                }
              },
            },
            'Umbenennen',
          ),
          h(
            'button',
            {
              class: 'mini-btn',
              onclick: async () => {
                const ok = await confirmDialog({ title: 'Projekt in den Papierkorb?', message: `„${item.name}“ wird in den Papierkorb verschoben.`, confirm: 'Verschieben', danger: true });
                if (!ok) return;
                await window.desktop.projects.trash(item.name);
                project.onTrashed(item.name);
                render();
              },
            },
            'Löschen',
          ),
        ),
      );
    }
  }

  const root = h(
    'div',
    { class: 'panel' },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', {}, 'Projekte'),
      h('button', { class: 'mini-btn', onclick: () => project.newProject() }, 'Neu'),
    ),
    location,
    h(
      'div',
      { class: 'detail-actions' },
      h('button', { class: 'mini-btn', onclick: () => window.desktop.projects.reveal() }, 'Ordner öffnen'),
      h(
        'button',
        {
          class: 'mini-btn',
          onclick: async () => {
            if (await window.desktop.projects.chooseLibrary()) render();
          },
        },
        'Ordner ändern',
      ),
    ),
    list,
  );
  render();
  return { root, refresh: render };
}

const TOGGLES = [
  ['isAutoCompletionEnabled', 'Autovervollständigung'],
  ['isTooltipEnabled', 'Doku-Tooltips und Parameterhilfe'],
  ['isPatternHighlightingEnabled', 'Aktive Noten im Code hervorheben'],
  ['isFlashEnabled', 'Beim Ausführen aufblitzen'],
  ['isLineNumbersDisplayed', 'Zeilennummern'],
  ['isActiveLineHighlighted', 'Aktive Zeile hervorheben'],
  ['isBracketMatchingEnabled', 'Klammerpaare hervorheben'],
  ['isBracketClosingEnabled', 'Klammern automatisch schließen'],
  ['isLineWrappingEnabled', 'Zeilenumbruch'],
  ['isTabIndentationEnabled', 'Tab rückt ein'],
  ['isMultiCursorEnabled', 'Mehrere Cursor (Strg+Klick)'],
];

function createAssistSettings(assist) {
  const status = h('p', { class: 'muted small' });
  const enabled = h('input', { type: 'checkbox', onchange: () => assist.configure({ enabled: enabled.checked }) });
  const url = h('input', {
    class: 'field',
    type: 'url',
    spellcheck: false,
    onchange: async () => {
      try {
        await assist.configure({ url: url.value.trim() });
      } catch {
        toast('Das ist keine gültige Serveradresse', 'error');
        url.value = assist.config.url;
      }
      refresh();
    },
  });
  const model = h('select', { class: 'field', onchange: () => assist.configure({ model: model.value }) });

  async function refresh() {
    const { url: current, enabled: on, model: chosen } = assist.config;
    enabled.checked = on;
    url.value = current;
    const result = await assist.listModels();
    const names = result.ok ? result.models : [];
    if (chosen && !names.includes(chosen)) names.unshift(chosen);
    clear(model).append(
      h('option', { value: '', selected: !chosen }, 'Automatisch'),
      ...names.map((name) => h('option', { value: name, selected: name === chosen }, name)),
    );
    status.textContent = result.ok
      ? `Verbunden, ${result.models.length} Modelle. Der Code geht nur an diesen Server.`
      : `Keine Verbindung zu ${current}. Läuft Ollama?`;
  }

  const root = [
    h('h3', {}, 'KI-Vorschläge'),
    h('label', { class: 'toggle' }, enabled, 'Vorschläge beim Tippen (Ollama)'),
    h('label', { class: 'field-label' }, 'Ollama-Server', url),
    h('label', { class: 'field-label' }, 'Modell', model),
    status,
    h('p', { class: 'muted small' }, 'Tab übernimmt, Esc verwirft, Strg+→ übernimmt ein Wort, Strg+Umschalt+Leertaste fragt sofort. Ein Kommentar wie // 4/4 beat with bassdrum ergibt Code in der nächsten Zeile.'),
  ];
  return { root, refresh };
}

export function createSettingsPanel({ engine, assist }) {
  const apply = (key, value) => {
    const next = { ...codemirrorSettings.get(), [key]: value };
    codemirrorSettings.set(next);
    engine.mirror.changeSetting(key, value);
  };
  const settings = codemirrorSettings.get();

  const theme = h(
    'select',
    { class: 'field', onchange: () => apply('theme', theme.value) },
    Object.keys(themes).map((name) => h('option', { value: name, selected: settings.theme === name }, name)),
  );
  const keys = h(
    'select',
    { class: 'field', onchange: () => apply('keybindings', keys.value) },
    [
      ['codemirror', 'Standard'],
      ['vscode', 'VS Code'],
      ['vim', 'Vim'],
      ['emacs', 'Emacs'],
    ].map(([value, label]) => h('option', { value, selected: settings.keybindings === value }, label)),
  );
  const size = h('input', {
    class: 'field',
    type: 'number',
    min: 10,
    max: 36,
    value: settings.fontSize,
    onchange: () => apply('fontSize', Number(size.value)),
  });

  const assistSettings = createAssistSettings(assist);

  const root = h(
    'div',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Einstellungen')),
    h('label', { class: 'field-label' }, 'Farbschema', theme),
    h('label', { class: 'field-label' }, 'Schriftgröße', size),
    h('label', { class: 'field-label' }, 'Tastaturbelegung', keys),
    h('h3', {}, 'Editor'),
    TOGGLES.map(([key, label]) => {
      const input = h('input', {
        type: 'checkbox',
        checked: !!settings[key] && settings[key] !== 'false',
        onchange: () => apply(key, input.checked),
      });
      return h('label', { class: 'toggle' }, input, label);
    }),
    assistSettings.root,
    h('h3', {}, 'Über'),
    h(
      'p',
      { class: 'muted small' },
      'Strudel Desktop nutzt die Strudel-Engine von uzu und den Strudel-Beitragenden, lizenziert unter AGPL-3.0. Diese App steht unter derselben Lizenz. ',
      h('button', { class: 'link-btn', onclick: () => window.desktop.openExternal('https://codeberg.org/uzu/strudel') }, 'Strudel-Quellcode'),
    ),
  );
  return { root, refresh: assistSettings.refresh };
}
