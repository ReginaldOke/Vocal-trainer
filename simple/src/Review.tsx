import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Maximize2, Pause, Play, ZoomIn, ZoomOut } from "lucide-react";
import { PitchDetector, hzToMidi, isBlackKey, noteName } from "./audio/pitch";
import { drawRibbon, smoothWidths, thickness, type RibbonPoint } from "./ribbon";

interface Pt { t: number; midi: number; db: number }

const GUTTER = 46;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Work out the pitch and level of a recording, a slice at a time so the page stays responsive. */
async function analyse(blob: Blob): Promise<{ pts: Pt[]; duration: number }> {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  void ctx.close();
  const data = audio.getChannelData(0), sr = audio.sampleRate;
  const size = 4096, hop = Math.round(sr / 40);
  const det = new PitchDetector(sr);
  let peak = -90;
  const raw: Pt[] = [];
  for (let i = 0, k = 0; i + size <= data.length; i += hop, k++) {
    const buf = data.subarray(i, i + size);
    let sq = 0;
    for (let j = size - 2048; j < size; j++) sq += buf[j] * buf[j];
    const db = 10 * Math.log10(sq / 2048 + 1e-12);
    peak = Math.max(peak, db);
    const p = db > -60 ? det.detect(buf) : { freq: 0, clarity: 0 };
    raw.push({ t: (i + size) / sr, midi: p.freq > 0 && p.clarity >= 0.8 ? hzToMidi(p.freq) : NaN, db });
    if (k % 120 === 0) await new Promise((r) => setTimeout(r));
  }
  // Anything far quieter than the loudest singing is the room, not the voice.
  const floor = Math.max(-55, peak - 32);
  return { pts: raw.map((p) => (p.db < floor ? { ...p, midi: NaN } : p)), duration: audio.duration };
}

/**
 * A recording laid out to look at closely: green where the voice sat on a note, amber where it
 * was close, red where it was off, and thicker where it was louder. Drag to move, pinch or scroll
 * to zoom, tap to play from a spot, tap a note name to hear it.
 */
