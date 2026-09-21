import { BUFFER_SIZE, type Frame, FrameAnalyser } from "./frame";

/**
 * Run the same analysis as the live path over a whole clip, with evenly spaced frames.
 * Frame times are the centre of each analysis window, so the pitch lines up with the audio.
 */
export function analysePcm(pcm: Float32Array, sampleRate: number, hop = 1024, gateDb = -60): Frame[] {
  const fa = new FrameAnalyser(sampleRate);
  fa.gateDb = gateDb;
  const buf = new Float32Array(BUFFER_SIZE);
  const frames: Frame[] = [];
  for (let end = BUFFER_SIZE; end <= pcm.length; end += hop) {
    buf.set(pcm.subarray(end - BUFFER_SIZE, end));
    frames.push(fa.analyse(buf, (end - BUFFER_SIZE / 2) / sampleRate));
  }
  return frames;
}

/** Decode any browser-playable audio blob into mono samples. */
export async function decodeClip(blob: Blob, ctx: BaseAudioContext) {
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const n = audio.length;
  const pcm = new Float32Array(n);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < n; i++) pcm[i] += d[i] / audio.numberOfChannels;
  }
  return { pcm, sampleRate: audio.sampleRate, duration: audio.duration };
}

/** Analyse a clip off the main thread. Falls back to inline analysis where workers are unavailable. */
export function analyseInWorker(pcm: Float32Array, sampleRate: number, gateDb: number): Promise<Frame[]> {
  if (typeof Worker === "undefined") return Promise.resolve(analysePcm(pcm, sampleRate, 1024, gateDb));
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<Frame[]>) => { resolve(e.data); w.terminate(); };
    w.onerror = (e) => { reject(e); w.terminate(); };
    w.postMessage({ pcm, sampleRate, gateDb }, [pcm.buffer]);
  });
}
