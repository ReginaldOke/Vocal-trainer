import { useEffect, useRef, useState } from "react";
import type { AudioEngine } from "../audio/engine";
import type { Tracker } from "../audio/analysis";
import { noteName } from "../audio/pitch";
import type { Coach, Tip } from "../coach/rules";
import type { Progress } from "../game/progress";
import { SONGS, type Song } from "../game/songs";
import { GameCanvas, type GameView } from "./GameCanvas";
import { SingerAvatar, type AvatarState } from "./SingerAvatar";
import { SONG_ART } from "./songArt";

interface Props {
  engine: AudioEngine;
  tracker: Tracker;
  coach: Coach;
  micReady: boolean;
  micError: string | null;
  onStartMic: () => void;
  progress: Progress;
  avatar: React.MutableRefObject<AvatarState>;
  room: React.MutableRefObject<{ noise: number }>;
  onPlay: (song: Song) => void;
  onLesson: () => void;
  onAssess: () => void;
  onReview: (blob: Blob) => void;
}

/** The first song not yet cleared to three stars, easiest first. */
export function nextSong(progress: Progress): Song {
  const songs = SONGS.filter((s) => s.kind === "song").sort((a, b) => a.tier - b.tier);
  return songs.find((s) => !Object.entries(progress.best).some(([k, b]) => k.startsWith(s.id + ":") && b.stars >= 3)) ?? songs[songs.length - 1];
}

/** The live stage: sing anything and watch it, with Pip beside you. */
export function Home({ engine, tracker, coach, micReady, micError, onStartMic, progress, avatar, room, onPlay, onLesson, onAssess, onReview }: Props) {
  const view = useRef<GameView>({ run: null, now: () => engine.now(), effects: [], free: [] });
  const [note, setNote] = useState<{ name: string; cents: number; state: "idle" | "ok" | "warn" | "bad"; vowel: string }>({ name: "–", cents: 0, state: "idle", vowel: "" });
  const [tip, setTip] = useState<Tip | null>(null);
  const [recording, setRecording] = useState(false);
  const L = useRef({ lastUi: 0, tipAt: 0 });

  useEffect(() => {
    return engine.onFrame((f) => {
      const fr = view.current.free;
      fr.push({ t: f.t, midi: f.midi, db: f.db, voiced: f.voiced });
      if (fr.length > 900) fr.splice(0, 300);
      const a = avatar.current;
      a.voiced = f.voiced; a.midi = f.midi; a.db = f.db; a.h1h2 = f.h1h2; a.f1 = f.f1; a.f2 = f.f2; a.floorDb = room.current.noise; a.fever = false;
      const off = f.voiced ? (f.midi - Math.round(f.midi)) * 100 : 0;
      a.q = f.voiced ? (Math.abs(off) <= 20 ? 1 : Math.abs(off) <= 40 ? 0.5 : 0) : 0;
      const live = tracker.push(f);
      const events = tracker.events;
      tracker.events = [];
      a.strain = live.strain;
      const next = coach.update(live, events, null, 0, room.current.noise);
      const l = L.current;
      if (next) { l.tipAt = f.t; setTip(next); }
      if (f.t - l.lastUi > 0.1) {
        l.lastUi = f.t;
        setNote(f.voiced ? { name: noteName(f.midi), cents: off, state: Math.abs(off) <= 12 ? "ok" : Math.abs(off) <= 30 ? "warn" : "bad", vowel: f.vowel && f.vowelConf > 0.35 ? f.vowel : "" } : { name: "–", cents: 0, state: "idle", vowel: "" });
        if (f.t - l.tipAt > 6) setTip(null);
      }
    });
  }, [engine, tracker, coach, avatar, room]);

  const song = nextSong(progress);
  const played = Object.keys(progress.best).length > 0;

  const toggleRecord = async () => {
    if (!recording) { engine.startRecording(); setRecording(true); return; }
    setRecording(false);
    const blob = await engine.stopRecording();
    if (blob) onReview(blob);
  };

  return (
    <main className="home">
      <div className="stage-wrap">
        <GameCanvas view={view} />
        <div className="readout-strip" aria-live="off">
          <span className="note-name" data-state={note.state}>{note.name}</span>
          {note.state !== "idle" && <span className="cents">{note.cents > 0 ? "+" : ""}{Math.round(note.cents)}¢{note.vowel ? ` · “${note.vowel}”` : ""}</span>}
        </div>
        {tip && micReady && <div className="tip-toast" data-tone={tip.tone} role="status"><span className="tip-mark" />{tip.text}</div>}
        <aside className="buddy-panel">
          <SingerAvatar state={avatar} />
          <div className="buddy-plate">Pip</div>
        </aside>
        {!micReady && (
          <div className="stage-overlay">
            <div className="card">
              <h1>Let's hear you</h1>
              <p className="fine">Sing anything. Pip and the line follow your voice.</p>
              <button className="primary big" onClick={onStartMic}>Start singing</button>
              {micError && <p className="error">{micError}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="home-dock">
        <div className="next-card">
          <span className="art gold">🎓</span>
          <div>
            <span className="eyebrow">{progress.lessons.some((t) => Date.now() - t < 20 * 3600e3) ? "Another lesson" : "Today's lesson"}</span>
            <strong>Warm up, one drill, {song.title}</strong>
            <span className="meta">About 8 minutes · then rest the voice</span>
          </div>
          <button className="primary" onClick={onLesson}>Start</button>
        </div>
        <div className="quick">
          <button onClick={() => onPlay(song)}><span>{SONG_ART[song.id]?.emoji ?? "🎵"}</span><span>{played ? "Next song" : "Just sing"}</span></button>
          <button className={recording ? "rec on" : "rec"} onClick={() => void toggleRecord()} disabled={!micReady}><span>{recording ? "⏹" : "⏺"}</span><span>{recording ? "Stop" : "Record"}</span></button>
          <button onClick={onAssess}><span>🎚️</span><span>My range</span></button>
        </div>
      </div>
    </main>
  );
}
