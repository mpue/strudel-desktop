// Tooltips: Doku beim Überfahren, Parameterhilfe beim Tippen, Sound-Infos in Strings.
import { hoverTooltip, showTooltip, EditorView } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import { completionStatus } from '@codemirror/autocomplete';
import { docByName, plainDescription, renderDoc } from './docs.js';
import { enclosingCall, stringAt, isInComment } from './context.js';
import { bankSounds, soundInfo } from './catalog.js';

const SOUND_CALLS = new Set(['s', 'sound']);

export function strudelHover(actions) {
  return hoverTooltip(
    (view, pos, side) => {
      const { state } = view;
      if (isInComment(state, pos)) return null;
      const line = state.doc.lineAt(pos);
      let start = pos;
      let end = pos;
      while (start > line.from && /[\w$]/.test(line.text[start - line.from - 1])) start--;
      while (end < line.to && /[\w$]/.test(line.text[end - line.from])) end++;
      if ((start === pos && side < 0) || (end === pos && side > 0) || start === end) return null;
      const word = state.sliceDoc(start, end);

      if (stringAt(state, pos)) {
        const call = enclosingCall(state, pos, side);
        if (call?.name === 'bank' && bankSounds(word).length) {
          return tooltip(start, end, () => bankTooltip(word, actions));
        }
        if (call && SOUND_CALLS.has(call.name) && soundInfo(word)) {
          return tooltip(start, end, () => soundTooltip(word, actions));
        }
        return null;
      }

      const doc = docByName.get(word);
      if (!doc) return null;
      return tooltip(start, end, () => {
        const dom = renderDoc(doc, { name: word, compact: true, actions });
        dom.classList.add('doc-tooltip');
        return dom;
      });
    },
    { hoverTime: 350 },
  );
}

const tooltip = (pos, end, create) => ({
  pos,
  end,
  above: true,
  create: () => ({ dom: create() }),
});

function soundTooltip(name, actions) {
  const info = soundInfo(name);
  const dom = document.createElement('div');
  dom.className = 'doc doc-tooltip';
  const title = document.createElement('div');
  title.className = 'doc-sig';
  title.textContent = name;
  dom.append(title);
  const meta = document.createElement('div');
  meta.className = 'doc-syn';
  const parts = [info.type];
  if (info.count > 1) parts.push(`${info.count} ${info.pitched ? 'Töne' : 'Varianten'}`);
  if (info.pack) parts.push(info.pack);
  meta.textContent = parts.join(' · ');
  dom.append(meta);
  const play = document.createElement('button');
  play.className = 'mini-btn';
  play.textContent = '▶ Anhören';
  play.onclick = () => actions.audition({ name, note: info.pitched || info.type !== 'sample' ? 'c3' : undefined });
  dom.append(play);
  return dom;
}

function bankTooltip(bank, actions) {
  const dom = document.createElement('div');
  dom.className = 'doc doc-tooltip';
  const title = document.createElement('div');
  title.className = 'doc-sig';
  title.textContent = bank;
  dom.append(title);
  const row = document.createElement('div');
  row.className = 'chip-row';
  for (const sound of bankSounds(bank)) {
    const chip = document.createElement('button');
    chip.className = 'mini-btn';
    chip.textContent = sound;
    chip.onclick = () => actions.audition({ name: `${bank}_${sound}` });
    row.append(chip);
  }
  dom.append(row);
  return dom;
}

// Parameterhilfe an der Cursorposition, solange man in den Klammern eines bekannten Aufrufs steht.
function signatureTooltip(state) {
  const { main } = state.selection;
  if (!main.empty || completionStatus(state) === 'active') return null;
  if (stringAt(state, main.head)) return null;
  const call = enclosingCall(state, main.head);
  if (!call?.name) return null;
  const doc = docByName.get(call.name);
  if (!doc || !doc.params.length) return null;
  return {
    pos: call.args.from,
    above: true,
    arrow: false,
    strictSide: true,
    create: () => {
      const dom = document.createElement('div');
      dom.className = 'sig-help';
      const sig = document.createElement('div');
      sig.className = 'sig-line';
      sig.append(`${call.name}(`);
      doc.params.forEach((p, i) => {
        if (i) sig.append(', ');
        const span = document.createElement('span');
        span.textContent = p.name;
        if (i === Math.min(call.argIndex, doc.params.length - 1)) span.className = 'sig-active';
        sig.append(span);
      });
      sig.append(')');
      dom.append(sig);
      const current = doc.params[Math.min(call.argIndex, doc.params.length - 1)];
      const text = current?.description || plainDescription(doc).split('\n')[0];
      if (text) {
        const hint = document.createElement('div');
        hint.className = 'sig-hint';
        hint.textContent = `${current?.type ? `${current.type} – ` : ''}${text}`;
        dom.append(hint);
      }
      return { dom };
    },
  };
}

export const signatureHelp = StateField.define({
  create: signatureTooltip,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    return signatureTooltip(tr.state);
  },
  provide: (f) => showTooltip.compute([f], (state) => state.field(f)),
});

export const wordAtCursor = (view) => {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  let start = pos;
  let end = pos;
  while (start > line.from && /[\w$]/.test(line.text[start - line.from - 1])) start--;
  while (end < line.to && /[\w$]/.test(line.text[end - line.from])) end++;
  return state.sliceDoc(start, end);
};

export const tooltipTheme = EditorView.baseTheme({
  '.cm-tooltip.cm-tooltip-hover, .cm-tooltip.cm-completionInfo': { maxWidth: '460px' },
});
