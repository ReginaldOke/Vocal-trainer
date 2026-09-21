import { useEffect, useRef } from "react";
import * as THREE from "three";
import { BUILDERS, type BuddyKind, type Pose, type Rig } from "./avatars";

/** What the singing partner needs to know each frame. Written by the audio path, read at 60 fps. */
export interface AvatarState {
  voiced: boolean;
  midi: number;
  db: number;
  /** spectral tilt from the analyser: high means a dark, rounded vowel */
  h1h2: number;
  /** first two resonances when known (0 otherwise): the mouth opens with F1 and spreads with F2 */
  f1: number;
  f2: number;
  strain: number;
  /** 0..1 accuracy against the current target, 0 when there is none */
  q: number;
  fever: boolean;
  floorDb: number;
}

export const EMPTY_AVATAR: AvatarState = { voiced: false, midi: NaN, db: -90, h1h2: 6, f1: 0, f2: 0, strain: 0, q: 0, fever: false, floorDb: -55 };

const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function SingerAvatar({ state, kind, className }: { state: React.MutableRefObject<AvatarState>; kind: BuddyKind; className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    renderer.setPixelRatio(Math.min(coarse ? 1.5 : 2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    scene.add(new THREE.HemisphereLight(0xfff6e0, 0x2b1d4a, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(2.5, 4, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fa8ff, 1.3); rim.position.set(-3, 2, -3); scene.add(rim);

    const rig: Rig = (BUILDERS[kind] ?? BUILDERS.frog)();
    scene.add(rig.root);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffc23d, emissiveIntensity: 0.2, transparent: true, opacity: 0.85 });
    const glow = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.06, 12, 48), glowMat);
    glow.position.set(0, rig.camera.look + 0.4, -0.9);
    scene.add(glow);

    let open = 0, bright = 0.5, pitch = 0.4, strain = 0, shine = 0, loudS = 0, blink = 0, nextBlink = 2 + Math.random() * 3;
    let raf = 0;
    const t0 = performance.now();
    let last = t0;

    const resize = () => {
      const w = el.clientWidth || 200, h = el.clientHeight || 240;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // A tall, narrow panel would otherwise crop to a giant face.
      const back = Math.max(1, Math.min(1.7, 0.9 / camera.aspect));
      camera.position.set(0, rig.camera.y, rig.camera.z * back);
      camera.lookAt(0, rig.camera.look, 0);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      const s = state.current;

      const loud = s.voiced ? clamp((s.db - s.floorDb) / (-8 - s.floorDb)) : 0;
      const wantOpen = s.voiced ? 0.15 + 0.85 * Math.pow(loud, 0.8) : 0;
      const wantBright = s.voiced ? (s.f2 > 0 ? clamp((Math.log(s.f2) - Math.log(800)) / (Math.log(2500) - Math.log(800))) : clamp((12 - s.h1h2) / 14)) : 0.5;
      const wantPitch = s.voiced && !Number.isNaN(s.midi) ? clamp((s.midi - 46) / 36) : 0.4;
      open = lerp(open, wantOpen, s.voiced ? 0.45 : 0.25);
      bright = lerp(bright, wantBright, 0.15);
      pitch = lerp(pitch, wantPitch, 0.12);
      strain = lerp(strain, clamp(s.strain), 0.1);
      shine = lerp(shine, s.fever ? 1 : s.q, 0.1);
      loudS = lerp(loudS, loud, 0.2);

      nextBlink -= dt;
      if (nextBlink <= 0) { blink = 1; nextBlink = 2.5 + Math.random() * 3.5; }
      blink = Math.max(0, blink - dt * 8);
      const lid = blink > 0.5 ? 1 - (1 - blink) * 2 : blink * 2;

      const pose: Pose = { open, bright, pitch, strain, loud: loudS, shine, lid, fever: s.fever, voiced: s.voiced, t };
      rig.update(pose);

      const pulse = s.fever ? 0.5 + 0.5 * Math.sin(t * 8) : 0;
      glowMat.emissiveIntensity = 0.15 + 1.6 * shine + 0.8 * pulse;
      glowMat.opacity = 0.3 + 0.7 * shine;
      glow.rotation.z = t * (s.fever ? 2.5 : 0.4);
      glow.scale.setScalar(1 + 0.08 * shine + 0.05 * pulse);

      renderer.render(scene, camera);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      rig.dispose();
      glow.geometry.dispose();
      glowMat.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [state, kind]);

  return <div ref={host} className={`buddy ${className ?? ""}`} role="img" aria-label="Your singing partner" />;
}
