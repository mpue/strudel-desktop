// Kontextbezogene Vervollständigung: Funktionen, Sounds, Bänke, Tonleitern, Akkorde, Voicings.
import { autocompletion, completionKeymap, acceptCompletion } from '@codemirror/autocomplete';
import { localCompletionSource } from '@codemirror/lang-javascript';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { Pattern } from '@strudel/core';
import { complex } from '@strudel/tonal';
import { Scale } from '@tonaljs/tonal';
import { docs, plainDescription, renderDoc, signature } from './docs.js';
import { enclosingCall, isInComment, stringAt } from './context.js';
import { bankNames, soundInfo, soundNames } from './catalog.js';

const ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ae', 'aa', 'oe', 'ue', 'y', 'uh', 'un', 'en', 'an', 'on'];
const MODES = ['below', 'above', 'duck', 'root'];
const DICTS = ['ireal', 'lefthand', 'triads', 'guidetones', 'legacy'];

// Häufige Funktionen zuerst, sonst dominieren selten genutzte Parameter die Liste.
const POPULAR = new Set(
  (
    's sound note n stack cat seq fast slow rev gain lpf hpf delay room pan speed bank scale chord voicing every sometimes off jux ' +
    'struct euclid arrange setcpm setcps sine saw rand perlin range segment add sub mul clip attack decay sustain release pianoroll ' +
    'ply chop iter palindrome degrade degradeBy mask layer superimpose arp samples hush'
  ).split(' '),
);

// Erzeuger stehen am Anfang eines Ausdrucks, alles andere ist typischerweise eine Pattern-Methode.
const isSignal = (doc) => doc.category === 'Signale & Zufall' && !doc.params.length;

const docItem = (doc, label, afterDot) => ({
  label,
  type: isSignal(doc) ? 'constant' : afterDot ? 'method' : 'function',
  detail: signature(label, doc).slice(label.length),
  boost: POPULAR.has(label) ? 20 : doc.examples.length ? 1 : 0,
  info: () => {
    const dom = renderDoc(doc, { name: label, compact: true });
    dom.classList.add('doc-tooltip');
    return dom;
  },
  apply: (view, completion, from, to) => {
    const hasParen = view.state.sliceDoc(to, to + 1) === '(';
    const noParens = !afterDot && isSignal(doc);
    const insert = hasParen || noParens ? label : `${label}()`;
    const cursor = from + (hasParen || noParens ? label.length : label.length + 1);
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: cursor }, userEvent: 'input.complete' });
  },
});

const globalItems = [];
const methodItems = [];
for (const doc of docs) {
  for (const label of [doc.name, ...doc.synonyms]) {
    if (!/^[\w$]+$/.test(label)) continue;
    globalItems.push(docItem(doc, label, false));
    methodItems.push(docItem(doc, label, true));
  }
}
const documented = new Set(methodItems.map((i) => i.label));

// Auch Methoden ohne Doku anbieten, damit nichts fehlt.
const undocumentedMethods = () =>
  Object.getOwnPropertyNames(Pattern.prototype)
    .filter((n) => /^[a-zA-Z]\w*$/.test(n) && !documented.has(n))
    .map((label) => ({
      label,
      type: 'method',
      apply: (view, _c, from, to) =>
        view.dispatch({ changes: { from, to, insert: `${label}()` }, selection: { anchor: from + label.length + 1 } }),
    }));

const keywordItems = [
  { label: '$:', type: 'keyword', detail: ' Eigene Spur starten', apply: '$: ', boost: 15 },
  { label: '_$:', type: 'keyword', detail: ' Spur stummschalten', apply: '_$: ' },
  { label: 'await', type: 'keyword' },
  { label: 'const', type: 'keyword' },
  { label: 'let', type: 'keyword' },
];

const SOUND_DETAIL = { sample: 'Sample', synth: 'Synth', soundfont: 'GM-Soundfont', wavetable: 'Wavetable' };

const soundItem = (name) => {
  const info = soundInfo(name);
  const countLabel = info?.count > 1 ? ` · ${info.count}${info.pitched ? ' Töne' : ' Varianten'}` : '';
  return {
    label: name,
    type: 'sound',
    detail: `${SOUND_DETAIL[info?.type] ?? info?.type ?? ''}${countLabel}`,
    boost: name.includes('_') ? 0 : 5,
  };
};

