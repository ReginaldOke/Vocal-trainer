import { useEffect, useState } from "react";
import { ChevronUp } from "lucide-react";
import type { Tip } from "../coach/rules";

/**
 * Where the coach speaks: a slim strip under the stage that never covers the notes. Collapsed it
 * shows one line; tap to read the whole thing. A fresh remark opens it briefly on its own.
 */
export function CoachDrawer({ tip, fallback, tone = "idle" }: { tip: Tip | null; fallback: string; tone?: Tip["tone"] | "idle" }) {
  const [open, setOpen] = useState(false);
  const text = tip ? tip.text : fallback;
  useEffect(() => {
    if (!tip) return;
    setOpen(true);
    const id = setTimeout(() => setOpen(false), 5000);
    return () => clearTimeout(id);
  }, [tip]);
  return (
    <button className="coach-drawer" data-tone={tip ? tip.tone : tone} data-open={open} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-live="polite">
      <span className="tip-mark" aria-hidden="true" />
      <span className="coach-text">{text}</span>
      <ChevronUp size={18} className="coach-chevron" aria-hidden="true" />
    </button>
  );
}
