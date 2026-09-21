import type { Calibration } from "../audio/analysis";
import { guessVoiceType } from "../coach/voiceType";
import type { Priority } from "../coach/report";
import { ACHIEVEMENTS, levelFromXp, type Progress } from "../game/progress";
import { RangeCompare } from "./RangeCompare";
import { accuracyByDay, weeklyPlan } from "../game/plan";
import { useEffect, useState } from "react";
import { getCode, getSyncState, onSyncState, syncEnabled, useCode, type SyncState } from "../game/sync";
import { Copy, Check, RefreshCw } from "lucide-react";
import { Star, Mic, Award, Target, Flame, Zap, Gem, Sparkles, Ear, CalendarDays, Dumbbell, Settings, type LucideIcon } from "lucide-react";

interface Props {
  progress: Progress;
  cal: Calibration | null;
  priorities: Priority[] | null;
  onAssess: () => void;
  onSettings: () => void;
  /** progress loaded from another device's code */
  onAdopt: (p: Progress) => void;
}

const BADGE_ART: Record<string, LucideIcon> = {
  "first-song": Mic, "first-perfect": Target, "combo-10": Flame, "combo-25": Zap, "full-combo": Gem, fever: Sparkles, "five-stars": Star, "hard-clear": Ear, "ten-plays": CalendarDays, "all-drills": Dumbbell,
};

function SyncCard({ onAdopt }: { onAdopt: (p: Progress) => void }) {
  const [state, setState] = useState<SyncState>(getSyncState());
  const [entered, setEntered] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => onSyncState(setState), []);
  const code = getCode();
  const enabled = syncEnabled();
  const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  const load = async () => {
    setBusy(true); setNote(null);
    try {
      const p = await useCode(entered);
      if (p) { onAdopt(p); setNote("Loaded. This device now saves to that code."); setEntered(""); }
      else setNote("Nothing saved under that code yet.");
    } catch { setNote("Could not reach the server."); }
    setBusy(false);
  };
  const when = state.at ? new Date(state.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <section className="card sync">
      <div className="page-head" style={{ marginBottom: "0.5rem" }}>
        <h2>Your sync code</h2>
        <span className={`pill ${state.status === "saved" ? "teal" : state.status === "error" ? "peach" : ""}`}>
          {!enabled ? "Saving on this device only" : state.status === "saving" ? "Saving…" : state.status === "saved" ? `Saved ${when}` : state.status === "error" ? "Not saved" : "Ready"}
        </span>
      </div>
      <div className="sync-code">
        <code>{code}</code>
        <button className="small" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="fine">{enabled ? "Type this code on another phone or computer to pick up where you left off. No account needed; keep the code private." : "Sync is not set up for this build yet. Your progress stays in this browser."}</p>
      {enabled && (
        <div className="sync-enter">
          <input value={entered} onChange={(e) => setEntered(e.target.value.toUpperCase())} placeholder="Code from another device" aria-label="Sync code from another device" />
          <button className="small" disabled={busy || entered.replace(/[^A-Z0-9]/g, "").length < 8} onClick={() => void load()}><RefreshCw size={16} /> Load</button>
        </div>
      )}
      {note && <p className="fine">{note}</p>}
    </section>
  );
}

export function You({ progress, cal, priorities, onAssess, onSettings, onAdopt }: Props) {
  const lvl = levelFromXp(progress.xp);
  const stars = Object.values(progress.best).reduce((s, b) => s + b.stars, 0);
  const unlocked = Object.keys(progress.achievements).length;
  const vt = cal ? guessVoiceType(cal.low, cal.high) : null;
  const plan = weeklyPlan(progress);
  const days = accuracyByDay(progress, 28);
  const sung = days.filter((d) => !Number.isNaN(d.accuracy));
  const W = 560, H = 120, pad = 8;
  const px = (i: number) => pad + (i / (days.length - 1)) * (W - 2 * pad);
  const py = (a: number) => H - pad - a * (H - 2 * pad);
  const path = sung.map((d, k) => `${k ? "L" : "M"}${px(days.indexOf(d)).toFixed(1)},${py(d.accuracy).toFixed(1)}`).join(" ");
  return (
    <main className="page">
      <div className="page-head">
        <h1>You</h1>
        <button className="small" onClick={onSettings}><Settings size={16} /> Settings</button>
      </div>

      <section className="card you-hero">
        <div className="ring" style={{ "--pct": `${(lvl.into / lvl.need) * 100}%` } as React.CSSProperties}>
          <strong>{lvl.level}</strong>
          <span>level</span>
        </div>
        <div>
          <p className="fine">{lvl.need - lvl.into} XP to level {lvl.level + 1}</p>
          <div className="you-stats">
            <span className="pill gold"><Star size={14} strokeWidth={2.5} /> {stars}</span>
            <span className="pill peach"><Mic size={14} strokeWidth={2.5} /> {progress.plays} takes</span>
            <span className="pill teal"><Award size={14} strokeWidth={2.5} /> {unlocked}/{ACHIEVEMENTS.length}</span>
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

      <section className="card">
        <div className="page-head" style={{ marginBottom: "0.6rem" }}>
          <h2>This week</h2>
          <span className="pill">{plan.reduce((s, i) => s + Math.min(i.done, i.goal), 0)}/{plan.reduce((s, i) => s + i.goal, 0)} done</span>
        </div>
        <ul className="plan">
          {plan.map((i) => (
            <li key={i.id} data-done={i.done >= i.goal}>
              <span className="plan-check" aria-hidden="true">{i.done >= i.goal ? "✓" : `${Math.min(i.done, i.goal)}/${i.goal}`}</span>
              <div><strong>{i.title}</strong><span className="fine">{i.why}</span></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="page-head" style={{ marginBottom: "0.4rem" }}>
          <h2>Last four weeks</h2>
          <span className="fine">{sung.length ? `${progress.history.filter((r) => Date.now() - r.at < 28 * 24 * 3600e3).length} takes` : "No takes yet"}</span>
        </div>
        <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Accuracy over the last four weeks">
          {[0.25, 0.5, 0.75, 1].map((a) => <line key={a} x1={pad} x2={W - pad} y1={py(a)} y2={py(a)} stroke="currentColor" strokeOpacity={a === 1 ? 0.25 : 0.1} />)}
          {sung.length > 1 && <path d={path} fill="none" stroke="var(--teal)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
          {sung.map((d) => <circle key={d.day} cx={px(days.indexOf(d))} cy={py(d.accuracy)} r={3.5} fill="var(--gold)" />)}
        </svg>
        <div className="range-legend"><span>4 weeks ago</span><span>on the note</span><span>today</span></div>
      </section>

      <SyncCard onAdopt={onAdopt} />

      <section className="badges-list">
        <h2 style={{ fontSize: "1.2rem", marginBottom: "0.6rem" }}>Badges</h2>
        <ul>
          {ACHIEVEMENTS.map((a) => (
            <li key={a.id} data-on={!!progress.achievements[a.id]}>
              <span className="art">{(() => { const I = BADGE_ART[a.id] ?? Award; return <I size={18} />; })()}</span>
              <strong>{a.title}</strong>
              <span>{a.blurb}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
