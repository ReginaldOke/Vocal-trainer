import { useEffect, useRef } from "react";
import { isBlackKey, noteName } from "../audio/pitch";
import { BIN, type GameRun, type Judgement, type RunEvent, type RunNote } from "../game/scoring";
import type { GlideRun } from "../game/glide";

export interface GameView {
  run: GameRun | null;
  now: () => number;
  /** visual events queued by the frame handler, drained by the canvas */
  effects: RunEvent[];
  /** free singing when there is no run: recent sung pitch, drawn as a comet with no targets */
  free: { t: number; midi: number; db: number; voiced: boolean }[];
  /** a siren exercise in progress */
  glide?: GlideRun | null;
  /** called when the singer taps a note tube, so it can be sounded */
  onNoteTap?: (note: RunNote) => void;
  /** called when the singer taps one of a siren's boundary lines */
  onPitchTap?: (midi: number) => void;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; }
interface Popup { text: string; sub: string; x: number; y: number; born: number; color: string; big: boolean; }

const JUDGE: Record<Judgement, { text: string; color: string; burst: number }> = {
  perfect: { text: "PERFECT", color: "#ffd166", burst: 34 },
  great: { text: "GREAT", color: "#5ef2b0", burst: 18 },
  good: { text: "GOOD", color: "#7cc4ff", burst: 8 },
  miss: { text: "MISS", color: "#ff5c7a", burst: 0 },
};

const qColor = (q: number) => (q >= 1 ? "#3df0a2" : q >= 0.75 ? "#b8f05a" : q >= 0.4 ? "#ffc23d" : "#ff4d6d");
const fmt = (n: number) => Math.round(n).toLocaleString();
const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));

