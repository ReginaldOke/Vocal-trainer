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
}

const GREEN = "#37d6b2", AMBER = "#ffb84d", RED = "#ff5c7a", BLUE = "#a0b2ff", INK = "rgba(244,241,236,";
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/**
 * The one picture the whole app is built around: pitch up the side, time flowing right to left,
 * the singer's voice as a line that is green when it sits on a note. In a song, the notes to sing
 * arrive from the right and the words run along the bottom.
 */
export function Stage({ view }: { view: React.MutableRefObject<StageView> }) {
  const ref = useRef<HTMLCanvasElement>(null);

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
      const gutter = narrow ? 30 : 42;
      const top = 10, wordsH = take ? 34 : 8;
      const bottom = H - wordsH;
      const laneH = Math.max(20, bottom - top);
      const hitX = gutter + (W - gutter) * 0.28;
      const pps = (W - gutter) / 7;

      // What range to show: the song's, the siren's, or wherever the voice has been lately.
      let wantLo: number, wantHi: number;
      const recent = v.trace.filter((p) => p.voiced && p.t > now - 4).map((p) => p.midi);
      if (take) { wantLo = take.p.lo - 3; wantHi = take.p.hi + 3; }
      else if (glide) { wantLo = Math.min(glide.cfg.from, glide.cfg.to) - 3; wantHi = Math.max(glide.cfg.from, glide.cfg.to) + 3; }
      else if (recent.length) { wantLo = Math.min(...recent) - 5; wantHi = Math.max(...recent) + 5; }
      else { wantLo = 52; wantHi = 70; }
      if (recent.length && (take || glide)) { wantLo = Math.min(wantLo, Math.min(...recent) - 2); wantHi = Math.max(wantHi, Math.max(...recent) + 2); }
      if (wantHi - wantLo < 14) { const mid = (wantHi + wantLo) / 2; wantLo = mid - 7; wantHi = mid + 7; }
      lo += (wantLo - lo) * 0.08; hi += (wantHi - hi) * 0.08;
      const y = (m: number) => bottom - ((m - lo) / (hi - lo)) * laneH;
      const row = laneH / (hi - lo);

      g.clearRect(0, 0, W, H);
      // Pitch rows.
      g.font = `500 ${narrow ? 10 : 11}px Inter, sans-serif`;
      g.textBaseline = "middle"; g.textAlign = "left";
      for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
        const yy = y(m);
        const isC = ((m % 12) + 12) % 12 === 0;
        g.fillStyle = isBlackKey(m) ? "rgba(255,255,255,0.015)" : "rgba(255,255,255,0.035)";
        g.fillRect(gutter, yy - row / 2, W - gutter, row - 1);
        if (isC) { g.fillStyle = "rgba(255,255,255,0.14)"; g.fillRect(gutter, yy, W - gutter, 1); }
        if (!isBlackKey(m) && (row >= 13 || isC)) { g.fillStyle = INK + (isC ? "0.75)" : "0.38)"); g.fillText(noteName(m), 4, yy); }
      }

      // The hit line: now.
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.fillRect(hitX - 1, top, 2, bottom - top);

      if (glide) {
        const a = glide.cfg.direction === "down" ? glide.cfg.to : glide.cfg.from, b = glide.cfg.direction === "down" ? glide.cfg.from : glide.cfg.to;
        g.setLineDash([8, 6]); g.lineWidth = 2;
        for (const [m, text] of [[a, "start and finish here"], [b, glide.cfg.direction === "down" ? "slide down to here" : "slide up to here"]] as const) {
          g.strokeStyle = "rgba(124,150,255,0.8)";
          g.beginPath(); g.moveTo(gutter, y(m)); g.lineTo(W, y(m)); g.stroke();
          g.fillStyle = "rgba(200,212,255,0.9)"; g.textAlign = "right"; g.font = `600 ${narrow ? 11 : 13}px Inter, sans-serif`;
          g.fillText(text, W - 8, y(m) - 10);
        }
        g.setLineDash([]); g.textAlign = "left";
      }

      if (take) {
        const t = take.time(now);
        const sungNow = take.noteAt(t - LATENCY);
        let wordRight = -Infinity;
        for (const n of take.p.notes) {
          const x0 = hitX + (n.start - t) * pps, w = Math.max(6, n.dur * pps);
          if (x0 > W || x0 + w < gutter) continue;
          const yy = y(n.midi), h = clamp(row * 0.8, 8, 20);
          const state = take.landed(n.i);
          const isNow = sungNow === n;
          g.beginPath();
          g.roundRect(Math.max(gutter, x0), yy - h / 2, w - Math.max(0, gutter - x0), h, h / 2);
          if (n.role === "cue") { g.strokeStyle = "rgba(200,212,255,0.8)"; g.lineWidth = 1.5; g.setLineDash([4, 4]); g.stroke(); g.setLineDash([]); }
          else {
            g.fillStyle = take.listenOnly ? "rgba(124,150,255,0.55)" : state === true ? "rgba(55,214,178,0.85)" : state === false && x0 + w < hitX ? "rgba(255,92,122,0.6)" : isNow ? "rgba(160,178,255,0.95)" : "rgba(124,150,255,0.45)";
            g.fill();
          }
          // Words along the bottom, the current one lit.
          if (n.word) {
            g.textAlign = "left"; g.textBaseline = "alphabetic";
            g.font = `${isNow ? 700 : 500} ${narrow ? 13 : 15}px Inter, sans-serif`;
            g.fillStyle = isNow ? "#ffffff" : INK + "0.5)";
            // Quick notes sit close together: nudge a word along rather than print it over the last one.
            const wx = Math.max(x0, wordRight + 6);
            if (wx >= gutter - 2 && wx < W) { g.fillText(n.word, wx, H - 10); wordRight = wx + g.measureText(n.word).width; }
          }
        }
        // Count-in.
        const first = take.p.notes[0];
        if (t < first.start - 0.05) {
          const beats = Math.ceil((first.start - t) / take.p.beat - 1e-3);
          g.textAlign = "center"; g.textBaseline = "middle";
          g.fillStyle = "rgba(255,255,255,0.92)";
          g.font = `800 ${Math.min(120, laneH * 0.4)}px Inter, sans-serif`;
          g.fillText(String(Math.min(beats, 8)), gutter + (W - gutter) * 0.62, top + laneH * 0.45);
          g.font = `600 ${narrow ? 13 : 16}px Inter, sans-serif`;
          g.fillStyle = INK + "0.7)";
          g.fillText(take.listenOnly ? "listen" : `first note ${noteName(first.midi)}`, gutter + (W - gutter) * 0.62, top + laneH * 0.45 + Math.min(120, laneH * 0.4) * 0.6);
        } else if (take.listenOnly || sungNow?.role === "cue") {
          g.textAlign = "center"; g.textBaseline = "middle";
          g.fillStyle = "rgba(200,212,255,0.9)";
          g.font = `700 ${narrow ? 18 : 24}px Inter, sans-serif`;
          g.fillText("Listen", gutter + (W - gutter) * 0.62, top + 22);
        }
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
        g.lineWidth = 2 + clamp((b.db + 50) / 40) * 7;
        g.globalAlpha = clamp(1 - age / 5) * 0.95;
        g.beginPath(); g.moveTo(Math.max(gutter, hitX - (now - a.t) * pps), y(a.midi)); g.lineTo(xb, y(b.midi)); g.stroke();
      }
      g.globalAlpha = 1;
      const last = tr[tr.length - 1];
      if (last && last.voiced && now - last.t < 0.2) {
        const off = Math.abs(last.midi - Math.round(last.midi)) * 100;
        const q = last.q >= 0 ? last.q : off <= 20 ? 1 : off <= 40 ? 0.5 : 0;
        const col = last.q === 2 ? BLUE : q === 1 ? GREEN : q === 0.5 ? AMBER : RED;
        g.shadowColor = col; g.shadowBlur = 16; g.fillStyle = col;
        g.beginPath(); g.arc(hitX, y(last.midi), 8, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0; g.fillStyle = "#fff";
        g.beginPath(); g.arc(hitX, y(last.midi), 3.5, 0, Math.PI * 2); g.fill();
      } else if (!take && !glide && !tr.some((p) => p.voiced && p.t > now - 6)) {
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = INK + "0.5)";
        g.font = `500 ${narrow ? 16 : 20}px Inter, sans-serif`;
        g.fillText("Sing anything", gutter + (W - gutter) * 0.62, top + laneH * 0.5);
        g.textAlign = "left";
      }
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [view]);

  return <canvas ref={ref} className="stage" />;
}
