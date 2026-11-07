# Strudel Desktop

[Strudel](https://strudel.cc) als lokale Desktop-App. Die Engine, der Editor, Hydra und alle Oberflächen laufen ohne Internet.

## Starten

```bash
npm install
npm start
```

Installierbare Pakete (AppImage und .deb) landen nach `npm run dist` in `release/`.

### Ubuntu 24.04 und neuer

Ubuntu schränkt die Sandbox von Electron per AppArmor ein. `npm start` bricht dann mit „The SUID sandbox helper binary was found, but is not configured correctly“ ab.

Das `.deb` bringt ein passendes AppArmor-Profil mit und ist der einfachste Weg:

```bash
sudo apt install ./release/strudel-desktop_0.2.0_amd64.deb
```

Für `npm start` aus dem Projektordner muss die Sandbox-Datei root gehören. Das ist nach jedem `npm install` erneut nötig:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

`--no-sandbox` ist keine gute Lösung, weil die App beliebigen Pattern-Code ausführt, auch eingefügten.

## Was drin ist

**Code-Unterstützung**
- Vervollständigung je nach Kontext: Funktionen und Methoden, Sounds in `s("")`, Drum-Maschinen in `.bank("")`, Tonleitern in `.scale("")`, Akkorde in `chord("")`, Voicing-Modi, eigene Variablen
- Doku beim Überfahren einer Funktion, mit Beispielen zum direkten Anhören; bei Sounds Infos und Vorhören
- Parameterhilfe beim Tippen in den Klammern
- Prüfung beim Tippen: JS-Syntax, Mini-Notation, unbekannte Sounds, Bänke, Funktionen und Methoden, mit Korrekturvorschlag per Klick
- Laufzeitfehler in Fehlerleiste und Code
- Einfärbung der Mini-Notation in Strings, Hervorhebung aktiver Noten beim Abspielen, Inline-Regler und -Visualisierungen
- Funktionsreferenz mit Suche über alle 451 dokumentierten Funktionen; `F1` öffnet sie zum Wort unter dem Cursor

Die Funktionstexte stammen aus der Strudel-Doku und sind englisch.

**KI-Vorschläge** (lokal über [Ollama](https://ollama.com), wie Copilot)
- Grauer Vorschlag beim Tippen. Ein Kommentar wie `// 4/4 beat with bassdrum` ergibt den Code in der Zeile darunter, auch auf Deutsch; außerdem Vervollständigung mitten in Ketten und Mini-Notation
- Jeder Vorschlag läuft durch die Prüfung oben. Unbekannte Sounds oder Methoden und Syntaxfehler werden dem Modell einmal zurückgemeldet, danach verworfen
- Server und Modell stehen in den Einstellungen, ohne Eintrag wird `http://127.0.0.1:11434` und das erste Code-Modell benutzt. Der Code geht nur an diesen Server
- Nennt der Kommentar ein Genre (Techno, Drum & Bass, Lo-Fi …), dient die passende Vorlage dem Modell als Muster

**Samples**
- Browser mit Suche, Kategorien, Favoriten, Wellenform und Varianten; Klick hört an, Doppelklick oder Ziehen fügt in den Code ein
- Fest enthalten: Uzu-Drumkit, Salamander-Klavier, TR-808, TR-909, alle Synths
- Optional: Tidal Drum Machines, Dirt-Samples, Mridangam, VCSL, GM-Soundfonts; als ganzes Paket oder automatisch beim ersten Abspielen
- Eigene Ordner: Unterordner werden zu Sounds, Dateien zu Varianten
- Weitere Pakete über `github:nutzer/repo` mit `strudel.json`

**Vorlagen**: 25 Stücke von House bis Hydra, 16 Bausteine, eigene Vorlagen sichern.

**Projekte**: Bibliothek im Dokumente-Ordner unter `Strudel`, Dateien öffnen und speichern, Entwurf übersteht Neustarts, WAV-Export.

## Tasten

| Taste | Aktion |
| --- | --- |
| Strg+Enter | Abspielen / Änderungen übernehmen |
| Strg+. | Stopp |
| Strg+Leertaste | Vervollständigung öffnen |
| F1 | Doku zum Wort unter dem Cursor |
| Tab / Esc | KI-Vorschlag übernehmen / verwerfen (bei offener Vervollständigungsliste gehört Tab der Liste) |
| Strg+→ | Nächstes Wort des KI-Vorschlags übernehmen |
| Strg+Umschalt+Leertaste | KI-Vorschlag sofort anfordern |
| Strg+S / Strg+O / Strg+N | Speichern / Öffnen / Neu |
| Strg+E | Als WAV exportieren |
| Strg+1 bis 4, Strg+, | Samples, Vorlagen, Referenz, Projekte, Einstellungen |
| Strg+B / Strg+J | Seitenleiste / Konsole |

## Wo die Daten liegen

- Heruntergeladene Samples: `~/.config/Strudel Desktop/samples` (Linux)
- Projekte: Dokumente-Ordner unter `Strudel`, im Projekte-Panel änderbar

## Entwicklung

```bash
npm test
npm run test:offline
npm run test:assist
npm run test:assist-live
npm run prepare-data
```

`npm test` führt Vorlagen, Code-Hilfen, Audio, Export und Download in der echten App aus und legt Screenshots in `tests/output/` ab. `npm run test:offline` wiederholt den Kern bei gesperrter Namensauflösung. `npm run test:assist` prüft die KI-Vorschläge mit echten Tastendrücken gegen einen Ersatz-Server, `npm run test:assist-live` gegen das laufende Ollama. `npm run prepare-data` holt Sample-Maps, Basis-Samples und Doku neu, zum Beispiel nach einem Strudel-Update.

## Lizenz

AGPL-3.0-or-later, weil die App auf Strudel aufbaut. Wer sie weitergibt, muss den Quellcode mitliefern. Die Sample-Pakete haben eigene Lizenzen, die im Paket-Dialog stehen.
