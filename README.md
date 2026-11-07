# Strudel Desktop

[Strudel](https://strudel.cc) as a local desktop app. The engine, the editor, Hydra and every part of the interface work without an internet connection.

The app's interface is currently in German.

## Getting started

```bash
npm install
npm start
```

After `npm run dist`, installable packages (AppImage and .deb) are in `release/`.

### Ubuntu 24.04 and later

Ubuntu restricts Electron's sandbox through AppArmor. `npm start` then aborts with "The SUID sandbox helper binary was found, but is not configured correctly".

The `.deb` ships a matching AppArmor profile and is the easiest way around this:

```bash
sudo apt install ./release/strudel-desktop_0.2.0_amd64.deb
```

To run `npm start` from the project folder, the sandbox binary must be owned by root. This has to be repeated after every `npm install`:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

`--no-sandbox` is not a good fix, because the app executes arbitrary pattern code, including pasted code.

## Features

**Coding help**
- Context-aware completion: functions and methods, sounds in `s("")`, drum machines in `.bank("")`, scales in `.scale("")`, chords in `chord("")`, voicing modes, your own variables
- Documentation on hover, with examples you can play right away; sounds show info and a preview
- Parameter hints while typing inside the parentheses
- Checks as you type: JS syntax, mini-notation, unknown sounds, banks, functions and methods, with one-click fix suggestions
- Runtime errors shown in the error bar and in the code
- Mini-notation highlighting inside strings, highlighting of active notes during playback, inline sliders and visualizations
- Function reference with search across all 451 documented functions; `F1` opens it for the word under the cursor

Function descriptions come from the Strudel documentation.

**AI suggestions** (local via [Ollama](https://ollama.com), similar to Copilot)
- Grey inline suggestion while typing. A comment such as `// 4/4 beat with bassdrum` produces the code on the line below, in other languages too; it also completes inside method chains and mini-notation
- Every suggestion goes through the checks above. Unknown sounds or methods and syntax errors are reported back to the model once, then the suggestion is discarded
- Server and model are set in the settings. If left empty, `http://127.0.0.1:11434` and the first code model are used. Your code is only sent to that server
- If the comment names a genre (techno, drum & bass, lo-fi …), the matching template is given to the model as an example

**Samples**
- Browser with search, categories, favourites, waveform and variants; click to preview, double-click or drag to insert into the code
- Bundled: Uzu drum kit, Salamander piano, TR-808, TR-909, all synths
- Optional: Tidal Drum Machines, Dirt-Samples, Mridangam, VCSL, GM soundfonts; download as a full pack or automatically on first play
- Your own folders: subfolders become sounds, files become variants
- More packs via `github:user/repo` with a `strudel.json`

**Templates**: 25 pieces from house to Hydra, 16 building blocks, save your own templates.

**Projects**: library in the Documents folder under `Strudel`, open and save files, drafts survive restarts, WAV export.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Ctrl+Enter | Play / apply changes |
| Ctrl+. | Stop |
| Ctrl+Space | Open completion |
| F1 | Documentation for the word under the cursor |
| Tab / Esc | Accept / dismiss AI suggestion (while the completion list is open, Tab belongs to the list) |
| Ctrl+→ | Accept the next word of the AI suggestion |
| Ctrl+Shift+Space | Request an AI suggestion now |
| Ctrl+S / Ctrl+O / Ctrl+N | Save / Open / New |
| Ctrl+E | Export as WAV |
| Ctrl+1 to 4, Ctrl+, | Samples, Templates, Reference, Projects, Settings |
| Ctrl+B / Ctrl+J | Sidebar / Console |

## Where data is stored

- Downloaded samples: `~/.config/Strudel Desktop/samples` (Linux)
- Projects: Documents folder under `Strudel`, can be changed in the Projects panel

## Development

```bash
npm test
npm run test:offline
npm run test:assist
npm run test:assist-live
npm run prepare-data
```

`npm test` runs templates, coding help, audio, export and downloads in the real app and saves screenshots to `tests/output/`. `npm run test:offline` repeats the core checks with name resolution blocked. `npm run test:assist` tests the AI suggestions with real key presses against a stub server, `npm run test:assist-live` against a running Ollama. `npm run prepare-data` fetches sample maps, base samples and documentation again, for example after a Strudel update.

## License

AGPL-3.0-or-later, because the app is built on Strudel. If you distribute it, you must also provide the source code. The sample packs have their own licenses, which are listed in the packs dialog.
