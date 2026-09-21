import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine } from "./audio/engine";
import { Tracker, type Calibration } from "./audio/analysis";
import type { Frame } from "./audio/frame";
import { GuideSynth } from "./audio/synth";
import { Backing } from "./audio/backing";
import { VoiceGate } from "./audio/voiceGate";
import { noteName } from "./audio/pitch";
import { Coach, foldedCents, type Tip } from "./coach/rules";
import { buildHold, buildScale, buildSong, scoreFromRun, type Exercise, type ExerciseScore } from "./coach/exercises";
import { GameRun, difficultyById } from "./game/scoring";
import { prepareFromNotes, prepareSong, songById, type PreparedSong, type Song } from "./game/songs";
import { GameCanvas, type GameView } from "./ui/GameCanvas";
import { RangeCompare } from "./ui/RangeCompare";
import { guessVoiceType } from "./coach/voiceType";
import { buildPriorities, type Priority } from "./coach/report";
import { loadProgress, saveProgress, setSaveHook, type Progress, type Settings } from "./game/progress";
import { pushProgress, reconcile } from "./game/sync";
import { PitchCanvas, type CanvasView, type TracePoint } from "./ui/PitchCanvas";
import { Meters, NoteReadout, RangeBar, TipCard, type Readout } from "./ui/Panels";
import { GameScreen, type ReviewTarget } from "./ui/GameScreen";
import { TrackScreen } from "./ui/TrackScreen";
import { SongPractice } from "./ui/SongPractice";
import { Player } from "./ui/Player";
import type { Track } from "./game/tracks";
import { TakeReview } from "./ui/TakeReview";
import { Home, nextSong } from "./ui/Home";
import { buildLesson, type LessonPlan } from "./game/lesson";
import { You } from "./ui/You";
import { SettingsSheet } from "./ui/SettingsSheet";
import { EMPTY_AVATAR, type AvatarState } from "./ui/SingerAvatar";
import { BuddyPanel } from "./ui/BuddyPanel";
import { Mic, ListMusic, Search, UserRound, Star, Sparkles, type LucideIcon } from "lucide-react";

type Tab = "sing" | "songs" | "review" | "you";
type StepId = "mic" | "range-low" | "range-high" | "hold" | "song" | "scale";
type Phase = "ready" | "running" | "done";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "sing", label: "Sing", icon: Mic },
  { id: "songs", label: "Songs", icon: ListMusic },
  { id: "review", label: "Review", icon: Search },
  { id: "you", label: "You", icon: UserRound },
];

const STEPS: { id: StepId; label: string }[] = [
  { id: "mic", label: "Mic check" },
  { id: "range-low", label: "Lowest note" },
  { id: "range-high", label: "Highest note" },
  { id: "hold", label: "Hold a note" },
  { id: "song", label: "Song" },
  { id: "scale", label: "Scale" },
];

const EMPTY: Readout = { voiced: false, midi: NaN, cents: 0, hasTarget: false, steadiness: NaN, register: "unknown", strain: 0, db: -90 };
const RANGE_TIPS = new Set(["strain", "crack", "quiet"]);

