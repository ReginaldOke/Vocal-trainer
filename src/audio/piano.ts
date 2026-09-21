import { midiToHz } from "./pitch";

/**
 * A small additive piano: each note is a few harmonics with a fast attack and a long decay,
 * through a gentle lowpass. Good enough to hear a chord under a tune; nothing like a sample.
 */
export class Piano {
  private master: GainNode | null = null;
  private tone: BiquadFilterNode | null = null;
  private voices = new Set<OscillatorNode>();
  /** engine-independent: AudioContext time of the last strike */
  lastStrikeAt = -10;
  /** how long a strike is still clearly audible */
  readonly ring = 2.4;

  constructor(private ctx: AudioContext) {}

  start() {
    if (this.master) return;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.tone = this.ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = 3600;
    this.tone.Q.value = 0.4;
    this.tone.connect(this.master).connect(this.ctx.destination);
  }

  /** Smoothly set the overall level (0..1). */
  setLevel(level: number, tau = 0.05) {
    if (this.master) this.master.gain.setTargetAtTime(level, this.ctx.currentTime, tau);
  }

  /** Strike a chord. `velocity` 0..1 scales the attack; `bassBoost` gives the lowest note more weight. */
  strike(midis: number[], velocity = 0.8, when = this.ctx.currentTime) {
    if (!this.tone) return;
    this.lastStrikeAt = when;
    midis.forEach((m, i) => {
      const isBass = i === 0;
      const gain = this.ctx.createGain();
      const peak = velocity * (isBass ? 0.42 : 0.28) / Math.sqrt(midis.length);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(peak, when + 0.008);
      gain.gain.setTargetAtTime(0, when + 0.02, isBass ? 0.9 : 0.55);
      gain.connect(this.tone!);
      const f = midiToHz(m);
      const partials: [OscillatorType, number, number][] = [["triangle", 1, 1], ["sine", 2, 0.35], ["sine", 3, 0.12], ["sine", 4.01, 0.05]];
      for (const [type, mult, amp] of partials) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = f * mult;
        const pg = this.ctx.createGain();
        pg.gain.value = amp;
        osc.connect(pg).connect(gain);
        osc.start(when);
        osc.stop(when + this.ring + 1.5);
        this.voices.add(osc);
        osc.onended = () => { this.voices.delete(osc); gain.disconnect(); };
      }
    });
  }

  /** One melody note with a short ring, for playing a phrase the singer will sing back. */
  note(midi: number, when: number, dur: number, velocity = 0.8) {
    if (!this.tone) return;
    this.lastStrikeAt = Math.max(this.lastStrikeAt, when + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(velocity * 0.34, when + 0.008);
    gain.gain.setTargetAtTime(velocity * 0.18, when + 0.03, 0.25);
    gain.gain.setTargetAtTime(0, when + Math.max(0.08, dur - 0.05), 0.09);
    gain.connect(this.tone);
    const f = midiToHz(midi);
    const partials: [OscillatorType, number, number][] = [["triangle", 1, 1], ["sine", 2, 0.35], ["sine", 3, 0.12], ["sine", 4.01, 0.05]];
    for (const [type, mult, amp] of partials) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * mult;
      const pg = this.ctx.createGain();
      pg.gain.value = amp;
      osc.connect(pg).connect(gain);
      osc.start(when);
      osc.stop(when + dur + 0.8);
      this.voices.add(osc);
      osc.onended = () => { this.voices.delete(osc); gain.disconnect(); };
    }
  }

  audible(now = this.ctx.currentTime) {
    return now - this.lastStrikeAt < this.ring;
  }

  stop() {
    this.setLevel(0, 0.03);
    const voices = [...this.voices];
    setTimeout(() => voices.forEach((v) => { try { v.stop(); } catch { /* already stopped */ } }), 150);
    this.voices.clear();
    const master = this.master;
    setTimeout(() => master?.disconnect(), 400);
    this.master = null;
    this.tone = null;
  }
}
