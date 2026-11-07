// Ermittelt aus dem Syntaxbaum, wo im Strudel-Code der Cursor gerade steht.
import { syntaxTree } from '@codemirror/language';

// Name der aufgerufenen Funktion zu einem CallExpression-Knoten.
export function calleeName(state, call) {
  const callee = call.firstChild;
  if (!callee) return null;
  if (callee.name === 'VariableName') return state.sliceDoc(callee.from, callee.to);
  if (callee.name === 'MemberExpression') {
    const prop = callee.getChild('PropertyName');
    return prop ? state.sliceDoc(prop.from, prop.to) : null;
  }
  return null;
}

export function enclosingCall(state, pos, side = -1) {
  let node = syntaxTree(state).resolveInner(pos, side);
  while (node) {
    if (node.name === 'ArgList' && pos > node.from && pos <= node.to) {
      const call = node.parent;
      if (call?.name === 'CallExpression') {
        return { call, args: node, name: calleeName(state, call), argIndex: argIndexAt(state, node, pos) };
      }
    }
    node = node.parent;
  }
  return null;
}

function argIndexAt(state, args, pos) {
  let index = 0;
  for (let child = args.firstChild; child && child.from < pos; child = child.nextSibling) {
    if (child.name === ',') index += 1;
  }
  return index;
}

export function stringAt(state, pos) {
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (node.name === 'String' || node.name === 'TemplateString') {
      if (pos <= node.from || (pos >= node.to && isClosed(state, node))) return null;
      return node;
    }
    node = node.parent;
  }
  return null;
}

function isClosed(state, node) {
  const open = state.sliceDoc(node.from, node.from + 1);
  return node.to - node.from > 1 && state.sliceDoc(node.to - 1, node.to) === open;
}

export function isInComment(state, pos) {
  const node = syntaxTree(state).resolveInner(pos, -1);
  return node.name === 'LineComment' || node.name === 'BlockComment';
}

export const levenshtein = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
};

export function closest(word, candidates, maxDistance = 2) {
  const lower = word.toLowerCase();
  let best = null;
  let bestDist = Math.min(maxDistance, Math.floor(word.length / 2) || 1) + 1;
  for (const candidate of candidates) {
    const d = levenshtein(lower, candidate.toLowerCase());
    if (d < bestDist) {
      best = candidate;
      bestDist = d;
    }
  }
  return best;
}
