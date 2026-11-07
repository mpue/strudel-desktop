// Prüft Strudel-Code schon beim Tippen: JS-Syntax, Mini-Notation, Sounds, Bänke und Funktionsnamen.
import { forceLinting, linter, lintGutter } from '@codemirror/lint';
import { parse } from 'acorn';
import { full as walkFull } from 'acorn-walk';
import { Pattern } from '@strudel/core';
import { getLeafLocation, getLeaves, parse as parseMini } from '@strudel/mini';
import { closest } from './context.js';
import { docByName } from './docs.js';
import { bankNames, bankSounds, isKnownSound, soundNames } from './catalog.js';

const replaceAction = (name, from, to) => ({
  name: `Ersetzen durch „${name}“`,
  apply: (view) => view.dispatch({ changes: { from, to, insert: name } }),
});

const fixDiag = (from, to, severity, message, suggestion) => ({
  from,
  to,
  severity,
  message: suggestion ? `${message} Meintest du „${suggestion}“?` : message,
  source: 'Strudel',
  actions: suggestion ? [replaceAction(suggestion, from, to)] : [],
});

// Mini-Notation immer in doppelten Anführungszeichen parsen, so bleiben Positionen deckungsgleich mit dem Code.
const quoted = (code, node) => `"${code.slice(node.start + 1, node.end - 1)}"`;

// Wörter eines Mini-Notation-Strings mit Position im Dokument.
function miniLeaves(code, node) {
  const source = quoted(code, node);
  return getLeaves(source, node.start, code).map((leaf) => {
    const [from, to] = getLeafLocation(source, leaf, node.start);
    return { word: String(leaf.source_), from, to };
  });
}

const friendlyMiniError = (err) => {
  const found = err.found === null || err.found === undefined ? 'das Ende des Strings' : `„${err.found}“`;
  return `Unerwartet: ${found}. Prüfe Klammern und Operatoren.`;
};

const REST = new Set(['~', '-', '_', '.', '']);

const isStrudelString = (node) =>
  (node.type === 'Literal' && typeof node.value === 'string' && node.raw[0] === '"') ||
  (node.type === 'TemplateLiteral' && node.quasis.length === 1);

// Diese Funktionen legt die REPL erst beim ersten Ausführen an. Vorher sind sie kein Tippfehler.
const REPL_GLOBALS = new Set(['setcps', 'setCps', 'setcpm', 'setCpm', 'hush', 'all', 'each']);

const CHAIN_ROOTS_IGNORED = new Set(['Math', 'console', 'Object', 'Array', 'JSON', 'Number', 'String', 'window', 'document', 'Promise', 'Date']);

function chainRoot(node) {
  let current = node;
  while (current) {
    if (current.type === 'CallExpression') current = current.callee;
    else if (current.type === 'MemberExpression') current = current.object;
    else return current;
  }
  return null;
}

// Hat die Kette an irgendeiner Stelle einen .bank()-Aufruf?
function hasBankInChain(node, parents) {
  for (const parent of parents) {
    if (parent.type === 'MemberExpression' && parent.property?.name === 'bank') return true;
  }
  let current = node;
  while (current) {
    if (current.type === 'MemberExpression' && current.property?.name === 'bank') return true;
    current = current.type === 'CallExpression' ? current.callee : current.type === 'MemberExpression' ? current.object : null;
  }
  return false;
}

