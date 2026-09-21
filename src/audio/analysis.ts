import type { Frame } from "./frame";

export type Register = "chest" | "mix" | "head" | "unknown";
export type Wobble = "steady" | "vibrato" | "slow-wobble" | "unsteady" | "glide" | "too-short";

export interface Calibration {
  /** lowest and highest comfortable notes (MIDI) from the range exercise */
  low: number;
  high: number;
  /** typical harmonic "weight" of this singer's low chest voice, in dB */
  chestWeight: number;
  /** quietest room level seen in the mic check, dBFS */
  noiseDb: number;
}

export interface NoteStats {
  start: number;
  end: number;
  /** settled pitch, fractional MIDI */
  median: number;
  /** pitch spread once settled, in cents */
  stdCents: number;
  driftCentsPerSec: number;
  dbMean: number;
  dbStd: number;
  dbSlope: number;
  wobble: Wobble;
  vibratoRate: number;
  vibratoExtent: number;
  periodicity: number;
  /** present only when the note started a phrase (came after silence) */
  scoop: { cents: number; seconds: number } | null;
  /** cents the pitch sagged or wobbled in the final 350 ms while the volume fell */
  endSag: number;
}

export type TrackerEvent =
  | { type: "note-end"; note: NoteStats }
  | { type: "scoop"; cents: number; seconds: number }
  | { type: "crack"; t: number; from: number; to: number };

export interface LiveState {
  frame: Frame | null;
  register: Register;
  headProb: number;
  strain: number;
  /** spread of the pitch over the last second of the current note, cents. NaN if no note is held. */
  steadiness: number;
  note: NoteStats | null;
  typicalDb: number;
}

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
};
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const std = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};
const slope = (x: number[], y: number[]) => {
  const mx = mean(x), my = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  return den ? num / den : 0;
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Looks for a regular oscillation in a pitch contour (cents vs seconds). */
export function analyseOscillation(t: number[], cents: number[]) {
  const dur = t[t.length - 1] - t[0];
  if (dur < 0.9) return null;
  // Resample to a uniform 50 Hz grid because animation frames arrive unevenly.
  const fs = 50, n = Math.floor(dur * fs);
  const y: number[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const ti = t[0] + i / fs;
    while (j < t.length - 2 && t[j + 1] < ti) j++;
    const f = (ti - t[j]) / Math.max(1e-6, t[j + 1] - t[j]);
    y.push(cents[j] + clamp01(f) * (cents[j + 1] - cents[j]));
  }
  const xs = y.map((_, i) => i / fs);
  const k = slope(xs, y), my = mean(y), mx = mean(xs);
  const r = y.map((v, i) => v - my - k * (xs[i] - mx));
  const variance = mean(r.map((v) => v * v));
  let bestF = 0, bestA = 0;
  for (let f = 2; f <= 10; f += 0.2) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const ph = 2 * Math.PI * f * xs[i];
      re += r[i] * Math.cos(ph);
      im -= r[i] * Math.sin(ph);
    }
    const amp = (2 * Math.hypot(re, im)) / n;
    if (amp > bestA) {
      bestA = amp;
      bestF = f;
    }
  }
  // The ~80 ms analysis window averages out part of a fast oscillation, so scale the depth back up.
  const x = Math.PI * bestF * 0.078;
  bestA *= x / Math.sin(x);
  return { rate: bestF, extent: 2 * bestA, periodicity: variance > 0 ? clamp01((bestA * bestA) / 2 / variance) : 0, std: Math.sqrt(variance) };
}

export class Tracker {
  calibration: Calibration | null = null;
  readonly history: Frame[] = [];
  readonly notes: NoteStats[] = [];
  events: TrackerEvent[] = [];
  phraseCount = 0;
  scoopCount = 0;
  crackCount = 0;
  strainSeconds = 0;
  voicedSeconds = 0;
  minMidi = Infinity;
  maxMidi = -Infinity;

  private seg: Frame[] = [];
  private run: Frame[] = [];
  private lastVoicedT = -10;
  private prev: Frame | null = null;
  private lastVoiced: Frame | null = null;
  private headProb = 0;
  private strain = 0;
  private typicalDb = -30;
  private scoopReported = false;
  private noteInRun = false;
  private cached: { n: number; note: NoteStats | null } = { n: -1, note: null };

  reset() {
    this.history.length = 0;
    this.notes.length = 0;
    this.events = [];
    this.seg = [];
    this.run = [];
    this.phraseCount = this.scoopCount = this.crackCount = 0;
    this.strainSeconds = this.voicedSeconds = 0;
    this.minMidi = Infinity;
    this.maxMidi = -Infinity;
    this.prev = null;
  }

