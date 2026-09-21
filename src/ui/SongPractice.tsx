import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioEngine } from "../audio/engine";
import type { Tracker } from "../audio/analysis";
import type { Frame } from "../audio/frame";
import type { GuideSynth } from "../audio/synth";
import { Backing } from "../audio/backing";
import { VoiceGate } from "../audio/voiceGate";
import type { Coach, Tip } from "../coach/rules";
import { foldedCents } from "../coach/rules";
import { GameRun, difficultyById, type RunSummary } from "../game/scoring";
import { chooseTonic, prepareLine, prepareSong, type PreparedSong, type Song } from "../game/songs";
import { levelFromXp, recordRun, saveProgress, type Progress } from "../game/progress";
import { SONGS } from "../game/songs";
import { GameCanvas, type GameView } from "./GameCanvas";
import type { AvatarState } from "./SingerAvatar";
import { BuddyPanel } from "./BuddyPanel";
import { CoachDrawer } from "./CoachDrawer";
import { MicMeter } from "./MicMeter";
import { Play, RotateCcw, SkipForward } from "lucide-react";

interface Props {
  engine: AudioEngine;
  tracker: Tracker;
  coach: Coach;
  synth: GuideSynth | null;
  avatar: React.MutableRefObject<AvatarState>;
  room: React.MutableRefObject<{ gate: number; noise: number }>;
  progress: Progress;
  calibrated: { low: number; high: number; comfort?: number } | null;
  song: Song;
  onProgress: (p: Progress) => void;
  onBuddy: (k: Progress["settings"]["buddy"]) => void;
  onReview: (blob: Blob, targets: { midi: number; start: number; end: number; lyric: string | null }[] | null, title: string) => void;
  onClose: () => void;
}

type Kind = "listen" | "hear-line" | "sing-line" | "with-tune" | "alone";
interface Step { kind: Kind; title: string; instruction: string; line?: number; melody: number }
type Phase = "intro" | "running" | "between" | "done";

const SPEEDS = [0.5, 0.75, 1];
const MELODY = [{ id: 0, text: "Tune off" }, { id: 0.45, text: "Tune quiet" }, { id: 1, text: "Tune loud" }];

function buildSteps(p: PreparedSong): Step[] {
  const lines = p.phraseEnds.length;
  const steps: Step[] = [{ kind: "listen", title: "Hear the song", instruction: "Just listen. Watch the notes go by and follow the words.", melody: 1 }];
  for (let i = 0; i < Math.min(lines, 8); i++) {
    steps.push({ kind: "hear-line", title: `Line ${i + 1}: hear it`, instruction: "Listen to this line.", line: i, melody: 1 });
    steps.push({ kind: "sing-line", title: `Line ${i + 1}: sing it`, instruction: "Sing with the tune, in time. Colour shows how close you land.", line: i, melody: 0.45 });
  }
  steps.push({ kind: "with-tune", title: "Whole song with the tune", instruction: "Sing the whole song along with the piano.", melody: 0.45 });
  steps.push({ kind: "alone", title: "On your own", instruction: "Just the beat this time. This one is recorded for your review.", melody: 0 });
  return steps;
}

/**
 * Learn a song the way karaoke and choir rehearsal do it: hear it, take it line by line with the
 * tune playing, sing the whole thing with the tune, then on your own. Everything runs in time
 * with a count-in, so nothing depends on the app guessing when a note was sung.
 */
