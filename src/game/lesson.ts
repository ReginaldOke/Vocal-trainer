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

  const steps: LessonStep[] = [
    { kind: "glide", id: "hum-siren", title: "Hum a siren", instruction: "Lips closed, sound in the nose. Slide slowly from low to high and back, like a distant siren. Three times.", glide: { from: c.low, to: c.high, repeats: 3, direction: "up" } },
    { kind: "glide", id: "trill-siren", title: "Lip trill siren", instruction: "Let your lips flap like a horse. Same slide, up and back. If the trill stops, you are pushing too hard.", glide: { from: c.low, to: c.high, repeats: 2, direction: "up" } },
    { kind: "song", id: "ng-five", title: "Gentle five-note on “ng”", instruction: "As in “sing”. Quiet, easy, no pushing.", song: song("five-note"), quiet: true },
    { kind: "song", id: `drill-${drill.id}`, title: drill.title, instruction: drill.blurb, song: drill },
    { kind: "song", id: `song-${nextSong.id}`, title: nextSong.title, instruction: "Sing it your way. The song follows you.", song: nextSong },
    { kind: "glide", id: "cool-siren", title: "Falling sirens", instruction: "Sigh down from the middle of your voice to the bottom, twice. Let it go loose.", glide: { from: c.low, to: c.mid, repeats: 2, direction: "down" } },
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
