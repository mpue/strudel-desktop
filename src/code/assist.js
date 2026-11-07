// KI-Vorschläge über einen Ollama-Server: grauer Text am Cursor, Tab übernimmt ihn.
import { completionStatus } from '@codemirror/autocomplete';
import { isolateHistory } from '@codemirror/commands';
import { Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from '@codemirror/view';
import { buildMessages, cleanSuggestion, retryMessages } from './assist-prompt.js';
import { isInComment } from './context.js';
import { analyse } from './lint.js';

const TYPING_DELAY = 300;
// Bei Kommentaren länger warten, sonst kommt zu jeder Tipp-Pause im Satz ein Vorschlag.
const COMMENT_DELAY = 600;
const OFFLINE_PAUSE = 15000;
const THINKING_DELAY = 250;

const setGhost = StateEffect.define();

class GhostWidget extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }

  eq(other) {
    return other.text === this.text;
  }

  toDOM() {
    const node = document.createElement('span');
    node.className = 'cm-ghost-text';
    node.textContent = this.text;
    return node;
  }

  ignoreEvent() {
    return true;
  }
}

const ghostDecorations = (ghost) => {
  if (!ghost) return Decoration.none;
  const widget = new GhostWidget(ghost.text);
  const deco = ghost.to > ghost.from ? Decoration.replace({ widget }).range(ghost.from, ghost.to) : Decoration.widget({ widget, side: 1 }).range(ghost.from);
  return Decoration.set([deco]);
};

const ghostField = StateField.define({
  create: () => null,
  update(ghost, tr) {
    for (const effect of tr.effects) if (effect.is(setGhost)) return effect.value;
    if (ghost && (tr.docChanged || (tr.selection && !tr.selection.eq(tr.startState.selection)))) return null;
    return ghost;
  },
  provide: (field) => EditorView.decorations.from(field, ghostDecorations),
});

export const currentGhost = (state) => state.field(ghostField, false) ?? null;

// Wo steht der Cursor, und was darf dort vorgeschlagen werden? null heißt: hier nichts vorschlagen.
export function readCursor(state, manual = false) {
  const { ranges, main } = state.selection;
  if (ranges.length > 1 || !main.empty) return null;
  const pos = main.head;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const after = line.text.slice(pos - line.from);
  if (/^[\w$]/.test(after)) return null;

  const code = state.doc.toString();
  const previousLine = line.number > 1 ? state.doc.line(line.number - 1).text : '';
  const base = { pos, lineEnd: line.to, before, after, previousLine, doc: state.doc, code, suffix: code.slice(pos) };

  if (isInComment(state, pos)) {
    const comment = before.match(/\/\/(.*)$/)?.[1];
    if (comment === undefined || after.trim()) return null;
    if (!manual && comment.replace(/[^\p{L}\p{N}]/gu, '').length < 3) return null;
    // Steht direkt darunter schon Code, wird der Kommentar nur nachträglich bearbeitet.
    const next = line.number < state.doc.lines ? state.doc.line(line.number + 1).text : '';
    if (next.trim()) return null;
    return { ...base, mode: 'comment', comment, lead: '\n', multiline: true, previousLine: before, prefix: `${code.slice(0, pos)}\n`, delay: COMMENT_DELAY };
  }

  if (!before.trim() && !after.trim()) {
    if (!manual && !code.slice(0, pos).trim()) return null;
    return { ...base, mode: 'block', comment: previousLine.match(/\/\/(.*)$/)?.[1] ?? '', lead: '', multiline: true, prefix: code.slice(0, pos), delay: TYPING_DELAY };
  }

  if (!manual && !before.trim()) return null;
  return { ...base, mode: 'inline', lead: '', multiline: false, prefix: code.slice(0, pos), delay: TYPING_DELAY };
}

const isSyntax = (diagnostic) => diagnostic.message.startsWith('Syntaxfehler');

