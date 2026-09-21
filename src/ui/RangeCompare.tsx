import { useState } from "react";
import { noteName } from "../audio/pitch";
import { guessVoiceType } from "../coach/voiceType";
import { SINGERS, closestSingers } from "../coach/singers";

const LO = 33, HI = 96; // A1 to C7 on the chart
const pct = (m: number) => `${((Math.max(LO, Math.min(HI, m)) - LO) / (HI - LO)) * 100}%`;

/** The verdict after a range assessment, with famous company to keep. */
export function RangeCompare({ low, high, compact = false }: { low: number; high: number; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  const vt = guessVoiceType(low, high);
  const matches = closestSingers(low, high, 5);
  const matchSet = new Set(matches.map((m) => m.name));
  const rows = [...SINGERS].sort((a, b) => (a.low + a.high) - (b.low + b.high));
  const article = /^[aeiou]/i.test(vt.label) ? "an" : "a";

  return (
    <section className="compare">
      <div className="compare-head">
        <p className="eyebrow">Your voice</p>
        <h2>You're {article} {vt.label.toLowerCase()} 🎉</h2>
        <p className="fine">{noteName(low)} to {noteName(high)} · {Math.round(high - low)} semitones comfortable. {vt.note}</p>
      </div>

      <div className="compare-matches">
        <span className="setting-label">Voices like yours</span>
        <ul>
          {matches.map((m) => (
            <li key={m.name} className="pill gold">{m.name} <span className="fine">{noteName(m.low)}–{noteName(m.high)}</span></li>
          ))}
        </ul>
      </div>

      {compact && !open && <button className="small" onClick={() => setOpen(true)}>Compare with {SINGERS.length} singers</button>}
      {open && (
        <div className="compare-chart">
          <div className="compare-scale">{[36, 48, 60, 72, 84, 96].map((m) => <span key={m} style={{ left: pct(m) }}>{noteName(m)}</span>)}</div>
          <div className="compare-row you">
            <span className="compare-name">You</span>
            <span className="compare-track"><i style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} /></span>
          </div>
          {rows.map((s) => (
            <div key={s.name} className="compare-row" data-match={matchSet.has(s.name)}>
              <span className="compare-name">{s.name}</span>
              <span className="compare-track">
                <i style={{ left: pct(s.low), width: `calc(${pct(s.high)} - ${pct(s.low)})` }} />
                <em style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} />
              </span>
            </div>
          ))}
          <p className="fine">Singers' ranges are the widely reported extremes from recordings, falsetto and all. Yours is your comfortable range, so it reads narrower.</p>
        </div>
      )}
    </section>
  );
}
