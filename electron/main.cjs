const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PackManager, scanFolder, safeJoin, decode } = require('./packs.cjs');

const isPackaged = app.isPackaged;
const appRoot = path.join(__dirname, '..');
const resourcesDir = isPackaged ? process.resourcesPath : path.join(appRoot, 'resources');
const distDir = path.join(appRoot, 'dist');

if (process.env.STRUDEL_USER_DATA) app.setPath('userData', process.env.STRUDEL_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'strudel-samples', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let mainWindow;
let packs;
const configFile = () => path.join(app.getPath('userData'), 'config.json');
let config = { userFolders: [], libraryDir: null, firstRunDone: false, ai: { enabled: true, url: 'http://127.0.0.1:11434', model: '' } };

const loadConfig = () => {
  try {
    config = { ...config, ...JSON.parse(fsSync.readFileSync(configFile(), 'utf8')) };
  } catch {
    // Erststart
  }
};
const saveConfig = () => fs.writeFile(configFile(), JSON.stringify(config, null, 2));
const libraryDir = () =>
  (!isPackaged && process.env.STRUDEL_LIBRARY) || config.libraryDir || path.join(app.getPath('documents'), 'Strudel');

const send = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};

const MIME = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.js': 'text/plain',
};

const sampleResponse = async (file) => {
  const body = await fs.readFile(file);
  return new Response(body, {
    headers: {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'max-age=31536000',
    },
  });
};

