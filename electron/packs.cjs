// Sample-Pakete: lesen die mitgelieferten Maps, laden Dateien bei Bedarf nach und halten sie lokal.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { net } = require('electron');

const AUDIO_EXT = new Set(['.wav', '.mp3', '.ogg', '.flac', '.aac', '.m4a', '.opus', '.aif', '.aiff']);
const CONCURRENCY = 8;

const decode = (p) => {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
};
const encodePath = (p) => p.split('/').map((seg) => encodeURIComponent(decode(seg))).join('/');

// Löst einen relativen Pfad auf und stellt sicher, dass er im angegebenen Ordner bleibt.
function safeJoin(root, rel) {
  const target = path.resolve(root, rel);
  return target === root || target.startsWith(root + path.sep) ? target : null;
}

function mapFiles(map) {
  const files = [];
  for (const [key, value] of Object.entries(map)) {
    if (key === '_base') continue;
    if (typeof value === 'string') files.push(value);
    else if (Array.isArray(value)) files.push(...value);
    else for (const v of Object.values(value)) files.push(...(typeof v === 'string' ? [v] : v));
  }
  return files;
}

function rewriteMapPaths(map) {
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    if (key === '_base') continue;
    if (typeof value === 'string') out[key] = encodePath(value);
    else if (Array.isArray(value)) out[key] = value.map(encodePath);
    else {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([note, v]) => [note, (typeof v === 'string' ? [v] : v).map(encodePath)]),
      );
    }
  }
  return out;
}

async function dirStats(dir) {
  let files = 0;
  let bytes = 0;
  const walk = async (d) => {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) return walk(p);
        if (e.name.endsWith('.part')) return;
        const { size } = await fs.stat(p);
        files += 1;
        bytes += size;
      }),
    );
  };
  await walk(dir);
  return { files, bytes };
}

class PackManager {
  constructor({ resourcesDir, userDataDir, emit }) {
    this.mapDir = path.join(resourcesDir, 'sample-maps');
    this.bundledDir = path.join(resourcesDir, 'bundled');
    this.cacheDir = path.join(userDataDir, 'samples');
    this.customFile = path.join(userDataDir, 'custom-packs.json');
    this.customMapDir = path.join(userDataDir, 'custom-maps');
    this.emit = emit;
    this.packs = new Map(JSON.parse(fsSync.readFileSync(path.join(this.mapDir, 'index.json'), 'utf8')).map((p) => [p.id, p]));
    this.jobs = new Map();
    this.inflight = new Map();
    this.loadCustomPacks();
  }

  loadCustomPacks() {
    try {
      for (const p of JSON.parse(fsSync.readFileSync(this.customFile, 'utf8'))) this.packs.set(p.id, p);
    } catch {
      // noch keine eigenen Pakete
    }
  }

  async saveCustomPacks() {
    const custom = [...this.packs.values()].filter((p) => p.custom);
    await fs.writeFile(this.customFile, JSON.stringify(custom, null, 2));
  }

  async readRawMap(pack) {
    const dir = pack.custom ? this.customMapDir : this.mapDir;
    return JSON.parse(await fs.readFile(path.join(dir, `${pack.id}.json`), 'utf8'));
  }

  async filesOf(pack) {
    const map = await this.readRawMap(pack);
    return map.files ?? mapFiles(map);
  }

  async list() {
    return Promise.all(
      [...this.packs.values()].map(async (pack) => {
        const cached = await dirStats(path.join(this.cacheDir, pack.id));
        const bundled = await dirStats(path.join(this.bundledDir, pack.id));
        const job = this.jobs.get(pack.id);
        return {
          ...pack,
          cachedFiles: Math.min(cached.files + bundled.files, pack.fileCount),
          cachedBytes: cached.bytes + bundled.bytes,
          downloading: job ? { done: job.done, total: job.total, failed: job.failed } : null,
        };
      }),
    );
  }

  // Map für den Renderer: alle Pfade zeigen auf das lokale Protokoll.
  async getMap(id) {
    const pack = this.packs.get(id);
    if (!pack) throw new Error(`Unbekanntes Paket: ${id}`);
    if (id === 'soundfonts') return null;
    const raw = await this.readRawMap(pack);
    return { ...rewriteMapPaths(raw), _base: `strudel-samples://pack/${id}/` };
  }

  async getBankAliases() {
    return JSON.parse(await fs.readFile(path.join(this.mapDir, 'bank-aliases.json'), 'utf8'));
  }

  // Liefert eine Datei aus Bundle oder Cache; fehlt sie, wird sie geladen und für später abgelegt.
  async resolveFile(id, relEncoded) {
    const pack = this.packs.get(id);
    if (!pack) return null;
    const rel = relEncoded.split('/').map(decode).join('/');
    const bundled = safeJoin(path.join(this.bundledDir, id), rel);
    if (bundled && fsSync.existsSync(bundled)) return bundled;
    const cached = safeJoin(path.join(this.cacheDir, id), rel);
    if (!cached) return null;
    if (fsSync.existsSync(cached)) return cached;
    return this.fetchToCache(pack, relEncoded, cached);
  }

