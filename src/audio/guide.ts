import { midiToHz } from "./pitch";

export type GuideMode = "off" | "quiet" | "full";

/**
 * A continuous guide tone that follows the current target note.
 *
 * Through speakers the microphone would hear it, so in "quiet" mode it does three things:
 * it ducks under the singer whenever they are voicing, it drops its level each time the
 * analyser reports a suspiciously exact copy of the target at low volume (that is the tone
 * bleeding into the mic), and it creeps back up while the room is silent so it stays audible.
 * "full" mode is for headphones: louder, no ducking, no bleed guard.
 */
export class AdaptiveGuide {
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private midi: number | null = null;
  private singing = false;
  /** speaker level, adapted at runtime */
  level = 0.05;
  readonly min = 0.006;
  readonly max = 0.11;
  mode: GuideMode = "quiet";

  constructor(private ctx: AudioContext) {}

  start() {
    if (this.osc) return;
    this.osc = this.ctx.createOscillator();
    this.osc.type = "sine";
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.osc.connect(this.gain).connect(this.ctx.destination);
    this.osc.start();
  }

  private target() {
    if (this.mode === "off" || this.midi === null) return 0;
    if (this.mode === "full") return 0.16;
    return this.singing ? this.level * 0.3 : this.level;
  }

  private apply(tau = 0.06) {
    if (!this.gain) return;
    this.gain.gain.setTargetAtTime(this.target(), this.ctx.currentTime, tau);
  }

  setNote(midi: number | null) {
    if (midi === this.midi) return;
    this.midi = midi;
    if (midi !== null && this.osc) this.osc.frequency.setTargetAtTime(midiToHz(midi), this.ctx.currentTime, 0.02);
    this.apply(midi === null ? 0.05 : 0.03);
  }

  setMode(mode: GuideMode) {
    this.mode = mode;
    this.apply();
  }

  /** Call every frame with whether the singer is currently voicing. */
  duck(singing: boolean) {
    if (singing === this.singing) return;
    this.singing = singing;
    this.apply();
  }

  /** The mic picked the guide up: get quieter. */
  bleed() {
    this.level = Math.max(this.min, this.level * 0.7);
    this.apply(0.02);
  }

  /** The room has been quiet: allow a little more level. */
  relax() {
    this.level = Math.min(this.max, this.level * 1.06);
    this.apply(0.2);
  }

  stop() {
    if (!this.osc || !this.gain) return;
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    const osc = this.osc;
    setTimeout(() => { try { osc.stop(); } catch { /* already stopped */ } }, 200);
    this.osc = null;
    this.gain = null;
    this.midi = null;
  }
}
