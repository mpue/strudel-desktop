// Prompt für die KI-Vorschläge und das Aufräumen der Modellantworten. Reine Textfunktionen ohne Editor.
import { templates } from '../templates.js';

const SYSTEM = `You are the inline code completion of a Strudel editor (strudel.cc, a JavaScript live-coding language for music).
The user sends their file with a <CURSOR> marker. Reply with ONLY the exact text to insert at <CURSOR>: no explanation, no markdown, nothing that is already in the file.
If the cursor follows a comment, write the code that does what the comment says: use every instrument it names, and add nothing it does not ask for. Comments may be German or English; code stays code.

Strudel basics:
- Every track starts with "$: ". One cycle is one bar.
- Mini notation in double quotes: "a b" sequence within the bar, ~ rest, [a b] group into one step, <a b> one per cycle, a*4 repeat, a!2 replicate, a(3,8) euclid, a,b at the same time.
- A 4/4 kick is "bd*4": four hits per bar. Beats 2 and 4 are "~ sd ~ sd". Eighth notes are *8, sixteenths *16.
- Drums: bd kick/bassdrum, sd snare, hh hihat, oh open hihat, cp clap, rim, lt mt ht toms, cr crash, rd ride. Kit: .bank("RolandTR909") or .bank("RolandTR808").
- Synths: sawtooth square triangle sine. Instrument: piano.
- Pitches: note("c2 eb2 g2") or n("0 2 4").scale("C:minor"). Chords: chord("<Cm7 Ab^7>").voicing().
- Common methods: .s() .gain() .pan() .lpf() .lpq() .hpf() .room() .delay() .attack() .decay() .sustain() .release() .fast() .slow() .jux(rev) .every(4,fast(2)) .sometimes() .off() .ply() .struct() .clip() .speed()
- Reverb is .room(.5). .rev() takes no argument and plays the pattern backwards.
- Signals for modulation: sine saw tri perlin rand, e.g. .lpf(sine.range(300,2000).slow(8)). Tempo: setcpm(120/4).`;

// Als echter Gesprächsverlauf wirken die Beispiele viel stärker als im Systemtext: Die Modelle halten
// sich dann ans Format und wiederholen den vorhandenen Code nicht mehr.
const SHOTS = [
  ['setcpm(120/4)\n\n// kick on every beat\n<CURSOR>', '$: s("bd*4")'],
  ['$: s("bd*4")\n\n// Snare auf 2 und 4\n<CURSOR>', '$: s("~ sd ~ sd")'],
  ['// Beat mit Kick, Snare und Hihat\n<CURSOR>', '$: s("bd ~ bd ~, ~ sd ~ sd, hh*8")'],
  ['// house drums\n<CURSOR>', '$: s("bd*4, ~ cp ~ cp, [~ oh]*4").bank("RolandTR909")'],
  ['setcpm(110/4)\n\n// Bass in c-moll mit Filter\n<CURSOR>', '$: note("<c2 c2 eb2 g1>*4").s("sawtooth").lpf(sine.range(300,1500).slow(8)).gain(.7)'],
  ['// sad piano chords\n<CURSOR>', '$: chord("<Am F C G>").voicing().s("piano").room(.4).gain(.6)'],
  ['$: s("hh*8").<CURSOR>', 'gain(.4).pan(sine)'],
  ['$: note("c3 e3 <CURSOR>").s("piano")', 'g3 b3'],
  ['$: note("c3 e3<CURSOR>").s("piano")', ' g3 b3'],
  ['$: note("c2 g2").s("saw<CURSOR>")', 'tooth'],
  ['$: s(<CURSOR>)', '"bd sd"'],
].flatMap(([user, assistant]) => [
  { role: 'user', content: user },
  { role: 'assistant', content: assistant },
]);

const MAX_LINES = 6;

