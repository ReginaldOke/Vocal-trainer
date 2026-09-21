/**
 * The song and drill library. Melodies are stored as semitones from the tonic so every
 * song can be transposed into the singer's range. All tunes are traditional / public domain.
 */

/** [semitones from tonic (null = rest), length in beats, lyric syllable] */
export type SongStep = [number | null, number, string?];

export interface Song {
  id: string;
  title: string;
  credit: string;
  kind: "song" | "drill" | "ear";
  /** 1 (easiest) to 5 */
  tier: 1 | 2 | 3 | 4 | 5;
  bpm: number;
  beatsPerBar: number;
  /** harmony for the piano backing */
  mode?: "major" | "minor";
  /** semitones from the steps' zero to the key's tonic, when the melody is not written from do */
  keyOffset?: number;
  blurb: string;
  steps: SongStep[];
  /** imported by the singer, kept in this browser only */
  custom?: boolean;
  /**
   * Ear training: the piano plays a cue, then goes silent while the singer answers.
   * "match": the cue is the note itself. "interval": the cue is the note `earInterval` below.
   * "silent": no cue at all, only the name of the note.
   */
  ear?: "match" | "interval" | "silent";
  earInterval?: number;
  /** each note's lyric is the vowel to sing, and the vowel is scored as well as the pitch */
  vowels?: boolean;
}

export interface PreparedNote {
  i: number;
  midi: number;
  /** seconds from the start of the take (after the lead-in) */
  start: number;
  dur: number;
  lyric: string | null;
}

export interface PreparedSong {
  song: Song;
  tonic: number;
  notes: PreparedNote[];
  /** indices of notes that end a phrase: a natural place to breathe */
  phraseEnds: number[];
  /** seconds of count-in before the first note */
  leadIn: number;
  /** seconds from take start to the end of the last note */
  end: number;
  beat: number;
  lo: number;
  hi: number;
}

const rest = (beats: number): SongStep => [null, beats];

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

const FIVE_NOTE: SongStep[] = (() => {
  const out: SongStep[] = [];
  const pat = [0, 2, 4, 5, 7, 5, 4, 2, 0];
  for (let k = 0; k < 4; k++) {
    pat.forEach((s, i) => out.push([s + k, i === pat.length - 1 ? 2 : 1, ["do", "re", "mi", "fa", "sol", "fa", "mi", "re", "do"][i]]));
    out.push(rest(2));
  }
  return out;
})();

const OCTAVE: SongStep[] = (() => {
  const up = [0, 2, 4, 5, 7, 9, 11, 12];
  const names = ["do", "re", "mi", "fa", "sol", "la", "ti", "do"];
  const out: SongStep[] = up.map((s, i) => [s, i === up.length - 1 ? 2 : 1, names[i]] as SongStep);
  out.push(rest(1));
  [...up].reverse().forEach((s, i) => out.push([s, i === up.length - 1 ? 2 : 1, [...names].reverse()[i]]));
  return out;
})();

const ARPEGGIO: SongStep[] = (() => {
  const out: SongStep[] = [];
  const pat = [0, 4, 7, 12, 7, 4, 0];
  for (let k = 0; k < 4; k++) {
    pat.forEach((s, i) => out.push([s + 2 * k, i === pat.length - 1 ? 2 : 1, ["do", "mi", "sol", "do", "sol", "mi", "do"][i]]));
    out.push(rest(2));
  }
  return out;
})();

const LONG_TONES: SongStep[] = [
  [0, 4, "ah"], rest(1), [2, 4, "ah"], rest(1), [4, 4, "ah"], rest(1), [5, 4, "ah"], rest(1), [7, 6, "ah"],
];

const LEAPS: SongStep[] = (() => {
  const out: SongStep[] = [];
  for (const top of [4, 5, 7, 9, 12]) out.push([0, 1, "do"], [top, 2, "up"], [0, 1, "do"], rest(1));
  return out;
})();

const MINOR: SongStep[] = (() => {
  const up = [0, 2, 3, 5, 7, 8, 10, 12];
  const out: SongStep[] = up.map((s, i) => [s, i === up.length - 1 ? 2 : 1, "la"] as SongStep);
  out.push(rest(1));
  [...up].reverse().forEach((s, i) => out.push([s, i === up.length - 1 ? 2 : 1, "la"]));
  return out;
})();

