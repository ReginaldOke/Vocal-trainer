import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Circle, Minus, Music, Pause, Play, Plus, Repeat, SkipBack, SkipForward, Square, Trash2, Upload } from "lucide-react";
import { Engine, type Frame } from "./audio/engine";
import { Piano } from "./audio/piano";
import { noteName } from "./audio/pitch";
import { GlideRun } from "./glide";
import { songFromMidi } from "./midi";
import { Review } from "./Review";
import { Take, folded } from "./sing";
import { EXERCISES, SONGS, callAndResponse, lines, loadCustom, saveCustom, type Line, type Song } from "./songs";
import { Stage, type StageView } from "./Stage";

/** A part of a lesson: an exercise or song taken a line at a time, or a slide of the voice between two notes. */
type Part = { song: Song } | { slide: string; down?: boolean };

interface Lesson { title: string; parts: Part[] }

const LESSONS: Lesson[] = [
  { title: "Warm up", parts: [{ slide: "Hum" }, { slide: "Lip trill" }, { song: EXERCISES.ng }] },
  { title: "Pitch workout", parts: [{ song: EXERCISES.ah }, { song: EXERCISES.humShort }, { song: EXERCISES.humSmooth }, { slide: "“Woo”", down: true }, { song: EXERCISES.goo }, { song: EXERCISES.koo }, { song: EXERCISES.gug }] },
  { title: "Long notes", parts: [{ song: EXERCISES.long }] },
  { title: "Match a note", parts: [{ song: EXERCISES.match }, { song: EXERCISES.leaps }] },
];

/** One thing to hear and then do: a line to sing back, or a slide to copy. */
interface Seg { title: string; line?: Line; beat: number; bar: number; lo: number; hi: number; slide?: { from: number; to: number; down: boolean } }

/** Lay a lesson out as a plain list of lines and slides, in the singer's key. */
function flatten(parts: Part[], centre: number, shift: number): Seg[] {
  return parts.flatMap((p): Seg[] => {
    if ("slide" in p) {
      const lo = centre - 4 + shift, hi = centre + 4 + shift;
      const seg: Seg = { title: p.slide, beat: 0.6, bar: 2.4, lo, hi, slide: { from: lo, to: hi, down: !!p.down } };
      return [seg, seg];
    }
    const L = lines(p.song, centre, shift);
    return L.lines.map((line) => ({ title: p.song.title, line, beat: L.beat, bar: L.bar, lo: L.lo, hi: L.hi }));
  });
}

const SAVE = "vocal-coach-simple.centre";
const loadCentre = () => { const n = Number(localStorage.getItem(SAVE)); return Number.isFinite(n) && n >= 40 && n <= 80 ? n : 60; };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

