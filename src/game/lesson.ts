import type { GlideConfig } from "./glide";
import type { Progress } from "./progress";
import { SONGS, type Song } from "./songs";

/**
 * A short lesson, the way a teacher would shape ten minutes: wake the voice up gently, work on
 * one thing, sing something, then settle the voice back down. Never longer than about eight
 * minutes of singing.
 */
export type LessonStep =
  | { kind: "glide"; id: string; title: string; instruction: string; glide: GlideConfig }
  | { kind: "song"; id: string; title: string; instruction: string; song: Song; quiet?: boolean };

export interface LessonPlan {
  steps: LessonStep[];
  /** which step index starts each section */
  sections: { title: string; at: number }[];
  focus: string;
}

const song = (id: string) => SONGS.find((s) => s.id === id)!;

/** Where this singer's voice sits: from the assessment if there is one, otherwise a safe middle. */
function comfortable(cal: { low: number; high: number; comfort?: number } | null, voice: "low" | "mid" | "high" | "auto") {
  if (cal) return { low: cal.low + 2, mid: cal.comfort ?? cal.low + (cal.high - cal.low) * 0.45, high: cal.high - 2 };
  const centre = voice === "low" ? 54 : voice === "high" ? 66 : 60;
  return { low: centre - 7, mid: centre, high: centre + 7 };
}

/**
 * Where this singer's sirens go. They start narrow and widen as the singer earns it, never past
 * the measured range, and sit just under where the voice sits so early sirens never have to
 * cross the switch.
 */
export function sirenRange(progress: Progress, cal: { low: number; high: number; comfort?: number } | null) {
  const c = comfortable(cal, progress.settings.voice);
  const maxSpan = Math.max(5, Math.min(16, Math.round(c.high - c.low)));
  const span = Math.max(4, Math.min(maxSpan, progress.sirenSpan ?? 5));
  const sLow = Math.max(Math.round(c.low), Math.round(c.mid - span * 0.65)), sHigh = sLow + span;
  const reps = span >= 12 ? 3 : 2;
  return { sLow, sHigh, span, reps, mid: c.mid };
}

export function buildLesson(progress: Progress, cal: { low: number; high: number; comfort?: number } | null, nextSong: Song): LessonPlan {
  const c = comfortable(cal, progress.settings.voice);
  const recent = progress.history.slice(-6);
  const flat = recent.filter((r) => r.biasCents <= -15).length >= 2;
  const sharp = recent.filter((r) => r.biasCents >= 15).length >= 2;
  const breathy = recent.filter((r) => r.oneBreath < 0.6).length >= 2;
  const missy = recent.filter((r) => r.accuracy < 0.5).length >= 2;

  let focus = "Even tone", drill = song("five-note");
  if (breathy) { focus = "Breath that lasts the phrase"; drill = song("long-tones"); }
  else if (missy) { focus = "Landing each note"; drill = song("five-note"); }
  else if (flat) { focus = "Singing on top of the note"; drill = song("leaps"); }
  else if (sharp) { focus = "Letting the note float"; drill = song("octave"); }
  else { const pool = ["five-note", "arpeggio", "octave", "leaps"]; drill = song(pool[progress.plays % pool.length]); }

  const { sLow, sHigh, span, reps } = sirenRange(progress, cal);
  const steps: LessonStep[] = [
    { kind: "glide", id: "hum-siren", title: "Hum a siren", instruction: `Lips closed, sound in the nose. Slide slowly from the bottom line to the top and back, like a distant siren. ${reps === 3 ? "Three" : "Two"} times.`, glide: { from: sLow, to: sHigh, repeats: reps, direction: "up" } },
    { kind: "glide", id: "trill-siren", title: "Lip trill siren", instruction: "Let your lips flap like a horse. Same slide, up and back. If the trill stops, you are pushing too hard.", glide: { from: sLow, to: sHigh, repeats: 2, direction: "up" } },
    { kind: "song", id: "ng-five", title: "Gentle five-note on “ng”", instruction: "As in “sing”. Quiet, easy, no pushing.", song: song("five-note"), quiet: true },
    { kind: "song", id: `drill-${drill.id}`, title: drill.title, instruction: drill.blurb, song: drill },
    { kind: "song", id: `song-${nextSong.id}`, title: nextSong.title, instruction: "Sing it your way. The song follows you.", song: nextSong },
    { kind: "glide", id: "cool-siren", title: "Falling sirens", instruction: "Sigh down from the middle of your voice to the bottom, twice. Let it go loose.", glide: { from: Math.round(c.mid - span * 0.6), to: Math.round(c.mid), repeats: 2, direction: "down" } },
  ];
  return {
    steps,
    sections: [{ title: "Warm up", at: 0 }, { title: "Work on: " + focus.toLowerCase(), at: 3 }, { title: "Sing", at: 4 }, { title: "Cool down", at: 5 }],
    focus,
  };
}

/** How loud the backing should be for a song, from how many clean runs it has had: support fades as skill grows. */
export function backingFade(progress: Progress, songId: string) {
  const reps = progress.cleanReps?.[songId] ?? 0;
  return reps >= 6 ? 0 : reps >= 4 ? 0.3 : reps >= 2 ? 0.6 : 1;
}

/**
 * After a siren: widen the range for next time when it was smooth and reached both lines,
 * narrow it when it fell short. Returns the change in notes.
 */
export function adjustSirenSpan(progress: Progress, smoothness: number, coverage: number, cal: { low: number; high: number } | null) {
  const maxSpan = cal ? Math.max(5, Math.min(16, Math.round(cal.high - cal.low))) : 14;
  const before = progress.sirenSpan ?? 5;
  let after = before;
  if (smoothness >= 0.75 && coverage >= 0.8) after = Math.min(maxSpan, before + 1);
  else if (coverage < 0.5) after = Math.max(4, before - 1);
  progress.sirenSpan = after;
  return after - before;
}