function registerProtocols() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const rel = decode(pathname).replace(/^\/+/, '') || 'index.html';
    const file = safeJoin(distDir, rel);
    if (!file || !fsSync.existsSync(file)) return new Response('Nicht gefunden', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });

  protocol.handle('strudel-samples', async (request) => {
    const { hostname, pathname } = new URL(request.url);
    const [id, ...rest] = pathname.replace(/^\/+/, '').split('/');
    const rel = rest.join('/');
    try {
      if (hostname === 'pack') {
        const file = await packs.resolveFile(id, rel);
        if (file) return await sampleResponse(file);
      } else if (hostname === 'user') {
        const folder = config.userFolders.find((f) => f.id === id);
        const file = folder && safeJoin(folder.path, rel.split('/').map(decode).join(path.sep));
        if (file && fsSync.existsSync(file)) return await sampleResponse(file);
      }
    } catch {
      return new Response('Sample nicht verfügbar', { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    return new Response('Nicht gefunden', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
}

// --- Projekte ------------------------------------------------------------------------------------
// Der Renderer führt beliebigen Pattern-Code aus. Deshalb bekommt er keine freien Dateipfade:
// Zugriffe gehen nur auf die Projektbibliothek oder auf Dateien, die im nativen Dialog gewählt wurden.
const PROJECT_EXT = '.strudel';
const externalFiles = new Map();
let externalCounter = 0;

const projectPath = (name) => {
  const clean = String(name).replace(/[/\\]/g, '_').replace(/^\.+/, '').trim();
  if (!clean) throw new Error('Ungültiger Projektname');
  return path.join(libraryDir(), clean + PROJECT_EXT);
};

const registerExternal = (filePath) => {
  const token = `ext-${++externalCounter}`;
  externalFiles.set(token, filePath);
  return { token, name: path.basename(filePath, path.extname(filePath)) };
};

// --- KI-Vorschläge ---------------------------------------------------------------------------------
// Läuft hier statt im Renderer, damit CORS-Regeln von Ollama keine Rolle spielen. Nur feste API-Pfade.
const aiRequests = new Map();
const aiLoads = new Map();
const AI_KEEP_ALIVE = '30m';

const aiPost = (pathname, body, signal) =>
  fetch(new URL(pathname, config.ai.url), { method: 'POST', body: JSON.stringify(body), signal });

const aiFailure = (err) =>
  err.name === 'AbortError' || err.name === 'TimeoutError'
    ? { ok: false, reason: 'cancelled' }
    : { ok: false, reason: 'offline', message: err.cause?.code ?? err.message };

// Ein abgebrochener Request bricht bei Ollama auch das Laden des Modells ab. Wer weitertippt, käme
// sonst nie zu einem geladenen Modell, deshalb lädt ein eigener Request, den niemand abbricht.
async function aiEnsureLoaded(model) {
  const res = await fetch(new URL('/api/ps', config.ai.url), { signal: AbortSignal.timeout(3000) });
  const { models = [] } = await res.json();
  if (models.some((m) => m.name === model || m.model === model)) return;
  if (!aiLoads.has(model)) {
    send('ai-loading', true);
    const load = aiPost('/api/generate', { model, keep_alive: AI_KEEP_ALIVE })
      .then((r) => r.text())
      .finally(() => {
        aiLoads.delete(model);
        send('ai-loading', false);
      });
    aiLoads.set(model, load);
  }
  await aiLoads.get(model);
}

const handlers = {
  'app:info': () => ({ version: app.getVersion(), libraryDir: libraryDir(), firstRunDone: config.firstRunDone, test: !isPackaged && !!process.env.STRUDEL_TEST }),
  'app:first-run-done': async () => {
    config.firstRunDone = true;
    await saveConfig();
  },
  'app:open-external': (url) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
  },

  'ai:config': () => config.ai,
  'ai:set-config': async (patch) => {
    if (patch.url !== undefined && !/^https?:$/.test(new URL(patch.url).protocol)) throw new Error('Nur http und https');
    config.ai = { ...config.ai, ...patch };
    await saveConfig();
    return config.ai;
  },
  'ai:models': async () => {
    try {
      const res = await fetch(new URL('/api/tags', config.ai.url), { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { ok: false, reason: 'offline', message: `HTTP ${res.status}` };
      const { models = [] } = await res.json();
      return { ok: true, models: models.map((m) => m.name) };
    } catch (err) {
      return aiFailure(err);
    }
  },
  'ai:complete': async ({ id, model, messages, stop, temperature, maxTokens }) => {
    const controller = new AbortController();
    aiRequests.set(id, controller);
    try {
      await Promise.race([
        aiEnsureLoaded(model),
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason))),
      ]);
      const res = await aiPost(
        '/api/chat',
        {
          model,
          messages,
          stream: false,
          think: false,
          keep_alive: AI_KEEP_ALIVE,
          options: { temperature, top_p: 0.9, num_predict: maxTokens, stop },
        },
        AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
      );
      const data = await res.json();
      if (!res.ok) return { ok: false, reason: res.status === 404 ? 'model' : 'error', message: data.error ?? `HTTP ${res.status}` };
      return { ok: true, text: data.message?.content ?? '', truncated: data.done_reason === 'length' };
    } catch (err) {
      return aiFailure(err);
    } finally {
      aiRequests.delete(id);
    }
  },
  'ai:cancel': (id) => aiRequests.get(id)?.abort(),

  'packs:list': () => packs.list(),
  'packs:map': (id) => packs.getMap(id),
  'packs:aliases': () => packs.getBankAliases(),
  'packs:download': (id) => {
    packs.download(id).catch((err) => send('pack-progress', { id, state: 'error', message: err.message }));
  },
  'packs:cancel': (id) => packs.cancel(id),
  'packs:remove-cache': (id) => packs.removeCache(id),
  'packs:add-remote': (input) => packs.addRemote(input),
  'packs:remove-custom': (id) => packs.removeCustom(id),

  'folders:list': async () => {
    const out = [];
    for (const folder of config.userFolders) {
      try {
        const sounds = await scanFolder(folder.path);
        out.push({ ...folder, sounds, missing: false });
      } catch {
        out.push({ ...folder, sounds: {}, missing: true });
      }
    }
    return out;
  },
  'folders:add': async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Sample-Ordner hinzufügen',
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths[0]) return null;
    const folderPath = filePaths[0];
    if (!config.userFolders.some((f) => f.path === folderPath)) {
      config.userFolders.push({ id: `f${Date.now().toString(36)}`, name: path.basename(folderPath), path: folderPath });
      await saveConfig();
    }
    return folderPath;
  },
  'folders:remove': async (id) => {
    config.userFolders = config.userFolders.filter((f) => f.id !== id);
    await saveConfig();
  },

  'projects:list': async () => {
    let entries = [];
    try {
      entries = await fs.readdir(libraryDir(), { withFileTypes: true });
    } catch {
      return [];
    }
    const items = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.endsWith(PROJECT_EXT))
        .map(async (e) => {
          const stat = await fs.stat(path.join(libraryDir(), e.name));
          return { name: e.name.slice(0, -PROJECT_EXT.length), modified: stat.mtimeMs };
        }),
    );
    return items.sort((a, b) => b.modified - a.modified);
  },
  'projects:read': (name) => fs.readFile(projectPath(name), 'utf8'),
  'projects:write': async (name, code) => {
    await fs.mkdir(libraryDir(), { recursive: true });
    await fs.writeFile(projectPath(name), code);
  },
  'projects:rename': async (from, to) => {
    const target = projectPath(to);
    if (fsSync.existsSync(target)) throw new Error(`Es gibt bereits ein Projekt „${to}“`);
    await fs.rename(projectPath(from), target);
  },
  'projects:trash': (name) => shell.trashItem(projectPath(name)),
  'projects:reveal': () => {
    fsSync.mkdirSync(libraryDir(), { recursive: true });
    return shell.openPath(libraryDir());
  },
  'projects:choose-library': async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Projektordner wählen',
      defaultPath: libraryDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return null;
    config.libraryDir = filePaths[0];
    await saveConfig();
    return filePaths[0];
  },
  'files:open': async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Strudel-Datei öffnen',
      filters: [{ name: 'Strudel', extensions: ['strudel', 'str', 'js', 'txt'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return null;
    return { ...registerExternal(filePaths[0]), code: await fs.readFile(filePaths[0], 'utf8') };
  },
  'files:save-as': async (suggestedName, code) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Speichern unter',
      defaultPath: path.join(libraryDir(), `${suggestedName || 'projekt'}${PROJECT_EXT}`),
      filters: [{ name: 'Strudel', extensions: ['strudel'] }],
    });
    if (canceled || !filePath) return null;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, code);
    return registerExternal(filePath);
  },
  'files:write': async (token, code) => {
    const filePath = externalFiles.get(token);
    if (!filePath) throw new Error('Datei ist nicht mehr bekannt');
    await fs.writeFile(filePath, code);
  },
};