/** Ear drills: single notes with rests between, spread over a comfortable fifth. */
const earSteps = (pattern: number[], lyric: (semi: number) => string): SongStep[] => pattern.flatMap((semi): SongStep[] => [[semi, 2, lyric(semi)], [null, 1.5]]);
const EAR_PATTERN = [0, 4, 2, 7, 5, 3, 7, 0, 5, 2];
const SOL = ["do", "di", "re", "ri", "mi", "fa", "fi", "sol", "si", "la", "li", "ti"];

export const SONGS: Song[] = [
  { id: "twinkle", title: "Twinkle Twinkle", credit: "Traditional, Mozart's theme", kind: "song", tier: 1, bpm: 96, beatsPerBar: 4, blurb: "A leap of a fifth, then a gentle walk back down.", steps: TWINKLE },
  { id: "birthday", title: "Happy Birthday", credit: "Traditional", kind: "song", tier: 2, bpm: 90, beatsPerBar: 3, blurb: "The famous octave leap in line three. Aim from above.", steps: BIRTHDAY },
  { id: "grace", title: "Amazing Grace", credit: "Traditional, 1779", kind: "song", tier: 3, bpm: 72, beatsPerBar: 3, blurb: "Slow, exposed and a full octave wide. Every note is on show.", steps: GRACE },
  { id: "silent", title: "Silent Night", credit: "Gruber, 1818", kind: "song", tier: 3, bpm: 88, beatsPerBar: 3, blurb: "Gentle sixths and a soaring last line. Keep the air moving.", steps: SILENT_NIGHT },
  { id: "greensleeves", title: "Greensleeves", credit: "Traditional, 16th c.", kind: "song", tier: 4, bpm: 96, beatsPerBar: 3, mode: "minor", blurb: "A wistful old tune in a minor key. Take the wide leaps gently.", steps: GREENSLEEVES },
  { id: "ode", title: "Ode to Joy", credit: "Beethoven, 1824", kind: "song", tier: 4, bpm: 108, beatsPerBar: 4, blurb: "Long lines that step up and down. Breathe at the ends of phrases.", steps: ODE },
  { id: "ear-match", title: "Match the note", credit: "Ear", kind: "ear", tier: 1, bpm: 80, beatsPerBar: 4, ear: "match", blurb: "Hear one note, then sing it back. The piano stays quiet while you answer.", steps: earSteps(EAR_PATTERN, () => "sing it back") },
  { id: "ear-third", title: "A third up", credit: "Ear", kind: "ear", tier: 2, bpm: 80, beatsPerBar: 4, ear: "interval", earInterval: 4, blurb: "Hear a note, then sing the note two steps above it. Hear it in your head first.", steps: earSteps([0, 2, 5, 3, 7, 0, 4, 2], () => "two steps up") },
  { id: "ear-fifth", title: "A fifth up", credit: "Ear", kind: "ear", tier: 2, bpm: 80, beatsPerBar: 4, ear: "interval", earInterval: 7, blurb: "Hear a note, then sing the one a fifth above, like the start of Twinkle Twinkle.", steps: earSteps([0, 2, 5, 3, 7, 0, 4, 2], () => "a fifth up") },
  { id: "ear-octave", title: "An octave up", credit: "Ear", kind: "ear", tier: 3, bpm: 80, beatsPerBar: 4, ear: "interval", earInterval: 12, blurb: "Hear a note, then sing the same note an octave higher. Think Somewhere Over the Rainbow.", steps: earSteps([0, 2, 5, 3, 0, 4], () => "an octave up") },
  { id: "ear-silent", title: "Inner ear", credit: "Ear", kind: "ear", tier: 3, bpm: 80, beatsPerBar: 4, ear: "silent", blurb: "No piano at all. You see the name of the note; hear it in your head, then sing it.", steps: earSteps(EAR_PATTERN, (semi) => SOL[((semi % 12) + 12) % 12]) },
  { id: "vowel-shapes", title: "Vowel shapes", credit: "Drill", kind: "drill", tier: 2, bpm: 72, beatsPerBar: 4, vowels: true, blurb: "One note, four vowel shapes. Your partner reads each one from the sound.", steps: (["ah", "eh", "ee", "oo"] as const).flatMap((v): SongStep[] => [[0, 2, v], [null, 1]]).concat((["ah", "eh", "ee", "oo"] as const).flatMap((v): SongStep[] => [[4, 2, v], [null, 1]])) },
  { id: "vowel-top", title: "Shape the top", credit: "Drill", kind: "drill", tier: 3, bpm: 108, beatsPerBar: 4, vowels: true, blurb: "Climb on “ah” and let it turn into “uh” for the top two notes. That is how high notes stay easy.", steps: [0, 2, 4, 5, 7].flatMap((semi, i, arr): SongStep[] => [[semi, 1, i >= 3 ? "uh" : "ah"], ...(i === arr.length - 1 ? [[null, 1] as SongStep] : [])]).concat([7, 5, 4, 2, 0].map((semi, i): SongStep => [semi, i === 4 ? 2 : 1, i <= 1 ? "uh" : "ah"])).concat([[null, 2]]).concat([2, 4, 6, 7, 9].flatMap((semi, i, arr): SongStep[] => [[semi, 1, i >= 3 ? "uh" : "ah"], ...(i === arr.length - 1 ? [[null, 1] as SongStep] : [])])).concat([9, 7, 6, 4, 2].map((semi, i): SongStep => [semi, i === 4 ? 2 : 1, i <= 1 ? "uh" : "ah"])) },
  { id: "long-tones", title: "Long Tones", credit: "Drill", kind: "drill", tier: 1, bpm: 60, beatsPerBar: 4, blurb: "Five held notes. Hold each one dead straight for four seconds.", steps: LONG_TONES },
  { id: "five-note", title: "Five-Note Climb", credit: "Drill", kind: "drill", tier: 2, bpm: 132, beatsPerBar: 4, blurb: "Do to sol and back, climbing a semitone each round.", steps: FIVE_NOTE },
  { id: "leaps", title: "Big Leaps", credit: "Drill", kind: "drill", tier: 2, bpm: 100, beatsPerBar: 4, blurb: "Jump up by bigger and bigger steps. Hear the note in your head before you leap.", steps: LEAPS },
  { id: "octave", title: "Octave Scale", credit: "Drill", kind: "drill", tier: 3, bpm: 120, beatsPerBar: 4, blurb: "Eight notes up and back. Get lighter, not louder, near the top.", steps: OCTAVE },
  { id: "arpeggio", title: "Broken Chord Ladder", credit: "Drill", kind: "drill", tier: 3, bpm: 120, beatsPerBar: 4, blurb: "Do mi sol do, rising a tone each round.", steps: ARPEGGIO },
  { id: "minor", title: "Minor Scale", credit: "Drill", kind: "drill", tier: 4, bpm: 116, beatsPerBar: 4, blurb: "A sad-sounding scale up and down. Its lowered notes are easy to push over.", steps: MINOR },
];

