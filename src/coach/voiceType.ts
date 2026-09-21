import { noteName } from "../audio/pitch";

const TYPES = [
  { name: "Bass", low: 40, high: 64 },
  { name: "Baritone", low: 43, high: 67 },
  { name: "Tenor", low: 48, high: 72 },
  { name: "Alto", low: 53, high: 77 },
  { name: "Mezzo-soprano", low: 57, high: 81 },
  { name: "Soprano", low: 60, high: 84 },
] as const;

export interface VoiceTypeGuess {
  label: string;
  note: string;
}

/**
 * The bottom of the range is set by anatomy while the top grows with training, so the low note
 * counts for more. Range alone cannot settle voice type, and the result says so.
 */
export function guessVoiceType(low: number, high: number): VoiceTypeGuess {
  const scored = TYPES.map((t) => ({ t, cost: Math.abs(low - t.low) + 0.5 * Math.abs(high - t.high) })).sort((a, b) => a.cost - b.cost);
  const [first, second] = scored;
  const close = second.cost - first.cost < 1.5;
  return {
    label: close ? `${first.t.name} or ${second.t.name.toLowerCase()}` : first.t.name,
    note: `Based on a comfortable range of ${noteName(low)} to ${noteName(high)}. Range is only a hint: where your voice sits most easily and where it switches from full to light decide the real answer.`,
  };
}

export const VOICE_BANDS = TYPES;
