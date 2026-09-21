import type { GlideConfig } from "./glide";
import type { Progress } from "./progress";
import { sirenRange } from "./lesson";

/** A song the singer added from a YouTube link. It plays in YouTube's own player, quietly. */
export interface Track {
  id: string;
  title: string;
  videoId: string;
  addedAt: number;
}

const KEY = "vocal-coach.tracks.v1";

export function loadTracks(): Track[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Track[]; } catch { return []; }
}

export function saveTracks(tracks: Track[]) {
  try { localStorage.setItem(KEY, JSON.stringify(tracks)); } catch { /* storage blocked */ }
}

/** One step of a lesson built around a track. Times are seconds into the song. */
export type TrackStep =
  | { kind: "glide"; id: string; title: string; instruction: string; glide: GlideConfig }
  | { kind: "listen"; id: string; title: string; instruction: string; from: number; to: number }
  | { kind: "sing"; id: string; title: string; instruction: string; from: number; to: number; rate: number; record?: boolean };

export interface TrackPlan {
  steps: TrackStep[];
  sections: { title: string; at: number }[];
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * A lesson shaped around a song the way a teacher would run it: warm the voice up, hear the
 * opening, sing it slowly, sing it at speed, take on the next part, then run the whole song and
 * settle the voice down. Never much more than ten minutes.
 */
export function buildTrackPlan(duration: number, progress: Progress, cal: { low: number; high: number; comfort?: number } | null): TrackPlan {
  const { sLow, sHigh, span, reps, mid } = sirenRange(progress, cal);
  const part = Math.max(20, Math.min(45, duration / 4));
  const full = Math.min(duration, 240);
  const steps: TrackStep[] = [
    { kind: "glide", id: "hum", title: "Hum a siren", instruction: `Lips closed, sound in the nose. Slide from the bottom line to the top and back, ${reps === 3 ? "three" : "two"} times.`, glide: { from: sLow, to: sHigh, repeats: reps, direction: "up" } },
    { kind: "listen", id: "listen", title: "Hear the opening", instruction: `Just listen to the first ${fmt(part)}. Follow the tune in your head and notice where the breaths go.`, from: 0, to: part },
    { kind: "sing", id: "slow", title: "Sing the opening, slowly", instruction: "The song is slowed down and turned low. Sing over it. Colour shows how close you land to each note.", from: 0, to: part, rate: 0.75 },
    { kind: "sing", id: "speed", title: "Same part, at speed", instruction: "Now at full speed. Breathe where the singer breathes.", from: 0, to: part, rate: 1 },
    { kind: "sing", id: "next", title: "The next part", instruction: "Carry on from where you left off. Stay light near the top.", from: part, to: Math.min(duration, part * 2), rate: 1 },
    { kind: "sing", id: "full", title: "The whole song", instruction: "Sing it through. This one is recorded for your review.", from: 0, to: full, rate: 1, record: true },
    { kind: "glide", id: "cool", title: "Falling sirens", instruction: "Sigh down from the middle of your voice to the bottom, twice. Let it go loose.", glide: { from: Math.round(mid - span * 0.6), to: Math.round(mid), repeats: 2, direction: "down" } },
  ];
  return { steps, sections: [{ title: "Warm up", at: 0 }, { title: "Learn it", at: 1 }, { title: "Sing it", at: 5 }, { title: "Cool down", at: 6 }] };
}

/** Just the song, start to finish, quietly under the singer. */
export function singAlongPlan(duration: number): TrackPlan {
  return { steps: [{ kind: "sing", id: "full", title: "Sing along", instruction: "The song plays low under your voice. Colour shows how close you land to each note.", from: 0, to: duration, rate: 1, record: true }], sections: [{ title: "Sing", at: 0 }] };
}

export interface TakeFrame { t: number; midi: number; db: number; voiced: boolean }

export interface TakeStats {
  /** seconds of singing heard */
  sung: number;
  /** share of held notes that sat within a quarter tone of a note */
  onNote: number;
  /** share of singing that held its pitch steady from moment to moment */
  steady: number;
  /** average signed distance from the nearest note, in cents */
  bias: number;
  breaths: number;
  lo: number;
  hi: number;
  stars: number;
}

/** How a stretch of free singing went, judged against the nearest note since the song's own notes are unknown. */
export function scoreTake(frames: TakeFrame[]): TakeStats {
  let sung = 0, held = 0, onNote = 0, steadyN = 0, steady = 0, biasSum = 0, breaths = 0, gap = 0;
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    const dt = Math.min(0.1, b.t - a.t);
    if (!b.voiced) { gap += dt; continue; }
    if (gap >= 0.25 && sung > 0.3) breaths++;
    gap = 0;
    sung += dt;
    lo = Math.min(lo, b.midi); hi = Math.max(hi, b.midi);
    if (!a.voiced || b.t - a.t > 0.1) continue;
    const move = Math.abs(b.midi - a.midi);
    steadyN += dt;
    if (move <= 0.35) steady += dt;
    // Slides between notes are not judged; only the moments a pitch is being held.
    if (move > 0.6) continue;
    const off = (b.midi - Math.round(b.midi)) * 100;
    held += dt;
    biasSum += off * dt;
    if (Math.abs(off) <= 25) onNote += dt;
  }
  const on = held > 0 ? onNote / held : 0;
  const stars = sung < 3 ? 0 : on >= 0.85 ? 3 : on >= 0.65 ? 2 : 1;
  return { sung, onNote: on, steady: steadyN > 0 ? steady / steadyN : 0, bias: held > 0 ? biasSum / held : 0, breaths, lo: Number.isFinite(lo) ? lo : NaN, hi: Number.isFinite(hi) ? hi : NaN, stars };
}

/** XP and a history entry for a sung stretch of a track, so it shows in progress like any song. */
export function recordTrackTake(p: Progress, track: Track, stats: TakeStats, context?: "lesson") {
  if (stats.stars === 0) return 0;
  const xp = 40 + Math.round(stats.onNote * 120) + (stats.stars === 3 ? 40 : 0);
  p.xp += xp;
  p.plays += 1;
  const minutes = Math.max(0.25, stats.sung / 60);
  p.history.push({ at: Date.now(), songId: `track-${track.id}`, difficulty: p.settings.difficulty, accuracy: stats.onNote, score: Math.round(stats.onNote * 1000), stars: stats.stars, biasCents: stats.bias, oneBreath: Math.max(0, Math.min(1, 1 - stats.breaths / minutes / 24)), context });
  if (p.history.length > 500) p.history.splice(0, p.history.length - 500);
  return xp;
}
