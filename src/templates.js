// Mitgelieferte Vorlagen und Code-Bausteine. Alle laufen ohne Download mit den fest enthaltenen Sounds,
// außer wenn `needs` etwas anderes sagt. tests/smoke.cjs führt jede Vorlage einmal aus.

export const templates = [
  {
    id: 'erste-schritte',
    category: 'Einstieg',
    name: 'Erste Schritte',
    description: 'Kommentierte Einführung in die wichtigsten Bausteine.',
    code: `// Willkommen! Strg+Enter spielt ab oder aktualisiert, Strg+. stoppt.
// Fahre mit der Maus über eine Funktion, um ihre Doku zu sehen. F1 öffnet die Referenz.

setcpm(120/4) // 120 BPM bei 4 Schlägen pro Zyklus

// Jede Zeile mit $: ist eine eigene Spur.
// Mini-Notation: ~ ist eine Pause, *2 verdoppelt, [ ] fasst zusammen.
$: s("bd ~ bd ~")

$: s("~ sd ~ sd").gain(.8)

$: s("hh*8").gain(.4)

// Töne schreibt man als Notennamen oder als Stufen einer Tonleiter.
$: n("0 2 4 <6 7>").scale("C:minor")
  .s("sawtooth")
  .lpf(1200)
  .room(.3)

// Mit _$: schaltest du eine Spur stumm.
_$: note("c2").s("sine").gain(.5)
`,
  },
  {
    id: 'vier-spuren',
    category: 'Einstieg',
    name: 'Vier Spuren',
    description: 'Schlagzeug, Bass, Akkorde und Melodie als Ausgangspunkt.',
    code: `setcpm(110/4)

// Schlagzeug
$: s("bd [~ bd] sd ~, hh*8").bank("RolandTR808")

// Bass
$: note("<c2 c2 ab1 bb1>*2").s("sawtooth")
  .lpf(500).gain(.7)

// Akkorde
$: chord("<Cm Cm Ab Bb>").voicing()
  .s("piano").gain(.6).room(.3)

// Melodie
$: n("<0 [2 4] 3 [4 6]>*2").scale("C4:minor")
  .s("triangle").delay(.3).gain(.5)
`,
  },
  {
    id: 'house',
    category: 'Beats',
    name: 'House',
    description: 'Four-to-the-floor mit Offbeat-Hihat und Orgelakkorden.',
    code: `setcpm(124/4)

$: s("bd*4").bank("RolandTR909").gain(1)
$: s("~ cp ~ cp").bank("RolandTR909").gain(.7)
$: s("[~ oh]*4").bank("RolandTR909").gain(.4)
$: s("hh*16").bank("RolandTR909").gain(perlin.range(.15,.35))

$: note("<[c2 ~ c2 c3] [ab1 ~ ab1 ab2] [f1 ~ f1 f2] [g1 ~ g1 g2]>")
  .s("sawtooth").lpf(sine.range(300,900).slow(8)).lpq(6)
  .decay(.2).sustain(.2).gain(.7)

$: chord("<Cm7 Abmaj7 Fm7 G7>").voicing()
  .struct("~ [~ x] ~ [x ~]")
  .s("square").lpf(1500).gain(.25).room(.4).delay(.25)
`,
  },
  {
    id: 'techno',
    category: 'Beats',
    name: 'Techno',
    description: 'Treibende Kick, Rumble und rollende Filterbewegung.',
    code: `setcpm(132/4)

$: s("bd*4").bank("RolandTR909").gain(1.1)
$: s("~ hh ~ hh ~ hh ~ [hh hh]").bank("RolandTR909").gain(.5)
$: s("~ ~ cp ~").bank("RolandTR909").room(.5).gain(.5)
$: s("rim*16").bank("RolandTR909")
  .gain("0 .3 0 .2 .4 0 .3 0".fast(2))
  .pan(sine.fast(3))

// Rumble: tiefer Sinus hinter der Kick
$: note("c1*8").s("sine")
  .gain("0 .6 .5 .6 0 .6 .5 .6").lpf(180)

// Stab mit langsam öffnendem Filter
$: note("[c3,eb3,g3]").struct("x(3,8)")
  .s("sawtooth").lpf(sine.range(400,3000).slow(16)).lpq(8)
  .decay(.12).sustain(0).delay(.5).delayfeedback(.55).gain(.45)
`,
  },
  {
    id: 'dnb',
    category: 'Beats',
    name: 'Drum & Bass',
    description: 'Schneller Zwei-Schritt-Beat mit Reese-Bass.',
    code: `setcpm(174/4)

$: s("bd ~ ~ ~ sd ~ ~ [~ bd] ~ [~ bd] ~ ~ sd ~ ~ ~").bank("RolandTR909")
$: s("hh*16").bank("RolandTR909")
  .gain(rand.range(.15,.4)).pan(rand.range(.3,.7))

// Reese-Bass: zwei verstimmte Sägezähne
$: note("<c1 c1 eb1 [f1 g1]>")
  .s("supersaw").detune(.6).unison(4)
  .lpf(sine.range(200,800).slow(4)).lpq(4).gain(.6)

// Atmosphäre
$: chord("<Cm9 Abmaj7>/2").voicing()
  .s("triangle").attack(.6).release(1.5)
  .room(.9).roomsize(6).gain(.25)
`,
  },
  {
    id: 'trap',
    category: 'Beats',
    name: 'Trap',
    description: 'Lange 808-Bässe und Hihat-Rolls im halben Tempo.',
    code: `setcpm(140/4)

$: s("[bd ~ ~ ~] [~ ~ bd ~] [~ bd ~ ~] [~ ~ ~ ~]").bank("RolandTR808").gain(1)
$: s("~ cp ~ cp").bank("RolandTR808").room(.2)

// Hihats mit gelegentlichen Rolls
$: s("hh*8").bank("RolandTR808").gain(.45)
  .sometimesBy(.25, x => x.ply("2|3|4"))

// 808-Bass als langer Sinus
$: note("<c2 ~ [eb2 ~] [~ g1]>")
  .s("sine").decay(.9).sustain(0).shape(.4).gain(.9)

$: n("<[0 ~ 4 ~] [3 ~ ~ 2] [0 ~ 6 ~] [7 ~ 4 ~]>").scale("C4:minor:pentatonic")
  .s("triangle").delay(.4).delayfeedback(.4).gain(.3)
`,
  },
  {
    id: 'boom-bap',
    category: 'Beats',
    name: 'Boom Bap',
    description: 'Swing-Hip-Hop mit Jazz-Akkorden am Piano.',
    code: `setcpm(88/4)

$: s("bd [~ bd] [~ ~ bd ~] ~, ~ sd ~ sd").bank("RolandTR909")
  .swingBy(1/4, 4).gain(.9)

$: s("hh*8").bank("RolandTR909").gain("<.35 .5>*4")
  .swingBy(1/4, 4)

$: chord("<Dm9 G13 Cmaj9 A7b13>").voicing()
  .struct("[~ x] ~ [~ x] x")
  .s("piano").gain(.55).room(.3).lpf(2400)

$: note("<d2 g1 c2 a1>").struct("x ~ [~ x] ~")
  .s("triangle").lpf(400).gain(.8)
`,
  },
  {
    id: 'ukg',
    category: 'Beats',
    name: 'UK Garage',
    description: 'Geshuffelter 2-Step mit Orgel-Stabs.',
    code: `setcpm(132/4)

$: s("bd ~ ~ [~ bd] ~ ~ bd ~").bank("RolandTR909").swingBy(1/6, 4)
$: s("~ cp ~ cp").bank("RolandTR909").gain(.7)
$: s("hh*8").bank("RolandTR909").gain(".5 .25").swingBy(1/6, 4)
$: s("[~ oh]*2").bank("RolandTR909").gain(.3)

$: note("<f1 [f1 ~ ab1 ~] c2 [bb1 ab1]>*2")
  .s("square").lpf(350).gain(.6)

$: chord("<Fm9 Bbm7 Ebmaj7 Cm7>").voicing()
  .struct("~ x ~ [x ~] ~ ~ x ~")
  .s("sawtooth").lpf(1800).decay(.15).sustain(0)
  .room(.3).gain(.35)
`,
  },
  {
    id: 'break-chop',
    category: 'Beats',
    name: 'Break zerschneiden',
    description: 'Ein Breakbeat wird in Stücke zerlegt und neu angeordnet.',
    code: `setcpm(170/4)

// brk ist ein Amen-Break aus dem Drumkit, loopAt passt die Länge an das Tempo an.
$: s("brk").loopAt(2)
  .chop(16)
  .cut(1)
  .sometimesBy(.2, x => x.speed("-1"))
  .sometimesBy(.15, x => x.ply(2))
  .gain(.8)

$: note("<c1 [~ c1] eb1 [g0 bb0]>*2")
  .s("sine").gain(.8).shape(.3)
`,
  },
  {
    id: 'acid',
    category: 'Stile',
    name: 'Acid',
    description: '303-Linie mit resonantem Filter und Akzenten.',
    code: `setcpm(128/4)

$: s("bd*4").bank("RolandTR909")
$: s("[~ hh]*4").bank("RolandTR909").gain(.5)

$: note("c2 c3 eb2 [c2 c3] g1 c2 [bb1 c3] eb2".fast(1))
  .s("sawtooth")
  .lpf(sine.range(250,3500).slow(16))
  .lpq(18)
  .lpenv(4).lpd(.15).lps(.1)
  .decay(.18).sustain(.25)
  .shape(.4)
  .gain("0.8 0.5 0.6 0.8 0.5 0.7 0.5 0.6")
  .delay(.25).delayfeedback(.3)
`,
  },
  {
    id: 'ambient',
    category: 'Stile',
    name: 'Ambient',
    description: 'Langsam schwebende Flächen und zufällige Klavier-Tropfen.',
    code: `setcpm(60/4)

$: chord("<Cmaj9 Am9 Fmaj9 G13>/2").voicing()
  .s("supersaw").detune(.3).unison(5)
  .attack(2).release(4)
  .lpf(sine.range(500,1800).slow(32))
  .room(.95).roomsize(8)
  .gain(.25)

// Klaviernoten erklingen nur manchmal
$: n(irand(12).segment(4)).scale("C4:major:pentatonic")
  .degradeBy(.55)
  .s("piano").gain(.4)
  .room(.9).roomsize(8).delay(.5).delayfeedback(.5)
`,
  },
  {
    id: 'lofi',
    category: 'Stile',
    name: 'Lo-Fi',
    description: 'Entspanntes Klavier mit Tiefpass und knisterndem Rauschen.',
    code: `setcpm(74/4)

$: s("bd ~ [~ bd] ~, ~ sd ~ sd").bank("RolandTR808")
  .swingBy(1/5, 4).lpf(1800).gain(.8)
$: s("hh*8").bank("RolandTR808").gain(perlin.range(.15,.3)).swingBy(1/5, 4)

$: chord("<Fmaj9 Em7 Dm9 Cmaj7>").voicing()
  .struct("x ~ [~ x] ~")
  .s("piano").lpf(1400).gain(.6).room(.4)
  .pan(sine.range(.4,.6).slow(8))

$: n("<[4 ~ 2] [~ 0] [~ 3 2] ~>").scale("C5:major:pentatonic")
  .s("piano").lpf(1800).gain(.35).delay(.4)

// Knistern
$: s("crackle*2").density(.08).gain(.15)
`,
  },
  {
    id: 'dub-techno',
    category: 'Stile',
    name: 'Dub Techno',
    description: 'Lange Echos auf einem einzelnen Akkord-Stab.',
    code: `setcpm(120/4)

$: s("bd*4").bank("RolandTR909").lpf(900)
$: s("[~ hh]*4").bank("RolandTR909").gain(.25).room(.4)

$: chord("Cm9").voicing()
  .struct("~ [~ x] ~ ~ ~ [x ~] ~ ~")
  .s("sawtooth").lpf(perlin.range(500,1500).slow(16)).lpq(5)
  .decay(.2).sustain(0)
  .delay(.7).delaytime(3/16).delayfeedback(.72)
  .room(.7).roomsize(5)
  .gain(.45)

$: note("c1*2").s("sine").gain(.7).lpf(120)
`,
  },
  {
    id: 'synthwave',
    category: 'Stile',
    name: 'Synthwave',
    description: 'Arpeggien, Gated Snare und breite Flächen.',
    code: `setcpm(100/4)

$: s("bd [~ bd] bd ~, ~ sd ~ sd").bank("RolandTR808").room(.2)
$: s("hh*8").bank("RolandTR808").gain(.3)

$: chord("<Am F C G>").voicing()
  .s("supersaw").detune(.4).unison(5)
  .attack(.1).release(.5).lpf(2500).gain(.28)

// Arpeggio aus denselben Harmonien
$: note("<[a2 c3 e3 a3] [f2 a2 c3 f3] [c3 e3 g3 c4] [g2 b2 d3 g3]>*2")
  .s("sawtooth").lpf(sine.range(800,3000).slow(8))
  .decay(.12).sustain(.1).delay(.35).gain(.35)

$: note("<a1 f1 c2 g1>*8").s("square").lpf(350).gain(.5)
`,
  },
  {
    id: 'jazz',
    category: 'Stile',
    name: 'Jazz-Voicings',
    description: 'Automatische Voicings über eine ii-V-I-Folge.',
    code: `setcpm(120/4)

$: chord("<Dm9 G13 Cmaj9 [Am7 D7b9]>")
  .voicing().mode("below:c5")
  .struct("x [~ x] ~ x")
  .s("piano").gain(.6).room(.25)

// Walking Bass aus den Grundtönen
$: n("<[0 2 4 5] [4 3 2 1] [0 2 4 6] [5 4 1 2]>")
  .scale("C2:dorian")
  .s("triangle").gain(.75).lpf(600)

$: s("hh ~ [hh ~ hh] ~").bank("RolandTR909").gain(.3).swingBy(1/3, 4)
`,
  },
  {
    id: 'generativ',
    category: 'Stile',
    name: 'Generativ',
    description: 'Zufall und Rauschen schreiben die Melodie jede Runde neu.',
    code: `setcpm(90/4)

// Rauschen wählt die Stufe, Zufall dünnt aus
$: n(perlin.range(0,14).segment(16).floor())
  .scale("<D3:dorian D3:dorian A2:minor G2:mixolydian>/4")
  .degradeBy(.35)
  .s("triangle")
  .decay(.2).sustain(.1)
  .lpf(rand.range(800,3000))
  .pan(rand)
  .delay(.45).delayfeedback(.5)
  .room(.5)
  .gain(.5)

$: note("<d1 a0 g0 d1>/2").s("sine").gain(.5).attack(.5).release(1)

$: s("hh*16").degradeBy(.7).gain(rand.range(.1,.35)).pan(rand)
`,
  },
  {
    id: 'euklid',
    category: 'Stile',
    name: 'Euklidische Rhythmen',
    description: 'Überlagerte Polyrhythmen in unterschiedlichen Längen.',
    code: `setcpm(110/4)

$: s("bd").euclid(3,8).bank("RolandTR808")
$: s("rim").euclid("<5 7>",16).bank("RolandTR808").gain(.6)
$: s("hh").euclidRot(7,12,2).gain(.4)
$: s("cp").euclid(2,5).gain(.4).room(.3)

$: note("c2 eb2 g2 bb2").struct("x(5,8)")
  .s("sawtooth").lpf(900).decay(.15).sustain(0).gain(.5)
`,
  },
  {
    id: 'arrangement',
    category: 'Struktur',
    name: 'Song-Arrangement',
    description: 'Intro, Hauptteil und Breakdown mit arrange().',
    code: `setcpm(122/4)

const drums = stack(
  s("bd*4").bank("RolandTR909"),
  s("~ cp ~ cp").bank("RolandTR909").gain(.7),
  s("[~ hh]*4").bank("RolandTR909").gain(.5),
)
const bass = note("<c2 c2 ab1 bb1>*4").s("sawtooth").lpf(600).gain(.6)
const chords = chord("<Cm7 Cm7 Abmaj7 Bb7>").voicing().s("piano").gain(.6).room(.4)
const lead = n("<0 2 4 7>*2").scale("C4:minor").s("square").lpf(1800).delay(.3).gain(.3)

// [Länge in Zyklen, Pattern]
$: arrange(
  [4, chords],
  [4, stack(chords, bass)],
  [8, stack(drums, bass, chords)],
  [8, stack(drums, bass, chords, lead)],
  [4, stack(chords, lead).room(.8)],
  [8, stack(drums, bass, chords, lead)],
)
`,
  },
  {
    id: 'slider-mixer',
    category: 'Struktur',
    name: 'Mixer mit Slidern',
    description: 'Inline-Regler für Lautstärke und Filter direkt im Code.',
    code: `setcpm(120/4)

// Die Regler erscheinen direkt im Code und lassen sich beim Spielen bewegen.
$: s("bd*4").bank("RolandTR909").gain(slider(0.9, 0, 1.2))
$: s("[~ hh]*4").bank("RolandTR909").gain(slider(0.4, 0, 1))

$: note("<c2 eb2 g1 bb1>*4").s("sawtooth")
  .lpf(slider(800, 100, 5000))
  .lpq(slider(5, 0, 25))
  .gain(slider(0.6, 0, 1))

$: chord("<Cm Eb Gm Bb>").voicing().s("piano")
  .room(slider(0.4, 0, 1))
  .gain(slider(0.5, 0, 1))
`,
  },
  {
    id: 'fm-synth',
    category: 'Klangdesign',
    name: 'FM-Synthese',
    description: 'Metallische Glocken und Bässe mit Frequenzmodulation.',
    code: `setcpm(100/4)

$: n("<0 2 4 7 9 7 4 2>*2").scale("A3:minor:pentatonic")
  .s("sine")
  .fm(sine.range(1,8).slow(8))
  .fmh("<1 2 3.5 7>/2")
  .fmdecay(.2).fmsustain(.1)
  .decay(.3).sustain(0)
  .room(.5).delay(.3).gain(.5)

$: note("<a1 a1 f1 g1>*4")
  .s("sine").fm(3).fmh(.5).fmdecay(.15).fmsustain(.2)
  .decay(.2).sustain(.1).gain(.7)
`,
  },
  {
    id: 'effekte',
    category: 'Klangdesign',
    name: 'Effekt-Rundgang',
    description: 'Ein Sound nacheinander durch die wichtigsten Effekte.',
    code: `setcpm(110/4)

const base = note("c3 eb3 g3 bb3").fast(2).s("sawtooth").decay(.15).sustain(0).gain(.5)

// Jeder Abschnitt dauert zwei Zyklen und zeigt einen Effekt.
$: arrange(
  [2, base],
  [2, base.lpf(sine.range(200,4000).fast(2)).lpq(10)],
  [2, base.hpf(1200)],
  [2, base.delay(.6).delaytime(3/16).delayfeedback(.6)],
  [2, base.room(.9).roomsize(6)],
  [2, base.crush(4)],
  [2, base.coarse(8)],
  [2, base.shape(.8).gain(.3)],
  [2, base.phaser(4)],
  [2, base.jux(rev)],
  [2, base.vowel("<a e i o>")],
)
`,
  },
  {
    id: 'visuals',
    category: 'Visualisierung',
    name: 'Pianoroll & Scope',
    description: 'Eingebaute Visualisierungen im Editor und im Hintergrund.',
    code: `setcpm(110/4)

// _pianoroll und _scope erscheinen direkt unter der Zeile.
$: note("<c3 eb3 g3 bb3>*4").s("sawtooth").lpf(1500).gain(.5)._pianoroll()

$: s("bd [~ bd] sd ~, hh*8").bank("RolandTR808")._punchcard()

$: chord("<Cm7 Abmaj7>").voicing().s("piano").gain(.6)._scope()

// .pianoroll() ohne Unterstrich läuft im Hintergrund des Editors:
all(x => x.pianoroll({ fold: 1, cycles: 4 }))
`,
  },
  {
    id: 'hydra',
    category: 'Visualisierung',
    name: 'Hydra-Visuals',
    description: 'Video-Synthese im Hintergrund, die auf den Beat reagiert.',
    code: `await initHydra()

setcpm(120/4)

// H() macht aus einem Strudel-Pattern einen Hydra-Parameter.
const pat = "<3 8 20 40>"
osc(H(pat), .1, 1.2)
  .kaleid(4)
  .rotate(() => time * .1)
  .color(.8, .3, 1)
  .out()

$: s("bd*4, [~ hh]*4").bank("RolandTR909")
$: note("<c2 eb2>*8").s("sawtooth").lpf(700).gain(.5)
`,
  },
  {
    id: 'midi-out',
    category: 'Hardware',
    name: 'MIDI-Ausgang',
    description: 'Steuert externe Synthesizer oder eine DAW per MIDI.',
    code: `setcpm(120/4)

// Erste Geräte-Meldung in der Konsole zeigt die verfügbaren MIDI-Ausgänge.
// Mit .midi("Gerätename") wählst du ein bestimmtes Gerät.
$: note("<c3 eb3 g3 bb3>*4")
  .velocity(perlin.range(.4,1))
  .midi()

// Parallel dazu Schlagzeug aus der App
$: s("bd*4, [~ hh]*4").bank("RolandTR909")
`,
  },
  {
    id: 'gm-orchester',
    category: 'Klangdesign',
    name: 'GM-Orchester',
    description: 'General-MIDI-Instrumente. Lädt beim ersten Abspielen nach, wenn das Paket fehlt.',
    needs: ['soundfonts'],
    code: `setcpm(80/4)

$: chord("<C Am F G>").voicing()
  .s("gm_string_ensemble_1").attack(.3).release(.8).gain(.6)

$: n("<[0 2 4 7] [5 4 2 0]>").scale("C4:major")
  .s("gm_flute").gain(.7).room(.5)

$: note("<c2 a1 f1 g1>").s("gm_contrabass").gain(.8)

$: n("0 ~ 2 ~").struct("x(3,8)").scale("C5:major:pentatonic")
  .s("gm_vibraphone").gain(.4).delay(.3)
`,
  },
];

