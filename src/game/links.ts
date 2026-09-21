/**
 * Links people paste for a song they want to sing. YouTube can play inside the app through its
 * own embedded player; Spotify cannot (its player only runs in Spotify), so a Spotify link is
 * turned into a title and a YouTube search for the same song.
 */
export type SongLink =
  | { kind: "youtube"; id: string }
  | { kind: "spotify"; type: string; id: string; url: string };

const YT = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const SPOTIFY = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode)\/([A-Za-z0-9]+)/;
const SPOTIFY_URI = /^spotify:(track|album|playlist|episode):([A-Za-z0-9]+)$/;

export function parseLink(input: string): SongLink | null {
  const text = input.trim();
  if (!text) return null;
  const yt = YT.exec(text);
  if (yt) return { kind: "youtube", id: yt[1] };
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return { kind: "youtube", id: text };
  const sp = SPOTIFY.exec(text) ?? SPOTIFY_URI.exec(text);
  if (sp) return { kind: "spotify", type: sp[1], id: sp[2], url: `https://open.spotify.com/${sp[1]}/${sp[2]}` };
  return null;
}

/** The song's title as its service reports it, or null when that cannot be fetched. */
export async function lookupTitle(link: SongLink): Promise<string | null> {
  const url = link.kind === "youtube"
    ? `https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${link.id}`)}`
    : `https://open.spotify.com/oembed?url=${encodeURIComponent(link.url)}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    return data.title?.trim() || null;
  } catch {
    return null;
  }
}

export const youtubeSearchUrl = (query: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
