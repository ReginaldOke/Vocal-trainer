import type { Frame } from "./audio/engine";
import type { Note, Prepared } from "./songs";

/** The mic, the analysis window and a singer's reaction put the heard pitch a little behind the bars. */
export const LATENCY = 0.1;

export interface TracePoint { t: number; midi: number; db: number; voiced: boolean; /** 1 on the note, 0.5 close, 0 off; -1 when there is nothing to compare with; 2 for a slide, which is not judged */ q: number }

/** Distance in cents from a target, ignoring which octave: a low voice singing a tune an octave down is still in tune. */
export const folded = (midi: number, target: number) => {
  let d = ((midi - target) % 12 + 12) % 12;
  if (d > 6) d -= 12;
  return d * 100;
};

/**
 * One line, heard and then sung back, on the clock. The piano's turn and the singer's turn are
 * laid out in time; each sung moment is compared with the note it falls in. Nothing waits for the
 * singer, so noise can never push things along.
 */
export class Take {
  private tally: { n: number; ok: number }[];
  private anchor: number[];

  constructor(public p: Prepared, public startAt: number) {
    this.tally = p.notes.map(() => ({ n: 0, ok: 0 }));
    this.anchor = p.chords[p.chords.length - 1]?.midi ?? [];
  }

  time(now: number) { return now - this.startAt; }
  done(now: number) { return this.time(now) > this.p.end + 0.6; }
  /** Whether it is still the piano's turn: the mic hears the speakers then, so it is ignored. */
  listening(now: number) { return this.time(now) < this.p.singAt - 0.25; }

  /** The note sounding at this moment on the written timeline. */
  noteAt(t: number): Note | null {
    for (const n of this.p.notes) { if (t >= n.start && t < n.start + n.dur + 0.06) return n; if (n.start > t) break; }
    return null;
  }

  /** Take in one frame; returns how close it was, for colouring the line. */
  push(f: Frame, floorDb: number): number {
    if (!f.voiced) return -1;
    const t = this.time(f.t) - LATENCY;
    const n = this.noteAt(t);
    if (!n || n.role === "cue") return -1;
    // The held chord coming back through the mic: quiet, and exactly on one of its notes.
    if (f.db < Math.min(floorDb + 18, -38) && this.anchor.some((m) => Math.abs(folded(f.midi, m)) < 40)) return -1;
    const a = Math.abs(folded(f.midi, n.midi));
    // The first instant of a note is still the slide in from the last one.
    if (t - n.start >= 0.07) { const c = this.tally[n.i]; c.n++; if (a <= 40) c.ok++; }
    return a <= 25 ? 1 : a <= 50 ? 0.5 : 0;
  }

  /** How a note went so far: null not sung yet, true landed, false missed. */
  landed(i: number): boolean | null {
    const c = this.tally[i];
    return c.n < 2 ? null : c.ok / c.n >= 0.5;
  }
}
