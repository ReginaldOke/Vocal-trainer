import { FormantTracker, classifyVowel } from "../src/audio/formants";
const sr = 48000, N = 4096;
function biquadBP(f0: number, Q: number) { const w = 2 * Math.PI * f0 / sr, a = Math.sin(w) / (2 * Q); const b0 = a, b1 = 0, b2 = -a, a0 = 1 + a, a1 = -2 * Math.cos(w), a2 = 1 - a; let x1 = 0, x2 = 0, y1 = 0, y2 = 0; return (x: number) => { const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; }; }
function synth(f0: number, f1: number, f2: number) {
  const out = new Float32Array(N); const bp1 = biquadBP(f1, 5), bp2 = biquadBP(f2, 5);
  for (let i = 0; i < N; i++) { const ph = (i / sr) * f0; const saw = 2 * (ph - Math.floor(ph + 0.5)); out[i] = 0.35 * (bp1(saw) + bp2(saw) + 0.15 * saw); }
  return out;
}
const ft = new FormantTracker(sr);
for (const f0 of [196, 233, 262, 294, 330]) for (const [name, f1, f2] of [["ah", 800, 1250], ["ah", 730, 1090], ["ee", 300, 2500], ["oo", 320, 800], ["eh", 550, 1900]] as const) {
  const fm = ft.estimate(synth(f0, f1, f2));
  console.log(`f0 ${f0} ${name.padEnd(3)} ->`, fm ? `${Math.round(fm.f1)}/${Math.round(fm.f2)} ${classifyVowel(fm).vowel} ${classifyVowel(fm).confidence.toFixed(2)}` : "null", (ft as unknown as { lastPeaks?: unknown }).lastPeaks ? JSON.stringify((ft as unknown as { lastPeaks: unknown }).lastPeaks) : "");
}