  push(f: Frame): LiveState {
    const h = this.history;
    h.push(f);
    if (h.length > 3000) h.splice(0, 600);
    const dt = this.prev ? Math.min(0.1, f.t - this.prev.t) : 0;

    if (f.voiced) {
      if (f.t - this.lastVoicedT > 0.15) {
        this.endSegment();
        this.run = [];
        this.phraseCount++;
        this.scoopReported = false;
        this.noteInRun = false;
      }
      this.lastVoicedT = f.t;
      this.run.push(f);
      this.voicedSeconds += dt;
      this.typicalDb += 0.01 * (f.db - this.typicalDb);

      // A crack: the pitch leaps upward and the tone thins out at the same moment (chest flipping to
      // falsetto). Downward leaps are left alone because they are usually just the melody.
      const p = this.lastVoiced;
      if (p && f.t - p.t < 0.15) {
        const jump = f.midi - p.midi;
        const octaveSlip = Math.abs(Math.abs(jump) - 12) < 0.5;
        if (jump >= 4 && !octaveSlip && f.weight - p.weight < -8) {
          this.crackCount++;
          this.events.push({ type: "crack", t: f.t, from: p.midi, to: f.midi });
        }
      }
      this.lastVoiced = f;

      if (this.seg.length) {
        const ref = median(this.seg.slice(-25).map((s) => s.midi));
        if (Math.abs(f.midi - ref) > 0.7) this.endSegment();
      }
      this.seg.push(f);
      this.updateRegister(f, dt);
      this.updateStrain(f, dt);
    } else {
      if (f.t - this.lastVoicedT > 0.06) this.endSegment();
      this.strain *= 0.9;
    }
    this.prev = f;

    const note = this.liveNote();
    if (note?.scoop && !this.scoopReported) {
      this.scoopReported = true;
      this.scoopCount++;
      this.events.push({ type: "scoop", ...note.scoop });
    }

    let steadiness = NaN;
    if (note) {
      const recent = this.seg.filter((s) => s.t > f.t - 1 && s.t >= note.start);
      if (recent.length > 8) steadiness = std(recent.map((s) => s.midi * 100));
    }
    return {
      frame: f,
      register: !f.voiced ? "unknown" : this.headProb > 0.65 ? "head" : this.headProb > 0.38 ? "mix" : "chest",
      headProb: this.headProb,
      strain: this.strain,
      steadiness,
      note,
      typicalDb: this.typicalDb,
    };
  }

  private endSegment() {
    const note = this.liveNote();
    if (note && note.end - note.start >= 0.45) {
      // Only now can we judge how the note finished.
      note.endSag = this.endSag(note);
      this.notes.push(note);
      this.noteInRun = true;
      this.events.push({ type: "note-end", note });
    }
    this.seg = [];
    this.cached = { n: -1, note: null };
  }

  private endSag(note: NoteStats) {
    const tail = this.seg.filter((s) => s.t > note.end - 0.35);
    const body = this.seg.filter((s) => s.t <= note.end - 0.35 && s.t >= note.start);
    if (tail.length < 5 || body.length < 10) return 0;
    const falling = mean(tail.map((s) => s.db)) < mean(body.map((s) => s.db)) - 3;
    const dev = Math.max(...tail.map((s) => Math.abs(s.midi - note.median) * 100));
    return falling && dev > 45 ? dev : 0;
  }

