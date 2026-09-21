/**
 * Turn a Standard MIDI File into a Song the highway can play. Picks the most vocal-looking track,
 * flattens it to one voice, attaches karaoke lyrics where the file has them, and guesses the key
 * so the piano can harmonise it. Nothing here is shipped with the app: the singer brings the file.
 */
import type { Song, SongStep } from "./songs";

interface RawNote { midi: number; on: number; off: number; ch: number }
interface Track { name: string; notes: RawNote[]; lyrics: { tick: number; text: string }[] }

class Reader {
  pos = 0;
  constructor(private d: DataView) {}
  get eof() { return this.pos >= this.d.byteLength; }
  u8() { return this.d.getUint8(this.pos++); }
  u16() { const v = this.d.getUint16(this.pos); this.pos += 2; return v; }
  u32() { const v = this.d.getUint32(this.pos); this.pos += 4; return v; }
  str(n: number) { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8()); return s; }
  vlq() { let v = 0; for (;;) { const b = this.u8(); v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) return v; } }
  skip(n: number) { this.pos += n; }
}

function decodeText(bytes: number[]) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)); }
  catch { return new TextDecoder("latin1").decode(new Uint8Array(bytes)); }
}

export function parseMidi(buf: ArrayBuffer) {
  const r = new Reader(new DataView(buf));
  if (r.str(4) !== "MThd") throw new Error("Not a MIDI file");
  const hlen = r.u32();
  r.u16(); // format
  const ntrks = r.u16();
  const division = r.u16();
  r.skip(hlen - 6);
  if (division & 0x8000) throw new Error("SMPTE-timed MIDI files are not supported");
  const tpq = division || 480;

  const tempos: { tick: number; usPerQuarter: number }[] = [{ tick: 0, usPerQuarter: 500000 }];
  const tracks: Track[] = [];
  for (let t = 0; t < ntrks && !r.eof; t++) {
    if (r.str(4) !== "MTrk") break;
    const len = r.u32();
    const end = r.pos + len;
    const track: Track = { name: "", notes: [], lyrics: [] };
    const open = new Map<string, RawNote>();
    let tick = 0, status = 0;
    while (r.pos < end) {
      tick += r.vlq();
      let b = r.u8();
      if (b === 0xff) {
        const type = r.u8();
        const n = r.vlq();
        const bytes: number[] = [];
        for (let i = 0; i < n; i++) bytes.push(r.u8());
        if (type === 0x51 && n === 3) tempos.push({ tick, usPerQuarter: (bytes[0] << 16) | (bytes[1] << 8) | bytes[2] });
        else if (type === 0x03) track.name = decodeText(bytes);
        else if (type === 0x05 || type === 0x01) { const text = decodeText(bytes); if (text.trim()) track.lyrics.push({ tick, text }); }
        continue;
      }
      if (b === 0xf0 || b === 0xf7) { r.skip(r.vlq()); continue; }
      if (b & 0x80) status = b; else r.pos--;
      const kind = status >> 4, ch = status & 0x0f;
      if (kind === 0x9 || kind === 0x8) {
        const midi = r.u8(), vel = r.u8();
        const key = `${ch}:${midi}`;
        if (kind === 0x9 && vel > 0) {
          const prev = open.get(key);
          if (prev) { prev.off = tick; track.notes.push(prev); }
          open.set(key, { midi, on: tick, off: -1, ch });
        } else {
          const note = open.get(key);
          if (note) { note.off = tick; track.notes.push(note); open.delete(key); }
        }
      } else if (kind === 0xa || kind === 0xb || kind === 0xe) r.skip(2);
      else if (kind === 0xc || kind === 0xd) r.skip(1);
      else { b = 0; }
    }
    for (const n of open.values()) { n.off = tick; track.notes.push(n); }
    r.pos = end;
    tracks.push(track);
  }
  tempos.sort((a, b) => a.tick - b.tick);
  // Seconds for a tick, honouring tempo changes.
  const toSeconds = (tick: number) => {
    let secs = 0, lastTick = 0, us = tempos[0].usPerQuarter;
    for (const t of tempos) {
      if (t.tick >= tick) break;
      secs += ((t.tick - lastTick) / tpq) * (us / 1e6);
      lastTick = t.tick;
      us = t.usPerQuarter;
    }
    return secs + ((tick - lastTick) / tpq) * (us / 1e6);
  };
  return { tracks, tpq, toSeconds, bpm: Math.round(6e7 / tempos[0].usPerQuarter) };
}

const VOCAL = /vocal|melody|lead|voice|sing|vox|tune|karaoke/i;

