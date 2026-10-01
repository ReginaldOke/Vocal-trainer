/**
 * Songs and exercises as steps from a home note: [semitones or null for a rest, beats, word].
 * A fourth entry marks a note the piano plays alone for the singer to hear ("cue"), or one the
 * singer sings with no piano under it ("solo"). Everything shipped here is in the public domain.
 */
export type SongStep = [number | null, number, string?, ("cue" | "solo")?];

export interface Song {
  id: string;
  title: string;
  credit?: string;
  emoji: string;
  bpm: number;
  beatsPerBar: number;
  steps: SongStep[];
  /** every note is sung short and sharp */
  short?: boolean;
  /** imported by the singer; kept in this browser only */
  custom?: boolean;
}

export interface Note {
  i: number;
  midi: number;
  /** seconds from the start of the take, after the count-in */
  start: number;
  dur: number;
  word: string | null;
  role: "both" | "cue" | "solo";
}

export interface Prepared {
  song: Song;
  notes: Note[];
  /** seconds of count-in before the first note */
  lead: number;
  end: number;
  beat: number;
  lo: number;
  hi: number;
}

const TWINKLE: SongStep[] = [
  [0, 1, "Twin-"], [0, 1, "kle"], [7, 1, "twin-"], [7, 1, "kle"], [9, 1, "lit-"], [9, 1, "tle"], [7, 2, "star"],
  [5, 1, "how"], [5, 1, "I"], [4, 1, "won-"], [4, 1, "der"], [2, 1, "what"], [2, 1, "you"], [0, 2, "are"],
  [7, 1, "Up"], [7, 1, "a-"], [5, 1, "bove"], [5, 1, "the"], [4, 1, "world"], [4, 1, "so"], [2, 2, "high"],
  [7, 1, "like"], [7, 1, "a"], [5, 1, "dia-"], [5, 1, "mond"], [4, 1, "in"], [4, 1, "the"], [2, 2, "sky"],
  [0, 1, "Twin-"], [0, 1, "kle"], [7, 1, "twin-"], [7, 1, "kle"], [9, 1, "lit-"], [9, 1, "tle"], [7, 2, "star"],
  [5, 1, "how"], [5, 1, "I"], [4, 1, "won-"], [4, 1, "der"], [2, 1, "what"], [2, 1, "you"], [0, 2, "are"],
];

const BIRTHDAY: SongStep[] = [
  [-5, 0.75, "Hap-"], [-5, 0.25, "py"], [-3, 1, "birth-"], [-5, 1, "day"], [0, 1, "to"], [-1, 2, "you"],
  [-5, 0.75, "Hap-"], [-5, 0.25, "py"], [-3, 1, "birth-"], [-5, 1, "day"], [2, 1, "to"], [0, 2, "you"],
  [-5, 0.75, "Hap-"], [-5, 0.25, "py"], [7, 1, "birth-"], [4, 1, "day"], [0, 1, "dear"], [-1, 1, "sing-"], [-3, 2, "er"],
  [5, 0.75, "Hap-"], [5, 0.25, "py"], [4, 1, "birth-"], [0, 1, "day"], [2, 1, "to"], [0, 2, "you"],
];

const ODE: SongStep[] = [
  [4, 1, "Joy-"], [4, 1, "ful"], [5, 1, "joy-"], [7, 1, "ful"], [7, 1, "we"], [5, 1, "a-"], [4, 1, "dore"], [2, 1, "thee"],
  [0, 1, "God"], [0, 1, "of"], [2, 1, "glo-"], [4, 1, "ry"], [4, 1.5, "Lord"], [2, 0.5, "of"], [2, 2, "love"],
  [4, 1, "Hearts"], [4, 1, "un-"], [5, 1, "fold"], [7, 1, "like"], [7, 1, "flow'rs"], [5, 1, "be-"], [4, 1, "fore"], [2, 1, "thee"],
  [0, 1, "o-"], [0, 1, "pening"], [2, 1, "to"], [4, 1, "the"], [2, 1.5, "sun"], [0, 0.5, "a-"], [0, 2, "bove"],
  [2, 1, "Melt"], [2, 1, "the"], [4, 1, "clouds"], [0, 1, "of"], [2, 1, "sin"], [4, 0.5, "and"], [5, 0.5, "sad-"], [4, 1, "ness"],
  [0, 1, "drive"], [2, 1, "the"], [4, 0.5, "dark"], [5, 0.5, "of"], [4, 1, "doubt"], [2, 1, "a-"], [0, 1, "way"], [2, 1, "Giv-"], [-5, 2, "er"],
  [4, 1, "of"], [4, 1, "im-"], [5, 1, "mor-"], [7, 1, "tal"], [7, 1, "glad-"], [5, 1, "ness"], [4, 1, "fill"], [2, 1, "us"],
  [0, 1, "with"], [0, 1, "the"], [2, 1, "light"], [4, 1, "of"], [2, 1.5, "day"], [0, 0.5, "a-"], [0, 2, "bove"],
];

