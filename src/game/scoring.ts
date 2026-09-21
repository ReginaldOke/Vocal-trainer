import type { Frame } from "../audio/frame";
import type { PreparedNote, PreparedSong } from "./songs";
import { vowelFamily } from "../audio/formants";

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
  /** the right note, an octave away */
  octave: boolean;
  /** flow mode: what ended the note (for tuning) */
  endedBy: string;
  /** vowel drills: frames whose vowel matched the lyric, and frames judged */
  vowelHits: number;
  vowelN: number;
  /** flow mode: seconds of on-pitch singing banked so far, seconds sung at any pitch, and how many are needed */
  held: number;
  sung: number;
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

export type Onset = "clean" | "hard" | "breathy";
export type Ending = "held" | "faded" | "sagged";

/** How one phrase was breathed and shaped, judged from level and pitch rather than from the notes. */
export interface PhraseReport {
  /** index of the phrase's last note */
  end: number;
  /** breaths taken inside the phrase (0 means sung in one breath) */
  breaths: number;
  onset: Onset;
  /** spread of the level across the phrase, dB */
  evennessDb: number;
  ending: Ending;
}

export type RunEvent =
  | { type: "note"; note: RunNote; judgement: Judgement; points: number; combo: number; skipped: boolean; octave: boolean }
  | { type: "phrase"; report: PhraseReport }
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
const SLIDE_SECONDS = 0.28;
/** flow mode: the least a note must be sung (at any pitch) before a new note can end it */
const MIN_HOLD = 0.1;
/** flow mode: a pitch has to sit still this long before a jump away from it counts as a new note */
const STABLE_BEFORE_CHANGE = 0.15;
/** flow mode: a new pitch has to persist this long to count as a new note */
const CHANGE_CONFIRM = 0.08;
/** flow mode: a jump of at least this many semitones from the note being sung is a new note */
const CHANGE_SEMITONES = 1.5;
/** flow mode: a dip in level this deep, then a recovery, is a re-attack of the same pitch */
const DIP_DB = 7;

