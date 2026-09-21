/**
 * Vowel estimation from the first two formants. Linear prediction on a downsampled frame gives
 * the resonances of the vocal tract; the two lowest are enough to tell "ah" from "ee" from "oo".
 * Pure TypeScript, no DOM.
 */
export interface Formants {
  f1: number;
  f2: number;
}

export type Vowel = "ah" | "eh" | "ee" | "oh" | "oo" | "uh";

/** Average formant centres (Hz), roughly midway between typical male and female voices. */
const VOWELS: { v: Vowel; f1: number; f2: number }[] = [
  { v: "ee", f1: 300, f2: 2500 },
  { v: "eh", f1: 550, f2: 1900 },
  { v: "ah", f1: 800, f2: 1250 },
  { v: "uh", f1: 600, f2: 1200 },
  { v: "oh", f1: 500, f2: 900 },
  { v: "oo", f1: 320, f2: 800 },
];

const DECIM_RATE = 10000;
const ORDER = 10;

export class FormantTracker {
  private decim: number;
  private rate: number;
  private work = new Float32Array(0);
  private win = new Float32Array(0);

  constructor(sampleRate: number) {
    this.decim = Math.max(1, Math.round(sampleRate / DECIM_RATE));
    this.rate = sampleRate / this.decim;
  }

  /** Formants for a block of samples, or null when the spectrum has no clear resonances. */
  estimate(input: Float32Array): Formants | null {
    // Take the most recent ~30 ms and downsample by averaging.
    const need = Math.floor(this.rate * 0.03) * this.decim;
    const start = Math.max(0, input.length - need);
    const n = Math.floor((input.length - start) / this.decim);
    if (n < 64) return null;
    if (this.work.length !== n) {
      this.work = new Float32Array(n);
      this.win = new Float32Array(n);
      for (let i = 0; i < n; i++) this.win[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
    }
    const x = this.work;
    // Pre-emphasis lifts the higher formants so they are not swamped by the fundamental.
    let prev = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < this.decim; k++) sum += input[start + i * this.decim + k];
      const v = sum / this.decim;
      x[i] = (v - 0.97 * prev) * this.win[i];
      prev = v;
    }
    // Autocorrelation and Levinson-Durbin.
    const r = new Float64Array(ORDER + 1);
    for (let lag = 0; lag <= ORDER; lag++) {
      let acc = 0;
      for (let i = lag; i < n; i++) acc += x[i] * x[i - lag];
      r[lag] = acc;
    }
    if (r[0] <= 1e-9) return null;
    const a = new Float64Array(ORDER + 1);
    const tmp = new Float64Array(ORDER + 1);
    a[0] = 1;
    let err = r[0];
    for (let i = 1; i <= ORDER; i++) {
      let acc = r[i];
      for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
      const k = -acc / err;
      tmp.set(a);
      for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j];
      a[i] = k;
      err *= 1 - k * k;
      if (err <= 0) return null;
    }
    // Roots of the prediction polynomial give the resonances.
    const roots = polyRoots(Array.from(a));
    const cands: { f: number; bw: number }[] = [];
    for (const [re, im] of roots) {
      if (im <= 0) continue;
      const f = (Math.atan2(im, re) * this.rate) / (2 * Math.PI);
      const bw = (-Math.log(Math.hypot(re, im)) * this.rate) / Math.PI;
      if (f > 150 && f < 4000 && bw < 500) cands.push({ f, bw });
    }
    cands.sort((p, q) => p.f - q.f);
    if (cands.length < 2) return null;
    return { f1: cands[0].f, f2: cands[1].f };
  }
}

/** Nearest vowel to a pair of formants, with a confidence from how close it is. */
export function classifyVowel(fm: Formants): { vowel: Vowel; confidence: number } {
  let best: Vowel = "ah", bestD = Infinity;
  for (const v of VOWELS) {
    // Log-frequency distance, weighting F2 a little less since it varies more between voices.
    const d = Math.hypot(Math.log(fm.f1 / v.f1) * 1.4, Math.log(fm.f2 / v.f2));
    if (d < bestD) { bestD = d; best = v.v; }
  }
  return { vowel: best, confidence: Math.max(0, Math.min(1, 1 - bestD / 0.6)) };
}

/** Durand-Kerner root finding for a real polynomial a[0] + a[1] z^-1 + ... expressed in z. */
function polyRoots(a: number[]): [number, number][] {
  // a is in terms of z^-1 with a[0] = 1: multiply through by z^n to get a monic polynomial in z.
  const n = a.length - 1;
  const coef = a.slice(); // coef[k] multiplies z^(n-k)
  const roots: [number, number][] = [];
  for (let k = 0; k < n; k++) { const ang = (2 * Math.PI * k) / n + 0.4; roots.push([0.9 * Math.cos(ang), 0.9 * Math.sin(ang)]); }
  const evalP = (re: number, im: number): [number, number] => {
    let pr = coef[0], pi = 0;
    for (let k = 1; k <= n; k++) { const nr = pr * re - pi * im + coef[k]; pi = pr * im + pi * re; pr = nr; }
    return [pr, pi];
  };
  for (let iter = 0; iter < 60; iter++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const [zr, zi] = roots[i];
      const [pr, pi] = evalP(zr, zi);
      let dr = 1, di = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const wr = zr - roots[j][0], wi = zi - roots[j][1];
        const nr = dr * wr - di * wi; di = dr * wi + di * wr; dr = nr;
      }
      const den = dr * dr + di * di || 1e-12;
      const qr = (pr * dr + pi * di) / den, qi = (pi * dr - pr * di) / den;
      roots[i] = [zr - qr, zi - qi];
      moved = Math.max(moved, Math.hypot(qr, qi));
    }
    if (moved < 1e-7) break;
  }
  return roots;
}
