// Synthetic checks for things the sample recording does not contain: vibrato, wobble, head voice, a crack.
import { BUFFER_SIZE, FrameAnalyser } from "../src/audio/frame";
import { Tracker } from "../src/audio/analysis";
const sr = 48000;
function tone(dur: number, midiAt: (t: number) => number, tiltDbPerOct: number, amp = 0.2) {
  const formant = tiltDbPerOct > -10 ? 12 : 0; // chest-like tones get a first-formant boost on H2/H3
  const x = new Float32Array(Math.floor(dur * sr)); let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const f = 440 * 2 ** ((midiAt(i / sr) - 69) / 12); ph += (2 * Math.PI * f) / sr;
    let v = 0; for (let k = 1; k <= 12 && k * f < 8000; k++) v += 10 ** ((tiltDbPerOct * Math.log2(k) + (k === 2 || k === 3 ? formant : 0)) / 20) * Math.sin(k * ph);
    x[i] = amp * v * (0.3 + 0.0 * i) + 0.0005 * (Math.random() - 0.5);
  }
  return x;
}
function run(label: string, x: Float32Array) {
  const fa = new FrameAnalyser(sr), tr = new Tracker();
  tr.calibration = { low: 44, high: 73, chestWeight: 5, noiseDb: -70 };
  let last; const regs: Record<string, number> = {};
  for (let e = BUFFER_SIZE; e <= x.length; e += 800) { last = tr.push(fa.analyse(x.subarray(e - BUFFER_SIZE, e), e / sr)); regs[last.register] = (regs[last.register] ?? 0) + 1; }
  const n = last!.note;
  console.log(label.padEnd(28), n ? `${n.wobble} rate ${n.vibratoRate.toFixed(1)} extent ${n.vibratoExtent.toFixed(0)}c std ${n.stdCents.toFixed(0)}c` : "no note", JSON.stringify(regs), `cracks ${tr.crackCount}`);
}
run("straight A3, chest tilt", tone(3, () => 57, -6));
run("vibrato 5.5Hz ±35c", tone(3, (t) => 57 + 0.35 * Math.sin(2 * Math.PI * 5.5 * t), -6));
run("slow wobble 3Hz ±45c", tone(3, (t) => 57 + 0.45 * Math.sin(2 * Math.PI * 3 * t), -6));
run("random waver", (() => { let w = 0; const path: number[] = []; for (let i = 0; i < 400; i++) { w += (Math.random() - 0.5) * 0.25 - w * 0.08; path.push(w); } return tone(3, (t) => 57 + path[Math.floor(t * 100)], -6); })());
run("falsetto A4, steep tilt", tone(3, () => 69, -20));
run("belted A4, chest tilt", tone(3, () => 69, -4));
run("crack G4 chest -> C5 head", (() => { const a = tone(1.5, () => 67, -4), b = tone(1.5, () => 72, -20); const x = new Float32Array(a.length + b.length); x.set(a); x.set(b, a.length); return x; })());
