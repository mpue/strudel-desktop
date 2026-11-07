// Sample-Browser: Suche, Kategorien, Vorhören mit Wellenform, Varianten und Einfügen in den Code.
import { soundMap } from '@strudel/webaudio';
import { bankDisplayNames, packOfSound } from '../engine.js';
import { soundInfo } from '../code/catalog.js';
import { clear, h } from './dom.js';
import { openPackManager } from './packs.js';

const FILTERS = [
  { id: 'all', label: 'Alle' },
  { id: 'drums', label: 'Drums' },
  { id: 'machines', label: 'Maschinen' },
  { id: 'instruments', label: 'Instrumente' },
  { id: 'samples', label: 'Samples' },
  { id: 'synths', label: 'Synths' },
  { id: 'mine', label: 'Eigene' },
  { id: 'favorites', label: '★' },
];

const PACK_GROUP = {
  'uzu-drumkit': 'drums',
  mridangam: 'drums',
  'drum-machines': 'machines',
  piano: 'instruments',
  vcsl: 'instruments',
  'dirt-samples': 'samples',
};

const FAVORITES_KEY = 'strudel-desktop:favorites';
const loadFavorites = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
};

function groupOf(key, data) {
  const pack = packOfSound.get(key);
  if (pack) {
    if (pack.startsWith('user:') || pack.startsWith('custom-')) return 'mine';
    return PACK_GROUP[pack] ?? 'samples';
  }
  if (data?.type === 'soundfont' || key.startsWith('gm_')) return 'instruments';
  if (data?.type === 'sample') return null; // Bank-Aliase nicht doppelt anzeigen
  return 'synths';
}

export function buildCatalog() {
  const items = [];
  for (const [key, entry] of Object.entries(soundMap.get())) {
    const group = groupOf(key, entry.data);
    if (!group) continue;
    const item = { key, group, label: key };
    if (group === 'machines') {
      const i = key.lastIndexOf('_');
      item.bank = bankDisplayNames.get(key.slice(0, i)) ?? key.slice(0, i);
      item.short = key.slice(i + 1);
    }
    items.push(item);
  }
  return items.sort((a, b) => a.key.localeCompare(b.key));
}

