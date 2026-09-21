import type { Calibration, Tracker } from "../audio/analysis";
import type { ExerciseScore } from "./exercises";

export interface Priority {
  title: string;
  evidence: string;
  drill: string;
  severity: number;
}

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};

/** Turns a session's measurements into the few things most worth practising, worst first. */
export function buildPriorities(tracker: Tracker, scores: ExerciseScore[], cal: Calibration | null): Priority[] {
  const out: Priority[] = [];
  const long = tracker.notes.filter((n) => n.end - n.start >= 0.8);

  if (tracker.phraseCount >= 3) {
    const rate = tracker.scoopCount / tracker.phraseCount;
    if (rate >= 0.3)
      out.push({
        title: "Land on the note instead of sliding up to it",
        evidence: `${tracker.scoopCount} of ${tracker.phraseCount} phrases started below the note and slid up.`,
        drill: "Before each phrase, hear the first note in your head. Start it on “bah” or “dah” and imagine arriving from above.",
        severity: rate * 3,
      });
  }

  const spread = median(long.map((n) => n.stdCents));
  if (spread > 18)
    out.push({
      title: "Steady the held notes",
      evidence: `Held notes wandered by about ±${Math.round(spread)} cents. Under ±12 sounds settled.`,
      drill: "Five minutes a day: hold one mid-range note for 8 to 10 seconds against a drone, watching the line stay flat. Keep the ribs wide as the air leaves.",
      severity: (spread - 10) / 8,
    });

  const biases = scores.filter((s) => !Number.isNaN(s.biasCents));
  if (biases.length) {
    const bias = biases.reduce((s, b) => s + b.biasCents, 0) / biases.length;
    if (Math.abs(bias) > 15)
      out.push({
        title: bias < 0 ? "You tend to sing flat" : "You tend to sing sharp",
        evidence: `On average ${Math.round(Math.abs(bias))} cents ${bias < 0 ? "under" : "over"} the target.`,
        drill: bias < 0
          ? "Flat singing usually means too little energy. Keep the soft palate lifted, sing at a confident volume, and think of placing each note from above."
          : "Sharp singing usually means pushing. Ease the volume by a notch and let the breath, not the throat, carry the note.",
        severity: Math.abs(bias) / 15,
      });
  }

  const sagged = long.filter((n) => n.endSag > 0).length;
  if (long.length >= 3 && sagged / long.length >= 0.25)
    out.push({
      title: "Finish notes before the air runs out",
      evidence: `${sagged} of ${long.length} longer notes wobbled or sagged in the last third of a second.`,
      drill: "End each note while it is still strong, with the ribs still open. Practise a long even hiss (20 to 30 seconds) to build the control.",
      severity: 1 + sagged / long.length,
    });

  const pump = median(long.map((n) => n.dbStd));
  if (pump > 2.5)
    out.push({
      title: "Even out the volume",
      evidence: `Volume moved about ±${pump.toFixed(1)} dB inside held notes. Under ±1.5 dB sounds controlled.`,
      drill: "Sing one note through a straw or on a lip trill and keep the volume strip level. Then repeat on “ah”.",
      severity: (pump - 1.5) / 1.5,
    });

  if (tracker.strainSeconds > 1.5)
    out.push({
      title: "Stop pushing at the top",
      evidence: `About ${tracker.strainSeconds.toFixed(0)} seconds of singing sounded pressed or pushed near the top of your range.`,
      drill: "Slide through the high part on a lip trill, getting quieter as you rise. On words, narrow the vowel toward “uh” as you go up.",
      severity: 1.5 + tracker.strainSeconds / 4,
    });

  if (tracker.crackCount > 0)
    out.push({
      title: "Smooth the register change",
      evidence: `Your voice flipped abruptly ${tracker.crackCount} time${tracker.crackCount > 1 ? "s" : ""}.`,
      drill: "Daily sirens on a straw or lip trill through the break, low to high and back. Also start light in head voice and slide down into chest.",
      severity: 1.2 + tracker.crackCount * 0.3,
    });

  out.sort((a, b) => b.severity - a.severity);
  const top = out.slice(0, 3);
  if (!tracker.notes.some((n) => n.wobble === "vibrato"))
    top.push({
      title: "Vibrato can wait",
      evidence: "No natural vibrato showed up in this session, which is normal at this stage.",
      drill: cal ? "It tends to appear by itself once held notes are steady and relaxed. Work on the items above first." : "It tends to appear by itself once held notes are steady and relaxed.",
      severity: 0,
    });
  return top;
}
