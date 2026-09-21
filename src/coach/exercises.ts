import type { Calibration } from "../audio/analysis";
import type { Frame } from "../audio/frame";
import { foldedCents } from "./rules";
import type { GameRun } from "../game/scoring";

export interface TargetNote {
  midi: number;
  /** seconds from the start of the take */
  start: number;
  dur: number;
}

export interface Exercise {
  id: "hold" | "song" | "scale";
  title: string;
  instruction: string;
  notes: TargetNote[];
  /** seconds of lead-in before the first note: starting pitch, then a count-in */
  leadIn: number;
}

export interface NoteScore {
  target: number;
  /** median error in cents, NaN if the note was not sung */
  cents: number;
  inTune: number;
}

export interface ExerciseScore {
  id: Exercise["id"];
  notes: NoteScore[];
  meanAbsCents: number;
  biasCents: number;
  pctInTune: number;
}

const LEAD_IN = 3;

function sequence(steps: [number, number][], beat: number, offset = LEAD_IN): TargetNote[] {
  let t = offset;
  return steps.map(([midi, beats]) => {
    const n = { midi, start: t, dur: beats * beat };
    t += beats * beat;
    return n;
  });
}

export function buildHold(cal: Calibration): Exercise {
  const midi = Math.round(cal.low + (cal.high - cal.low) * 0.4);
  return {
    id: "hold",
    title: "Hold one note",
    instruction: "Listen to the note, then sing it on “ah” and hold it as evenly as you can for six seconds.",
    notes: [{ midi, start: LEAD_IN, dur: 6 }],
    leadIn: LEAD_IN,
  };
}

/** “Happy Birthday” (melody in the public domain). Semitones from the tonic, length in beats. */
const BIRTHDAY: [number, number][] = [
  [-5, 0.75], [-5, 0.25], [-3, 1], [-5, 1], [0, 1], [-1, 2],
  [-5, 0.75], [-5, 0.25], [-3, 1], [-5, 1], [2, 1], [0, 2],
  [-5, 0.75], [-5, 0.25], [7, 1], [4, 1], [0, 1], [-1, 1], [-3, 2],
  [5, 0.75], [5, 0.25], [4, 1], [0, 1], [2, 1], [0, 2],
];

export function buildSong(cal: Calibration): Exercise {
  // The tune spans an octave. Sit it in the lower-middle of the range where the voice is most at ease.
  const span = cal.high - cal.low;
  const margin = Math.max(2, Math.min(7, Math.round((span - 12) * 0.3)));
  const tonic = Math.round(cal.low) + 5 + margin;
  return {
    id: "song",
    title: "Happy Birthday",
    instruction: "Sing “Happy Birthday” along with the bars. It has an octave leap in the third line, which shows how you handle a jump.",
    notes: sequence(BIRTHDAY.map(([s, b]) => [tonic + s, b]), 0.68),
    leadIn: LEAD_IN,
  };
}

export function buildScale(cal: Calibration): Exercise {
  // Three five-note scales, each a tone higher, so the last one reaches toward the register break.
  const top = Math.round(cal.low + (cal.high - cal.low) * 0.72);
  const pattern = [0, 2, 4, 5, 7, 5, 4, 2, 0];
  const notes: TargetNote[] = [];
  let t = LEAD_IN;
  for (let k = 0; k < 3; k++) {
    const root = top - 7 - 2 * (2 - k);
    pattern.forEach((semi, i) => {
      const dur = i === pattern.length - 1 ? 1.1 : 0.55;
      notes.push({ midi: root + semi, start: t, dur });
      t += dur;
    });
    t += 1.4;
  }
  return {
    id: "scale",
    title: "Five-note scale",
    instruction: "Sing each scale on “ah”, up five notes and back down. Get slightly lighter, not louder, as you go up.",
    notes,
    leadIn: LEAD_IN,
  };
}

export function targetAt(ex: Exercise, t: number): TargetNote | null {
  for (const n of ex.notes) if (t >= n.start && t < n.start + n.dur) return n;
  return null;
}

/** Mic, analysis window and reaction time put the sung pitch a little behind the bars. */
const LATENCY = 0.08;

export function scoreExercise(ex: Exercise, frames: Frame[], takeStart: number): ExerciseScore {
  const notes: NoteScore[] = ex.notes.map((n) => {
    const settle = Math.min(0.15, n.dur * 0.3);
    const errs = frames
      .filter((f) => f.voiced && f.t - takeStart - LATENCY >= n.start + settle && f.t - takeStart - LATENCY < n.start + n.dur)
      .map((f) => foldedCents(f.midi, n.midi))
      .sort((a, b) => a - b);
    if (errs.length < 3) return { target: n.midi, cents: NaN, inTune: 0 };
    return { target: n.midi, cents: errs[errs.length >> 1], inTune: errs.filter((e) => Math.abs(e) <= 30).length / errs.length };
  });
  const sung = notes.filter((n) => !Number.isNaN(n.cents));
  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  return {
    id: ex.id,
    notes,
    meanAbsCents: avg(sung.map((n) => Math.abs(n.cents))),
    biasCents: avg(sung.map((n) => n.cents)),
    pctInTune: sung.length ? (100 * sung.filter((n) => Math.abs(n.cents) <= 30).length) / notes.length : 0,
  };
}

/** The same summary, taken from a self-paced run instead of a timed take. */
export function scoreFromRun(id: Exercise["id"], run: GameRun): ExerciseScore {
  const notes: NoteScore[] = run.notes.map((n) => {
    const errs = [...n.errs].sort((a, b) => a - b);
    if (errs.length < 3) return { target: n.midi, cents: NaN, inTune: 0 };
    return { target: n.midi, cents: errs[errs.length >> 1], inTune: errs.filter((e) => Math.abs(e) <= 30).length / errs.length };
  });
  const sung = notes.filter((n) => !Number.isNaN(n.cents));
  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  return {
    id,
    notes,
    meanAbsCents: avg(sung.map((n) => Math.abs(n.cents))),
    biasCents: avg(sung.map((n) => n.cents)),
    pctInTune: sung.length ? (100 * sung.filter((n) => Math.abs(n.cents) <= 30).length) / notes.length : 0,
  };
}
