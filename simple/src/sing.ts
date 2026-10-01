import type { Frame } from "./audio/engine";
import type { Note, Prepared } from "./songs";

export interface TracePoint { t: number; midi: number; db: number; voiced: boolean; /** 1 on the note, 0.5 close, 0 off; -1 when there is nothing to compare with; 2 for a slide, which is not judged */ q: number }

/** Distance in cents from a target, ignoring which octave: a low voice singing a tune an octave down is still in tune. */
export const folded = (midi: number, target: number) => {
  let d = ((midi - target) % 12 + 12) % 12;
  if (d > 6) d -= 12;
  return d * 100;
};

/** How long a note must be held on pitch to count: a moment for a short note, a little longer for a long one. */
const need = (n: Note) => Math.max(0.08, Math.min(0.22, n.dur * 0.4));

/**
 * One line, heard and then sung back. The piano's turn runs on the clock; the singer's turn does
 * not. They sing the line at whatever pace they like, each note is ticked off as they land on it,
 * and the turn is over once they have sung and then been quiet for a moment. There is no beat to
 * keep up with.
 */
export class Take {
  /** the notes to sing, in order */
  readonly solo: Note[];
  private state: (boolean | null)[];
  private anchor: number[];
  private at = 0;
  private hold = [0, 0, 0];
  private sung = 0;
  private quiet = 0;
  private lastT = -1;
  /** the last note ticked off, and whether the voice has moved away from it since */
  private lastMidi = NaN;
  private left = true;

  constructor(public p: Prepared, public startAt: number) {
    this.solo = p.notes.filter((n) => n.role === "solo");
    this.state = p.notes.map(() => null);
    this.anchor = p.chords[p.chords.length - 1]?.midi ?? [];
  }

  time(now: number) { return now - this.startAt; }
  /** Whether it is still the piano's turn: the mic hears the speakers then, so it is ignored. */
  listening(now: number) { return this.time(now) < this.p.singAt - 0.25; }
  /** The note the singer is on next, or null when they have been through them all. */
  get target(): Note | null { return this.solo[this.at] ?? null; }

  /** The singer's turn is over once they have sung and then stopped: a short pause if they got through the line, a longer one if not. */
  done() { return this.sung >= 0.35 && this.quiet >= (this.at >= this.solo.length ? 0.8 : 1.5); }

  /** The piano note sounding at this moment of the listening part. */
  noteAt(t: number): Note | null {
    for (const n of this.p.notes) { if (n.role !== "cue") break; if (t >= n.start && t < n.start + n.dur + 0.06) return n; }
    return null;
  }

  /** Take in one frame; returns how close it was, for colouring the line. */
  push(f: Frame, floorDb: number): number {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, f.t - this.lastT);
    this.lastT = f.t;
    if (this.listening(f.t)) return -1;
    // The held chord coming back through the mic: quiet, and exactly on one of its notes.
    const bleed = f.voiced && f.db < Math.min(floorDb + 18, -38) && this.anchor.some((m) => Math.abs(folded(f.midi, m)) < 40);
    if (!f.voiced || bleed) { this.quiet += dt; this.left = true; return -1; }
    this.quiet = 0;
    this.sung += dt;
    if (!Number.isNaN(this.lastMidi) && Math.abs(folded(f.midi, this.lastMidi)) > 80) this.left = true;

    // Tick notes off in order. Looking a note or two ahead lets a missed note be passed over
    // instead of holding everything up.
    for (let j = 0; j < 3; j++) {
      const n = this.solo[this.at + j];
      if (!n) { this.hold[j] = 0; continue; }
      const on = Math.abs(folded(f.midi, n.midi)) <= 40;
      // Still sitting on the note just ticked off is not a jump ahead to a later note of the same pitch.
      const stale = j > 0 && !this.left && !Number.isNaN(this.lastMidi) && Math.abs(folded(n.midi, this.lastMidi)) < 50;
      this.hold[j] = on && !stale ? this.hold[j] + dt : Math.max(0, this.hold[j] - dt * 2);
    }
    for (let j = 0; j < 3; j++) {
      const n = this.solo[this.at + j];
      if (!n || this.hold[j] < need(n)) continue;
      for (let k = 0; k < j; k++) this.state[this.solo[this.at + k].i] = false;
      this.state[n.i] = true;
      this.at += j + 1;
      this.hold = [0, 0, 0];
      this.lastMidi = n.midi;
      this.left = false;
      break;
    }

    // Colour against the note being aimed at, or the one just landed if the voice is still on it.
    const aims = [this.solo[this.at], this.solo[this.at - 1]].filter((n): n is Note => !!n);
    const a = Math.min(...aims.map((n) => Math.abs(folded(f.midi, n.midi))));
    return a <= 25 ? 1 : a <= 50 ? 0.5 : 0;
  }

  /** How a note went: null not reached yet, true landed, false passed over. */
  landed(i: number): boolean | null { return this.state[i]; }
}
