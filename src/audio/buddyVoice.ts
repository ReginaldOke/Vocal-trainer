/**
 * The bird's own voice: a formant synth that sings whatever pitch the analyser hears, with the
 * vowel shaped by the singer's tone. Meant for headphones: through speakers it would feed back
 * into the pitch tracker at the singer's own pitch and never stop.
 */
export class BuddyVoice {
  private osc: OscillatorNode | null = null;
  private out: GainNode | null = null;
  private formants: { filter: BiquadFilterNode; gain: GainNode }[] = [];
  private vibrato: OscillatorNode | null = null;
  private level = 0;

  constructor(private ctx: AudioContext) {}

  /** Formant centres for a bright open vowel and a dark rounded one; the singer's tone blends them. */
  private static AH = [720, 1240, 2600];
  private static OO = [320, 800, 2350];

  start() {
    if (this.osc) return;
    const ctx = this.ctx;
    this.osc = ctx.createOscillator();
    this.osc.type = "sawtooth";
    this.osc.frequency.value = 220;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3800;
    this.formants = BuddyVoice.AH.map((f, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = f;
      filter.Q.value = i === 0 ? 6 : 9;
      const gain = ctx.createGain();
      gain.gain.value = [1, 0.5, 0.25][i];
      this.osc!.connect(filter).connect(gain).connect(lp);
      return { filter, gain };
    });
    lp.connect(this.out).connect(ctx.destination);
    this.vibrato = ctx.createOscillator();
    this.vibrato.frequency.value = 5.3;
    const vibGain = ctx.createGain();
    vibGain.gain.value = 6; // cents
    this.vibrato.connect(vibGain).connect(this.osc.detune);
    this.osc.start();
    this.vibrato.start();
  }

  /** Call every analysed frame. `level` is 0..1 from the singer's volume, `bright` 0..1 from their tone. */
  update(voiced: boolean, hz: number, level: number, bright: number) {
    if (!this.osc || !this.out) return;
    const now = this.ctx.currentTime;
    if (voiced && hz > 0) this.osc.frequency.setTargetAtTime(hz, now, 0.035);
    const target = voiced ? 0.28 * Math.pow(Math.max(0, Math.min(1, level)), 0.7) : 0;
    if (target !== this.level) {
      this.level = target;
      this.out.gain.setTargetAtTime(target, now, voiced ? 0.03 : 0.05);
    }
    this.formants.forEach(({ filter }, i) => {
      const f = BuddyVoice.OO[i] + (BuddyVoice.AH[i] - BuddyVoice.OO[i]) * bright;
      filter.frequency.setTargetAtTime(f, now, 0.08);
    });
  }

  stop() {
    if (!this.osc || !this.out) return;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    const osc = this.osc, vib = this.vibrato;
    setTimeout(() => { try { osc.stop(); vib?.stop(); } catch { /* already stopped */ } }, 200);
    this.osc = null;
    this.out = null;
    this.vibrato = null;
    this.formants = [];
    this.level = 0;
  }

  get running() {
    return !!this.osc;
  }
}
