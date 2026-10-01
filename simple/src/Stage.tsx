import { useEffect, useRef } from "react";
import { isBlackKey, noteName } from "./audio/pitch";
import type { GlideRun } from "./glide";
import type { Take, TracePoint } from "./sing";
import { LATENCY } from "./sing";

/** What the stage draws. Written by the app as audio arrives, read here every animation frame. */
export interface StageView {
  now: () => number;
  trace: TracePoint[];
  take: Take | null;
  glide: GlideRun | null;
  /** until when the piano is showing a slide for the singer to copy */
  listenUntil: number;
  /** the last note tapped for a guide tone */
  tap: { midi: number; t: number } | null;
}

const GREEN = "#3ecfa9", AMBER = "#f2b14c", RED = "#f0647c", BLUE = "#9fb0ff", INK = "rgba(240,238,233,";
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/**
 * The one picture the app is built around: pitch up the side, time flowing right to left, the
 * voice as a line that turns green when it sits on a note. Tap any pitch to hear it on the piano.
 * In a lesson or song, the notes to hear and then sing arrive from the right.
 */
export function Stage({ view, onTap }: { view: React.MutableRefObject<StageView>; onTap: (midi: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const geom = useRef({ lo: 52, hi: 70, top: 10, bottom: 100 });

  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext("2d")!;
    let W = 0, H = 0, raf = 0, lo = 52, hi = 70;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (W < 40 || H < 40) return;
      const v = view.current;
      const now = v.now();
      const take = v.take, glide = v.glide;
      const narrow = W < 520;
      const gutter = narrow ? 34 : 46;
      const top = 12, wordsH = take ? 36 : 12;
      const bottom = H - wordsH;
      const laneH = Math.max(20, bottom - top);
      const hitX = gutter + (W - gutter) * 0.28;
      const pps = (W - gutter) / 7;

      // What range to show: the song's, the slide's, or wherever the voice has been lately.
      let wantLo: number, wantHi: number;
      const recent = v.trace.filter((p) => p.voiced && p.t > now - 4).map((p) => p.midi);
      if (take) { wantLo = take.p.lo - 3; wantHi = take.p.hi + 3; }
      else if (glide) { wantLo = Math.min(glide.cfg.from, glide.cfg.to) - 3; wantHi = Math.max(glide.cfg.from, glide.cfg.to) + 3; }
      else if (recent.length) { wantLo = Math.min(...recent) - 5; wantHi = Math.max(...recent) + 5; }
      else { wantLo = lo; wantHi = hi; }
      if (recent.length && (take || glide)) { wantLo = Math.min(wantLo, Math.min(...recent) - 2); wantHi = Math.max(wantHi, Math.max(...recent) + 2); }
      if (wantHi - wantLo < 14) { const mid = (wantHi + wantLo) / 2; wantLo = mid - 7; wantHi = mid + 7; }
      lo += (wantLo - lo) * 0.08; hi += (wantHi - hi) * 0.08;
      geom.current = { lo, hi, top, bottom };
      const y = (m: number) => bottom - ((m - lo) / (hi - lo)) * laneH;
      const row = laneH / (hi - lo);

      g.clearRect(0, 0, W, H);
      // Pitch rows, like a keyboard on its side.
      g.font = `500 ${narrow ? 10 : 11}px Inter, sans-serif`;
      g.textBaseline = "middle"; g.textAlign = "left";
      const tapped = v.tap && now - v.tap.t < 1.4 ? v.tap : null;
      for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
        const yy = y(m);
        const isC = ((m % 12) + 12) % 12 === 0;
        g.fillStyle = isBlackKey(m) ? "rgba(255,255,255,0.012)" : "rgba(255,255,255,0.032)";
        g.fillRect(gutter, yy - row / 2, W - gutter, row - 1);
        const lit = !!tapped && tapped.midi === m;
        if (lit) { g.fillStyle = `rgba(159,176,255,${0.28 * (1 - (now - tapped!.t) / 1.4)})`; g.fillRect(0, yy - row / 2, W, row - 1); }
        if (isC) { g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(gutter, yy, W - gutter, 1); }
        if (lit || (!isBlackKey(m) && (row >= 13 || isC))) { g.fillStyle = lit ? "#fff" : INK + (isC ? "0.7)" : "0.34)"); g.fillText(noteName(m), 5, yy); }
      }

      // The line where now is.
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.fillRect(hitX - 0.75, top, 1.5, bottom - top);

      let turn = "";
      if (glide) {
        g.setLineDash([8, 6]); g.lineWidth = 1.5; g.strokeStyle = "rgba(159,176,255,0.75)";
        for (const m of [glide.cfg.from, glide.cfg.to]) { g.beginPath(); g.moveTo(gutter, y(m)); g.lineTo(W, y(m)); g.stroke(); }
        g.setLineDash([]);
        turn = now < v.listenUntil ? "Listen" : "Sing";
      }

      if (take) {
        const t = take.time(now);
        const sounding = take.noteAt(t), sungNow = take.noteAt(t - LATENCY);
        let wordRight = -Infinity;
        for (const n of take.p.notes) {
          const yy = y(n.midi), h = clamp(row * 0.78, 8, 18);
          // A short, sharp note is drawn as a dot rather than a sliver.
          const x0 = hitX + (n.start - t) * pps, w = Math.max(h, n.dur * pps);
          if (x0 > W || x0 + w < gutter) continue;
          const left = Math.max(gutter, x0), width = w - (left - x0);
          g.beginPath();
          g.roundRect(left, yy - h / 2, Math.max(2, width), h, h / 2);
          if (n.role === "cue") {
            // The piano's notes: outlines, filled while they sound.
            if (sounding === n) { g.fillStyle = "rgba(159,176,255,0.55)"; g.fill(); }
            g.strokeStyle = "rgba(159,176,255,0.7)"; g.lineWidth = 1.25; g.stroke();
          } else {
            const state = take.landed(n.i);
            g.fillStyle = state === true ? GREEN : state === false && x0 + w < hitX ? "rgba(240,100,124,0.55)" : sungNow === n ? "rgba(159,176,255,0.95)" : "rgba(159,176,255,0.4)";
            g.fill();
          }
          if (n.word) {
            const isNow = n.role === "cue" ? sounding === n : sungNow === n;
            g.textAlign = "left"; g.textBaseline = "alphabetic";
            g.font = `${isNow ? 600 : 400} ${narrow ? 13 : 15}px Inter, sans-serif`;
            g.fillStyle = isNow ? "#ffffff" : INK + "0.45)";
            // Quick notes sit close together: nudge a word along rather than print it over the last one.
            const wx = Math.max(x0, wordRight + 6);
            if (wx >= gutter - 2 && wx < W) { g.fillText(n.word, wx, H - 12); wordRight = wx + g.measureText(n.word).width; }
          }
        }
        turn = take.listening(now) ? "Listen" : "Sing";
        g.textAlign = "left"; g.textBaseline = "middle";
      }

      if (turn) {
        g.textAlign = "right"; g.textBaseline = "top";
        g.font = `600 ${narrow ? 12 : 13}px Inter, sans-serif`;
        g.fillStyle = turn === "Sing" ? GREEN : INK + "0.75)";
        g.fillText(turn.toUpperCase(), W - 14, top + 6);
        g.textAlign = "left"; g.textBaseline = "middle";
      }

      // The voice: a line flowing away to the left, thicker when louder.
      g.lineCap = "round";
      const tr = v.trace;
      for (let i = 1; i < tr.length; i++) {
        const a = tr[i - 1], b = tr[i];
        const age = now - b.t;
        if (age > 5 || !a.voiced || !b.voiced || b.t - a.t > 0.12 || Math.abs(b.midi - a.midi) > 2.5) continue;
        const xb = hitX - age * pps;
        if (xb < gutter) continue;
        const off = Math.abs(b.midi - Math.round(b.midi)) * 100;
        const q = b.q >= 0 ? b.q : off <= 20 ? 1 : off <= 40 ? 0.5 : 0;
        g.strokeStyle = b.q === 2 ? BLUE : q === 1 ? GREEN : q === 0.5 ? AMBER : RED;
        g.lineWidth = 2 + clamp((b.db + 50) / 40) * 6;
        g.globalAlpha = clamp(1 - age / 5) * 0.95;
        g.beginPath(); g.moveTo(Math.max(gutter, hitX - (now - a.t) * pps), y(a.midi)); g.lineTo(xb, y(b.midi)); g.stroke();
      }
      g.globalAlpha = 1;
      const last = tr[tr.length - 1];
      if (last && last.voiced && now - last.t < 0.2) {
        const off = Math.abs(last.midi - Math.round(last.midi)) * 100;
        const q = last.q >= 0 ? last.q : off <= 20 ? 1 : off <= 40 ? 0.5 : 0;
        const col = last.q === 2 ? BLUE : q === 1 ? GREEN : q === 0.5 ? AMBER : RED;
        g.shadowColor = col; g.shadowBlur = 14; g.fillStyle = col;
        g.beginPath(); g.arc(hitX, y(last.midi), 7, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0; g.fillStyle = "#fff";
        g.beginPath(); g.arc(hitX, y(last.midi), 3, 0, Math.PI * 2); g.fill();
      }
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [view]);

  /** Tap a pitch to hear it. */
  const tap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { lo, hi, top, bottom } = geom.current;
    const r = e.currentTarget.getBoundingClientRect();
    const yy = e.clientY - r.top;
    if (yy < top - 4 || yy > bottom + 4) return;
    onTap(Math.round(lo + ((bottom - yy) / (bottom - top)) * (hi - lo)));
  };

  return <canvas ref={ref} className="stage" onPointerDown={tap} aria-label="Pitch. Tap a note to hear it." />;
}
