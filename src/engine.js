// Verbindet Strudel mit der App: Editor, Audio, Sounds und eine zweite REPL für Vorschauen.
import { evalScope, logger, noteToMidi, Pattern, repl, silence, valueToMidi } from '@strudel/core';
import * as core from '@strudel/core';
import { StrudelMirror, codemirrorSettings, defaultSettings, extensions } from '@strudel/codemirror';
import { getDrawContext } from '@strudel/draw';
import { transpiler } from '@strudel/transpiler';
import {
  aliasBank,
  getAudioContext,
  initAudio,
  registerSynthSounds,
  registerZZFXSounds,
  renderPatternAudio,
  samples,
  soundMap,
  superdough,
  webaudioOutput,
} from '@strudel/webaudio';
import { registerSoundfonts, setSoundfontUrl } from '@strudel/soundfonts';
import { clearHydra, initHydra as strudelInitHydra } from '@strudel/hydra';
// Das Paket exportiert den fertigen Build nicht, deshalb der direkte Pfad.
import hydraUrl from '../node_modules/hydra-synth/dist/hydra-synth.js?url';

const maxPan = noteToMidi('C8');
const panwidth = (pan, width) => pan * width + (1 - width) / 2;

// Entspricht .piano() aus dem offiziellen REPL.
Pattern.prototype.piano = function () {
  return this.fmap((v) => ({ ...v, clip: v.clip ?? 1 }))
    .s('piano')
    .release(0.1)
    .fmap((value) => {
      const midi = valueToMidi(value);
      const pan = panwidth(Math.min(Math.round(midi) / maxPan, 1), 0.5);
      return { ...value, pan: (value.pan || 1) * pan };
    });
};

const APP_DEFAULTS = {
  ...defaultSettings,
  isAutoCompletionEnabled: true,
  isTooltipEnabled: true,
  isBracketMatchingEnabled: true,
  isActiveLineHighlighted: true,
  isTabIndentationEnabled: true,
  isMultiCursorEnabled: true,
  fontFamily: "'JetBrains Mono Variable', monospace",
  fontSize: 15,
};

// Reihenfolge wie auf strudel.cc: Spätere Pakete überschreiben gleichnamige Sounds.
// So klingt s("bd") hier genauso wie dort, die volle Dirt-Bibliothek kommt nur ergänzend dazu.
const PACK_ORDER = ['dirt-samples', 'drum-machines', 'piano', 'vcsl', 'mridangam', 'uzu-drumkit'];

export const packOfSound = new Map();
// Originalschreibweise der Drum-Maschinen; die Sound-Registry kennt nur Kleinbuchstaben.
export const bankDisplayNames = new Map();

async function registerPack(id) {
  const map = await window.desktop.packs.map(id);
  if (!map) return;
  await samples(map, map._base, { prebake: true, tag: id });
  for (const key of Object.keys(map)) {
    if (key === '_base') continue;
    packOfSound.set(key.toLowerCase(), id);
    if (id === 'drum-machines') {
      const bank = key.slice(0, key.lastIndexOf('_'));
      bankDisplayNames.set(bank.toLowerCase(), bank);
    }
  }
}

export async function registerUserFolders() {
  const folders = await window.desktop.folders.list();
  for (const folder of folders) {
    const base = `strudel-samples://user/${folder.id}/`;
    await samples(folder.sounds, base, { prebake: true, tag: `user:${folder.id}` });
    for (const key of Object.keys(folder.sounds)) packOfSound.set(key.toLowerCase(), `user:${folder.id}`);
  }
  return folders;
}

export async function registerCustomPacks() {
  const packs = await window.desktop.packs.list();
  for (const pack of packs.filter((p) => p.custom)) await registerPack(pack.id);
}

// initHydra lädt Hydra sonst von unpkg.com und legt die Leinwand über die gesamte Oberfläche.
function installLocalHydra() {
  globalThis.initHydra = async (options = {}) => {
    const hydra = await strudelInitHydra({ src: hydraUrl, ...options });
    const canvas = document.getElementById('hydra-canvas');
    canvas.removeAttribute('style');
    document.getElementById('editor-wrap').prepend(canvas);
    return hydra;
  };
}

async function prebake() {
  setSoundfontUrl('strudel-samples://pack/soundfonts');
  await evalScope(
    core,
    import('@strudel/draw'),
    import('@strudel/mini'),
    import('@strudel/tonal'),
    import('@strudel/webaudio'),
    import('@strudel/codemirror'),
    import('@strudel/hydra'),
    import('@strudel/soundfonts'),
    import('@strudel/midi'),
    import('@strudel/osc'),
    import('@strudel/xen'),
    import('@strudel/gamepad'),
    import('@strudel/serial'),
  );
  installLocalHydra();
  await initAudio();
  registerSynthSounds();
  registerZZFXSounds();
  registerSoundfonts();
  for (const id of PACK_ORDER) await registerPack(id);
  await registerCustomPacks();
  await registerUserFolders();
  const aliases = await window.desktop.packs.aliases();
  await aliasBank(aliases);
  for (const alias of Object.values(aliases)) {
    for (const name of [alias].flat()) bankDisplayNames.set(name.toLowerCase(), name);
  }
}

