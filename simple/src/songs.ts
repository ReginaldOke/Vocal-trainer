/**
 * Songs and exercises as steps from a home note: [semitones or null for a rest, beats, word].
 * Everything shipped here is in the public domain.
 */
export type SongStep = [number | null, number, string?];

export interface Song {
  id: string;
  title: string;
  bpm: number;
  beatsPerBar: number;
  steps: SongStep[];
  /** the key note, in semitones above step zero (0 when the tune is written from its key note) */
  tonic?: number;
  minor?: boolean;
  /** an exercise sung in rounds, each ending on its own home note: the chord follows each round */
  rounds?: boolean;
  /** every note is sung short and sharp */
  short?: boolean;
  /** imported by the singer; kept in this browser only */
  custom?: boolean;
}

export interface Note {
  i: number;
  midi: number;
  /** seconds from the start of the take */
  start: number;
  dur: number;
  word: string | null;
  /** "cue": the piano plays it while the singer listens. "solo": the singer sings it, unaccompanied. */
  role: "cue" | "solo";
}

/** One line of a song: what the singer hears, then sings back. Times are from the line's own start. */
export interface Line {
  notes: { midi: number; start: number; dur: number; word: string | null }[];
  length: number;
  /** the chord that sets the key before the line */
  chord: number[];
}

/** A line laid out as hear-then-sing: chord, the piano plays the line, chord again, the singer sings it. */
export interface Prepared {
  notes: Note[];
  /** when the piano strikes the chord: once before the tune, once before the singer's turn */
  chords: { at: number; midi: number[]; dur: number }[];
  /** soft ticks that count the singer in */
  ticks: number[];
  /** when the singer's turn starts */
  singAt: number;
  end: number;
  beat: number;
  lo: number;
  hi: number;
}

/** Marks the end of a phrase without adding any time. */
const B: SongStep = [null, 0];

const TWINKLE: SongStep[] = [
  [0, 1, "Twin-"], [0, 1, "kle"], [7, 1, "twin-"], [7, 1, "kle"], [9, 1, "lit-"], [9, 1, "tle"], [7, 2, "star"], B,
  [5, 1, "how"], [5, 1, "I"], [4, 1, "won-"], [4, 1, "der"], [2, 1, "what"], [2, 1, "you"], [0, 2, "are"], B,
  [7, 1, "Up"], [7, 1, "a-"], [5, 1, "bove"], [5, 1, "the"], [4, 1, "world"], [4, 1, "so"], [2, 2, "high"], B,
  [7, 1, "like"], [7, 1, "a"], [5, 1, "dia-"], [5, 1, "mond"], [4, 1, "in"], [4, 1, "the"], [2, 2, "sky"], B,
  [0, 1, "Twin-"], [0, 1, "kle"], [7, 1, "twin-"], [7, 1, "kle"], [9, 1, "lit-"], [9, 1, "tle"], [7, 2, "star"], B,
  [5, 1, "how"], [5, 1, "I"], [4, 1, "won-"], [4, 1, "der"], [2, 1, "what"], [2, 1, "you"], [0, 2, "are"], B,
];

const BIRTHDAY: SongStep[] = [
  [-5, 0.75, "Hap-"], [-5, 0.25, "py"], [-3, 1, "birth-"], [-5, 1, "day"], [0, 1, "to"], [-1, 2, "you"], B,
  [-5, 0.75, "Hap-"], [-5, 0.25, "py"], [-3, 1, "birth-"], [-5, 1, "day"], [2, 1, "to"], [0, 2, "you"], B,
  [-5, 0.75, "Hap-"], [-5, 0.25, "py"], [7, 1, "birth-"], [4, 1, "day"], [0, 1, "dear"], [-1, 1, "sing-"], [-3, 2, "er"], B,
  [5, 0.75, "Hap-"], [5, 0.25, "py"], [4, 1, "birth-"], [0, 1, "day"], [2, 1, "to"], [0, 2, "you"], B,
];

