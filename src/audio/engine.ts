import { BUFFER_SIZE, Frame, FrameAnalyser } from "./frame";

type Listener = (f: Frame) => void;

/**
 * Owns the AudioContext. Feeds either the microphone or an audio file through
 * the same analysis path and calls listeners once per animation frame.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private frameAnalyser: FrameAnalyser | null = null;
  private buf = new Float32Array(BUFFER_SIZE);
  private source: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private t0 = 0;
  private listeners = new Set<Listener>();
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  mode: "idle" | "mic" | "file" = "idle";
  private wakeLock: { release: () => Promise<void> } | null = null;
  private onVisible = () => { if (document.visibilityState === "visible" && this.mode === "mic") void this.keepAwake(); };

  /** Phones dim and lock mid-song otherwise. Best effort: not every browser has the API. */
  private async keepAwake() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      if (!nav.wakeLock || this.wakeLock) return;
      this.wakeLock = await nav.wakeLock.request("screen");
      document.addEventListener("visibilitychange", this.onVisible);
    } catch { /* denied or unsupported */ }
  }

  private async releaseWake() {
    document.removeEventListener("visibilitychange", this.onVisible);
    const w = this.wakeLock;
    this.wakeLock = null;
    if (w) { try { await w.release(); } catch { /* already gone */ } }
  }
  /** development only: a synthetic voice driven from the console instead of the microphone */
  fake: { osc: OscillatorNode; gain: GainNode; vowel: (f1: number, f2: number) => void } | null = null;

  onFrame(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Must be called from a click/tap so browsers allow audio to start. */
  private async ensureContext() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: "interactive" });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = BUFFER_SIZE;
      this.analyser.smoothingTimeConstant = 0;
      this.frameAnalyser = new FrameAnalyser(this.ctx.sampleRate);
      this.t0 = this.ctx.currentTime;
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx;
  }

  now() {
    return this.ctx ? this.ctx.currentTime - this.t0 : 0;
  }

  setGate(db: number) {
    if (this.frameAnalyser) this.frameAnalyser.gateDb = db;
  }

  async startMic() {
    const ctx = await this.ensureContext();
    this.disconnect();
    // Browser "voice call" processing wrecks pitch and volume measurements, so switch it all off.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.source = ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser!);
    this.mode = "mic";
    void this.keepAwake();
    this.loop();
  }

  /** Development aid: an oscillator stands in for the singer so the app can be driven without a mic. */
  async startFakeMic() {
    const ctx = await this.ensureContext();
    this.disconnect();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 220;
    gain.gain.value = 0;
    // Two resonances so the synthetic voice can be given a vowel shape from the console.
    const mix = ctx.createGain();
    osc.connect(gain);
    const res = [800, 1250].map((f) => { const b = ctx.createBiquadFilter(); b.type = "bandpass"; b.frequency.value = f; b.Q.value = 5; gain.connect(b).connect(mix); return b; });
    const dry = ctx.createGain(); dry.gain.value = 0.15; gain.connect(dry).connect(mix);
    mix.connect(this.analyser!);
    // Route it through a MediaStream too so recording works exactly as with a real microphone.
    const dest = ctx.createMediaStreamDestination();
    mix.connect(dest);
    this.stream = dest.stream;
    osc.start();
    this.fake = { osc, gain, vowel: (f1, f2) => { res[0].frequency.value = f1; res[1].frequency.value = f2; } };
    this.source = gain;
    this.mode = "mic";
    this.loop();
  }

  async startFile(el: HTMLAudioElement) {
    const ctx = await this.ensureContext();
    this.disconnect();
    let node = this.elementSources.get(el);
    if (!node) {
      node = ctx.createMediaElementSource(el);
      this.elementSources.set(el, node);
    }
    node.connect(this.analyser!);
    node.connect(ctx.destination);
    this.source = node;
    this.mode = "file";
    this.loop();
  }

  /** Starts capturing the microphone. Returns the engine time at which the clip begins, or null. */
  startRecording(): number | null {
    if (!this.stream || typeof MediaRecorder === "undefined") return null;
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start();
    return this.now();
  }

  get recording() {
    return !!this.recorder && this.recorder.state === "recording";
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

  private disconnect() {
    cancelAnimationFrame(this.raf);
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  stop() {
    this.disconnect();
    this.mode = "idle";
    void this.releaseWake();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.analyser || !this.frameAnalyser) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const frame = this.frameAnalyser.analyse(this.buf, this.now());
    this.listeners.forEach((fn) => fn(frame));
  };
}