// Die Modelle kennen kaum Strudel-Stücke. Nennt der Kommentar ein Genre, dient die passende Vorlage als Muster.
const GENRES = [
  [/drum\s*(and|&|n|'n'|und)\s*bass|\bdnb\b|\bjungle\b/i, 'dnb'],
  [/\bdub\b/i, 'dub-techno'],
  [/\btechno\b/i, 'techno'],
  [/\bhouse\b/i, 'house'],
  [/\btrap\b/i, 'trap'],
  [/boom.?bap|hip.?hop/i, 'boom-bap'],
  [/\bgarage\b|\bukg\b/i, 'ukg'],
  [/\bacid\b/i, 'acid'],
  [/\bambient\b/i, 'ambient'],
  [/\blo.?fi\b/i, 'lofi'],
  [/synth.?wave|retro.?wave/i, 'synthwave'],
  [/\bjazz/i, 'jazz'],
  [/eu[ck]lid/i, 'euklid'],
];

function genreShot(comment) {
  const id = GENRES.find(([pattern]) => pattern.test(comment))?.[1];
  const template = id && templates.find((t) => t.id === id);
  if (!template) return [];
  const lines = template.code
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('//') && !line.startsWith('setcpm'))
    .slice(0, MAX_LINES);
  return [
    { role: 'user', content: `// ${template.name}\n<CURSOR>` },
    { role: 'assistant', content: lines.join('\n') },
  ];
}

const PREFIX_CHARS = 2000;
const SUFFIX_CHARS = 600;

// Das System und die Beispiele stehen vorn und ändern sich nicht, so kann Ollama sie im Cache halten.
export function buildMessages({ prefix, suffix, comment = '' }) {
  let head = prefix;
  if (head.length > PREFIX_CHARS) head = head.slice(head.indexOf('\n', head.length - PREFIX_CHARS) + 1);
  return [
    { role: 'system', content: SYSTEM },
    ...SHOTS,
    ...genreShot(comment),
    { role: 'user', content: `${head}<CURSOR>${suffix.slice(0, SUFFIX_CHARS)}` },
  ];
}

export const retryMessages = (messages, reply, problems) => [
  ...messages,
  { role: 'assistant', content: reply },
  { role: 'user', content: `That does not work in Strudel: ${problems.join(' ')} Reply again with only the corrected text to insert at <CURSOR>.` },
];

const isComment = (line) => line.trimStart().startsWith('//');

// Macht aus der Antwort den reinen Einfügetext. Leerer Text bedeutet: Hier gibt es nichts Brauchbares.
export function cleanSuggestion(raw, { before = '', after = '', previousLine = '', multiline = false, truncated = false }) {
  let text = raw.replace(/\r/g, '').replace(/<\/?CURSOR>/g, '');
  const fence = text.match(/```[\w-]*\n?([\s\S]*?)(?:```|$)/);
  if (fence) text = fence[1];
  text = text.replace(/\s+$/, '').replace(/^(?:[ \t]*\n)+/, '');

  if (multiline) {
    let lines = text.split('\n');
    if (previousLine.trim() && lines[0].trim() === previousLine.trim()) lines.shift();
    const blank = lines.findIndex((line) => !line.trim());
    if (blank >= 0) lines = lines.slice(0, blank);
    if (truncated) lines.pop();
    lines = lines.slice(0, MAX_LINES);
    while (lines.length && isComment(lines[lines.length - 1])) lines.pop();
    return lines.join('\n');
  }

  if (truncated) return '';
  text = text.split('\n')[0];

  // Die Modelle wiederholen gern den Anfang der Zeile, obwohl er schon dasteht.
  const typed = before.trimStart();
  if (typed && text.startsWith(typed)) text = text.slice(typed.length);
  else {
    for (let n = Math.min(typed.length, text.length); n >= 6; n--) {
      if (typed.endsWith(text.slice(0, n))) {
        text = text.slice(n);
        break;
      }
    }
  }
  if (/\.$/.test(before) && text.startsWith('.')) text = text.slice(1);

  const rest = after.trim();
  if (rest && text.endsWith(rest)) text = text.slice(0, -rest.length);
  return text.replace(/\s+$/, '');
}
