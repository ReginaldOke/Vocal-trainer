import { midiToHz } from "./pitch";
import type { TargetNote } from "../coach/exercises";

/** Soft guide tones so the singer can hear the starting pitch or the whole line. */
export class GuideSynth {
  private nodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private clicks: AudioBufferSourceNode[] = [];
  private noise: AudioBuffer | null = null;
  constructor(private ctx: AudioContext) {}

  playNote(midi: number, when: number, dur: number, level = 0.12) {
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = midiToHz(midi);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + 0.03);
    gain.gain.setValueAtTime(level, when + Math.max(0.04, dur - 0.08));
    gain.gain.linearRampToValueAtTime(0, when + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(when);
    osc.stop(when + dur + 0.05);
    this.nodes.push({ osc, gain });
    osc.onended = () => (this.nodes = this.nodes.filter((n) => n.osc !== osc));
  }

  playSequence(notes: TargetNote[], startAt: number) {
    notes.forEach((n) => this.playNote(n.midi, startAt + n.start, n.dur));
  }

  /**
   * A short burst of filtered noise. Unlike a pitched beep, the microphone will not mistake it
   * for singing, so clicks can play through speakers while pitch tracking is live.
   */
  click(when: number, accent = false) {
    if (!this.noise) {
      const len = Math.floor(this.ctx.sampleRate * 0.03);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = accent ? 2600 : 1800;
    filt.Q.value = 1.2;
    const gain = this.ctx.createGain();
    gain.gain.value = accent ? 0.5 : 0.3;
    src.connect(filt).connect(gain).connect(this.ctx.destination);
    src.start(when);
    this.clicks.push(src);
    src.onended = () => (this.clicks = this.clicks.filter((c) => c !== src));
  }

  /** A click on every beat between two take times; the first beat of each bar is accented. */
  clickTrack(startAt: number, beat: number, beatsPerBar: number, fromT: number, toT: number) {
    const first = Math.ceil(fromT / beat - 1e-6);
    for (let k = first; k * beat < toT; k++) this.click(startAt + k * beat, k % beatsPerBar === 0);
  }

  stop() {
    this.nodes.forEach(({ osc, gain }) => {
      gain.gain.cancelScheduledValues(0);
      gain.gain.value = 0;
      try { osc.stop(); } catch { /* already stopped */ }
    });
    this.nodes = [];
    this.clicks.forEach((c) => { try { c.stop(); } catch { /* already stopped */ } });
    this.clicks = [];
  }
}
