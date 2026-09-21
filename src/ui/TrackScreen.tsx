import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioEngine } from "../audio/engine";
import type { Tracker } from "../audio/analysis";
import type { Frame } from "../audio/frame";
import { VoiceGate } from "../audio/voiceGate";
import { YouTubePlayer, type PlayerState } from "../audio/youtube";
import type { Coach, Tip } from "../coach/rules";
import { GlideRun } from "../game/glide";
import { adjustSirenSpan } from "../game/lesson";
import { levelFromXp, saveProgress, type Progress } from "../game/progress";
import { buildTrackPlan, recordTrackTake, scoreTake, singAlongPlan, type TakeFrame, type TakeStats, type Track, type TrackPlan, type TrackStep } from "../game/tracks";
import { GameCanvas, type GameView } from "./GameCanvas";
import type { AvatarState } from "./SingerAvatar";
import { CoachDrawer } from "./CoachDrawer";
import { MicMeter } from "./MicMeter";
import { Pause, Play, RotateCcw } from "lucide-react";

interface Props {
  engine: AudioEngine;
  tracker: Tracker;
  coach: Coach;
  avatar: React.MutableRefObject<AvatarState>;
  room: React.MutableRefObject<{ gate: number; noise: number }>;
  progress: Progress;
  calibrated: { low: number; high: number; comfort?: number } | null;
  track: Track;
  mode: "lesson" | "sing";
  onProgress: (p: Progress) => void;
  onReview: (blob: Blob, title: string) => void;
  onClose: () => void;
}

type Phase = "loading" | "ready" | "running" | "between" | "done" | "error";

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const SPEEDS = [0.5, 0.75, 1];

/**
 * Sing over a song from YouTube. The video plays in its own small frame, turned down low so the
 * voice sits on top, while the stage shows the sung pitch coloured by how close it lands to a
 * note. A lesson walks through the song in parts; "sing along" is the whole thing in one go.
 */
