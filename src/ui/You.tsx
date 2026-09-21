import type { Calibration } from "../audio/analysis";
import { guessVoiceType } from "../coach/voiceType";
import type { Priority } from "../coach/report";
import { ACHIEVEMENTS, levelFromXp, type Progress } from "../game/progress";
import { RangeCompare } from "./RangeCompare";

interface Props {
  progress: Progress;
  cal: Calibration | null;
  priorities: Priority[] | null;
  onAssess: () => void;
  onSettings: () => void;
}

const BADGE_ART: Record<string, string> = {
  "first-song": "🎤", "first-perfect": "🎯", "combo-10": "🔥", "combo-25": "⚡", "full-combo": "💎", fever: "✨", "five-stars": "🌟", "hard-clear": "👂", "ten-plays": "📅", "all-drills": "🧘",
};

export function You({ progress, cal, priorities, onAssess, onSettings }: Props) {
  const lvl = levelFromXp(progress.xp);
  const stars = Object.values(progress.best).reduce((s, b) => s + b.stars, 0);
  const unlocked = Object.keys(progress.achievements).length;
  const vt = cal ? guessVoiceType(cal.low, cal.high) : null;
  return (
    <main className="page">
      <div className="page-head">
        <h1>You</h1>
        <button className="small" onClick={onSettings}>Settings</button>
      </div>

      <section className="card you-hero">
        <div className="ring" style={{ "--pct": `${(lvl.into / lvl.need) * 100}%` } as React.CSSProperties}>
          <strong>{lvl.level}</strong>
          <span>level</span>
        </div>
        <div>
          <p className="fine">{lvl.need - lvl.into} XP to level {lvl.level + 1}</p>
          <div className="you-stats">
            <span className="pill gold">★ {stars}</span>
            <span className="pill peach">🎤 {progress.plays} takes</span>
            <span className="pill teal">🏅 {unlocked}/{ACHIEVEMENTS.length}</span>
          </div>
        </div>
      </section>

      <section className="card">
        {cal && vt ? (
          <>
            <RangeCompare low={cal.low} high={cal.high} compact />
            {priorities && priorities.length > 0 && (
              <ol className="priorities" style={{ marginTop: "1rem" }}>
                {priorities.slice(0, 3).map((p) => (
                  <li key={p.title}>
                    <h3>{p.title}</h3>
                    <p className="fine">{p.drill}</p>
                  </li>
                ))}
              </ol>
            )}
            <div className="actions" style={{ marginTop: "1rem" }}><button className="small" onClick={onAssess}>Assess again</button></div>
          </>
        ) : (
          <div className="page-head">
            <div>
              <h2>Find your range</h2>
              <p className="fine">Five minutes. Songs will then sit in your voice.</p>
            </div>
            <button className="primary" onClick={onAssess}>Assess my voice</button>
          </div>
        )}
      </section>

      <section className="badges-list">
        <h2 style={{ fontSize: "1.2rem", marginBottom: "0.6rem" }}>Badges</h2>
        <ul>
          {ACHIEVEMENTS.map((a) => (
            <li key={a.id} data-on={!!progress.achievements[a.id]}>
              <span className="art">{BADGE_ART[a.id] ?? "🏅"}</span>
              <strong>{a.title}</strong>
              <span>{a.blurb}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