// Passt der Vorschlag in den Code? Automatisch geschlossene Klammern hinter dem Cursor dürfen dabei
// ersetzt werden, wenn die Antwort sie schon mitbringt. Der vorhandene Linter kennt alle Sounds und Methoden.
export function fitSuggestion(code, cursor, text) {
  const { pos, lineEnd } = cursor;
  const check = (to) => {
    const diagnostics = analyse(code.slice(0, pos) + text + code.slice(to));
    return { to, syntax: diagnostics.find(isSyntax), diagnostics };
  };
  let result = check(pos);
  if (result.syntax && lineEnd > pos && /^[\s)\]}"'`;,]*$/.test(code.slice(pos, lineEnd))) {
    const replaced = check(lineEnd);
    if (!replaced.syntax) result = replaced;
  }
  const end = pos + text.length;
  if (result.syntax) {
    const wasBroken = analyse(code).some(isSyntax);
    if (!wasBroken || (result.syntax.from >= pos && result.syntax.from < end)) return { to: pos, problems: [result.syntax.message] };
    return { to: result.to, problems: [] };
  }
  const problems = result.diagnostics.filter((d) => d.from < end && d.to > pos).map((d) => d.message);
  return { to: result.to, problems };
}

function acceptText(view, ghost, text) {
  const rest = ghost.text.slice(text.length);
  const end = ghost.from + text.length;
  view.dispatch({
    changes: { from: ghost.from, to: rest ? ghost.from : ghost.to, insert: text },
    selection: { anchor: end },
    userEvent: 'input.ai',
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
    effects: setGhost.of(rest ? { from: end, to: end + ghost.to - ghost.from, text: rest } : null),
  });
  return true;
}

const shouldRequest = (update) =>
  update.transactions.some((tr) => tr.isUserEvent('input') && !tr.isUserEvent('input.paste') && !tr.isUserEvent('input.drop') && !tr.isUserEvent('input.ai'));

