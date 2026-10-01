import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Circle, FileMusic, Minus, Music, Plus, Square, Trash2, X } from "lucide-react";
import { Engine, type Frame } from "./audio/engine";
import { noteName } from "./audio/pitch";
import { Sound } from "./audio/sound";
import { GlideRun } from "./glide";
import { songFromMidi } from "./midi";
import { Review } from "./Review";
import { LATENCY, Take } from "./sing";
import { EXERCISES, SONGS, loadCustom, prepare, saveCustom, type Song } from "./songs";
import { Stage, type StageView } from "./Stage";

/** One thing to do: sing a song or exercise along with the piano, or slide the voice like a siren. */
type Step =
  | { kind: "song"; title: string; tip: string; song: Song }
  | { kind: "slide"; title: string; tip: string; down?: boolean; repeats: number };

interface Lesson { id: string; title: string; minutes: number; about: string; steps: Step[] }

const sing = (song: Song, tip: string): Step => ({ kind: "song", title: song.title, tip, song });

const LESSONS: Lesson[] = [
  {
    id: "warm", title: "Warm up", minutes: 3, about: "Wake the voice up gently before anything else.",
    steps: [
      { kind: "slide", title: "Hum a siren", tip: "Lips closed. Slide slowly from the bottom line to the top and back, like a distant siren. Twice.", repeats: 2 },
      { kind: "slide", title: "Lip trill siren", tip: "Let your lips flap like a horse and do the same slide. If the trill stops, you are pushing too hard.", repeats: 2 },
      sing(EXERCISES.ng, "As in “sing”. Quiet and easy, along with the piano."),
    ],
  },
  {
    id: "pitch", title: "Pitch workout", minutes: 10, about: "Short sounds that have to land on the note at once: “ah”, a creaky hum, then “goo”, “koo” and “gug”.",
    steps: [
      sing(EXERCISES.ah, "Tongue out, a short ugly “ah” on each note. Each round is a step higher."),
      sing(EXERCISES.humShort, "Lips closed, short creaky hums. Thumbs under your chin: it should stay soft."),
      sing(EXERCISES.humSmooth, "The same hum with no gaps. Aim at each note like target practice."),
      { kind: "slide", title: "A big “woo!”", tip: "Cheer like your team just scored: start at the top line and let it fall, then come back up. Twice.", down: true, repeats: 2 },
      sing(EXERCISES.goo, "Keep that “woo!” feeling on “goo”. Short, easy notes skipping down."),
      sing(EXERCISES.koo, "Now “koo”. Same shape, same ease."),
      sing(EXERCISES.gug, "“Gug” with a soft g. Never punched."),
    ],
  },
  { id: "long", title: "Long notes", minutes: 2, about: "Hold five notes steady, one breath each.", steps: [sing(EXERCISES.long, "One easy breath, then hold each note steady to the end of its bar.")] },
  {
    id: "ear", title: "Hear it, sing it back", minutes: 3, about: "The piano plays a note, then goes quiet while you sing it.",
    steps: [sing(EXERCISES.echo, "Listen to the note, hear it in your head, then sing it back."), sing(EXERCISES.echoLeap, "Same again with bigger jumps between the notes.")],
  },
];

interface Saved { centre: number; best: Record<string, number> }
const SAVE = "vocal-coach-simple.state";
const loadSaved = (): Saved => { try { return { centre: 60, best: {}, ...JSON.parse(localStorage.getItem(SAVE) ?? "{}") }; } catch { return { centre: 60, best: {} }; } };

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