export function GameCanvas({ view }: { view: React.MutableRefObject<GameView> }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext("2d")!;
    let raf = 0;
    let particles: Particle[] = [];
    let popups: Popup[] = [];
    let shownScore = 0;
    let comboPop = 0;
    let lastFrame = performance.now();
    let feverFlash = 0;
    let lo = 55, hi = 69;
    const hasRoundRect = typeof g.roundRect === "function";
    // The last frame's layout, so a tap can be mapped back to a note.
    const layout = { gutter: 0, hitX: 0, pps: 1, pos: 0, top: 0, bottom: 0, lo: 55, hi: 69, tubeH: 10 };
    const flashes = new Map<number, number>();
    const onTap = (e: PointerEvent) => {
      const v = view.current;
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const L = layout;
      if (v.glide && v.onPitchTap) {
        const midi = L.lo + ((L.bottom - py) / (L.bottom - L.top)) * (L.hi - L.lo);
        const c = v.glide.cfg;
        const rowSt = (L.bottom - L.top) / (L.hi - L.lo);
        for (const m of [c.from, c.to]) if (Math.abs(midi - m) * rowSt <= 16) { v.onPitchTap(m); return; }
        return;
      }
      const run = v.run;
      if (!run || !v.onNoteTap) return;
      const t = L.pos + (px - L.hitX) / L.pps;
      const midi = L.lo + ((L.bottom - py) / (L.bottom - L.top)) * (L.hi - L.lo);
      let best: RunNote | null = null, bestD = Infinity;
      for (const n of run.notes) {
        if (t < n.start - 0.05 || t > n.start + n.dur + 0.05) continue;
        const d = Math.abs(n.midi - midi);
        if (d < bestD) { bestD = d; best = n; }
      }
      if (best && bestD <= Math.max(0.9, (L.tubeH / ((L.bottom - L.top) / (L.hi - L.lo))) * 0.9)) {
        flashes.set(best.i, performance.now());
        v.onNoteTap(best);
      }
    };
    canvas.addEventListener("pointerdown", onTap);

    const burst = (x: number, y: number, n: number, color: string, speed = 260) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = speed * (0.35 + Math.random());
        particles.push({ x, y, vx: Math.cos(a) * s - 60, vy: Math.sin(a) * s - 80, life: 0.9, max: 0.9, size: 2 + Math.random() * 3, color });
      }
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const tNow = performance.now();
      const dt = Math.min(0.05, (tNow - lastFrame) / 1000);
      lastFrame = tNow;

      const W = canvas.clientWidth, H = canvas.clientHeight;
      // Phones get a lower pixel ratio and fewer glows: blur is the expensive part of this frame.
      const small = W < 640;
      const dpr = Math.min(small ? 1.5 : 2, window.devicePixelRatio || 1);
      const glow = (px: number) => (small ? px * 0.4 : px);
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      const v = view.current;
      const run = v.run;
      const now = v.now();
      const narrow = W < 640;
      const gutter = narrow ? 34 : 46;
      const hudH = run ? (narrow ? 64 : 76) : 60;
      const lyricH = run ? (narrow ? 34 : 40) : 12;
      const hitX = gutter + (W - gutter) * 0.26;
      const ahead = narrow ? 3.2 : 4.2;
      const pps = (W - hitX) / ahead;
      const top = hudH, bottom = H - lyricH;
      const laneH = bottom - top;
      // Notes are placed by song position (which waits for the singer in flow mode); the comet
      // tail is placed by wall-clock time so it always streams away from the hit line.
      const pos = run ? run.viewPos(now) : 0;
      const xs = (songT: number) => hitX + (songT - pos) * pps;
      const x = (t: number) => hitX + (t - now) * pps;

      // Pitch window: the song plus a margin, eased so it never jumps.
      let wantLo = lo, wantHi = hi;
      const glide = v.glide ?? null;
      if (glide) { wantLo = Math.min(glide.cfg.from, glide.cfg.to) - 3; wantHi = Math.max(glide.cfg.from, glide.cfg.to) + 3; }
      else if (run) {
        wantLo = run.song.lo - 3; wantHi = run.song.hi + 3;
        const recent = run.trace.filter((p) => !Number.isNaN(p.midi) && p.t > now - 2).map((p) => p.midi);
        if (recent.length) { wantLo = Math.min(wantLo, Math.min(...recent) - 2); wantHi = Math.max(wantHi, Math.max(...recent) + 2); }
      } else {
        const recent = v.free.filter((p) => p.voiced && p.t > now - 4).map((p) => p.midi);
        if (recent.length) { wantLo = Math.min(...recent) - 4; wantHi = Math.max(...recent) + 4; }
        else { wantLo = 52; wantHi = 70; }
      }
      if (wantHi - wantLo < 14) { const mid = (wantHi + wantLo) / 2; wantLo = mid - 7; wantHi = mid + 7; }
      lo += (wantLo - lo) * 0.1;
      hi += (wantHi - hi) * 0.1;
      const y = (m: number) => bottom - ((m - lo) / (hi - lo)) * laneH;
      const row = laneH / (hi - lo);

      // Backdrop.
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#15171d");
      bg.addColorStop(1, "#1a1c2b");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);

      const fever = run?.fever.active ?? false;
      if (fever) {
        const gold = g.createLinearGradient(0, top, 0, bottom);
        gold.addColorStop(0, "rgba(255,190,60,0.16)");
        gold.addColorStop(0.5, "rgba(255,190,60,0.04)");
        gold.addColorStop(1, "rgba(255,190,60,0.16)");
        g.fillStyle = gold;
        g.fillRect(0, top, W, laneH);
      }

      // Lanes.
      g.font = `${Math.min(12, Math.max(9, row * 0.75))}px "Inter", sans-serif`;
      g.textBaseline = "middle";
      g.textAlign = "left";
      for (let m = Math.floor(lo); m <= Math.ceil(hi); m++) {
        const yy = y(m);
        if (yy < top || yy > bottom) continue;
        if (isBlackKey(m)) {
          g.fillStyle = "rgba(255,255,255,0.025)";
          g.fillRect(gutter, y(m + 0.5), W - gutter, row);
        }
        const isC = ((m % 12) + 12) % 12 === 0;
        g.strokeStyle = isC ? "rgba(140,160,255,0.35)" : "rgba(140,160,255,0.09)";
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(gutter, yy); g.lineTo(W, yy); g.stroke();
        if (!isBlackKey(m) && (row >= 12 || isC)) {
          g.fillStyle = isC ? "rgba(220,228,255,0.9)" : "rgba(220,228,255,0.45)";
          g.fillText(noteName(m), 6, yy);
        }
      }

      // Beat grid scrolling with the song.
      if (run) {
        const beat = run.song.beat, bpb = run.song.song.beatsPerBar;
        const k0 = Math.floor((pos - (hitX - gutter) / pps) / beat);
        const k1 = Math.ceil((pos + ahead) / beat);
        for (let k = k0; k <= k1; k++) {
          const xx = xs(k * beat);
          if (xx < gutter || xx > W) continue;
          const bar = ((k % bpb) + bpb) % bpb === 0;
          g.strokeStyle = bar ? "rgba(160,180,255,0.28)" : "rgba(160,180,255,0.1)";
          g.lineWidth = bar ? 1.5 : 1;
          g.beginPath(); g.moveTo(xx, top); g.lineTo(xx, bottom); g.stroke();
        }
      }

      // Stage light at the hit line.
      const light = g.createRadialGradient(hitX, (top + bottom) / 2, 0, hitX, (top + bottom) / 2, laneH * 0.9);
      light.addColorStop(0, fever ? "rgba(255,200,80,0.16)" : "rgba(120,150,255,0.14)");
      light.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = light;
      g.fillRect(gutter, top, W - gutter, laneH);

      // Note tubes.
      const tubeH = Math.max(10, row * 0.72);
      Object.assign(layout, { gutter, hitX, pps, pos, top, bottom, lo, hi, tubeH });
      if (run) {
        const t = run.mode === "tempo" ? run.takeTime(now) : pos;
        for (const n of run.notes) {
          const x0 = xs(n.start), x1 = xs(n.start + n.dur);
          if (x1 < gutter - 10 || x0 > W + 10) continue;
          const yy = y(n.midi);
          const active = run.target === n;
          const bx = Math.max(gutter, x0), bw = Math.max(2, x1 - bx);

          // Unlit body.
          g.save();
          g.beginPath();
          if (hasRoundRect) g.roundRect(bx, yy - tubeH / 2, bw, tubeH, tubeH / 2); else g.rect(bx, yy - tubeH / 2, bw, tubeH);
          g.clip();
          g.fillStyle = active ? "rgba(120,140,255,0.42)" : n.judged || t > n.start + n.dur ? "rgba(90,100,160,0.22)" : "rgba(110,130,255,0.3)";
          g.fillRect(bx, yy - tubeH / 2, bw, tubeH);

          // Lit bins.
          const binW = BIN * pps;
          for (let i = 0; i < n.bins.length; i++) {
            const q = n.bins[i];
            if (q < 0) continue;
            const sx = xs(n.start + i * BIN);
            if (sx + binW < gutter || sx > W) continue;
            g.fillStyle = qColor(q);
            g.globalAlpha = q > 0 ? 0.95 : 0.35;
            g.fillRect(sx, yy - tubeH / 2, binW + 0.6, tubeH);
          }
          g.globalAlpha = 1;
          // Sheen.
          const sheen = g.createLinearGradient(0, yy - tubeH / 2, 0, yy + tubeH / 2);
          sheen.addColorStop(0, "rgba(255,255,255,0.28)");
          sheen.addColorStop(0.5, "rgba(255,255,255,0)");
          sheen.addColorStop(1, "rgba(0,0,0,0.25)");
          g.fillStyle = sheen;
          g.fillRect(bx, yy - tubeH / 2, bw, tubeH);
          g.restore();

          // Outline and glow; a tapped tube flashes white while its note sounds.
          const flashAge = flashes.has(n.i) ? (tNow - flashes.get(n.i)!) / 700 : 1;
          if (flashAge >= 1) flashes.delete(n.i);
          g.beginPath();
          if (hasRoundRect) g.roundRect(bx, yy - tubeH / 2, bw, tubeH, tubeH / 2); else g.rect(bx, yy - tubeH / 2, bw, tubeH);
          g.lineWidth = active || flashAge < 1 ? 2 : 1;
          g.strokeStyle = flashAge < 1 ? `rgba(255,255,255,${0.95 * (1 - flashAge)})` : active ? "rgba(200,215,255,0.95)" : "rgba(170,185,255,0.5)";
          if (active || flashAge < 1) { g.shadowColor = flashAge < 1 ? "rgba(255,255,255,0.9)" : fever ? "rgba(255,200,80,0.9)" : "rgba(130,160,255,0.9)"; g.shadowBlur = glow(16); }
          g.stroke();
          g.shadowBlur = 0;

          if (n.judged && x1 > gutter) {
            g.font = `700 ${narrow ? 9 : 10}px "Inter", sans-serif`;
            g.fillStyle = JUDGE[n.judged].color;
            g.globalAlpha = 0.85;
            g.textAlign = "center";
            g.fillText(n.skipped ? "SKIPPED" : JUDGE[n.judged].text, (bx + Math.min(W, x1)) / 2, yy - tubeH / 2 - 8);
            g.textAlign = "left";
            g.globalAlpha = 1;
          }
        }

        // Lyrics band.
        g.fillStyle = "rgba(0,0,0,0.35)";
        g.fillRect(0, bottom, W, lyricH);
        g.strokeStyle = "rgba(160,180,255,0.15)";
        g.beginPath(); g.moveTo(0, bottom); g.lineTo(W, bottom); g.stroke();
        for (const n of run.notes) {
          if (!n.lyric) continue;
          const sx = xs(n.start);
          if (sx < gutter - 20 || sx > W) continue;
          const state = n.judged ? "past" : run.target === n || (run.mode === "tempo" && t >= n.start - 0.05 && t < n.start + n.dur) ? "now" : "next";
          g.font = `${state === "now" ? 800 : 500} ${state === "now" ? (narrow ? 16 : 20) : narrow ? 13 : 16}px "Inter", sans-serif`;
          g.fillStyle = state === "now" ? "#ffffff" : state === "past" ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.7)";
          g.fillText(n.lyric, Math.max(gutter + 2, sx), bottom + lyricH / 2);
        }
      }

      // Hit line.
      g.strokeStyle = fever ? "rgba(255,210,100,0.9)" : "rgba(220,230,255,0.75)";
      g.lineWidth = 2;
      g.shadowColor = fever ? "rgba(255,200,80,0.8)" : "rgba(140,170,255,0.8)";
      g.shadowBlur = glow(12);
      g.beginPath(); g.moveTo(hitX, top); g.lineTo(hitX, bottom); g.stroke();
      g.shadowBlur = 0;

      // The singer: comet tail, then the puck.
      if (run) {
        const tr = run.trace;
        g.lineCap = "round";
        for (let i = 1; i < tr.length; i++) {
          const a = tr[i - 1], b = tr[i];
          const age = now - b.t;
          if (age > 1.6 || b.t - a.t > 0.09 || Math.abs(b.midi - a.midi) > 2.5) continue;
          if (Number.isNaN(a.midi) || Number.isNaN(b.midi)) continue;
          const xb = x(b.t);
          if (xb < gutter) continue;
          const loud = clamp((b.db + 50) / 44);
          g.lineWidth = 2 + loud * 6;
          g.strokeStyle = b.err === null ? "rgba(200,210,255,0.8)" : qColor(b.q);
          g.globalAlpha = clamp(1 - age / 1.6) * 0.9;
          g.beginPath(); g.moveTo(x(a.t), y(a.midi)); g.lineTo(xb, y(b.midi)); g.stroke();
        }
        g.globalAlpha = 1;

        const last = tr[tr.length - 1];
        if (last && now - last.t < 0.15 && !Number.isNaN(last.midi)) {
          const py = y(last.midi);
          const col = last.err === null ? "#dfe6ff" : qColor(last.q);
          const on = last.q > 0;
          if (on) {
            const pulse = 1 + 0.15 * Math.sin(tNow / 90);
            g.fillStyle = col;
            g.globalAlpha = 0.25;
            g.beginPath(); g.arc(hitX, py, 18 * pulse, 0, Math.PI * 2); g.fill();
            g.globalAlpha = 1;
            const n = last.q >= 1 ? 3 : 1;
            for (let i = 0; i < n; i++) {
              particles.push({ x: hitX, y: py, vx: -pps * 0.3 - Math.random() * 120, vy: (Math.random() - 0.5) * 160, life: 0.6, max: 0.6, size: 1.5 + Math.random() * 2.5, color: fever ? "#ffd166" : col });
            }
          }
          g.shadowColor = col;
          g.shadowBlur = glow(18);
          g.fillStyle = col;
          g.beginPath(); g.arc(hitX, py, 8, 0, Math.PI * 2); g.fill();
          g.shadowBlur = 0;
          g.fillStyle = "#ffffff";
          g.beginPath(); g.arc(hitX, py, 3.5, 0, Math.PI * 2); g.fill();

          // Off-pitch guidance: which way to go.
          if (last.err !== null && !on) {
            const flat = last.err < 0;
            g.fillStyle = col;
            g.font = `800 ${narrow ? 12 : 14}px "Inter", sans-serif`;
            g.textAlign = "left";
            g.fillText(flat ? "▲ higher" : "▼ lower", hitX + 16, py + (flat ? -12 : 12));
          }
        }
      }

      // Particles.
      for (const p of particles) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 380 * dt;
        p.vx *= 0.98;
        if (p.life <= 0 || p.x < gutter) continue;
        g.globalAlpha = clamp(p.life / p.max);
        g.fillStyle = p.color;
        g.beginPath(); g.arc(p.x, p.y, p.size, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      particles = particles.filter((p) => p.life > 0 && p.x >= gutter);
      const cap = small ? 220 : 500;
      if (particles.length > cap) particles.splice(0, particles.length - cap);

      // Consume queued events into bursts and popups.
      for (const e of v.effects) {
        if (e.type === "note") {
          const j = JUDGE[e.judgement];
          const py = y(e.note.midi);
          if (j.burst) burst(hitX, py, j.burst * (fever ? 1.5 : 1), fever ? "#ffd166" : j.color);
          popups.push({ text: e.octave ? "OCTAVE OFF" : e.skipped ? "SKIPPED" : j.text, sub: e.octave ? "right note, wrong octave" : e.points ? `+${e.points}` : "", x: hitX + 24, y: py - tubeH, born: tNow, color: j.color, big: e.judgement === "perfect" });
          if (e.judgement !== "miss") comboPop = 1;
          if (e.combo > 0 && e.combo % 10 === 0) popups.push({ text: `${e.combo} COMBO`, sub: "", x: W * 0.55, y: top + laneH * 0.3, born: tNow, color: "#ffffff", big: true });
        } else if (e.type === "phrase") {
          const r = e.report;
          const good = r.breaths === 0 && r.ending === "held";
          const text = r.breaths === 0 ? "ONE BREATH" : `${r.breaths + 1} BREATHS`;
          const sub = r.ending === "held" ? (r.onset === "hard" ? "hard start" : r.onset === "breathy" ? "breathy start" : "held to the end") : r.ending === "faded" ? "faded at the end" : "sagged at the end";
          popups.push({ text, sub, x: W * 0.55, y: top + laneH * 0.62, born: tNow, color: good ? "#37d6b2" : "#ffb84d", big: false });
        } else if (e.type === "fever-start") {
          feverFlash = 1;
          popups.push({ text: "FEVER!", sub: "double points", x: W * 0.55, y: top + laneH * 0.25, born: tNow, color: "#ffd166", big: true });
          burst(hitX, (top + bottom) / 2, 80, "#ffd166", 420);
        } else if (e.type === "multiplier" && e.value > 1) {
          popups.push({ text: `x${e.value}`, sub: "multiplier", x: W * 0.55, y: top + laneH * 0.4, born: tNow, color: "#9ad0ff", big: true });
        }
      }
      v.effects.length = 0;

      popups = popups.filter((p) => tNow - p.born < 900);
      for (const p of popups) {
        const age = (tNow - p.born) / 900;
        const rise = p.big ? 26 : 34;
        const scale = p.big ? 1 + 0.35 * Math.max(0, 1 - age * 4) : 1;
        g.globalAlpha = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3;
        g.fillStyle = p.color;
        g.textAlign = p.big && p.x > W * 0.5 ? "center" : "left";
        g.font = `800 ${(p.big ? (narrow ? 26 : 34) : narrow ? 14 : 17) * scale}px "Inter", sans-serif`;
        g.shadowColor = "rgba(0,0,0,0.7)";
        g.shadowBlur = glow(8);
        g.fillText(p.text, p.x, p.y - age * rise);
        if (p.sub) {
          g.font = `600 ${narrow ? 11 : 13}px "Inter", sans-serif`;
          g.fillText(p.sub, p.x, p.y - age * rise + (p.big ? 24 : 16));
        }
        g.shadowBlur = 0;
      }
      g.globalAlpha = 1;
      g.textAlign = "left";

      // Fever flash.
      if (feverFlash > 0) {
        g.fillStyle = `rgba(255,210,100,${0.35 * feverFlash})`;
        g.fillRect(0, 0, W, H);
        feverFlash = Math.max(0, feverFlash - dt * 2.5);
      }

      // HUD.
      if (run) {
        shownScore += (run.score - shownScore) * 0.18;
        if (Math.abs(run.score - shownScore) < 1) shownScore = run.score;
        comboPop = Math.max(0, comboPop - dt * 4);

        // Progress along the very top.
        g.fillStyle = "rgba(255,255,255,0.1)";
        g.fillRect(0, 0, W, 4);
        g.fillStyle = fever ? "#ffd166" : "#7c9cff";
        g.fillRect(0, 0, W * run.progress(now), 4);

        // Score.
        g.textBaseline = "alphabetic";
        g.fillStyle = "rgba(200,210,255,0.7)";
        g.font = `700 ${narrow ? 10 : 11}px "Inter", sans-serif`;
        g.fillText("SCORE", 12, 24);
        g.fillStyle = "#ffffff";
        g.font = `800 ${narrow ? 26 : 34}px "Inter", sans-serif`;
        g.fillText(fmt(shownScore), 12, narrow ? 50 : 58);

        // Combo and multiplier in the centre.
        const cx = W * 0.5;
        g.textAlign = "center";
        const s = 1 + comboPop * 0.35;
        g.font = `800 ${(narrow ? 22 : 30) * s}px "Inter", sans-serif`;
        g.fillStyle = run.combo > 0 ? "#ffffff" : "rgba(255,255,255,0.35)";
        g.fillText(run.combo > 0 ? `${run.combo}` : "0", cx, narrow ? 40 : 48);
        g.font = `700 ${narrow ? 10 : 11}px "Inter", sans-serif`;
        g.fillStyle = "rgba(200,210,255,0.7)";
        g.fillText("COMBO", cx, narrow ? 54 : 64);

        // Multiplier badge.
        const bx = cx + (narrow ? 44 : 64), by = narrow ? 22 : 26;
        const mcol = run.multiplier >= 4 ? "#ffd166" : run.multiplier >= 3 ? "#5ef2b0" : run.multiplier >= 2 ? "#7cc4ff" : "rgba(255,255,255,0.35)";
        g.fillStyle = mcol;
        g.beginPath(); g.arc(bx, by, narrow ? 15 : 18, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#0a0d1a";
        g.font = `800 ${narrow ? 13 : 16}px "Inter", sans-serif`;
        g.textBaseline = "middle";
        g.fillText(`x${run.multiplier}`, bx, by + 1);
        g.textBaseline = "alphabetic";

        // Fever meter on the right.
        const mw = narrow ? 90 : 150, mx = W - mw - 12, my = narrow ? 18 : 22;
        g.textAlign = "right";
        g.fillStyle = "rgba(200,210,255,0.7)";
        g.font = `700 ${narrow ? 10 : 11}px "Inter", sans-serif`;
        g.fillText(fever ? "FEVER x2" : "FEVER", W - 12, my - 6);
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.beginPath(); if (hasRoundRect) g.roundRect(mx, my, mw, 10, 5); else g.rect(mx, my, mw, 10); g.fill();
        const fm = clamp(run.fever.meter);
        if (fm > 0) {
          g.fillStyle = fever ? "#ffd166" : "#c98bff";
          g.shadowColor = g.fillStyle; g.shadowBlur = fever ? 14 : 6;
          g.beginPath(); if (hasRoundRect) g.roundRect(mx, my, mw * fm, 10, 5); else g.rect(mx, my, mw * fm, 10); g.fill();
          g.shadowBlur = 0;
        }
        // Crowd meter under it.
        g.fillStyle = "rgba(200,210,255,0.7)";
        g.fillText("CROWD", W - 12, my + 30);
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.beginPath(); if (hasRoundRect) g.roundRect(mx, my + 36, mw, 6, 3); else g.rect(mx, my + 36, mw, 6); g.fill();
        const cr = clamp(run.crowd);
        g.fillStyle = cr < 0.25 ? "#ff5c7a" : cr < 0.5 ? "#ffc23d" : "#3df0a2";
        g.beginPath(); if (hasRoundRect) g.roundRect(mx, my + 36, mw * cr, 6, 3); else g.rect(mx, my + 36, mw * cr, 6); g.fill();
        g.textAlign = "left";

        // Flow mode: show what is wanted while the song waits.
        if (run.mode === "flow" && run.target && !run.finished) {
          const n = run.target;
          const py = y(n.midi);
          const frac = Math.min(1, n.sung / n.need);
          // A charge ring around the hit point.
          g.lineWidth = 3;
          g.strokeStyle = "rgba(255,255,255,0.18)";
          g.beginPath(); g.arc(hitX, py, 15, 0, Math.PI * 2); g.stroke();
          if (frac > 0) {
            g.strokeStyle = fever ? "#ffd166" : "#3df0a2";
            g.shadowColor = g.strokeStyle; g.shadowBlur = 10;
            g.beginPath(); g.arc(hitX, py, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); g.stroke();
            g.shadowBlur = 0;
          }
          if (run.silent > 2.5 || (n.sung === 0 && run.notes.every((m) => !m.judged))) {
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillStyle = "rgba(255,255,255,0.9)";
            g.font = `800 ${narrow ? 18 : 24}px "Inter", sans-serif`;
            g.fillText(n.lyric && n.lyric.trim() ? `Sing “${n.lyric.replace(/-$/, "")}” on ${noteName(n.midi)}` : `Sing ${noteName(n.midi)}`, W * 0.6, top + 26);
            g.font = `500 ${narrow ? 12 : 14}px "Inter", sans-serif`;
            g.fillStyle = "rgba(220,228,255,0.7)";
            g.fillText("The song follows your voice. Sing it your way.", W * 0.6, top + (narrow ? 46 : 52));
            g.textAlign = "left";
            g.textBaseline = "alphabetic";
          }
        }

        // Count-in.
        const left = run.countIn(now);
        if (run.mode === "tempo" && left > 0) {
          const beatsLeft = Math.ceil(left / run.song.beat - 1e-3);
          const frac = (left / run.song.beat) % 1;
          const scale = 1 + 0.25 * frac;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillStyle = "rgba(255,255,255,0.92)";
          g.shadowColor = "rgba(120,150,255,0.9)"; g.shadowBlur = 30;
          g.font = `800 ${Math.min(150, laneH * 0.5) * scale}px "Inter", sans-serif`;
          g.fillText(String(beatsLeft), W * 0.6, top + laneH * 0.45);
          g.shadowBlur = 0;
          g.font = `600 ${narrow ? 14 : 18}px "Inter", sans-serif`;
          g.fillStyle = "rgba(220,228,255,0.85)";
          g.fillText(`starting note ${noteName(run.notes[0].midi)}`, W * 0.6, top + laneH * 0.45 + Math.min(150, laneH * 0.5) * 0.55);
          g.textAlign = "left";
          g.textBaseline = "alphabetic";
        } else if (run.mode === "tempo" && left > -0.7) {
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.globalAlpha = 1 - (-left) / 0.7;
          g.fillStyle = "#3df0a2";
          g.shadowColor = "#3df0a2"; g.shadowBlur = 24;
          g.font = `800 ${Math.min(110, laneH * 0.4)}px "Inter", sans-serif`;
          g.fillText("SING!", W * 0.6, top + laneH * 0.45);
          g.shadowBlur = 0;
          g.globalAlpha = 1;
          g.textAlign = "left";
          g.textBaseline = "alphabetic";
        }
      } else if (glide) {
        // A siren: a band between the two notes, the comet, and a count of sirens done.
        const c = glide.cfg;
        const yTop = y(Math.max(c.from, c.to)), yBot = y(Math.min(c.from, c.to));
        g.fillStyle = "rgba(108,140,255,0.08)";
        g.fillRect(gutter, yTop, W - gutter, yBot - yTop);
        for (const m of [c.from, c.to]) {
          g.strokeStyle = "rgba(108,140,255,0.7)"; g.lineWidth = 1.5; g.setLineDash([6, 6]);
          g.beginPath(); g.moveTo(gutter, y(m)); g.lineTo(W, y(m)); g.stroke(); g.setLineDash([]);
          // Name the line and invite a tap to hear it.
          const label = `${m === Math.max(c.from, c.to) ? "top" : "bottom"} ${noteName(m)} · tap to hear`;
          g.font = `600 ${narrow ? 11 : 13}px "Inter", sans-serif`;
          g.textAlign = "left"; g.textBaseline = "middle";
          const tw = g.measureText(label).width + 16;
          const lx = hitX + 14;
          g.fillStyle = "rgba(27,29,36,0.9)";
          g.beginPath(); if (hasRoundRect) g.roundRect(lx, y(m) - 11, tw, 22, 11); else g.rect(lx, y(m) - 11, tw, 22); g.fill();
          g.fillStyle = "rgba(200,212,255,0.95)";
          g.fillText(label, lx + 8, y(m));
          g.textBaseline = "alphabetic";
        }
        const tr = glide.trace;
        g.lineCap = "round";
        for (let i = 1; i < tr.length; i++) {
          const a = tr[i - 1], b = tr[i];
          const age = now - b.t;
          if (age > 6 || Number.isNaN(a.midi) || Number.isNaN(b.midi) || b.t - a.t > 0.09) continue;
          const xb = x(b.t);
          if (xb < gutter) continue;
          const smooth = Math.abs(b.midi - a.midi) <= 0.35;
          g.lineWidth = 2 + clamp((b.db + 50) / 44) * 7;
          g.strokeStyle = smooth ? "#37d6b2" : "#ffb84d";
          g.globalAlpha = clamp(1 - age / 6) * 0.9;
          g.beginPath(); g.moveTo(x(a.t), y(a.midi)); g.lineTo(xb, y(b.midi)); g.stroke();
        }
        g.globalAlpha = 1;
        const last = tr[tr.length - 1];
        if (last && !Number.isNaN(last.midi) && now - last.t < 0.15) {
          const py = y(last.midi);
          g.shadowColor = "#37d6b2"; g.shadowBlur = glow(18); g.fillStyle = "#37d6b2";
          g.beginPath(); g.arc(hitX, py, 8, 0, Math.PI * 2); g.fill();
          g.shadowBlur = 0;
          g.fillStyle = "#ffffff";
          g.beginPath(); g.arc(hitX, py, 3.5, 0, Math.PI * 2); g.fill();
          // Progress ring around the puck for this siren.
          g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,0.18)";
          g.beginPath(); g.arc(hitX, py, 15, 0, Math.PI * 2); g.stroke();
          g.strokeStyle = "#37d6b2";
          g.beginPath(); g.arc(hitX, py, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * glide.progress(last.midi)); g.stroke();
        }
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = "rgba(244,241,236,0.9)";
        g.font = `600 ${narrow ? 16 : 22}px "Inter", sans-serif`;
        g.fillText(glide.finished ? "Done" : `Siren ${Math.min(glide.done + 1, c.repeats)} of ${c.repeats}`, W * 0.6, top + 26);
        g.font = `500 ${narrow ? 12 : 14}px "Inter", sans-serif`;
        g.fillStyle = "rgba(244,241,236,0.6)";
        g.fillText(c.direction === "up" ? "Slide up to the top line and back down" : "Sigh down to the bottom line", W * 0.6, top + (narrow ? 46 : 52));
        g.textAlign = "left"; g.textBaseline = "alphabetic";
      } else {
        // Free singing: the comet streams away from the hit line with no targets to judge against.
        const fr = v.free;
        g.lineCap = "round";
        for (let i = 1; i < fr.length; i++) {
          const a = fr[i - 1], b = fr[i];
          const age = now - b.t;
          if (age > 5 || !a.voiced || !b.voiced || b.t - a.t > 0.09 || Math.abs(b.midi - a.midi) > 2.5) continue;
          const xb = x(b.t);
          if (xb < gutter) continue;
          const off = Math.abs(b.midi - Math.round(b.midi)) * 100;
          const loud = clamp((b.db + 50) / 44);
          g.lineWidth = 2 + loud * 7;
          g.strokeStyle = off <= 20 ? "#37d6b2" : off <= 40 ? "#ffb84d" : "#ff5c7a";
          g.globalAlpha = clamp(1 - age / 5) * 0.9;
          g.beginPath(); g.moveTo(x(a.t), y(a.midi)); g.lineTo(xb, y(b.midi)); g.stroke();
        }
        g.globalAlpha = 1;
        const last = fr[fr.length - 1];
        if (last && last.voiced && now - last.t < 0.15) {
          const py = y(last.midi);
          const off = Math.abs(last.midi - Math.round(last.midi)) * 100;
          const col = off <= 20 ? "#37d6b2" : off <= 40 ? "#ffb84d" : "#ff5c7a";
          if (off <= 20) for (let i = 0; i < 2; i++) particles.push({ x: hitX, y: py, vx: -pps * 0.3 - Math.random() * 120, vy: (Math.random() - 0.5) * 160, life: 0.6, max: 0.6, size: 1.5 + Math.random() * 2.5, color: col });
          g.shadowColor = col; g.shadowBlur = 18; g.fillStyle = col;
          g.beginPath(); g.arc(hitX, py, 8, 0, Math.PI * 2); g.fill();
          g.shadowBlur = 0;
          g.fillStyle = "#ffffff";
          g.beginPath(); g.arc(hitX, py, 3.5, 0, Math.PI * 2); g.fill();
          // Nearest-note guide: a faint bar on the note you are closest to.
          g.fillStyle = col; g.globalAlpha = 0.18;
          g.fillRect(gutter, y(Math.round(last.midi) + 0.5), W - gutter, row);
          g.globalAlpha = 1;
        } else if (!fr.some((p) => p.voiced && p.t > now - 6)) {
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillStyle = "rgba(244,241,236,0.55)";
          g.font = `500 ${narrow ? 16 : 20}px "Inter", sans-serif`;
          g.fillText("Sing anything", W * 0.55, (top + bottom) / 2);
          g.textAlign = "left";
          g.textBaseline = "alphabetic";
        }
      }
    };
    draw();
    return () => { cancelAnimationFrame(raf); canvas.removeEventListener("pointerdown", onTap); };
  }, [view]);

  return <canvas ref={ref} className="game-canvas" role="img" aria-label="The song highway: notes scroll toward the hit line and your voice lights them up" />;
}
