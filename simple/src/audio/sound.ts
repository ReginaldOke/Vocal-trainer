import { midiToHz } from "./pitch";

/** Everything the app plays: piano notes for the tune, a click for the beat, a sliding tone for sirens. */
export class Sound {
  private live = new Set<GainNode>();
  private noise: AudioBuffer | null = null;

  constructor(private ctx: AudioContext, private out: AudioNode) {}

  /** One piano-like note. */
  note(midi: number, when: number, dur: number, level = 0.8) {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level * 0.34, when + 0.008);
    gain.gain.setTargetAtTime(level * 0.18, when + 0.03, 0.25);
    gain.gain.setTargetAtTime(0, when + Math.max(0.08, dur - 0.05), 0.09);
    gain.connect(this.out);
    this.live.add(gain);
    const f = midiToHz(midi);
    const partials: [OscillatorType, number, number][] = [["triangle", 1, 1], ["sine", 2, 0.35], ["sine", 3, 0.12]];
    let pending = partials.length;
    for (const [type, mult, amp] of partials) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * mult;
      const pg = this.ctx.createGain();
      pg.gain.value = amp;
      osc.connect(pg).connect(gain);
      osc.start(when);
      osc.stop(when + dur + 0.8);
      osc.onended = () => { if (--pending === 0) { this.live.delete(gain); gain.disconnect(); } };
    }
  }

  /** A soft tick for the count-in and the beat. Noise, not a pitch, so the mic never mistakes it for singing. */
  click(when: number, accent = false) {
    if (!this.noise) {
      const len = Math.floor(this.ctx.sampleRate * 0.03);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = accent ? 2400 : 1600; bp.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.value = accent ? 0.5 : 0.3;
    src.connect(bp).connect(g).connect(this.out);
    this.live.add(g);
    src.onended = () => { this.live.delete(g); g.disconnect(); };
    src.start(when);
  }

  /** One tone that slides from `from` to `to` and back: the shape of a siren, for the singer to copy. Returns its length. */
  slide(from: number, to: number, when: number) {
    const leg = 1.1;
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
    osc.type = "triangle";
    lp.type = "lowpass"; lp.frequency.value = 1800;
    osc.frequency.setValueAtTime(midiToHz(from), when);
    osc.frequency.exponentialRampToValueAtTime(midiToHz(to), when + leg);
    osc.frequency.setValueAtTime(midiToHz(to), when + leg + 0.15);
    osc.frequency.exponentialRampToValueAtTime(midiToHz(from), when + leg * 2 + 0.15);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.22, when + 0.08);
    gain.gain.setValueAtTime(0.22, when + leg * 2 + 0.1);
    gain.gain.linearRampToValueAtTime(0, when + leg * 2 + 0.35);
    osc.connect(lp).connect(gain).connect(this.out);
    this.live.add(gain);
    osc.onended = () => { this.live.delete(gain); gain.disconnect(); };
    osc.start(when);
    osc.stop(when + leg * 2 + 0.45);
    return leg * 2 + 0.5;
  }

  /** Stop everything that is sounding or scheduled. */
  hush() {
    const now = this.ctx.currentTime;
    for (const g of this.live) { g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, 0.02); }
    this.live.clear();
  }
}
