import { analysePcm } from "./offline";

const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown) => void };

scope.onmessage = (e: MessageEvent<{ pcm: Float32Array; sampleRate: number; gateDb: number }>) => {
  const { pcm, sampleRate, gateDb } = e.data;
  scope.postMessage(analysePcm(pcm, sampleRate, 1024, gateDb));
};
