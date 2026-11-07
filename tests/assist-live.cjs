// KI-Vorschläge gegen das laufende Ollama, wie sie im Editor ankommen. Start: npm run test:assist-live
// STRUDEL_AI_MODEL wählt das Modell, STRUDEL_AI_URL den Server.
const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, 'output');
fs.mkdirSync(out, { recursive: true });
if (!process.env.STRUDEL_LIBRARY) throw new Error('Tests nur mit STRUDEL_LIBRARY starten');

// [Name, Code bis zum Cursor, Code danach, Muster für den erwarteten Vorschlag]
const CASES = [
  ['Der Auftrag', 'setcpm(120/4)\n\n// 4/4 beat with bassdrum', '', /^\n\$: s\("bd\*4"\)/],
  ['Der Auftrag, nach Enter', '// 4/4 beat with bassdrum\n', '', /^\$: s\("bd\*4"\)/],
  ['Rock', '// rock beat with kick snare and hihat\n', '', /bd.*sd.*hh|hh.*bd.*sd/],
  ['Deutsch', 'setcpm(90/4)\n\n// Bassline in a-moll mit Filter\n', '', /lpf/],
  ['Genre', '// drum and bass beat\n', '', /sd/],
  ['Fläche', '$: s("bd*4")\n\n// langsam schwebende Flächen in D-Dur mit viel Hall\n', '', /room/],
  ['Techno', 'setcpm(135/4)\n\n// techno kick und hats\n', '', /bd/],
  ['Kette', '$: s("bd*4").', '\n', /^\w/],
  ['Kette im Stück', '$: s("bd*4")\n\n// hihats\n$: s("hh*8").', '\n\n$: note("c2").s("sine")\n', /^\w/],
  ['Mini-Notation', '$: note("c3 e3 ', '").s("piano")\n', /^[a-g]/],
  ['Klammer', '$: s("bd*4").lpf(', ')\n', /\d|sine|saw|perlin/],
  ['Tempo', '$: s("bd*4")\n\n// tempo 140 bpm\n', '', /setcpm\(140/],
  ['Nächste Spur', 'setcpm(120/4)\n\n$: s("bd*4")\n$: s("~ cp ~ cp")\n', '', /\$:/],
  ['Mitten im Wort', '$: note("c2").s("tri', '', /^angle/],
];

module.exports = async function run(win, app) {
  setTimeout(() => {
    console.log('FAIL  Zeitlimit überschritten');
    app.exit(2);
  }, 280000).unref?.();
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
  for (let i = 0; i < 200 && !(await js('!!window.strudelApp')); i++) await sleep(200);
  const patch = {};
  if (process.env.STRUDEL_AI_URL) patch.url = process.env.STRUDEL_AI_URL;
  if (process.env.STRUDEL_AI_MODEL) patch.model = process.env.STRUDEL_AI_MODEL;
  await js(`window.strudelApp.assist.configure(${JSON.stringify(patch)})`);
  const models = await js(`window.strudelApp.assist.listModels()`);
  if (!models.ok) {
    console.log('SKIP  Kein Ollama erreichbar');
    return app.exit(3);
  }
  win.show();
  win.focus();
  win.webContents.focus();

  let passed = 0;
  for (const [name, head, tail, expected] of CASES) {
    await js(`(() => {
      const { engine } = window.strudelApp;
      engine.setCode(${JSON.stringify(head + tail)});
      engine.editor.focus();
      engine.editor.dispatch({ selection: { anchor: ${head.length} } });
    })()`);
    await sleep(60);
    const started = Date.now();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space', modifiers: ['control', 'shift'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space', modifiers: ['control', 'shift'] });
    let ghost = null;
    while (Date.now() - started < 60000) {
      ghost = await js(`window.strudelApp.assist.ghost(window.strudelApp.engine.editor.state)?.text ?? null`);
      const idle = await js(`!/denkt|lädt/.test(document.getElementById('ai-status').textContent)`);
      if (ghost !== null || (idle && Date.now() - started > 1500)) break;
      await sleep(30);
    }
    const ms = Date.now() - started;
    if (name === 'Der Auftrag') await shot('23-assist-live');
    // Der Linter kennt nur Namen. Erst die Engine zeigt, ob der übernommene Code wirklich Töne erzeugt.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await sleep(60);
    const run = await js(`(async () => {
      const { engine } = window.strudelApp;
      const code = engine.code;
      const pattern = await engine.previewRepl.evaluate(code, false);
      return { code, haps: pattern ? pattern.queryArc(0, 4, { _cps: .5 }).filter((h) => h.hasOnset()).length : 0, error: engine.previewRepl.state.evalError?.message };
    })()`);
    const ok = ghost !== null && expected.test(ghost) && run.code.startsWith(head + ghost) && run.haps > 0;
    if (ok) passed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (${ms} ms, ${run.haps} Events${run.error ? `, ${run.error}` : ''})\n      ${JSON.stringify(ghost)}`);
  }
  console.log(`\n${passed}/${CASES.length} bestanden`);
  app.exit(passed === CASES.length ? 0 : 1);
};
