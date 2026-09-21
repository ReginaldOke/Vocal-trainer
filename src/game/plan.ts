import type { Progress, RunRecord } from "./progress";

/** One thing to do this week, and how far along it is. */
export interface PlanItem {
  id: string;
  title: string;
  why: string;
  done: number;
  goal: number;
}

const WEEK = 7 * 24 * 3600e3;
const startOfWeek = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};

/** Runs from the last seven days and from before that, for spotting trends. */
export function recentRuns(p: Progress) {
  const cut = Date.now() - WEEK;
  return { thisWeek: p.history.filter((r) => r.at >= cut), before: p.history.filter((r) => r.at < cut) };
}

/** Accuracy per day for the last few weeks, for the chart. */
export function accuracyByDay(p: Progress, days = 28): { day: number; accuracy: number; runs: number }[] {
  const out: { day: number; accuracy: number; runs: number }[] = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const day = today.getTime() - i * 24 * 3600e3;
    const runs = p.history.filter((r) => r.at >= day && r.at < day + 24 * 3600e3 && r.stars > 0);
    out.push({ day, accuracy: runs.length ? runs.reduce((s, r) => s + r.accuracy, 0) / runs.length : NaN, runs: runs.length });
  }
  return out;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

/**
 * A short plan for the week, built from what last week's singing showed. Three items at most,
 * each with a count so it can be ticked off.
 */
export function weeklyPlan(p: Progress): PlanItem[] {
  const week0 = startOfWeek();
  const thisWeek = p.history.filter((r) => r.at >= week0);
  const lastTwoWeeks = p.history.filter((r) => r.at >= week0 - 2 * WEEK && r.at < week0);
  const basis: RunRecord[] = lastTwoWeeks.length >= 3 ? lastTwoWeeks : p.history.slice(-8);
  const lessonsThisWeek = p.lessons.filter((t) => t >= week0).length;
  const items: PlanItem[] = [
    { id: "lessons", title: "Three short lessons", why: "Little and often beats one long session.", done: lessonsThisWeek, goal: 3 },
  ];
  const bias = mean(basis.map((r) => r.biasCents));
  const breath = mean(basis.map((r) => r.oneBreath));
  const acc = mean(basis.map((r) => r.accuracy));
  const earRuns = thisWeek.filter((r) => r.songId.startsWith("ear-")).length;
  if (!Number.isNaN(breath) && breath < 0.6) items.push({ id: "breath", title: "Long Tones twice", why: "Most phrases needed an extra breath.", done: thisWeek.filter((r) => r.songId === "long-tones").length, goal: 2 });
  else if (!Number.isNaN(bias) && bias <= -15) items.push({ id: "flat", title: "Big Leaps twice", why: "You have been sitting under the note.", done: thisWeek.filter((r) => r.songId === "leaps").length, goal: 2 });
  else if (!Number.isNaN(bias) && bias >= 15) items.push({ id: "sharp", title: "Octave Scale twice", why: "You have been pushing over the note.", done: thisWeek.filter((r) => r.songId === "octave").length, goal: 2 });
  else if (!Number.isNaN(acc) && acc < 0.6) items.push({ id: "notes", title: "Five-Note Climb twice", why: "Landing each note cleanly is the next step.", done: thisWeek.filter((r) => r.songId === "five-note").length, goal: 2 });
  else items.push({ id: "song", title: "A new song to three stars", why: "Pitch is solid; time for more tune.", done: thisWeek.filter((r) => !r.songId.startsWith("ear-") && r.stars >= 3).length ? 1 : 0, goal: 1 });
  items.push({ id: "ear", title: "Two ear drills", why: "Half of tuning is hearing the note before you sing it.", done: Math.min(2, earRuns), goal: 2 });
  return items;
}
