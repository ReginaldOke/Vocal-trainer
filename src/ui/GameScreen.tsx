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
import { GameRun, difficultyById, type RunSummary } from "../game/scoring";
import { bestForSong, levelFromXp, recordRun, saveProgress, unlockLive, type Progress, type RecordOutcome, type Settings } from "../game/progress";
import { GameCanvas, type GameView } from "./GameCanvas";
import { SingerAvatar, type AvatarState } from "./SingerAvatar";
import { SettingsSheet } from "./SettingsSheet";
import { SONG_ART } from "./songArt";

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
  calibrated: { low: number; high: number } | null;
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
}

type Phase = "select" | "play" | "results";

const Stars = ({ n, size = "" }: { n: number; size?: string }) => (
  <span className={`stars ${size}`} aria-label={`${n} of 5 stars`}>{[1, 2, 3, 4, 5].map((i) => <span key={i} data-on={i <= n}>★</span>)}</span>
);

export function GameScreen({ engine, tracker, coach, synth, calibrated, avatar, room, progress, onProgress, autoplay, onAutoplayed, onFocus, onReview }: Props) {
  const [phase, setPhase] = useState<Phase>("select");
  const [song, setSong] = useState<Song | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [outcome, setOutcome] = useState<RecordOutcome | null>(null);
  const [take, setTake] = useState<{ blob: Blob; targets: ReviewTarget[] } | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<"song" | "drill">("song");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [custom, setCustom] = useState<Song[]>(() => loadCustomSongs());
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
    const out = recordRun(g.progress, s, SONGS.filter((x) => x.kind === "drill").map((x) => x.id));
    setSummary(s);
    setOutcome(out);
    onProgress({ ...g.progress });
    setTip(null);
    setPhase("results");
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
      a.voiced = raw.voiced; a.midi = raw.midi; a.db = raw.db; a.h1h2 = raw.h1h2; a.floorDb = noise;
      a.q = run && !run.finished ? run.liveQ : 0;
      a.fever = !!run && run.fever.active;
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
      backing?.setTarget(run.target ? run.target.midi : run.countIn(now) > 0 ? run.notes[0].midi : null, run.target ? run.target.i : "count-in");

      for (const e of run.events) {
        view.current.effects.push(e);
        if (e.type === "fever-start") { const un = unlockLive(g.progress, "fever"); if (un) setToast(`Badge: ${un.title}`); }
      }
      run.events = [];

      const target = run.target;
      const next = coach.update(live, tevents, target ? target.midi : null, target ? now - target.onAt : 0, noise);
      if (next) { g.tipAt = now; setTip(next); }
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
      // With headphones in tempo mode the whole melody plays; piano chords still fit under it.
      g.backing.setMode(st.mode === "tempo" && st.guide === "full" && st.backing === "tone" ? "off" : st.guide);
      if (st.mode === "tempo" && synth) {
        const ctxStart = engine.ctx.currentTime;
        if (st.metronome) synth.clickTrack(ctxStart, prepared.beat, s.beatsPerBar, 0, prepared.end);
        if (st.guide === "full") synth.playSequence(prepared.notes.map((n) => ({ midi: n.midi, start: n.start, dur: n.dur })), ctxStart);
      }
    }
    applyBuddyVoice(st.buddyVoice);
    if (import.meta.env.DEV) (window as unknown as { __backing: unknown }).__backing = g.backing;
    g.recStart = engine.startRecording() ?? now;
    setSong(s);
    setSummary(null);
    setOutcome(null);
    setTake(null);
    setTip(null);
    setPhase("play");
  }, [engine, tracker, coach, synth, calibrated, applyBuddyVoice]);

  useEffect(() => {
    if (autoplay) { play(autoplay); onAutoplayed(); }
  }, [autoplay, play, onAutoplayed]);

  const quit = () => {
    const g = G.current;
    g.run = null;
    view.current.run = null;
    g.backing?.setTarget(null);
    g.buddy?.stop();
    synth?.stop();
    void engine.stopRecording();
    setTip(null);
    setPhase("select");
  };

  if (phase === "play" && song) {
    return (
      <main className="arcade-play">
        <div className="play-bar">
          <strong>{song.title}</strong>
          <span>{difficultyById(settings.difficulty).label}</span>
          <button className="small" onClick={quit}>Quit</button>
        </div>
        <div className="stage-wrap">
          <GameCanvas view={view} />
          {tip && <div className="tip-toast" data-tone={tip.tone} role="status"><span className="tip-mark" />{tip.text}</div>}
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
    else if (Math.abs(bias) >= 15) notes.push(bias < 0 ? `You sat under the note by about ${Math.round(-bias)} cents. Think of placing each note from above.` : `You pushed over the note by about ${Math.round(bias)} cents. Ease the volume a touch.`);
    else if (summary.counts.miss >= summary.notes.length * 0.3) notes.push("A few notes got away. Try Easy, or turn the guide tone up.");
    else if (summary.stars >= 4 && settings.difficulty !== "pro") notes.push(`Clean. Try ${settings.difficulty === "easy" ? "Medium" : settings.difficulty === "medium" ? "Hard" : "Pro"} next.`);
    else notes.push("Centred and relaxed. Keep that feeling.");
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
        </section>

        <section className="note-strip" aria-label="Note by note">
          {summary.notes.map((n, k) => (
            <span key={k} className="note-chip" data-j={n.judged} title={`${n.lyric ?? noteName(n.midi)}: ${n.judged}${Number.isNaN(n.cents) ? "" : `, ${Math.round(n.cents)} cents`}`} style={{ height: `${30 + n.quality * 70}%` }} />
          ))}
        </section>

        <section className="card">
          <div className="meter-head"><span>Level {lvl.level}</span><span>{outcome.levelAfter > outcome.levelBefore ? "Level up!" : `${lvl.need - lvl.into} XP to go`}</span></div>
          <div className="xpbar"><div style={{ width: `${(lvl.into / lvl.need) * 100}%` }} /></div>
          {outcome.unlocked.length > 0 && <ul className="unlocks">{outcome.unlocked.map((a) => <li key={a.id}><strong>{a.title}</strong> {a.blurb}</li>)}</ul>}
        </section>

        <section className="card coach-notes">
          <h2>Pip's note</h2>
          <ul>{notes.map((t) => <li key={t}>{t}</li>)}</ul>
          {trouble.length > 0 && (
            <p className="fine" style={{ marginTop: "0.5rem" }}>
              Work on: {trouble.map((n) => `${n.lyric?.replace(/-$/, "") || noteName(n.midi)} (${noteName(n.midi)}${Number.isNaN(n.cents) ? "" : `, ${Math.abs(Math.round(n.cents))}¢ ${n.cents < 0 ? "flat" : "sharp"}`})`).join(", ")}.
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
        <h1>{tab === "song" ? "Songs" : "Drills"}</h1>
        <div className="actions">
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={tab === "song"} onClick={() => setTab("song")}>Songs</button>
            <button role="tab" aria-selected={tab === "drill"} onClick={() => setTab("drill")}>Drills</button>
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
