import type { Frame } from "./audio/engine";
import type { Note, Prepared } from "./songs";

/** The mic, the analysis window and a singer's reaction put the heard pitch a little behind the bars. */
export const LATENCY = 0.1;

export interface TracePoint { t: number; midi: number; db: number; voiced: boolean; /** 1 on the note, 0.5 close, 0 off; -1 when there was nothing to compare with; 2 for a slide, which is not judged */ q: number }

export interface TakeResult { landed: number; total: number; accuracy: number; stars: number; sung: number }

/** Distance in cents from a target, ignoring which octave: a low voice singing a tune an octave down is still in tune. */
export const folded = (midi: number, target: number) => {
  let d = ((midi - target) % 12 + 12) % 12;
  if (d > 6) d -= 12;
  return d * 100;
};

/**
 * One run through a song in time. The notes go by on the clock; each sung moment is compared with
 * the note it falls in. Nothing waits for the singer, so noise can never push the song along.
 */
export class Take {
  private tally: { n: number; ok: number }[];
  private sung = 0;
  private lastT = -1;

  /** `tune` is how loudly the piano doubles the melody (0 = off); `listenOnly` plays without judging. */
  constructor(public p: Prepared, public startAt: number, public tune: number, public listenOnly = false) {
    this.tally = p.notes.map(() => ({ n: 0, ok: 0 }));
  }

  time(now: number) { return now - this.startAt; }
  done(now: number) { return this.time(now) > this.p.end + 0.7; }

  /** The note sounding at this moment on the written timeline. */
  noteAt(t: number): Note | null {
    for (const n of this.p.notes) { if (t >= n.start && t < n.start + n.dur + 0.06) return n; if (n.start > t) break; }
    return null;
  }

  /** Whether the singer is meant to be singing now (not during a count-in, a rest or a listen-only cue). */
  singing(now: number) {
    const n = this.noteAt(this.time(now) - LATENCY);
    return !!n && n.role !== "cue" && !this.listenOnly;
  }

  /** Take in one frame; returns how close it was, for colouring the line. */
  push(f: Frame, floorDb: number): number {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, f.t - this.lastT);
    this.lastT = f.t;
    if (this.listenOnly || !f.voiced) return -1;
    const t = this.time(f.t) - LATENCY;
    const n = this.noteAt(t);
    if (!n || n.role === "cue") return -1;
    const off = folded(f.midi, n.midi);
    // The piano's own note coming back through the mic: quiet, and exactly on pitch.
    if (this.tune > 0 && n.role === "both" && f.db < Math.min(floorDb + 18, -38) && Math.abs(off) < 40) return -1;
    this.sung += dt;
    const a = Math.abs(off);
    // The first instant of a note is still the slide in from the last one.
    if (t - n.start >= 0.07) { const c = this.tally[n.i]; c.n++; if (a <= 40) c.ok++; }
    return a <= 25 ? 1 : a <= 50 ? 0.5 : 0;
  }

  /** How a note went so far: null not sung yet, true landed, false missed. */
  landed(i: number): boolean | null {
    const c = this.tally[i];
    return c.n < 2 ? null : c.ok / c.n >= 0.5;
  }

  result(): TakeResult {
    const scored = this.p.notes.filter((n) => n.role !== "cue");
    const landed = scored.filter((n) => this.landed(n.i) === true).length;
    const accuracy = scored.length ? landed / scored.length : 0;
    const stars = this.sung < 1 ? 0 : accuracy >= 0.85 ? 3 : accuracy >= 0.6 ? 2 : accuracy >= 0.3 ? 1 : 0;
    return { landed, total: scored.length, accuracy, stars, sung: this.sung };
  }
}
