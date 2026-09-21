import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

/** The app's own audio player: play, scrub, time. Same look as every other control. */
export function Player({ src, audioRef, onTime, label = "Listen back" }: { src: string; audioRef?: React.MutableRefObject<HTMLAudioElement | null>; onTime?: (t: number) => void; label?: string }) {
  const own = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const el = () => own.current;

  useEffect(() => {
    if (audioRef) audioRef.current = own.current;
    setPlaying(false); setT(0); setDur(0);
  }, [src, audioRef]);

  const toggle = () => { const a = el(); if (!a) return; if (a.paused) void a.play(); else a.pause(); };
  const seek = (v: number) => { const a = el(); if (!a) return; a.currentTime = v; setT(v); onTime?.(v); };

  return (
    <div className="player" role="group" aria-label={label}>
      <audio ref={own} src={src} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onDurationChange={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDur(d); }}
        onTimeUpdate={(e) => { const v = e.currentTarget.currentTime; setT(v); onTime?.(v); if (!Number.isFinite(dur) || dur === 0) { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDur(d); } }} />
      <button className="icon" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <span className="time">{fmt(t)}</span>
      <input type="range" min={0} max={dur || 1} step={0.01} value={Math.min(t, dur || 1)} onChange={(e) => seek(Number(e.target.value))} aria-label="Position" style={{ ["--fill" as string]: `${dur ? (t / dur) * 100 : 0}%` }} />
      <span className="time">{fmt(dur)}</span>
    </div>
  );
}
