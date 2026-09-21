import { PitchDetector, hzToMidi } from "./pitch";
import { Spectrum, voiceQuality } from "./spectrum";

export interface Frame {
  /** seconds since the session started */
  t: number;
  voiced: boolean;
  /** fractional MIDI note number, NaN when unvoiced */
  midi: number;
  clarity: number;
  /** RMS level in dBFS */
  db: number;
  h1h2: number;
  weight: number;
}

export const BUFFER_SIZE = 4096;

/** Turns a block of raw samples into one Frame. No Web Audio dependency. */
export class FrameAnalyser {
  private pitch: PitchDetector;
  private spec: Spectrum;
  private last: number[] = [];
  /** dBFS below which input is treated as silence. Set from the mic check. */
  gateDb = -55;

  constructor(sampleRate: number) {
    this.pitch = new PitchDetector(sampleRate);
    this.spec = new Spectrum(BUFFER_SIZE, sampleRate);
  }

  analyse(buf: Float32Array, t: number): Frame {
    // Level from the most recent ~40 ms so the volume trace reacts quickly.
    const tail = Math.min(buf.length, 2048);
    let sq = 0;
    for (let i = buf.length - tail; i < buf.length; i++) sq += buf[i] * buf[i];
    const db = 10 * Math.log10(sq / tail + 1e-12);

    const frame: Frame = { t, voiced: false, midi: NaN, clarity: 0, db, h1h2: 0, weight: 0 };
    if (db < this.gateDb) {
      this.last.length = 0;
      this.pitch.reset();
      return frame;
    }

    const p = this.pitch.detect(buf);
    frame.clarity = p.clarity;
    if (p.freq <= 0 || p.clarity < 0.8) {
      this.last.length = 0;
      return frame;
    }

    // Median of three kills single-frame octave slips without adding real lag.
    const raw = hzToMidi(p.freq);
    this.last.push(raw);
    if (this.last.length > 3) this.last.shift();
    const sorted = [...this.last].sort((a, b) => a - b);
    const midi = sorted[Math.floor(sorted.length / 2)];

    this.spec.compute(buf);
    const q = voiceQuality(this.spec, p.freq);
    frame.voiced = true;
    frame.midi = midi;
    frame.h1h2 = q.h1h2;
    frame.weight = q.weight;
    return frame;
  }
}