const GRACE: SongStep[] = [
  [-5, 1, "A-"], [0, 2, "ma-"], [4, 0.5, "zing"], [0, 0.5, ""], [4, 2, "grace"], [2, 1, "how"], [0, 2, "sweet"], [-3, 1, "the"],
  [-5, 2, "sound"], [-5, 1, "that"], [0, 2, "saved"], [4, 0.5, "a"], [0, 0.5, ""], [4, 2, "wretch"], [2, 1, "like"], [7, 3, "me"],
  [7, 1, "I"], [4, 2, "once"], [7, 0.5, "was"], [4, 0.5, ""], [4, 2, "lost"], [2, 1, "but"], [0, 2, "now"], [-3, 1, "am"],
  [-5, 2, "found"], [-5, 1, "was"], [0, 2, "blind"], [4, 0.5, "but"], [0, 0.5, ""], [4, 2, "now"], [2, 1, "I"], [0, 3, "see"],
];

/** “Silent Night” (Gruber, 1818). In 6/8: a dotted quarter is 1.5 beats. */
const SILENT_NIGHT: SongStep[] = [
  [7, 1.5, "Si-"], [9, 0.5, "lent"], [7, 1, "night"], [4, 3, ""], [7, 1.5, "ho-"], [9, 0.5, "ly"], [7, 1, "night"], [4, 3, ""],
  [2, 2, "All"], [2, 1, "is"], [-1, 3, "calm"], [0, 2, "all"], [0, 1, "is"], [-5, 3, "bright"],
  [9, 2, "Round"], [9, 1, "yon"], [12, 1.5, "vir-"], [11, 0.5, ""], [9, 1, "gin"], [7, 1.5, "mo-"], [9, 0.5, "ther"], [7, 1, "and"], [4, 3, "child"],
  [9, 2, "Ho-"], [9, 1, "ly"], [12, 1.5, "in-"], [11, 0.5, ""], [9, 1, "fant"], [7, 1.5, "so"], [9, 0.5, "ten-"], [7, 1, "der"], [4, 3, "and mild"],
  [2, 2, "Sleep"], [2, 1, "in"], [5, 1.5, "heav-"], [2, 0.5, "en-"], [-1, 1, "ly"], [0, 3, "peace"],
  [12, 2, "Sleep"], [7, 1, "in"], [4, 1.5, "heav-"], [7, 0.5, "en-"], [5, 1, "ly"], [2, 1, "peace"], [0, 3, ""],
];

/** “Greensleeves” (traditional, 16th century), the verse. Minor: semitones from the tonic A. */
const GREENSLEEVES: SongStep[] = [
  [0, 1, "A-"], [3, 2, "las"], [5, 1, "my"], [7, 1.5, "love"], [8, 0.5, "you"], [7, 1, "do"],
  [5, 2, "me"], [2, 1, "wrong"], [-2, 1.5, "to"], [0, 0.5, "cast"], [2, 1, "me"],
  [3, 2, "off"], [0, 1, "dis-"], [0, 1.5, "cour-"], [-1, 0.5, "teous-"], [0, 1, "ly"], [2, 2, ""], [-1, 1, ""], [-5, 2, ""],
  [0, 1, "And"], [3, 2, "I"], [5, 1, "have"], [7, 1.5, "loved"], [8, 0.5, "you"], [7, 1, "oh"],
  [5, 2, "so"], [2, 1, "long"], [-2, 1.5, "de-"], [0, 0.5, "light-"], [2, 1, "ing"],
  [3, 1.5, "in"], [2, 0.5, "your"], [0, 1, "com-"], [-1, 1.5, "pa-"], [-3, 0.5, ""], [-1, 2, "ny"], [0, 3, ""],
];

export const SONGS: Song[] = [
  { id: "twinkle", title: "Twinkle Twinkle", credit: "Traditional", emoji: "⭐", bpm: 96, beatsPerBar: 4, steps: TWINKLE },
  { id: "birthday", title: "Happy Birthday", credit: "Traditional", emoji: "🎂", bpm: 90, beatsPerBar: 3, steps: BIRTHDAY },
  { id: "grace", title: "Amazing Grace", credit: "Traditional, 1779", emoji: "🕊️", bpm: 72, beatsPerBar: 3, steps: GRACE },
  { id: "silent", title: "Silent Night", credit: "Gruber, 1818", emoji: "🌙", bpm: 88, beatsPerBar: 3, steps: SILENT_NIGHT },
  { id: "greensleeves", title: "Greensleeves", credit: "Traditional", emoji: "🌿", bpm: 96, beatsPerBar: 3, steps: GREENSLEEVES },
  { id: "ode", title: "Ode to Joy", credit: "Beethoven, 1824", emoji: "🎻", bpm: 108, beatsPerBar: 4, steps: ODE },
];

