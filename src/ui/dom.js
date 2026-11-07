// Kleine DOM-Helfer und Dialoge. window.prompt gibt es in Electron nicht, deshalb eigene Dialoge.
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node[key.toLowerCase()] = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function modal({ title, body, actions, wide = false, onClose }) {
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const box = h(
    'div',
    { class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', {}, title),
    h('div', { class: 'modal-body' }, body),
    actions?.length ? h('div', { class: 'modal-actions' }, actions(close)) : null,
  );
  const backdrop = h('div', { class: 'modal-backdrop', onmousedown: (e) => e.target === backdrop && close() }, box);
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  return { close, box };
}

export function confirmDialog({ title, message, confirm = 'OK', cancel = 'Abbrechen', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const dialog = modal({
      title,
      body: h('p', {}, message),
      onClose: () => resolve(result),
      actions: () => {},
    });
    dialog.box.querySelector('.modal-body').after(
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { onclick: () => dialog.close() }, cancel),
        h(
          'button',
          {
            class: danger ? 'btn-danger' : 'btn-primary',
            onclick: () => {
              result = true;
              dialog.close();
            },
          },
          confirm,
        ),
      ),
    );
    dialog.box.querySelector(danger ? '.btn-danger' : '.btn-primary').focus();
  });
}

export function promptDialog({ title, label, value = '', confirm = 'OK', type = 'text', min, max }) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input', { type, value, min, max, class: 'field' });
    const submit = () => {
      result = input.value.trim();
      dialog.close();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') submit();
    };
    const dialog = modal({
      title,
      body: h('label', { class: 'field-label' }, label, input),
      onClose: () => resolve(result),
    });
    dialog.box.append(
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { onclick: () => dialog.close() }, 'Abbrechen'),
        h('button', { class: 'btn-primary', onclick: submit }, confirm),
      ),
    );
    input.focus();
    input.select();
  });
}

let toastTimer;
export function toast(message, kind = 'info') {
  document.querySelector('.toast')?.remove();
  const node = h('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 3500);
}

export const formatBytes = (bytes) => {
  if (!bytes) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
};