export function SongPractice({ engine, tracker, coach, synth, avatar, room, progress, calibrated, song, onProgress, onBuddy, onReview, onClose }: Props) {
  const view = useRef<GameView>({ run: null, now: () => engine.now(), effects: [], free: [] });
  const S = useRef({
    voice: new VoiceGate(), backing: null as Backing | null, run: null as GameRun | null, prepared: null as PreparedSong | null,
    steps: [] as Step[], step: 0, phase: "intro" as Phase, rate: 1, melody: null as number | null, melodyNotes: [] as { midi: number; start: number; dur: number }[],
    melodyAt: 0, finishing: false, recStart: 0, tipAt: 0, lastUi: 0, progress, blob: null as Blob | null, targets: null as { midi: number; start: number; end: number; lyric: string | null }[] | null,
  });
  S.current.progress = progress;
  const settings = progress.settings;
  const [phase, setPhase] = useState<Phase>("intro");
  const [steps, setSteps] = useState<Step[]>([]);
  const [step, setStep] = useState(0);
  const [rate, setRate] = useState(1);
  const [melody, setMelody] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [result, setResult] = useState<{ summary: RunSummary; xp: number } | null>(null);
  const [lyric, setLyric] = useState<{ words: string[]; at: number }>({ words: [], at: -1 });

  const prepare = useCallback((r: number) => {
    const tonic = chooseTonic(song, settings.voice, calibrated, settings.transpose);
    return prepareSong(song, tonic, r);
  }, [song, settings.voice, settings.transpose, calibrated]);

  useEffect(() => {
    const p = prepare(1);
    S.current.prepared = p;
    const st = buildSteps(p);
    S.current.steps = st;
    setSteps(st);
    return () => { const s = S.current; s.backing?.stop(); synth?.stop(); if (engine.recording) void engine.stopRecording(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id]);

  const finishStep = useCallback(async () => {
    const s = S.current;
    const run = s.run;
    const st = s.steps[s.step];
    if (!run || s.finishing || !st) return;
    s.finishing = true;
    s.run = null;
    synth?.stop();
    s.backing?.hushMelody();
    const scored = st.kind === "sing-line" || st.kind === "with-tune" || st.kind === "alone";
    let res: { summary: RunSummary; xp: number } | null = null;
    if (scored) {
      const sum = run.summary();
      let xp = 0;
      if (st.kind !== "sing-line") { const out = recordRun(s.progress, sum, SONGS.filter((x) => x.kind === "drill").map((x) => x.id)); xp = out.xpGained; }
      else if (sum.stars > 0) { xp = 10 + Math.round(sum.accuracy * 30); s.progress.xp += xp; }
      saveProgress(s.progress);
      onProgress({ ...s.progress });
      res = { summary: sum, xp };
    }
    if (st.kind === "alone") {
      const blob = await engine.stopRecording();
      if (blob) {
        s.blob = blob;
        s.targets = run.notes.filter((n) => n.onAt >= 0).map((n) => ({ midi: n.midi, start: n.start + run.startAt - s.recStart, end: n.start + n.dur + run.startAt - s.recStart, lyric: n.lyric }));
      }
    }
    s.finishing = false;
    setResult(res);
    setTip(null);
    // Hearing a line rolls straight into singing it.
    if (st.kind === "listen" || st.kind === "hear-line") { startStep(s.step + 1); return; }
    s.phase = "between";
    setPhase("between");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, synth, onProgress]);

  const startStep = (i: number) => {
    const s = S.current;
    const st = s.steps[i];
    s.step = i;
    setStep(i);
    setResult(null);
    setTip(null);
    if (!st) { s.phase = "done"; setPhase("done"); return; }
    if (!engine.ctx) return;
    const full = s.rate === 1 && s.prepared ? s.prepared : prepare(s.rate);
    const p = st.line == null ? full : prepareLine(full, st.line === 0 ? 0 : full.phraseEnds[st.line - 1] + 1, full.phraseEnds[st.line]);
    const now = engine.now();
    const run = new GameRun(p, difficultyById(settings.difficulty), "tempo", now + 0.1);
    s.run = run;
    view.current.run = run;
    view.current.effects = [];
    coach.reset();
    tracker.reset();
    s.backing ??= new Backing(engine.ctx);
    s.backing.start();
    s.backing.setKey(p.tonic + (song.keyOffset ?? 0), song.mode === "minor" ? "minor" : "major");
    s.backing.setMode("off");
    synth?.stop();
    const ctxStart = engine.ctx.currentTime + 0.1;
    const level = s.melody ?? st.melody;
    const notes = p.notes.map((n) => ({ midi: n.midi, start: n.start, dur: n.dur }));
    s.melodyNotes = notes;
    s.melodyAt = now + 0.1;
    if (level > 0) s.backing.playMelody(notes, ctxStart, level);
    else s.backing.hushMelody();
    if (synth && (settings.metronome || level === 0)) synth.clickTrack(ctxStart, p.beat, song.beatsPerBar, 0, p.end);
    if (st.kind === "alone") s.recStart = engine.startRecording() ?? now;
    if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __run: run, __backing: s.backing });
    s.phase = "running";
    setPhase("running");
  };

  // ---- the ear ----
  useEffect(() => {
    const handle = (f: Frame) => {
      const s = S.current;
      const run = s.run;
      const st = s.steps[s.step];
      const a = avatar.current;
      a.voiced = f.voiced; a.midi = f.midi; a.db = f.db; a.h1h2 = f.h1h2; a.f1 = f.f1; a.f2 = f.f2; a.floorDb = room.current.noise; a.fever = !!run && run.fever.active;
      a.q = run && !run.finished ? run.liveQ : 0;
      if (!run || run.finished || !st) return;
      const listening = st.kind === "listen" || st.kind === "hear-line";
      let fr = f;
      // The tune coming back through the mic: quiet, on the note the piano is playing right now.
      const level = s.melody ?? st.melody;
      if (!listening && level > 0 && fr.voiced && fr.db < Math.min(room.current.noise + 18, -38)) {
        const t = f.t - s.melodyAt;
        const sounding = s.melodyNotes.find((n) => t >= n.start - 0.05 && t < n.start + n.dur + 0.3);
        if (sounding && Math.abs(foldedCents(fr.midi, sounding.midi)) < 40) fr = { ...f, voiced: false, midi: NaN };
      }
      if (listening) fr = { ...f, voiced: false, midi: NaN };
      const live = tracker.push(fr);
      const events = tracker.events;
      tracker.events = [];
      a.strain = live.strain;
      run.update(fr, f.t);
      for (const e of run.events) view.current.effects.push(e);
      run.events = [];
      if (!listening) {
        const target = run.target;
        const next = coach.update(live, events, target ? target.midi : null, target ? f.t - target.onAt : 0, room.current.noise);
        if (next && next.tone === "alert") { s.tipAt = f.t; setTip(next); }
      }
      if (f.t - s.lastUi > 0.1) {
        s.lastUi = f.t;
        if (f.t - s.tipAt > 6) setTip(null);
        // The line being sung, karaoke style: the current word bold.
        const t = run.takeTime(f.t);
        const cur = run.notes.findIndex((n) => t >= n.start && t < n.start + n.dur);
        const at = cur >= 0 ? cur : run.notes.findIndex((n) => n.start > t);
        const from = run.song.phraseEnds.filter((e) => e < at).map((e) => e + 1).pop() ?? 0;
        const to = run.song.phraseEnds.find((e) => e >= at) ?? run.notes.length - 1;
        const words = run.notes.slice(from, to + 1).map((n) => n.lyric ?? "·");
        setLyric({ words, at: cur >= 0 ? cur - from : -1 });
      }
      if (run.finished) void finishStep();
    };
    return engine.onFrame((heard) => {
      const s = S.current;
      s.voice.floorDb = room.current.noise;
      for (const f of s.voice.apply(heard)) handle(f);
    });
  }, [engine, tracker, coach, avatar, room, finishStep]);

  const quit = () => { const s = S.current; s.run = null; synth?.stop(); s.backing?.hushMelody(); if (engine.recording) void engine.stopRecording(); onClose(); };
  const changeRate = (r: number) => { S.current.rate = r; setRate(r); };
  const changeMelody = (m: number | null) => { S.current.melody = m; setMelody(m); };
  const current = steps[step];
  const section = current ? (current.kind === "listen" ? "Hear it" : current.line != null ? "Line by line" : "Sing it") : "";
  const lvl = levelFromXp(progress.xp);

  return (
    <main className="arcade-play practice">
      <div className="play-bar">
        <strong>{song.title}</strong>
        {current && <span className="pill">{section} · {step + 1}/{steps.length}</span>}
        <MicMeter state={avatar} />
        <button className="small" onClick={quit}>Quit</button>
      </div>

      {phase === "intro" && (
        <div className="card track-note">
          <p className="eyebrow">Learn this song</p>
          <h2>Hear it, take it line by line, then sing it through</h2>
          <p className="fine">{steps.length} short steps · the tune plays with you until you are ready to go it alone.</p>
          <div className="practice-opts">
            <span className="segmented small">{SPEEDS.map((r) => <button key={r} aria-selected={rate === r} onClick={() => changeRate(r)}>{r === 1 ? "Full speed" : `${r}×`}</button>)}</span>
          </div>
          <button className="primary big" onClick={() => startStep(0)}><Play size={18} /> Start</button>
          <button className="ghost" onClick={() => startStep(steps.length - 2)}>Skip to the whole song</button>
        </div>
      )}

      {phase === "running" && current && (
        <>
          <div className="lyric-line" aria-live="off">
            {lyric.words.length ? lyric.words.map((w, i) => <span key={i} data-on={i === lyric.at}>{w}</span>) : <span className="fine">{current.title}</span>}
          </div>
          <div className="stage-wrap">
            <GameCanvas view={view} />
            <BuddyPanel state={avatar} kind={settings.buddy} onSwap={onBuddy} />
          </div>
          <div className="track-controls">
            <span className="segmented small">{SPEEDS.map((r) => <button key={r} aria-selected={rate === r} onClick={() => changeRate(r)}>{r === 1 ? "Full speed" : `${r}×`}</button>)}</span>
            <span className="segmented small">{MELODY.map((m) => <button key={m.id} aria-selected={(melody ?? current.melody) === m.id} onClick={() => changeMelody(m.id)}>{m.text}</button>)}</span>
            <button className="small" onClick={() => startStep(step)} aria-label="Start this step again"><RotateCcw size={16} /> Again</button>
            <button className="small" onClick={() => { S.current.run = null; synth?.stop(); S.current.backing?.hushMelody(); startStep(step + 1); }} aria-label="Skip this step"><SkipForward size={16} /> Skip</button>
          </div>
          <CoachDrawer tip={tip} fallback={current.instruction} tone="info" />
        </>
      )}

      {phase === "between" && current && (
        <div className="card lesson-between track-note">
          <p className="eyebrow">{section} · {step + 1}/{steps.length}</p>
          <h2>{current.title}</h2>
          {result && (
            <>
              <div className="stars big">{[1, 2, 3, 4, 5].slice(0, current.kind === "sing-line" ? 3 : 5).map((n) => <span key={n} data-on={n <= (current.kind === "sing-line" ? Math.min(3, result.summary.stars) : result.summary.stars)}>★</span>)}</div>
              <p>{result.summary.stars ? `${Math.round(result.summary.accuracy * 100)}% on the note${result.summary.biasCents <= -15 ? ", mostly under it" : result.summary.biasCents >= 15 ? ", mostly over it" : ""}. ${result.summary.maxCombo} in a row.` : "Nothing was picked up. Sing out, close to the phone, and try again."}</p>
              {result.xp > 0 && <span className="pill">+{result.xp} XP</span>}
            </>
          )}
          <button className="primary big" onClick={() => startStep(step + 1)}>{steps[step + 1] ? `Next: ${steps[step + 1].title}` : "Finish"}</button>
          <div className="actions">
            <button className="ghost" onClick={() => startStep(step)}>Sing it again</button>
            {current.kind === "sing-line" && <button className="ghost" onClick={() => startStep(step - 1)}>Hear it again</button>}
            {current.kind === "sing-line" && <button className="ghost" onClick={() => startStep(steps.length - 2)}>Skip to the whole song</button>}
            <button className="ghost" onClick={quit}>Stop here</button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="card lesson-between track-note">
          <p className="eyebrow">Song learnt</p>
          <h2>{song.title}</h2>
          <p className="fine">Level {lvl.level} · {progress.xp.toLocaleString()} XP</p>
          {S.current.blob && <button className="primary big" onClick={() => onReview(S.current.blob!, S.current.targets, song.title)}>Review your take</button>}
          <button className={S.current.blob ? "ghost" : "primary big"} onClick={quit}>Done</button>
        </div>
      )}
    </main>
  );
}