export const snippets = [
  { name: 'Neue Spur', code: '$: s("bd*4")' },
  { name: 'Tempo setzen', code: 'setcpm(120/4)' },
  { name: 'Tonleiter', code: '$: n("0 2 4 <6 7>").scale("C:minor").s("sawtooth").lpf(1200)' },
  { name: 'Akkorde mit Voicing', code: '$: chord("<Cm7 Fm7 Abmaj7 G7>").voicing().s("piano").room(.3)' },
  { name: 'Drum-Maschine', code: '$: s("bd [~ bd] sd ~, hh*8").bank("RolandTR909")' },
  { name: 'Euklidischer Rhythmus', code: '$: s("bd").euclid(3,8)' },
  { name: 'Filter-Sweep', code: '.lpf(sine.range(200,4000).slow(8)).lpq(8)', chained: true },
  { name: 'Hall & Echo', code: '.room(.5).delay(.4).delayfeedback(.5)', chained: true },
  { name: 'Stereo-Effekt', code: '.jux(rev)', chained: true },
  { name: 'Zufällige Variation', code: '.sometimesBy(.25, x => x.ply(2))', chained: true },
  { name: 'Ausdünnen', code: '.degradeBy(.3)', chained: true },
  { name: 'Hüllkurve (ADSR)', code: '.attack(.01).decay(.2).sustain(.3).release(.2)', chained: true },
  { name: 'Lautstärke-Regler', code: '.gain(slider(0.7, 0, 1))', chained: true },
  { name: 'Pianoroll in der Zeile', code: '._pianoroll()', chained: true },
  { name: 'Scope in der Zeile', code: '._scope()', chained: true },
  { name: 'Eigene Samples laden', code: "samples({ meinsound: 'pfad/zum/sample.wav' }, 'https://example.com/')" },
];