export function TrackScreen({ engine, tracker, coach, avatar, room, progress, calibrated, track, mode, onProgress, onReview, onClose }: Props) {
  const view = useRef<GameView>({ run: null, now: () => engine.now(), effects: [], free: [], glide: null });
  const box = useRef<HTMLDivElement>(null);
  const S = useRef({
    player: null as YouTubePlayer | null,
    voice: new VoiceGate(),
    plan: null as TrackPlan | null,
    step: 0,
    phase: "loading" as Phase,
    frames: [] as TakeFrame[],
    glide: null as GlideRun | null,
    volume: 25,
    rate: 1,
    startedAt: 0,
    tipAt: 0,
    lastUi: 0,
    recording: false,
    blob: null as Blob | null,
    poll: 0,
    progress,
  });
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<TrackPlan | null>(null);
  const [step, setStep] = useState(0);
  const [tip, setTip] = useState<Tip | null>(null);
  const [volume, setVolume] = useState(25);
  const [rate, setRate] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [clock, setClock] = useState({ t: 0, to: 0 });
  const [result, setResult] = useState<{ title: string; line: string; stars: number; xp: number } | null>(null);
  const [takes, setTakes] = useState<TakeStats[]>([]);
  const [title, setTitle] = useState(track.title);
  S.current.progress = progress;

  const current: TrackStep | undefined = plan?.steps[step];

  // ---- the player ----
  useEffect(() => {
    const s = S.current;
    const p = new YouTubePlayer();
    s.player = p;
    let gone = false;
    const off = p.onChange((st: PlayerState) => { if (!gone) setPlaying(st === "playing"); });
    if (box.current) {
      const host = document.createElement("div");
      box.current.appendChild(host);
      p.mount(host, track.videoId).then(() => {
        if (gone) return;
        if (p.title) setTitle(p.title);
        const duration = p.duration() || 180;
        const built = mode === "lesson" ? buildTrackPlan(duration, s.progress, calibrated) : singAlongPlan(duration);
        s.plan = built;
        setPlan(built);
        s.phase = "ready";
        setPhase("ready");
      }).catch((e: Error) => {
        if (gone) return;
        setError(e.message);
        s.phase = "error";
        setPhase("error");
      });
    }
    return () => { gone = true; off(); clearInterval(s.poll); p.destroy(); if (s.recording) void engine.stopRecording(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.videoId]);

  // ---- the ear ----
  useEffect(() => {
    const handle = (f: Frame) => {
      const s = S.current;
      const fr = view.current.free;
      fr.push({ t: f.t, midi: f.midi, db: f.db, voiced: f.voiced });
      if (fr.length > 900) fr.splice(0, 300);
      const a = avatar.current;
      a.voiced = f.voiced; a.midi = f.midi; a.db = f.db; a.h1h2 = f.h1h2; a.f1 = f.f1; a.f2 = f.f2; a.floorDb = room.current.noise; a.fever = false;
      const off = f.voiced ? (f.midi - Math.round(f.midi)) * 100 : 0;
      a.q = f.voiced ? (Math.abs(off) <= 20 ? 1 : Math.abs(off) <= 40 ? 0.5 : 0) : 0;
      const gl = s.glide;
      if (gl && !gl.finished) {
        gl.update(f, f.t);
        a.q = f.voiced ? 0.7 : 0;
        if (gl.finished) finishGlide(gl);
        return;
      }
      const live = tracker.push(f);
      const events = tracker.events;
      tracker.events = [];
      a.strain = live.strain;
      if (s.phase === "running") {
        s.frames.push({ t: f.t, midi: f.midi, db: f.db, voiced: f.voiced });
        const next = coach.update(live, events, null, 0, room.current.noise);
        if (next && next.tone !== "good") { s.tipAt = f.t; setTip(next); }
      }
      if (f.t - s.lastUi > 0.1) {
        s.lastUi = f.t;
        if (f.t - s.tipAt > 6) setTip(null);
      }
    };
    return engine.onFrame((heard) => {
      const s = S.current;
      s.voice.floorDb = room.current.noise;
      for (const f of s.voice.apply(heard)) handle(f);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, tracker, coach]);

  const finishGlide = (gl: GlideRun) => {
    const s = S.current;
    s.glide = null;
    view.current.glide = null;
    engine.setGate(room.current.gate);
    s.voice.marginDb = 12;
    const sm = gl.summary();
    let extra = "";
    if (gl.cfg.direction === "up") {
      const change = adjustSirenSpan(s.progress, sm.smoothness, sm.coverage, calibrated);
      saveProgress(s.progress);
      onProgress({ ...s.progress });
      if (change > 0) extra = ` Range widened to ${s.progress.sirenSpan} notes for next time.`;
    }
    setResult({ title: s.plan?.steps[s.step].title ?? "", line: `${Math.round(sm.smoothness * 100)}% smooth, ${Math.round(sm.coverage * 100)}% of the range.${extra}`, stars: sm.smoothness > 0.85 ? 3 : sm.smoothness > 0.6 ? 2 : 1, xp: 0 });
    s.phase = "between";
    setPhase("between");
  };

  const stopSong = () => {
    const s = S.current;
    clearInterval(s.poll);
    s.poll = 0;
    s.player?.pause();
  };

  const finishSing = useCallback(async () => {
    const s = S.current;
    const st = s.plan?.steps[s.step];
    if (!st || st.kind !== "sing" || s.phase !== "running") return;
    stopSong();
    s.phase = "between";
    const stats = scoreTake(s.frames);
    s.frames = [];
    if (s.recording) { s.recording = false; s.blob = await engine.stopRecording(); }
    const xp = recordTrackTake(s.progress, track, stats, mode === "lesson" ? "lesson" : undefined);
    saveProgress(s.progress);
    onProgress({ ...s.progress });
    setTakes((t) => [...t, stats]);
    const line = stats.stars === 0
      ? "Hardly any singing came through. Sing out over the song; it is turned down for a reason."
      : `${Math.round(stats.onNote * 100)}% on the note, ${Math.round(stats.steady * 100)}% steady${stats.breaths ? `, ${stats.breaths} breaths` : ""}.`;
    setResult({ title: st.title, line, stars: stats.stars, xp });
    setPhase("between");
  }, [engine, mode, onProgress, track]);

  const startStep = (i: number) => {
    const s = S.current;
    const st = s.plan?.steps[i];
    s.step = i;
    setStep(i);
    setResult(null);
    setTip(null);
    if (!st) {
      if (mode === "lesson") { s.progress.lessons.push(Date.now()); s.progress.xp += 100; saveProgress(s.progress); onProgress({ ...s.progress }); }
      s.phase = "done";
      setPhase("done");
      return;
    }
    s.phase = "running";
    setPhase("running");
    if (st.kind === "glide") {
      engine.setGate(Math.max(-70, room.current.gate - 6));
      s.voice.marginDb = 7;
      s.glide = new GlideRun(st.glide, engine.now());
      view.current.glide = s.glide;
      if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __glide: s.glide });
      return;
    }
    const p = s.player;
    if (!p) return;
    s.frames = [];
    if (st.kind === "listen") { p.setVolume(100); p.setRate(1); }
    else {
      p.setVolume(s.volume);
      s.rate = st.rate;
      setRate(st.rate);
      p.setRate(st.rate);
      if (st.record) { engine.startRecording(); s.recording = true; }
    }
    p.seek(st.from);
    p.play();
    s.startedAt = engine.now();
    clearInterval(s.poll);
    s.poll = window.setInterval(() => {
      const t = p.time();
      setClock({ t: Math.max(0, t - st.from), to: st.to - st.from });
      if (t >= st.to - 0.15 || p.state === "ended") {
        if (st.kind === "listen") {
          stopSong();
          s.phase = "between";
          setResult({ title: st.title, line: "Now you. The song comes back turned down, ready for your voice.", stars: 0, xp: 0 });
          setPhase("between");
        } else void finishSing();
      }
    }, 200);
  };

  const togglePlay = () => {
    const p = S.current.player;
    if (!p) return;
    if (p.state === "playing") p.pause(); else p.play();
  };
  const back = () => { const s = S.current; const st = s.plan?.steps[s.step]; if (!s.player || !st || st.kind === "glide") return; s.player.seek(Math.max(st.from, s.player.time() - 10)); };
  /** Jump to a point in this step's stretch of the song and keep going from there. */
  const scrub = (v: number) => {
    const s = S.current; const st = s.plan?.steps[s.step];
    if (!s.player || !st || st.kind === "glide") return;
    s.player.seek(st.from + v);
    setClock({ t: v, to: st.to - st.from });
    if (s.player.state !== "playing") s.player.play();
  };
  const changeVolume = (v: number) => { const s = S.current; s.volume = v; setVolume(v); if (current?.kind === "sing") s.player?.setVolume(v); };
  const changeRate = (r: number) => { const s = S.current; s.rate = r; setRate(r); s.player?.setRate(r); };
  const skip = () => {
    const s = S.current;
    if (s.glide) { s.glide = null; view.current.glide = null; engine.setGate(room.current.gate); s.voice.marginDb = 12; }
    stopSong();
    if (s.recording) { s.recording = false; void engine.stopRecording(); }
    s.frames = [];
    startStep(s.step + 1);
  };
  const quit = () => {
    const s = S.current;
    stopSong();
    if (s.recording) { s.recording = false; void engine.stopRecording(); }
    engine.setGate(room.current.gate);
    onClose();
  };

  const section = plan ? [...plan.sections].reverse().find((x) => x.at <= step)?.title ?? "" : "";
  const isSing = current?.kind === "sing";
  const isListen = current?.kind === "listen";

  return (
    <main className="track-play">
      <div className="play-bar">
        <strong>{title}</strong>
        {plan && <span className="pill">{section}{plan.steps.length > 1 ? ` · ${step + 1}/${plan.steps.length}` : ""}</span>}
        <MicMeter state={avatar} />
        <button className="small" onClick={quit}>Quit</button>
      </div>

      <div className="yt-box" data-hidden={phase === "done" || current?.kind === "glide"}><div ref={box} className="yt-host" /></div>

      {phase === "loading" && <div className="card track-note"><p>Loading the song…</p></div>}
      {phase === "error" && (
        <div className="card track-note">
          <p className="error">{error}</p>
          <button className="primary" onClick={quit}>Back</button>
        </div>
      )}

      {phase === "ready" && plan && (
        <div className="card track-note">
          <p className="eyebrow">{mode === "lesson" ? "A lesson around this song" : "Sing along"}</p>
          <h2>{mode === "lesson" ? "Warm up, learn it in parts, sing it through" : "The song plays low. You sing on top."}</h2>
          <p className="fine">{mode === "lesson" ? `${plan.steps.length} steps · about ${Math.round(plan.steps.reduce((sum, st) => sum + (st.kind === "glide" ? 40 : (st.to - st.from) / (st.kind === "sing" ? st.rate : 1)), 0) / 60)} minutes` : "Colour shows how close each held note lands. Turn the song up or down any time."}</p>
          <button className="primary big" onClick={() => startStep(0)}>Start</button>
        </div>
      )}

      {phase === "running" && current && (
        <>
          <div className="stage-wrap track-stage"><GameCanvas view={view} /></div>
          <div className="track-controls">
            {current.kind !== "glide" && (
              <>
                <button className="icon" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
                <button className="icon" onClick={back} aria-label="Back ten seconds"><RotateCcw size={18} /></button>
                <span className="clock">{fmtClock(clock.t)}</span>
                <input className="scrub" type="range" min={0} max={Math.max(1, clock.to)} step={0.5} value={Math.min(clock.t, clock.to)} onChange={(e) => scrub(Number(e.target.value))} aria-label="Position in the song" style={{ ["--fill" as string]: `${clock.to ? (clock.t / clock.to) * 100 : 0}%` }} />
                <span className="clock">{fmtClock(clock.to)}</span>
              </>
            )}
            {isSing && (
              <>
                <label className="vol"><span>Song</span><input type="range" min={0} max={100} value={volume} onChange={(e) => changeVolume(Number(e.target.value))} aria-label="Song volume" /></label>
                <span className="segmented small">{SPEEDS.map((r) => <button key={r} aria-selected={rate === r} onClick={() => changeRate(r)}>{r === 1 ? "Full speed" : `${r}×`}</button>)}</span>
              </>
            )}
            {isSing && <button className="small" onClick={() => void finishSing()}>Finish</button>}
            {(isListen || current.kind === "glide") && <button className="small" onClick={skip}>Skip</button>}
          </div>
          <CoachDrawer tip={tip} fallback={current.instruction} tone="info" />
        </>
      )}

      {phase === "between" && result && plan && (
        <div className="card lesson-between track-note">
          <p className="eyebrow">{section} · {step + 1}/{plan.steps.length}</p>
          <h2>{result.title}</h2>
          {result.stars > 0 && <div className="stars big">{[1, 2, 3].map((n) => <span key={n} data-on={n <= result.stars}>★</span>)}</div>}
          <p>{result.line}</p>
          {result.xp > 0 && <span className="pill">+{result.xp} XP</span>}
          <button className="primary big" onClick={() => startStep(step + 1)}>{plan.steps[step + 1] ? `Next: ${plan.steps[step + 1].title}` : mode === "lesson" ? "Finish lesson" : "See how it went"}</button>
          {current?.kind === "sing" && <button className="ghost" onClick={() => startStep(step)}>Sing that part again</button>}
          <button className="ghost" onClick={quit}>Stop here</button>
        </div>
      )}

      {phase === "done" && (
        <div className="card lesson-between track-note">
          <p className="eyebrow">{mode === "lesson" ? "Lesson done" : "Sing along"}</p>
          <h2>{title}</h2>
          {takes.length > 0 && (
            <p>
              {Math.round(Math.max(...takes.map((t) => t.onNote)) * 100)}% on the note at best
              {takes.length > 1 && takes[takes.length - 1].onNote > takes[0].onNote + 0.05 ? ", and it climbed as you went" : ""}.
              {Number.isFinite(takes[takes.length - 1].lo) ? ` You sang across ${Math.round(takes[takes.length - 1].hi - takes[takes.length - 1].lo)} notes.` : ""}
            </p>
          )}
          <p className="fine">Level {levelFromXp(progress.xp).level} · {progress.xp.toLocaleString()} XP. Rest the voice and come back tomorrow.</p>
          {S.current.blob && <button className="primary big" onClick={() => onReview(S.current.blob!, title)}>Review the full run</button>}
          <button className={S.current.blob ? "ghost" : "primary big"} onClick={quit}>Done</button>
        </div>
      )}
    </main>
  );
}
