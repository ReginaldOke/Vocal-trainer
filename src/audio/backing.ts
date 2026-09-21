import { AdaptiveGuide, type GuideMode } from "./guide";
import { Piano } from "./piano";
import { chordFor, voiceChord, type ChordMode, type ChordShape } from "../game/harmony";

export type BackingStyle = "tone" | "piano";

/**
 * What the singer hears while they sing: either the plain guide tone or piano chords that follow
 * the tune, with the melody note on top. Through speakers both duck under the voice and, when the
 * microphone starts to hear them, turn themselves down.
 */
export class Backing {
  private guide: AdaptiveGuide;
  private piano: Piano;
  private target: number | null = null;
  private targetKey = "";
  private chord: ChordShape | null = null;
  private singing = false;
  private level = 0.55;
  private lastPulse = -10;
  /** 0..1 scaffolding: 1 is full support, 0 is silence (sing it from memory) */
  fade = 1;
  /**
   * Phones cancel echo whatever the page asks, and that cancellation eats a voice singing the
   * same note the speaker is playing. So on touch devices the piano cues a note once and then
   * stays quiet while the singer answers, instead of pulsing under them.
   */
  pulse = typeof window === "undefined" ? true : !window.matchMedia("(pointer: coarse)").matches;
  style: BackingStyle = "piano";
  mode: GuideMode = "quiet";
  tonic = 60;
  chordMode: ChordMode = "major";

  constructor(private ctx: AudioContext) {
    this.guide = new AdaptiveGuide(ctx);
    this.piano = new Piano(ctx);
  }

  start() {
    this.guide.start();
    this.piano.start();
    this.apply();
  }

  private pianoLevel() {
    if (this.mode === "off" || this.target === null || this.fade <= 0) return 0;
    const base = (this.mode === "full" ? 0.9 : this.level) * this.fade;
    return this.singing ? base * 0.3 : base;
  }

  setFade(fade: number) {
    this.fade = Math.max(0, Math.min(1, fade));
    this.guide.setMode(this.style === "tone" && this.fade > 0 ? this.mode : "off");
    this.apply();
  }

  private apply() {
    this.guide.setMode(this.style === "tone" ? this.mode : "off");
    this.piano.setLevel(this.style === "piano" ? this.pianoLevel() : 0);
  }

  setMode(mode: GuideMode) { this.mode = mode; this.apply(); }
  setStyle(style: BackingStyle) { this.style = style; this.apply(); if (style === "piano" && this.target !== null) this.strike(0.7); }
  setKey(tonic: number, chordMode: ChordMode) { this.tonic = tonic; this.chordMode = chordMode; this.chord = null; }

  private strike(velocity: number) {
    if (this.target === null || this.mode === "off" || this.fade <= 0) return;
    this.chord = chordFor(this.target, this.tonic, this.chordMode, this.chord);
    this.piano.strike(voiceChord(this.chord, this.target, this.tonic), velocity);
    this.lastPulse = this.ctx.currentTime;
  }

  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  /** Sound one note once, on request, without touching what the backing is doing. */
  preview(midi: number) {
    this.piano.setLevel(Math.max(this.mode === "full" ? 0.9 : this.level, 0.35), 0.01);
    this.piano.strike([midi], 0.85);
    // Fall back to the backing's own level once the last preview has rung out.
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => { this.previewTimer = null; this.apply(); }, 2600);
  }

  /** Play a melody on the piano, clearly, for the singer to hear and sing back. Returns when it ends. */
  playMelody(notes: { midi: number; start: number; dur: number }[], at = this.ctx.currentTime + 0.05) {
    this.piano.setLevel(Math.max(this.mode === "full" ? 0.9 : this.level, 0.5), 0.01);
    let end = at;
    for (const n of notes) { this.piano.note(n.midi, at + n.start, n.dur); end = Math.max(end, at + n.start + n.dur); }
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => { this.previewTimer = null; this.apply(); }, (end - this.ctx.currentTime) * 1000 + 1200);
    return end;
  }

  /** Ear training: play one note once, then stay silent. No chord, no pulse, no following tone. */
  cue(midi: number | null) {
    this.target = null;
    this.targetKey = "";
    this.guide.setNote(null);
    this.piano.setLevel(this.mode === "full" ? 0.9 : Math.max(0.3, this.level), 0.02);
    if (midi !== null && this.mode !== "off") this.piano.strike([midi], 0.8);
    this.lastPulse = this.ctx.currentTime + 1e6; // never pulse
  }

  /** Call whenever the note the singer should be on changes (or becomes null between phrases). `id` lets a repeated pitch strike again. */
  setTarget(midi: number | null, id: number | string = "") {
    const key = midi === null ? "" : `${id}:${midi}`;
    if (key === this.targetKey) return;
    this.targetKey = key;
    this.target = midi;
    this.guide.setNote(this.style === "tone" ? midi : null);
    if (this.style === "piano") {
      this.apply();
      if (midi !== null) this.strike(0.85);
    }
  }

  /** Every frame: duck under the singer, and keep a soft pulse going while a note waits for them. */
  tick(singing: boolean) {
    if (singing !== this.singing) {
      this.singing = singing;
      this.guide.duck(singing);
      this.piano.setLevel(this.style === "piano" ? this.pianoLevel() : 0, 0.06);
    }
    const now = this.ctx.currentTime;
    if (this.pulse && this.style === "piano" && this.target !== null && !singing && now - this.lastPulse > 2.2) this.strike(0.45);
  }

  /** Pitches currently sounding from the speakers, so a faint match can be told from singing. */
  tones(): number[] {
    if (this.target === null) return [];
    if (this.style === "tone") return [this.target];
    return this.chord ? voiceChord(this.chord, this.target, this.tonic) : [this.target];
  }

  /** True while speaker output could be mistaken for singing: the sustained tone, or the attack of a piano strike. */
  audible() {
    if (this.mode !== "quiet") return false;
    return this.style === "tone" ? this.target !== null : this.ctx.currentTime - this.piano.lastStrikeAt < 0.8;
  }

  /** The mic picked the backing up: get quieter. */
  bleed() {
    this.guide.bleed();
    this.level = Math.max(0.08, this.level * 0.75);
    this.apply();
  }

  /** The room has been quiet: allow a little more level. */
  relax() {
    this.guide.relax();
    this.level = Math.min(0.75, this.level * 1.05);
    this.apply();
  }

  stop() {
    this.target = null;
    this.targetKey = "";
    this.chord = null;
    this.guide.stop();
    this.piano.stop();
  }
}
