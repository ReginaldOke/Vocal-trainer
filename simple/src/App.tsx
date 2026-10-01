import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Circle, Minus, Music, Pause, Play, Plus, Repeat, Search, SkipBack, SkipForward, Square, Trash2, Volume2, X } from "lucide-react";
import { Engine, type Frame } from "./audio/engine";
import { Piano } from "./audio/piano";
import { noteName } from "./audio/pitch";
import { GlideRun } from "./glide";
import { Review } from "./Review";
import { Take, folded } from "./sing";
import { EXERCISES, callAndResponse, lines, type Line, type Song } from "./songs";
import { STARTERS, find, loadTracks, saveTracks, thumb, type Track } from "./tracks";
import { YouTubePlayer } from "./audio/youtube";
import { Stage, type StageView } from "./Stage";

/** A part of a lesson: an exercise taken a line at a time, or a slide of the voice between two notes. */
type Part = { song: Song } | { slide: string; down?: boolean };

interface Lesson { title: string; parts: Part[] }

const LESSONS: Lesson[] = [
  { title: "Warm up", parts: [{ slide: "Hum" }, { slide: "Lip trill" }, { song: EXERCISES.ng }] },
  { title: "Pitch workout", parts: [{ song: EXERCISES.ah }, { song: EXERCISES.humShort }, { song: EXERCISES.humSmooth }, { slide: "“Woo”", down: true }, { song: EXERCISES.goo }, { song: EXERCISES.koo }, { song: EXERCISES.gug }] },
  { title: "Long notes", parts: [{ song: EXERCISES.long }] },
  { title: "Match a melody", parts: [{ song: EXERCISES.melodies }] },
];

/** One thing to hear and then do: a line to sing back, or a slide to copy. */
interface Seg { title: string; line?: Line; beat: number; lo: number; hi: number; slide?: { from: number; to: number; down: boolean } }

/** Lay a lesson out as a plain list of lines and slides, in the singer's key. */
function flatten(parts: Part[], centre: number, shift: number): Seg[] {
  return parts.flatMap((p): Seg[] => {
    if ("slide" in p) {
      const lo = centre - 4 + shift, hi = centre + 4 + shift;
      const seg: Seg = { title: p.slide, beat: 0.6, lo, hi, slide: { from: lo, to: hi, down: !!p.down } };
      return [seg, seg];
    }
    const L = lines(p.song, centre, shift);
    return L.lines.map((line) => ({ title: p.song.title, line, beat: L.beat, lo: L.lo, hi: L.hi }));
  });
}

/**
 * The computer keyboard as a piano, as music software lays it out: the home row is the white
 * notes from C, the row above is the black notes between them. The octave keys are in OCTAVE_KEYS.
 */
const KEYS: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

/**
 * A small picture of a lesson: its notes as they rise and fall, and its slides as arcs.
 */
