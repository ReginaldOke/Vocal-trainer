import type { LiveState, TrackerEvent } from "../audio/analysis";

export interface Tip {
  id: string;
  text: string;
  tone: "good" | "info" | "warn" | "alert";
  t: number;
}

/** Distance from the target in cents, ignoring which octave the singer chose. */
export const foldedCents = (midi: number, target: number) => {
  const d = (((midi - target + 6) % 12) + 12) % 12 - 6;
  return d * 100;
};

/**
 * The rule book a teacher would apply while listening. It turns measurements into one short remark
 * at a time, with cool-downs so the singer is not nagged.
 */
export class Coach {
  private lastShown = new Map<string, number>();
  private lastAny = -10;
  private strainSince = -1;
  private quietSince = -1;
  private praisedNoteStart = -1;
  counts = new Map<string, number>();

  reset() {
    this.lastShown.clear();
    this.counts.clear();
    this.lastAny = -10;
  }

  /** `targetSince` is how long the current target has been active, so a note held over from the previous target is not judged against the new one. */
  update(s: LiveState, events: TrackerEvent[], target: number | null, targetSince: number, noiseDb: number): Tip | null {
    const f = s.frame;
    if (!f) return null;
    const out: Tip[] = [];
    const say = (id: string, tone: Tip["tone"], text: string) => out.push({ id, tone, text, t: f.t });

    // Strain and cracks first: they matter most.
    if (s.strain > 0.55) {
      if (this.strainSince < 0) this.strainSince = f.t;
      if (f.t - this.strainSince > 0.4) say("strain", "alert", "That sounds pushed. Get lighter as you go up and narrow the vowel toward “uh”.");
    } else this.strainSince = -1;

    for (const e of events) {
      if (e.type === "crack") say("crack", "warn", "Your voice flipped registers. Approach the break more quietly and let the sound thin out.");
      if (e.type === "scoop") say("scoop", "warn", `You slid up into that note over ${e.seconds.toFixed(1)}s. Hear the pitch first, then land on it.`);
      if (e.type === "note-end") {
        const n = e.note, dur = n.end - n.start;
        if (n.endSag) say("end-sag", "warn", "The end of that note sagged as the air ran out. Keep your ribs wide and finish while the sound is still strong.");
        else if (dur > 1.2 && n.dbSlope < -5) say("fade", "info", "That note faded as it went. Spend the air evenly so the end is as full as the start.");
        else if (dur > 1 && n.dbStd > 3 && Math.abs(n.dbSlope) < 4) say("pump", "info", "The volume pumped up and down on that note. Aim for one even stream of air.");
        if (n.wobble === "vibrato") say("vibrato", "good", `That was real vibrato, about ${n.vibratoRate.toFixed(1)} per second. Notice how relaxed that felt.`);
        if (n.wobble === "slow-wobble") say("wobble", "warn", "A slow wobble crept in. That usually means too much push. Back the volume off a touch and keep the air moving.");
      }
    }

    const n = s.note;
    if (n && f.voiced) {
      const held = f.t - n.start;
      if (target !== null && held > 0.5 && n.start > f.t - targetSince - 0.2) {
        const err = foldedCents(n.median, target);
        if (Math.abs(err) > 150) say("wrong-note", "info", "That is a different note from the bar. Listen to the line once more, then try again.");
        else if (err < -30) say("flat", "warn", `Flat by about ${Math.round(-err / 5) * 5} cents. Lift the soft palate and aim for the top of the note.`);
        else if (err > 30) say("sharp", "warn", `Sharp by about ${Math.round(err / 5) * 5} cents. You are likely pushing. Ease the volume a little.`);
        else if (Math.abs(err) < 12 && s.steadiness < 12 && held > 1 && this.praisedNoteStart !== n.start) {
          this.praisedNoteStart = n.start;
          say("locked", "good", "Locked in. Remember how that feels.");
        }
      }
      if (held > 1 && n.wobble === "unsteady" && s.steadiness > 28) say("waver", "warn", "The pitch is wandering. Think of a slow, even hiss of air underneath the note.");
      if (target === null && held > 1.8 && s.steadiness < 10 && n.stdCents < 10 && this.praisedNoteStart !== n.start) {
        this.praisedNoteStart = n.start;
        say("steady", "good", `Steady as a rock for ${held.toFixed(0)} seconds.`);
      }
    }

    if (f.voiced && f.db < Math.max(noiseDb + 14, -48)) {
      if (this.quietSince < 0) this.quietSince = f.t;
      if (f.t - this.quietSince > 1.5) say("quiet", "info", "Sing out. A confident, speech-level volume makes the pitch easier to hold.");
    } else if (f.voiced) this.quietSince = -1;

    // One remark at a time: alerts first, then warnings, then the rest.
    const rank = { alert: 0, warn: 1, info: 2, good: 3 } as const;
    out.sort((a, b) => rank[a.tone] - rank[b.tone]);
    for (const tip of out) {
      const cooled = f.t - (this.lastShown.get(tip.id) ?? -100) > (tip.tone === "good" ? 6 : 10);
      const gap = f.t - this.lastAny > (tip.tone === "alert" ? 1 : 3);
      this.counts.set(tip.id, (this.counts.get(tip.id) ?? 0) + (cooled ? 1 : 0));
      if (cooled && gap) {
        this.lastShown.set(tip.id, f.t);
        this.lastAny = f.t;
        return tip;
      }
    }
    return null;
  }
}