export function Review({ blob, onClose, onNote }: { blob: Blob; onClose: () => void; onNote: (midi: number) => void }) {
  const [state, setState] = useState<{ pts: Pt[]; duration: number } | null>(null);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [clock, setClock] = useState(0);
  const [url] = useState(() => URL.createObjectURL(blob));
  const canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const Z = useRef({ spp: 0.02, left: 0, lo: 52, hi: 70, top: 8, bottom: 100, drag: null as null | { x: number; left: number; moved: boolean }, pointers: new Map<number, number>(), pinch: null as null | { dist: number; spp: number } });

  useEffect(() => {
    let gone = false;
    analyse(blob).then((r) => { if (!gone) setState(r); }).catch(() => !gone && setError(true));
    return () => { gone = true; URL.revokeObjectURL(url); };
  }, [blob, url]);

  const fit = () => { const c = canvas.current; if (!c || !state) return; Z.current.spp = state.duration / Math.max(100, c.clientWidth - GUTTER); Z.current.left = 0; };
  const zoom = (factor: number, atX?: number) => {
    const c = canvas.current; if (!c || !state) return;
    const z = Z.current, x = (atX ?? c.clientWidth / 2) - GUTTER;
    const t = z.left + x * z.spp;
    z.spp = clamp(z.spp * factor, 0.0008, state.duration / 60);
    z.left = clamp(t - x * z.spp, 0, Math.max(0, state.duration - (c.clientWidth - GUTTER) * z.spp));
  };
  useEffect(() => { if (state) fit(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [state]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !state) return;
    const g = c.getContext("2d")!;
    let raf = 0;
    // Frame the picture on where the voice actually was, ignoring the odd stray reading.
    const voiced = state.pts.filter((p) => !Number.isNaN(p.midi)).map((p) => p.midi).sort((a, b) => a - b);
    const lo = voiced.length ? voiced[Math.floor(voiced.length * 0.05)] - 4 : 52, hi = voiced.length ? voiced[Math.ceil(voiced.length * 0.95) - 1] + 4 : 70;
    // The quiet and loud ends of this take, so thickness uses the whole range the singer used.
    const levels = state.pts.filter((p) => !Number.isNaN(p.midi)).map((p) => p.db).sort((a, b) => a - b);
    const quiet = levels.length ? levels[Math.floor(levels.length * 0.1)] : -45, loudest = levels.length ? levels[Math.ceil(levels.length * 0.95) - 1] : -15;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const z = Z.current, bottom = H - 20, top = 8;
      Object.assign(z, { lo, hi, top, bottom });
      const y = (m: number) => bottom - ((m - lo) / (hi - lo)) * (bottom - top);
      const x = (t: number) => GUTTER + (t - z.left) / z.spp;
      const row = (bottom - top) / (hi - lo);
      g.font = "500 11px Inter, sans-serif"; g.textBaseline = "middle";
      for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
        g.fillStyle = isBlackKey(m) ? "rgba(255,255,255,0.012)" : "rgba(255,255,255,0.032)";
        g.fillRect(GUTTER, y(m) - row / 2, W - GUTTER, row - 1);
        if (!isBlackKey(m) && (row >= 13 || m % 12 === 0)) { g.fillStyle = "rgba(240,238,233,0.4)"; g.fillText(noteName(m), 5, y(m)); }
      }
      const stepS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30].find((s) => s / z.spp >= 70) ?? 60;
      g.fillStyle = "rgba(240,238,233,0.4)"; g.textBaseline = "alphabetic";
      for (let t = Math.ceil(z.left / stepS) * stepS; x(t) < W; t += stepS) g.fillText(stepS < 1 ? t.toFixed(1) : fmt(t), x(t) + 3, H - 4);
      // The voice as a band: thick where it was loud, thin where it was soft.
      const pts = state.pts;
      let run: RibbonPoint[] = [], prev: Pt | null = null;
      const flush = () => { if (run.length > 1) { smoothWidths(run); drawRibbon(g, run, (c) => c); } run = []; prev = null; };
      for (const b of pts) {
        const xb = x(b.t);
        if (Number.isNaN(b.midi) || xb < GUTTER - 40 || xb > W + 40) { flush(); continue; }
        // A jump straight to another note is a new stroke, not a thick bar joining the two.
        if (prev && Math.abs(b.midi - prev.midi) > 1.5) flush();
        const off = Math.abs(b.midi - Math.round(b.midi)) * 100;
        run.push({ x: Math.max(GUTTER, xb), y: y(b.midi), w: thickness(b.db, quiet, loudest, 3, clamp(row * 1.1, 12, 22)), c: off <= 20 ? "#3ecfa9" : off <= 40 ? "#f2b14c" : "#f0647c" });
        prev = b;
      }
      flush();
      const t = audio.current?.currentTime ?? 0;
      if (x(t) >= GUTTER) { g.fillStyle = "#fff"; g.fillRect(x(t) - 0.75, top, 1.5, bottom - top); }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [state]);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const z = Z.current;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
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
    z.left = clamp(z.drag.left - dx * z.spp, 0, Math.max(0, state.duration - (e.currentTarget.clientWidth - GUTTER) * z.spp));
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const z = Z.current;
    z.pointers.delete(e.pointerId);
    z.pinch = null;
    if (z.drag && !z.drag.moved) {
      const r = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      // A tap on a note name plays it; a tap on the picture plays the recording from there.
      if (px < GUTTER) onNote(Math.round(z.lo + ((z.bottom - py) / (z.bottom - z.top)) * (z.hi - z.lo)));
      else if (audio.current) audio.current.currentTime = Math.max(0, z.left + (px - GUTTER) * z.spp);
    }
    z.drag = null;
  };

  return (
    <main className="review">
      <header className="bar">
        <button className="icon" onClick={onClose} aria-label="Back"><ArrowLeft size={18} /></button>
        <span className="tools">
          <button className="icon" onClick={() => zoom(0.6)} aria-label="Zoom in" disabled={!state}><ZoomIn size={18} /></button>
          <button className="icon" onClick={() => zoom(1.6)} aria-label="Zoom out" disabled={!state}><ZoomOut size={18} /></button>
          <button className="icon" onClick={fit} aria-label="Show it all" disabled={!state}><Maximize2 size={18} /></button>
        </span>
      </header>
      <section className="stage-wrap">
        {error ? <p className="error">This recording could not be read.</p> : (
          <canvas ref={canvas} className="stage review-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            onWheel={(e) => zoom(e.deltaY > 0 ? 1.15 : 0.87, e.clientX - e.currentTarget.getBoundingClientRect().left)} />
        )}
      </section>
      <footer className="player">
        <audio ref={audio} src={url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={(e) => setClock(e.currentTarget.currentTime)} />
        <button className="icon play" onClick={() => { const a = audio.current; if (a) { if (a.paused) void a.play(); else a.pause(); } }} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
        <span className="time">{fmt(clock)}</span>
        <input type="range" min={0} max={state?.duration ?? 1} step={0.01} value={Math.min(clock, state?.duration ?? 1)} onChange={(e) => { if (audio.current) audio.current.currentTime = Number(e.target.value); setClock(Number(e.target.value)); }} aria-label="Position" />
        <span className="time">{fmt(state?.duration ?? 0)}</span>
      </footer>
    </main>
  );
}
