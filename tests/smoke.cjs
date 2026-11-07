// End-to-End-Test in der echten App. Start: npm test
// Prüft Engine, Vorlagen, Code-Hilfen, Protokoll, Export und macht Screenshots nach tests/output/.
const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, 'output');
fs.mkdirSync(out, { recursive: true });
if (!process.env.STRUDEL_LIBRARY) throw new Error('Tests nur mit STRUDEL_LIBRARY starten, sonst landen Dateien im echten Projektordner');

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};

module.exports = async function run(win, app) {
  setTimeout(() => {
    console.log('FAIL  Zeitlimit überschritten');
    app.exit(2);
  }, 150000).unref?.();
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${name}.png`), image.toPNG());
  };
  const consoleErrors = [];
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') consoleErrors.push(e.message);
  });

  const remoteRequests = [];
  win.webContents.session.webRequest.onBeforeRequest((details, cb) => {
    if (/^https?:|^wss?:/.test(details.url)) remoteRequests.push(details.url);
    cb({});
  });

  const downloads = [];
  win.webContents.session.on('will-download', (_e, item) => {
    const target = path.join(out, item.getFilename().replace(/[^\w.-]/g, '_'));
    item.setSavePath(target);
    item.once('done', (_ev, state) => downloads.push({ target, state }));
  });

  try {
    await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
    for (let i = 0; i < 200; i++) {
      if (await js('!!window.strudelApp')) break;
      await sleep(200);
    }
    check('App startet und Engine ist bereit', await js('!!window.strudelApp'));
    win.setSize(1480, 920);
    await sleep(800);
    await shot('01-start');


    // --- Vorlagen: jede muss fehlerfrei auswertbar sein und nur bekannte Sounds nutzen ---
    const tplResults = await js(`(async () => {
      const { engine, templates } = window.strudelApp;
      const out = [];
      for (const t of templates) {
        const res = { id: t.id, needs: t.needs ?? [] };
        try {
          if (t.id === 'hydra') { res.skipped = true; out.push(res); continue; }
          const pat = await engine.previewRepl.evaluate(t.code, false);
          if (!pat) throw new Error('kein Pattern: ' + (engine.previewRepl.state.evalError?.message));
          const haps = pat.queryArc(0, 16, { _cps: .5 }).filter(h => h.hasOnset());
          res.haps = haps.length;
          const missing = new Set();
          const sounds = new Set();
          for (const h of haps) {
            const v = h.value ?? {};
            if (typeof v !== 'object' || !v.s) continue;
            const name = (v.bank ? v.bank + '_' + v.s : v.s).toLowerCase();
            sounds.add(name);
          }
          res.sounds = [...sounds];
          res.bad = res.sounds.filter(n => !window.__soundKnown(n));
        } catch (e) { res.error = e.message; }
        out.push(res);
      }
      return out;
    })()`);
    for (const r of tplResults) {
      if (r.skipped) continue;
      check(`Vorlage ${r.id}`, !r.error && r.haps > 0 && !r.bad?.length, r.error ?? `${r.haps} Events${r.bad?.length ? `, unbekannt: ${r.bad}` : ''}`);
    }

    // --- Bundled Samples & Protokoll ---
    const proto = await js(`(async () => {
      const get = async (u) => { const r = await fetch(u); return { status: r.status, size: (await r.arrayBuffer()).byteLength, type: r.headers.get('content-type') }; };
      const traversal = await fetch('strudel-samples://pack/piano/..%2F..%2F..%2Fpackage.json').then(r => r.status).catch(() => 'blocked');
      const traversal2 = await fetch('strudel-samples://pack/piano/%2e%2e/%2e%2e/%2e%2e/package.json').then(r => r.status).catch(() => 'blocked');
      return { kit: await get('strudel-samples://pack/uzu-drumkit/bd/10_bd_switchangel.wav'), piano: await get('strudel-samples://pack/piano/C4v8.mp3'), traversal, traversal2 };
    })()`);
    check('Bundle: Drumkit-Sample lädt', proto.kit.status === 200 && proto.kit.size > 1000, JSON.stringify(proto.kit));
    check('Bundle: Klavier-Sample lädt', proto.piano.status === 200 && proto.piano.size > 1000, JSON.stringify(proto.piano));
    check('Pfad-Traversal wird abgewiesen', proto.traversal !== 200 && proto.traversal2 !== 200, `${proto.traversal}/${proto.traversal2}`);

    // --- Code-Hilfen ---
    const lint = await js(`window.__analyse(${JSON.stringify(`$: s("bd sdd").bnk("x").lpf(sine.rangee(1,2))\n$: note("c3 [e3").s("sawtooth")\nfoo(1)\n$: s("bd").bank("RolandTR999")\n$: s("hh").gain(.5).room(.3)`)}).map(d => ({m:d.message, s:d.severity, a:d.actions.length}))`);
    const hasMsg = (re) => lint.some((d) => re.test(d.m));
    check('Linter: Tippfehler im Sound mit Vorschlag', hasMsg(/Unbekannter Sound „sdd“.*Meintest/), JSON.stringify(lint.slice(0, 1)));
    check('Linter: Unbekannte Methode mit Vorschlag', hasMsg(/Pattern-Methode „bnk“.*Meintest/));
    check('Linter: Mini-Notation-Fehler', hasMsg(/Mini-Notation/));
    check('Linter: Unbekannte Funktion', hasMsg(/Unbekannte Funktion „foo“/));
    check('Linter: Unbekannte Drum-Maschine', hasMsg(/Drum-Maschine „RolandTR999“/));
    const syntax = await js(`window.__analyse('$: s("bd"').map(d => d.message)`);
    check('Linter: JS-Syntaxfehler', syntax.some((m) => /Syntaxfehler/.test(m)), syntax[0]);
    const falsePos = await js(`(() => {
      const { templates } = window.strudelApp;
      const out = [];
      for (const t of templates) {
        const d = window.__analyse(t.code);
        if (d.length) out.push(t.id + ': ' + d.map(x => x.message).join(' | '));
      }
      return out;
    })()`);
    check('Linter: keine Fehlalarme in Vorlagen', falsePos.length === 0, falsePos.join('; '));

    const complete = await js(`(async () => {
      const probe = (code, explicit = false) => window.__complete(code, explicit);
      return {
        sound: await probe('s("bd pia|")'),
        bank: await probe('s("bd").bank("Rol|")'),
        scale: await probe('n("0").scale("C:|")'),
        chord: await probe('chord("Cm|")'),
        method: await probe('s("bd").lp|'),
        global: await probe('sta|'),
        none: await probe('// lp|'),
        string: await probe('foo("lp|")'),
      };
    })()`);
    check('Autocomplete: Sounds in s("")', complete.sound.includes('piano'), complete.sound.slice(0, 3).join());
    check('Autocomplete: Bänke in .bank("")', complete.bank.includes('RolandTR909'));
    check('Autocomplete: Tonleitern in .scale("")', complete.scale.includes('minor') && complete.scale.includes('minor:pentatonic'));
    check('Autocomplete: Akkorde in chord("")', complete.chord.some((c) => c.startsWith('m')));
    check('Autocomplete: Methoden nach Punkt', complete.method.includes('lpf'));
    check('Autocomplete: Funktionen global', complete.global.includes('stack'));
    check('Autocomplete: nichts in Kommentaren', complete.none.length === 0);
    check('Autocomplete: nichts in fremden Strings', complete.string.length === 0);

    // --- Echtes Abspielen ---
    const play = await js(`(async () => {
      const { engine } = window.strudelApp;
      engine.setCode('setcpm(120/4)\\n$: s("bd*4, hh*8")\\n$: note("c3 e3").s("sawtooth").lpf(800).gain(.4)');
      await engine.play();
      await new Promise(r => setTimeout(r, 1500));
      const state = { started: engine.started, cycle: engine.scheduler.now(), ctx: window.__audio().state, error: engine.mirror.repl.state.evalError?.message };
      state.level = await window.__measureLevel(600);
      return state;
    })()`);
    check('Abspielen startet', play.started && play.cycle > 0, JSON.stringify(play));
    check('Audio-Ausgang ist nicht stumm', play.level > 0.001, `Pegel ${play.level}`);
    await sleep(300);
    await shot('02-playing');
    await js('window.strudelApp.engine.stop()');
    await sleep(200);
    check('Stopp funktioniert', !(await js('window.strudelApp.engine.started')));

    check('Start und Abspielen ohne eine einzige Netzwerkanfrage', remoteRequests.length === 0, remoteRequests.slice(0, 3).join(' '));

    // --- Fehlerbehandlung beim Ausführen ---
    const evalErr = await js(`(async () => {
      const { engine } = window.strudelApp;
      engine.setCode('undefinedThing("x")');
      await engine.play().catch(() => {});
      await new Promise(r => setTimeout(r, 300));
      engine.stop();
      return document.getElementById('error-bar').hidden ? null : document.getElementById('error-bar').textContent;
    })()`);
    check('Laufzeitfehler erscheint in der Fehlerleiste', !!evalErr && /undefinedThing/.test(evalErr), evalErr);

    // --- Panels durchklicken und fotografieren ---
    await js(`window.strudelApp.engine.setCode(window.strudelApp.templates.find(t => t.id === 'vier-spuren').code)`);
    await js(`window.strudelApp.showPanel('samples'); document.querySelector('[data-filter=machines]').click();`);
    await sleep(300);
    await js(`document.querySelector('.bank-head').click()`);
    await sleep(200);
    await js(`document.querySelector('.bank-body .sound-row')?.click()`);
    await sleep(800);
    await shot('03-samples');
    const catalog = await js(`({ total: window.strudelApp.panels.samples.root.querySelector('.muted').textContent, rows: document.querySelectorAll('.bank-head').length })`);
    check('Sample-Browser zeigt Drum-Maschinen', catalog.rows > 50, JSON.stringify(catalog));

    await js(`document.querySelector('.modal-backdrop')?.remove(); window.strudelApp.showPanel('templates')`);
    await sleep(300);
    await shot('04-templates');
    check('Vorlagen-Panel listet alle', (await js(`document.querySelectorAll('.template-card').length`)) === tplResults.length);

    await js(`window.strudelApp.showPanel('reference'); window.strudelApp.panels.reference.lookup('lpf')`);
    await sleep(300);
    await shot('05-reference');
    check('Referenz findet lpf über Lookup', (await js(`document.querySelector('.ref-detail .doc-sig').textContent`)).startsWith('lpf('));

    await js(`window.strudelApp.showPanel('settings')`);
    await sleep(200);
    await shot('06-settings');

    // --- Code-Hilfen sichtbar im Editor ---
    await js(`(() => {
      const { engine } = window.strudelApp;
      engine.setCode('setcpm(120/4)\\n\\n$: s("bd sdd [hh hh]*2").bank("RolandTR909").lp');
      engine.editor.focus();
      engine.editor.dispatch({ selection: { anchor: engine.editor.state.doc.length } });
      window.__startCompletion(engine.editor);
    })()`);
    await sleep(900);
    await shot('07-completion');
    check('Vervollständigungsliste erscheint im Editor', await js(`!!document.querySelector('.cm-tooltip-autocomplete li')`));
    await js(`(() => {
      const { engine } = window.strudelApp;
      engine.setCode('$: note("c3 e3").s("sawtooth").lpf(800, ');
      engine.editor.focus();
      engine.editor.dispatch({ selection: { anchor: engine.editor.state.doc.length - 2 } });
    })()`);
    await sleep(500);
    await shot('08-signature');
    check('Parameterhilfe erscheint im Editor', await js(`!!document.querySelector('.sig-help')`));
    const coords = await js(`(() => {
      const { engine } = window.strudelApp;
      engine.setCode('$: s("bd*4").room(.5)\\n$: s("bd sdd").bnk("x")');
      const pos = engine.editor.state.doc.toString().indexOf('room') + 2;
      const c = engine.editor.coordsAtPos(pos);
      return { x: Math.round(c.left), y: Math.round((c.top + c.bottom) / 2) };
    })()`);
    await sleep(800);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: coords.x - 3, y: coords.y });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: coords.x, y: coords.y });
    await sleep(900);
    await shot('09-hover-lint');
    check('Hover-Doku erscheint im Editor', await js(`/room/.test(document.querySelector('.doc-tooltip .doc-sig')?.textContent ?? '')`));
    check('Lint-Markierung erscheint im Editor', await js(`!!document.querySelector('.cm-lintRange-warning, .cm-lint-marker-warning')`));
    const miniColor = await js(`(() => {
      const { engine } = window.strudelApp;
      engine.setCode('$: s("bd*4 [hh ~]")');
      return new Promise((resolve) => setTimeout(() => {
        const op = document.querySelector('.cm-mini-op');
        const leaf = op?.querySelector('*') ?? op;
        resolve(leaf ? getComputedStyle(leaf).color : null);
      }, 300));
    })()`);
    check('Mini-Notation wird sichtbar eingefärbt', miniColor === 'rgb(224, 85, 159)', miniColor);

    // --- Paket-Dialoge und Download ---
    await js(`window.strudelApp.showPanel('samples'); document.querySelector('.panel-samples .panel-head button').click()`);
    await sleep(500);
    await shot('10-packs');
    await js(`document.querySelector('.modal-backdrop').remove(); window.strudelApp.openFirstRun()`);
    await sleep(400);
    await shot('11-first-run');
    await js(`document.querySelector('.modal-backdrop').remove()`);
    const before = await js(`window.desktop.packs.list().then(l => l.find(p => p.id === 'mridangam').cachedFiles)`);
    await js(`window.desktop.packs.download('mridangam')`);
    let pack;
    for (let i = 0; i < 150; i++) {
      await sleep(400);
      pack = await js(`window.desktop.packs.list().then(l => l.find(p => p.id === 'mridangam'))`);
      if (!pack.downloading) break;
    }
    check('Paket-Download vollständig', before === 0 && pack.cachedFiles === pack.fileCount, `${pack.cachedFiles}/${pack.fileCount}, ${pack.cachedBytes} Bytes`);

    // --- Projekte ---
    const project = await js(`(async () => {
      const name = 'smoke-test-' + Date.now();
      await window.desktop.projects.write(name, 'x');
      const list = await window.desktop.projects.list();
      const content = await window.desktop.projects.read(name);
      await window.desktop.projects.rename(name, name + '-b');
      await window.desktop.projects.write('../../evil', 'x');
      const after = await window.desktop.projects.list();
      return { listed: list.some(p => p.name === name), content, staysInside: after.some(p => p.name.includes('evil')), libraryDir: (await window.desktop.info()).libraryDir };
    })()`);
    check('Projekt speichern/lesen', project.listed && project.content === 'x');
    const escaped = fs.existsSync(path.join(project.libraryDir, '..', '..', 'evil.strudel'));
    check('Projektname kann den Ordner nicht verlassen', project.staysInside && !escaped);
    check('Test schreibt nicht in den echten Projektordner', project.libraryDir === process.env.STRUDEL_LIBRARY, project.libraryDir);

    // --- WAV-Export ---
    await js(`window.strudelApp.engine.setCode('setcpm(120/4)\\n$: s("bd*4").gain(.9)\\n$: note("c3").s("sawtooth").gain(.3)')`);
    await js(`window.strudelApp.engine.exportWav({ cycles: 2, name: 'smoke-export' })`);
    for (let i = 0; i < 50 && !downloads.length; i++) await sleep(200);
    const wav = downloads[0];
    let wavPeak = 0;
    if (wav && fs.existsSync(wav.target)) {
      const data = fs.readFileSync(wav.target);
      for (let i = 44; i < data.length - 1; i += 2) wavPeak = Math.max(wavPeak, Math.abs(data.readInt16LE(i)));
      fs.rmSync(wav.target);
    }
    check('WAV-Export erzeugt hörbare Datei', wavPeak > 500, `${wav?.state}, Spitze ${wavPeak}`);
    const afterExport = await js(`(async () => {
      const { engine } = window.strudelApp;
      engine.setCode('$: s("bd*4")');
      await engine.play();
      await new Promise(r => setTimeout(r, 800));
      const out = { started: engine.started, level: await window.__measureLevel(400) };
      engine.stop();
      return out;
    })()`);
    check('Abspielen funktioniert nach dem Export', afterExport.started && afterExport.level > 0.001, JSON.stringify(afterExport));

    // --- Hydra ---
    const hydra = await js(`(async () => {
      const { engine, templates } = window.strudelApp;
      const before = window.__remote;
      engine.setCode(templates.find(t => t.id === 'hydra').code);
      await engine.play();
      await new Promise(r => setTimeout(r, 1200));
      const canvas = document.getElementById('hydra-canvas');
      const inside = canvas?.parentElement?.id;
      const pixel = canvas && (() => { const gl = canvas.getContext('webgl'); const p = new Uint8Array(4); gl.readPixels(canvas.width/2|0, canvas.height/2|0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return [...p]; })();
      return { ok: engine.started && !engine.mirror.repl.state.evalError, error: engine.mirror.repl.state.evalError?.message, inside, pixel, hasHydra: typeof window.Hydra };
    })()`);
    await shot('12-hydra');
    await js('window.strudelApp.engine.stop()');
    check('Hydra läuft', hydra.ok, hydra.error ?? JSON.stringify(hydra));
    check('Hydra-Leinwand liegt im Editor', hydra.inside === 'editor-wrap', hydra.inside);
    check('Hydra kommt nicht von unpkg', !remoteRequests.some((u) => /unpkg/.test(u)));

    const seriousErrors = consoleErrors.filter((m) => !/favicon|ERR_NAME_NOT_RESOLVED|undefinedThing/.test(m));
    check('Keine Fehler in der Browser-Konsole', seriousErrors.length === 0, seriousErrors.slice(0, 5).join(' || '));
  } catch (err) {
    check('Testlauf ohne Abbruch', false, err.stack);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
  app.exit(failed.length ? 1 : 0);
};