export const songById = (id: string) => SONGS.find((s) => s.id === id) ?? SONGS[0];

export const songSpan = (song: Song) => {
  const semis = song.steps.filter((s) => s[0] !== null).map((s) => s[0] as number);
  return { lo: Math.min(...semis), hi: Math.max(...semis) };
};

/**
 * Lay the song out in time at a given tonic. The count-in is at least one bar and at least two
 * seconds so the starting pitch can sound before the first note.
 */
export function prepareSong(song: Song, tonic: number, rate = 1): PreparedSong {
  const beat = 60 / (song.bpm * rate);
  const bar = beat * song.beatsPerBar;
  const leadIn = bar * Math.max(1, Math.ceil(2 / bar));
  const notes: PreparedNote[] = [];
  let t = leadIn;
  for (const [semi, beats, lyric] of song.steps) {
    const len = beats * beat;
    if (semi !== null) {
      // Leave a small gap so repeated notes read as separate tubes.
      const gap = Math.min(0.09, len * 0.12);
      notes.push({ i: notes.length, midi: tonic + semi, start: t, dur: len - gap, lyric: lyric ?? null });
    }
    t += len;
  }
  const { lo, hi } = songSpan(song);
  const last = notes[notes.length - 1];
  return { song, tonic, notes, phraseEnds: findPhraseEnds(notes, beat), leadIn, end: last.start + last.dur, beat, lo: tonic + lo, hi: tonic + hi };
}

