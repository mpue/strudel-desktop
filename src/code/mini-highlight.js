// Färbt Mini-Notation innerhalb von Strings ein: Pausen, Klammern, Operatoren, Zahlen.
// Wörter behalten die String-Farbe des Themes.
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';

const marks = {
  bracket: Decoration.mark({ class: 'cm-mini-bracket' }),
  op: Decoration.mark({ class: 'cm-mini-op' }),
  rest: Decoration.mark({ class: 'cm-mini-rest' }),
  num: Decoration.mark({ class: 'cm-mini-num' }),
};

const TOKEN = /([[\]<>{}()])|([*/!@?:,|%^])|(~|(?<![\w.])-(?![\w.]))|((?<![\w#])-?\d+(?:\.\d+)?(?![\w#]))/g;

function build(view) {
  const builder = new RangeSetBuilder();
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'String' && node.name !== 'TemplateString') return;
        const quote = state.sliceDoc(node.from, node.from + 1);
        if (quote === "'") return false;
        const text = state.sliceDoc(node.from + 1, node.to - 1);
        const offset = node.from + 1;
        for (const m of text.matchAll(TOKEN)) {
          const start = offset + m.index;
          const end = start + m[0].length;
          const mark = m[1] ? marks.bracket : m[2] ? marks.op : m[3] ? marks.rest : marks.num;
          builder.add(start, end, mark);
        }
        return false;
      },
    });
  }
  return builder.finish();
}

export const miniHighlight = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = build(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
