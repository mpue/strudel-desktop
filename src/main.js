import '@fontsource-variable/jetbrains-mono';
import './style.css';
import { logger } from '@strudel/core';
import { EditorView } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { Engine } from './engine.js';
import { createCodeExtensions } from './code/index.js';
import { reportEvalError, setLintReady } from './code/lint.js';
import { enclosingCall, stringAt } from './code/context.js';
import { templates } from './templates.js';
import { clear, confirmDialog, h, promptDialog, toast } from './ui/dom.js';
import { createSamplesPanel } from './ui/samples.js';
import { activeDownloads, onPackProgress, openFirstRun } from './ui/packs.js';
import { createProjectsPanel, createReferencePanel, createSettingsPanel, createTemplatesPanel } from './ui/panels.js';

const $ = (id) => document.getElementById(id);
const STATE_KEY = 'strudel-desktop:state';

const loadState = () => {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY)) ?? {};
  } catch {
    return {};
  }
};

const saved = loadState();
const starter = templates.find((t) => t.id === 'erste-schritte').code;

// --- Projektzustand ------------------------------------------------------------------------------
const doc = {
  kind: saved.kind === 'library' ? 'library' : 'draft',
  name: saved.name ?? 'Unbenannt',
  token: null,
  savedCode: saved.savedCode ?? saved.code ?? starter,
};

let lastEvaluatedCode = null;
let engine;
let panels = {};

const code = () => engine.code;
const isDirty = () => code() !== doc.savedCode;

function updateProjectLabel() {
  $('project-name').textContent = doc.name;
  $('project-dirty').hidden = !isDirty();
  document.title = `${isDirty() ? '● ' : ''}${doc.name} · Strudel Desktop`;
}

let persistTimer;
function persistDraft() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ code: code(), kind: doc.kind, name: doc.name, savedCode: doc.savedCode }));
  }, 300);
}

function setDocument({ kind, name, token = null, source }) {
  doc.kind = kind;
  doc.name = name;
  doc.token = token;
  doc.savedCode = source;
  engine.setCode(source);
  showError(null);
  updateProjectLabel();
  persistDraft();
  panels.projects?.refresh();
}

async function confirmDiscard() {
  if (!isDirty()) return true;
  return confirmDialog({
    title: 'Änderungen verwerfen?',
    message: `„${doc.name}“ hat ungespeicherte Änderungen.`,
    confirm: 'Verwerfen',
    danger: true,
  });
}

const project = {
  isLibraryProject: (name) => doc.kind === 'library' && doc.name === name,
  async newProject() {
    if (await confirmDiscard()) setDocument({ kind: 'draft', name: 'Unbenannt', source: 'setcpm(120/4)\n\n$: s("bd*4")\n' });
  },
  async openLibrary(name) {
    if (!(await confirmDiscard())) return;
    setDocument({ kind: 'library', name, source: await window.desktop.projects.read(name) });
  },
  async openFile() {
    if (!(await confirmDiscard())) return;
    const file = await window.desktop.files.open();
    if (file) setDocument({ kind: 'external', name: file.name, token: file.token, source: file.code });
  },
  async save() {
    if (doc.kind === 'library') {
      await window.desktop.projects.write(doc.name, code());
    } else if (doc.kind === 'external' && doc.token) {
      await window.desktop.files.write(doc.token, code());
    } else {
      const name = await promptDialog({ title: 'Projekt speichern', label: 'Name', value: doc.name === 'Unbenannt' ? '' : doc.name, confirm: 'Speichern' });
      if (!name) return;
      const exists = (await window.desktop.projects.list()).some((p) => p.name === name);
      if (exists && !(await confirmDialog({ title: 'Überschreiben?', message: `Es gibt bereits ein Projekt „${name}“.`, confirm: 'Überschreiben', danger: true }))) return;
      await window.desktop.projects.write(name, code());
      doc.kind = 'library';
      doc.name = name;
    }
    doc.savedCode = code();
    updateProjectLabel();
    persistDraft();
    panels.projects?.refresh();
    toast(`„${doc.name}“ gespeichert`);
  },
  async saveAs() {
    const file = await window.desktop.files.saveAs(doc.name, code());
    if (!file) return;
    doc.kind = 'external';
    doc.name = file.name;
    doc.token = file.token;
    doc.savedCode = code();
    updateProjectLabel();
    persistDraft();
    panels.projects?.refresh();
  },
  onRenamed(from, to) {
    if (this.isLibraryProject(from)) {
      doc.name = to;
      updateProjectLabel();
      persistDraft();
    }
  },
  onTrashed(name) {
    if (this.isLibraryProject(name)) {
      doc.kind = 'draft';
      doc.savedCode = '';
      updateProjectLabel();
      persistDraft();
    }
  },
};

