import type { Frame } from "./frame";

/**
 * Lets only singing through. The pitch detector will happily report a pitch for a fan, a fridge,
 * traffic or a door, and any of those used to move the song along. A frame counts as sung only
 * when it is clearly louder than the room, and a note only starts once that sound has held a
 * steady pitch for a moment; everything else is treated as silence.
 */
export class VoiceGate {
  /** the room's background level in dBFS, updated by whoever measures it */
  floorDb = -60;
  /** how far above the room a sound must be to count; lowered for hums and quiet drills */
  marginDb = 12;
  /**
   * How long a fresh sound must hold a pitch before it counts as the start of a note. The analysis
   * window is ~90 ms, so a click or a short clatter can look pitched for a tenth of a second.
   */
  onsetSeconds = 0.2;
  /** and over how many analysis frames at least, since frames can be sparse */
  onsetFrames = 3;

  private lastT = -1;
  private quietFor = 1;
  private voicedFor = 0;
  private voicedFrames = 0;
  private pending = true;
  private ref = NaN;
  /** frames of a sound that has not yet proved itself; released in order once it has */
  private held: Frame[] = [];

  reset() {
    this.lastT = -1;
    this.quietFor = 1;
    this.voicedFor = 0;
    this.voicedFrames = 0;
    this.pending = true;
    this.ref = NaN;
    this.held = [];
  }

  /**
   * The frames to process for this input, in order: usually just the frame itself, nothing while
   * a new sound is still being weighed up, and the whole held run once it counts as voice. Frames
   * that turn out to be noise come back as silence so timelines stay continuous.
   */
  apply(f: Frame): Frame[] {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, f.t - this.lastT);
    this.lastT = f.t;
    const loud = f.db >= this.floorDb + this.marginDb;
    if (!f.voiced || !loud) {
      if (!loud) this.quietFor += dt;
      this.voicedFor = 0;
      this.voicedFrames = 0;
      this.ref = NaN;
      // After a pause, the next sound has to prove itself again.
      if (this.quietFor >= 0.1) this.pending = true;
      const out = this.flushAsSilence();
      out.push(f.voiced ? silent(f) : f);
      return out;
    }
    this.quietFor = 0;
    // Noise wanders in pitch from frame to frame; a voice, even scooping, moves smoothly.
    const erratic = !Number.isNaN(this.ref) && Math.abs(f.midi - this.ref) > 2;
    this.ref = f.midi;
    if (!this.pending) return [f];
    let out: Frame[] = [];
    if (erratic) { out = this.flushAsSilence(); this.voicedFor = 0; this.voicedFrames = 0; }
    this.voicedFor += dt;
    this.voicedFrames++;
    this.held.push(f);
    if (this.voicedFor < this.onsetSeconds || this.voicedFrames < this.onsetFrames) return out;
    this.pending = false;
    out.push(...this.held);
    this.held = [];
    return out;
  }

  private flushAsSilence() {
    const out = this.held.map(silent);
    this.held = [];
    return out;
  }
}

const silent = (f: Frame): Frame => ({ ...f, voiced: false, midi: NaN });