  /** Statistics for the note being held right now (null until it has lasted 0.35 s). */
  private liveNote(): NoteStats | null {
    const seg = this.seg;
    if (seg.length === this.cached.n) return this.cached.note;
    this.cached.n = seg.length;
    this.cached.note = null;
    if (seg.length < 12 || seg[seg.length - 1].t - seg[0].t < 0.35) return null;

    // The settled pitch is judged from the second half, so a slow slide-in does not drag it down.
    const settled = median(seg.slice(seg.length >> 1).map((s) => s.midi));
    let i0 = seg.findIndex((s) => Math.abs(s.midi - settled) < 0.3);
    if (i0 < 0) i0 = 0;
    const core = seg.slice(i0);
    if (core.length < 8) return null;

    const t = core.map((s) => s.t), cents = core.map((s) => (s.midi - settled) * 100), dbs = core.map((s) => s.db);
    const drift = slope(t, cents);
    const dur = t[t.length - 1] - t[0];

    let wobble: Wobble = "too-short", rate = 0, extent = 0, periodicity = 0;
    const from = Math.max(0, core.findIndex((s) => s.t > t[t.length - 1] - 1.6));
    const osc = analyseOscillation(t.slice(from), cents.slice(from));
    if (Math.abs(drift) > 150 && dur > 0.5) wobble = "glide";
    else if (osc) {
      rate = osc.rate;
      extent = osc.extent;
      periodicity = osc.periodicity;
      if (osc.periodicity > 0.65 && rate >= 4.3 && rate <= 7.8 && extent >= 30 && extent <= 170) wobble = "vibrato";
      else if (osc.periodicity > 0.55 && rate < 4.3 && extent > 40) wobble = "slow-wobble";
      else if (osc.std > 22) wobble = "unsteady";
      else wobble = "steady";
    }

    // A scoop only counts on the first note of a phrase: slides between notes are legato, not a fault.
    let scoop: NoteStats["scoop"] = null;
    const run = this.run;
    if (run.length && !this.noteInRun && seg[0].t - run[0].t < 1.2) {
      const arrive = run.find((s) => Math.abs(s.midi - settled) < 0.3);
      const startOffset = (median(run.slice(0, 3).map((s) => s.midi)) - settled) * 100;
      if (arrive && arrive.t - run[0].t >= 0.22 && startOffset <= -80) scoop = { cents: startOffset, seconds: arrive.t - run[0].t };
    }

    const note: NoteStats = {
      start: core[0].t,
      end: t[t.length - 1],
      median: settled,
      stdCents: std(cents.map((c, i) => c - drift * (t[i] - t[0]))),
      driftCentsPerSec: drift,
      dbMean: mean(dbs),
      dbStd: std(dbs),
      dbSlope: slope(t, dbs),
      wobble,
      vibratoRate: rate,
      vibratoExtent: extent,
      periodicity,
      scoop,
      endSag: 0,
    };
    this.cached.note = note;
    this.minMidi = Math.min(this.minMidi, settled);
    this.maxMidi = Math.max(this.maxMidi, settled);
    return note;
  }

  /**
   * Register is inferred, not measured. Head voice and falsetto put most of their energy in the
   * fundamental, chest voice spreads it across the harmonics. We compare against this singer's own
   * low chest sound when it is known, and nudge the estimate by where the note sits in their range.
   */
  private updateRegister(f: Frame, dt: number) {
    const cal = this.calibration;
    const chestWeight = cal ? cal.chestWeight : 8;
    // Note releases go breathy and would read as head voice, so skip them.
    if (f.db < this.typicalDb - 12) return;
    const lighter = chestWeight - f.weight; // dB lighter than this singer's chest sound
    // The spectral cue depends on the vowel as well as the register, so it only gets part of the vote.
    let z = 0.6 * ((lighter - 9) / 3.5 + (f.h1h2 - 9) / 6);
    if (cal && cal.high > cal.low) {
      const pos = (f.midi - cal.low) / (cal.high - cal.low);
      z += (pos - 0.62) * 9;
    } else {
      z += (f.midi - 64) / 3;
    }
    const p = 1 / (1 + Math.exp(-z));
    const a = clamp01(dt / 0.15);
    this.headProb += a * (p - this.headProb);
  }

  /**
   * Strain cannot be heard directly either. We flag the pattern a teacher listens for: near the top
   * of the range, louder than usual, a pressed (harmonic-heavy) tone, and a pitch that turns rough.
   */
  private updateStrain(f: Frame, dt: number) {
    const cal = this.calibration;
    const top = cal ? cal.high : 67;
    const high = clamp01((f.midi - (top - 6)) / 5);
    const loud = clamp01((f.db - this.typicalDb - 4) / 8);
    const pressed = clamp01((1.5 - f.h1h2) / 7);
    let rough = 0;
    const s = this.seg;
    if (s.length >= 12) {
      let acc = 0;
      for (let i = s.length - 10; i < s.length; i++) acc += Math.abs(s[i].midi - 2 * s[i - 1].midi + s[i - 2].midi) * 100;
      rough = clamp01((acc / 10 - 8) / 20);
    }
    const chestUpHigh = high * (1 - this.headProb);
    const target = clamp01(chestUpHigh * (0.5 * loud + 0.35 * pressed + 0.3 * rough) + 0.35 * loud * pressed);
    this.strain += clamp01(dt / 0.4) * (target - this.strain);
    if (this.strain > 0.5) this.strainSeconds += dt;
  }
}