const NOTE_POINTS: Record<Judgement, number> = { perfect: 100, great: 60, good: 30, miss: 0 };
const SUSTAIN_PER_SECOND = 40;

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const std = (a: number[]) => { const m = mean(a); return a.length ? Math.sqrt(mean(a.map((v) => (v - m) ** 2))) : NaN; };
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
  /** the whole take at frame rate, for phrase judgement */
  log: { t: number; db: number; voiced: boolean; midi: number }[] = [];
  phrases: PhraseReport[] = [];
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
  /** flow mode: song position in seconds of the written layout */
  private pos: number;
  private cur = 0;
  private gapFor = 0;
  /** the pitch the singer has settled on for the current note, however far from the target */
  private ref = NaN;
  private stableFor = 0;
  private changeFor = 0;
  /** level tracking for re-attacks: a consonant makes a dip even without a gap */
  private peakDb = -90;
  private dipDb = 0;
  private dipped = false;
  private nextFor = 0;
  /** after a note ended by being held, the next one waits for a fresh attack rather than stealing the tail */
  private armed = false;
  private armedFor = 0;
  private onTargetFor = 0;
  private qSum = 0;
  private qN = 0;
  private slide: { from: number; to: number; at: number } | null = null;

  constructor(public song: PreparedSong, public diff: Difficulty, public mode: Mode, public startAt: number) {
    this.notes = song.notes.map((n) => ({
      ...n,
      bins: new Float32Array(Math.max(1, Math.ceil(n.dur / BIN))).fill(-1),
      judged: null, quality: 0, cents: NaN, errs: [], octave: false, endedBy: "", vowelHits: 0, vowelN: 0, held: 0, sung: 0, skipped: false, onAt: -1, sungAt: -1, offAt: -1,
      need: Math.max(0.3, Math.min(4, n.dur * 0.75)),
    }));
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

  /** Error against the target in real cents (an octave off is 1200), forgiving the first moment after a note change. */
  private errorFor(f: Frame, target: RunNote, sinceStart: number) {
    let err = (f.midi - target.midi) * 100;
    if (sinceStart < 0.12) {
      const prev = this.notes[target.i - 1];
      if (prev) { const e2 = (f.midi - prev.midi) * 100; if (Math.abs(e2) < Math.abs(err)) err = e2; }
    }
    return err;
  }

  private pushTrace(f: Frame, now: number, target: RunNote | null, err: number | null, q: number) {
    this.liveErr = err;
    this.liveQ = q;
    this.trace.push({ t: now, midi: f.voiced ? f.midi : NaN, err, q, db: f.db });
    if (this.trace.length > 600) this.trace.splice(0, 200);
    this.log.push({ t: now, db: f.db, voiced: f.voiced, midi: f.midi });
    void target;
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

    // The song follows the singer, whatever they sing: a note ends when they start another one
    // (a clear jump in pitch, or a breath and a fresh attack), when they simply stop at the end,
    // or after they have sung it for most of its written length. Pitch only affects the score.
    const next = this.notes[this.cur + 1];
    let err: number | null = null, q = 0;
    let movedOn = false;
    if (f.voiced) {
      this.silent = 0;
      if (this.armed) {
        // The last note was held to its end; the singer is probably still on it. Wait for a fresh
        // attack, a jump, or the new pitch itself before this note starts counting.
        this.peakDb = Math.max(this.peakDb - dt * 6, f.db);
        if (!this.dipped && f.db < this.peakDb - DIP_DB) { this.dipped = true; this.dipDb = f.db; }
        else if (this.dipped) this.dipDb = Math.min(this.dipDb, f.db);
        const jump = Math.abs(f.midi - this.ref);
        if (jump < 0.75) { this.ref += (f.midi - this.ref) * 0.2; this.changeFor = 0; } else if (jump >= CHANGE_SEMITONES) this.changeFor += dt; else this.changeFor = 0;
        if (this.frameQuality((f.midi - note.midi) * 100) > 0) this.onTargetFor += dt; else this.onTargetFor = 0;
        this.armedFor += dt;
        const fresh = this.gapFor >= 0.06 || (this.dipped && f.db > this.dipDb + DIP_DB * 0.6) || this.changeFor >= CHANGE_CONFIRM || this.onTargetFor >= 0.12 || this.armedFor >= 1.5;
        if (!fresh) {
          this.gapFor = 0;
          this.pos = this.slide ? this.slide.from + (note.start - this.slide.from) * slideU : note.start;
          this.pushTrace(f, now, note, null, 0);
          return;
        }
        this.armed = false;
        this.gapFor = 0;
      }
      if (note.sung === 0 || Number.isNaN(this.ref)) { this.ref = f.midi; this.stableFor = 0; this.changeFor = 0; this.peakDb = f.db; this.dipped = false; this.nextFor = 0; }
      // A consonant between repeated notes shows as a dip in level and a recovery.
      this.peakDb = Math.max(this.peakDb - dt * 6, f.db);
      if (!this.dipped && f.db < this.peakDb - DIP_DB) { this.dipped = true; this.dipDb = f.db; }
      else if (this.dipped) this.dipDb = Math.min(this.dipDb, f.db);
      const reattack = this.dipped && f.db > this.dipDb + DIP_DB * 0.6 && note.sung >= MIN_HOLD;
      // Singing the next note's pitch, while off this one, is the surest sign of having moved on.
      if (next && note.sung >= MIN_HOLD && this.frameQuality((f.midi - note.midi) * 100) === 0 && this.frameQuality((f.midi - next.midi) * 100) > 0) this.nextFor += dt; else this.nextFor = 0;
      // A breath and a fresh attack is a new note, whatever its pitch.
      if (this.gapFor >= 0.06 && note.sung >= MIN_HOLD) { movedOn = true; note.endedBy = "breath"; }
      else if (reattack) { movedOn = true; note.endedBy = `dip ${this.peakDb.toFixed(0)}/${this.dipDb.toFixed(0)}/${f.db.toFixed(0)}`; }
      else if (this.nextFor >= 0.12) { movedOn = true; note.endedBy = "next"; }
      else {
        const jump = Math.abs(f.midi - this.ref);
        if (jump < 0.75) {
          this.stableFor += dt;
          this.changeFor = 0;
          this.ref += (f.midi - this.ref) * 0.2;
        } else if (jump >= CHANGE_SEMITONES) {
          this.changeFor += dt;
          if (this.stableFor >= STABLE_BEFORE_CHANGE && this.changeFor >= CHANGE_CONFIRM && note.sung >= MIN_HOLD) { movedOn = true; note.endedBy = "jump"; }
        } else {
          // Between a wobble and a jump: let it ride.
          this.changeFor = 0;
        }
      }
      this.gapFor = 0;
      if (!movedOn) {
        note.sung += dt;
        err = this.errorFor(f, note, note.held > 0 ? 1 : 0.2);
        q = this.frameQuality(err);
        this.qSum += q;
        this.qN++;
        if (note.sung > 0.12) {
          note.errs.push(err);
          if (this.song.song.vowels && f.vowel && f.vowelConf > 0.3) { note.vowelN++; if (f.vowel === vowelFamily(note.lyric ?? "")) note.vowelHits++; }
        }
        if (q > 0) {
          if (note.sungAt < 0) note.sungAt = now;
          note.held += dt;
          this.score += SUSTAIN_PER_SECOND * q * this.multiplier * (this.fever.active ? 2 : 1) * dt;
        }
      }
    } else {
      // The detector also drops frames on a wobbly or breathy tone; only a real fall in level is a breath.
      const quiet = (note.sung === 0 && !this.armed) || f.db < this.peakDb - 12;
      if (quiet) this.silent += dt;
      if ((note.sung > 0 || this.armed) && quiet) this.gapFor += dt;
      // When a rest follows (or nothing does), the singer stopping is how the note ends.
      const restAfter = !next || next.start - (note.start + note.dur) > 0.25;
      if (restAfter && note.sung >= MIN_HOLD && this.silent >= 0.5) { movedOn = true; note.endedBy = "stop"; }
    }

    const frac = Math.min(1, note.sung / note.need);
    const want = note.start + frac * note.dur;
    this.pos = this.slide ? this.slide.from + (want - this.slide.from) * slideU : want;
    // The tube fills as the note is sung, coloured by how close it was.
    const idx = Math.min(note.bins.length - 1, Math.floor(frac * note.bins.length));
    for (let i = 0; i <= idx; i++) if (note.bins[i] < 0 || i === idx) note.bins[i] = f.voiced && !movedOn ? q : Math.max(0, note.bins[i]);
    this.pushTrace(f, now, note, err, q);

    if (frac >= 1 || movedOn) {
      if (!movedOn) { note.endedBy = "hold"; this.armed = true; this.armedFor = 0; this.onTargetFor = 0; this.dipped = false; }
      this.completeFlowNote(note, now, false);
      // The frame that started the new note belongs to it.
      if (movedOn && f.voiced && depth === 0) this.updateFlow(f, now, dt, 1);
    }
  }

  private completeFlowNote(note: RunNote, now: number, skipped: boolean) {
    const quality = this.qN ? this.qSum / this.qN : 0;
    // Mark the tube as fully sung when the singer moved on early, so it reads as complete.
    if (!skipped) for (let i = 0; i < note.bins.length; i++) if (note.bins[i] < 0) note.bins[i] = quality;
    note.skipped = skipped;
    this.judge(note, quality, now);
    this.qSum = 0;
    this.qN = 0;
    this.gapFor = 0;
    this.nextFor = 0;
    this.silent = 0;
    if (!this.armed) { this.ref = NaN; this.stableFor = 0; this.changeFor = 0; this.dipped = false; }
    this.cur++;
    this.slide = { from: this.pos, to: 0, at: now };
  }

  private judge(n: RunNote, qualityOverride: number | null, now: number) {
    // A note is judged by where it sat, not by every wobble: the centre of the sung pitch decides,
    // and a regular sway of up to about half a semitone (vibrato) costs nothing.
    n.cents = median(n.errs);
    let q: number;
    if (n.errs.length >= 3) {
      const centre = n.cents;
      const spread = std(n.errs.map((e) => e - centre));
      const consistency = Math.max(0, Math.min(1, 1 - Math.max(0, spread - 55) / 80));
      const centreQ = this.frameQuality(centre);
      const frameQ = qualityOverride ?? mean(n.errs.map((e) => this.frameQuality(e)));
      q = Math.max(centreQ * consistency, frameQ * 0.6);
      n.octave = Math.abs(Math.abs(centre) - 1200) <= this.diff.good;
      if (n.octave) q = 0;
    } else if (qualityOverride !== null) q = qualityOverride;
    else {
      let sum = 0, count = 0;
      for (let i = SETTLE_BINS; i < n.bins.length; i++) { sum += Math.max(0, n.bins[i]); count++; }
      if (!count) { sum = Math.max(0, n.bins[0]); count = 1; }
      q = sum / count;
    }
    n.quality = q;
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
    this.events.push({ type: "note", note: n, judgement: j, points, combo: this.combo, skipped: n.skipped, octave: n.octave });
    if (this.song.phraseEnds.includes(n.i)) this.judgePhrase(n.i);
  }

  /** Breath, attack, evenness and ending for the phrase that just finished. */
  private judgePhrase(endIndex: number) {
    const prevEnd = this.phrases.length ? this.phrases[this.phrases.length - 1].end : -1;
    const first = this.notes.slice(prevEnd + 1, endIndex + 1).find((n) => n.onAt >= 0);
    const last = this.notes[endIndex];
    if (!first || last.offAt < 0) return;
    const t0 = first.sungAt >= 0 ? first.sungAt : first.onAt, t1 = last.offAt;
    const frames = this.log.filter((x) => x.t >= t0 && x.t <= t1);
    const voiced = frames.filter((x) => x.voiced);
    if (voiced.length < 6) return;

    // Breaths: silences of a fifth of a second or more, not counting the edges.
    let breaths = 0, gap = 0;
    for (let i = 1; i < frames.length; i++) {
      const dt = frames[i].t - frames[i - 1].t;
      if (!frames[i].voiced) gap += dt;
      else { if (gap >= 0.2 && frames[i].t - t0 > 0.15 && t1 - frames[i].t > 0.15) breaths++; gap = 0; }
    }

    // Attack: how fast the level arrives at the start of the phrase.
    const head = voiced.filter((x) => x.t - voiced[0].t <= 0.3);
    const peak = Math.max(...head.map((x) => x.db));
    const rise = (head.find((x) => x.db >= peak - 3)?.t ?? voiced[0].t) - voiced[0].t;
    const onset: Onset = rise < 0.035 && head.length > 2 ? "hard" : rise > 0.18 ? "breathy" : "clean";

    // Evenness and ending.
    const dbs = voiced.map((x) => x.db);
    const evennessDb = std(dbs);
    const tail = voiced.filter((x) => t1 - x.t <= 0.3);
    const body = voiced.filter((x) => t1 - x.t > 0.3);
    const faded = tail.length >= 3 && body.length >= 5 && mean(tail.map((x) => x.db)) < mean(body.map((x) => x.db)) - 6;
    const tailCents = last.errs.slice(-Math.max(3, Math.floor(last.errs.length * 0.25)));
    const sagged = tailCents.length >= 3 && !Number.isNaN(last.cents) && median(tailCents) - last.cents < -40;
    const ending: Ending = sagged ? "sagged" : faded ? "faded" : "held";

    const report: PhraseReport = { end: endIndex, breaths, onset, evennessDb, ending };
    this.phrases.push(report);
    this.events.push({ type: "phrase", report });
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
      octaves: this.notes.filter((n) => n.octave).length,
      vowels: this.song.song.vowels ? { matched: this.notes.filter((n) => n.vowelN >= 5 && n.vowelHits / n.vowelN >= 0.5).length, total: this.notes.length } : null,
      phrases: [...this.phrases],
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
  octaves: number;
  vowels: { matched: number; total: number } | null;
  phrases: PhraseReport[];
  notes: { midi: number; lyric: string | null; judged: Judgement; cents: number; quality: number }[];
}
