/**
 * A small harmoniser: picks a diatonic chord under each melody note so the accompaniment
 * follows the tune. Folk melodies sit on I, IV and V almost everywhere; vi and ii cover the rest.
 */
export type ChordMode = "major" | "minor";

interface ChordShape { name: string; root: number; tones: number[] }

const MAJOR: ChordShape[] = [
  { name: "I", root: 0, tones: [0, 4, 7] },
  { name: "V", root: 7, tones: [7, 11, 2] },
  { name: "IV", root: 5, tones: [5, 9, 0] },
  { name: "vi", root: 9, tones: [9, 0, 4] },
  { name: "ii", root: 2, tones: [2, 5, 9] },
];
const MINOR: ChordShape[] = [
  { name: "i", root: 0, tones: [0, 3, 7] },
  { name: "iv", root: 5, tones: [5, 8, 0] },
  { name: "v", root: 7, tones: [7, 10, 2] },
  { name: "VI", root: 8, tones: [8, 0, 3] },
  { name: "III", root: 3, tones: [3, 7, 10] },
];

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** The chord to play under `midi`, keeping `prev` when it still fits so the harmony does not churn. */
export function chordFor(midi: number, tonic: number, mode: ChordMode, prev: ChordShape | null): ChordShape {
  const degree = mod12(midi - tonic);
  const shapes = mode === "minor" ? MINOR : MAJOR;
  if (prev && prev.tones.includes(degree)) return prev;
  return shapes.find((c) => c.tones.includes(degree)) ?? shapes[0];
}

/**
 * Voice a chord for the piano: a bass note well under the melody, the chord tones in the octave
 * below the melody, and the melody note itself on top so the singer still hears their pitch.
 */
export function voiceChord(chord: ChordShape, midi: number, tonic: number): number[] {
  const bass = tonic + chord.root - 12 - (tonic + chord.root - 12 > midi - 10 ? 12 : 0);
  const inner: number[] = [];
  for (const t of chord.tones) {
    let p = tonic + t;
    while (p >= midi) p -= 12;
    while (p < midi - 12) p += 12;
    if (p !== midi && !inner.includes(p)) inner.push(p);
  }
  return [bass, ...inner.sort((a, b) => a - b), midi];
}

export type { ChordShape };