// Letztes Wort innerhalb eines Mini-Notation-Strings.
const miniFragment = (state, node, pos) => {
  const inner = state.sliceDoc(node.from + 1, pos);
  const m = inner.match(/[\w#^+-]*$/);
  return { text: m[0], from: pos - m[0].length, inner };
};

function stringCompletion(context, node) {
  const { state, pos } = context;
  const call = enclosingCall(state, pos);
  if (!call?.name) return null;
  const { text, from, inner } = miniFragment(state, node, pos);
  const validFor = /^[\w#^+-]*$/;

  switch (call.name) {
    case 's':
    case 'sound': {
      // Nach ":" folgt die Sample-Nummer, dort gibt es nichts zu ergänzen.
      if (/:\w*$/.test(inner)) return null;
      return { from, options: soundNames().map(soundItem), validFor };
    }
    case 'bank':
      return { from, options: bankNames().map((label) => ({ label, type: 'bank', detail: 'Drum-Maschine' })), validFor };
    case 'scale': {
      const afterColon = inner.match(/([A-Ga-g][#b]?\d*):([\w:-]*)$/);
      if (afterColon) {
        const frag = afterColon[2];
        const options = Scale.names().map((n) => ({ label: n.replace(/\s+/g, ':'), type: 'scale', detail: 'Tonleiter' }));
        return { from: pos - frag.length, options, validFor: /^[\w:-]*$/ };
      }
      if (!context.explicit && !text) return null;
      return {
        from,
        options: ROOTS.map((r) => ({ label: `${r}:`, type: 'pitch', detail: 'Grundton' })),
        validFor: /^[\w#]*:?$/,
      };
    }
    case 'chord': {
      const rooted = text.match(/^([A-Ga-g][#b]?)(.*)$/);
      if (rooted) {
        const start = from + rooted[1].length;
        const options = Object.keys(complex)
          .sort()
          .map((sym) => ({ label: sym, type: 'chord', detail: 'Akkordsymbol' }));
        return { from: start, options, validFor: /^[\w#^+-]*$/ };
      }
      return { from, options: ROOTS.map((r) => ({ label: r, type: 'pitch', detail: 'Grundton' })), validFor };
    }
    case 'mode':
      return { from, options: MODES.map((label) => ({ label, type: 'mode' })), validFor };
    case 'dict':
      return { from, options: DICTS.map((label) => ({ label, type: 'dict' })), validFor };
    case 'vowel':
      return { from, options: VOWELS.map((label) => ({ label, type: 'vowel' })), validFor };
    default:
      return null;
  }
}

export function strudelCompletion(context) {
  const { state, pos } = context;
  if (isInComment(state, pos)) return null;

  const str = stringAt(state, pos);
  if (str) return stringCompletion(context, str);

  const before = context.matchBefore(/\.[\w$]*$/);
  if (before) {
    const prev = state.sliceDoc(before.from - 1, before.from);
    // Zahlen wie "0.5" sind keine Methodenaufrufe.
    if (/\d/.test(prev) && !/[\w)\]"'`]\s*$/.test(state.sliceDoc(before.from - 2, before.from - 1))) return null;
    return { from: before.from + 1, options: [...methodItems, ...undocumentedMethods()], validFor: /^[\w$]*$/ };
  }

  const word = context.matchBefore(/[\w$]+/);
  if (!word && !context.explicit) return null;
  const from = word ? word.from : pos;
  const local = localCompletionSource(context);
  const localOptions = (local?.options ?? []).map((o) => ({ ...o, boost: 30 }));
  return { from, options: [...localOptions, ...keywordItems, ...globalItems], validFor: /^[\w$]*$/ };
}

export const strudelAutocomplete = [
  autocompletion({
    override: [strudelCompletion],
    closeOnBlur: false,
    activateOnTyping: true,
    defaultKeymap: true,
    icons: true,
    addToOptions: [
      {
        render: () => null,
        position: 90,
      },
    ],
  }),
  Prec.high(keymap.of([{ key: 'Tab', run: acceptCompletion }, ...completionKeymap])),
];

export { plainDescription };
