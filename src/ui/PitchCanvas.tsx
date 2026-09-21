import { useEffect, useRef } from "react";
import { isBlackKey, noteName } from "../audio/pitch";
import type { Register } from "../audio/analysis";
import type { Exercise } from "../coach/exercises";

export interface TracePoint {
  t: number;
  midi: number;
  db: number;
  voiced: boolean;
  register: Register;
  strained: boolean;
  /** cents from the target when there is one, otherwise null */
  err: number | null;
}

export interface CanvasView {
  trace: TracePoint[];
  now: () => number;
  exercise: Exercise | null;
  /** engine time at which the current take started */
  takeStart: number;
  /** note range to keep in view when there is no exercise */
  range: [number, number] | null;
  floorDb: number;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function PitchCanvas({ view }: { view: React.MutableRefObject<CanvasView> }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext("2d")!;
    let raf = 0;
    let lo = 45, hi = 69;
    let colors = readColors();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => (colors = readColors());
    mq.addEventListener("change", onScheme);

    function readColors() {
      return {
        paper: css("--canvas"), black: css("--canvas-black-key"), line: css("--line"), ink: css("--ink"), soft: css("--ink-soft"),
        voice: css("--voice"), ok: css("--ok"), warn: css("--warn"), bad: css("--bad"), head: css("--head"), mix: css("--mix"), target: css("--target"),
      };
    }

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = view.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      const now = v.now();
      const ex = v.exercise;
      const span = ex ? 8 : 10;
      const nowFrac = ex ? 0.55 : 0.94;
      const gutter = 40;
      const volH = Math.max(46, H * 0.2);
      const pitchH = H - volH - 8;
      const x = (t: number) => gutter + (W - gutter) * (nowFrac + (t - now) / span);

      // Decide which notes to show, then ease toward it so the view never jumps.
      let wantLo = 45, wantHi = 69;
      if (ex) {
        wantLo = Math.min(...ex.notes.map((n) => n.midi)) - 4;
        wantHi = Math.max(...ex.notes.map((n) => n.midi)) + 4;
      } else if (v.range) {
        [wantLo, wantHi] = [v.range[0] - 3, v.range[1] + 3];
      }
      const recent = v.trace.filter((p) => p.voiced && p.t > now - 3).map((p) => p.midi);
      if (recent.length) {
        wantLo = Math.min(wantLo, Math.min(...recent) - 2);
        wantHi = Math.max(wantHi, Math.max(...recent) + 2);
      }
      if (wantHi - wantLo < 14) { const mid = (wantHi + wantLo) / 2; wantLo = mid - 7; wantHi = mid + 7; }
      lo += (wantLo - lo) * 0.08;
      hi += (wantHi - hi) * 0.08;
      const y = (m: number) => pitchH - ((m - lo) / (hi - lo)) * pitchH;
      const row = pitchH / (hi - lo);

      g.fillStyle = colors.paper;
      g.fillRect(0, 0, W, H);

      // Piano-roll rows: black-key rows are tinted, every C gets a firmer line.
      g.font = `${Math.min(12, Math.max(9, row * 0.8))}px "Inter", sans-serif`;
      g.textBaseline = "middle";
      for (let m = Math.floor(lo); m <= Math.ceil(hi); m++) {
        const top = y(m + 0.5);
        if (isBlackKey(m)) {
          g.fillStyle = colors.black;
          g.fillRect(gutter, top, W - gutter, row);
        }
        const isC = ((m % 12) + 12) % 12 === 0;
        g.strokeStyle = colors.line;
        g.globalAlpha = isC ? 0.9 : 0.35;
        g.beginPath();
        g.moveTo(gutter, y(m));
        g.lineTo(W, y(m));
        g.stroke();
        g.globalAlpha = 1;
        if (!isBlackKey(m) && (row >= 11 || isC) && y(m) > 6 && y(m) < pitchH - 4) {
          g.fillStyle = isC ? colors.ink : colors.soft;
          g.fillText(noteName(m), 4, y(m));
        }
      }

      // Target bars.
      if (ex) {
        const tNow = now - v.takeStart;
        for (const n of ex.notes) {
          const x0 = x(v.takeStart + n.start), x1 = x(v.takeStart + n.start + n.dur);
          if (x1 < gutter || x0 > W) continue;
          const active = tNow >= n.start && tNow < n.start + n.dur;
          g.fillStyle = colors.target;
          g.globalAlpha = active ? 0.55 : 0.28;
          const h = Math.max(8, row * 0.9);
          g.beginPath();
          const bx = Math.max(gutter, x0), bw = Math.max(1, x1 - bx - 2);
          if (g.roundRect) g.roundRect(bx, y(n.midi) - h / 2, bw, h, 4);
          else g.rect(bx, y(n.midi) - h / 2, bw, h);
          g.fill();
          g.globalAlpha = 1;
        }
      }

      // Volume strip shares the time axis with the pitch trace.
      const vTop = H - volH, vy = (db: number) => H - 2 - clamp((db - v.floorDb) / (-6 - v.floorDb)) * (volH - 16);
      g.fillStyle = colors.soft;
      g.font = `11px "Inter", sans-serif`;
      g.fillText("volume", 4, vTop + 8);
      g.strokeStyle = colors.line;
      g.beginPath(); g.moveTo(gutter, vTop); g.lineTo(W, vTop); g.stroke();

      const pts = v.trace;
      let start = Math.max(0, pts.length - 1);
      while (start > 0 && pts[start].t > now - span) start--;
      if (pts.length) {
        g.beginPath();
        g.moveTo(Math.max(gutter, x(pts[start].t)), H);
        for (let i = start; i < pts.length; i++) g.lineTo(Math.max(gutter, x(pts[i].t)), vy(pts[i].db));
        g.lineTo(x(pts[pts.length - 1].t), H);
        g.closePath();
        g.fillStyle = colors.voice;
        g.globalAlpha = 0.22;
        g.fill();
        g.globalAlpha = 1;
      }

      // Pitch trace, coloured by accuracy when there is a target and by register when there is not.
      g.lineWidth = 3;
      g.lineCap = "round";
      for (let i = Math.max(1, start); i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (!a.voiced || !b.voiced || b.t - a.t > 0.09 || Math.abs(b.midi - a.midi) > 2.5) continue;
        if (x(b.t) < gutter) continue;
        g.strokeStyle = b.strained ? colors.bad
          : b.err !== null ? (Math.abs(b.err) <= 25 ? colors.ok : Math.abs(b.err) <= 50 ? colors.warn : colors.bad)
          : b.register === "head" ? colors.head : b.register === "mix" ? colors.mix : colors.voice;
        g.beginPath();
        g.moveTo(x(a.t), y(a.midi));
        g.lineTo(x(b.t), y(b.midi));
        g.stroke();
        if (b.strained) {
          g.fillStyle = colors.bad;
          g.fillRect(x(a.t), vTop + 1, Math.max(1.5, x(b.t) - x(a.t)), 4);
        }
      }

      // The "now" line and the singer's current pitch.
      g.strokeStyle = colors.ink;
      g.globalAlpha = 0.5;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x(now), 0); g.lineTo(x(now), H); g.stroke();
      g.globalAlpha = 1;
      const last = pts[pts.length - 1];
      if (last?.voiced && now - last.t < 0.15) {
        g.fillStyle = colors.ink;
        g.beginPath(); g.arc(x(now), y(last.midi), 5, 0, Math.PI * 2); g.fill();
      }

      // Count-in before a take.
      if (ex) {
        const left = ex.leadIn - (now - v.takeStart);
        if (left > 0 && left <= 3 && v.takeStart > 0) {
          g.fillStyle = colors.ink;
          g.globalAlpha = 0.85;
          g.font = `700 ${Math.min(120, pitchH * 0.5)}px "Inter", sans-serif`;
          g.textAlign = "center";
          g.fillText(String(Math.ceil(left)), gutter + (W - gutter) * 0.25, pitchH / 2);
          g.textAlign = "left";
          g.globalAlpha = 1;
        }
      }
    };
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    draw();
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener("change", onScheme);
    };
  }, [view]);

  return <canvas ref={ref} className="pitch-canvas" role="img" aria-label="Your pitch and volume over the last few seconds" />;
}
