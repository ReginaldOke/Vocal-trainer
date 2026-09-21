import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioEngine } from "../audio/engine";
import type { Tracker } from "../audio/analysis";
import type { Frame } from "../audio/frame";
import type { GuideSynth } from "../audio/synth";
import { Backing } from "../audio/backing";
import { BuddyVoice } from "../audio/buddyVoice";
import { midiToHz, noteName } from "../audio/pitch";
import { Coach, foldedCents, type Tip } from "../coach/rules";
import { SONGS, chooseTonic, loadCustomSongs, prepareSong, saveCustomSongs, songSpan, type Song } from "../game/songs";
import { songFromMidi } from "../game/midi";
import { GameRun, difficultyById, type PhraseReport, type RunSummary } from "../game/scoring";
import { bestForSong, levelFromXp, recordRun, saveProgress, unlockLive, type Progress, type RecordOutcome, type Settings } from "../game/progress";
import { GameCanvas, type GameView } from "./GameCanvas";
import { SingerAvatar, type AvatarState } from "./SingerAvatar";
import { SettingsSheet } from "./SettingsSheet";
import { SONG_ART } from "./songArt";
import { offWords } from "../coach/words";
import { GlideRun } from "../game/glide";
import { backingFade, type LessonPlan, type LessonStep } from "../game/lesson";

export interface ReviewTarget {
  midi: number;
  /** seconds from the start of the recorded clip */
  start: number;
  end: number;
  lyric: string | null;
}

interface Props {
  engine: AudioEngine;
  tracker: Tracker;
  coach: Coach;
  synth: GuideSynth | null;
  calibrated: { low: number; high: number; comfort?: number } | null;
  avatar: React.MutableRefObject<AvatarState>;
  room: React.MutableRefObject<{ gate: number; noise: number }>;
  progress: Progress;
  onProgress: (p: Progress) => void;
  /** a song to start straight away (from the Sing tab) */
  autoplay: Song | null;
  onAutoplayed: () => void;
  /** play and results take the whole screen */
  onFocus: (focused: boolean) => void;
  onReview: (blob: Blob, targets: ReviewTarget[], title: string) => void;
  /** a lesson to run step by step, instead of the song list */
  lesson: LessonPlan | null;
  onLessonDone: () => void;
}

type Phase = "select" | "play" | "results" | "glide" | "between" | "lesson-done";
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** A word about the phrase that just ended, when the coach had nothing more pressing to say. */
function phraseTip(r: PhraseReport, t: number): Tip | null {
  if (r.breaths > 0) return { id: "phrase-breath", tone: "info", t, text: r.breaths === 1 ? "That phrase took two breaths. Plan one at the start and make it last." : "Lots of breaths in that phrase. Take a bigger one at the start and spend it slowly." };
  if (r.ending === "sagged") return { id: "phrase-sag", tone: "warn", t, text: "The last note dropped as the air ran out. Think up on the final note and finish it while it is still strong." };
  if (r.ending === "faded") return { id: "phrase-fade", tone: "info", t, text: "The phrase faded at the end. Keep the ribs wide right to the last note." };
  if (r.onset === "hard") return { id: "phrase-hard", tone: "info", t, text: "That phrase started with a click. Begin on the breath, as if the vowel had an h in front." };
  if (r.onset === "breathy") return { id: "phrase-breathy", tone: "info", t, text: "That start was breathy. Bring the sound in a little sooner with a gentle m." };
  if (r.evennessDb > 5) return { id: "phrase-even", tone: "info", t, text: "The volume swung about in that phrase. Aim for one even stream of air." };
  return { id: "phrase-good", tone: "good", t, text: "One breath, steady, and held to the end. That is how a phrase should feel." };
}

const Stars = ({ n, size = "" }: { n: number; size?: string }) => (
  <span className={`stars ${size}`} aria-label={`${n} of 5 stars`}>{[1, 2, 3, 4, 5].map((i) => <span key={i} data-on={i <= n}>★</span>)}</span>
);