export default function App() {
  const engine = useRef(new AudioEngine()).current;
  const tracker = useRef(new Tracker()).current;
  const coach = useRef(new Coach()).current;
  const synth = useRef<GuideSynth | null>(null);
  const backing = useRef<Backing | null>(null);
  const avatar = useRef<AvatarState>({ ...EMPTY_AVATAR });
  /** background noise measured once the mic opens; shared by every screen */
  const voice = useRef(new VoiceGate());
  const room = useRef({ gate: -55, noise: -60, ready: false, start: -1, samples: [] as number[], quiet: [] as number[], lastGate: 0 });

  // Everything the per-frame handler touches lives in refs so it never waits for a React render.
  const S = useRef({
    owner: "home" as "home" | "studio",
    step: "mic" as StepId,
    coaching: "off" as "off" | "range" | "full",
    exercise: null as Exercise | null,
    /** the self-paced run behind a sung exercise */
    run: null as GameRun | null,
    running: false,
    takeStart: 0,
    maskUntil: 0,
    micStart: 0,
    noise: [] as number[],
    noiseDb: -60,
    peakDb: -90,
    low: Infinity,
    high: -Infinity,
    calFrames: [] as Frame[],
    /** the first half second of each range slide: where the singer chose to start */
    starts: [] as number[],
    startAt: -1,
    lastUi: 0,
    tipAt: 0,
    pending: null as Tip | null,
  });
  const view = useRef<CanvasView>({ trace: [], now: () => engine.now(), exercise: null, takeStart: 0, range: null, floorDb: -60 });
  const gameView = useRef<GameView>({ run: null, now: () => engine.now(), effects: [], free: [], onNoteTap: (n) => backing.current?.preview(n.midi) });

  const [tab, setTab] = useState<Tab>("sing");
  const [focus, setFocus] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>(() => loadProgress());

  // Every save goes to the sync backend too, and a newer record from another device wins on load.
  useEffect(() => {
    setSaveHook(pushProgress);
    void reconcile(loadProgress()).then((remote) => { if (remote) setProgress(remote); });
    return () => setSaveHook(null);
  }, []);
  const [autoplay, setAutoplay] = useState<Song | null>(null);
  const [lesson, setLesson] = useState<LessonPlan | null>(null);
  const [review, setReview] = useState<{ blob: Blob; targets: ReviewTarget[] | null; title: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [studio, setStudio] = useState<"off" | "guided" | "report">("off");
  const [trackPlay, setTrackPlay] = useState<{ track: Track; mode: "lesson" | "sing" } | null>(null);
  const [practice, setPractice] = useState<Song | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [readout, setReadout] = useState<Readout>(EMPTY);
  const [tip, setTip] = useState<Tip | null>(null);
  const [cal, setCal] = useState<Calibration | null>(null);
  const [priorities, setPriorities] = useState<Priority[] | null>(null);
  const [mic, setMic] = useState({ measured: false, levelOk: false, clipping: false });
  const [range, setRange] = useState({ low: Infinity, high: -Infinity });
  const [scores, setScores] = useState<ExerciseScore[]>([]);
  const [takeUrl, setTakeUrl] = useState<string | null>(null);
  const [headphones, setHeadphones] = useState(false);
  const step = STEPS[stepIndex].id;

  const finishTake = useCallback(async () => {
    const s = S.current;
    const ex = s.exercise;
    if (!ex || !s.running) return;
    s.running = false;
    s.coaching = "off";
    backing.current?.setTarget(null);
    const run = s.run;
    s.run = null;
    if (!run) return;
    const score = scoreFromRun(ex.id, run);
    setScores((prev) => [...prev.filter((p) => p.id !== ex.id), score]);
    setPhase("done");
    const blob = await engine.stopRecording();
    if (blob) setTakeUrl(URL.createObjectURL(blob));
  }, [engine, tracker]);

  // Room measurement for every screen, then the guided session's own logic.
  useEffect(() => {
    return engine.onFrame((raw) => {
      const r = room.current;
      if (!r.ready) {
        if (r.start < 0) r.start = raw.t;
        if (raw.t - r.start < 1.5) r.samples.push(raw.db);
        else {
          const sorted = [...r.samples].sort((a, b) => a - b);
          r.noise = sorted[Math.floor(sorted.length * 0.6)] ?? -60;
          r.gate = Math.max(-62, Math.min(-30, r.noise + 10));
          engine.setGate(r.gate);
          r.ready = true;
          r.lastGate = raw.t;
        }
      } else {
        // Keep listening to the room: the floor is re-estimated from the quietest recent moments,
        // so a noisy first second (or a phone warming up) does not leave the gate stuck high.
        // A steady hum can read as "pitched" and must still count as floor, but singing must not:
        // only voiced frames close to the current floor go in.
        if (!raw.voiced || raw.db < r.noise + 10) { r.quiet.push(raw.db); if (r.quiet.length > 400) r.quiet.shift(); }
        if (raw.t - r.lastGate > 4 && r.quiet.length >= 60 && S.current.owner !== "studio") {
          const sorted = [...r.quiet].sort((a, b) => a - b);
          // Not the very quietest moments: a television or chatter in the room has pauses, and the
          // floor should sit at what fills the gaps between sung notes, not at those pauses.
          r.noise = sorted[Math.floor(sorted.length * 0.35)];
          r.gate = Math.max(-62, Math.min(-30, r.noise + 10));
          engine.setGate(r.gate);
          r.lastGate = raw.t;
        }
      }
      const s = S.current;
      if (s.owner !== "studio") return;

      // Only singing gets past here; the room's noise is treated as silence.
      voice.current.floorDb = s.noiseDb;
      const frames = s.step === "mic" ? [raw] : voice.current.apply(raw);
      for (const heard of frames) handleStudio(heard);
    });
    const handleStudio = (heard: Frame) => {
      const s = S.current;
      let f: Frame = heard.t < s.maskUntil ? { ...heard, voiced: false, midi: NaN } : heard;
      const run = s.running && s.run && !s.run.finished ? s.run : null;
      const target = run ? run.target : null;

      const bk = backing.current;
      if (bk && s.running) {
        const gate = Math.max(-62, Math.min(-30, s.noiseDb + 10));
        if (bk.audible() && f.voiced && f.db < gate + 5 && bk.tones().some((m) => Math.abs(foldedCents(f.midi, m)) < 25)) { f = { ...heard, voiced: false, midi: NaN }; bk.bleed(); }
        bk.tick(f.voiced);
      }
      const live = tracker.push(f);
      const events = tracker.events;
      tracker.events = [];

      const a = avatar.current;
      a.voiced = f.voiced; a.midi = f.midi; a.db = f.db; a.h1h2 = f.h1h2; a.f1 = f.f1; a.f2 = f.f2; a.strain = live.strain; a.floorDb = s.noiseDb; a.fever = false;
      a.q = target && f.voiced ? (Math.abs(foldedCents(f.midi, target.midi)) <= 25 ? 1 : 0) : 0;

      if (run) {
        run.update(f, f.t);
        bk?.setTarget(run.target ? run.target.midi : null, run.target ? run.target.i : "");
        for (const e of run.events) gameView.current.effects.push(e);
        run.events = [];
        if (run.finished) void finishTake();
      }
      const err = target && f.voiced ? foldedCents(f.midi, target.midi) : null;

      const trace = view.current.trace;
      trace.push({ t: f.t, midi: f.midi, db: f.db, voiced: f.voiced, register: live.register, strained: live.strain > 0.55, err } as TracePoint);
      if (trace.length > 2400) trace.splice(0, 600);

      if (s.coaching !== "off") {
        const next = coach.update(live, events, target ? target.midi : null, target ? f.t - target.onAt : 0, s.noiseDb);
        if (next && (s.coaching === "full" || RANGE_TIPS.has(next.id))) {
          // During a sung exercise, hold remarks for the end of the phrase; alerts and range tips show at once.
          if (run && next.tone !== "alert") s.pending = next;
          else { s.tipAt = f.t; setTip(next); }
        }
        if (run) for (const e of gameView.current.effects) if (e.type === "phrase" && s.pending) { s.tipAt = f.t; setTip(s.pending); s.pending = null; }
      }

      if (s.step === "mic" && s.micStart >= 0) {
        if (f.t - s.micStart < 2) s.noise.push(f.db);
        else if (s.noise.length) {
          const sorted = [...s.noise].sort((a, b) => a - b);
          s.noiseDb = sorted[Math.floor(sorted.length * 0.9)];
          s.noise = [];
          engine.setGate(Math.max(-62, Math.min(-30, s.noiseDb + 10)));
          view.current.floorDb = Math.min(-40, s.noiseDb);
          setMic((m) => ({ ...m, measured: true }));
        } else {
          s.peakDb = Math.max(s.peakDb, f.db);
          if (f.voiced && f.db > s.noiseDb + 20) setMic((m) => (m.levelOk ? m : { ...m, levelOk: true }));
          if (f.db > -1.5) setMic((m) => (m.clipping ? m : { ...m, clipping: true }));
        }
      }
      if ((s.step === "range-low" || s.step === "range-high") && s.coaching === "range") {
        if (f.voiced) {
          s.calFrames.push(f);
          if (s.startAt < 0) s.startAt = f.t;
          if (f.t - s.startAt < 0.6) s.starts.push(f.midi);
        }
        if (live.note) {
          if (s.step === "range-low" && live.note.median < s.low) { s.low = live.note.median; setRange((x) => ({ ...x, low: s.low })); }
          if (s.step === "range-high" && live.note.median > s.high) { s.high = live.note.median; setRange((x) => ({ ...x, high: s.high })); }
        }
      }
      if (f.t - s.lastUi > 0.08) {
        s.lastUi = f.t;
        setReadout({
          voiced: f.voiced, midi: f.midi, hasTarget: !!target,
          cents: !f.voiced ? 0 : target ? foldedCents(f.midi, target.midi) : (f.midi - Math.round(f.midi)) * 100,
          steadiness: live.steadiness, register: live.register, strain: live.strain, db: f.db,
        });
        if (f.t - s.tipAt > 6) setTip(null);
      }
    };
  }, [engine, tracker, coach, finishTake]);

  const startMic = useCallback(async () => {
    if (micReady) return true;
    setMicError(null);
    try {
      if (import.meta.env.DEV && location.search.includes("fakemic")) {
        await engine.startFakeMic();
        (window as unknown as { __vc: unknown }).__vc = { engine, tracker };
      } else await engine.startMic();
      synth.current ??= new GuideSynth(engine.ctx!);
      backing.current ??= new Backing(engine.ctx!);
      setMicReady(true);
      return true;
    } catch {
      setMicError("Microphone blocked. Allow it for this site in your browser settings, then try again.");
      return false;
    }
  }, [engine, tracker, micReady]);

  const setSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const next = { ...progress, settings: { ...progress.settings, [key]: value } };
    saveProgress(next);
    setProgress(next);
  };

  const go = (t: Tab) => { setStudio("off"); S.current.owner = "home"; setFocus(false); if (t !== "songs") setLesson(null); setTab(t); };

  const playSong = async (song: Song) => {
    if (!(await startMic())) return;
    setAutoplay(song);
    go("songs");
  };

  const startLesson = async () => {
    if (!(await startMic())) return;
    setLesson(buildLesson(progress, cal ? { low: cal.low, high: cal.high, comfort: cal.comfort } : null, nextSong(progress)));
    go("songs");
  };

  /** The take review is an overlay, so results and lessons underneath keep their state. */
  const openReview = (blob: Blob, targets: ReviewTarget[] | null, title: string) => {
    setReview({ blob, targets, title });
    setReviewOpen(true);
  };

  // ---------- Guided assessment ----------
  const beginGuided = async () => {
    if (!(await startMic())) return;
    tracker.reset();
    coach.reset();
    const s = S.current;
    Object.assign(s, { owner: "studio", step: "mic", coaching: "off", micStart: engine.now(), noise: [], low: Infinity, high: -Infinity, calFrames: [], starts: [], startAt: -1 });
    setScores([]);
    setStepIndex(0);
    setPhase("ready");
    setStudio("guided");
  };

  const goToStep = (i: number) => {
    const s = S.current;
    synth.current?.stop();
    s.running = false;
    s.exercise = null;
    s.run = null;
    gameView.current.run = null;
    view.current.exercise = null;
    setTakeUrl(null);
    setTip(null);
    setPhase("ready");
    if (i >= STEPS.length) {
      setPriorities(buildPriorities(tracker, scores, cal));
      s.owner = "home";
      setStudio("report");
      return;
    }
    const id = STEPS[i].id;
    s.step = id;
    s.startAt = -1;
    s.coaching = id === "range-low" || id === "range-high" ? "range" : "off";
    if (id === "hold") {
      const span = s.high - s.low;
      const lowFrames = s.calFrames.filter((f) => f.midi < s.low + span * 0.4).map((f) => f.weight).sort((a, b) => a - b);
      const starts = [...s.starts].sort((a, b) => a - b);
      const comfort = starts.length >= 10 ? starts[starts.length >> 1] : undefined;
      const c: Calibration = { low: s.low, high: s.high, comfort, chestWeight: lowFrames.length > 20 ? lowFrames[lowFrames.length >> 1] : 8, noiseDb: s.noiseDb };
      tracker.reset();
      tracker.calibration = c;
      coach.reset();
      setCal(c);
      view.current.range = [c.low, c.high];
    }
    setStepIndex(i);
  };

  const exerciseFor = (id: StepId, c: Calibration) => (id === "hold" ? buildHold(c) : id === "song" ? buildSong(c) : buildScale(c));

  const listen = () => {
    if (!cal || !synth.current || !engine.ctx) return;
    const ex = exerciseFor(step, cal);
    const shift = ex.notes[0].start - 0.2;
    synth.current.stop();
    synth.current.playSequence(ex.notes.map((n) => ({ ...n, start: n.start - shift })), engine.ctx.currentTime);
    const last = ex.notes[ex.notes.length - 1];
    S.current.maskUntil = engine.now() + last.start - shift + last.dur + 0.3;
  };

  /** The exercise as a self-paced song: the first note sounds, and each note waits for the singer. */
  const preparedFor = (id: StepId, ex: Exercise): PreparedSong => {
    if (id === "song") return prepareSong(songById("birthday"), ex.notes[0].midi + 5);
    if (id === "hold") return prepareFromNotes("hold", "Hold one note", ex.notes.map((n) => ({ ...n, lyric: "ah" })));
    const sol = ["do", "re", "mi", "fa", "sol", "fa", "mi", "re", "do"];
    return prepareFromNotes("scale", "Five-note scale", ex.notes.map((n, i) => ({ ...n, lyric: sol[i % sol.length] })));
  };

  const startTake = () => {
    if (!cal || !synth.current || !engine.ctx) return;
    const s = S.current;
    const ex = exerciseFor(step, cal);
    synth.current.stop();
    s.exercise = ex;
    s.takeStart = engine.now();
    s.maskUntil = 0;
    const prepared = preparedFor(step, ex);
    const run = new GameRun(prepared, difficultyById("medium"), "flow", s.takeStart);
    s.run = run;
    gameView.current.run = run;
    gameView.current.effects = [];
    if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __run: run });
    tracker.reset();
    tracker.calibration = cal;
    coach.reset();
    s.running = true;
    s.coaching = "full";
    const bk = backing.current;
    if (bk) {
      bk.start();
      bk.setKey(prepared.tonic, "major");
      bk.setStyle(progress.settings.backing);
      bk.setMode(headphones ? "full" : "quiet");
      bk.setTarget(run.notes[0].midi, 0);
    }
    engine.startRecording();
    setTakeUrl(null);
    setTip(null);
    setPhase("running");
  };

  const leaveStudio = () => {
    synth.current?.stop();
    backing.current?.setTarget(null);
    void engine.stopRecording();
    S.current.coaching = "off";
    S.current.running = false;
    S.current.owner = "home";
    setTip(null);
    setReadout(EMPTY);
    setStudio("off");
    setTab("you");
  };

  // ---------- Render ----------
  const score = scores.find((x) => x.id === step);
  const rangeOk = step === "range-low" ? Number.isFinite(range.low) : Number.isFinite(range.high) && range.high - range.low >= 7;

  let body: React.ReactNode;
  if (practice)
    body = (
      <SongPractice engine={engine} tracker={tracker} coach={coach} synth={synth.current} avatar={avatar} room={room} progress={progress} calibrated={cal ? { low: cal.low, high: cal.high, comfort: cal.comfort } : null}
        song={practice} onProgress={setProgress} onBuddy={(k) => setSetting("buddy", k)} onReview={(blob, targets, title) => { setPractice(null); openReview(blob, targets, title); }} onClose={() => setPractice(null)} />
    );
  else if (trackPlay)
    body = (
      <TrackScreen engine={engine} tracker={tracker} coach={coach} avatar={avatar} room={room} progress={progress} calibrated={cal ? { low: cal.low, high: cal.high, comfort: cal.comfort } : null}
        track={trackPlay.track} mode={trackPlay.mode} onProgress={setProgress} onReview={(blob, title) => { setTrackPlay(null); openReview(blob, null, title); }} onClose={() => setTrackPlay(null)} />
    );
  else if (studio === "guided") body = renderStudio();
  else if (studio === "report") body = renderReport();
  else if (tab === "sing")
    body = (
      <Home engine={engine} tracker={tracker} coach={coach} micReady={micReady} micError={micError} onStartMic={() => void startMic()} progress={progress} avatar={avatar} room={room}
        onPlay={(s) => void playSong(s)} onLesson={() => void startLesson()} onBuddy={(k) => setSetting("buddy", k)} onAssess={() => void beginGuided()} onReview={(blob) => openReview(blob, null, "Your take")} />
    );
  else if (tab === "songs")
    body = (
      <GameScreen engine={engine} tracker={tracker} coach={coach} synth={synth.current} calibrated={cal ? { low: cal.low, high: cal.high, comfort: cal.comfort } : null} avatar={avatar} room={room}
        progress={progress} onProgress={setProgress} autoplay={autoplay} onAutoplayed={() => setAutoplay(null)} onFocus={setFocus}
        onReview={(blob, targets, title) => openReview(blob, targets, title)} lesson={lesson} onLessonDone={() => { setLesson(null); go("sing"); }}
        onTrack={(t, mode) => { if (!micReady) void startMic().then((ok) => ok && setTrackPlay({ track: t, mode })); else setTrackPlay({ track: t, mode }); }}
        onPractice={(s) => { if (!micReady) void startMic().then((ok) => ok && setPractice(s)); else setPractice(s); }} />
    );
  else if (tab === "review")
    body = (
      <main className="page">
        <div className="page-head"><h1>Review</h1></div>
        <section className="card" style={{ display: "grid", gap: "0.8rem", justifyItems: "start" }}>
          <p className="fine">Every note coloured by accuracy, with volume as thickness. Zoom right in.</p>
          <div className="actions">
            {review && <button className="primary" onClick={() => setReviewOpen(true)}>Open last take</button>}
            <button className={review ? "" : "primary"} onClick={() => go("sing")}>Record a take</button>
            <label className="button">
              Open a recording
              <input type="file" accept="audio/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) openReview(file, null, file.name); e.target.value = ""; }} />
            </label>
          </div>
        </section>
      </main>
    );
  else
    body = <You progress={progress} cal={cal} priorities={priorities} onAssess={() => void beginGuided()} onSettings={() => setSettingsOpen(true)} onAdopt={(p) => setProgress(p)} />;

  const focused = focus || studio !== "off" || !!trackPlay || !!practice;
  const stars = Object.values(progress.best).reduce((s, b) => s + b.stars, 0);
  if (reviewOpen && review) {
    return (
      <>
        <TakeReview blob={review.blob} targets={review.targets} title={review.title} onClose={() => setReviewOpen(false)} />
        <div className="shell" data-focus={focused} hidden>{body}</div>
      </>
    );
  }
  return (
    <div className="shell" data-focus={focused}>
      {!focused && (
        <header className="topnav">
          <span className="brand"><i />Vocal Coach</span>
          <nav className="tabs-nav" aria-label="Sections">
            {TABS.map((t) => <button key={t.id} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>{t.label}</button>)}
          </nav>
          <div className="status-pills">
            <span className="pill gold"><Star size={14} strokeWidth={2.5} /> {stars}</span>
            <span className="pill peach"><Sparkles size={14} strokeWidth={2.5} /> {progress.xp} XP</span>
          </div>
        </header>
      )}
      <div className="screen">{body}</div>
      {!focused && (
        <nav className="bottomnav" aria-label="Sections">
          {TABS.map((t) => <button key={t.id} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}><t.icon size={22} strokeWidth={tab === t.id ? 2.4 : 1.8} /><span>{t.label}</span></button>)}
        </nav>
      )}
      {settingsOpen && <SettingsSheet settings={progress.settings} calibrated={!!cal} onChange={setSetting} onClose={() => setSettingsOpen(false)} />}
    </div>
  );

  function renderReport() {
    const vt = cal ? guessVoiceType(cal.low, cal.high) : null;
    return (
      <main className="report">
        {cal && vt && <RangeCompare low={cal.low} high={cal.high} />}
        <section>
          <h2>Pitch</h2>
          <table>
            <thead><tr><th>Exercise</th><th>In tune</th><th>Average miss</th><th>Tendency</th></tr></thead>
            <tbody>
              {scores.map((x) => (
                <tr key={x.id}>
                  <td>{x.id === "hold" ? "Held note" : x.id === "song" ? "Happy Birthday" : "Scale"}</td>
                  <td>{Number.isNaN(x.meanAbsCents) ? "" : `${Math.round(x.pctInTune)}%`}</td>
                  <td>{Number.isNaN(x.meanAbsCents) ? "not sung" : x.meanAbsCents < 15 ? "tiny" : x.meanAbsCents < 35 ? "small" : "large"}</td>
                  <td>{Number.isNaN(x.biasCents) ? "" : Math.abs(x.biasCents) < 10 ? "centred" : x.biasCents < 0 ? "under" : "over"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h2>Practise this</h2>
          <ol className="priorities">
            {(priorities ?? []).map((p) => (
              <li key={p.title}>
                <h3>{p.title}</h3>
                <p className="evidence">{p.evidence}</p>
                <p>{p.drill}</p>
              </li>
            ))}
          </ol>
        </section>
        <div className="actions">
          <button className="primary" onClick={() => { leaveStudio(); setTab("songs"); }}>Play songs in my range</button>
          <button className="ghost" onClick={leaveStudio}>Done</button>
        </div>
      </main>
    );
  }

  function renderStudio() {
    const guidedCopy: Record<StepId, { title: string; body: string }> = {
      mic: {
        title: !mic.measured ? "Stay quiet for two seconds" : mic.levelOk ? "Microphone set" : "Now sing a loud “hey”",
        body: !mic.measured ? "Measuring the room." : mic.clipping ? "That was loud enough to distort. Move back a little." : mic.levelOk ? "Level looks good." : "Use the volume you would sing at.",
      },
      "range-low": { title: "Slide down to your lowest note", body: "On “ah”, glide slowly down. Hold the lowest note that still sounds like singing." },
      "range-high": { title: "Slide up to your highest note", body: "Let your voice go light and thin if it wants to. Stop before it hurts." },
      hold: { title: "Hold one note", body: "Match the guide tone on “ah” and hold it steady. It fills as you hold." },
      song: { title: "Happy Birthday", body: "At your own pace. Each note waits until you sing it, then the next one comes." },
      scale: { title: "Five-note scale", body: "Up five notes and back, three times. Go as slowly as you like." },
    };
    const isExercise = step === "hold" || step === "song" || step === "scale";
    const copy = guidedCopy[step];
    return (
      <main className="studio">
        <header className="topbar">
          <button className="link" onClick={leaveStudio}>← Back</button>
          <ol className="rail">
            {STEPS.map((st, i) => <li key={st.id} data-state={i < stepIndex ? "done" : i === stepIndex ? "now" : "todo"}>{st.label}</li>)}
          </ol>
        </header>

        <section className="stage">
          <div className="brief">
            <h1>{copy.title}</h1>
            <p>{copy.body}</p>
          </div>
          {isExercise ? <GameCanvas view={gameView} /> : <PitchCanvas view={view} />}
          <TipCard tip={tip} fallback={phase === "running" ? "Listening…" : "Tips appear here while you sing."} />
          <div className="controls">
            {step === "mic" && <button className="primary" disabled={!mic.levelOk} onClick={() => goToStep(1)}>Continue</button>}
            {(step === "range-low" || step === "range-high") && (
              <>
                <button className="primary" disabled={!rangeOk} onClick={() => goToStep(stepIndex + 1)}>
                  {step === "range-low" ? (Number.isFinite(range.low) ? `${noteName(range.low)} is my lowest` : "Waiting for a note") : Number.isFinite(range.high) ? `${noteName(range.high)} is my highest` : "Waiting for a note"}
                </button>
                <button onClick={() => { const s = S.current; if (step === "range-low") { s.low = Infinity; setRange((r) => ({ ...r, low: Infinity })); } else { s.high = -Infinity; setRange((r) => ({ ...r, high: -Infinity })); } }}>Measure again</button>
              </>
            )}
            {isExercise && phase === "ready" && (
              <>
                <button className="primary" onClick={startTake}>Start singing</button>
                <button onClick={listen}>Hear it first</button>
                <label className="check"><input type="checkbox" checked={headphones} onChange={(e) => setHeadphones(e.target.checked)} /> Headphones on</label>
              </>
            )}
            {isExercise && phase === "running" && <button onClick={() => void finishTake()}>Finish early</button>}
            {isExercise && phase === "done" && (
              <>
                <p className="result">
                  {score && !Number.isNaN(score.meanAbsCents)
                    ? `${Math.round(score.pctInTune)}% on the note${Math.abs(score.biasCents) >= 10 ? `, mostly ${score.biasCents < 0 ? "under it" : "over it"}` : ""}.`
                    : "No singing was picked up. Check the microphone and try again."}
                </p>
                {takeUrl && <Player src={takeUrl} label="Listen back to your take" />}
                <button className="primary" onClick={() => goToStep(stepIndex + 1)}>{stepIndex === STEPS.length - 1 ? "See my report" : "Next"}</button>
                <button onClick={startTake}>Try again</button>
              </>
            )}
          </div>
        </section>

        <aside className="side">
          <BuddyPanel className="studio" state={avatar} kind={progress.settings.buddy} onSwap={(k) => setSetting("buddy", k)} />
          <NoteReadout r={readout} />
          <Meters r={readout} />
          <RangeBar low={cal?.low ?? range.low} high={cal?.high ?? range.high} current={readout.voiced ? readout.midi : null} />
        </aside>
      </main>
    );
  }
}
