// Zugriff auf die Strudel-Funktionsdoku und eine gemeinsame Darstellung für Tooltips und Referenz.
import rawDocs from '../generated/strudel-docs.json';

export const docs = rawDocs;
export const docByName = new Map();
for (const doc of docs) {
  docByName.set(doc.name, doc);
  for (const syn of doc.synonyms) if (!docByName.has(syn)) docByName.set(syn, doc);
}

const strip = (html) => {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent ?? '';
};

export const plainDescription = (doc) => strip(doc.description).trim();

export const signature = (name, doc) => {
  const params = (doc?.params ?? []).map((p) => (p.optional ? `${p.name}?` : p.name));
  return `${name}(${params.join(', ')})`;
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// actions.preview / actions.insert machen Beispiele direkt ausprobierbar.
export function renderDoc(doc, { name = doc.name, compact = false, actions } = {}) {
  const root = el('div', 'doc');
  root.append(el('div', 'doc-sig', signature(name, doc)));
  const others = [doc.name, ...doc.synonyms].filter((n) => n !== name);
  if (others.length) root.append(el('div', 'doc-syn', `Auch: ${others.join(', ')}`));
  if (doc.description) {
    const desc = el('div', 'doc-desc');
    desc.innerHTML = doc.description;
    root.append(desc);
  }
  if (doc.params.length) {
    const table = el('div', 'doc-params');
    for (const p of doc.params) {
      const row = el('div', 'doc-param');
      row.append(el('code', '', p.name));
      if (p.type) row.append(el('span', 'doc-type', p.type));
      if (p.description) row.append(el('span', 'doc-param-desc', p.description));
      table.append(row);
    }
    root.append(table);
  }
  const examples = compact ? doc.examples.slice(0, 2) : doc.examples;
  for (const example of examples) {
    const box = el('div', 'doc-example');
    box.append(el('pre', '', example));
    if (actions) {
      const bar = el('div', 'doc-example-actions');
      const play = el('button', 'mini-btn', '▶ Anhören');
      play.onclick = () => actions.preview(example);
      bar.append(play);
      if (actions.insert) {
        const add = el('button', 'mini-btn', 'Einfügen');
        add.onclick = () => actions.insert(example);
        bar.append(add);
      }
      box.append(bar);
    }
    root.append(box);
  }
  return root;
}