export function App() {
  const engine = useRef(new Engine()).current;
  const view = useRef<StageView>({ now: () => engine.now(), trace: [], take: null, glide: null, listenUntil: 0, tap: null });
  const R = useRef({ piano: null as Piano | null, centre: loadCentre(), heard: [] as number[], lastUi: 0, recAt: 0, guide: { midi: 0, until: 0 }, slideEnd: 0, segs: [] as Seg[], index: 0, playing: false, loop: false });

  const [ready, setReady] = useState(false);
  const [micError, setMicError] = useState("");
  const [note, setNote] = useState("");
  const [sheet, setSheet] = useState<null | "lesson" | "song">(null);
  const [custom, setCustom] = useState<Song[]>(() => loadCustom());
  const [importError, setImportError] = useState("");
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [review, setReview] = useState<Blob | null>(null);
  const [session, setSession] = useState<Lesson | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [shift, setShift] = useState(0);

  const segs = useMemo(() => (session ? flatten(session.parts, R.current.centre, shift) : []), [session, shift]);
  R.current.segs = segs;
  R.current.loop = loop;

  const start = useCallback(async () => {
    if (engine.ready) return true;
    try {
      await engine.start();
      R.current.piano = new Piano(engine.ctx!, engine.out!);
      if (import.meta.env.DEV) Object.assign(window, { __app: { engine, view, R } });
      setReady(true);
      setMicError("");
      return true;
    } catch {
      setMicError("Microphone blocked. Allow it for this page, then try again.");
      return false;
    }
  }, [engine]);

  // ---------------------------------------------------------------- the transport
  const halt = useCallback(() => {
    const r = R.current, v = view.current;
    v.take = null; v.glide = null; v.listenUntil = 0;
    r.piano?.hush();
    r.playing = false;
    setPlaying(false);
  }, []);

  /** Play one line or slide: the piano first, then the singer. */
  const play = useCallback((i: number) => {
    const r = R.current, v = view.current, piano = r.piano, ctx = engine.ctx;
    const seg = r.segs[i];
    if (!seg || !piano || !ctx) { halt(); r.index = 0; setIndex(0); return; }
    piano.hush();
    r.index = i; setIndex(i);
    r.playing = true; setPlaying(true);
    const at = ctx.currentTime + 0.12;
    if (seg.line) {
      const p = callAndResponse(seg.line, seg.beat, seg.bar);
      // Keep the picture framed on the whole song, not jumping about line by line.
      p.lo = seg.lo; p.hi = seg.hi;
      v.glide = null;
      v.take = new Take(p, at);
      p.chords.forEach((c, k) => piano.chord(c.midi, at + c.at, c.dur, k === 0 ? 0.42 : 0.3));
      for (const n of p.notes) if (n.role === "cue") piano.play(n.midi, at + n.start, n.dur, 0.8);
      for (const t of p.ticks) piano.tick(at + t);
    } else if (seg.slide) {
      const { from, to, down } = seg.slide;
      v.take = null;
      v.glide = new GlideRun({ from, to, repeats: 1, direction: down ? "down" : "up" }, at);
      const len = piano.run(down ? to : from, down ? from : to, at);
      v.listenUntil = at + len;
      r.slideEnd = at + len + 12;
    }
  }, [engine, halt]);

  const next = useCallback(() => {
    const r = R.current;
    if (r.loop) play(r.index);
    else if (r.index + 1 < r.segs.length) play(r.index + 1);
    else { halt(); r.index = 0; setIndex(0); }
  }, [play, halt]);

  // A change of key restarts the line in the new key.
  useEffect(() => { if (R.current.playing) play(R.current.index); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [shift]);

  // ---------------------------------------------------------------- the ear
  useEffect(() => engine.onFrame((heard: Frame) => {
    const r = R.current, v = view.current;
    let f = heard;
    const mute = () => { f = { ...f, voiced: false, midi: NaN }; };
    // A guide tone the singer just tapped is the piano, not the voice.
    if (f.voiced && f.t < r.guide.until && f.db < Math.min(engine.floorDb + 18, -38) && Math.abs(folded(f.midi, r.guide.midi)) < 60) mute();
    let q = -1;
    const take = v.take, glide = v.glide;
    if (take) {
      // While it is the piano's turn, the mic is hearing the speakers.
      if (take.listening(f.t)) mute();
      q = take.push(f, engine.floorDb);
      if (take.done(f.t)) next();
    } else if (glide) {
      if (f.t < v.listenUntil) mute();
      glide.update(f, f.t);
      q = 2;
      if (glide.finished || f.t > r.slideEnd) next();
    } else if (f.voiced) {
      // Learn where this voice sits, so songs can start in a comfortable key.
      r.heard.push(f.midi);
      if (r.heard.length > 900) r.heard.splice(0, 300);
      if (r.heard.length >= 150 && r.heard.length % 60 === 0) { r.centre = Math.round(median(r.heard)); try { localStorage.setItem(SAVE, String(r.centre)); } catch { /* storage blocked */ } }
    }
    v.trace.push({ t: f.t, midi: f.midi, db: f.db, voiced: f.voiced, q });
    if (v.trace.length > 900) v.trace.splice(0, 300);
    if (f.t - r.lastUi > 0.1) {
      r.lastUi = f.t;
      setNote(f.voiced ? noteName(f.midi) : "");
      if (engine.recording) setRecSecs(f.t - r.recAt);
    }
  }), [engine, next]);

  // ---------------------------------------------------------------- actions
  /** Tap a note anywhere to hear it on the piano. */
  const guide = useCallback(async (midi: number) => {
    if (!(await start())) return;
    const r = R.current;
    await r.piano!.ready;
    r.piano!.play(midi, engine.ctx!.currentTime, 1.3, 0.8);
    r.guide = { midi, until: engine.now() + 1.8 };
    view.current.tap = { midi, t: engine.now() };
  }, [engine, start]);

  const open = async (lesson: Lesson) => {
    if (!(await start())) return;
    setSheet(null);
    setShift(0);
    setLoop(false);
    R.current.index = 0; setIndex(0);
    setSession(lesson);
    // The same list the next render will build, so playing can start at once.
    R.current.segs = flatten(lesson.parts, R.current.centre, 0);
    await R.current.piano!.ready;
    play(0);
  };
  const leave = () => { halt(); setSession(null); };
  const toggle = () => (R.current.playing ? halt() : play(R.current.index));
  const step = (d: number) => { const i = Math.max(0, Math.min(segs.length - 1, R.current.index + d)); if (R.current.playing) play(i); else { R.current.index = i; setIndex(i); } };

  const toggleRecord = async () => {
    if (!(await start())) return;
    if (engine.recording) {
      const blob = await engine.stopRecording();
      setRecording(false);
      if (blob) setReview(blob);
    } else if (engine.startRecording()) { R.current.recAt = engine.now(); setRecSecs(0); setRecording(true); }
  };

  const importSong = async (file: File) => {
    setImportError("");
    try {
      const next = [songFromMidi(await file.arrayBuffer(), file.name), ...custom];
      setCustom(next);
      saveCustom(next);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "That file could not be read.");
    }
  };
  const removeSong = (id: string) => { const rest = custom.filter((s) => s.id !== id); setCustom(rest); saveCustom(rest); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (review) return <Review blob={review} onClose={() => setReview(null)} onNote={(m) => void guide(m)} />;

  const seg = segs[index];
  const first = segs.find((s) => s.line)?.line?.notes[0].midi;

  return (
    <main className="app">
      <header className="bar">
        {session && <button className="icon" onClick={leave} aria-label="Back"><ArrowLeft size={18} /></button>}
        {session && <span className="title">{seg?.title ?? session.title}</span>}
        <span className="readout">{note}</span>
        {session && first !== undefined && (
          <span className="key" role="group" aria-label="Key">
            <button className="icon" onClick={() => setShift((k) => Math.max(-12, k - 1))} aria-label="Lower key"><Minus size={16} /></button>
            <span>{noteName(first)}</span>
            <button className="icon" onClick={() => setShift((k) => Math.min(12, k + 1))} aria-label="Higher key"><Plus size={16} /></button>
          </span>
        )}
      </header>

      <div className="progress" data-on={!!session} aria-hidden="true"><i style={{ width: `${segs.length ? ((index + (playing ? 0.5 : 0)) / segs.length) * 100 : 0}%` }} /></div>

      <section className="stage-wrap">
        <Stage view={view} onTap={(m) => void guide(m)} />
        {!ready && (
          <div className="overlay">
            <button className="primary" onClick={() => void start()}>Start</button>
            {micError && <p className="error">{micError}</p>}
          </div>
        )}
      </section>

      <footer className="dock">
        {session ? (
          <div className="transport">
            <button className="icon" onClick={() => step(-1)} disabled={index === 0} aria-label="Previous line"><SkipBack size={20} /></button>
            <button className="icon play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={22} /> : <Play size={22} />}</button>
            <button className="icon" onClick={() => setLoop((x) => !x)} aria-pressed={loop} aria-label="Repeat this line"><Repeat size={20} /></button>
            <button className="icon" onClick={() => step(1)} disabled={index >= segs.length - 1} aria-label="Next line"><SkipForward size={20} /></button>
          </div>
        ) : (
          <>
            <button onClick={() => void toggleRecord()} data-rec={recording}>
              {recording ? <Square size={18} /> : <Circle size={18} fill="currentColor" />}
              <span>{recording ? fmt(recSecs) : "Record"}</span>
            </button>
            <button onClick={() => setSheet("lesson")} disabled={recording}><BookOpen size={18} /><span>Lesson</span></button>
            <button onClick={() => setSheet("song")} disabled={recording}><Music size={18} /><span>Song</span></button>
          </>
        )}
      </footer>

      {sheet && (
        <div className="backdrop" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={sheet === "lesson" ? "Lessons" : "Songs"}>
            <i className="grip" aria-hidden="true" />
            <ul className="list">
              {sheet === "lesson"
                ? LESSONS.map((l) => <li key={l.title}><button onClick={() => void open(l)}>{l.title}</button></li>)
                : [...custom, ...SONGS].map((s) => (
                  <li key={s.id}>
                    <button onClick={() => void open({ title: s.title, parts: [{ song: s }] })}>{s.title}</button>
                    {s.custom && <button className="icon" onClick={() => removeSong(s.id)} aria-label={`Remove ${s.title}`}><Trash2 size={16} /></button>}
                  </li>
                ))}
            </ul>
            {sheet === "song" && (
              <label className="import">
                <Upload size={16} /> Import MIDI
                <input type="file" accept=".mid,.midi,.kar,audio/midi" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSong(f); e.target.value = ""; }} />
              </label>
            )}
            {importError && <p className="error">{importError}</p>}
          </div>
        </div>
      )}
    </main>
  );
}
