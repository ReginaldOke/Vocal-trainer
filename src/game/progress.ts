import type { RunSummary } from "./scoring";
import type { VoicePreset } from "./songs";
import type { GuideMode } from "../audio/guide";
import type { BackingStyle } from "../audio/backing";
import type { Mode } from "./scoring";

export interface Best {
  score: number;
  stars: number;
  accuracy: number;
  maxCombo: number;
  at: number;
}

export interface Settings {
  difficulty: "easy" | "medium" | "hard" | "pro";
  mode: Mode;
  voice: VoicePreset;
  transpose: number;
  guide: GuideMode;
  /** what plays under the singer: piano chords or a single guide tone */
  backing: BackingStyle;
  metronome: boolean;
  /** the bird sings the detected pitch back (headphones only) */
  buddyVoice: boolean;
}

export interface Progress {
  xp: number;
  plays: number;
  /** keyed by `${songId}:${difficulty}` */
  best: Record<string, Best>;
  /** achievement id -> unlock time */
  achievements: Record<string, number>;
  settings: Settings;
}

export interface Achievement {
  id: string;
  title: string;
  blurb: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-song", title: "Opening Night", blurb: "Finish your first song." },
  { id: "first-perfect", title: "Bullseye", blurb: "Score a perfect on a note." },
  { id: "combo-10", title: "On a Roll", blurb: "Hit ten notes in a row." },
  { id: "combo-25", title: "Unstoppable", blurb: "Hit twenty-five notes in a row." },
  { id: "full-combo", title: "Full Combo", blurb: "Finish a song without a single miss." },
  { id: "fever", title: "Golden Voice", blurb: "Fill the fever meter." },
  { id: "five-stars", title: "Headliner", blurb: "Earn five stars on any song." },
  { id: "hard-clear", title: "Sharp Ears", blurb: "Earn three stars or more on Hard." },
  { id: "ten-plays", title: "Regular", blurb: "Play ten takes." },
  { id: "all-drills", title: "Warmed Up", blurb: "Clear every drill with at least two stars." },
];

const KEY = "vocal-coach.progress.v1";

const DEFAULT: Progress = {
  xp: 0,
  plays: 0,
  best: {},
  achievements: {},
  settings: { difficulty: "medium", mode: "flow", voice: "mid", transpose: 0, guide: "quiet", backing: "piano", metronome: true, buddyVoice: false },
};

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT);
    const p = JSON.parse(raw) as Partial<Progress>;
    return { ...structuredClone(DEFAULT), ...p, settings: { ...DEFAULT.settings, ...(p.settings ?? {}) } };
  } catch {
    return structuredClone(DEFAULT);
  }
}

export function saveProgress(p: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode or storage full */ }
}

export const bestKey = (songId: string, difficulty: string) => `${songId}:${difficulty}`;

/** XP needed to go from level L to L+1 grows gently so early levels come quickly. */
export const xpForLevel = (level: number) => Math.round(400 * Math.pow(level, 1.35));

export function levelFromXp(xp: number) {
  let level = 1, rem = xp;
  while (rem >= xpForLevel(level)) { rem -= xpForLevel(level); level++; }
  return { level, into: rem, need: xpForLevel(level) };
}

export interface RecordOutcome {
  xpGained: number;
  newBest: boolean;
  firstClear: boolean;
  unlocked: Achievement[];
  levelBefore: number;
  levelAfter: number;
}

/** Fold one finished take into the saved progress. */
export function recordRun(p: Progress, s: RunSummary, drillIds: string[]): RecordOutcome {
  const key = bestKey(s.songId, s.difficulty);
  const prev = p.best[key];
  const firstClear = !prev && s.stars > 0;
  const newBest = s.stars > 0 && (!prev || s.score > prev.score);
  if (newBest) p.best[key] = { score: s.score, stars: Math.max(s.stars, prev?.stars ?? 0), accuracy: s.accuracy, maxCombo: s.maxCombo, at: Date.now() };
  else if (prev && s.stars > prev.stars) prev.stars = s.stars;
  p.plays++;

  const diffMult = { easy: 0.8, medium: 1, hard: 1.3, pro: 1.6 }[s.difficulty];
  const xpGained = Math.round((s.score / 25 + s.stars * 40 + (firstClear ? 120 : 0) + (s.fullCombo ? 80 : 0)) * diffMult);
  const levelBefore = levelFromXp(p.xp).level;
  p.xp += xpGained;
  const levelAfter = levelFromXp(p.xp).level;

  const unlocked: Achievement[] = [];
  const unlock = (id: string) => {
    if (p.achievements[id]) return;
    p.achievements[id] = Date.now();
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (a) unlocked.push(a);
  };
  if (s.stars > 0) unlock("first-song");
  if (s.counts.perfect > 0) unlock("first-perfect");
  if (s.maxCombo >= 10) unlock("combo-10");
  if (s.maxCombo >= 25) unlock("combo-25");
  if (s.fullCombo && s.notes.length >= 8) unlock("full-combo");
  if (s.stars === 5) unlock("five-stars");
  if ((s.difficulty === "hard" || s.difficulty === "pro") && s.stars >= 3) unlock("hard-clear");
  if (p.plays >= 10) unlock("ten-plays");
  if (drillIds.every((id) => Object.entries(p.best).some(([k, b]) => k.startsWith(id + ":") && b.stars >= 2))) unlock("all-drills");

  saveProgress(p);
  return { xpGained, newBest, firstClear, unlocked, levelBefore, levelAfter };
}

/** Best result for a song on any difficulty, for the song card. */
export function bestForSong(p: Progress, songId: string) {
  const entries = Object.entries(p.best).filter(([k]) => k.startsWith(songId + ":")).map(([, b]) => b);
  if (!entries.length) return null;
  return { stars: Math.max(...entries.map((b) => b.stars)), score: Math.max(...entries.map((b) => b.score)) };
}

/** The fever meter and star events fire during play; this lets the HUD unlock them straight away. */
export function unlockLive(p: Progress, id: string) {
  if (p.achievements[id]) return null;
  p.achievements[id] = Date.now();
  saveProgress(p);
  return ACHIEVEMENTS.find((a) => a.id === id) ?? null;
}
