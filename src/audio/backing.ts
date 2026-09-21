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
    if (this.mode === "off" || this.target === null) return 0;
    const base = this.mode === "full" ? 0.9 : this.level;
    return this.singing ? base * 0.3 : base;
  }

  private apply() {
    this.guide.setMode(this.style === "tone" ? this.mode : "off");
    this.piano.setLevel(this.style === "piano" ? this.pianoLevel() : 0);
  }

  setMode(mode: GuideMode) { this.mode = mode; this.apply(); }
  setStyle(style: BackingStyle) { this.style = style; this.apply(); if (style === "piano" && this.target !== null) this.strike(0.7); }
  setKey(tonic: number, chordMode: ChordMode) { this.tonic = tonic; this.chordMode = chordMode; this.chord = null; }

  private strike(velocity: number) {
    if (this.target === null || this.mode === "off") return;
    this.chord = chordFor(this.target, this.tonic, this.chordMode, this.chord);
    this.piano.strike(voiceChord(this.chord, this.target, this.tonic), velocity);
    this.lastPulse = this.ctx.currentTime;
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
    if (this.style === "piano" && this.target !== null && !singing && now - this.lastPulse > 2.2) this.strike(0.45);
  }

  /** True while speaker output could be reaching the microphone. */
  audible() {
    if (this.mode !== "quiet") return false;
    return this.style === "tone" ? this.target !== null : this.piano.audible();
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