export function GameScreen({ engine, tracker, coach, synth, calibrated, avatar, room, progress, onProgress, autoplay, onAutoplayed, onFocus, onReview, lesson, onLessonDone }: Props) {
  const [phase, setPhase] = useState<Phase>("select");
  const [song, setSong] = useState<Song | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [outcome, setOutcome] = useState<RecordOutcome | null>(null);
  const [take, setTake] = useState<{ blob: Blob; targets: ReviewTarget[] } | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<"song" | "drill" | "ear">("song");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [custom, setCustom] = useState<Song[]>(() => loadCustomSongs());
  const [stepIndex, setStepIndex] = useState(0);
  const [stepResult, setStepResult] = useState<{ title: string; line: string; stars: number } | null>(null);
  const [clock, setClock] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);

  const importMidi = async (file: File) => {
    setImportError(null);
    try {
      const song = songFromMidi(await file.arrayBuffer(), file.name);
      const next = [...custom, song];
      setCustom(next);
      saveCustomSongs(next);
      setToast(`Added ${song.title}`);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "That file could not be read.");
    }
  };
  const removeCustom = (id: string) => {
    const next = custom.filter((s) => s.id !== id);
    setCustom(next);
    saveCustomSongs(next);
  };

  const G = useRef({
    run: null as GameRun | null,
    backing: null as Backing | null,
    buddy: null as BuddyVoice | null,
    progress,
    quietFor: 0,
    lastT: 0,
    recStart: 0,
    tipAt: 0,
    lastUi: 0,
    finishing: false,
    /** the most important coaching remark since the last phrase ended; shown when the phrase does */
    pending: null as Tip | null,
    glide: null as GlideRun | null,
    earKey: -2,
    lessonStart: 0,
    inLesson: false,
    fade: 1,
  });
  G.current.progress = progress;
  const view = useRef<GameView>({ run: null, now: () => engine.now(), effects: [], free: [] });
  const settings = progress.settings;

  useEffect(() => { onFocus(phase !== "select"); }, [phase, onFocus]);

  const applyBuddyVoice = useCallback((on: boolean) => {
    const g = G.current;
    if (!engine.ctx) return;
    if (on) { g.buddy ??= new BuddyVoice(engine.ctx); g.buddy.start(); }
    else g.buddy?.stop();
  }, [engine]);

  const setSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const next = { ...G.current.progress, settings: { ...G.current.progress.settings, [key]: value } };
    G.current.progress = next;
    saveProgress(next);
    onProgress(next);
    if (key === "guide" && G.current.backing) G.current.backing.setMode(value as Settings["guide"]);
    if (key === "backing" && G.current.backing) G.current.backing.setStyle(value as Settings["backing"]);
    if (key === "buddyVoice") applyBuddyVoice(!!value);
  };

  const finish = useCallback(async () => {
    const g = G.current;
    const run = g.run;
    if (!run || g.finishing) return;
    g.finishing = true;
    g.run = null;
    g.backing?.setTarget(null);
    g.buddy?.stop();
    synth?.stop();
    const s = run.summary();
    const out = recordRun(g.progress, s, SONGS.filter((x) => x.kind === "drill").map((x) => x.id), g.inLesson ? "lesson" : undefined);
    setSummary(s);
    setOutcome(out);
    onProgress({ ...g.progress });
    setTip(null);
    if (g.inLesson) {
      setStepResult({ title: run.song.song.title, line: s.stars ? `${Math.round(s.accuracy * 100)}% on the note, ${s.maxCombo} in a row` : "Nothing was picked up that time", stars: s.stars });
      setPhase("between");
    } else setPhase("results");
    const blob = await engine.stopRecording();
    if (blob) {
      const targets = run.notes.filter((n) => n.onAt >= 0).map((n) => ({ midi: n.midi, start: (n.sungAt >= 0 ? n.sungAt : n.onAt) - g.recStart, end: (n.offAt >= 0 ? n.offAt : n.onAt + 0.5) - g.recStart, lyric: n.lyric }));
      setTake({ blob, targets });
    }
    g.finishing = false;
  }, [engine, synth, onProgress]);

  useEffect(() => {
    return engine.onFrame((raw) => {
      const g = G.current;
      const now = raw.t;
      const dt = g.lastT ? Math.min(0.1, now - g.lastT) : 0;
      g.lastT = now;
      const { gate, noise } = room.current;

      const run = g.run;
      const a = avatar.current;
      a.voiced = raw.voiced; a.midi = raw.midi; a.db = raw.db; a.h1h2 = raw.h1h2; a.f1 = raw.f1; a.f2 = raw.f2; a.floorDb = noise;
      a.q = run && !run.finished ? run.liveQ : 0;
      a.fever = !!run && run.fever.active;
      if (g.inLesson && now - g.lastUi > 0.5) setClock(now - g.lessonStart);
      const gl = g.glide;
      if (gl && !gl.finished) {
        gl.update(raw, now);
        a.q = raw.voiced ? 0.7 : 0;
        if (gl.finished) {
          const sm = gl.summary();
          setStepResult({ title: lessonStepTitle(), line: `${Math.round(sm.smoothness * 100)}% smooth, ${Math.round(sm.coverage * 100)}% of the range`, stars: sm.smoothness > 0.85 ? 3 : sm.smoothness > 0.6 ? 2 : 1 });
          setPhase("between");
        }
        return;
      }
      if (g.buddy?.running) g.buddy.update(raw.voiced, raw.voiced ? midiToHz(raw.midi) : 0, Math.max(0, Math.min(1, (raw.db - noise) / (-8 - noise))), Math.max(0, Math.min(1, (12 - raw.h1h2) / 14)));
      if (!run || run.finished) { a.strain = 0; return; }

      let f: Frame = raw;
      const backing = g.backing;
      if (backing && backing.audible() && f.voiced && f.db < gate + 5) {
        // Something faint, on a pitch the speakers are playing, is the backing leaking into the mic.
        if (backing.tones().some((m) => Math.abs(foldedCents(f.midi, m)) < 25)) { f = { ...raw, voiced: false, midi: NaN }; backing.bleed(); }
      }
      if (backing) {
        backing.tick(f.voiced);
        if (!f.voiced && f.db < gate - 3) { g.quietFor += dt; if (g.quietFor > 1.2) { backing.relax(); g.quietFor = 0.6; } }
        else g.quietFor = 0;
      }

      const live = tracker.push(f);
      const tevents = tracker.events;
      tracker.events = [];
      a.strain = live.strain;
      run.update(f, now);
      const ear = run.song.song.ear;
      if (ear) {
        // Ear training: one cue when the note arrives, then silence while the singer answers.
        const key = run.target ? run.target.i : -1;
        if (key !== g.earKey) {
          g.earKey = key;
          if (run.target && backing) backing.cue(ear === "silent" ? null : ear === "interval" ? run.target.midi - (run.song.song.earInterval ?? 7) : run.target.midi);
        }
      } else backing?.setTarget(run.target ? run.target.midi : run.countIn(now) > 0 ? run.notes[0].midi : null, run.target ? run.target.i : "count-in");

      const target = run.target;
      const next = coach.update(live, tevents, target ? target.midi : null, target ? now - target.onAt : 0, noise);
      // Nobody can read while singing: keep the best remark and show it when the phrase ends.
      const rank = { alert: 0, warn: 1, info: 2, good: 3 } as const;
      if (next && (next.tone === "alert" || !g.pending || rank[next.tone] < rank[g.pending.tone])) g.pending = next;
      if (next?.tone === "alert") { g.tipAt = now; setTip(next); g.pending = null; }

      for (const e of run.events) {
        view.current.effects.push(e);
        if (e.type === "fever-start") { const un = unlockLive(g.progress, "fever"); if (un) setToast(`Badge: ${un.title}`); }
        if (e.type === "phrase") {
          const r = e.report;
          const say = g.pending ?? phraseTip(r, now);
          if (say) { g.tipAt = now; setTip(say); }
          g.pending = null;
        }
      }
      run.events = [];
      if (now - g.lastUi > 0.1) { g.lastUi = now; if (now - g.tipAt > 6) setTip(null); }
      if (run.finished) void finish();
    });
  }, [engine, tracker, coach, finish, avatar, room]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => () => { G.current.backing?.stop(); G.current.buddy?.stop(); synth?.stop(); }, [synth]);

  const lessonStepTitle = () => lesson?.steps[stepIndex]?.title ?? "";

  const play = useCallback((s: Song) => {
    const g = G.current;
    const st = g.progress.settings;
    const tonic = chooseTonic(s, st.voice, calibrated, st.transpose);
    const prepared = prepareSong(s, tonic);
    const now = engine.now();
    const run = new GameRun(prepared, difficultyById(st.difficulty), st.mode, now);
    g.run = run;
    view.current.run = run;
    view.current.effects = [];
    coach.reset();
    tracker.reset();
    synth?.stop();
    if (engine.ctx) {
      g.backing ??= new Backing(engine.ctx);
      g.backing.start();
      g.backing.setKey(prepared.tonic + (s.keyOffset ?? 0), s.mode === "minor" || s.id === "minor" ? "minor" : "major");
      g.backing.setStyle(st.backing);
      g.fade = backingFade(g.progress, s.id);
      g.backing.setFade(g.fade);
      // With headphones in tempo mode the whole melody plays; piano chords still fit under it.
      g.backing.setMode(st.mode === "tempo" && st.guide === "full" && st.backing === "tone" ? "off" : st.guide);
      if (st.mode === "tempo" && synth) {
        const ctxStart = engine.ctx.currentTime;
        if (st.metronome) synth.clickTrack(ctxStart, prepared.beat, s.beatsPerBar, 0, prepared.end);
        if (st.guide === "full") synth.playSequence(prepared.notes.map((n) => ({ midi: n.midi, start: n.start, dur: n.dur })), ctxStart);
      }
    }
    applyBuddyVoice(st.buddyVoice);
    if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __backing: g.backing, __run: run, __recStart: now });
    g.recStart = engine.startRecording() ?? now;
    g.earKey = -2;
    setSong(s);
    setSummary(null);
    setOutcome(null);
    setTake(null);
    setTip(null);
    setPhase("play");
  }, [engine, tracker, coach, synth, calibrated, applyBuddyVoice]);

  const startStep = useCallback((i: number) => {
    if (!lesson) return;
    const g = G.current;
    const step: LessonStep | undefined = lesson.steps[i];
    setStepIndex(i);
    setStepResult(null);
    if (!step) {
      g.inLesson = false;
      g.progress.lessons.push(Date.now());
      g.progress.xp += 100;
      saveProgress(g.progress);
      onProgress({ ...g.progress });
      setPhase("lesson-done");
      return;
    }
    if (step.kind === "glide") {
      g.run = null;
      view.current.run = null;
      g.glide = new GlideRun(step.glide, engine.now());
      view.current.glide = g.glide;
      g.backing?.setTarget(null);
      setPhase("glide");
    } else {
      g.glide = null;
      view.current.glide = null;
      play(step.song);
    }
  }, [lesson, engine, play, onProgress]);

  useEffect(() => {
    if (!lesson) return;
    const g = G.current;
    g.inLesson = true;
    g.lessonStart = engine.now();
    setClock(0);
    startStep(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson]);

  useEffect(() => {
    if (autoplay) { play(autoplay); onAutoplayed(); }
  }, [autoplay, play, onAutoplayed]);

  const quit = () => {
    const g = G.current;
    g.run = null;
    view.current.run = null;
    g.glide = null;
    view.current.glide = null;
    if (g.inLesson) { g.inLesson = false; setPhase("select"); onLessonDone(); return; }
    g.backing?.setTarget(null);
    g.buddy?.stop();
    synth?.stop();
    void engine.stopRecording();
    setTip(null);
    setPhase("select");
  };

  const section = lesson ? [...lesson.sections].reverse().find((sec) => sec.at <= stepIndex)?.title : null;
  const lessonBar = lesson ? <span className="pill">{fmtClock(clock)} · {section}</span> : null;

  if (phase === "glide" && lesson) {
    const step = lesson.steps[stepIndex];
    return (
      <main className="arcade-play">
        <div className="play-bar">
          <strong>{step.title}</strong>
          {lessonBar}
          <button className="small" onClick={() => { G.current.glide = null; view.current.glide = null; startStep(stepIndex + 1); }}>Skip</button>
        </div>
        <div className="stage-wrap">
          <GameCanvas view={view} />
          <div className="tip-toast" data-tone="info"><span className="tip-mark" />{step.instruction}</div>
          <aside className="buddy-panel">
            <SingerAvatar state={avatar} />
            <div className="buddy-plate">Pip</div>
          </aside>
        </div>
      </main>
    );
  }

  if (phase === "between" && lesson && stepResult) {
    const next = lesson.steps[stepIndex + 1];
    return (
      <main className="page lesson-between">
        <p className="eyebrow">{section} · {fmtClock(clock)}</p>
        <h1>{stepResult.title}</h1>
        <p className="stars big" aria-label={`${stepResult.stars} stars`}>{[1, 2, 3].map((i) => <span key={i} data-on={i <= stepResult.stars}>★</span>)}</p>
        <p className="fine">{stepResult.line}</p>
        {tip && <div className="tip" data-tone={tip.tone}><span className="tip-mark" /><p>{tip.text}</p></div>}
        <div className="actions">
          <button className="primary big" onClick={() => startStep(stepIndex + 1)}>{next ? `Next: ${next.title}` : "Finish lesson"}</button>
          <button className="ghost" onClick={quit}>Stop here</button>
        </div>
      </main>
    );
  }

  if (phase === "lesson-done" && lesson) {
    return (
      <main className="page lesson-between">
        <p className="eyebrow">Lesson done</p>
        <h1>That's today's singing</h1>
        <p className="fine">{fmtClock(clock)} of focused work on {lesson.focus.toLowerCase()}. Rest the voice, drink some water, and come back tomorrow.</p>
        <p className="badges"><span className="badge gold">+100 XP</span><span className="badge">{progress.lessons.length} lessons</span></p>
        <div className="actions">
          <button className="primary big" onClick={() => { setPhase("select"); onLessonDone(); }}>Done</button>
        </div>
      </main>
    );
  }

  if (phase === "play" && song) {
    const step = lesson?.steps[stepIndex];
    return (
      <main className="arcade-play">
        <div className="play-bar">
          <strong>{song.title}</strong>
          {lessonBar ?? <span>{difficultyById(settings.difficulty).label}</span>}
          {G.current.fade < 1 && <span className="pill teal">{G.current.fade === 0 ? "From memory" : `Backing ${Math.round(G.current.fade * 100)}%`}</span>}
          <button className="small" onClick={quit}>Quit</button>
        </div>
        <div className="stage-wrap">
          <GameCanvas view={view} />
          {tip ? <div className="tip-toast" data-tone={tip.tone} role="status"><span className="tip-mark" />{tip.text}</div>
            : step && step.kind === "song" && <div className="tip-toast" data-tone="info"><span className="tip-mark" />{step.instruction}</div>}
          <aside className="buddy-panel">
            <SingerAvatar state={avatar} />
            <div className="buddy-plate">Pip</div>
          </aside>
        </div>
        {toast && <div className="toast" role="status">{toast}</div>}
      </main>
    );
  }

  if (phase === "results" && song && summary && outcome) {
    const best = progress.best[`${song.id}:${summary.difficulty}`];
    const lvl = levelFromXp(progress.xp);
    const bias = summary.biasCents;
    const notes: string[] = [];
    if (summary.stars === 0) notes.push("No singing was picked up. Sing out at a confident, speech-level volume.");
    else if (Math.abs(bias) >= 15) notes.push(bias < 0 ? `You tended to sit under the note. Think of placing each note from above.` : `You tended to push over the note. Ease the volume a touch.`);
    else if (summary.counts.miss >= summary.notes.length * 0.3) notes.push("A few notes got away. Try Easy, or turn the guide tone up.");
    else if (summary.stars >= 4 && settings.difficulty !== "pro") notes.push(`Clean. Try ${settings.difficulty === "easy" ? "Medium" : settings.difficulty === "medium" ? "Hard" : "Pro"} next.`);
    else notes.push("Centred and relaxed. Keep that feeling.");
    const ph = summary.phrases;
    const oneBreath = ph.filter((p) => p.breaths === 0).length;
    const hard = ph.filter((p) => p.onset === "hard").length, breathy = ph.filter((p) => p.onset === "breathy").length;
    const held = ph.filter((p) => p.ending === "held").length, faded = ph.filter((p) => p.ending === "faded").length, sagged = ph.filter((p) => p.ending === "sagged").length;
    const evenness = ph.length ? [...ph.map((p) => p.evennessDb)].sort((a, b) => a - b)[ph.length >> 1] : NaN;
    if (summary.vowels) notes.push(summary.vowels.matched === summary.vowels.total ? "Every vowel read as the one asked for. The shapes are clear." : `${summary.vowels.matched} of ${summary.vowels.total} vowels read as the one asked for. Exaggerate the shape: a tall “ah”, a smile for “ee”, a small round “oo”.`);
    if (G.current.fade === 0) notes.push("That was from memory, with no backing at all. Your inner ear is doing the work now.");
    else if (G.current.fade < 1) notes.push(`The backing was turned down to ${Math.round(G.current.fade * 100)}% because you have sung this cleanly before. It fades further as you go.`);
    if (summary.octaves > 0) notes.push(summary.octaves === 1 ? "One note was the right note an octave away. Listen for how high or low the tune sits before you start." : `${summary.octaves} notes were the right notes an octave away. Listen for how high the tune sits before you start.`);
    if (ph.length >= 2 && oneBreath / ph.length < 0.6) notes.push("Most phrases took more than one breath. Take a fuller breath at each phrase start and spend it slowly.");
    else if (hard >= 2) notes.push("Several phrases started with a click. Begin on the breath, as if the vowel had an h in front.");
    else if (breathy >= 2) notes.push("Several starts were breathy. Bring the sound in sooner with a gentle m.");
    else if (sagged >= 2) notes.push("Phrase endings dropped in pitch. Think up on the final note and finish while the sound is still strong.");
    else if (faded >= 2) notes.push("Phrase endings faded. Keep the ribs wide right to the last note.");
    const trouble = summary.notes.filter((n) => n.judged === "miss" || n.judged === "good").slice(0, 4);
    const i = SONGS.indexOf(song);
    const nextUp = SONGS[(i + 1) % SONGS.length];

    return (
      <main className="page">
        <header className="results-head">
          <p className="eyebrow">{song.title} · {difficultyById(summary.difficulty).label}</p>
          <Stars n={summary.stars} size="big" />
          <h1>{summary.score.toLocaleString()}</h1>
          <p className="badges">
            {outcome.newBest && <span className="badge gold">New record</span>}
            {summary.fullCombo && summary.notes.length >= 8 && <span className="badge">Full combo</span>}
            {best && !outcome.newBest && <span className="badge dim">Best {best.score.toLocaleString()}</span>}
            <span className="badge">+{outcome.xpGained} XP</span>
          </p>
        </header>

        <section className="results-grid">
          <div className="stat"><span>Accuracy</span><strong>{Math.round(summary.accuracy * 100)}%</strong></div>
          <div className="stat"><span>Combo</span><strong>{summary.maxCombo}</strong></div>
          <div className="stat"><span>Perfect</span><strong className="c-perfect">{summary.counts.perfect}</strong></div>
          <div className="stat"><span>Great</span><strong className="c-great">{summary.counts.great}</strong></div>
          <div className="stat"><span>Good</span><strong className="c-good">{summary.counts.good}</strong></div>
          <div className="stat"><span>Miss</span><strong className="c-miss">{summary.counts.miss}</strong></div>
          {summary.vowels && <div className="stat"><span>Vowels</span><strong className={summary.vowels.matched === summary.vowels.total ? "c-great" : ""}>{summary.vowels.matched}/{summary.vowels.total}</strong></div>}
        </section>

        <section className="note-strip" aria-label="Note by note">
          {summary.notes.map((n, k) => (
            <span key={k} className="note-chip" data-j={n.judged} title={`${n.lyric ?? noteName(n.midi)}: ${n.judged}, ${offWords(n.cents)}`} style={{ height: `${30 + n.quality * 70}%` }} />
          ))}
        </section>

        <section className="card">
          <div className="meter-head"><span>Level {lvl.level}</span><span>{outcome.levelAfter > outcome.levelBefore ? "Level up!" : `${lvl.need - lvl.into} XP to go`}</span></div>
          <div className="xpbar"><div style={{ width: `${(lvl.into / lvl.need) * 100}%` }} /></div>
          {outcome.unlocked.length > 0 && <ul className="unlocks">{outcome.unlocked.map((a) => <li key={a.id}><strong>{a.title}</strong> {a.blurb}</li>)}</ul>}
        </section>

        {ph.length > 0 && (
          <section className="results-grid" aria-label="Breath and tone">
            <div className="stat"><span>One breath</span><strong className={oneBreath === ph.length ? "c-great" : ""}>{oneBreath}/{ph.length}</strong></div>
            <div className="stat"><span>Starts</span><strong>{hard ? `${hard} hard` : breathy ? `${breathy} breathy` : "clean"}</strong></div>
            <div className="stat"><span>Level</span><strong className={evenness <= 3 ? "c-great" : evenness > 5 ? "c-miss" : ""}>{evenness <= 3 ? "steady" : evenness > 5 ? "uneven" : "fair"}</strong></div>
            <div className="stat"><span>Endings</span><strong className={held === ph.length ? "c-great" : ""}>{held}/{ph.length} held</strong></div>
          </section>
        )}

        <section className="card coach-notes">
          <h2>Pip's note</h2>
          <ul>{notes.map((t) => <li key={t}>{t}</li>)}</ul>
          {trouble.length > 0 && (
            <p className="fine" style={{ marginTop: "0.5rem" }}>
              Work on: {trouble.map((n) => `${n.lyric?.replace(/-$/, "") || noteName(n.midi)} (${noteName(n.midi)}, ${offWords(n.cents)})`).join(", ")}.
            </p>
          )}
        </section>

        <div className="actions">
          <button className="primary" onClick={() => play(song)}>Play again</button>
          <button onClick={() => play(nextUp)}>Next: {nextUp.title}</button>
          {take && <button onClick={() => onReview(take.blob, take.targets, song.title)}>Review take</button>}
          <button className="ghost" onClick={() => setPhase("select")}>All songs</button>
        </div>
      </main>
    );
  }

  const list = [...SONGS, ...custom].filter((s) => s.kind === tab);
  return (
    <main className="page">
      <div className="page-head">
        <h1>{tab === "song" ? "Songs" : tab === "drill" ? "Drills" : "Ear"}</h1>
        <div className="actions">
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={tab === "song"} onClick={() => setTab("song")}>Songs</button>
            <button role="tab" aria-selected={tab === "drill"} onClick={() => setTab("drill")}>Drills</button>
            <button role="tab" aria-selected={tab === "ear"} onClick={() => setTab("ear")}>Ear</button>
          </div>
          <button className="small" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </div>

      {tab === "song" && (
        <div className="import-row">
          <label className="button small">
            Add a song from MIDI
            <input type="file" accept=".mid,.midi,.kar,audio/midi" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importMidi(f); e.target.value = ""; }} />
          </label>
          <span className="fine">Any tune you have as a .mid file. It stays on this device.</span>
          {importError && <span className="error">{importError}</span>}
        </div>
      )}

      <section className="song-grid">
        {list.map((s) => {
          const b = bestForSong(progress, s.id);
          const tonic = chooseTonic(s, settings.voice, calibrated, settings.transpose);
          const span = songSpan(s);
          const art = SONG_ART[s.id] ?? { emoji: s.custom ? "🎤" : "🎵", tint: "peach" as const };
          return (
            <div key={s.id} className="song-card-wrap">
              <button className="song-card" onClick={() => play(s)}>
                <span className={`art ${art.tint}`}>{art.emoji}</span>
                <strong>{s.title}</strong>
                <span className="meta"><span className="song-tier" aria-label={`tier ${s.tier}`}>{[1, 2, 3, 4, 5].map((k) => <i key={k} data-on={k <= s.tier} />)}</span>{noteName(tonic + span.lo)}–{noteName(tonic + span.hi)}</span>
                <span className="song-best">{b ? <><Stars n={b.stars} /><em>{b.score.toLocaleString()}</em></> : <em>New</em>}</span>
              </button>
              {s.custom && <button className="song-remove" aria-label={`Remove ${s.title}`} onClick={() => removeCustom(s.id)}>×</button>}
            </div>
          );
        })}
      </section>

      {settingsOpen && <SettingsSheet settings={settings} calibrated={!!calibrated} onChange={setSetting} onClose={() => setSettingsOpen(false)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
