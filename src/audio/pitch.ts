// YIN pitch detector (de Cheveigné & Kawahara 2002). Pure TypeScript, no DOM,
// so it runs unchanged in the browser, in Node tests, or in a native wrapper.

export interface PitchResult {
  /** Hz, or 0 when no clear pitch was found */
  freq: number;
  /** 0..1, how periodic the signal is. Sung vowels sit above ~0.85 */
  clarity: number;
}

export class PitchDetector {
  private readonly decim: number;
  private readonly rate: number;
  private readonly tauMin: number;
  private readonly tauMax: number;
  private work: Float32Array = new Float32Array(0);
  private d: Float32Array;
  private prevTau = -1;

  constructor(sampleRate: number, private fmin = 60, private fmax = 1200) {
    // Voice fundamentals sit far below 12 kHz, so halve the rate for a 4x speed-up.
    this.decim = sampleRate >= 32000 ? 2 : 1;
    this.rate = sampleRate / this.decim;
    this.tauMin = Math.max(2, Math.floor(this.rate / this.fmax));
    this.tauMax = Math.ceil(this.rate / this.fmin);
    this.d = new Float32Array(this.tauMax + 2);
  }

  /** Samples needed per call at the native sample rate. */
  get minSamples(): number {
    return (this.tauMax * 2 + Math.ceil((2 * this.rate) / this.fmin)) * this.decim;
  }

  /** Call when the input goes silent so the next note is not biased by the last one. */
  reset() {
    this.prevTau = -1;
  }

  detect(input: Float32Array): PitchResult {
    const n = Math.floor(input.length / this.decim);
    if (this.work.length !== n) this.work = new Float32Array(n);
    const x = this.work;
    if (this.decim === 2) {
      for (let i = 0; i < n; i++) x[i] = 0.5 * (input[2 * i] + input[2 * i + 1]);
    } else {
      x.set(input.subarray(0, n));
    }

    const tauMax = Math.min(this.tauMax, Math.floor(n / 2));
    const W = n - tauMax;
    const d = this.d;

    // Difference function + cumulative mean normalisation in one pass.
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const diff = x[j] - x[j + tau];
        sum += diff * diff;
      }
      running += sum;
      d[tau] = running > 0 ? (sum * tau) / running : 1;
    }

    // Classic YIN takes the first dip under a fixed threshold, which jumps up an octave or a twelfth
    // when a formant makes one harmonic dominate. Instead, find the deepest dip, then take the
    // shortest period whose dip is nearly as deep.
    let min = Infinity;
    for (let tau = this.tauMin; tau < tauMax; tau++) if (d[tau] < min) min = d[tau];
    if (min > 0.35) {
      this.prevTau = -1;
      return { freq: 0, clarity: Math.max(0, 1 - min) };
    }
    const isDip = (tau: number) => d[tau] <= d[tau - 1] && d[tau] <= d[tau + 1];
    // Depth of a dip at its interpolated bottom. Without this, short periods that fall between
    // samples look shallower than their double, and high notes get reported an octave low.
    const depth = (tau: number) => {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const denom = a - 2 * b + c;
      return denom > 0 ? Math.max(0, b - ((a - c) * (a - c)) / (8 * denom)) : b;
    };
    // Fresh pick: the shortest period whose dip is nearly as deep as the deepest one.
    let fresh = -1;
    for (let tau = this.tauMin + 1; tau < tauMax - 1; tau++) {
      if (isDip(tau) && depth(tau) <= min + 0.03) {
        fresh = tau;
        break;
      }
    }
    // Continuity: if the period from the previous frame is still a good dip, stay on it. This stops
    // a strong harmonic from stealing the pitch mid-note.
    let held = -1;
    if (this.prevTau > 0) {
      const lo = Math.max(this.tauMin + 1, Math.floor(this.prevTau * 0.94));
      const hi = Math.min(tauMax - 2, Math.ceil(this.prevTau * 1.06));
      for (let tau = lo; tau <= hi; tau++) {
        if (isDip(tau) && depth(tau) <= min + 0.06 && (held < 0 || d[tau] < d[held])) held = tau;
      }
    }
    let best = held > 0 ? held : fresh;
    // ...unless we are sitting on a multiple of a shorter period that is itself an excellent fit
    // (happens after a leap, when the old and new notes share a common sub-harmonic).
    if (held > 0 && fresh > 0 && fresh < held * 0.94 && depth(fresh) <= min + 0.015) best = fresh;
    this.prevTau = best;
    if (best < 0) return { freq: 0, clarity: Math.max(0, 1 - min) };

    // Parabolic interpolation for sub-sample accuracy.
    let tau = best;
    if (best > 1 && best < tauMax - 1) {
      const a = d[best - 1], b = d[best], c = d[best + 1];
      const denom = a - 2 * b + c;
      if (denom !== 0) tau = best + (0.5 * (a - c)) / denom;
    }
    return { freq: this.rate / tau, clarity: Math.max(0, Math.min(1, 1 - d[best])) };
  }
}

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const noteName = (midi: number) => {
  const r = Math.round(midi);
  return `${NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
};
export const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(((Math.round(midi) % 12) + 12) % 12);