// --- Einfügen in den Code ------------------------------------------------------------------------
function insertAtNewLine(text) {
  const view = engine.editor;
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const insert = line.text.trim() ? `\n${text}` : text;
  const from = line.text.trim() ? line.to : line.from;
  const to = line.text.trim() ? line.to : line.to;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
  });
  view.focus();
}

// Steht der Cursor in s("..."), wird nur das Wort ergänzt, sonst entsteht eine neue Spur.
function insertSound({ name, bank, n, pitched }) {
  const view = engine.editor;
  const { state } = view;
  const pos = state.selection.main.head;
  const token = n ? `${name}:${n}` : name;
  const str = stringAt(state, pos);
  const call = str && enclosingCall(state, pos);
  if (call && (call.name === 's' || call.name === 'sound')) {
    const before = state.sliceDoc(pos - 1, pos);
    const after = state.sliceDoc(pos, pos + 1);
    const pad = before === '"' || before === ' ' || before === '[' || before === '<' ? '' : ' ';
    const padAfter = after === '"' || after === ' ' || after === ']' || after === '>' ? '' : ' ';
    const insert = `${pad}${token}${padAfter}`;
    view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } });
    view.focus();
    return;
  }
  const bankPart = bank ? `.bank("${bank}")` : '';
  insertAtNewLine(pitched ? `$: note("c3 e3 g3 c4").s("${token}")${bankPart}` : `$: s("${token}")${bankPart}`);
}

function insertCode(text, { chained = false } = {}) {
  const view = engine.editor;
  if (chained) {
    const { state } = view;
    const pos = state.selection.main.head;
    const line = state.doc.lineAt(pos);
    // Bausteine wie .room() gehören ans Zeilenende, nicht mitten in einen String.
    view.dispatch({ changes: { from: line.to, insert: text }, selection: { anchor: line.to + text.length } });
    view.focus();
    return;
  }
  insertAtNewLine(text);
}

// --- Fehleranzeige & Konsole ---------------------------------------------------------------------
const consoleLines = $('console-lines');

function logLine(message, type) {
  const isError = type === 'error' || /error|failed|not found|could not/i.test(message);
  const node = h('div', { class: `log-line${isError ? ' log-error' : type === 'warning' ? ' log-warn' : ''}` }, h('span', { class: 'log-time' }, new Date().toLocaleTimeString('de-DE')), message);
  consoleLines.append(node);
  while (consoleLines.childElementCount > 500) consoleLines.firstChild.remove();
  consoleLines.scrollTop = consoleLines.scrollHeight;
}

function showError(err) {
  const bar = $('error-bar');
  if (!err) {
    bar.hidden = true;
    return;
  }
  clear(bar).append(
    h('strong', {}, 'Fehler: '),
    h('span', {}, String(err.message ?? err)),
    h('button', { class: 'mini-btn', onclick: () => (bar.hidden = true) }, 'Schließen'),
  );
  bar.hidden = false;
}

function toggleConsole(force) {
  const node = $('console');
  node.hidden = force === undefined ? !node.hidden : !force;
  engine?.fitCanvas();
}

// --- Seitenleiste --------------------------------------------------------------------------------
const RAIL = [
  { id: 'samples', label: 'Samples', icon: '♪' },
  { id: 'templates', label: 'Vorlagen', icon: '❖' },
  { id: 'reference', label: 'Referenz', icon: '?' },
  { id: 'projects', label: 'Projekte', icon: '▤' },
  { id: 'settings', label: 'Einstellungen', icon: '⚙' },
];
let activePanel = null;
const sidebar = $('sidebar');

