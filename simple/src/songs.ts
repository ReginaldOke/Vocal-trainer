/**
 * Exercises as steps from a home note: [semitones or null for a rest, beats, syllable].
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

/** A line laid out as hear-then-sing: chord, the piano plays the line, chord again, then the singer in their own time. */
export interface Prepared {
  /** the line twice: first for the piano ("cue", on the clock), then for the singer ("solo", whose times only space the notes out on screen) */
  notes: Note[];
  /** when the piano strikes the chord: once before the tune, once as the singer's turn begins */
  chords: { at: number; midi: number[]; dur: number }[];
  /** when the singer's turn starts */
  singAt: number;
  /** how long the line is, for spacing it on screen */
  length: number;
  lo: number;
  hi: number;
}

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
  melodies: {
    id: "melodies", title: "Match a melody", bpm: 84, beatsPerBar: 4,
    steps: [[0, 2, 4], [4, 2, 0], [0, 4, 7], [7, 4, 0], [0, 2, 4, 5, 7], [7, 5, 4, 2, 0], [0, 7, 4, 0], [0, 4, 7, 12], [12, 7, 4, 0], [4, 7, 5, 2, 0]]
      .flatMap((m): SongStep[] => [...m.map((n, i): SongStep => [n, i === m.length - 1 ? 2 : 1, "la"]), [null, 2]]),
  } as Song,
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
 * One line as a call and response: the chord, the piano plays the line while the singer listens,
 * the chord again to hold on to, then the singer's turn. Nothing counts them in and nothing plays
 * the tune under them; they sing it back at their own pace.
 */
export function callAndResponse(line: Line, beat: number): Prepared {
  const pre = Math.max(beat * 2, 1.2);
  const singAt = pre + line.length + 0.35;
  const notes: Note[] = [
    ...line.notes.map((n, i): Note => ({ i, midi: n.midi, start: pre + n.start, dur: n.dur, word: n.word, role: "cue" })),
    ...line.notes.map((n, i): Note => ({ i: line.notes.length + i, midi: n.midi, start: n.start, dur: n.dur, word: n.word, role: "solo" })),
  ];
  const midis = line.notes.map((n) => n.midi);
  return {
    notes,
    chords: [{ at: 0, midi: line.chord, dur: pre + 0.4 }, { at: pre + line.length + 0.1, midi: line.chord, dur: 3.5 }],
    singAt,
    length: line.length,
    lo: Math.min(...midis),
    hi: Math.max(...midis),
  };
}
