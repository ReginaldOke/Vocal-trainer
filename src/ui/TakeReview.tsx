import { useEffect, useMemo, useRef, useState } from "react";
import { Tracker } from "../audio/analysis";
import type { Frame } from "../audio/frame";
import { analyseInWorker, decodeClip } from "../audio/offline";
import { isBlackKey, noteName } from "../audio/pitch";
import { foldedCents } from "../coach/rules";
import type { ReviewTarget } from "./GameScreen";
import { offWords } from "../coach/words";

interface Props {
  blob: Blob;
  /** notes the take was sung against, if any */
  targets: ReviewTarget[] | null;
  title: string;
  onClose: () => void;
}

/** One analysed point of the take. */
interface Pt {
  t: number;
  midi: number;
  db: number;
  voiced: boolean;
  /** cents from where the note should be */
  err: number;
  /** 0 in tune, 1 close, 2 pitchy */
  cls: 0 | 1 | 2;
}

interface Spot { t0: number; t1: number; err: number }

interface Stats {
  duration: number;
  sung: number;
  pct: [number, number, number];
  meanAbs: number;
  bias: number;
  notes: number;
  spots: Spot[];
  floor: number;
  peak: number;
}

const GOOD = 25, CLOSE = 45;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** Work out how far each frame is from where it should be, then group the worst stretches. */
function analyse(frames: Frame[], targets: ReviewTarget[] | null): { pts: Pt[]; stats: Stats } {
  const tracker = new Tracker();
  for (const f of frames) tracker.push(f);
  const last = frames[frames.length - 1];
  if (last) tracker.push({ ...last, t: last.t + 0.3, voiced: false, midi: NaN });
  const notes = tracker.notes;

  const raw: number[] = frames.map((f) => {
    if (!f.voiced) return NaN;
    if (targets) {
      const i = targets.findIndex((x) => f.t >= x.start && f.t < x.end);
      if (i < 0) {
        // Between notes: the singer was leaving one target or finding the next, so judge against
        // whichever of the two is closer. Far from any note, fall back to the nearest semitone.
        const prev = [...targets].reverse().find((x) => x.end <= f.t), next = targets.find((x) => x.start > f.t);
        const cands = [prev, next].filter((x): x is ReviewTarget => !!x && Math.abs(f.t - (x === prev ? x.end : x.start)) < 2);
        if (!cands.length) return (f.midi - Math.round(f.midi)) * 100;
        return cands.map((x) => foldedCents(f.midi, x.midi)).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
      }
      const tg = targets[i];
      let err = foldedCents(f.midi, tg.midi);
      // Near a change of note the singer may still be finishing the last one or already be on
      // the next: judge against whichever neighbour is closest, as the game itself does.
      const prev = targets[i - 1], next = targets[i + 1];
      if (prev && f.t - tg.start < 0.3) { const e = foldedCents(f.midi, prev.midi); if (Math.abs(e) < Math.abs(err)) err = e; }
      if (next && tg.end - f.t < 0.3) { const e = foldedCents(f.midi, next.midi); if (Math.abs(e) < Math.abs(err)) err = e; }
      return err;
    }
    const n = notes.find((x) => f.t >= x.start && f.t <= x.end);
    if (n) {
      const base = Math.round(n.median);
      // Real vibrato is judged by its centre, not its swing.
      return n.wobble === "vibrato" ? (n.median - base) * 100 : (f.midi - base) * 100;
    }
    return (f.midi - Math.round(f.midi)) * 100;
  });
  // A three-frame median kills single-frame glitches without hiding real slides.
  const med = raw.map((v, i) => {
    if (Number.isNaN(v)) return v;
    const a = [raw[i - 1], v, raw[i + 1]].filter((x) => x !== undefined && !Number.isNaN(x)).sort((p, q) => p - q);
    return a[a.length >> 1];
  });
  const pts: Pt[] = frames.map((f, i) => {
    const err = med[i];
    const a = Math.abs(err);
    return { t: f.t, midi: f.midi, db: f.db, voiced: f.voiced, err, cls: !f.voiced ? 0 : a <= GOOD ? 0 : a <= CLOSE ? 1 : 2 };
  });

  const voiced = pts.filter((p) => p.voiced);
  // Volume scale from the sung frames only, so digital silence does not flatten the ribbon.
  const dbs = voiced.map((p) => p.db).sort((a, b) => a - b);
  const floor = (dbs[Math.floor(dbs.length * 0.05)] ?? -60) - 4;
  const peak = dbs[Math.floor(dbs.length * 0.98)] ?? -10;
  const hop = frames.length > 1 ? frames[1].t - frames[0].t : 0.02;
  const counts = [0, 0, 0];
  for (const p of voiced) counts[p.cls]++;
  const spots: Spot[] = [];
  let cur: { t0: number; t1: number; errs: number[] } | null = null;
  for (const p of pts) {
    if (p.voiced && p.cls === 2) {
      if (cur && p.t - cur.t1 < 0.12) { cur.t1 = p.t; cur.errs.push(p.err); }
      else { if (cur) spots.push(closeSpot(cur)); cur = { t0: p.t, t1: p.t, errs: [p.err] }; }
    }
  }
  if (cur) spots.push(closeSpot(cur));
  function closeSpot(c: { t0: number; t1: number; errs: number[] }): Spot {
    return { t0: c.t0, t1: c.t1 + hop, err: c.errs.reduce((s, v) => s + v, 0) / c.errs.length };
  }
  const worst = spots.filter((s) => s.t1 - s.t0 >= 0.25).sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0)).slice(0, 8).sort((a, b) => a.t0 - b.t0);

  return {
    pts,
    stats: {
      duration: last ? last.t : 0,
      sung: voiced.length * hop,
      pct: counts.map((c) => (voiced.length ? (100 * c) / voiced.length : 0)) as [number, number, number],
      meanAbs: voiced.length ? voiced.reduce((s, p) => s + Math.abs(p.err), 0) / voiced.length : NaN,
      bias: voiced.length ? voiced.reduce((s, p) => s + p.err, 0) / voiced.length : NaN,
      notes: notes.length,
      spots: worst,
      floor,
      peak,
    },
  };
}