function buildMenu() {
  const menu = (action) => () => send('menu', action);
  const template = [
    {
      label: 'Datei',
      submenu: [
        { label: 'Neu', accelerator: 'CmdOrCtrl+N', click: menu('new') },
        { label: 'Öffnen …', accelerator: 'CmdOrCtrl+O', click: menu('open') },
        { type: 'separator' },
        { label: 'Speichern', accelerator: 'CmdOrCtrl+S', click: menu('save') },
        { label: 'Speichern unter …', accelerator: 'CmdOrCtrl+Shift+S', click: menu('save-as') },
        { type: 'separator' },
        { label: 'Als WAV exportieren …', accelerator: 'CmdOrCtrl+E', click: menu('export') },
        { type: 'separator' },
        { role: 'quit', label: 'Beenden' },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Rückgängig' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfügen' },
        { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    {
      label: 'Wiedergabe',
      submenu: [
        { label: 'Abspielen / Aktualisieren   Strg+Enter', click: menu('play') },
        { label: 'Stopp   Strg+.', click: menu('stop') },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { label: 'Samples', accelerator: 'CmdOrCtrl+1', click: menu('panel:samples') },
        { label: 'Vorlagen', accelerator: 'CmdOrCtrl+2', click: menu('panel:templates') },
        { label: 'Referenz', accelerator: 'CmdOrCtrl+3', click: menu('panel:reference') },
        { label: 'Projekte', accelerator: 'CmdOrCtrl+4', click: menu('panel:projects') },
        { label: 'Einstellungen', accelerator: 'CmdOrCtrl+,', click: menu('panel:settings') },
        { type: 'separator' },
        { label: 'Seitenleiste ein/aus', accelerator: 'CmdOrCtrl+B', click: menu('toggle-sidebar') },
        { label: 'Konsole ein/aus', accelerator: 'CmdOrCtrl+J', click: menu('toggle-console') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
        { role: 'toggleDevTools', label: 'Entwicklertools' },
      ],
    },
    {
      label: 'Hilfe',
      submenu: [
        { label: 'Strudel-Dokumentation (online)', click: () => shell.openExternal('https://strudel.cc/learn/') },
        { label: 'Strudel-Quellcode', click: () => shell.openExternal('https://codeberg.org/uzu/strudel') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#1b1b1f',
    title: 'Strudel Desktop',
    icon: path.join(appRoot, 'build/icon.png'),
    autoHideMenuBar: true,
    show: isPackaged || !process.env.STRUDEL_TEST,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) event.preventDefault();
  });

  mainWindow.loadURL('app://strudel/index.html');
}

app.whenReady().then(() => {
  loadConfig();
  packs = new PackManager({ resourcesDir, userDataDir: app.getPath('userData'), emit: send });
  registerProtocols();
  buildMenu();

  // MIDI und Mikrofon dürfen für Live-Coding genutzt werden, alles andere bleibt gesperrt.
  const allowed = new Set(['midi', 'midiSysex', 'media', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args) => handler(...args));
  }

  createWindow();
  if (process.env.STRUDEL_TEST && !isPackaged) require(path.join(appRoot, process.env.STRUDEL_TEST))(mainWindow, app);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
