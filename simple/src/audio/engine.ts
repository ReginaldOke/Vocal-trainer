import { PitchDetector, hzToMidi } from "./pitch";
import { VoiceGate } from "./voiceGate";

/** One moment of listening: what pitch, how loud. */
export interface Frame {
  /** seconds on the audio clock */
  t: number;
  voiced: boolean;
  /** fractional MIDI note number, NaN when nothing is being sung */
  midi: number;
  /** level in dBFS */
  db: number;
  clarity: number;
}

const SIZE = 4096;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The microphone, the pitch tracker and the app's one output. Listeners get frames in which only
 * singing counts as voiced: the room's own noise, clicks and the app's speakers are filtered out.
 */
export class Engine {
  ctx: AudioContext | null = null;
  /** everything the app plays goes through here; silent when the page was opened with ?silent */
  out: GainNode | null = null;
  /** latest raw level, for the mic meter */
  level = -90;
  /** the room's background level */
  floorDb = -60;
  ready = false;
  /** a stand-in voice for testing without a microphone (?fakemic) */
  fake: { osc: OscillatorNode; gain: GainNode } | null = null;

  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(SIZE);
  private pitch: PitchDetector | null = null;
  private gate = new VoiceGate();
  private gateDb = -55;
  private last: number[] = [];
  private listeners = new Set<(f: Frame) => void>();
  private raf = 0;
  private lastStep = 0;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = -1;
  private early: number[] = [];
  private quiet: number[] = [];
  private lastFloorAt = 0;

  onFrame(fn: (f: Frame) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }

  private starting: Promise<void> | null = null;

  /**
   * Open the microphone and start listening. Safe to call from anywhere, any number of times:
   * a browser that wants a touch before it runs audio gets one from the first tap or key press.
   */
  start() {
    this.starting ??= this.open().catch((e) => { this.starting = null; throw e; });
    return this.starting;
  }

  private async open() {
    if (this.ready) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: "interactive" });
    this.ctx = ctx;
    const query = new URLSearchParams(location.search);
    this.out = ctx.createGain();
    this.out.gain.value = query.has("silent") ? 0 : 1;
    this.out.connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = SIZE;
    this.analyser.smoothingTimeConstant = 0;
    this.pitch = new PitchDetector(ctx.sampleRate);
    // The audio thread keeps calling back when the page is hidden and animation frames stall,
    // so a note sung with the screen dimmed still counts.
    const keep = ctx.createScriptProcessor(2048, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.analyser.connect(keep); keep.connect(mute); mute.connect(ctx.destination);
    keep.onaudioprocess = () => { if (performance.now() - this.lastStep > 45) this.step(); };

    if (query.has("fakemic")) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = "sawtooth"; osc.frequency.value = 220; gain.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
      osc.connect(lp).connect(gain).connect(this.analyser);
      const dest = ctx.createMediaStreamDestination();
      gain.connect(dest);
      this.stream = dest.stream;
      osc.start();
      this.fake = { osc, gain };
    } else {
      // Echo cancellation removes the app's own piano from the mic; noise suppression trims fans and traffic.
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 } });
      ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    }
    // Without a touch yet, some browsers hold the audio clock still. Do not wait on it: wake it
    // on the first tap or key press, wherever that lands.
    const wake = () => { if (ctx.state !== "running") void ctx.resume(); else for (const ev of ["pointerdown", "keydown", "touchend"]) window.removeEventListener(ev, wake, true); };
    for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, wake, true);
    void ctx.resume().catch(() => undefined);
    try { await (navigator as Navigator & { wakeLock?: { request(type: string): Promise<unknown> } }).wakeLock?.request("screen"); } catch { /* not available */ }
    this.ready = true;
    this.startedAt = ctx.currentTime;
    this.loop();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.step();
  };

  private step() {
    if (!this.analyser || !this.pitch || !this.ctx) return;
    this.lastStep = performance.now();
    const t = this.ctx.currentTime;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sq = 0;
    for (let i = SIZE - 2048; i < SIZE; i++) sq += this.buf[i] * this.buf[i];
    const db = 10 * Math.log10(sq / 2048 + 1e-12);
    this.level = db;
    const frame: Frame = { t, voiced: false, midi: NaN, db, clarity: 0 };
    if (db >= this.gateDb) {
      const p = this.pitch.detect(this.buf);
      frame.clarity = p.clarity;
      if (p.freq > 0 && p.clarity >= 0.75) {
        // Median of three removes single-frame octave slips.
        this.last.push(hzToMidi(p.freq));
        if (this.last.length > 3) this.last.shift();
        const sorted = [...this.last].sort((a, b) => a - b);
        frame.voiced = true;
        frame.midi = sorted[sorted.length >> 1];
      } else this.last.length = 0;
    } else this.last.length = 0;
    this.trackFloor(frame);
    this.gate.floorDb = this.floorDb;
    for (const f of this.gate.apply(frame)) this.listeners.forEach((fn) => fn(f));
  }

  /** Learn how loud the room is, so only sound well above it counts as singing. */
  private trackFloor(f: Frame) {
    const since = f.t - this.startedAt;
    if (since < 1) { this.early.push(f.db); return; }
    if (this.early.length) {
      const s = [...this.early].sort((a, b) => a - b);
      this.floorDb = s[Math.floor(s.length * 0.6)];
      this.early = [];
      this.lastFloorAt = f.t;
    }
    // A steady hum can look pitched and must still count as room; singing must not.
    if (!f.voiced || f.db < this.floorDb + 10) { this.quiet.push(f.db); if (this.quiet.length > 400) this.quiet.shift(); }
    if (f.t - this.lastFloorAt > 4 && this.quiet.length >= 60) {
      const s = [...this.quiet].sort((a, b) => a - b);
      this.floorDb = s[Math.floor(s.length * 0.35)];
      this.lastFloorAt = f.t;
    }
    this.gateDb = clamp(this.floorDb + 10, -62, -30);
  }

  get recording() { return !!this.recorder && this.recorder.state === "recording"; }

  startRecording() {
    if (!this.stream || typeof MediaRecorder === "undefined") return false;
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start();
    return true;
  }

  stopRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec || rec.state === "inactive") return resolve(null);
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType }));
      rec.stop();
      this.recorder = null;
    });
  }

  stop() { cancelAnimationFrame(this.raf); }
}