// Passt die Wellenform in die Canvas und zeichnet sie in der Theme-Farbe.
function drawWaveform(canvas, buffer) {
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio;
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  if (!buffer) return;
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / width));
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#fc0';
  for (let x = 0; x < width; x++) {
    let min = 1;
    let max = -1;
    for (let i = 0; i < step; i++) {
      const v = data[x * step + i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ctx.fillRect(x, ((1 + min) / 2) * height, 1, Math.max(1, ((max - min) / 2) * height));
  }
}

const firstUrl = (samples, n = 0) => {
  if (Array.isArray(samples)) return samples[n % samples.length];
  if (samples) return Object.values(samples)[0]?.[0];
  return null;
};

export function createSamplesPanel({ engine, insertSound }) {
  const favorites = loadFavorites();
  let catalog = [];
  let filter = 'all';
  let query = '';
  let selected = null;
  let variation = 0;
  let packNames = new Map();
  const openBanks = new Set();
  const audioContextForDecode = new OfflineAudioContext(1, 1, 44100);

  const list = h('div', { class: 'sound-list', role: 'listbox', 'aria-label': 'Sounds' });
  const detail = h('div', { class: 'sound-detail' });
  const search = h('input', {
    class: 'field',
    type: 'search',
    placeholder: 'Sound suchen … (z. B. kick, 909, flute)',
    'aria-label': 'Sound suchen',
    oninput: () => {
      query = search.value.trim().toLowerCase();
      renderList();
    },
  });
  const chips = h(
    'div',
    { class: 'chip-row' },
    FILTERS.map((f) =>
      h(
        'button',
        {
          class: `chip${f.id === filter ? ' active' : ''}`,
          dataset: { filter: f.id },
          onclick: () => {
            filter = f.id;
            chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === f.id));
            renderList();
          },
        },
        f.label,
      ),
    ),
  );
  const count = h('span', { class: 'muted' });

  const root = h(
    'div',
    { class: 'panel panel-samples' },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', {}, 'Samples'),
      h('button', { class: 'mini-btn', onclick: () => openPackManager({ onChanged: refresh }) }, 'Pakete & Ordner'),
    ),
    search,
    chips,
    count,
    list,
    detail,
  );

  const audition = (item, n = 0) => {
    const info = soundInfo(item.key);
    const needsNote = !info || info.type !== 'sample' || info.pitched;
    engine.auditionSound({ name: item.key, n, note: needsNote ? 'c3' : undefined, duration: needsNote ? 0.8 : 1 });
  };

  const matches = (item) => {
    if (filter === 'favorites') {
      if (!favorites.has(item.key)) return false;
    } else if (filter !== 'all' && item.group !== filter) return false;
    if (!query) return true;
    return query.split(/\s+/).every((word) => item.key.includes(word) || item.bank?.toLowerCase().includes(word));
  };

  const row = (item, label) => {
    const info = soundInfo(item.key);
    const fav = favorites.has(item.key);
    const node = h(
      'div',
      {
        class: `sound-row${selected?.key === item.key ? ' selected' : ''}`,
        role: 'option',
        draggable: true,
        title: 'Klick: anhören · Doppelklick: einfügen · In den Editor ziehen möglich',
        onclick: (e) => {
          select(item, e.currentTarget);
          audition(item);
        },
        ondblclick: () => insertSound(soundRef(item)),
        ondragstart: (e) => e.dataTransfer.setData('text/plain', codeFor(item)),
      },
      h('span', { class: 'sound-name' }, label ?? item.key),
      info?.count > 1 ? h('span', { class: 'badge', title: info.pitched ? 'Töne' : 'Varianten' }, info.count) : null,
      h(
        'button',
        {
          class: `star${fav ? ' on' : ''}`,
          title: fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten',
          'aria-label': fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten',
          onclick: (e) => {
            e.stopPropagation();
            if (favorites.has(item.key)) favorites.delete(item.key);
            else favorites.add(item.key);
            localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
            renderList();
          },
        },
        fav ? '★' : '☆',
      ),
    );
    return node;
  };

  function renderList() {
    clear(list);
    const visible = catalog.filter(matches);
    count.textContent = `${visible.length} Sounds`;
    const banks = new Map();
    const plain = [];
    for (const item of visible) {
      if (item.bank) (banks.get(item.bank) ?? banks.set(item.bank, []).get(item.bank)).push(item);
      else plain.push(item);
    }
    // Einzelne Sounds zuerst, die vielen Drum-Maschinen danach als aufklappbare Gruppen.
    list.append(...plain.map((item) => row(item)));
    for (const [bank, sounds] of banks) {
      const open = openBanks.has(bank) || !!query;
      const head = h(
        'button',
        {
          class: 'bank-head',
          'aria-expanded': String(open),
          onclick: () => {
            if (openBanks.has(bank)) openBanks.delete(bank);
            else openBanks.add(bank);
            renderList();
          },
        },
        h('span', { class: 'caret' }, open ? '▾' : '▸'),
        h('span', { class: 'sound-name' }, bank),
        h('span', { class: 'badge' }, sounds.length),
      );
      list.append(h('div', { class: 'bank' }, head, open ? h('div', { class: 'bank-body' }, sounds.map((s) => row(s, s.short))) : null));
    }
    if (!visible.length) {
      list.append(h('div', { class: 'muted pad' }, filter === 'favorites' ? 'Noch keine Favoriten. Markiere Sounds mit dem Stern.' : 'Nichts gefunden.'));
    }
  }

  const soundRef = (item) => ({ name: item.bank ? item.short : item.key, bank: item.bank, n: variation || 0, pitched: needsPitch(item) });
  const needsPitch = (item) => {
    const info = soundInfo(item.key);
    return !info || info.type !== 'sample' || info.pitched;
  };
  const codeFor = (item) => {
    const n = selected?.key === item.key && variation ? `:${variation}` : '';
    const name = item.bank ? item.short : item.key;
    const bank = item.bank ? `.bank("${item.bank}")` : '';
    return needsPitch(item) ? `$: note("c3 e3 g3 c4").s("${name}${n}")${bank}` : `$: s("${name}${n}")${bank}`;
  };

  function select(item, node) {
    selected = item;
    variation = 0;
    list.querySelectorAll('.sound-row.selected').forEach((n) => n.classList.remove('selected'));
    node.classList.add('selected');
    renderDetail();
  }

  function renderDetail() {
    clear(detail);
    if (!selected) {
      detail.append(h('p', { class: 'muted pad' }, 'Klick auf einen Sound spielt ihn ab. Doppelklick oder „Einfügen“ schreibt ihn in den Code.'));
      return;
    }
    const item = selected;
    const info = soundInfo(item.key);
    const canvas = h('canvas', { class: 'waveform', 'aria-hidden': 'true' });
    const code = h('code', { class: 'sound-code' }, codeFor(item));
    const fileLabel = h('div', { class: 'muted small' });
    const meta = [info?.type === 'sample' ? 'Sample' : info?.type === 'soundfont' ? 'GM-Soundfont' : 'Synth', packNames.get(info?.pack)].filter(Boolean).join(' · ');
    detail.append(
      h('div', { class: 'sound-title' }, h('strong', {}, item.bank ? `${item.bank} · ${item.short}` : item.key), h('span', { class: 'muted small' }, meta)),
      info?.samples ? canvas : null,
      fileLabel,
    );
    if (info?.type === 'sample' && !info.pitched && info.count > 1) {
      const variants = h(
        'div',
        { class: 'variants' },
        Array.from({ length: Math.min(info.count, 48) }, (_, i) =>
          h(
            'button',
            {
              class: `chip${i === variation ? ' active' : ''}`,
              onclick: (e) => {
                variation = i;
                variants.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
                e.currentTarget.classList.add('active');
                code.textContent = codeFor(item);
                audition(item, i);
                showWave(i);
              },
            },
            i,
          ),
        ),
      );
      detail.append(variants);
    }
    detail.append(
      code,
      h(
        'div',
        { class: 'detail-actions' },
        h('button', { class: 'mini-btn', onclick: () => audition(item, variation) }, '▶ Anhören'),
        h('button', { class: 'mini-btn btn-primary', onclick: () => insertSound(soundRef(item)) }, 'Einfügen'),
      ),
    );

    const showWave = async (n) => {
      const url = firstUrl(info?.samples, n);
      if (!url) return;
      const name = decodeURIComponent(url.split('/').pop());
      fileLabel.textContent = name;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error();
        const buffer = await audioContextForDecode.decodeAudioData(await res.arrayBuffer());
        if (selected !== item) return;
        drawWaveform(canvas, buffer);
        fileLabel.textContent = `${name} · ${buffer.duration.toFixed(2)} s`;
      } catch {
        if (selected === item) fileLabel.textContent = `${name} · nicht lokal vorhanden, Download nicht möglich`;
      }
    };
    showWave(0);
  }

  async function refresh() {
    catalog = buildCatalog();
    packNames = new Map((await window.desktop.packs.list()).map((p) => [p.id, p.name]));
    renderList();
    renderDetail();
  }

  renderDetail();
  return { root, refresh, focus: () => search.focus() };
}
