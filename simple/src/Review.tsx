import { useEffect, useRef, useState } from "react";
import { Maximize2, Pause, Play, X, ZoomIn, ZoomOut } from "lucide-react";
import { PitchDetector, hzToMidi, isBlackKey, noteName } from "./audio/pitch";

interface Pt { t: number; midi: number; db: number }

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Work out the pitch and level of a recording, a slice at a time so the page stays responsive. */
async function analyse(blob: Blob, onProgress: (p: number) => void): Promise<{ pts: Pt[]; duration: number }> {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  void ctx.close();
  const data = audio.getChannelData(0), sr = audio.sampleRate;
  const size = 4096, hop = Math.round(sr / 40);
  const det = new PitchDetector(sr);
  let peak = -90;
  const raw: { t: number; midi: number; db: number }[] = [];
  for (let i = 0, k = 0; i + size <= data.length; i += hop, k++) {
    const buf = data.subarray(i, i + size);
    let sq = 0;
    for (let j = size - 2048; j < size; j++) sq += buf[j] * buf[j];
    const db = 10 * Math.log10(sq / 2048 + 1e-12);
    peak = Math.max(peak, db);
    const p = db > -60 ? det.detect(buf) : { freq: 0, clarity: 0 };
    raw.push({ t: (i + size) / sr, midi: p.freq > 0 && p.clarity >= 0.8 ? hzToMidi(p.freq) : NaN, db });
    if (k % 120 === 0) { onProgress(i / data.length); await new Promise((r) => setTimeout(r)); }
  }
  // Anything far quieter than the loudest singing is the room, not the voice.
  const floor = Math.max(-55, peak - 32);
  return { pts: raw.map((p) => (p.db < floor ? { ...p, midi: NaN } : p)), duration: audio.duration };
}

/**
 * A recording laid out to look at closely: green where the voice sat on a note, amber where it
 * was close, red where it was off, and thicker where it was louder. Zoom in to see a single note.
 */
