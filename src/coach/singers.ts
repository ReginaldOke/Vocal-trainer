/**
 * Well-known singers and the vocal ranges commonly reported for them, as MIDI note numbers.
 * These are approximate, drawn from live and studio recordings, and they cover the extremes a
 * singer has ever hit (falsetto and whistle included). A measured comfortable range will be
 * narrower than most of these, so comparisons go by where the voice sits, not how wide it is.
 */
export interface Singer {
  name: string;
  low: number;
  high: number;
  type: "bass" | "bass-baritone" | "baritone" | "tenor" | "contralto" | "mezzo-soprano" | "soprano";
}

const n = (name: string, low: number, high: number, type: Singer["type"]): Singer => ({ name, low, high, type });

export const SINGERS: Singer[] = [
  n("Barry White", 31, 57, "bass"),
  n("Leonard Cohen", 33, 59, "bass"),
  n("Johnny Cash", 36, 65, "bass-baritone"),
  n("Tom Waits", 29, 67, "bass-baritone"),
  n("Bing Crosby", 41, 65, "bass-baritone"),
  n("Frank Sinatra", 43, 67, "baritone"),
  n("Nat King Cole", 40, 67, "baritone"),
  n("Elvis Presley", 33, 71, "baritone"),
  n("Bob Dylan", 40, 67, "baritone"),
  n("Josh Groban", 41, 69, "baritone"),
  n("Eddie Vedder", 36, 74, "baritone"),
  n("Bruce Springsteen", 40, 72, "baritone"),
  n("Mick Jagger", 40, 72, "baritone"),
  n("James Hetfield", 40, 74, "baritone"),
  n("Kurt Cobain", 40, 76, "baritone"),
  n("David Bowie", 45, 83, "baritone"),
  n("Harry Styles", 40, 77, "baritone"),
  n("Dave Grohl", 40, 76, "baritone"),
  n("Andrea Bocelli", 43, 72, "tenor"),
  n("Luciano Pavarotti", 47, 77, "tenor"),
  n("Bob Marley", 45, 72, "tenor"),
  n("Elton John", 40, 76, "tenor"),
  n("Paul McCartney", 45, 77, "tenor"),
  n("John Lennon", 43, 76, "tenor"),
  n("Marvin Gaye", 38, 76, "tenor"),
  n("Justin Bieber", 43, 77, "tenor"),
  n("Ed Sheeran", 43, 83, "tenor"),
  n("Sam Smith", 41, 77, "tenor"),
  n("Ozzy Osbourne", 43, 76, "tenor"),
  n("Shawn Mendes", 45, 81, "tenor"),
  n("Thom Yorke", 45, 81, "tenor"),
  n("Chris Martin", 40, 81, "tenor"),
  n("The Weeknd", 43, 83, "tenor"),
  n("Stevie Wonder", 43, 83, "tenor"),
  n("Prince", 41, 83, "tenor"),
  n("Michael Jackson", 40, 86, "tenor"),
  n("Bruno Mars", 40, 86, "tenor"),
  n("Chris Cornell", 40, 88, "tenor"),
  n("Steven Tyler", 40, 88, "tenor"),
  n("Freddie Mercury", 41, 89, "tenor"),
  n("Robert Plant", 41, 89, "tenor"),
  n("Axl Rose", 29, 94, "tenor"),
  n("Cher", 47, 71, "contralto"),
  n("Toni Braxton", 47, 72, "contralto"),
  n("Karen Carpenter", 48, 72, "contralto"),
  n("Norah Jones", 50, 74, "contralto"),
  n("Amy Winehouse", 52, 74, "contralto"),
  n("Tina Turner", 43, 74, "contralto"),
  n("Billie Eilish", 48, 74, "mezzo-soprano"),
  n("Olivia Rodrigo", 50, 76, "mezzo-soprano"),
  n("Dua Lipa", 52, 76, "mezzo-soprano"),
  n("Taylor Swift", 55, 77, "mezzo-soprano"),
  n("Rihanna", 45, 77, "mezzo-soprano"),
  n("Alicia Keys", 45, 77, "mezzo-soprano"),
  n("Florence Welch", 47, 77, "mezzo-soprano"),
  n("Lady Gaga", 45, 79, "mezzo-soprano"),
  n("Adele", 48, 84, "mezzo-soprano"),
  n("Barbra Streisand", 52, 86, "mezzo-soprano"),
  n("Aretha Franklin", 43, 88, "mezzo-soprano"),
  n("Beyoncé", 45, 89, "mezzo-soprano"),
  n("Kelly Clarkson", 45, 89, "mezzo-soprano"),
  n("Sia", 52, 89, "soprano"),
  n("Björk", 52, 88, "soprano"),
  n("Celine Dion", 47, 88, "soprano"),
  n("Whitney Houston", 45, 91, "soprano"),
  n("Christina Aguilera", 48, 96, "soprano"),
  n("Ariana Grande", 50, 100, "soprano"),
  n("Mariah Carey", 43, 103, "soprano"),
];

/** Singers whose voices sit closest to a measured comfortable range. */
export function closestSingers(low: number, high: number, count = 5): Singer[] {
  const centre = (low + high) / 2;
  const span = high - low;
  return [...SINGERS]
    .map((s) => {
      // Where the voice sits matters most; a pro's extremes are always wider than a comfortable range.
      const sCentre = (s.low + s.high) / 2;
      const d = Math.abs(centre - sCentre) + 0.25 * Math.max(0, span - (s.high - s.low)) + 0.15 * Math.abs(low - s.low);
      return { s, d };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map((x) => x.s);
}