const ODE: SongStep[] = [
  [4, 1, "Joy-"], [4, 1, "ful"], [5, 1, "joy-"], [7, 1, "ful"], [7, 1, "we"], [5, 1, "a-"], [4, 1, "dore"], [2, 1, "thee"], B,
  [0, 1, "God"], [0, 1, "of"], [2, 1, "glo-"], [4, 1, "ry"], [4, 1.5, "Lord"], [2, 0.5, "of"], [2, 2, "love"], B,
  [4, 1, "Hearts"], [4, 1, "un-"], [5, 1, "fold"], [7, 1, "like"], [7, 1, "flow'rs"], [5, 1, "be-"], [4, 1, "fore"], [2, 1, "thee"], B,
  [0, 1, "o-"], [0, 1, "pening"], [2, 1, "to"], [4, 1, "the"], [2, 1.5, "sun"], [0, 0.5, "a-"], [0, 2, "bove"], B,
  [2, 1, "Melt"], [2, 1, "the"], [4, 1, "clouds"], [0, 1, "of"], [2, 1, "sin"], [4, 0.5, "and"], [5, 0.5, "sad-"], [4, 1, "ness"], B,
  [0, 1, "drive"], [2, 1, "the"], [4, 0.5, "dark"], [5, 0.5, "of"], [4, 1, "doubt"], [2, 1, "a-"], [0, 1, "way"], [2, 1, "Giv-"], [-5, 2, "er"], B,
  [4, 1, "of"], [4, 1, "im-"], [5, 1, "mor-"], [7, 1, "tal"], [7, 1, "glad-"], [5, 1, "ness"], [4, 1, "fill"], [2, 1, "us"], B,
  [0, 1, "with"], [0, 1, "the"], [2, 1, "light"], [4, 1, "of"], [2, 1.5, "day"], [0, 0.5, "a-"], [0, 2, "bove"], B,
];

const GRACE: SongStep[] = [
  [-5, 1, "A-"], [0, 2, "ma-"], [4, 0.5, "zing"], [0, 0.5, ""], [4, 2, "grace"], [2, 1, "how"], [0, 2, "sweet"], [-3, 1, "the"],
  [-5, 2, "sound"], [-5, 1, "that"], [0, 2, "saved"], [4, 0.5, "a"], [0, 0.5, ""], [4, 2, "wretch"], [2, 1, "like"], [7, 3, "me"],
  [7, 1, "I"], [4, 2, "once"], [7, 0.5, "was"], [4, 0.5, ""], [4, 2, "lost"], [2, 1, "but"], [0, 2, "now"], [-3, 1, "am"],
  [-5, 2, "found"], [-5, 1, "was"], [0, 2, "blind"], [4, 0.5, "but"], [0, 0.5, ""], [4, 2, "now"], [2, 1, "I"], [0, 3, "see"],
];

/** “Silent Night” (Gruber, 1818). In 6/8: a dotted quarter is 1.5 beats. */
const SILENT_NIGHT: SongStep[] = [
  [7, 1.5, "Si-"], [9, 0.5, "lent"], [7, 1, "night"], [4, 3, ""], [7, 1.5, "ho-"], [9, 0.5, "ly"], [7, 1, "night"], [4, 3, ""], B,
  [2, 2, "All"], [2, 1, "is"], [-1, 3, "calm"], [0, 2, "all"], [0, 1, "is"], [-5, 3, "bright"], B,
  [9, 2, "Round"], [9, 1, "yon"], [12, 1.5, "vir-"], [11, 0.5, ""], [9, 1, "gin"], [7, 1.5, "mo-"], [9, 0.5, "ther"], [7, 1, "and"], [4, 3, "child"], B,
  [9, 2, "Ho-"], [9, 1, "ly"], [12, 1.5, "in-"], [11, 0.5, ""], [9, 1, "fant"], [7, 1.5, "so"], [9, 0.5, "ten-"], [7, 1, "der"], [4, 3, "and mild"], B,
  [2, 2, "Sleep"], [2, 1, "in"], [5, 1.5, "heav-"], [2, 0.5, "en-"], [-1, 1, "ly"], [0, 3, "peace"], B,
  [12, 2, "Sleep"], [7, 1, "in"], [4, 1.5, "heav-"], [7, 0.5, "en-"], [5, 1, "ly"], [2, 1, "peace"], [0, 3, ""], B,
];

/** “Greensleeves” (traditional, 16th century), the verse. Minor: semitones from the tonic A. */
const GREENSLEEVES: SongStep[] = [
  [0, 1, "A-"], [3, 2, "las"], [5, 1, "my"], [7, 1.5, "love"], [8, 0.5, "you"], [7, 1, "do"],
  [5, 2, "me"], [2, 1, "wrong"], B, [-2, 1.5, "to"], [0, 0.5, "cast"], [2, 1, "me"],
  [3, 2, "off"], [0, 1, "dis-"], [0, 1.5, "cour-"], [-1, 0.5, "teous-"], [0, 1, "ly"], [2, 2, ""], [-1, 1, ""], [-5, 2, ""],
  B, [0, 1, "And"], [3, 2, "I"], [5, 1, "have"], [7, 1.5, "loved"], [8, 0.5, "you"], [7, 1, "oh"],
  [5, 2, "so"], [2, 1, "long"], B, [-2, 1.5, "de-"], [0, 0.5, "light-"], [2, 1, "ing"],
  [3, 1.5, "in"], [2, 0.5, "your"], [0, 1, "com-"], [-1, 1.5, "pa-"], [-3, 0.5, ""], [-1, 2, "ny"], [0, 3, ""],
];