// ---------------------------------------------------------------- exercises

/** A pattern sung in one key, then a step higher, and so on up and back down, as a teacher leads from the piano. */
function climbing(pattern: SongStep[], keys: number[], gap = 2): SongStep[] {
  return keys.flatMap((k): SongStep[] => [...pattern.map(([semi, beats, word, role]): SongStep => [semi === null ? null : semi + k, beats, word, role]), [null, gap]]);
}
const UP_AND_BACK = [0, 1, 2, 3, 4, 3, 2, 1, 0];
const UP_A_LITTLE = [0, 1, 2, 3, 2, 1, 0];
const five = (w: string): SongStep[] => [7, 5, 4, 2, 0].map((n): SongStep => [n, 1, w]);
const scale = (w: string): SongStep[] => [0, 2, 4, 5, 7, 5, 4, 2].map((n): SongStep => [n, 1, w]);
const fromTheTop = (w: string) => climbing([[12, 1, w], [7, 1, w], [4, 1, w], [0, 2, w]], UP_A_LITTLE);
/** The piano plays a note, then the singer sings it back alone. */
const echo = (semis: number[]): SongStep[] => semis.flatMap((n): SongStep[] => [[n, 2, "listen", "cue"], [n, 2, "sing", "solo"], [null, 1]]);

const ex = (id: string, title: string, bpm: number, steps: SongStep[], short = false): Song => ({ id, title, emoji: "🎵", bpm, beatsPerBar: 4, steps, short });

export const EXERCISES = {
  ng: ex("ng", "Five notes on “ng”", 100, climbing([...scale("ng"), [0, 2, "ng"]], [0, 1, 2, 3, 2, 1, 0])),
  ah: ex("ah", "Short, sharp “ah”", 104, climbing([...five("ah"), ...five("ah")], UP_AND_BACK), true),
  humShort: ex("hum-short", "Creaky door", 104, climbing([...scale("mm"), [0, 1, "mm"]], UP_AND_BACK), true),
  humSmooth: ex("hum-smooth", "Creaky door, joined up", 104, climbing([...scale("mm"), [0, 2, "mm"]], UP_AND_BACK)),
  goo: ex("goo", "“Goo” from the top", 96, fromTheTop("goo"), true),
  koo: ex("koo", "“Koo” from the top", 96, fromTheTop("koo"), true),
  gug: ex("gug", "“Gug”", 96, fromTheTop("gug"), true),
  long: ex("long", "Long notes", 60, [0, 2, 4, 5, 7].flatMap((n): SongStep[] => [[n, 4, "ah"], [null, 2]])),
  echo: ex("echo", "Hear it, sing it back", 80, echo([0, 4, 7, 2, 5, 9, 7, 0])),
  echoLeap: ex("echo-leap", "Bigger steps", 80, echo([0, 7, 4, 12, 5, 9, 2, 0])),
};

// ---------------------------------------------------------------- laying a song out in time

export function span(song: Song) {
  const semis = song.steps.map((s) => s[0]).filter((s): s is number => s !== null);
  return { lo: Math.min(...semis), hi: Math.max(...semis) };
}

/**
 * Lay a song out in seconds. `centre` is the note the singer's voice sits around: the song's own
 * middle is placed there, then moved by `shift` semitones if the singer asked for higher or lower.
 */
export function prepare(song: Song, centre: number, shift = 0, rate = 1): Prepared {
  const beat = 60 / (song.bpm * rate);
  const { lo, hi } = span(song);
  const home = Math.round(centre - (lo + hi) / 2) + shift;
  const lead = beat * Math.max(song.beatsPerBar, Math.ceil(2 / beat));
  const notes: Note[] = [];
  let t = lead;
  for (const [semi, beats, word, role] of song.steps) {
    const len = beats * beat;
    if (semi !== null) {
      const full = len - Math.min(0.09, len * 0.12);
      notes.push({ i: notes.length, midi: home + semi, start: t, dur: song.short ? Math.min(full, Math.max(0.16, beat * 0.45)) : full, word: word ?? null, role: role ?? "both" });
    }
    t += len;
  }
  const last = notes[notes.length - 1];
  return { song, notes, lead, end: last.start + last.dur, beat, lo: home + lo, hi: home + hi };
}

// ---------------------------------------------------------------- the singer's own songs

const KEY = "vocal-coach-simple.songs";
export function loadCustom(): Song[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Song[]; } catch { return []; }
}
export function saveCustom(songs: Song[]) {
  try { localStorage.setItem(KEY, JSON.stringify(songs)); } catch { /* storage blocked */ }
}
