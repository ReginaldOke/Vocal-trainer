import { noteName } from "../audio/pitch";
import type { Register } from "../audio/analysis";
import { VOICE_BANDS } from "../coach/voiceType";
import type { Tip } from "../coach/rules";
import { offWords, steadyWords } from "../coach/words";

export interface Readout {
  voiced: boolean;
  midi: number;
  /** cents from the target if there is one, otherwise from the nearest note */
  cents: number;
  hasTarget: boolean;
  steadiness: number;
  register: Register;
  strain: number;
  db: number;
}

export function NoteReadout({ r }: { r: Readout }) {
  const cents = r.voiced ? Math.max(-50, Math.min(50, r.cents)) : 0;
  const off = Math.abs(r.cents);
  const state = !r.voiced ? "idle" : off <= 12 ? "ok" : off <= 30 ? "warn" : "bad";
  return (
    <section className="readout" aria-live="off">
      <div className="note-name" data-state={state}>{r.voiced ? noteName(r.midi) : "–"}</div>
      <div className="tuner" aria-hidden="true">
        <div className="tuner-scale"><span>flat</span><span>{r.hasTarget ? "target" : "in tune"}</span><span>sharp</span></div>
        <div className="tuner-track">
          <div className="tuner-zone" />
          <div className="tuner-needle" data-state={state} style={{ left: `${50 + cents}%`, opacity: r.voiced ? 1 : 0.25 }} />
        </div>
      </div>
      <p className="cents">{r.voiced ? offWords(r.cents) : "Sing a note"}</p>
    </section>
  );
}

const steadinessWord = (c: number) => (Number.isNaN(c) ? "Hold a note to measure" : steadyWords(c).replace(/^\w/, (m) => m.toUpperCase()));

export function Meters({ r }: { r: Readout }) {
  const steadyPct = Number.isNaN(r.steadiness) ? 0 : Math.max(4, 100 - Math.min(100, r.steadiness * 2.2));
  return (
    <section className="meters">
      <div className="meter">
        <div className="meter-head"><span>Steadiness</span><span>{steadyWords(r.steadiness)}</span></div>
        <div className="bar"><div className="bar-fill" data-state={r.steadiness < 18 ? "ok" : r.steadiness < 30 ? "warn" : "bad"} style={{ width: `${steadyPct}%` }} /></div>
        <p className="meter-note">{steadinessWord(r.steadiness)}</p>
      </div>
      <div className="meter">
        <div className="meter-head"><span>Voice (a guess)</span></div>
        <div className="register" data-register={r.voiced ? r.register : "unknown"}>
          {([["chest", "full"], ["mix", "blended"], ["head", "light"]] as const).map(([k, word]) => <span key={k} data-on={r.voiced && r.register === k}>{word}</span>)}
        </div>
      </div>
      <div className="meter">
        <div className="meter-head"><span>Effort</span><span>{r.strain > 0.55 ? "Pushing" : r.strain > 0.3 ? "Working hard" : "Easy"}</span></div>
        <div className="bar"><div className="bar-fill" data-state={r.strain > 0.55 ? "bad" : r.strain > 0.3 ? "warn" : "ok"} style={{ width: `${Math.max(4, r.strain * 100)}%` }} /></div>
      </div>
    </section>
  );
}

export function TipCard({ tip, fallback }: { tip: Tip | null; fallback: string }) {
  return (
    <div className="tip" data-tone={tip?.tone ?? "idle"} role="status" aria-live="polite">
      <span className="tip-mark" aria-hidden="true" />
      <p>{tip ? tip.text : fallback}</p>
    </div>
  );
}

/** A strip of keyboard showing the measured range against the usual voice types. */
export function RangeBar({ low, high, current }: { low: number; high: number; current: number | null }) {
  const lo = 36, hi = 84;
  const pct = (m: number) => `${((m - lo) / (hi - lo)) * 100}%`;
  const has = Number.isFinite(low) && Number.isFinite(high) && high > low;
  return (
    <section className="rangebar">
      <div className="meter-head"><span>Range</span><span>{has ? `${noteName(low)} to ${noteName(high)}` : Number.isFinite(low) ? `${noteName(low)} and up` : "Not measured yet"}</span></div>
      <div className="range-track">
        {VOICE_BANDS.map((b, i) => (
          <div key={b.name} className="range-band" style={{ left: pct(b.low), width: `calc(${pct(b.high)} - ${pct(b.low)})`, top: `${i * 5 + 2}px` }} title={b.name} />
        ))}
        {has && <div className="range-you" style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} />}
        {current !== null && <div className="range-now" style={{ left: pct(Math.max(lo, Math.min(hi, current))) }} />}
      </div>
      <div className="range-legend"><span>C2</span><span>C3</span><span>C4</span><span>C5</span><span>C6</span></div>
      <p className="meter-note">Grey lines, top to bottom: typical ranges from the lowest voices to the highest.</p>
    </section>
  );
}