export function analyse(code) {
  const diagnostics = [];
  let ast;
  try {
    ast = parse(code, { ecmaVersion: 2022, allowAwaitOutsideFunction: true, locations: true });
  } catch (err) {
    const pos = Math.min(err.pos ?? 0, code.length);
    const to = Math.min(pos + 1, code.length);
    const message = String(err.message).replace(/\s*\(\d+:\d+\)$/, '');
    diagnostics.push({ from: pos, to, severity: 'error', message: `Syntaxfehler: ${message}`, source: 'Strudel', actions: [] });
    return diagnostics;
  }

  // Definiert der Code eigene Sounds oder Namen, sind unbekannte Sounds vor dem Ausführen kein Fehler.
  const declaresSounds = /\b(samples|soundAlias|aliasBank|registerSound|registerSynth|loadSoundfont|loadOrc|csound)\s*\(/.test(code);

  // Hydra bringt eigene Globals und Methoden mit, die erst nach initHydra() existieren.
  const usesHydra = /\binitHydra\b/.test(code);

  const declared = new Set();
  walkFull(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') declared.add(node.id.name);
    if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern') {
      for (const p of node.id.properties) if (p.value?.name) declared.add(p.value.name);
    }
    if (node.type === 'VariableDeclarator' && node.id.type === 'ArrayPattern') {
      for (const e of node.id.elements) if (e?.name) declared.add(e.name);
    }
    if (node.type === 'FunctionDeclaration' && node.id) declared.add(node.id.name);
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
      for (const p of node.params) if (p.type === 'Identifier') declared.add(p.name);
    }
    if (node.type === 'ImportSpecifier' || node.type === 'ImportDefaultSpecifier') declared.add(node.local.name);
  });

  const miniErrors = new Set();
  walkFull(ast, (node) => {
    if (!isStrudelString(node)) return;
    try {
      parseMini(quoted(code, node));
    } catch (err) {
      const offset = err.location?.start?.offset ?? 0;
      const from = Math.min(node.start + offset, node.end - 1);
      miniErrors.add(node);
      diagnostics.push({
        from,
        to: Math.min(from + 1, node.end),
        severity: 'error',
        message: `Mini-Notation: ${friendlyMiniError(err)}`,
        source: 'Strudel',
        actions: [],
      });
    }
  });

  const checkSoundArg = (arg, inBank) => {
    if (declaresSounds || !arg || !isStrudelString(arg) || miniErrors.has(arg) || inBank) return;
    for (const { word, from } of miniLeaves(code, arg)) {
      const name = word.split(':')[0];
      if (REST.has(name) || /^\d/.test(name) || isKnownSound(name)) continue;
      diagnostics.push(fixDiag(from, from + name.length, 'warning', `Unbekannter Sound „${name}“.`, closest(name, soundNames())));
    }
  };

  const checkBankArg = (arg) => {
    if (declaresSounds || !isStrudelString(arg) || miniErrors.has(arg)) return;
    for (const { word, from } of miniLeaves(code, arg)) {
      if (REST.has(word) || bankSounds(word).length) continue;
      diagnostics.push(fixDiag(from, from + word.length, 'warning', `Unbekannte Drum-Maschine „${word}“.`, closest(word, bankNames(), 3)));
    }
  };

  const globals = globalThis;
  const reportedGlobals = new Set();

  const methodsOf = () => Object.getOwnPropertyNames(Pattern.prototype);
  const ancestorWalk = (node, parents) => {
    if (node.type !== 'CallExpression') return;
    const { callee } = node;
    if (callee.type === 'Identifier') {
      const name = callee.name;
      if (name === 's' || name === 'sound') {
        checkSoundArg(node.arguments[0], hasBankInChain(node, parents));
      }
      if (!usesHydra && !declared.has(name) && !(name in globals) && !REPL_GLOBALS.has(name) && !reportedGlobals.has(callee.start)) {
        reportedGlobals.add(callee.start);
        const names = [...docByName.keys()];
        diagnostics.push(fixDiag(callee.start, callee.end, 'warning', `Unbekannte Funktion „${name}“.`, closest(name, names)));
      }
      return;
    }
    if (callee.type !== 'MemberExpression' || callee.computed || !callee.property?.name) return;
    const method = callee.property.name;
    if (method === 's' || method === 'sound') checkSoundArg(node.arguments[0], hasBankInChain(node, parents));
    if (method === 'bank' && node.arguments[0]) checkBankArg(node.arguments[0]);

    const root = chainRoot(callee);
    const fromPattern =
      (root?.type === 'Identifier' && !CHAIN_ROOTS_IGNORED.has(root.name) && !declared.has(root.name) && root.name in globals) ||
      (root?.type === 'Literal' && root.raw?.[0] === '"');
    if (!usesHydra && fromPattern && !(method in Pattern.prototype) && !docByName.has(method)) {
      const prop = callee.property;
      diagnostics.push(fixDiag(prop.start, prop.end, 'warning', `Unbekannte Pattern-Methode „${method}“.`, closest(method, methodsOf())));
    }
  };

  walkAncestors(ast, ancestorWalk);
  return diagnostics.sort((a, b) => a.from - b.from);
}

// Reduzierter Ancestor-Walk, damit der Linter sehen kann, ob eine Kette später .bank() aufruft.
function walkAncestors(ast, visit) {
  const stack = [];
  const go = (node) => {
    if (!node || typeof node.type !== 'string') return;
    visit(node, stack);
    stack.push(node);
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach((v) => v && typeof v.type === 'string' && go(v));
      else if (value && typeof value.type === 'string') go(value);
    }
    stack.pop();
  };
  go(ast);
}

// Laufzeitfehler aus dem letzten Ausführen werden zusätzlich im Code angezeigt.
let lastEvalError = null;
let readyToCheck = () => true;

export const setLintReady = (fn) => {
  readyToCheck = fn;
};

function evalErrorDiagnostic(code) {
  if (!lastEvalError || lastEvalError.code !== code) return [];
  const { message } = lastEvalError;
  const match = message.match(/^(\w+) is not defined/) ?? message.match(/\.?(\w+) is not a function/);
  let from = 0;
  let to = Math.min(code.length, code.indexOf('\n') === -1 ? code.length : code.indexOf('\n'));
  if (match) {
    const idx = code.search(new RegExp(`\\b${match[1]}\\b`));
    if (idx >= 0) {
      from = idx;
      to = idx + match[1].length;
    }
  }
  return [{ from, to, severity: 'error', message: `Beim Ausführen: ${message}`, source: 'Strudel', actions: [] }];
}

export function reportEvalError(view, err) {
  lastEvalError = err ? { message: String(err.message ?? err), code: view.state.doc.toString() } : null;
  forceLinting(view);
}

export const strudelLinter = [
  linter(
    (view) => {
      if (!readyToCheck()) return [];
      const code = view.state.doc.toString();
      if (!code.trim()) return [];
      return [...analyse(code), ...evalErrorDiagnostic(code)];
    },
    { delay: 450 },
  ),
  lintGutter(),
];

