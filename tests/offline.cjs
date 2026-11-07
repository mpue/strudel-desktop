// Läuft mit gesperrter Namensauflösung: npm run test:offline
// Belegt, dass die App ohne Internet startet und die mitgelieferten Vorlagen ihre Samples finden.
if (!process.env.STRUDEL_LIBRARY) throw new Error('Tests nur mit STRUDEL_LIBRARY starten');
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};

module.exports = async function run(win, app) {
  setTimeout(() => {
    console.log('FAIL  Zeitlimit überschritten');
    app.exit(2);
  }, 90000);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
    for (let i = 0; i < 200 && !(await js('!!window.strudelApp')); i++) await sleep(200);
    check('App startet ohne Internet', await js('!!window.strudelApp'));
    const online = await js(`fetch('https://raw.githubusercontent.com/').then(() => true, () => false)`);
    check('Internet ist in diesem Lauf wirklich gesperrt', !online);

    const urlsOf = `(name, n = 0) => {
      const s = window.__soundEntry(name);
      if (!s) return [];
      if (Array.isArray(s)) return [s[n % s.length]];
      return Object.values(s).map((v) => v[0]);
    }`;
    const res = await js(`(async () => {
      const { engine, templates } = window.strudelApp;
      const urlsOf = ${urlsOf};
      const out = [];
      for (const t of templates) {
        if (t.needs?.length || t.id === 'hydra') continue;
        const pat = await engine.previewRepl.evaluate(t.code, false);
        const missing = new Set();
        const checked = new Set();
        for (const h of pat.queryArc(0, 16, { _cps: .5 })) {
          const v = h.value;
          if (!v?.s) continue;
          const name = (v.bank ? v.bank + '_' + v.s : v.s).toLowerCase();
          for (const url of urlsOf(name, typeof v.n === 'number' ? v.n : 0)) {
            if (checked.has(url)) continue;
            checked.add(url);
            const r = await fetch(url);
            if (!r.ok) missing.add(name + ' → ' + r.status);
          }
        }
        out.push({ id: t.id, files: checked.size, missing: [...missing] });
      }
      return out;
    })()`);
    for (const r of res) check(`Vorlage ${r.id} offline vollständig`, r.missing.length === 0, r.missing.join(', ') || `${r.files} Dateien`);

    const play = await js(`(async () => {
      const { engine, templates } = window.strudelApp;
      engine.setCode(templates.find(t => t.id === 'house').code);
      await engine.play();
      await new Promise(r => setTimeout(r, 1500));
      const out = { started: engine.started, level: await window.__measureLevel(800), error: engine.mirror.repl.state.evalError?.message };
      engine.stop();
      return out;
    })()`);
    check('House-Vorlage klingt offline', play.started && play.level > 0.001, JSON.stringify(play));

    const missing = await js(`fetch('strudel-samples://pack/dirt-samples/jazz/000_BD.wav').then(r => r.status)`);
    check('Fehlendes Sample meldet offline einen sauberen Fehler', missing === 503, String(missing));
  } catch (err) {
    check('Testlauf ohne Abbruch', false, err.stack);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
  app.exit(failed.length ? 1 : 0);
};
