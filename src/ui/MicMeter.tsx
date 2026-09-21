import { useEffect, useRef } from "react";
import type { AvatarState } from "./SingerAvatar";

/** A small live level bar so a singer can see whether the app is hearing them at all. */
export function MicMeter({ state }: { state: React.MutableRefObject<AvatarState> }) {
  const fill = useRef<HTMLSpanElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = state.current;
      const level = Math.max(0, Math.min(1, (s.db - (s.floorDb - 6)) / (-8 - (s.floorDb - 6))));
      if (fill.current) fill.current.style.width = `${Math.round(level * 100)}%`;
      if (wrap.current) wrap.current.dataset.voiced = String(s.voiced);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [state]);
  return <span ref={wrap} className="mic-meter" title="Microphone level" aria-hidden="true"><span ref={fill} /></span>;
}
