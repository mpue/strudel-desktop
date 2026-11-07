// Zentraler Überblick über alle registrierten Sounds, genutzt von Autocomplete, Linter und Sample-Browser.
import { soundMap } from '@strudel/webaudio';
import { bankDisplayNames, packOfSound } from '../engine.js';

export function soundNames() {
  return Object.keys(soundMap.get()).sort();
}

export function soundInfo(name) {
  const key = name.toLowerCase();
  const entry = soundMap.get()[key];
  if (!entry) return null;
  const data = entry.data ?? {};
  const samples = data.samples;
  const count = Array.isArray(samples) ? samples.length : samples ? Object.keys(samples).length : undefined;
  return {
    key,
    type: data.type ?? 'synth',
    pack: packOfSound.get(key) ?? null,
    count,
    pitched: !!samples && !Array.isArray(samples),
    samples,
  };
}

export function isKnownSound(name) {
  return !!soundMap.get()[name.toLowerCase()];
}

export function bankNames() {
  return [...bankDisplayNames.values()].sort((x, y) => x.localeCompare(y));
}

export function bankSounds(bank) {
  const prefix = `${bank.toLowerCase()}_`;
  return Object.keys(soundMap.get())
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}
