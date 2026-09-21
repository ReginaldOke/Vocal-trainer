import type { Frame } from "../audio/frame";
import { foldedCents } from "../coach/rules";
import type { PreparedNote, PreparedSong } from "./songs";

export type Judgement = "perfect" | "great" | "good" | "miss";

/**
 * "flow": the song waits for you. Each note sits at the hit line until you have held it, then the
 * highway slides on to the next one. "tempo": the song scrolls at its written speed.
 */
export type Mode = "flow" | "tempo";

export interface Difficulty {
  id: "easy" | "medium" | "hard" | "pro";
  label: string;
  blurb: string;
  /** cents windows for a perfect, great and good frame */
  perfect: number;
  great: number;
  good: number;
}

export const DIFFICULTIES: Difficulty[] = [
  { id: "easy", label: "Easy", blurb: "Wide pitch windows. Get the shape of the tune.", perfect: 30, great: 60, good: 100 },
  { id: "medium", label: "Medium", blurb: "Within a third of a semitone counts as perfect.", perfect: 20, great: 40, good: 70 },
  { id: "hard", label: "Hard", blurb: "Tight windows. Every note has to be centred.", perfect: 12, great: 25, good: 50 },
  { id: "pro", label: "Pro", blurb: "Studio tolerance. Vibrato had better be even.", perfect: 8, great: 15, good: 30 },
];

export const difficultyById = (id: string) => DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];

export interface RunNote extends PreparedNote {
  /** frame quality per bin along the tube, -1 until sung */
  bins: Float32Array;
  judged: Judgement | null;
  quality: number;
  /** median signed error in cents over the sung frames, NaN if not sung */
  cents: number;
  errs: number[];
  /** flow mode: seconds of on-pitch singing banked so far, and how many are needed */
  held: number;
  need: number;
  skipped: boolean;
  /** engine time when this note became the target, when it was first sung on pitch, and when it was judged */
  onAt: number;
  sungAt: number;
  offAt: number;
}

export interface TracePt {
  t: number;
  /** sung pitch folded into the octave of the target, so the puck stays on the highway */
  midi: number;
  err: number | null;
  q: number;
  db: number;
}

export type RunEvent =
  | { type: "note"; note: RunNote; judgement: Judgement; points: number; combo: number; skipped: boolean }
  | { type: "fever-start" }
  | { type: "fever-end" }
  | { type: "multiplier"; value: number };

export const BIN = 0.04;
/** Mic, analysis window and reaction time put the sung pitch a little behind the bars. */
export const LATENCY = 0.08;
const SETTLE_BINS = 3;
const FEVER_SECONDS = 10;
const NOTES_PER_MULTIPLIER = 6;
export const MAX_MULTIPLIER = 4;
/** flow mode: give up on a note after this long of singing the wrong pitch */
const WRONG_LIMIT = 3.5;
const SLIDE_SECONDS = 0.28;
/** flow mode: the least a note must be sung before moving to the next pitch counts as finishing it */
const MIN_HOLD = 0.1;
/** flow mode: how long the singer must sit on the next note before the song follows them */
const MOVE_CONFIRM = 0.1;

const NOTE_POINTS: Record<Judgement, number> = { perfect: 100, great: 60, good: 30, miss: 0 };
const SUSTAIN_PER_SECOND = 40;

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};
const ease = (u: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, u)), 3);

/** Everything that happens to the score during one take. Pure: no DOM, no React. */
export class GameRun {
  notes: RunNote[];
  score = 0;
  combo = 0;
  maxCombo = 0;
  multiplier = 1;
  fever = { meter: 0, active: false, until: 0 };
  /** 0..1, how the crowd feels */
  crowd = 0.5;
  counts: Record<Judgement, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
  trace: TracePt[] = [];
  events: RunEvent[] = [];
  finished = false;
  /** the note the singer is currently being judged against */
  target: RunNote | null = null;
  /** signed error of the latest voiced frame, null when unvoiced or no target */
  liveErr: number | null = null;
  liveQ = 0;
  /** flow mode: seconds of silence on the current note, for hints */
  silent = 0;
  private lastT = -1;
  private centre: number;
  /** flow mode: song position in seconds of the written layout */
  private pos: number;
  private cur = 0;
  private wrong = 0;
  private movedFor = 0;
  private gapFor = 0;
  private qSum = 0;
  private qN = 0;
  private slide: { from: number; to: number; at: number } | null = null;

