import { midiToHz } from "./pitch";

/** The recorded notes that ship with the app (see public/piano/CREDITS.txt). The rest are pitched from the nearest one. */
const SAMPLES: [string, number][] = [
  ["A1", 33], ["C2", 36], ["Ds2", 39], ["Fs2", 42], ["A2", 45], ["C3", 48], ["Ds3", 51], ["Fs3", 54], ["A3", 57],
  ["C4", 60], ["Ds4", 63], ["Fs4", 66], ["A4", 69], ["C5", 72], ["Ds5", 75], ["Fs5", 78], ["A5", 81], ["C6", 84],
];

/**
 * A real piano: recorded grand-piano notes, played back at the pitch asked for. Also the soft
 * tick that counts the singer in. Everything goes to one output, so one switch can silence it.
 */
export class Piano {
  private buffers = new Map<number, AudioBuffer>();
  private live = new Set<GainNode>();
  private tickBuffer: AudioBuffer | null = null;
  ready: Promise<void>;

  constructor(private ctx: AudioContext, private out: AudioNode) {
    this.ready = Promise.all(SAMPLES.map(async ([name, midi]) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}piano/${name}.mp3`);
        this.buffers.set(midi, await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch { /* a missing note is covered by its neighbours */ }
    })).then(() => undefined);
  }

  /** Strike one note. `dur` is how long the key is held; the string then dies away as it would under the damper. */
  play(midi: number, when = this.ctx.currentTime, dur = 1.2, level = 0.8) {
    let best = -1;
    for (const m of this.buffers.keys()) if (best < 0 || Math.abs(m - midi) < Math.abs(best - midi)) best = m;
    if (best < 0) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get(best)!;
    src.playbackRate.value = midiToHz(midi) / midiToHz(best);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(level, when);
    gain.gain.setValueAtTime(level, when + dur);
    gain.gain.setTargetAtTime(0, when + dur, 0.12);
    src.connect(gain).connect(this.out);
    this.live.add(gain);
    src.onended = () => { this.live.delete(gain); gain.disconnect(); };
    src.start(when);
    src.stop(when + dur + 1);
  }

  private held = new Map<number, { src: AudioBufferSourceNode; gain: GainNode }>();

  /** Press a key and keep it down: the note rings until `release`, like a real key. Several can be down at once. */
  press(midi: number, level = 0.8) {
    if (this.held.has(midi)) return;
    let best = -1;
    for (const m of this.buffers.keys()) if (best < 0 || Math.abs(m - midi) < Math.abs(best - midi)) best = m;
    if (best < 0) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get(best)!;
    src.playbackRate.value = midiToHz(midi) / midiToHz(best);
    const gain = this.ctx.createGain();
    gain.gain.value = level;
    src.connect(gain).connect(this.out);
    this.live.add(gain);
    src.onended = () => { this.live.delete(gain); gain.disconnect(); if (this.held.get(midi)?.src === src) this.held.delete(midi); };
    src.start();
    this.held.set(midi, { src, gain });
  }

  /** Let a held key up: the damper falls and the note dies away. */
  release(midi: number) {
    const h = this.held.get(midi);
    if (!h) return;
    this.held.delete(midi);
    const now = this.ctx.currentTime;
    h.gain.gain.cancelScheduledValues(now);
    h.gain.gain.setTargetAtTime(0, now, 0.12);
    h.src.stop(now + 1);
  }

  /** A chord, very slightly spread from the bottom, as a hand would play it. */
  chord(midis: number[], when = this.ctx.currentTime, dur = 2, level = 0.5) {
    midis.forEach((m, i) => this.play(m, when + i * 0.012, dur, level * (i === 0 ? 0.8 : 1)));
  }

  /** A quick run up the keys and back: the piano's way of drawing a slide. Returns how long it lasts. */
  run(from: number, to: number, when = this.ctx.currentTime) {
    const dir = Math.sign(to - from) || 1, n = Math.abs(Math.round(to - from)), step = 0.11;
    const path = [...Array.from({ length: n + 1 }, (_, i) => from + i * dir), ...Array.from({ length: n }, (_, i) => to - (i + 1) * dir)];
    path.forEach((m, i) => this.play(m, when + i * step, i === path.length - 1 ? 0.8 : step * 1.6, 0.55));
    return path.length * step + 0.8;
  }

  /** A soft tick. It is noise, not a note, so it is never mistaken for singing. */
  tick(when: number) {
    if (!this.tickBuffer) {
      const len = Math.floor(this.ctx.sampleRate * 0.03);
      this.tickBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.tickBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.tickBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.value = 0.22;
    src.connect(bp).connect(g).connect(this.out);
    this.live.add(g);
    src.onended = () => { this.live.delete(g); g.disconnect(); };
    src.start(when);
  }

  /** Stop everything that is sounding or still to come. */
  hush() {
    const now = this.ctx.currentTime;
    for (const g of this.live) { g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, 0.03); }
    this.live.clear();
    this.held.clear();
  }
}

