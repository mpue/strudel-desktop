// KI-Vorschläge mit echten Tastendrücken gegen einen Ersatz-Server. Start: npm run test:assist
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const out = path.join(__dirname, 'output');
fs.mkdirSync(out, { recursive: true });
if (!process.env.STRUDEL_LIBRARY) throw new Error('Tests nur mit STRUDEL_LIBRARY starten');

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};

// Antwortet je nach letzter Nachricht. Die Regeln entsprechen dem, was echte Modelle falsch machen.
function fakeOllama() {
  const state = { chats: [], loaded: true, generateCalls: 0, delay: 0, aborted: 0 };
  const reply = (user) => {
    if (user.startsWith('That does not work')) return '$: s("bd*2")';
    if (user.includes('// erfundener sound')) return '$: s("quatschtrommel*4")';
    if (user.includes('// kaputt')) return '$: s("bd*4"';
    if (user.includes('// nur kommentar')) return '// noch ein Kommentar';
    if (user.includes('// mit fence')) return '```js\n$: s("cp*2")\n```';
    if (user.includes('// mehrzeilig')) return '$: s("bd*4")\n$: s("hh*8")';
    if (user.includes('// schon da')) return '$: s("rim*4")';
    if (user.includes('.lpf(<CURSOR>)')) return '800).gain(.5)';
    if (user.includes('.<CURSOR>')) return '$: s("bd*4").gain(.4)';
    if (user.includes('note("c3 <CURSOR>")')) return 'e3 g3").s("piano';
    if (user.includes('// tempo')) return 'setcpm(140/4)';
    if (user.includes('// 4/4 beat')) return '$: s("bd*4")';
    return '';
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const json = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.url === '/api/tags') return json({ models: [{ name: 'allzweck:7b' }, { name: 'testcoder:1b' }] });
      if (req.url === '/api/ps') return json({ models: state.loaded ? [{ name: 'testcoder:1b', model: 'testcoder:1b' }] : [] });
      if (req.url === '/api/generate') {
        state.generateCalls++;
        return setTimeout(() => {
          state.loaded = true;
          json({ done: true });
        }, 800);
      }
      const data = JSON.parse(body);
      const user = data.messages.at(-1).content;
      state.chats.push({ model: data.model, user, messages: data.messages, stop: data.options.stop });
      let finished = false;
      res.on('close', () => {
        if (!finished) state.aborted++;
      });
      setTimeout(() => {
        finished = true;
        json({ message: { role: 'assistant', content: reply(user) }, done_reason: 'stop' });
      }, state.delay);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` })));
}

module.exports = async function run(win, app) {
  setTimeout(() => {
    console.log('FAIL  Zeitlimit überschritten');
    app.exit(2);
  }, 120000).unref?.();
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const consoleErrors = [];
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') consoleErrors.push(e.message);
  });

  const { server, state, url } = await fakeOllama();
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(30);
  };
  const type = async (text) => {
    for (const ch of text) {
      if (ch === '\n') await key('Enter');
      else win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      await sleep(8);
    }
  };
  const reset = async (code = '') => {
    await js(`(() => {
      const { engine } = window.strudelApp;
      engine.setCode(${JSON.stringify(code)});
      engine.editor.focus();
      engine.editor.dispatch({ selection: { anchor: engine.editor.state.doc.length } });
    })()`);
    await sleep(100);
  };
  const ghost = () => js(`window.strudelApp.assist.ghost(window.strudelApp.engine.editor.state)?.text ?? null`);
  const docText = () => js(`window.strudelApp.engine.editor.state.doc.toString()`);
  const ghostDom = () => js(`document.querySelector('.cm-ghost-text')?.textContent ?? null`);
  const waitGhost = async (ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const text = await ghost();
      if (text !== null) return text;
      await sleep(40);
    }
    return null;
  };
  const lastUser = () => state.chats.at(-1)?.user ?? '';

  try {
    await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
    for (let i = 0; i < 200 && !(await js('!!window.strudelApp')); i++) await sleep(200);
    await js(`window.strudelApp.assist.configure({ url: ${JSON.stringify(url)} })`);
    win.show();
    win.focus();
    win.webContents.focus();
    await sleep(500);

    // Vor dem ersten Abspielen kennt die Engine setcpm noch nicht, der Vorschlag muss trotzdem durchgehen.
    await reset('');
    await type('// tempo 140\n');
    check('Tempo-Vorschlag vor dem ersten Abspielen', (await waitGhost()) === 'setcpm(140/4)', JSON.stringify(await ghost()));
    await key('Escape');

    // --- Der Fall aus dem Auftrag: Kommentar tippen, Vorschlag bekommen ---
    await reset('setcpm(120/4)\n\n');
    await type('// 4/4 beat with bassdrum');
    const commentGhost = await waitGhost();
    check('Kommentar am Zeilenende ergibt Vorschlag', commentGhost === '\n$: s("bd*4")', JSON.stringify(commentGhost));
    check('Vorschlag ist nur Grautext, nicht im Dokument', (await docText()) === 'setcpm(120/4)\n\n// 4/4 beat with bassdrum');
    check('Grautext ist im Editor sichtbar', (await ghostDom()) === '\n$: s("bd*4")');
    check('Wählt ohne Einstellung das Code-Modell', state.chats.at(-1).model === 'testcoder:1b', state.chats.at(-1).model);
    check('Prompt enthält Datei und Cursor', lastUser().endsWith('// 4/4 beat with bassdrum\n<CURSOR>'), JSON.stringify(lastUser()));
    check('Prompt beginnt mit Systemtext und Beispielen', state.chats.at(-1).messages[0].role === 'system' && state.chats.at(-1).messages.length > 10);
    check('Fußzeile zeigt die Tasten', /Tab übernimmt/.test(await js(`document.getElementById('ai-status').textContent`)));
    await shot('20-assist-ghost');
    await key('Tab');
    await sleep(50);
    check('Tab übernimmt den Vorschlag', (await docText()) === 'setcpm(120/4)\n\n// 4/4 beat with bassdrum\n$: s("bd*4")', JSON.stringify(await docText()));
    check('Nach Tab kein Grautext mehr', (await ghostDom()) === null);
    const caret = await js(`(() => { const s = window.strudelApp.engine.editor.state; return s.selection.main.head === s.doc.length })()`);
    check('Cursor steht hinter dem übernommenen Text', caret);
    await sleep(700);
    check('Übernahme löst keinen neuen Vorschlag aus', (await ghost()) === null);

    await reset('');
    await type('// 4/4 beat\n');
    check('Enter nach Kommentar ergibt Vorschlag in der neuen Zeile', (await waitGhost()) === '$: s("bd*4")');
    await key('Escape');
    await sleep(50);
    check('Esc verwirft den Vorschlag', (await ghost()) === null && (await docText()) === '// 4/4 beat\n');
    await key('Tab');
    await sleep(50);
    check('Tab rückt ohne Vorschlag normal ein', (await docText()) !== '// 4/4 beat\n$: s("bd*4")');

    await reset('');
    await type('// 4/4 beat\n');
    await waitGhost();
    await key('Right', ['control']);
    await sleep(30);
    await key('Right', ['control']);
    await sleep(50);
    check('Strg+→ übernimmt wortweise', (await docText()) === '// 4/4 beat\n$:' && (await ghost()) === ' s("bd*4")', JSON.stringify([await docText(), await ghost()]));
    await key('Tab');
    await sleep(50);
    check('Rest danach mit Tab', (await docText()) === '// 4/4 beat\n$: s("bd*4")');

    // --- Rückgängig ---
    await reset('');
    await type('// 4/4 beat\n');
    await waitGhost();
    await key('Tab');
    await sleep(50);
    await key('Z', ['control']);
    await sleep(80);
    check('Strg+Z nimmt nur den Vorschlag zurück', (await docText()) === '// 4/4 beat\n', JSON.stringify(await docText()));

    // --- Prüfung der Vorschläge ---
    await reset('');
    let before = state.chats.length;
    await type('// erfundener sound\n');
    const retried = await waitGhost();
    check('Unbekannter Sound geht zurück ans Modell', retried === '$: s("bd*2")' && state.chats.length === before + 2, JSON.stringify(retried));
    check('Rückmeldung nennt den Fehler', /quatschtrommel/.test(lastUser()), lastUser());

    await reset('');
    await type('// kaputt\n');
    await sleep(500);
    check('Syntaxfehler wird nicht als Vorschlag gezeigt', (await ghost()) === '$: s("bd*2")', JSON.stringify(await ghost()));
    await reset('');
    await type('// nur kommentar\n');
    await sleep(600);
    check('Reiner Kommentar wird verworfen', (await ghost()) === null);
    await reset('');
    await type('// mit fence\n');
    check('Markdown-Zaun wird entfernt', (await waitGhost()) === '$: s("cp*2")', JSON.stringify(await ghost()));
    await reset('');
    await type('// mehrzeilig\n');
    check('Mehrere Zeilen nach Kommentar', (await waitGhost()) === '$: s("bd*4")\n$: s("hh*8")', JSON.stringify(await ghost()));
    await reset('$: s("rim*4")\n');
    await type('// schon da\n');
    await sleep(600);
    check('Was schon im Code steht, wird nicht wieder vorgeschlagen', (await ghost()) === null);

    // --- Mitten im Code ---
    await reset('$: s("bd*4")');
    await type('.');
    const chain = await waitGhost();
    check('In der Kette: wiederholter Zeilenanfang wird abgeschnitten', chain === 'gain(.4)', JSON.stringify(chain));
    check('In der Kette nur eine Zeile', state.chats.at(-1).stop[0] === '\n');
    await reset('$: note("c3 ")');
    await js(`(() => { const v = window.strudelApp.engine.editor; v.dispatch({ selection: { anchor: v.state.doc.length - 2 } }) })()`);
    await sleep(50);
    await js(`document.querySelector('.cm-content').focus()`);
    await key('Space', ['control', 'shift']);
    const fit = await waitGhost();
    check('Strg+Umschalt+Leertaste fragt sofort', fit !== null, JSON.stringify(fit));
    await key('Tab');
    await sleep(50);
    check('Antwort mit eigener schließender Klammer ersetzt die automatisch geschlossene', (await docText()) === '$: note("c3 e3 g3").s("piano")', JSON.stringify(await docText()));

    await reset('$: s("bd*4").lpf()');
    await js(`(() => { const v = window.strudelApp.engine.editor; v.dispatch({ selection: { anchor: v.state.doc.length - 1 } }) })()`);
    await key('Space', ['control', 'shift']);
    await waitGhost();
    await key('Tab');
    await sleep(50);
    check('Auch bei .lpf(|)', (await docText()) === '$: s("bd*4").lpf(800).gain(.5)', JSON.stringify(await docText()));

    await reset('$: s("bd*4")\n');
    await js(`(() => { const v = window.strudelApp.engine.editor; v.dispatch({ selection: { anchor: 3 } }) })()`);
    before = state.chats.length;
    await type('x');
    await sleep(600);
    check('Mitten im Wort kein Vorschlag', state.chats.length === before);

    // --- Abbrechen ---
    state.delay = 1500;
    await reset('');
    await type('// 4/4 beat\n');
    await sleep(600);
    const abortedBefore = state.aborted;
    await type('$');
    await sleep(200);
    check('Weitertippen bricht die laufende Anfrage ab', state.aborted === abortedBefore + 1, `${state.aborted}`);
    state.delay = 0;
    await sleep(500);
    await key('Backspace');
    await sleep(100);

    // --- Abspielen darf nur das Dokument sehen ---
    await reset('');
    await type('// 4/4 beat\n');
    await waitGhost();
    check('Der Editor-Code enthält den Grautext nicht', (await js(`window.strudelApp.engine.code`)) === '// 4/4 beat\n');
    await key('Escape');

    // --- Modell laden: Weitertippen darf das Laden nicht abbrechen ---
    state.loaded = false;
    state.delay = 0;
    state.generateCalls = 0;
    await reset('');
    await type('// 4/4 beat\n');
    await sleep(300);
    check('Fußzeile meldet das Laden', /lädt Modell/.test(await js(`document.getElementById('ai-status').textContent`)), await js(`document.getElementById('ai-status').textContent`));
    await type(' ');
    await sleep(350);
    await key('Backspace');
    await waitGhost(3000);
    check('Modell wird trotz Weitertippen nur einmal geladen', state.generateCalls === 1 && state.loaded, `${state.generateCalls}`);

    // --- Einstellungen ---
    await js(`window.strudelApp.showPanel('settings')`);
    await sleep(400);
    await js(`[...document.querySelectorAll('#sidebar h3')].find((n) => n.textContent === 'KI-Vorschläge').scrollIntoView()`);
    await sleep(100);
    const settings = await js(`(() => {
      const panel = document.querySelector('#sidebar');
      return { options: [...panel.querySelectorAll('select')].at(-1).options.length, text: panel.textContent };
    })()`);
    check('Einstellungen listen die Modelle', settings.options === 3, `${settings.options}`);
    check('Einstellungen zeigen die Verbindung', /Verbunden, 2 Modelle/.test(settings.text));
    await shot('21-assist-settings');
    await js(`window.strudelApp.assist.configure({ model: 'allzweck:7b' })`);
    await reset('');
    await type('// 4/4 beat\n');
    await waitGhost();
    check('Gewähltes Modell wird benutzt', state.chats.at(-1).model === 'allzweck:7b');
    await js(`window.strudelApp.assist.configure({ enabled: false })`);
    before = state.chats.length;
    await reset('');
    await type('// 4/4 beat\n');
    await sleep(800);
    check('Ausgeschaltet: keine Anfrage', state.chats.length === before);
    check('Ausgeschaltet: Fußzeile sagt es', (await js(`document.getElementById('ai-status').textContent`)) === 'KI aus');
    const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'));
    check('Einstellungen landen in config.json', saved.ai.enabled === false && saved.ai.model === 'allzweck:7b' && saved.ai.url === url, JSON.stringify(saved.ai));
    const badUrl = await js(`window.strudelApp.assist.configure({ url: 'file:///etc/passwd' }).then(() => 'ok', () => 'abgewiesen')`);
    check('Fremde Protokolle werden abgewiesen', badUrl === 'abgewiesen', badUrl);

    // --- Server weg ---
    await js(`window.strudelApp.assist.configure({ enabled: true, model: 'testcoder:1b' })`);
    server.close();
    server.closeAllConnections();
    await sleep(100);
    await reset('');
    await type('// 4/4 beat\n');
    await sleep(800);
    check('Ohne Server: Fußzeile meldet es', /nicht erreichbar/.test(await js(`document.getElementById('ai-status').textContent`)), await js(`document.getElementById('ai-status').textContent`));
    check('Ohne Server: Editor läuft weiter', (await docText()) === '// 4/4 beat\n');
    await shot('22-assist-offline');

    const serious = consoleErrors.filter((m) => !/favicon|ERR_NAME_NOT_RESOLVED/.test(m));
    check('Keine Fehler in der Browser-Konsole', serious.length === 0, serious.slice(0, 5).join(' || '));
  } catch (err) {
    check('Testlauf ohne Abbruch', false, err.stack);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
  app.exit(failed.length ? 1 : 0);
};