  constructor(public song: PreparedSong, public diff: Difficulty, public mode: Mode, public startAt: number) {
    this.notes = song.notes.map((n) => ({
      ...n,
      bins: new Float32Array(Math.max(1, Math.ceil(n.dur / BIN))).fill(-1),
      judged: null, quality: 0, cents: NaN, errs: [], held: 0, skipped: false, onAt: -1, sungAt: -1, offAt: -1,
      need: Math.max(0.3, Math.min(4, n.dur * 0.75)),
    }));
    this.centre = (song.lo + song.hi) / 2;
    this.pos = mode === "flow" ? song.notes[0].start : 0;
  }

  /** seconds into the take, already corrected for analysis latency (tempo mode) */
  takeTime(now: number) {
    return now - this.startAt - LATENCY;
  }

  /** Where the highway is, in seconds of the written layout, for drawing. */
  viewPos(now: number) {
    return this.mode === "tempo" ? now - this.startAt : this.pos;
  }

  /** Whether we are still in the count-in (tempo mode only). */
  countIn(now: number) {
    return this.mode === "tempo" ? this.song.leadIn - (now - this.startAt) : 0;
  }

  progress(now: number) {
    if (this.mode === "tempo") return Math.max(0, Math.min(1, (now - this.startAt) / (this.song.end + 0.5)));
    return this.notes.filter((n) => n.judged).length / this.notes.length;
  }

  /** mean quality of the judged notes, 0..1; drives the star rating */
  accuracy() {
    const done = this.notes.filter((n) => n.judged);
    if (!done.length) return 0;
    return done.reduce((s, n) => s + n.quality, 0) / done.length;
  }

  frameQuality(err: number) {
    const a = Math.abs(err);
    const d = this.diff;
    if (a <= d.perfect) return 1;
    if (a <= d.great) return 0.75;
    if (a <= d.good) return 0.4;
    return 0;
  }

