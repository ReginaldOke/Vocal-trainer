import { BUDDIES, nextBuddy, type BuddyKind } from "./avatars";
import { SingerAvatar, type AvatarState } from "./SingerAvatar";

/** The partner's corner: tap to swap to the next animal. */
export function BuddyPanel({ state, kind, onSwap, className }: { state: React.MutableRefObject<AvatarState>; kind: BuddyKind; onSwap: (k: BuddyKind) => void; className?: string }) {
  const label = BUDDIES.find((b) => b.id === kind)?.label ?? "Partner";
  return (
    <aside className={`buddy-panel ${className ?? ""}`} role="button" tabIndex={0} aria-label={`${label}. Tap to swap partner, drag to turn`} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSwap(nextBuddy(kind)); } }}>
      <SingerAvatar state={state} kind={kind} onTap={() => onSwap(nextBuddy(kind))} />
      <div className="buddy-plate" onClick={() => onSwap(nextBuddy(kind))}>{label} · tap to swap</div>
    </aside>
  );
}