export const SONGS: Song[] = [
  { id: "twinkle", title: "Twinkle Twinkle", bpm: 96, beatsPerBar: 4, steps: TWINKLE },
  { id: "birthday", title: "Happy Birthday", bpm: 90, beatsPerBar: 3, steps: BIRTHDAY },
  { id: "grace", title: "Amazing Grace", bpm: 72, beatsPerBar: 3, steps: GRACE },
  { id: "silent", title: "Silent Night", bpm: 88, beatsPerBar: 3, steps: SILENT_NIGHT },
  { id: "greensleeves", title: "Greensleeves", bpm: 96, beatsPerBar: 3, minor: true, steps: GREENSLEEVES },
  { id: "ode", title: "Ode to Joy", bpm: 108, beatsPerBar: 4, steps: ODE },
];

// ---------------------------------------------------------------- exercises

/** A pattern sung in one key, then a step higher, and so on up and back down, as a teacher leads from the piano. */
function climbing(pattern: SongStep[], keys: number[], gap = 2): SongStep[] {
  return keys.flatMap((k): SongStep[] => [...pattern.map(([semi, beats, word]): SongStep => [semi === null ? null : semi + k, beats, word]), [null, gap]]);
}
const UP_AND_BACK = [0, 1, 2, 3, 4, 3, 2, 1, 0];
const UP_A_LITTLE = [0, 1, 2, 3, 2, 1, 0];
const five = (w: string): SongStep[] => [7, 5, 4, 2, 0].map((n): SongStep => [n, 1, w]);
const scale = (w: string): SongStep[] => [0, 2, 4, 5, 7, 5, 4, 2].map((n): SongStep => [n, 1, w]);
const fromTheTop = (w: string) => climbing([[12, 1, w], [7, 1, w], [4, 1, w], [0, 2, w]], UP_A_LITTLE);
const ex = (id: string, title: string, bpm: number, steps: SongStep[], short = false): Song => ({ id, title, bpm, beatsPerBar: 4, steps, short, rounds: true });

export const EXERCISES = {
  ng: ex("ng", "Five notes on “ng”", 100, climbing([...scale("ng"), [0, 2, "ng"]], [0, 1, 2, 3, 2, 1, 0])),
  ah: ex("ah", "Short “ah”", 104, climbing([...five("ah"), ...five("ah")], UP_AND_BACK), true),
  humShort: ex("hum-short", "Creaky hum", 104, climbing([...scale("mm"), [0, 1, "mm"]], UP_AND_BACK), true),
  humSmooth: ex("hum-smooth", "Creaky hum, joined up", 104, climbing([...scale("mm"), [0, 2, "mm"]], UP_AND_BACK)),
  goo: ex("goo", "“Goo”", 96, fromTheTop("goo"), true),
  koo: ex("koo", "“Koo”", 96, fromTheTop("koo"), true),
  gug: ex("gug", "“Gug”", 96, fromTheTop("gug"), true),
  long: ex("long", "Long notes", 60, [0, 2, 4, 5, 7].flatMap((n): SongStep[] => [[n, 4, "ah"], [null, 2]])),
  match: ex("match", "Match a note", 80, [0, 4, 7, 2, 5, 9, 7, 0].flatMap((n): SongStep[] => [[n, 2, "ah"], [null, 2]])),
  leaps: ex("leaps", "Leaps", 80, [[0, 7], [0, 4], [0, 9], [0, 5], [0, 12], [7, 0]].flatMap(([a, b]): SongStep[] => [[a, 2, "ah"], [b, 2, "ah"], [null, 2]])),
};

// ---------------------------------------------------------------- laying a song out as lines

export function span(song: Song) {
  const semis = song.steps.map((s) => s[0]).filter((s): s is number => s !== null);
  return { lo: Math.min(...semis), hi: Math.max(...semis) };
}

const MAX_LINE = 7;

/** A simple chord in the middle of the piano: the key note with its third and fifth. */
export function triad(root: number, minor = false) {
  let r = root;
  while (r >= 58) r -= 12;
  while (r < 46) r += 12;
  return [r - 12, r, r + (minor ? 3 : 4), r + 7];
}

