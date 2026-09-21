/** Plain words for how far off a note was, so the app never has to say "cents". */
export function offWords(cents: number): string {
  if (Number.isNaN(cents)) return "not sung";
  const a = Math.abs(cents);
  const dir = cents < 0 ? "flat" : "sharp";
  if (a < 12) return "spot on";
  if (a < 30) return `a touch ${dir}`;
  if (a < 60) return dir;
  if (a < 100) return `very ${dir}`;
  if (Math.abs(a - 1200) < 100) return "the right note an octave off";
  return `a whole note or more ${dir}`;
}

/** Plain words for how steady a held note was, from its spread. */
export function steadyWords(spreadCents: number): string {
  if (Number.isNaN(spreadCents)) return "";
  return spreadCents < 10 ? "very steady" : spreadCents < 18 ? "steady" : spreadCents < 30 ? "wavering" : "wandering";
}