  fetchToCache(pack, relEncoded, target) {
    const pending = this.inflight.get(target);
    if (pending) return pending;
    const job = (async () => {
      const res = await net.fetch(pack.remoteBase + relEncoded);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(path.dirname(target), { recursive: true });
      const part = `${target}.${process.pid}.part`;
      await fs.writeFile(part, data);
      await fs.rename(part, target);
      return target;
    })().finally(() => this.inflight.delete(target));
    this.inflight.set(target, job);
    return job;
  }

  async download(id) {
    const pack = this.packs.get(id);
    if (!pack || pack.bundled || this.jobs.has(id)) return;
    const files = (await this.filesOf(pack)).map(encodePath);
    const job = { total: files.length, done: 0, failed: 0, cancelled: false };
    this.jobs.set(id, job);
    let next = 0;
    let lastEmit = 0;
    const report = (state) => {
      const now = Date.now();
      if (state === 'running' && now - lastEmit < 150) return;
      lastEmit = now;
      this.emit('pack-progress', { id, state, done: job.done, total: job.total, failed: job.failed });
    };
    report('running');
    const worker = async () => {
      while (!job.cancelled && next < files.length) {
        const rel = files[next++];
        const decoded = rel.split('/').map(decode).join('/');
        const target = safeJoin(path.join(this.cacheDir, id), decoded);
        const bundled = safeJoin(path.join(this.bundledDir, id), decoded);
        try {
          if (target && !fsSync.existsSync(target) && !(bundled && fsSync.existsSync(bundled))) {
            await this.fetchToCache(pack, rel, target).catch(() => this.fetchToCache(pack, rel, target));
          }
        } catch {
          job.failed += 1;
        }
        job.done += 1;
        report('running');
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    this.jobs.delete(id);
    report(job.cancelled ? 'cancelled' : 'finished');
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (job) job.cancelled = true;
  }

  async removeCache(id) {
    const pack = this.packs.get(id);
    if (!pack || pack.bundled) return;
    this.cancel(id);
    await fs.rm(path.join(this.cacheDir, id), { recursive: true, force: true });
  }

  // Fügt ein Paket hinzu, das über eine strudel.json beschrieben wird (z. B. github:user/repo).
  async addRemote(input) {
    let url = input.trim();
    const gh = url.match(/^(?:github:)?([\w.-]+)\/([\w.-]+)(?:\/([\w.-]+))?$/);
    if (gh) url = `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3] ?? 'main'}/strudel.json`;
    if (!/^https?:\/\//.test(url)) throw new Error('Bitte github:nutzer/repo oder eine http(s)-Adresse angeben');
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`Paket nicht gefunden (HTTP ${res.status})`);
    const map = await res.json();
    const remoteBase = map._base ?? new URL('.', url).href;
    const name = gh ? `${gh[1]}/${gh[2]}` : new URL(url).pathname.split('/').filter(Boolean).slice(-2, -1)[0] ?? url;
    const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const fileCount = mapFiles(map).length;
    if (!fileCount) throw new Error('Die Datei enthält keine Samples');
    await fs.mkdir(this.customMapDir, { recursive: true });
    await fs.writeFile(path.join(this.customMapDir, `${id}.json`), JSON.stringify(map));
    this.packs.set(id, {
      id,
      name,
      description: `Eigenes Paket von ${url}`,
      license: 'siehe Quelle',
      remoteBase: remoteBase.endsWith('/') ? remoteBase : `${remoteBase}/`,
      fileCount,
      bytes: 0,
      category: 'samples',
      custom: true,
    });
    await this.saveCustomPacks();
    return id;
  }

  async removeCustom(id) {
    const pack = this.packs.get(id);
    if (!pack?.custom) return;
    await this.removeCache(id);
    await fs.rm(path.join(this.customMapDir, `${id}.json`), { force: true });
    this.packs.delete(id);
    await this.saveCustomPacks();
  }
}

// Eigene Ordner: Unterordner werden zu Sounds, lose Dateien zu einzelnen Sounds.
async function scanFolder(root) {
  const sounds = {};
  const walk = async (dir, prefix) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, [...prefix, e.name]);
      } else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) {
        const rel = path.relative(root, full).split(path.sep).map(encodeURIComponent).join('/');
        const base = path.basename(e.name, path.extname(e.name));
        const key = (prefix.length ? prefix.join('_') : base).toLowerCase().replace(/[^\w-]+/g, '_');
        (sounds[key] ??= []).push(rel);
      }
    }
  };
  await walk(root, []);
  return sounds;
}

module.exports = { PackManager, scanFolder, safeJoin, decode };
