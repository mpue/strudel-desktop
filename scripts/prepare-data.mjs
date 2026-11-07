// Holt alles, was die App zur Laufzeit lokal braucht, einmalig aus dem Netz:
//  - Sample-Maps (welche Samples es gibt und wo sie liegen)
//  - Basis-Samples, die fest mit der App ausgeliefert werden
//  - Strudel-Funktionsdoku aus dem Build von @strudel/codemirror
// Das Ergebnis liegt in resources/ und src/generated/ und wird eingecheckt.
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const mapDir = path.join(root, 'resources/sample-maps');
const bundledDir = path.join(root, 'resources/bundled');
const dough = 'https://raw.githubusercontent.com/felixroos/dough-samples/main';

const PACKS = [
  {
    id: 'uzu-drumkit',
    name: 'Uzu Drumkit',
    description: 'Das Standard-Drumkit von strudel.cc (bd, sd, hh, cp, ...). Fest in der App enthalten.',
    license: 'siehe tidalcycles/uzu-drumkit',
    source: 'https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main/strudel.json',
    repo: 'tidalcycles/uzu-drumkit',
    bundled: true,
    category: 'drums',
  },
  {
    id: 'piano',
    name: 'Salamander Piano',
    description: 'Konzertflügel über alle Oktaven. Fest in der App enthalten.',
    license: 'CC-BY 3.0 (Salamander Grand Piano)',
    source: `${dough}/piano.json`,
    repo: 'felixroos/dough-samples',
    bundled: true,
    category: 'instruments',
  },
  {
    id: 'mridangam',
    name: 'Mridangam',
    description: 'Südindische Trommel.',
    license: 'siehe yaxu/mrid',
    source: `${dough}/mridangam.json`,
    repo: 'yaxu/mrid',
    recommended: true,
    category: 'drums',
  },
  {
    id: 'drum-machines',
    name: 'Tidal Drum Machines',
    description: 'Über 70 klassische Drumcomputer, z. B. TR-808, TR-909, LinnDrum. Nutzung mit .bank("RolandTR909").',
    license: 'siehe ritchse/tidal-drum-machines',
    source: `${dough}/tidal-drum-machines.json`,
    repo: 'ritchse/tidal-drum-machines',
    recommended: true,
    bundledPrefixes: ['RolandTR808/', 'RolandTR909/'],
    category: 'machines',
  },
  {
    id: 'dirt-samples',
    name: 'Dirt-Samples',
    description: 'Die komplette TidalCycles-Bibliothek: Breaks, Bässe, Stimmen, Foley und vieles mehr.',
    license: 'siehe tidalcycles/dirt-samples',
    source: 'https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json',
    repo: 'tidalcycles/dirt-samples',
    recommended: true,
    category: 'samples',
  },
  {
    id: 'vcsl',
    name: 'VCSL Orchester',
    description: 'Versilian Community Sample Library: Orchester-, Volks- und Perkussionsinstrumente.',
    license: 'CC0',
    source: `${dough}/vcsl.json`,
    repo: 'sgossner/VCSL',
    category: 'instruments',
  },
  {
    id: 'soundfonts',
    name: 'GM-Soundfonts',
    description: 'Alle General-MIDI-Instrumente (gm_piano, gm_violin, ...) in mehreren Varianten.',
    license: 'je nach Soundfont, siehe felixroos/webaudiofontdata',
    source: null,
    remoteBase: 'https://felixroos.github.io/webaudiofontdata/sound/',
    repo: 'felixroos/webaudiofontdata',
    category: 'instruments',
  },
];

const getJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
};

const mapFiles = (map) => {
  const files = [];
  for (const [key, value] of Object.entries(map)) {
    if (key === '_base') continue;
    if (typeof value === 'string') files.push(value);
    else if (Array.isArray(value)) files.push(...value);
    else for (const v of Object.values(value)) files.push(...(typeof v === 'string' ? [v] : v));
  }
  return files;
};

