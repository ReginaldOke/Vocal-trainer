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
    // Read the resonances off the model's spectrum: peaks of 1/|A(f)|. Peak picking copes better
    // than root finding when two resonances sit close together, as they do in rounded vowels.
    const step = 20;
    const env: number[] = [];
    const freqs: number[] = [];
    for (let f = 150; f <= 4000; f += step) {
      const w = (2 * Math.PI * f) / this.rate;
      let re = 0, im = 0;
      for (let k = 0; k <= ORDER; k++) { re += a[k] * Math.cos(w * k); im -= a[k] * Math.sin(w * k); }
      env.push(1 / Math.max(1e-9, re * re + im * im));
      freqs.push(f);
    }
    const peaks: { f: number; h: number; width: number }[] = [];
    for (let i = 1; i < env.length - 1; i++) {
      if (env[i] > env[i - 1] && env[i] >= env[i + 1]) {
        // Width at half height, as a stand-in for bandwidth.
        let l = i, r = i;
        while (l > 0 && env[l] > env[i] / 2) l--;
        while (r < env.length - 1 && env[r] > env[i] / 2) r++;
        peaks.push({ f: freqs[i], h: env[i], width: (r - l) * step });
      }
    }
    if (!peaks.length) return null;
    const top = Math.max(...peaks.map((p) => p.h));
    const strong = peaks.filter((p) => p.h >= top * 0.04 && p.width < 900).sort((p, q) => p.f - q.f);
    if (strong.length >= 2) {
      // A broad, lone low hump with only a weak second peak is two rounded-vowel resonances fused together.
      const [p1, p2] = strong;
      if (p1.f < 900 && p1.width > 300 && p2.h < p1.h * 0.25) return { f1: p1.f * 0.72, f2: p1.f * 1.35 };
      return { f1: p1.f, f2: p2.f };
    }
    if (strong.length === 1 && strong[0].f < 950) return { f1: strong[0].f * 0.72, f2: strong[0].f * 1.35 };
    return null;
  }
}

/**
 * Which vowel family a pair of resonances belongs to. Four families are all this estimate can tell
 * apart reliably: the open "ah", the mid "eh", the bright "ee", and the dark rounded group
 * ("oo", "oh", "uh"), which a simple model cannot separate from each other.
 */
export function classifyVowel(fm: Formants): { vowel: Vowel; confidence: number } {
  const { f1, f2 } = fm;
  if (f2 < 1300) return { vowel: "oo", confidence: Math.min(1, (1300 - f2) / 400 + 0.3) };
  if (f1 > 650) return { vowel: "ah", confidence: Math.min(1, (f1 - 650) / 200 + 0.3) };
  if (f2 > 2100) return { vowel: "ee", confidence: Math.min(1, (f2 - 2100) / 400 + 0.3) };
  return { vowel: "eh", confidence: Math.min(1, Math.min(f2 - 1300, 2100 - f2) / 400 + 0.3) };
}

/** The family a lyric vowel belongs to, for scoring drills. */
export function vowelFamily(v: string): Vowel | null {
  const t = v.trim().toLowerCase();
  if (t === "ah" || t === "a") return "ah";
  if (t === "eh" || t === "e") return "eh";
  if (t === "ee" || t === "i") return "ee";
  if (t === "oo" || t === "oh" || t === "uh" || t === "o" || t === "u") return "oo";
  return null;
}