export function createAssist({ isReady = () => true, onAssistStatus = () => {} }) {
  const controller = {
    config: { enabled: true, url: '', model: '' },
    configure,
    listModels: () => window.desktop.ai.models(),
    ghost: currentGhost,
  };
  let autoModel = null;
  let offlineUntil = 0;
  let requestCounter = 0;
  let status = { state: 'idle' };

  const STATUS_TEXT = {
    off: 'KI aus',
    idle: 'KI an',
    thinking: 'KI denkt …',
    loading: 'KI lädt Modell …',
    suggestion: 'Tab übernimmt · Esc verwirft',
    offline: 'KI: Ollama nicht erreichbar',
    model: 'KI: Modell nicht gefunden',
  };
  let loading = false;
  const showStatus = () => onAssistStatus({ state: loading ? 'loading' : status.state, text: STATUS_TEXT[loading ? 'loading' : status.state] });
  const setStatus = (state) => {
    status = { state };
    showStatus();
  };
  window.desktop.ai.onLoading((value) => {
    loading = value;
    showStatus();
  });

  const configReady = window.desktop.ai.config().then((config) => {
    controller.config = config;
    setStatus(config.enabled ? 'idle' : 'off');
  });

  async function configure(patch) {
    controller.config = await window.desktop.ai.setConfig(patch);
    autoModel = null;
    offlineUntil = 0;
    setStatus(controller.config.enabled ? 'idle' : 'off');
  }

  async function resolveModel() {
    if (controller.config.model) return controller.config.model;
    if (autoModel) return autoModel;
    const result = await window.desktop.ai.models();
    if (!result.ok) return { failed: result.reason };
    if (!result.models.length) return { failed: 'model' };
    // Code-Modelle antworten hier am schnellsten und halten sich am besten ans Format.
    autoModel = result.models.find((name) => /cod(e|ing)/i.test(name)) ?? result.models[0];
    return autoModel;
  }

  const trigger = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.timer = null;
        this.thinkingTimer = null;
        this.activeId = null;
      }

      update(update) {
        const moved = update.selectionSet && !update.state.selection.eq(update.startState.selection);
        if (update.docChanged || moved) this.cancel();
        if (update.docChanged && shouldRequest(update) && controller.config.enabled && isReady() && Date.now() >= offlineUntil) {
          const cursor = readCursor(update.state);
          if (cursor) this.timer = setTimeout(() => this.request(false), cursor.delay);
        }
        if (currentGhost(update.startState) && !currentGhost(update.state) && status.state === 'suggestion') setStatus('idle');
      }

      cancel() {
        clearTimeout(this.timer);
        clearTimeout(this.thinkingTimer);
        if (this.activeId !== null) {
          window.desktop.ai.cancel(this.activeId);
          this.activeId = null;
          setStatus('idle');
        }
      }

      destroy() {
        this.cancel();
      }

      async request(manual) {
        this.cancel();
        await configReady;
        const { view } = this;
        const cursor = readCursor(view.state, manual);
        if (!cursor) return;
        const id = `req-${++requestCounter}`;
        this.activeId = id;
        const stale = () => this.activeId !== id || view.state.doc !== cursor.doc;

        this.thinkingTimer = setTimeout(() => setStatus('thinking'), THINKING_DELAY);
        const finish = (state) => {
          clearTimeout(this.thinkingTimer);
          this.activeId = null;
          setStatus(state);
        };

        const model = await resolveModel();
        if (stale()) return;
        if (model.failed) return this.fail(model.failed, finish);

        let messages = buildMessages({ prefix: cursor.prefix, suffix: cursor.suffix, comment: cursor.comment });
        const stop = cursor.multiline ? ['\n\n'] : ['\n'];
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await window.desktop.ai.complete({ id, model, messages, stop, temperature: attempt ? 0.4 : 0.2, maxTokens: 200 });
          if (stale()) return;
          if (!result.ok) return this.fail(result.reason, finish);

          const text = cleanSuggestion(result.text, { ...cursor, truncated: result.truncated });
          if (!text) return finish('idle');
          const duplicate = cursor.multiline && text.split('\n').every((line) => cursor.code.includes(line));
          if (duplicate) return finish('idle');

          const full = cursor.lead + text;
          const { to, problems } = fitSuggestion(cursor.code, cursor, full);
          if (!problems.length) {
            finish('suggestion');
            view.dispatch({ effects: setGhost.of({ from: cursor.pos, to, text: full }) });
            return;
          }
          messages = retryMessages(messages, result.text, problems);
        }
        finish('idle');
      }

      fail(reason, finish) {
        if (reason === 'offline') offlineUntil = Date.now() + OFFLINE_PAUSE;
        finish(reason === 'offline' || reason === 'model' ? reason : 'idle');
      }
    },
  );

  const withGhost = (run) => (view) => {
    const ghost = currentGhost(view.state);
    return ghost && completionStatus(view.state) !== 'active' ? run(view, ghost) : false;
  };

  const assistKeymap = keymap.of([
    { key: 'Tab', run: withGhost((view, ghost) => acceptText(view, ghost, ghost.text)) },
    {
      key: 'Escape',
      run: withGhost((view) => {
        view.dispatch({ effects: setGhost.of(null) });
        return true;
      }),
    },
    {
      key: 'Mod-ArrowRight',
      run: (view) => {
        // Hier auch bei offener Liste: Tab gehört dann der Liste, und so bleibt der Vorschlag erreichbar.
        const ghost = currentGhost(view.state);
        if (!ghost) return false;
        const word = ghost.text.match(/^\s*(?:[\w$]+|[^\w\s$]+)/)?.[0] ?? ghost.text;
        return acceptText(view, ghost, word);
      },
    },
    {
      key: 'Mod-Shift-Space',
      preventDefault: true,
      run: (view) => {
        if (!controller.config.enabled) return false;
        offlineUntil = 0;
        view.plugin(trigger)?.request(true);
        return true;
      },
    },
  ]);

  controller.extension = [ghostField, trigger, Prec.highest(assistKeymap)];
  return controller;
}