function showPanel(id, { toggle = false } = {}) {
  if (toggle && activePanel === id && !sidebar.hidden) {
    sidebar.hidden = true;
  } else {
    sidebar.hidden = false;
    activePanel = id;
    clear(sidebar).append(panels[id].root);
    panels[id].refresh?.();
    panels[id].focus?.();
  }
  document.querySelectorAll('.rail-btn').forEach((b) => {
    const on = b.dataset.panel === activePanel && !sidebar.hidden;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  localStorage.setItem('strudel-desktop:panel', sidebar.hidden ? '' : activePanel);
  engine?.fitCanvas();
}

function buildRail() {
  $('rail').append(
    ...RAIL.map((item) =>
      h(
        'button',
        {
          class: 'rail-btn',
          title: item.label,
          'aria-label': item.label,
          dataset: { panel: item.id },
          onclick: () => showPanel(item.id, { toggle: true }),
        },
        h('span', { class: 'rail-icon', 'aria-hidden': 'true' }, item.icon),
        h('span', { class: 'rail-label' }, item.label),
      ),
    ),
  );
}

// --- Transport -----------------------------------------------------------------------------------
async function play() {
  showError(null);
  reportEvalError(engine.editor, null);
  try {
    await engine.play();
  } catch (err) {
    showError(err);
  }
}

function updateStatus() {
  const status = $('status');
  const pending = $('pending');
  if (engine.started) {
    const cps = engine.scheduler.cps;
    const cycle = engine.scheduler.now();
    status.textContent = `Läuft · ${Math.round(cps * 60 * 4)} BPM · Takt ${Math.floor(cycle) + 1}`;
    status.classList.add('playing');
    pending.hidden = code() === lastEvaluatedCode;
  } else if (engine.previewing) {
    status.textContent = 'Vorschau läuft';
    status.classList.add('playing');
    pending.hidden = true;
  } else {
    status.textContent = 'Gestoppt';
    status.classList.remove('playing');
    pending.hidden = true;
  }
}

async function exportWav() {
  const value = await promptDialog({
    title: 'Als WAV exportieren',
    label: 'Länge in Zyklen (Takten)',
    value: '8',
    type: 'number',
    min: 1,
    max: 2000,
    confirm: 'Exportieren',
  });
  const cycles = Number(value);
  if (!cycles) return;
  $('status').textContent = 'Exportiere …';
  try {
    await engine.exportWav({ cycles, name: doc.name });
    toast('Export abgeschlossen');
  } catch (err) {
    showError(err);
  }
}

function updateAssistStatus({ state, text }) {
  const node = $('ai-status');
  node.textContent = text;
  node.dataset.state = state;
}

function updateDownloadStatus() {
  const downloads = activeDownloads();
  if (!downloads.length) {
    $('download-status').textContent = '';
    return;
  }
  const done = downloads.reduce((s, d) => s + d.done, 0);
  const total = downloads.reduce((s, d) => s + d.total, 0);
  $('download-status').textContent = `Lade Samples: ${Math.round((done / total) * 100)} %`;
}

// --- Start ---------------------------------------------------------------------------------------
// Nur für tests/smoke.cjs: macht interne Funktionen für den End-to-End-Test erreichbar.
async function installTestHooks() {
  const [{ analyse }, { strudelCompletion }, { isKnownSound }, webaudio, { EditorState }, { javascript }, { CompletionContext, startCompletion }, { ensureSyntaxTree }, assistPrompt] = await Promise.all([
    import('./code/lint.js'),
    import('./code/completion.js'),
    import('./code/catalog.js'),
    import('@strudel/webaudio'),
    import('@codemirror/state'),
    import('@codemirror/lang-javascript'),
    import('@codemirror/autocomplete'),
    import('@codemirror/language'),
    import('./code/assist-prompt.js'),
  ]);
  window.__assistPrompt = assistPrompt;
  window.__startCompletion = startCompletion;
  window.__analyse = analyse;
  window.__soundKnown = isKnownSound;
  window.__soundEntry = (name) => webaudio.soundMap.get()[name]?.data?.samples;
  window.__audio = webaudio.getAudioContext;
  window.__complete = (source, explicit) => {
    const pos = source.indexOf('|');
    const doc = source.replace('|', '');
    const state = EditorState.create({ doc, extensions: [javascript()] });
    ensureSyntaxTree(state, doc.length, 1000);
    const result = strudelCompletion(new CompletionContext(state, pos, explicit));
    if (!result) return [];
    const typed = doc.slice(result.from, pos).toLowerCase();
    return result.options.map((o) => o.label).filter((l) => l.toLowerCase().includes(typed));
  };
  window.__measureLevel = async (ms) => {
    const controller = webaudio.getSuperdoughAudioController();
    const ctx = webaudio.getAudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    controller.output.destinationGain.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let peak = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      analyser.getFloatTimeDomainData(data);
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      await new Promise((r) => setTimeout(r, 20));
    }
    controller.output.destinationGain.disconnect(analyser);
    return peak;
  };
}

async function main() {
  buildRail();

  const actions = {
    preview: (example) => engine.preview(example).catch((err) => toast(err.message, 'error')),
    audition: (opts) => engine.auditionSound(opts),
    openReference: (word) => {
      showPanel('reference');
      panels.reference.lookup(word);
    },
    isReady: () => ready,
    onAssistStatus: updateAssistStatus,
  };

  document.addEventListener(logger.key, (e) => logLine(e.detail.message, e.detail.type));

  let ready = false;
  setLintReady(() => ready);

  const codeExtensions = createCodeExtensions(actions);
  engine = new Engine({
    root: $('editor'),
    canvas: $('test-canvas'),
    initialCode: saved.code ?? starter,
    codeExtensions,
    onEvalError: (err) => {
      showError(err);
      reportEvalError(engine.editor, err);
    },
    onEvaluated: ({ code: evaluated }) => {
      lastEvaluatedCode = evaluated ?? code();
      showError(null);
      reportEvalError(engine.editor, null);
    },
  });

  engine.editor.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          updateProjectLabel();
          persistDraft();
        }
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          $('cursor-pos').textContent = `Zeile ${line.number}, Spalte ${pos - line.from + 1}`;
        }
      }),
    ),
  });

  panels.samples = createSamplesPanel({ engine, insertSound });
  panels.templates = createTemplatesPanel({
    engine,
    insertCode,
    currentCode: code,
    openTemplate: async (template) => {
      if (await confirmDiscard()) setDocument({ kind: 'draft', name: template.name, source: template.code });
    },
  });
  panels.reference = createReferencePanel({ engine, insertCode });
  panels.projects = createProjectsPanel({ project });
  panels.settings = createSettingsPanel({ engine, assist: codeExtensions.assist });

  const lastPanel = localStorage.getItem('strudel-desktop:panel');
  if (lastPanel === '') sidebar.hidden = true;
  else showPanel(lastPanel && panels[lastPanel] ? lastPanel : 'samples');

  $('btn-play').onclick = play;
  $('btn-stop').onclick = () => engine.stop();
  $('btn-new').onclick = () => project.newProject();
  $('btn-open').onclick = () => project.openFile();
  $('btn-save').onclick = () => project.save();
  $('btn-export').onclick = exportWav;
  $('btn-console').onclick = () => toggleConsole();
  $('ai-status').onclick = () => showPanel('settings');
  $('btn-console-close').onclick = () => toggleConsole(false);
  $('btn-console-clear').onclick = () => clear(consoleLines);

  window.desktop.onMenu((action) => {
    if (action.startsWith('panel:')) return showPanel(action.slice(6));
    const map = {
      new: () => project.newProject(),
      open: () => project.openFile(),
      save: () => project.save(),
      'save-as': () => project.saveAs(),
      export: exportWav,
      play,
      stop: () => engine.stop(),
      'toggle-sidebar': () => {
        sidebar.hidden = !sidebar.hidden;
        engine.fitCanvas();
      },
      'toggle-console': () => toggleConsole(),
    };
    map[action]?.();
  });

  // Auch außerhalb des Editors sollen die Transport-Tasten funktionieren.
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('.cm-editor')) return;
    if ((e.ctrlKey || e.altKey) && e.key === 'Enter') {
      e.preventDefault();
      play();
    } else if ((e.ctrlKey || e.altKey) && e.key === '.') {
      e.preventDefault();
      engine.stop();
    }
  });

  onPackProgress((data) => {
    updateDownloadStatus();
    if (data.state === 'finished') {
      toast(data.failed ? `Download abgeschlossen, ${data.failed} Dateien fehlgeschlagen` : 'Download abgeschlossen', data.failed ? 'error' : 'info');
    } else if (data.state === 'error') {
      toast(`Download fehlgeschlagen: ${data.message}`, 'error');
    }
  });

  updateProjectLabel();
  setInterval(updateStatus, 200);

  await engine.ready;
  ready = true;
  panels.samples.refresh();
  // Nach dem Laden der Sounds neu prüfen, sonst wären sie im ersten Lauf noch unbekannt.
  reportEvalError(engine.editor, null);
  $('status').textContent = 'Bereit';

  const info = await window.desktop.info();
  if (!info.firstRunDone && !info.test) openFirstRun();

  window.strudelApp = { engine, templates, panels, project, doc, showPanel, openFirstRun, assist: codeExtensions.assist };
  if (info.test) await installTestHooks();
}

main().catch((err) => {
  console.error(err);
  $('status').textContent = `Start fehlgeschlagen: ${err.message}`;
});