export function Review({ blob, title, onClose }: { blob: Blob; title: string; onClose: () => void }) {
  const [state, setState] = useState<{ pts: Pt[]; duration: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [clock, setClock] = useState(0);
  const [url] = useState(() => URL.createObjectURL(blob));
  const canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const Z = useRef({ spp: 0.02, left: 0, drag: null as null | { x: number; left: number; moved: boolean }, pointers: new Map<number, number>(), pinch: null as null | { dist: number; spp: number } });

  useEffect(() => {
    let gone = false;
    analyse(blob, (p) => !gone && setProgress(p)).then((r) => { if (!gone) setState(r); }).catch(() => !gone && setError(true));
    return () => { gone = true; URL.revokeObjectURL(url); };
  }, [blob, url]);

  const fit = () => { const c = canvas.current; if (!c || !state) return; Z.current.spp = state.duration / Math.max(100, c.clientWidth - 44); Z.current.left = 0; };
  const zoom = (factor: number, atX?: number) => {
    const c = canvas.current; if (!c || !state) return;
    const z = Z.current, x = (atX ?? c.clientWidth / 2) - 44;
    const t = z.left + x * z.spp;
    z.spp = clamp(z.spp * factor, 0.0008, state.duration / 60);
    z.left = clamp(t - x * z.spp, 0, Math.max(0, state.duration - (c.clientWidth - 44) * z.spp));
  };
  useEffect(() => { if (state) fit(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [state]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !state) return;
    const g = c.getContext("2d")!;
    let raf = 0;
    // Frame the picture on where the voice actually was, ignoring the odd stray reading.
    const voiced = state.pts.filter((p) => !Number.isNaN(p.midi)).map((p) => p.midi).sort((a, b) => a - b);
    const lo = voiced.length ? voiced[Math.floor(voiced.length * 0.01)] - 3 : 52, hi = voiced.length ? voiced[Math.ceil(voiced.length * 0.99) - 1] + 3 : 70;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const z = Z.current, gutter = 44, bottom = H - 20, top = 8;
      const y = (m: number) => bottom - ((m - lo) / (hi - lo)) * (bottom - top);
      const x = (t: number) => gutter + (t - z.left) / z.spp;
      const row = (bottom - top) / (hi - lo);
      g.font = "500 11px Inter, sans-serif"; g.textBaseline = "middle";
      for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
        g.fillStyle = isBlackKey(m) ? "rgba(255,255,255,0.015)" : "rgba(255,255,255,0.035)";
        g.fillRect(gutter, y(m) - row / 2, W - gutter, row - 1);
        if (!isBlackKey(m) && (row >= 13 || m % 12 === 0)) { g.fillStyle = "rgba(244,241,236,0.45)"; g.fillText(noteName(m), 4, y(m)); }
      }
      // Time marks.
      const stepS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30].find((s) => s / z.spp >= 70) ?? 60;
      g.fillStyle = "rgba(244,241,236,0.45)"; g.textBaseline = "alphabetic";
      for (let t = Math.ceil(z.left / stepS) * stepS; x(t) < W; t += stepS) { g.fillRect(x(t), bottom, 1, 4); g.fillText(stepS < 1 ? t.toFixed(1) : fmt(t), x(t) + 3, H - 4); }
      g.lineCap = "round";
      const pts = state.pts;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (Number.isNaN(a.midi) || Number.isNaN(b.midi) || Math.abs(b.midi - a.midi) > 2.5) continue;
        const xb = x(b.t);
        if (xb < gutter || x(a.t) > W) continue;
        const off = Math.abs(b.midi - Math.round(b.midi)) * 100;
        g.strokeStyle = off <= 20 ? "#37d6b2" : off <= 40 ? "#ffb84d" : "#ff5c7a";
        g.lineWidth = 2 + clamp((b.db + 50) / 40, 0, 1) * 9;
        g.beginPath(); g.moveTo(Math.max(gutter, x(a.t)), y(a.midi)); g.lineTo(xb, y(b.midi)); g.stroke();
      }
      const t = audio.current?.currentTime ?? 0;
      if (x(t) >= gutter) { g.fillStyle = "#fff"; g.fillRect(x(t) - 1, top, 2, bottom - top); }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [state]);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const z = Z.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    z.pointers.set(e.pointerId, e.clientX);
    if (z.pointers.size === 2) { const [a, b] = [...z.pointers.values()]; z.pinch = { dist: Math.abs(a - b) || 1, spp: z.spp }; z.drag = null; }
    else z.drag = { x: e.clientX, left: z.left, moved: false };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const z = Z.current;
    if (!z.pointers.has(e.pointerId) || !state) return;
    z.pointers.set(e.pointerId, e.clientX);
    if (z.pinch && z.pointers.size === 2) { const [a, b] = [...z.pointers.values()]; z.spp = clamp(z.pinch.spp * z.pinch.dist / (Math.abs(a - b) || 1), 0.0008, state.duration / 60); return; }
    if (!z.drag) return;
    const dx = e.clientX - z.drag.x;
    if (Math.abs(dx) > 4) z.drag.moved = true;
    z.left = clamp(z.drag.left - dx * z.spp, 0, Math.max(0, state.duration - (e.currentTarget.clientWidth - 44) * z.spp));
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const z = Z.current;
    z.pointers.delete(e.pointerId);
    z.pinch = null;
    // A tap, not a drag: jump the playback there.
    if (z.drag && !z.drag.moved && audio.current) { const r = e.currentTarget.getBoundingClientRect(); audio.current.currentTime = Math.max(0, z.left + (e.clientX - r.left - 44) * z.spp); }
    z.drag = null;
  };

  const voiced = state ? state.pts.filter((p) => !Number.isNaN(p.midi)) : [];
  const inTune = voiced.length ? voiced.filter((p) => Math.abs(p.midi - Math.round(p.midi)) <= 0.25).length / voiced.length : 0;

  return (
    <main className="review">
      <header className="bar">
        <strong>{title}</strong>
        <button className="icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      {error ? <p className="note">This recording could not be read.</p> : !state ? <p className="note">Listening back… {Math.round(progress * 100)}%</p> : (
        <>
          <div className="row">
            <button className="icon" onClick={() => zoom(0.6)} aria-label="Zoom in"><ZoomIn size={18} /></button>
            <button className="icon" onClick={() => zoom(1.6)} aria-label="Zoom out"><ZoomOut size={18} /></button>
            <button className="icon" onClick={fit} aria-label="Show it all"><Maximize2 size={18} /></button>
            <span className="legend"><i style={{ background: "#37d6b2" }} />on the note <i style={{ background: "#ffb84d" }} />close <i style={{ background: "#ff5c7a" }} />off · thicker = louder</span>
          </div>
          <canvas ref={canvas} className="review-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            onWheel={(e) => zoom(e.deltaY > 0 ? 1.15 : 0.87, e.clientX - e.currentTarget.getBoundingClientRect().left)} />
          <div className="row player">
            <audio ref={audio} src={url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={(e) => setClock(e.currentTarget.currentTime)} />
            <button className="icon" onClick={() => { const a = audio.current; if (a) { if (a.paused) void a.play(); else a.pause(); } }} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
            <span className="time">{fmt(clock)}</span>
            <input type="range" min={0} max={state.duration} step={0.01} value={Math.min(clock, state.duration)} onChange={(e) => { if (audio.current) audio.current.currentTime = Number(e.target.value); setClock(Number(e.target.value)); }} aria-label="Position" />
            <span className="time">{fmt(state.duration)}</span>
          </div>
          <p className="note">{voiced.length < 10 ? "No singing was picked up in this recording." : `${Math.round(inTune * 100)}% of your singing sat on a note. Drag to move, pinch or scroll to zoom, tap to play from a spot.`}</p>
        </>
      )}
    </main>
  );
}
