// Small radix-2 FFT plus the harmonic measurements used to guess register and effort.

export class Spectrum {
  private re: Float32Array;
  private im: Float32Array;
  private win: Float32Array;
  readonly mag: Float32Array;
  readonly binHz: number;

  constructor(readonly size: number, sampleRate: number) {
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
    this.mag = new Float32Array(size / 2);
    this.win = new Float32Array(size);
    for (let i = 0; i < size; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    this.binHz = sampleRate / size;
  }

  compute(x: Float32Array) {
    const n = this.size, re = this.re, im = this.im;
    const off = x.length - n;
    for (let i = 0; i < n; i++) {
      re[i] = x[off + i] * this.win[i];
      im[i] = 0;
    }
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const t = re[i]; re[i] = re[j]; re[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci;
          const ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
    for (let i = 0; i < n / 2; i++) this.mag[i] = Math.hypot(re[i], im[i]);
  }

  /** Peak level (dB) of harmonic k of f0, searched a little either side of the expected bin. */
  harmonicDb(f0: number, k: number): number {
    const centre = (f0 * k) / this.binHz;
    const half = Math.max(1, Math.round((0.03 * f0 * k) / this.binHz));
    let peak = 1e-9;
    for (let b = Math.max(1, Math.round(centre) - half); b <= Math.round(centre) + half && b < this.mag.length; b++) {
      if (this.mag[b] > peak) peak = this.mag[b];
    }
    return 20 * Math.log10(peak);
  }
}

export interface VoiceQuality {
  /** H1 minus H2 in dB. High (>10) suggests light/head/breathy, low (<2) suggests heavy or pressed. */
  h1h2: number;
  /** Strongest of harmonics 2..6 relative to H1, in dB. Positive = chest-like, negative = the fundamental dominates (head/falsetto). */
  weight: number;
}

export function voiceQuality(spec: Spectrum, f0: number): VoiceQuality {
  const h1 = spec.harmonicDb(f0, 1);
  const h2 = spec.harmonicDb(f0, 2);
  let strongest = h2;
  for (let k = 3; k <= 6 && f0 * k < 5000; k++) strongest = Math.max(strongest, spec.harmonicDb(f0, k));
  return { h1h2: h1 - h2, weight: strongest - h1 };
}