/** One line of a prepared song (notes from..to), on its own with a one-bar count-in, for practising. */
export function prepareLine(p: PreparedSong, from: number, to: number): PreparedSong {
  const lead = p.beat * Math.max(p.song.beatsPerBar, Math.ceil(2 / p.beat));
  const shift = p.notes[from].start - lead;
  const notes = p.notes.slice(from, to + 1).map((n, i) => ({ ...n, i, start: n.start - shift }));
  const last = notes[notes.length - 1];
  const midis = notes.map((n) => n.midi);
  return { song: p.song, tonic: p.tonic, notes, phraseEnds: [notes.length - 1], leadIn: lead, end: last.start + last.dur, beat: p.beat, lo: Math.min(...midis), hi: Math.max(...midis) };
}

/**
 * Where a singer would breathe: before a rest, after a long note that finishes a word, and at the end.
 * A heuristic, but folk tunes and hymns follow it closely.
 */
export function findPhraseEnds(notes: PreparedNote[], beat: number): number[] {
  const ends: number[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i], next = notes[i + 1];
    if (!next) { ends.push(i); break; }
    const gap = next.start - (n.start + n.dur);
    // A note that holds for two beats or more (measured onset to onset, since written lengths are
    // trimmed a little for breath) closes a phrase unless the word carries on.
    const longNote = next.start - n.start >= beat * 1.9 && !(n.lyric ?? "").endsWith("-");
    if (gap > 0.25 || longNote) ends.push(i);
  }
  return ends;
}

export type VoicePreset = "low" | "mid" | "high" | "auto";

/** Comfortable middle of each voice preset, as a MIDI note. */
const PRESET_CENTRE: Record<Exclude<VoicePreset, "auto">, number> = { low: 54, mid: 60, high: 66 };

/** The note the tune spends most of its time on, weighted by length: where the song "sits". */
export function songSeat(song: Song) {
  const w = new Map<number, number>();
  for (const [semi, beats] of song.steps) if (semi !== null) w.set(semi, (w.get(semi) ?? 0) + beats);
  const total = [...w.values()].reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const [semi, beats] of [...w.entries()].sort((a, b) => a[0] - b[0])) { acc += beats; if (acc >= total / 2) return semi; }
  return 0;
}

/**
 * Pick a key for the song. With a measured voice, put where the song sits on where the voice sits
 * most easily, then make sure the highest note stays inside the comfortable range. Otherwise centre it.
 */
export function chooseTonic(song: Song, preset: VoicePreset, calibrated: { low: number; high: number; comfort?: number } | null, transpose: number) {
  const { lo, hi } = songSpan(song);
  if (preset === "auto" && calibrated) {
    const seat = calibrated.comfort ?? calibrated.low + (calibrated.high - calibrated.low) * 0.45;
    let tonic = Math.round(seat - songSeat(song));
    // The climax should sit a note or two inside the top of the range, and nothing below the bottom.
    tonic = Math.min(tonic, Math.round(calibrated.high - 1 - hi));
    tonic = Math.max(tonic, Math.round(calibrated.low + 1 - lo));
    return tonic + transpose;
  }
  const centre = PRESET_CENTRE[preset === "auto" ? "mid" : preset];
  return Math.round(centre - (lo + hi) / 2) + transpose;
}

/** Lay out an arbitrary note list (for example an assessment exercise) as a flow-mode song. */
export function prepareFromNotes(id: string, title: string, notes: { midi: number; start: number; dur: number; lyric?: string | null }[], bpm = 100): PreparedSong {
  const t0 = notes[0]?.start ?? 0;
  const laid: PreparedNote[] = notes.map((n, i) => ({ i, midi: n.midi, start: n.start - t0, dur: n.dur, lyric: n.lyric ?? null }));
  const last = laid[laid.length - 1];
  const midis = laid.map((n) => n.midi);
  return {
    song: { id, title, credit: "", kind: "drill", tier: 1, bpm, beatsPerBar: 4, blurb: "", steps: [] },
    tonic: Math.min(...midis),
    notes: laid,
    phraseEnds: findPhraseEnds(laid, 60 / bpm),
    leadIn: 0,
    end: last ? last.start + last.dur : 0,
    beat: 60 / bpm,
    lo: Math.min(...midis),
    hi: Math.max(...midis),
  };
}

const CUSTOM_KEY = "vocal-coach.songs.v1";

export function loadCustomSongs(): Song[] {
  try { return (JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]") as Song[]).map((s) => ({ ...s, custom: true })); }
  catch { return []; }
}

export function saveCustomSongs(songs: Song[]) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(songs)); } catch { /* storage full or blocked */ }
}