export function App() {
  const engine = useRef(new Engine()).current;
  const view = useRef<StageView>({ now: () => engine.now(), trace: [], take: null, glide: null });
  const R = useRef({ sound: null as Sound | null, saved: loadSaved(), heard: [] as number[], lastUi: 0, maskUntil: 0, finishing: false, recAt: 0 });

  const [ready, setReady] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [note, setNote] = useState<{ name: string; hint: string; level: number }>({ name: "", hint: "", level: 0 });
  const [sheet, setSheet] = useState<null | "lesson" | "song">(null);
  const [custom, setCustom] = useState<Song[]>(() => loadCustom());
  const [importError, setImportError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [review, setReview] = useState<{ blob: Blob; title: string } | null>(null);
  const [session, setSession] = useState<{ title: string; steps: Step[]; isSong: boolean } | null>(null);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"ready" | "running" | "result">("ready");
  const [result, setResult] = useState<{ stars: number; line: string } | null>(null);
  const [shift, setShift] = useState(0);
  const [slow, setSlow] = useState(false);
  const [tune, setTune] = useState(true);
  const [best, setBest] = useState<Record<string, number>>(() => R.current.saved.best);
  const S = useRef({ session, index, phase, shift, slow, tune });
  S.current = { session, index, phase, shift, slow, tune };

  const persist = () => { try { localStorage.setItem(SAVE, JSON.stringify(R.current.saved)); } catch { /* storage blocked */ } };

  const start = useCallback(async () => {
    if (engine.ready) return true;
    try {
      await engine.start();
      R.current.sound = new Sound(engine.ctx!, engine.out!);
      if (import.meta.env.DEV) Object.assign(window, { __app: { engine, view, R } });
      setReady(true);
      setMicError(null);
      return true;
    } catch {
      setMicError("The microphone is blocked. Allow it for this page in your browser, then try again.");
      return false;
    }
  }, [engine]);

  // ---------------------------------------------------------------- finishing a step
  const finishStep = useCallback(async () => {
    const r = R.current, v = view.current, s = S.current;
    if (r.finishing || s.phase !== "running" || !s.session) return;
    r.finishing = true;
    const step = s.session.steps[s.index];
    let stars = 0, line = "";
    if (v.take) {
      const take = v.take;
      if (take.listenOnly) { v.take = null; r.finishing = false; setPhase("ready"); return; }
      const res = take.result();
      stars = res.stars;
      line = res.sung < 1 ? "No singing came through. Sing out, close to the microphone, and try again." : `${res.landed} of ${res.total} notes landed.`;
      if (step.kind === "song" && s.session.isSong && stars > (r.saved.best[step.song.id] ?? 0)) { r.saved.best[step.song.id] = stars; persist(); setBest({ ...r.saved.best }); }
    } else if (v.glide) {
      const sm = v.glide.summary();
      stars = sm.repeats === 0 ? 0 : sm.smoothness > 0.85 ? 3 : sm.smoothness > 0.6 ? 2 : 1;
      line = sm.repeats === 0 ? "No slide was picked up. Try again a little louder." : `${Math.round(sm.smoothness * 100)}% smooth, reaching ${Math.round(sm.coverage * 100)}% of the way.`;
    }
    v.take = null; v.glide = null;
    r.sound?.hush();
    r.finishing = false;
    setResult({ stars, line });
    setPhase("result");
  }, []);

  // ---------------------------------------------------------------- the ear
  useEffect(() => engine.onFrame((heard: Frame) => {
    const r = R.current, v = view.current;
    let f = heard;
    if (f.t < r.maskUntil) f = { ...f, voiced: false, midi: NaN };
    let q = -1;
    const take = v.take, glide = v.glide;
    if (take) {
      // While the piano plays a note for the singer to hear, the mic is hearing the speakers.
      const sounding = take.noteAt(take.time(f.t) - LATENCY);
      if (take.listenOnly || sounding?.role === "cue") f = { ...f, voiced: false, midi: NaN };
      q = take.push(f, engine.floorDb);
      if (take.done(f.t)) void finishStep();
    } else if (glide) {
      glide.update(f, f.t);
      q = 2; // a slide passes through every pitch on purpose: draw it plain, not judged
      if (glide.finished) void finishStep();
    } else if (f.voiced) {
      // Learn where this voice sits, so songs can be put in a comfortable key.
      r.heard.push(f.midi);
      if (r.heard.length > 900) r.heard.splice(0, 300);
      if (r.heard.length >= 150 && r.heard.length % 60 === 0) { r.saved.centre = Math.round(median(r.heard)); persist(); }
    }
    v.trace.push({ t: f.t, midi: f.midi, db: f.db, voiced: f.voiced, q });
    if (v.trace.length > 900) v.trace.splice(0, 300);
    if (f.t - r.lastUi > 0.1) {
      r.lastUi = f.t;
      const off = f.voiced ? (f.midi - Math.round(f.midi)) * 100 : 0;
      setNote({ name: f.voiced ? noteName(f.midi) : "", hint: !f.voiced ? "" : Math.abs(off) <= 15 ? "on the note" : off < 0 ? "a little under" : "a little over", level: Math.max(0, Math.min(1, (engine.level + 60) / 50)) });
      if (engine.recording) setRecSecs(f.t - r.recAt);
    }
  }), [engine, finishStep]);

  // ---------------------------------------------------------------- running a step
  const startStep = (i: number, listenOnly = false) => {
    const r = R.current, v = view.current, s = S.current;
    const step = s.session?.steps[i];
    const sound = r.sound;
    if (!step || !sound || !engine.ctx) return;
    sound.hush();
    setIndex(i);
    setResult(null);
    v.trace = [];
    const now = engine.now();
    if (step.kind === "song") {
      const p = prepare(step.song, r.saved.centre, s.shift, s.slow ? 0.75 : 1);
      const at = now + 0.15;
      const level = listenOnly ? 1 : s.tune ? 0.55 : 0;
      v.glide = null;
      v.take = new Take(p, at, level, listenOnly);
      // Count-in on the beat, then the tune.
      for (let b = 0; b * p.beat < p.lead - 0.01; b++) sound.click(at + b * p.beat, b % step.song.beatsPerBar === 0);
      for (const n of p.notes) {
        if (n.role === "cue") sound.note(n.midi, at + n.start, n.dur, 1);
        else if (n.role === "both" && level > 0) sound.note(n.midi, at + n.start, n.dur, level);
        else if (n.role === "solo" && listenOnly) sound.note(n.midi, at + n.start, n.dur, 0.6);
      }
    } else {
      const lo = r.saved.centre - 4, hi = r.saved.centre + 4;
      v.take = null;
      v.glide = new GlideRun({ from: lo, to: hi, repeats: step.repeats, direction: step.down ? "down" : "up" }, now);
      // One sliding tone, the shape to copy; the mic ignores it while it plays.
      const len = sound.slide(step.down ? hi : lo, step.down ? lo : hi, engine.ctx.currentTime + 0.1);
      r.maskUntil = now + len + 0.3;
    }
    setPhase("running");
  };

  const stop = () => { const v = view.current; v.take = null; v.glide = null; R.current.sound?.hush(); R.current.maskUntil = 0; setPhase("ready"); };
  const leave = () => { stop(); setSession(null); setResult(null); };
  const open = async (title: string, steps: Step[], isSong: boolean) => {
    if (!(await start())) return;
    setSheet(null);
    setShift(0);
    setIndex(0);
    setResult(null);
    setPhase("ready");
    setSession({ title, steps, isSong });
  };

  // ---------------------------------------------------------------- record
  const toggleRecord = async () => {
    if (!(await start())) return;
    if (engine.recording) {
      const blob = await engine.stopRecording();
      setRecording(false);
      if (blob) setReview({ blob, title: "Your recording" });
    } else if (engine.startRecording()) { R.current.recAt = engine.now(); setRecSecs(0); setRecording(true); }
  };

  const importSong = async (file: File) => {
    setImportError(null);
    try {
      const song = songFromMidi(await file.arrayBuffer(), file.name);
      const next = [song, ...custom];
      setCustom(next);
      saveCustom(next);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "That file could not be read.");
    }
  };
  const removeSong = (id: string) => { const next = custom.filter((s) => s.id !== id); setCustom(next); saveCustom(next); };

  if (review) return <Review blob={review.blob} title={review.title} onClose={() => setReview(null)} />;

  const step = session?.steps[index];
  const stars = (n: number, of = 3) => <span className="stars">{Array.from({ length: of }, (_, i) => <i key={i} data-on={i < n}>★</i>)}</span>;

  return (
    <main className="app">
      <header className="bar">
        {session ? (
          <>
            <button className="icon" onClick={leave} aria-label="Back"><ArrowLeft size={18} /></button>
            <strong>{session.title}</strong>
            {session.steps.length > 1 && <span className="pill">{index + 1} of {session.steps.length}</span>}
          </>
        ) : <strong className="brand">Vocal Coach</strong>}
        <span className="readout" data-on={!!note.name}><b>{note.name || "–"}</b><small>{note.hint}</small></span>
        <span className="meter" aria-hidden="true"><i style={{ width: `${note.level * 100}%` }} /></span>
      </header>

      <section className="stage-wrap">
        <Stage view={view} />

        {!ready && (
          <div className="overlay">
            <div className="card">
              <h1>See your voice</h1>
              <p>Sing anything and watch the line. Green means you are on a note.</p>
              <button className="primary big" onClick={() => void start()}>Start</button>
              {micError && <p className="error">{micError}</p>}
            </div>
          </div>
        )}

        {session && step && phase === "ready" && (
          <div className="overlay">
            <div className="card">
              <h2>{step.title}</h2>
              <p>{step.tip}</p>
              {step.kind === "song" && (
                <div className="opts">
                  <span className="group" role="group" aria-label="Key">
                    <button className="icon" onClick={() => setShift((k) => Math.max(-12, k - 1))} aria-label="Lower"><Minus size={16} /></button>
                    <small>{shift === 0 ? "Key" : shift > 0 ? `+${shift}` : shift}</small>
                    <button className="icon" onClick={() => setShift((k) => Math.min(12, k + 1))} aria-label="Higher"><Plus size={16} /></button>
                  </span>
                  <button className="chip" aria-pressed={slow} onClick={() => setSlow((x) => !x)}>Slow</button>
                  <button className="chip" aria-pressed={tune} onClick={() => setTune((x) => !x)}>Piano plays the tune</button>
                </div>
              )}
              <div className="actions">
                <button className="primary big" onClick={() => startStep(index)}>Sing</button>
                {step.kind === "song" && <button className="big" onClick={() => startStep(index, true)}>Listen first</button>}
              </div>
            </div>
          </div>
        )}

        {session && step && phase === "result" && result && (
          <div className="overlay">
            <div className="card">
              <h2>{step.title}</h2>
              {stars(result.stars)}
              <p>{result.line}</p>
              <div className="actions">
                {session.steps[index + 1]
                  ? <button className="primary big" onClick={() => { setIndex(index + 1); setResult(null); setPhase("ready"); }}>Next</button>
                  : <button className="primary big" onClick={leave}>Done</button>}
                <button className="big" onClick={() => startStep(index)}>Again</button>
              </div>
            </div>
          </div>
        )}
      </section>

      <footer className="dock">
        {session ? (
          phase === "running" ? <button onClick={stop}><Square size={18} /><span>Stop</span></button> : <span className="hint">{step?.kind === "song" ? "The notes come to the line. Sing each one as it arrives." : "Follow the two dashed lines."}</span>
        ) : (
          <>
            <button onClick={() => void toggleRecord()} data-rec={recording}>
              {recording ? <Square size={20} /> : <Circle size={20} fill="currentColor" />}
              <span>{recording ? `Stop · ${fmt(recSecs)}` : "Record"}</span>
            </button>
            <button onClick={() => setSheet("lesson")} disabled={recording}><BookOpen size={20} /><span>Lesson</span></button>
            <button onClick={() => setSheet("song")} disabled={recording}><Music size={20} /><span>Song</span></button>
          </>
        )}
      </footer>

      {sheet && (
        <div className="backdrop" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={sheet === "lesson" ? "Lessons" : "Songs"}>
            <div className="sheet-head">
              <h2>{sheet === "lesson" ? "Lessons" : "Songs"}</h2>
              <button className="icon" onClick={() => setSheet(null)} aria-label="Close"><X size={18} /></button>
            </div>
            {sheet === "lesson" ? (
              <ul className="list">
                {LESSONS.map((l) => (
                  <li key={l.id}>
                    <button onClick={() => void open(l.title, l.steps, false)}>
                      <b>{l.title}</b><small>{l.minutes} min · {l.about}</small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <ul className="list">
                  {[...custom, ...SONGS].map((s) => (
                    <li key={s.id}>
                      <button onClick={() => void open(s.title, [sing(s, "Sing along with the piano. The words light up as they arrive.")], true)}>
                        <b><span className="emoji">{s.emoji}</span>{s.title}</b>
                        <small>{s.credit}{best[s.id] ? <> · {stars(best[s.id])}</> : null}</small>
                      </button>
                      {s.custom && <button className="icon" onClick={() => removeSong(s.id)} aria-label={`Remove ${s.title}`}><Trash2 size={16} /></button>}
                    </li>
                  ))}
                </ul>
                <label className="import">
                  <FileMusic size={18} /> Import a song
                  <input type="file" accept=".mid,.midi,.kar,audio/midi" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSong(f); e.target.value = ""; }} />
                </label>
                <p className="fine">Any tune you have as a MIDI file (.mid). It stays on this device.</p>
                {importError && <p className="error">{importError}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