export function TakeReview({ blob, targets, title, onClose }: Props) {
  const [status, setStatus] = useState<"decoding" | "analysing" | "ready" | "error">("decoding");
  const [result, setResult] = useState<{ pts: Pt[]; stats: Stats } | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [clock, setClock] = useState(0);
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const Z = useRef({ spp: 0.01, left: 0, drag: null as null | { x: number; left: number; moved: boolean }, pointers: new Map<number, { x: number; y: number }>(), pinch: null as null | { dist: number; spp: number; mid: number; midT: number } });

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ctx = new OfflineAudioContext(1, 1, 48000);
        const { pcm, sampleRate } = await decodeClip(blob, ctx);
        if (!alive) return;
        setStatus("analysing");
        // Gate from the clip itself: a little above its quietest moments.
        const block = 2048;
        const levels: number[] = [];
        for (let i = 0; i + block <= pcm.length; i += block) {
          let sq = 0;
          for (let j = i; j < i + block; j++) sq += pcm[j] * pcm[j];
          levels.push(10 * Math.log10(sq / block + 1e-12));
        }
        levels.sort((a, b) => a - b);
        const gate = Math.max(-75, Math.min(-35, (levels[Math.floor(levels.length * 0.08)] ?? -60) + 8));
        const frames = await analyseInWorker(pcm, sampleRate, gate);
        if (!alive) return;
        const r = analyse(frames, targets);
        setResult(r);
        const W = canvasRef.current?.clientWidth ?? 800;
        Z.current.spp = Math.max(0.0015, r.stats.duration / Math.max(100, W - 50));
        Z.current.left = 0;
        setStatus("ready");
      } catch (e) {
        console.error(e);
        if (alive) setStatus("error");
      }
    })();
    return () => { alive = false; };
  }, [blob, targets]);

  // Drawing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;
    const g = canvas.getContext("2d")!;
    let raf = 0;
    const { pts, stats } = result;
    const tg = targets ?? [];
    const colors = { paper: css("--canvas"), black: css("--canvas-black-key"), line: css("--line"), ink: css("--ink"), soft: css("--ink-soft"), ok: css("--ok"), warn: css("--warn"), bad: css("--bad"), target: css("--target") };
    const cls = [colors.ok, colors.warn, colors.bad];

    const sungMidi = pts.filter((p) => p.voiced).map((p) => p.midi).concat(tg.map((t) => t.midi));
    let lo = 48, hi = 72;
    if (sungMidi.length) {
      const s = [...sungMidi].sort((a, b) => a - b);
      lo = s[Math.floor(s.length * 0.02)] - 3;
      hi = s[Math.floor(s.length * 0.98)] + 3;
      if (hi - lo < 12) { const m = (hi + lo) / 2; lo = m - 6; hi = m + 6; }
    }

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const z = Z.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gutter = 44, axisH = 24;
      const plotW = W - gutter, plotH = H - axisH;
      const x = (t: number) => gutter + (t - z.left) / z.spp;
      const tAt = (px: number) => z.left + (px - gutter) * z.spp;
      const y = (m: number) => plotH - ((m - lo) / (hi - lo)) * plotH;
      const row = plotH / (hi - lo);

      const audio = audioRef.current;
      const now = audio?.currentTime ?? 0;
      if (audio && !audio.paused) {
        const px = x(now);
        if (px > gutter + plotW * 0.85 || px < gutter) z.left = Math.max(0, now - plotW * 0.15 * z.spp);
      }
      const maxLeft = Math.max(0, stats.duration - plotW * z.spp);
      z.left = clamp(z.left, 0, maxLeft);

      g.fillStyle = colors.paper;
      g.fillRect(0, 0, W, H);

      // Piano rows.
      g.font = `${Math.min(12, Math.max(9, row * 0.8))}px "Atkinson Hyperlegible", sans-serif`;
      g.textBaseline = "middle";
      g.textAlign = "left";
      for (let m = Math.floor(lo); m <= Math.ceil(hi); m++) {
        if (isBlackKey(m)) { g.fillStyle = colors.black; g.fillRect(gutter, y(m + 0.5), plotW, row); }
        const isC = ((m % 12) + 12) % 12 === 0;
        g.strokeStyle = colors.line;
        g.globalAlpha = isC ? 0.9 : 0.35;
        g.beginPath(); g.moveTo(gutter, y(m)); g.lineTo(W, y(m)); g.stroke();
        g.globalAlpha = 1;
        if (!isBlackKey(m) && (row >= 11 || isC) && y(m) > 6 && y(m) < plotH - 4) { g.fillStyle = isC ? colors.ink : colors.soft; g.fillText(noteName(m), 4, y(m)); }
      }
      // In-tune band around each semitone when there is no target: a subtle guide to the colouring.
      g.fillStyle = colors.ok;
      g.globalAlpha = 0.06;
      if (!tg.length) for (let m = Math.floor(lo); m <= Math.ceil(hi); m++) g.fillRect(gutter, y(m + GOOD / 100), plotW, row * (GOOD / 50));
      g.globalAlpha = 1;

      // Target notes.
      for (const t of tg) {
        const x0 = x(t.start), x1 = x(t.end);
        if (x1 < gutter || x0 > W) continue;
        const h = Math.max(8, row * 0.9);
        g.fillStyle = colors.target;
        g.globalAlpha = 0.3;
        g.beginPath();
        if (g.roundRect) g.roundRect(Math.max(gutter, x0), y(t.midi) - h / 2, Math.max(1, x1 - Math.max(gutter, x0)), h, 4); else g.rect(Math.max(gutter, x0), y(t.midi) - h / 2, Math.max(1, x1 - Math.max(gutter, x0)), h);
        g.fill();
        g.globalAlpha = 1;
        if (t.lyric && x1 - x0 > 18) { g.fillStyle = colors.soft; g.font = `11px "Atkinson Hyperlegible", sans-serif`; g.fillText(t.lyric, Math.max(gutter + 2, x0 + 3), y(t.midi) - h / 2 - 8); }
      }

      // Time axis.
      const nice = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60].find((s) => s / z.spp >= 70) ?? 60;
      g.strokeStyle = colors.line;
      g.beginPath(); g.moveTo(gutter, plotH); g.lineTo(W, plotH); g.stroke();
      g.fillStyle = colors.soft;
      g.font = `11px "Atkinson Hyperlegible", sans-serif`;
      g.textAlign = "center";
      for (let t = Math.ceil(z.left / nice) * nice; t <= tAt(W); t += nice) {
        const px = x(t);
        g.globalAlpha = 0.5;
        g.beginPath(); g.moveTo(px, 0); g.lineTo(px, plotH); g.stroke();
        g.globalAlpha = 1;
        g.fillText(nice < 1 ? `${t.toFixed(2)}s` : fmtT(t), px, plotH + 12);
      }
      g.textAlign = "left";

      // The ribbon: thickness is volume, colour is accuracy.
      const i0 = Math.max(1, pts.findIndex((p) => p.t >= tAt(gutter)) - 1);
      g.lineCap = "round";
      g.lineJoin = "round";
      const width = (p: Pt) => 1.5 + 15 * clamp((p.db - stats.floor) / Math.max(6, stats.peak - stats.floor));
      for (let i = Math.max(1, i0); i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const xb = x(b.t);
        if (xb < gutter) continue;
        if (x(a.t) > W) break;
        if (!a.voiced || !b.voiced || b.t - a.t > 0.08 || Math.abs(b.midi - a.midi) > 2.5) continue;
        g.strokeStyle = cls[b.cls];
        g.lineWidth = width(b);
        g.globalAlpha = 0.92;
        g.beginPath(); g.moveTo(x(a.t), y(a.midi)); g.lineTo(xb, y(b.midi)); g.stroke();
      }
      g.globalAlpha = 1;

      // Playhead.
      if (audio) {
        const px = x(now);
        if (px >= gutter && px <= W) {
          g.strokeStyle = colors.ink;
          g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(px, 0); g.lineTo(px, plotH); g.stroke();
          g.fillStyle = colors.ink;
          g.beginPath(); g.moveTo(px - 5, 0); g.lineTo(px + 5, 0); g.lineTo(px, 7); g.closePath(); g.fill();
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [result, targets]);

  // Zoom, pan, seek.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;
    const z = Z.current;
    const gutter = 44;
    const dur = result.stats.duration;
    const fit = () => Math.max(0.0015, dur / Math.max(100, canvas.clientWidth - gutter));
    const zoomAt = (px: number, factor: number) => {
      const t = z.left + (px - gutter) * z.spp;
      z.spp = clamp(z.spp * factor, 0.0015, fit());
      z.left = t - (px - gutter) * z.spp;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || !e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) zoomAt(e.clientX - r.left, Math.exp(e.deltaY * 0.0025));
      else z.left += (e.deltaX || e.deltaY) * z.spp;
    };
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      z.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (z.pointers.size === 2) {
        const [a, b] = [...z.pointers.values()];
        const r = canvas.getBoundingClientRect();
        const mid = (a.x + b.x) / 2 - r.left;
        z.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), spp: z.spp, mid, midT: z.left + (mid - gutter) * z.spp };
        z.drag = null;
      } else z.drag = { x: e.clientX, left: z.left, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      if (z.pointers.has(e.pointerId)) z.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (z.pinch && z.pointers.size === 2) {
        const [a, b] = [...z.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = (a.x + b.x) / 2 - r.left;
        z.spp = clamp(z.pinch.spp * (z.pinch.dist / Math.max(1, dist)), 0.0015, fit());
        z.left = z.pinch.midT - (mid - gutter) * z.spp;
        return;
      }
      if (z.drag) {
        const dx = e.clientX - z.drag.x;
        if (Math.abs(dx) > 4) z.drag.moved = true;
        z.left = z.drag.left - dx * z.spp;
        return;
      }
      const t = z.left + (e.clientX - r.left - gutter) * z.spp;
      const pts = result.pts;
      let best: Pt | null = null;
      for (const p of pts) { if (Math.abs(p.t - t) < 0.03 && p.voiced) { best = p; break; } }
      setHover(best);
    };
    const onUp = (e: PointerEvent) => {
      z.pointers.delete(e.pointerId);
      if (z.pointers.size < 2) z.pinch = null;
      if (z.drag && !z.drag.moved) {
        const r = canvas.getBoundingClientRect();
        const t = z.left + (e.clientX - r.left - gutter) * z.spp;
        const a = audioRef.current;
        if (a && t >= 0 && t <= dur) { a.currentTime = t; setClock(t); }
      }
      z.drag = null;
    };
    const onLeave = () => setHover(null);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [result]);

  const zoomBy = (factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;
    const z = Z.current;
    const gutter = 44;
    const fit = Math.max(0.0015, result.stats.duration / Math.max(100, canvas.clientWidth - gutter));
    const centrePx = gutter + (canvas.clientWidth - gutter) / 2;
    const t = z.left + (centrePx - gutter) * z.spp;
    z.spp = clamp(z.spp * factor, 0.0015, fit);
    z.left = t - (centrePx - gutter) * z.spp;
  };
  const fitAll = () => {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;
    Z.current.spp = Math.max(0.0015, result.stats.duration / Math.max(100, canvas.clientWidth - 44));
    Z.current.left = 0;
  };
  const jumpTo = (s: Spot) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const plotW = canvas.clientWidth - 44;
    const span = Math.max(1.2, (s.t1 - s.t0) * 2.5);
    Z.current.spp = Math.max(0.0015, span / plotW);
    Z.current.left = Math.max(0, (s.t0 + s.t1) / 2 - span / 2);
    const a = audioRef.current;
    if (a) { a.currentTime = Math.max(0, s.t0 - 0.3); void a.play().catch(() => undefined); }
  };

  const stats = result?.stats;
  return (
    <main className="review">
      <header className="topbar">
        <button className="link" onClick={onClose}>Vocal Coach</button>
        <h1 className="review-title">{title}</h1>
        <button onClick={onClose}>Close</button>
      </header>

      {status !== "ready" && (
        <div className="review-wait" role="status">
          {status === "decoding" && "Decoding the clip…"}
          {status === "analysing" && "Analysing pitch and volume…"}
          {status === "error" && "This clip could not be decoded. Try a WAV, MP3 or M4A file."}
        </div>
      )}

      {status === "ready" && stats && (
        <>
          <div className="review-tools">
            <div className="zoom">
              <button onClick={() => zoomBy(0.6)} aria-label="Zoom in">+</button>
              <button onClick={() => zoomBy(1 / 0.6)} aria-label="Zoom out">−</button>
              <button onClick={fitAll}>Fit</button>
              <span className="fine">Scroll to zoom, drag to pan, click to seek. Pinch on touch.</span>
            </div>
            <div className="legend">
              <span><i style={{ background: "var(--ok)" }} /> on the note</span>
              <span><i style={{ background: "var(--warn)" }} /> close</span>
              <span><i style={{ background: "var(--bad)" }} /> pitchy</span>
              <span><i className="thick" /> thicker = louder</span>
            </div>
          </div>

          <div className="review-plot">
            <canvas ref={canvasRef} className="review-canvas" role="img" aria-label="Pitch over time, coloured by accuracy and thickened by volume" />
            {hover && (
              <div className="review-tip" style={{ left: `${44 + (hover.t - Z.current.left) / Z.current.spp}px` }}>
                <strong>{noteName(hover.midi)}</strong> {offWords(hover.err)} · {fmtT(hover.t)}
              </div>
            )}
          </div>

          <audio ref={audioRef} src={url} controls className="player" onTimeUpdate={(e) => setClock(e.currentTarget.currentTime)} />

          <section className="review-stats">
            <div className="stat"><span>In tune</span><strong className="c-great">{Math.round(stats.pct[0])}%</strong></div>
            <div className="stat"><span>Close</span><strong className="c-good">{Math.round(stats.pct[1])}%</strong></div>
            <div className="stat"><span>Pitchy</span><strong className="c-miss">{Math.round(stats.pct[2])}%</strong></div>
            <div className="stat"><span>Typical miss</span><strong>{Number.isNaN(stats.meanAbs) ? "–" : stats.meanAbs < 15 ? "tiny" : stats.meanAbs < 35 ? "small" : "large"}</strong></div>
            <div className="stat"><span>Tendency</span><strong>{Number.isNaN(stats.bias) ? "–" : Math.abs(stats.bias) < 8 ? "centred" : stats.bias < 0 ? "under" : "over"}</strong></div>
            <div className="stat"><span>Sung</span><strong>{stats.sung.toFixed(1)}s of {stats.duration.toFixed(1)}s</strong></div>
          </section>

          <section className="spots">
            <h2>Where it went off</h2>
            {stats.spots.length === 0 ? (
              <p className="fine">No stretch of pitchy singing longer than a quarter of a second. Nice.</p>
            ) : (
              <ul>
                {stats.spots.map((s) => (
                  <li key={s.t0}>
                    <button onClick={() => jumpTo(s)}>
                      <strong>{fmtT(s.t0)}</strong> {(s.t1 - s.t0).toFixed(1)}s, {offWords(s.err)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="fine">Playhead at {fmtT(clock)}. {targets ? "Colour is measured against the song's notes." : "Without a song, colour is measured against the nearest note; steady vibrato is judged by its centre."}</p>
          </section>
        </>
      )}
    </main>
  );
}