  update(f: Frame, now: number) {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, now - this.lastT);
    this.lastT = now;
    this.tickFever(now);
    if (this.mode === "tempo") this.updateTempo(f, now, dt);
    else this.updateFlow(f, now, dt);
  }

  private tickFever(now: number) {
    if (!this.fever.active) return;
    this.fever.meter = Math.max(0, (this.fever.until - now) / FEVER_SECONDS);
    if (now >= this.fever.until) {
      this.fever.active = false;
      this.fever.meter = 0;
      this.events.push({ type: "fever-end" });
    }
  }

  /** Error against the target, forgiving the first moment after a note change. */
  private errorFor(f: Frame, target: RunNote, sinceStart: number) {
    let err = foldedCents(f.midi, target.midi);
    if (sinceStart < 0.12) {
      const prev = this.notes[target.i - 1];
      if (prev) { const e2 = foldedCents(f.midi, prev.midi); if (Math.abs(e2) < Math.abs(err)) err = e2; }
    }
    return err;
  }

  private pushTrace(f: Frame, now: number, target: RunNote | null, err: number | null, q: number) {
    const shown = !f.voiced ? NaN : target && err !== null ? target.midi + err / 100 : this.centre + foldedCents(f.midi, this.centre) / 100;
    this.liveErr = err;
    this.liveQ = q;
    this.trace.push({ t: now, midi: shown, err, q, db: f.db });
    if (this.trace.length > 600) this.trace.splice(0, 200);
  }

  private updateTempo(f: Frame, now: number, dt: number) {
    const t = this.takeTime(now);
    for (const n of this.notes) if (!n.judged && t > n.start + n.dur + 0.05) this.judge(n, null, now);

    let target: RunNote | null = null;
    for (const n of this.notes) if (t >= n.start && t < n.start + n.dur) { target = n; break; }
    this.target = target;
    if (target && target.onAt < 0) target.onAt = now;

    let err: number | null = null, q = 0;
    if (f.voiced && target) {
      err = this.errorFor(f, target, t - target.start);
      q = this.frameQuality(err);
      if (q > 0 && target.sungAt < 0) target.sungAt = now;
      const b = Math.floor((t - target.start) / BIN);
      if (b >= 0 && b < target.bins.length) {
        let from = b;
        while (from > 0 && target.bins[from - 1] < 0 && b - from < 4) from--;
        for (let i = from; i <= b; i++) target.bins[i] = q;
        if (b >= SETTLE_BINS) target.errs.push(err);
      }
      if (q > 0) this.score += SUSTAIN_PER_SECOND * q * this.multiplier * (this.fever.active ? 2 : 1) * dt;
    } else if (target) {
      const b = Math.floor((t - target.start) / BIN);
      if (b >= 0 && b < target.bins.length && target.bins[b] < 0) target.bins[b] = 0;
    }
    this.pushTrace(f, now, target, err, q);

    if (!this.finished && t > this.song.end + 0.6) {
      for (const n of this.notes) if (!n.judged) this.judge(n, null, now);
      this.finished = true;
    }
  }

  private updateFlow(f: Frame, now: number, dt: number, depth = 0) {
    // The slide between notes is only visual: judging carries on so a quick singer loses nothing.
    let slideU = 1;
    if (this.slide) {
      slideU = ease((now - this.slide.at) / SLIDE_SECONDS);
      if (slideU >= 1) this.slide = null;
    }
    const note = this.notes[this.cur];
    if (!note) {
      this.target = null;
      this.pos = this.slide ? this.slide.from + (this.song.end + 0.5 - this.slide.from) * slideU : this.song.end + 0.5;
      if (!this.slide) this.finished = true;
      this.pushTrace(f, now, null, null, 0);
      return;
    }
    this.target = note;
    if (note.onAt < 0) note.onAt = now;

    // The song follows the singer: a note is done when it has been held long enough, or as soon as
    // the singer has clearly moved on to the next note (or re-attacked the same one after a breath).
    const next = this.notes[this.cur + 1];
    let err: number | null = null, q = 0;
    let movedOn = false;
    if (f.voiced) {
      this.silent = 0;
      err = this.errorFor(f, note, note.held > 0 ? 1 : 0.2);
      q = this.frameQuality(err);
      if (q > 0) {
        if (note.sungAt < 0) note.sungAt = now;
        note.held += dt * (q >= 0.75 ? 1 : 0.6);
        this.qSum += q;
        this.qN++;
        note.errs.push(err);
        this.wrong = Math.max(0, this.wrong - dt);
        this.movedFor = 0;
        this.score += SUSTAIN_PER_SECOND * q * this.multiplier * (this.fever.active ? 2 : 1) * dt;
        // A breath then the same pitch again is the next note, when it repeats this one.
        if (next && next.midi === note.midi && this.gapFor >= 0.06 && note.held >= MIN_HOLD) movedOn = true;
      } else {
        if (next && note.held >= MIN_HOLD && this.frameQuality(foldedCents(f.midi, next.midi)) > 0) {
          this.movedFor += dt;
          if (this.movedFor >= MOVE_CONFIRM) movedOn = true;
        } else {
          this.movedFor = 0;
          this.wrong += dt;
          note.held = Math.max(0, note.held - dt * 0.25);
        }
      }
      this.gapFor = 0;
    } else {
      this.silent += dt;
      if (note.held > 0) this.gapFor += dt;
      // Nothing follows the last note, so the singer stopping is how it ends.
      if (!next && note.held >= MIN_HOLD && this.silent >= 0.5) movedOn = true;
    }

    const frac = Math.min(1, note.held / note.need);
    const want = note.start + frac * note.dur;
    this.pos = this.slide ? this.slide.from + (want - this.slide.from) * slideU : want;
    // The tube fills as the note is banked.
    const idx = Math.min(note.bins.length - 1, Math.floor(frac * note.bins.length));
    for (let i = 0; i <= idx; i++) if (note.bins[i] < 0 || i === idx) note.bins[i] = q > 0 ? q : Math.max(0, note.bins[i]);
    this.pushTrace(f, now, note, err, q);

    if (frac >= 1 || movedOn) {
      this.completeFlowNote(note, now, false);
      // The frame that proved the singer moved on belongs to the next note.
      if (movedOn && depth === 0) this.updateFlow(f, now, dt, 1);
    } else if (this.wrong >= WRONG_LIMIT) this.completeFlowNote(note, now, true);
  }

  private completeFlowNote(note: RunNote, now: number, skipped: boolean) {
    const quality = this.qN ? (this.qSum / this.qN) * (skipped ? Math.min(1, note.held / note.need) : 1) : 0;
    // Mark the tube as fully sung when the singer moved on early, so it reads as complete.
    if (!skipped) for (let i = 0; i < note.bins.length; i++) if (note.bins[i] < 0) note.bins[i] = quality;
    note.skipped = skipped;
    this.judge(note, quality, now);
    this.qSum = 0;
    this.qN = 0;
    this.wrong = 0;
    this.movedFor = 0;
    this.gapFor = 0;
    this.silent = 0;
    this.cur++;
    this.slide = { from: this.pos, to: 0, at: now };
  }

  private judge(n: RunNote, qualityOverride: number | null, now: number) {
    let q: number;
    if (qualityOverride !== null) q = qualityOverride;
    else {
      let sum = 0, count = 0;
      for (let i = SETTLE_BINS; i < n.bins.length; i++) { sum += Math.max(0, n.bins[i]); count++; }
      if (!count) { sum = Math.max(0, n.bins[0]); count = 1; }
      q = sum / count;
    }
    n.quality = q;
    n.cents = median(n.errs);
    n.offAt = now;
    if (n.onAt < 0) n.onAt = now;
    const j: Judgement = q >= 0.8 ? "perfect" : q >= 0.55 ? "great" : q >= 0.3 ? "good" : "miss";
    n.judged = j;
    this.counts[j]++;

    if (j === "miss") {
      this.combo = 0;
      this.crowd = Math.max(0, this.crowd - 0.08);
      if (!this.fever.active) this.fever.meter = Math.max(0, this.fever.meter - 0.1);
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.crowd = Math.min(1, this.crowd + (j === "perfect" ? 0.05 : j === "great" ? 0.03 : 0.01));
      if (!this.fever.active) {
        this.fever.meter = Math.min(1, this.fever.meter + (j === "perfect" ? 0.15 : j === "great" ? 0.06 : 0.02));
        if (this.fever.meter >= 1) {
          this.fever.active = true;
          this.fever.until = now + FEVER_SECONDS;
          this.events.push({ type: "fever-start" });
        }
      }
    }
    const mult = 1 + Math.min(MAX_MULTIPLIER - 1, Math.floor(this.combo / NOTES_PER_MULTIPLIER));
    if (mult !== this.multiplier) {
      this.multiplier = mult;
      this.events.push({ type: "multiplier", value: mult });
    }
    const points = Math.round(NOTE_POINTS[j] * this.multiplier * (this.fever.active ? 2 : 1));
    this.score += points;
    this.events.push({ type: "note", note: n, judgement: j, points, combo: this.combo, skipped: n.skipped });
  }

  /** Summary for the results screen and the progress store. */
  summary(): RunSummary {
    const sung = this.notes.filter((n) => !Number.isNaN(n.cents));
    const bias = sung.length ? sung.reduce((s, n) => s + n.cents, 0) / sung.length : 0;
    const acc = this.accuracy();
    const stars = !sung.length ? 0 : acc >= 0.92 ? 5 : acc >= 0.78 ? 4 : acc >= 0.6 ? 3 : acc >= 0.4 ? 2 : 1;
    return {
      songId: this.song.song.id,
      difficulty: this.diff.id,
      mode: this.mode,
      score: Math.round(this.score),
      stars,
      accuracy: acc,
      maxCombo: this.maxCombo,
      fullCombo: this.counts.miss === 0 && sung.length === this.notes.length,
      counts: { ...this.counts },
      biasCents: bias,
      notes: this.notes.map((n) => ({ midi: n.midi, lyric: n.lyric, judged: n.judged ?? "miss", cents: n.cents, quality: n.quality })),
    };
  }
}

export interface RunSummary {
  songId: string;
  difficulty: Difficulty["id"];
  mode: Mode;
  score: number;
  stars: number;
  accuracy: number;
  maxCombo: number;
  fullCombo: boolean;
  counts: Record<Judgement, number>;
  biasCents: number;
  notes: { midi: number; lyric: string | null; judged: Judgement; cents: number; quality: number }[];
}
