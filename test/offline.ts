// Runs the exact browser analysis path over a WAV file so the DSP can be checked without a microphone.
// Usage: npx tsx test/offline.ts path/to/mono16bit.wav
import { readFileSync } from "node:fs";
import { BUFFER_SIZE, FrameAnalyser } from "../src/audio/frame";
import { Tracker } from "../src/audio/analysis";
import { noteName } from "../src/audio/pitch";

const file = process.argv[2] ?? "test/sample.wav";
const wav = readFileSync(file);
const sampleRate = wav.readUInt32LE(24);
const dataAt = wav.indexOf("data") + 8;
const pcm = new Int16Array(wav.buffer, wav.byteOffset + dataAt, Math.floor((wav.length - dataAt) / 2));
const x = Float32Array.from(pcm, (v) => v / 32768);

const fa = new FrameAnalyser(sampleRate);
const tracker = new Tracker();
const hop = Math.round(sampleRate / 60);
const weights: number[] = [], h1h2: number[] = [];
let maxStrain = 0;
for (let end = BUFFER_SIZE; end <= x.length; end += hop) {
  const f = fa.analyse(x.subarray(end - BUFFER_SIZE, end), end / sampleRate);
  const s = tracker.push(f);
  if (f.voiced) { weights.push(f.weight); h1h2.push(f.h1h2); }
  maxStrain = Math.max(maxStrain, s.strain);
  for (const e of tracker.events) {
    if (e.type === "note-end") {
      const n = e.note;
      console.log(
        `${n.start.toFixed(2).padStart(6)}s ${(n.end - n.start).toFixed(2)}s ${noteName(n.median).padEnd(4)} ${((n.median - Math.round(n.median)) * 100).toFixed(0).padStart(4)}c  std ${n.stdCents.toFixed(0).padStart(3)}c drift ${n.driftCentsPerSec.toFixed(0).padStart(4)}  dB ${n.dbMean.toFixed(0)}±${n.dbStd.toFixed(1)}  ${n.wobble}${n.wobble === "vibrato" ? ` ${n.vibratoRate.toFixed(1)}Hz ${n.vibratoExtent.toFixed(0)}c` : ""}${n.scoop ? `  SCOOP ${n.scoop.cents.toFixed(0)}c/${n.scoop.seconds.toFixed(2)}s` : ""}${n.endSag ? `  END-SAG ${n.endSag.toFixed(0)}c` : ""}`
      );
    } else if (e.type === "crack") console.log(`   crack at ${e.t.toFixed(2)}s ${noteName(e.from)} -> ${noteName(e.to)}`);
  }
  tracker.events = [];
}
const q = (a: number[], p: number) => [...a].sort((m, n) => m - n)[Math.floor(a.length * p)];
console.log(`\nphrases ${tracker.phraseCount}, scoops ${tracker.scoopCount}, cracks ${tracker.crackCount}, range ${noteName(tracker.minMidi)}-${noteName(tracker.maxMidi)}`);
console.log(`weight p10/50/90: ${q(weights, 0.1).toFixed(1)} ${q(weights, 0.5).toFixed(1)} ${q(weights, 0.9).toFixed(1)}   h1h2 p10/50/90: ${q(h1h2, 0.1).toFixed(1)} ${q(h1h2, 0.5).toFixed(1)} ${q(h1h2, 0.9).toFixed(1)}  maxStrain ${maxStrain.toFixed(2)}`);
