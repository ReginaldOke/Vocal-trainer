/**
 * Songs to sing along with are real recordings, played by YouTube's own player. The app keeps
 * only a title and the video's id; nothing of the song itself is stored or shipped.
 */
export interface Track {
  id: string;
  title: string;
  artist?: string;
  /** added by the singer; kept in this browser only */
  mine?: boolean;
}

/** A starting shelf of well-known songs, each an official upload. */
export const STARTERS: Track[] = [
  { id: "A_MjCqQoLLA", title: "Hey Jude", artist: "The Beatles" },
  { id: "QDYfEBY9NM4", title: "Let It Be", artist: "The Beatles" },
  { id: "KQetemT1sWc", title: "Here Comes the Sun", artist: "The Beatles" },
  { id: "UelDrZ1aFeY", title: "Something", artist: "The Beatles" },
  { id: "Man4Xw8Xypo", title: "Blackbird", artist: "The Beatles" },
  { id: "45cYwDMibGo", title: "Come Together", artist: "The Beatles" },
  { id: "YkgkThdzX-8", title: "Imagine", artist: "John Lennon" },
  { id: "vGJTaP6anOU", title: "Can't Help Falling in Love", artist: "Elvis Presley" },
  { id: "fOZ-MySzAac", title: "Lean on Me", artist: "Bill Withers" },
  { id: "hLQl3WQQoQ0", title: "Someone Like You", artist: "Adele" },
  { id: "bx1Bh8ZvH84", title: "Wonderwall", artist: "Oasis" },
  { id: "yKNxeF4KMsY", title: "Yellow", artist: "Coldplay" },
];

const KEY = "vocal-coach-simple.tracks";
export function loadTracks(): Track[] {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? "[]") as Track[]).map((t) => ({ ...t, mine: true })); } catch { return []; }
}
export function saveTracks(tracks: Track[]) {
  try { localStorage.setItem(KEY, JSON.stringify(tracks)); } catch { /* storage blocked */ }
}

export const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

const YT = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const SPOTIFY = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(?:track|album|playlist|episode)\/[A-Za-z0-9]+|^spotify:(?:track|album|playlist|episode):[A-Za-z0-9]+$/;

/** "Artist - Artist - Song (Official Video) [Remastered]" becomes "Artist - Song". */
export function tidy(title: string) {
  let t = title.replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s{2,}/g, " ").trim();
  const parts = t.split(" - ");
  if (parts.length > 2 && parts[0] === parts[1]) t = parts.slice(1).join(" - ");
  return t || title;
}

async function json<T>(url: string): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Public search services, tried in turn. They come and go, so a failure just moves on to the next. */
const SEARCH = ["https://api.piped.private.coffee", "https://pipedapi.kavin.rocks", "https://pipedapi.adminforge.de"];

async function search(query: string): Promise<Track[]> {
  for (const base of SEARCH) {
    const data = await json<{ items?: { url?: string; title?: string; uploaderName?: string; type?: string }[] }>(`${base}/search?q=${encodeURIComponent(query)}&filter=videos`);
    const found = (data?.items ?? [])
      .map((it) => ({ id: /[?&]v=([A-Za-z0-9_-]{11})/.exec(it.url ?? "")?.[1] ?? "", title: tidy(it.title ?? ""), artist: (it.uploaderName ?? "").replace(/ - Topic$|VEVO$/i, "") }))
      .filter((t) => t.id && t.title);
    if (found.length) return found.slice(0, 6).map((t) => ({ ...t, mine: true }));
  }
  return [];
}

/**
 * Turn whatever was typed into songs to choose from: a YouTube link is the song itself, a Spotify
 * link is looked up by its title, and anything else is searched for by name.
 */
export async function find(input: string): Promise<{ tracks: Track[]; error?: string }> {
  const text = input.trim();
  if (!text) return { tracks: [] };
  const yt = YT.exec(text) ?? (/^[A-Za-z0-9_-]{11}$/.test(text) ? [text, text] : null);
  if (yt) {
    const meta = await json<{ title?: string; author_name?: string }>(`https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${yt[1]}`)}`);
    return { tracks: [{ id: yt[1], title: tidy(meta?.title ?? "Song"), artist: meta?.author_name?.replace(/ - Topic$|VEVO$/i, ""), mine: true }] };
  }
  let query = text;
  if (SPOTIFY.test(text)) {
    const url = text.startsWith("spotify:") ? `https://open.spotify.com/${text.split(":").slice(1).join("/")}` : text;
    const meta = await json<{ title?: string }>(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
    if (!meta?.title) return { tracks: [], error: "That Spotify link could not be read." };
    query = meta.title;
  } else if (/^https?:\/\//i.test(text)) {
    return { tracks: [], error: "That link is not from YouTube or Spotify." };
  }
  const tracks = await search(query);
  return tracks.length ? { tracks } : { tracks: [], error: "Search is not answering. Paste a YouTube link instead." };
}