/**
 * Split a song into lines to hear and sing back. `centre` is the note the singer's voice sits
 * around: the song's own middle is placed there, then moved by `shift` semitones on request.
 * A line ends at a rest; lines too long to remember are cut at their longest held note.
 */
export function lines(song: Song, centre: number, shift = 0): { lines: Line[]; beat: number; bar: number; lo: number; hi: number; first: number } {
  const beat = 60 / song.bpm;
  const { lo, hi } = span(song);
  const home = Math.round(centre - (lo + hi) / 2) + shift;
  interface Abs { midi: number; start: number; dur: number; onset: number; word: string | null; rest: boolean }
  const all: Abs[] = [];
  let t = 0;
  for (const [semi, beats, word] of song.steps) {
    const len = beats * beat;
    if (semi === null) { if (all.length) all[all.length - 1].rest = true; }
    else {
      const full = len - Math.min(0.09, len * 0.12);
      all.push({ midi: home + semi, start: t, dur: song.short ? Math.min(full, Math.max(0.16, beat * 0.45)) : full, onset: len, word: word ?? null, rest: false });
    }
    t += len;
  }
  // First cut at every rest, then cut anything too long at the held note nearest its middle.
  let groups: Abs[][] = [];
  let cur: Abs[] = [];
  for (const n of all) { cur.push(n); if (n.rest) { groups.push(cur); cur = []; } }
  if (cur.length) groups.push(cur);
  const length = (g: Abs[]) => g[g.length - 1].start + g[g.length - 1].onset - g[0].start;
  const cut = (g: Abs[]): Abs[][] => {
    if (length(g) <= MAX_LINE || g.length < 4) return [g];
    const mid = g[0].start + length(g) / 2;
    let best = -1, bestScore = Infinity;
    for (let k = 1; k < g.length - 2; k++) {
      const held = g[k].onset >= beat * 1.9 && !(g[k].word ?? "").endsWith("-");
      const score = Math.abs(g[k].start + g[k].onset - mid) + (held ? 0 : length(g));
      if (score < bestScore) { bestScore = score; best = k; }
    }
    return [...cut(g.slice(0, best + 1)), ...cut(g.slice(best + 1))];
  };
  groups = groups.flatMap(cut);
  const key = home + (song.tonic ?? 0);
  const out: Line[] = groups.map((g) => {
    const t0 = g[0].start, last = g[g.length - 1];
    return {
      notes: g.map((n) => ({ midi: n.midi, start: n.start - t0, dur: n.dur, word: n.word })),
      length: last.start - t0 + Math.max(last.dur, Math.min(last.onset, beat * 2)),
      chord: triad(song.rounds ? last.midi : key, song.minor),
    };
  });
  return { lines: out, beat, bar: beat * song.beatsPerBar, lo: home + lo, hi: home + hi, first: all[0].midi };
}

/**
 * One line as a call and response: the chord, the piano plays the line while the singer
 * listens, the chord again to hold on to, a count-in, then the singer's turn with nothing playing.
 */
export function callAndResponse(line: Line, beat: number, bar: number): Prepared {
  const pre = Math.max(beat * 2, 1.2);
  const gap = Math.max(bar, 1.8);
  const singAt = pre + line.length + gap;
  const notes: Note[] = [
    ...line.notes.map((n, i): Note => ({ i, midi: n.midi, start: pre + n.start, dur: n.dur, word: n.word, role: "cue" })),
    ...line.notes.map((n, i): Note => ({ i: line.notes.length + i, midi: n.midi, start: singAt + n.start, dur: n.dur, word: n.word, role: "solo" })),
  ];
  const count = Math.max(1, Math.min(4, Math.floor((gap - 0.2) / beat)));
  const ticks = Array.from({ length: count }, (_, k) => singAt - (count - k) * beat);
  const midis = line.notes.map((n) => n.midi);
  return {
    notes,
    chords: [{ at: 0, midi: line.chord, dur: pre + 0.4 }, { at: pre + line.length + 0.05, midi: line.chord, dur: gap + Math.min(line.length, 5) }],
    ticks,
    singAt,
    end: singAt + line.length,
    beat,
    lo: Math.min(...midis),
    hi: Math.max(...midis),
  };
}

// ---------------------------------------------------------------- the singer's own songs

const KEY = "vocal-coach-simple.songs";
export function loadCustom(): Song[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Song[]; } catch { return []; }
}
export function saveCustom(songs: Song[]) {
  try { localStorage.setItem(KEY, JSON.stringify(songs)); } catch { /* storage blocked */ }
}