export class Engine {
  constructor({ root, canvas, initialCode, codeExtensions, onChange, onEvalError, onEvaluated, onToggle }) {
    // Eigene Code-Hilfen ersetzen die eingebauten, bleiben aber über dieselben Schalter steuerbar.
    Object.assign(extensions, codeExtensions.toggles);
    if (!localStorage.getItem('codemirror-settings')) codemirrorSettings.set(APP_DEFAULTS);
    this.canvas = canvas;
    this.fitCanvas();
    new ResizeObserver(() => this.fitCanvas()).observe(canvas.parentElement);
    this.previewing = false;
    this.onToggle = onToggle;

    let resolveReady;
    this.ready = new Promise((r) => (resolveReady = r));

    this.mirror = new StrudelMirror({
      defaultOutput: webaudioOutput,
      getTime: () => getAudioContext().currentTime,
      transpiler,
      root,
      initialCode,
      pattern: silence,
      drawTime: [-2, 2],
      drawContext: getDrawContext('test-canvas'),
      autodraw: false,
      bgFill: false,
      prebake: async () => {
        await prebake();
        resolveReady();
      },
      onEvalError,
      beforeEval: () => clearHydra(),
      afterEval: (options) => onEvaluated?.(options),
      onToggle: (started) => {
        if (!started) clearHydra();
        onToggle?.(started);
      },
    });
    this.mirror.editor.dispatch({ effects: codeExtensions.append });
    this.mirror.updateSettings(codemirrorSettings.get());
    this.editor = this.mirror.editor;
    this.onChange = onChange;

    this.previewRepl = repl({
      defaultOutput: webaudioOutput,
      getTime: () => getAudioContext().currentTime,
      transpiler,
      onToggle: (started) => {
        this.previewing = started;
        this.onPreviewToggle?.(started);
      },
    });
  }

  fitCanvas() {
    const { clientWidth, clientHeight } = this.canvas.parentElement;
    const ratio = window.devicePixelRatio;
    this.canvas.width = clientWidth * ratio;
    this.canvas.height = clientHeight * ratio;
  }

  get code() {
    return this.mirror.code;
  }

  get started() {
    return this.mirror.repl.scheduler.started;
  }

  get scheduler() {
    return this.mirror.repl.scheduler;
  }

  setCode(code) {
    this.mirror.setCode(code);
  }

  async play() {
    await this.ready;
    this.stopPreview();
    if (getAudioContext().state !== 'running') await getAudioContext().resume();
    return this.mirror.evaluate();
  }

  stop() {
    this.stopPreview();
    return this.mirror.stop();
  }

  // Spielt fremden Code (Vorlage, Doku-Beispiel), ohne Editor oder laufendes Stück anzufassen.
  async preview(code) {
    await this.ready;
    this.mirror.stop();
    if (getAudioContext().state !== 'running') await getAudioContext().resume();
    const pattern = await this.previewRepl.evaluate(code, true);
    if (!pattern) throw this.previewRepl.state.evalError ?? new Error('Das Beispiel konnte nicht ausgeführt werden');
    return pattern;
  }

  stopPreview() {
    if (this.previewing) this.previewRepl.stop();
  }

  // Einzelner Testton aus dem Sample-Browser.
  async auditionSound({ name, n = 0, note, duration = 1 }) {
    await this.ready;
    const ctx = getAudioContext();
    if (ctx.state !== 'running') await ctx.resume();
    const value = { s: name, n, gain: 0.8 };
    if (note) value.note = note;
    return superdough(value, ctx.currentTime + 0.05, duration, 0.5);
  }

  // Rendert das aktuelle Stück schneller als Echtzeit in eine WAV-Datei.
  async exportWav({ cycles, name }) {
    await this.ready;
    const wasPlaying = this.started;
    this.stop();
    const pattern = await this.mirror.repl.evaluate(this.code, false);
    if (!pattern) throw new Error('Das Stück enthält Fehler und kann nicht exportiert werden');
    try {
      await renderPatternAudio(pattern, this.scheduler.cps, 0, cycles, 48000, 1024, false, name);
    } finally {
      await initAudio();
    }
    if (wasPlaying) await this.play();
  }
}

export { logger, soundMap };