function Thumb({ parts }: { parts: Part[] }) {
  const shapes = useMemo(() => {
    const notes: { t: number; d: number; m: number }[] = [];
    const arcs: { t0: number; t1: number; a: number; b: number }[] = [];
    let t = 0;
    for (const p of parts) {
      if ("slide" in p) {
        arcs.push({ t0: t, t1: t + 2.4, a: p.down ? 64 : 56, b: p.down ? 56 : 64 });
        t += 3;
        continue;
      }
      const L = lines(p.song, 60).lines;
      for (const line of parts.length === 1 && !p.song.rounds ? L : L.slice(0, 1)) {
        if (notes.length > 60) break;
        for (const n of line.notes) notes.push({ t: t + n.start, d: n.dur, m: n.midi });
        t += line.length;
      }
      t += 0.6;
    }
    const all = [...notes.map((n) => n.m), ...arcs.flatMap((a) => [a.a, a.b])];
    const lo = Math.min(...all), hi = Math.max(...all), total = Math.max(0.1, t - 0.6);
    const x = (v: number) => 5 + (v / total) * 110;
    const y = (m: number) => (hi === lo ? 22 : 38 - ((m - lo) / (hi - lo)) * 32);
    return {
      bars: notes.map((n) => ({ x: x(n.t), y: y(n.m) - 1.6, w: Math.max(1.8, x(n.t + n.d) - x(n.t) - 0.6) })),
      paths: arcs.map((a) => `M ${x(a.t0)} ${y(a.a)} Q ${x((a.t0 + a.t1) / 2)} ${2 * y(a.b) - y(a.a)} ${x(a.t1)} ${y(a.a)}`),
    };
  }, [parts]);
  return (
    <svg className="thumb" viewBox="0 0 120 44" aria-hidden="true">
      {shapes.bars.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={3.2} rx={1.6} />)}
      {shapes.paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

const OCTAVE_KEYS: Record<string, number> = { BracketLeft: -12, Comma: -12, KeyZ: -12, BracketRight: 12, Period: 12, KeyX: 12 };

/** Opened with ?silent, the app makes no sound at all (for testing). */
const SILENT = new URLSearchParams(location.search).has("silent");

const SAVE = "vocal-coach-simple.centre";
const loadCentre = () => { const n = Number(localStorage.getItem(SAVE)); return Number.isFinite(n) && n >= 40 && n <= 80 ? n : 60; };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

export function App() {
  const engine = useRef(new Engine()).current;
  const view = useRef<StageView>({ now: () => engine.now(), trace: [], take: null, glide: null, listenUntil: 0, tap: null, held: new Set(), loud: { lo: -42, hi: -18 } });
  const R = useRef({ piano: null as Piano | null, centre: loadCentre(), heard: [] as number[], lastUi: 0, recAt: 0, levels: [] as number[], guides: new Map<number, number>(), keys: new Map<string, number>(), octave: null as number | null, slideSung: 0, prevT: 0, segs: [] as Seg[], index: 0, playing: false, loop: false });

  const [micError, setMicError] = useState("");
  const [note, setNote] = useState("");
  const [sheet, setSheet] = useState<null | "lesson" | "song">(null);
  const [mine, setMine] = useState<Track[]>(() => loadTracks());
  const [query, setQuery] = useState("");
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<Track[] | null>(null);
  const [findError, setFindError] = useState("");
  const [track, setTrack] = useState<Track | null>(null);
  const [yt, setYt] = useState({ playing: false, time: 0, duration: 0, error: "" });
  const [volume, setVolume] = useState(40);
  const player = useRef<YouTubePlayer | null>(null);
  const videoHost = useRef<HTMLDivElement>(null);
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
    if (engine.ready && R.current.piano) return true;
    try {
      await engine.start();
      R.current.piano ??= new Piano(engine.ctx!, engine.out!);
      if (import.meta.env.DEV) Object.assign(window, { __app: { engine, view, R } });
      setMicError("");
      return true;
    } catch {
      setMicError("Microphone blocked. Allow it for this page.");
      return false;
    }
  }, [engine]);

  // Start listening as the page opens: no button. A first visit shows the browser's own prompt.
  useEffect(() => { void start(); }, [start]);

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
      const p = callAndResponse(seg.line, seg.beat);
      // Keep the picture framed on the whole song, not jumping about line by line.
      p.lo = seg.lo; p.hi = seg.hi;
      v.glide = null;
      v.take = new Take(p, at);
      p.chords.forEach((c, k) => piano.chord(c.midi, at + c.at, c.dur, k === 0 ? 0.42 : 0.3));
      for (const n of p.notes) if (n.role === "cue") piano.play(n.midi, at + n.start, n.dur, 0.8);
    } else if (seg.slide) {
      const { from, to, down } = seg.slide;
      v.take = null;
      v.glide = new GlideRun({ from, to, repeats: 1, direction: down ? "down" : "up" }, at);
      const len = piano.run(down ? to : from, down ? from : to, at);
      v.listenUntil = at + len;
      r.slideSung = 0;
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
    // A note the singer just played on the piano is the piano, not the voice.
    if (f.voiced && r.guides.size && f.db < Math.min(engine.floorDb + 18, -38)) {
      for (const [m, until] of r.guides) { if (f.t > until) r.guides.delete(m); else if (Math.abs(folded(f.midi, m)) < 60) { mute(); break; } }
    }
    let q = -1;
    const take = v.take, glide = v.glide;
    if (take) {
      // While it is the piano's turn, the mic is hearing the speakers.
      if (take.listening(f.t)) mute();
      q = take.push(f, engine.floorDb);
      if (take.done()) next();
    } else if (glide) {
      if (f.t < v.listenUntil) mute();
      glide.update(f, f.t);
      q = 2;
      // Done when the slide has been made, or once the singer has had a go and gone quiet.
      if (f.voiced) r.slideSung += Math.min(0.1, f.t - r.prevT);
      if (glide.finished || (r.slideSung >= 0.8 && glide.quietFor >= 1.5)) next();
    } else if (f.voiced) {
      // Learn where this voice sits, so songs can start in a comfortable key.
      r.heard.push(f.midi);
      if (r.heard.length > 900) r.heard.splice(0, 300);
      if (r.heard.length >= 150 && r.heard.length % 60 === 0) { r.centre = Math.round(median(r.heard)); try { localStorage.setItem(SAVE, String(r.centre)); } catch { /* storage blocked */ } }
    }
    if (f.voiced) { r.levels.push(f.db); if (r.levels.length > 400) r.levels.splice(0, 100); }
    r.prevT = f.t;
    v.trace.push({ t: f.t, midi: f.midi, db: f.db, voiced: f.voiced, q });
    if (v.trace.length > 900) v.trace.splice(0, 300);
    if (f.t - r.lastUi > 0.1) {
      r.lastUi = f.t;
      setNote(f.voiced ? noteName(f.midi) : "");
      // Follow how quietly and loudly this voice is singing, so line thickness always has room to move.
      if (r.levels.length >= 20) {
        const sorted = [...r.levels].sort((a, b) => a - b);
        const lo = sorted[Math.floor(sorted.length * 0.1)], hi = sorted[Math.ceil(sorted.length * 0.95) - 1];
        v.loud = { lo: v.loud.lo + (lo - v.loud.lo) * 0.1, hi: v.loud.hi + (hi - v.loud.hi) * 0.1 };
      }
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
    r.guides.set(midi, engine.now() + 1.8);
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

  // ---------------------------------------------------------------- songs: sing along with the real recording
  /** The song plays in YouTube's own player, turned down, while the stage shows the singer's voice. */
  useEffect(() => {
    const host = videoHost.current;
    if (!track || !host) return;
    const p = new YouTubePlayer();
    player.current = p;
    let gone = false;
    const slot = document.createElement("div");
    host.appendChild(slot);
    setYt({ playing: false, time: 0, duration: 0, error: "" });
    const off = p.onChange((st) => { if (!gone) setYt((y) => ({ ...y, playing: st === "playing", error: st === "error" ? p.error ?? "This recording could not be played." : y.error })); });
    p.mount(slot, track.id).then(() => {
      if (gone) return;
      if (SILENT) p.mute();
      p.setVolume(volume);
      p.play();
    }).catch((e: Error) => { if (!gone) setYt((y) => ({ ...y, error: e.message })); });
    // The clock follows the song only: while YouTube shows an advert its time is the advert's.
    const poll = window.setInterval(() => { if (!gone && p.state !== "loading" && p.state !== "error") setYt((y) => ({ ...y, time: p.state === "playing" ? p.time() : y.time, duration: p.duration() })); }, 250);
    return () => { gone = true; off(); clearInterval(poll); p.destroy(); player.current = null; host.replaceChildren(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  const openTrack = async (t: Track) => {
    if (!(await start())) return;
    halt();
    setSession(null);
    setSheet(null);
    setFound(null);
    setQuery("");
    // A song found by search or link joins the singer's own shelf.
    if (t.mine && !mine.some((m) => m.id === t.id) && !STARTERS.some((m) => m.id === t.id)) { const all = [t, ...mine]; setMine(all); saveTracks(all); }
    setTrack(t);
  };
  const removeTrack = (id: string) => { const rest = mine.filter((t) => t.id !== id); setMine(rest); saveTracks(rest); };
  const search = async () => {
    if (!query.trim() || finding) return;
    setFinding(true);
    setFindError("");
    const r = await find(query);
    setFinding(false);
    if (r.error) { setFindError(r.error); return; }
    setFound(r.tracks);
  };
  const changeVolume = (v: number) => { setVolume(v); player.current?.setVolume(v); };

  // The computer keyboard plays the piano: hold one key for a note, several for a chord.
  useEffect(() => {
    const r = R.current;
    const up = (code: string) => {
      const midi = r.keys.get(code);
      if (midi === undefined) return;
      r.keys.delete(code);
      if ([...r.keys.values()].includes(midi)) return;
      r.piano?.release(midi);
      view.current.held.delete(midi);
      r.guides.set(midi, engine.now() + 1);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSheet(null); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      // The C at or just below where this voice sits, unless Z or X has moved it.
      const base = r.octave ?? Math.floor(r.centre / 12) * 12;
      // Octave down and up: [ and ], or , and . (Z and X work too, as in Ableton).
      const shift = OCTAVE_KEYS[e.code];
      if (shift) { e.preventDefault(); r.octave = Math.max(24, Math.min(72, base + shift)); return; }
      const step = KEYS[e.code];
      if (step === undefined) return;
      e.preventDefault();
      const midi = base + step;
      r.keys.set(e.code, midi);
      void start().then(async (ok) => {
        if (!ok || !r.piano) return;
        await r.piano.ready;
        // The key may already be up again by the time the piano is ready.
        if (r.keys.get(e.code) !== midi) return;
        r.piano.press(midi);
        view.current.held.add(midi);
        r.guides.set(midi, engine.now() + 30);
      });
    };
    const onUp = (e: KeyboardEvent) => up(e.code);
    const allUp = () => { for (const code of [...r.keys.keys()]) up(code); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", allUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); window.removeEventListener("blur", allUp); };
  }, [engine, start]);

  if (review) return <Review blob={review} onClose={() => setReview(null)} onNote={(m) => void guide(m)} />;

  const seg = segs[index];
  const first = segs.find((s) => s.line)?.line?.notes[0].midi;
  const shelf = found ?? [...mine, ...STARTERS.filter((t) => !mine.some((m) => m.id === t.id))];

  return (
    <main className="app">
      <header className="bar">
        {(session || track) && <button className="icon" onClick={() => (track ? setTrack(null) : leave())} aria-label="Back"><ArrowLeft size={18} /></button>}
        {session && <span className="title">{seg?.title ?? session.title}</span>}
        {track && <span className="title">{track.title}</span>}
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

      <section className="stage-wrap" data-video={!!track}>
        <Stage view={view} onTap={(m) => void guide(m)} />
        {track && <div className="video" ref={videoHost} />}
        {track && yt.error && <div className="overlay"><p className="error">{yt.error}</p></div>}
        {micError && (
          <div className="overlay">
            <p className="error">{micError}</p>
            <button className="primary" onClick={() => void start()}>Try again</button>
          </div>
        )}
      </section>

      <footer className="dock">
        {track ? (
          <div className="transport song">
            <button className="icon play" onClick={() => (yt.playing ? player.current?.pause() : player.current?.play())} aria-label={yt.playing ? "Pause" : "Play"}>{yt.playing ? <Pause size={22} /> : <Play size={22} />}</button>
            <span className="time">{fmt(yt.time)}</span>
            <input className="scrub" type="range" min={0} max={Math.max(1, yt.duration)} step={0.5} value={Math.min(yt.time, yt.duration || 1)} onChange={(e) => { const v = Number(e.target.value); player.current?.seek(v); setYt((y) => ({ ...y, time: v })); }} aria-label="Position in the song" />
            <span className="time">{fmt(yt.duration)}</span>
            <label className="vol"><Volume2 size={16} /><input type="range" min={0} max={100} value={volume} onChange={(e) => changeVolume(Number(e.target.value))} aria-label="Song volume" /></label>
          </div>
        ) : session ? (
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
            {sheet === "song" && (
              <form className="find" onSubmit={(e) => { e.preventDefault(); void search(); }}>
                <Search size={16} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search, or paste a YouTube or Spotify link" aria-label="Find a song" enterKeyHint="search" />
                {(found || query) && <button type="button" className="icon" onClick={() => { setFound(null); setQuery(""); setFindError(""); }} aria-label="Clear"><X size={16} /></button>}
              </form>
            )}
            {sheet === "song" && findError && <p className="error">{findError}</p>}
            <div className="cards" data-busy={finding}>
              {sheet === "lesson"
                ? LESSONS.map((l) => (
                  <div className="card" key={l.title}>
                    <button onClick={() => void open(l)}>
                      <Thumb parts={l.parts} />
                      <span>{l.title}</span>
                    </button>
                  </div>
                ))
                : shelf.map((t) => (
                  <div className="card" key={t.id}>
                    <button onClick={() => void openTrack(t)}>
                      <img className="cover" src={thumb(t.id)} alt="" loading="lazy" />
                      <span>{t.title}</span>
                      {t.artist && <small>{t.artist}</small>}
                    </button>
                    {!found && t.mine && <button className="icon remove" onClick={() => removeTrack(t.id)} aria-label={`Remove ${t.title}`}><Trash2 size={15} /></button>}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
