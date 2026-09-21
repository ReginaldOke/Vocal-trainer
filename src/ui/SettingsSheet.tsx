import type { GuideMode } from "../audio/guide";
import type { Settings } from "../game/progress";
import { DIFFICULTIES } from "../game/scoring";
import type { VoicePreset } from "../game/songs";

interface Props {
  settings: Settings;
  calibrated: boolean;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onClose: () => void;
}

const VOICE: { id: VoicePreset; text: string }[] = [
  { id: "low", text: "Low" }, { id: "mid", text: "Mid" }, { id: "high", text: "High" }, { id: "auto", text: "My range" },
];
const GUIDE: { id: GuideMode; text: string }[] = [{ id: "off", text: "Off" }, { id: "quiet", text: "Quiet" }, { id: "full", text: "Headphones" }];

function Chips<T extends string>({ value, options, onPick }: { value: T; options: { id: T; text: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="chips">
      {options.map((o) => <button key={o.id} className="chip" data-on={o.id === value} onClick={() => onPick(o.id)}>{o.text}</button>)}
    </div>
  );
}

/** Every knob in one place, so the song list stays clean. */
export function SettingsSheet({ settings, calibrated, onChange, onClose }: Props) {
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Settings</h2>
          <button className="small" onClick={onClose}>Done</button>
        </div>

        <div className="setting">
          <span className="setting-label">Pace</span>
          <Chips value={settings.mode} options={[{ id: "flow", text: "Notes wait for me" }, { id: "tempo", text: "In tempo" }]} onPick={(v) => onChange("mode", v)} />
          <p className="fine">{settings.mode === "flow" ? "Each note sits on the line until you have sung it." : "Notes scroll at the song's speed with a count-in."}</p>
        </div>

        <div className="setting">
          <span className="setting-label">Difficulty</span>
          <Chips value={settings.difficulty} options={DIFFICULTIES.map((d) => ({ id: d.id, text: d.label }))} onPick={(v) => onChange("difficulty", v)} />
          <p className="fine">{DIFFICULTIES.find((d) => d.id === settings.difficulty)?.blurb}</p>
        </div>

        <div className="setting">
          <span className="setting-label">Voice</span>
          <div className="chips">
            <Chips value={settings.voice} options={VOICE.filter((v) => v.id !== "auto" || calibrated)} onPick={(v) => onChange("voice", v)} />
            <span className="chips" style={{ marginLeft: "auto" }}>
              <button className="chip" onClick={() => onChange("transpose", Math.max(-6, settings.transpose - 1))} aria-label="Lower the key">−</button>
              <span className="chip-value">{settings.transpose > 0 ? `+${settings.transpose}` : settings.transpose}</span>
              <button className="chip" onClick={() => onChange("transpose", Math.min(6, settings.transpose + 1))} aria-label="Raise the key">+</button>
            </span>
          </div>
          {!calibrated && <p className="fine">Assess your voice on the You tab and songs will sit in your measured range.</p>}
        </div>

        <div className="setting">
          <span className="setting-label">Backing</span>
          <Chips value={settings.backing} options={[{ id: "piano", text: "Piano chords" }, { id: "tone", text: "Guide tone" }]} onPick={(v) => onChange("backing", v)} />
          <Chips value={settings.guide} options={GUIDE} onPick={(v) => onChange("guide", v)} />
          <p className="fine">{settings.guide === "quiet" ? "Plays softly through your speakers and ducks under your voice." : settings.guide === "full" ? "Full volume. Use headphones so the mic does not hear it." : "Nothing plays under you."}</p>
        </div>

        <div className="setting">
          <span className="setting-label">Extras</span>
          {settings.mode === "tempo" && <label className="check"><input type="checkbox" checked={settings.metronome} onChange={(e) => onChange("metronome", e.target.checked)} /> Click track</label>}
          <label className="check"><input type="checkbox" checked={settings.buddyVoice} onChange={(e) => onChange("buddyVoice", e.target.checked)} /> Pip sings along (headphones only)</label>
        </div>
      </div>
    </div>
  );
}
