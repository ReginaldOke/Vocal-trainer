import type { Frame } from "../audio/frame";

/**
 * A siren: slide smoothly from a low note up to a high one and back, on a hum, a lip trill or
 * a vowel. There are no notes to hit, so it is judged the way a teacher listens to it: was the
 * line smooth, did it cover the range, and did the sound stay joined up?
 */
export interface GlideConfig {
  /** MIDI pitch to start and end on */
  from: number;
  /** MIDI pitch at the top of the siren */
  to: number;
  /** how many sirens to do */
  repeats: number;
  /** "up" for a rising siren, "down" for a falling one (cool-downs) */
  direction: "up" | "down";
}

export interface GlideSummary {
  repeats: number;
  /** 0..1 fraction of voiced frames whose pitch moved smoothly */
  smoothness: number;
  /** 0..1 fraction of the target range covered */
  coverage: number;
  /** 0..1 fraction of each siren sung without a break */
  continuity: number;
  score: number;
}

export class GlideRun {
  done = 0;
  finished = false;
  /** seconds since the singer last made a sound */
  quietFor = 0;
  /** recent sung pitch for drawing */
  trace: { t: number; midi: number; voiced: boolean; db: number }[] = [];
  private lastMidi = NaN;
  private lastT = -1;
  private smooth = 0;
  private rough = 0;
  private lo = Infinity;
  private hi = -Infinity;
  private reachedFar = false;
  private breaks = 0;
  private gap = 0;
  private sungThisRep = 0;

  constructor(public cfg: GlideConfig, public startAt: number) {}

  private get near() { return this.cfg.direction === "up" ? this.cfg.from : this.cfg.to; }
  private get far() { return this.cfg.direction === "up" ? this.cfg.to : this.cfg.from; }

  update(f: Frame, now: number) {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, now - this.lastT);
    this.lastT = now;
    this.trace.push({ t: now, midi: f.voiced ? f.midi : NaN, voiced: f.voiced, db: f.db });
    if (this.trace.length > 600) this.trace.splice(0, 200);
    if (this.finished) return;
    const span = Math.abs(this.far - this.near);
    if (f.voiced) {
      this.quietFor = 0;
      if (this.gap >= 0.25 && this.sungThisRep > 0.3) this.breaks++;
      this.gap = 0;
      this.sungThisRep += dt;
      if (!Number.isNaN(this.lastMidi) && now - this.lastFrameT() < 0.1) {
        if (Math.abs(f.midi - this.lastMidi) <= 0.35) this.smooth += dt; else this.rough += dt;
      }
      this.lastMidi = f.midi;
      this.lo = Math.min(this.lo, f.midi);
      this.hi = Math.max(this.hi, f.midi);
      const progress = (f.midi - this.near) / (this.far - this.near);
      if (progress >= 0.8) this.reachedFar = true;
      if (this.reachedFar && progress <= 0.2 && this.sungThisRep > 0.6) {
        // Out and back: one siren done.
        this.done++;
        this.reachedFar = false;
        this.sungThisRep = 0;
        if (this.done >= this.cfg.repeats) this.finished = true;
      }
    } else {
      this.gap += dt;
      this.quietFor += dt;
      this.lastMidi = NaN;
    }
    void span;
  }

  private lastFrameT() {
    const prev = this.trace[this.trace.length - 2];
    return prev ? prev.t : -10;
  }

  /** 0..1, how far through the current siren the singer is (for the canvas ring) */
  progress(midi: number) {
    if (Number.isNaN(midi)) return 0;
    const p = (midi - this.near) / (this.far - this.near);
    return Math.max(0, Math.min(1, this.reachedFar ? 1 - p : p));
  }

  summary(): GlideSummary {
    const total = this.smooth + this.rough;
    const smoothness = total ? this.smooth / total : 0;
    const coverage = Number.isFinite(this.lo) ? Math.max(0, Math.min(1, (this.hi - this.lo) / Math.abs(this.cfg.to - this.cfg.from))) : 0;
    const continuity = Math.max(0, 1 - this.breaks / Math.max(1, this.cfg.repeats));
    const score = Math.round(1000 * (0.5 * smoothness + 0.3 * coverage + 0.2 * continuity) * (this.done / this.cfg.repeats));
    return { repeats: this.done, smoothness, coverage, continuity, score };
  }
}