// Größe in Bytes über den GitHub-Tree, damit die App vor dem Download ehrliche Zahlen zeigen kann.
async function repoSizes(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`, { redirect: 'follow' });
  if (!res.ok) return new Map();
  const json = await res.json();
  return new Map(json.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.size]));
}

const dec = (p) => {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
};

async function soundfontMap() {
  const gm = (await import(path.join(root, 'node_modules/@strudel/soundfonts/gm.mjs'))).default;
  const names = [...new Set(Object.values(gm).flat())];
  return { _base: 'https://felixroos.github.io/webaudiofontdata/sound/', files: names.map((n) => `${n}.js`) };
}

async function downloadBundled(pack, map) {
  const dir = path.join(bundledDir, pack.id);
  await fs.rm(dir, { recursive: true, force: true });
  const wanted = pack.bundledPrefixes
    ? mapFiles(map).filter((f) => pack.bundledPrefixes.some((prefix) => f.startsWith(prefix)))
    : mapFiles(map);
  for (const file of wanted) {
    const target = path.join(dir, ...file.split('/').map(dec));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const res = await fetch(map._base + file);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));
  }
}

async function preparePacks() {
  await fs.mkdir(mapDir, { recursive: true });
  const index = [];
  for (const pack of PACKS) {
    const map = pack.source ? await getJson(pack.source) : await soundfontMap();
    const files = pack.source ? mapFiles(map) : map.files;
    const sizes = await repoSizes(pack.repo);
    // Pfade im Repo beginnen je nach Map mit einem Präfix aus _base; der Abgleich läuft deshalb über das Pfadende.
    const prefix = new URL(map._base).pathname.split('/').slice(4).join('/');
    const sizeOf = (f) => sizes.get(prefix + dec(f)) ?? sizes.get(dec(f)) ?? sizes.get(`sound/${f}`) ?? 0;
    const bytes = files.reduce((sum, f) => sum + sizeOf(f), 0);
    const known = files.filter((f) => sizeOf(f) > 0).length;
    const { source, bundledPrefixes, repo, ...meta } = pack;
    index.push({ ...meta, repo, remoteBase: map._base, fileCount: files.length, bytes: known ? Math.round((bytes / known) * files.length) : 0 });
    await fs.writeFile(path.join(mapDir, `${pack.id}.json`), JSON.stringify(map));
    if (pack.bundled || pack.bundledPrefixes) await downloadBundled(pack, map);
    console.log(`${pack.id}: ${files.length} Dateien, ${(index.at(-1).bytes / 1e6).toFixed(0)} MB (${known} mit bekannter Größe)`);
  }
  await fs.writeFile(path.join(mapDir, 'index.json'), JSON.stringify(index, null, 2));
  const alias = await getJson('https://raw.githubusercontent.com/todepond/samples/main/tidal-drum-machines-alias.json');
  await fs.writeFile(path.join(mapDir, 'bank-aliases.json'), JSON.stringify(alias));
}

// Kategorien für die Funktionsreferenz, abgeleitet von der Quelldatei.
const CATEGORY = {
  'controls.mjs': 'Klang & Effekte',
  'pattern.mjs': 'Pattern',
  'signal.mjs': 'Signale & Zufall',
  'euclid.mjs': 'Euklidische Rhythmen',
  'pick.mjs': 'Auswahl (pick)',
  'tonal.mjs': 'Harmonie & Tonleitern',
  'voicings.mjs': 'Harmonie & Tonleitern',
  'pianoroll.mjs': 'Visualisierung',
  'pitchwheel.mjs': 'Visualisierung',
  'spiral.mjs': 'Visualisierung',
  'scope.mjs': 'Visualisierung',
  'spectrum.mjs': 'Visualisierung',
  'slider.mjs': 'Visualisierung',
  'midi.mjs': 'MIDI & OSC',
  'osc.mjs': 'MIDI & OSC',
  'motion.mjs': 'Sensoren',
  'repl.mjs': 'Tempo & Ablauf',
  'sampler.mjs': 'Samples',
  'superdough.mjs': 'Samples',
};
const SKIP_FILES = new Set(['dough.mjs', 'ola-processor.js', 'reverbGen.mjs', 'worklets.mjs']);

async function prepareDocs() {
  const src = await fs.readFile(path.join(root, 'node_modules/@strudel/codemirror/dist/index.mjs'), 'utf8');
  const match = src.match(/JSON\.parse\(`(\[\{"comment"[\s\S]*?\}\])`\)/);
  if (!match) throw new Error('Doku nicht im Build von @strudel/codemirror gefunden');
  // Der Build bettet das JSON als Template-String ein, also einmal als solchen auflösen.
  const docs = JSON.parse(new Function(`return \`${match[1]}\`;`)());
  const seen = new Set();
  const out = [];
  for (const d of docs) {
    const file = d.meta?.filename;
    if (!d.name || d.undocumented || d.name.startsWith('_') || SKIP_FILES.has(file)) continue;
    if (d.tags?.some((t) => ['superdirtOnly', 'noAutocomplete'].includes(t.originalTitle))) continue;
    if (seen.has(d.name)) continue;
    seen.add(d.name);
    out.push({
      name: d.name,
      kind: d.kind,
      synonyms: d.synonyms ?? [],
      description: d.description ?? '',
      params: (d.params ?? []).map((p) => ({
        name: p.name,
        type: p.type?.names?.join(' | ') ?? '',
        description: (p.description ?? '').replace(/<[^>]+>/g, ''),
        optional: !!p.optional,
      })),
      examples: d.examples ?? [],
      category: CATEGORY[file] ?? 'Sonstiges',
      file,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  await fs.mkdir(path.join(root, 'src/generated'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/generated/strudel-docs.json'), JSON.stringify(out));
  console.log(`Doku: ${out.length} Einträge`);
}

await prepareDocs();
await preparePacks();
