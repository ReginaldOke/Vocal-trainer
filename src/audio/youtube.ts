/**
 * A thin wrapper over YouTube's embedded player. The video plays in its own frame (YouTube's
 * terms need it visible); this only drives it: play, pause, seek, speed and, above all, volume,
 * so the song can sit quietly under the singer.
 */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData(): { title?: string };
  destroy(): void;
}

interface YTNamespace {
  Player: new (el: HTMLElement, opts: {
    videoId: string;
    width?: string | number;
    height?: string | number;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: () => void;
      onStateChange?: (e: { data: number }) => void;
      onError?: (e: { data: number }) => void;
    };
  }) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let api: Promise<YTNamespace> | null = null;

/** Loads YouTube's player script once. */
export function loadYouTube(): Promise<YTNamespace> {
  if (api) return api;
  api = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); if (window.YT) resolve(window.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => reject(new Error("YouTube's player could not be loaded. Check the connection."));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error("YouTube's player took too long to load.")), 15000);
  });
  return api;
}

export type PlayerState = "loading" | "ready" | "playing" | "paused" | "ended" | "error";

export class YouTubePlayer {
  private player: YTPlayer | null = null;
  private listeners = new Set<(s: PlayerState) => void>();
  state: PlayerState = "loading";
  error: string | null = null;
  title = "";

  async mount(el: HTMLElement, videoId: string) {
    const YT = await loadYouTube();
    return new Promise<void>((resolve, reject) => {
      this.player = new YT.Player(el, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, controls: 0, rel: 0, modestbranding: 1, disablekb: 1, fs: 0, origin: location.origin },
        events: {
          onReady: () => {
            this.title = this.player?.getVideoData().title ?? "";
            this.set("ready");
            resolve();
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) this.set("playing");
            else if (e.data === YT.PlayerState.PAUSED) this.set("paused");
            else if (e.data === YT.PlayerState.ENDED) this.set("ended");
          },
          onError: (e) => {
            this.error = e.data === 101 || e.data === 150
              ? "This video's owner does not allow it to play inside other apps. Try another upload of the song."
              : e.data === 100 ? "That video is private or has been removed." : "That video could not be played.";
            this.set("error");
            reject(new Error(this.error));
          },
        },
      });
    });
  }

  private set(s: PlayerState) {
    this.state = s;
    this.listeners.forEach((fn) => fn(s));
  }

  onChange(fn: (s: PlayerState) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  play() { this.player?.playVideo(); }
  pause() { this.player?.pauseVideo(); }
  seek(t: number) { this.player?.seekTo(Math.max(0, t), true); }
  /** 0..100 */
  setVolume(v: number) { this.player?.setVolume(Math.max(0, Math.min(100, Math.round(v)))); }
  setRate(r: number) { this.player?.setPlaybackRate(r); }
  time() { return this.player?.getCurrentTime() ?? 0; }
  duration() { return this.player?.getDuration() ?? 0; }
  destroy() {
    try { this.player?.destroy(); } catch { /* already gone */ }
    this.player = null;
    this.listeners.clear();
  }
}