/** Which track a singer would sing: named for it if possible, otherwise the tune-shaped one. */
function pickMelody(tracks: Track[]) {
  let best: Track | null = null, bestScore = -Infinity;
  for (const t of tracks) {
    const notes = t.notes.filter((n) => n.ch !== 9);
    if (notes.length < 8) continue;
    const sorted = [...notes].sort((a, b) => a.on - b.on);
    let overlaps = 0;
    for (let i = 1; i < sorted.length; i++) if (sorted[i].on < sorted[i - 1].off) overlaps++;
    const mono = 1 - overlaps / sorted.length;
    const mean = notes.reduce((s, n) => s + n.midi, 0) / notes.length;
    const score = (VOCAL.test(t.name) ? 10 : 0) + mono * 3 + (mean / 127) * 2 + Math.min(1, notes.length / 100);
    if (score > bestScore) { bestScore = score; best = { ...t, notes }; }
  }
  return best;
}

/** Krumhansl key profiles: which key fits the pitch-class weight best. */
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function guessKey(notes: { midi: number; dur: number }[]) {
  const w = new Array(12).fill(0);
  for (const n of notes) w[((n.midi % 12) + 12) % 12] += n.dur;
  const corr = (profile: number[], shift: number) => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += w[(i + shift) % 12] * profile[i];
    return s;
  };
  let best = { pc: 0, mode: "major" as "major" | "minor", score: -Infinity };
  for (let pc = 0; pc < 12; pc++) {
    const a = corr(MAJ, pc), b = corr(MIN, pc);
    if (a > best.score) best = { pc, mode: "major", score: a };
    if (b > best.score) best = { pc, mode: "minor", score: b };
  }
  return best;
}

export function songFromMidi(buf: ArrayBuffer, filename: string): Song {
  const { tracks, tpq, toSeconds, bpm } = parseMidi(buf);
  const track = pickMelody(tracks);
  if (!track) throw new Error("No melody track found in this file");

  // One voice: at overlaps keep the higher note and cut it at the next onset.
  const sorted = [...track.notes].sort((a, b) => a.on - b.on || b.midi - a.midi);
  const mono: RawNote[] = [];
  for (const n of sorted) {
    const last = mono[mono.length - 1];
    if (last && n.on < last.off) {
      if (n.on === last.on) continue; // chord: keep the higher note already there
      last.off = n.on;
    }
    mono.push({ ...n });
  }
  const notes = mono.filter((n) => n.off > n.on).map((n) => ({ midi: n.midi, start: toSeconds(n.on), dur: toSeconds(n.off) - toSeconds(n.on), tick: n.on }));
  if (notes.length < 4) throw new Error("The melody track is too short");

  // Lyrics from any track; karaoke files use "/" and "\\" for line breaks.
  const lyrics = tracks.flatMap((t) => t.lyrics).sort((a, b) => a.tick - b.tick);
  const tol = tpq / 4;
  const lyricFor = (tick: number) => {
    let best: { tick: number; text: string } | null = null;
    for (const l of lyrics) { if (Math.abs(l.tick - tick) <= tol && (!best || Math.abs(l.tick - tick) < Math.abs(best.tick - tick))) best = l; }
    return best ? best.text.replace(/^[/\\]+/, "").trim() || null : null;
  };

  const base = Math.min(...notes.map((n) => n.midi));
  const key = guessKey(notes);
  const beat = 60 / bpm;
  const steps: SongStep[] = [];
  let t = notes[0].start;
  for (const n of notes) {
    if (n.start - t > 0.02) steps.push([null, (n.start - t) / beat]);
    steps.push([n.midi - base, Math.max(0.08, n.dur) / beat, lyricFor(n.tick) ?? undefined]);
    t = n.start + Math.max(0.08, n.dur);
  }
  const title = filename.replace(/\.(mid|midi|kar)$/i, "").replace(/[_-]+/g, " ").trim() || "Imported song";
  const span = Math.max(...notes.map((n) => n.midi)) - base;
  const tier = (span >= 17 || notes.length > 250 ? 5 : span >= 12 || notes.length > 120 ? 4 : span >= 9 ? 3 : 2) as Song["tier"];
  return {
    id: `custom-${Date.now().toString(36)}`,
    title,
    credit: `From ${filename}`,
    kind: "song",
    tier,
    bpm,
    beatsPerBar: 4,
    mode: key.mode,
    keyOffset: ((key.pc - base) % 12 + 12) % 12,
    blurb: `${notes.length} notes, ${Math.round(notes[notes.length - 1].start - notes[0].start)} seconds.`,
    steps,
    custom: true,
  };
}
