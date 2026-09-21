import { useEffect, useRef } from "react";
import * as THREE from "three";

/** What the songbird needs to know each frame. Written by the audio path, read at 60 fps. */
export interface AvatarState {
  voiced: boolean;
  midi: number;
  db: number;
  /** spectral tilt from the analyser: high means a dark, rounded vowel */
  h1h2: number;
  /** first two resonances when known (0 otherwise): the beak opens with F1 and spreads with F2 */
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

export function SingerAvatar({ state, className }: { state: React.MutableRefObject<AvatarState>; className?: string }) {
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
    camera.position.set(0, 0.45, 5.7);
    camera.lookAt(0, 0.15, 0);

    scene.add(new THREE.HemisphereLight(0xfff6e0, 0x2b1d4a, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(2.5, 4, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fa8ff, 1.3);
    rim.position.set(-3, 2, -3);
    scene.add(rim);

    const feather = new THREE.MeshStandardMaterial({ color: 0xf9d24a, roughness: 0.65 });
    const belly = new THREE.MeshStandardMaterial({ color: 0xfff1b3, roughness: 0.7 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xe9b62a, roughness: 0.65 });
    const beakMat = new THREE.MeshStandardMaterial({ color: 0xf28c1e, roughness: 0.45 });
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x6b1020, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.9 });
    const cheekMat = new THREE.MeshStandardMaterial({ color: 0xffb0a0, emissive: 0xff4060, emissiveIntensity: 0, transparent: true, opacity: 0.6 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffc23d, emissiveIntensity: 0.2, transparent: true, opacity: 0.85 });

    const bird = new THREE.Group();
    bird.position.y = -0.1;
    scene.add(bird);

    // Body and belly.
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), feather);
    body.scale.set(1, 1.12, 0.95);
    bird.add(body);
    const tummy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 32, 24), belly);
    tummy.position.set(0, -0.25, 0.5);
    tummy.scale.set(1, 1.1, 0.7);
    bird.add(tummy);

    // Head.
    const head = new THREE.Group();
    head.position.set(0, 1.05, 0.25);
    bird.add(head);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.74, 48, 32), feather));

    // Crest: three feathers that stand up for high notes.
    const crest = new THREE.Group();
    crest.position.set(0, 0.62, -0.05);
    head.add(crest);
    const crestFeathers: THREE.Mesh[] = [];
    for (const [i, side] of [-1, 0, 1].entries()) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.42, 4, 8), wingMat);
      f.geometry.translate(0, 0.25, 0);
      f.position.set(side * 0.16, 0, side === 0 ? 0.05 : -0.05);
      f.rotation.z = -side * 0.35;
      crest.add(f);
      crestFeathers[i] = f;
    }

    const eyes: THREE.Group[] = [];
    const brows: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.3, 0.14, 0.6);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), white);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), dark);
      pupil.position.z = 0.11;
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), white);
      shine.position.set(0.03, 0.04, 0.19);
      eye.add(ball, pupil, shine);
      head.add(eye);
      eyes.push(eye);

      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.08), dark);
      brow.position.set(side * 0.3, 0.38, 0.62);
      brow.rotation.z = -side * 0.1;
      head.add(brow);
      brows.push(brow);

      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), cheekMat);
      cheek.position.set(side * 0.5, -0.12, 0.5);
      cheek.scale.set(1, 0.7, 0.4);
      head.add(cheek);
    }

    // Beak: two mandibles hinged at the face.
    const beak = new THREE.Group();
    beak.position.set(0, -0.08, 0.66);
    head.add(beak);
    const mandible = (mat: THREE.Material) => {
      const geo = new THREE.ConeGeometry(0.19, 0.5, 4);
      geo.rotateX(Math.PI / 2);
      geo.translate(0, 0, 0.25);
      const m = new THREE.Mesh(geo, mat);
      m.rotation.z = Math.PI / 4;
      return m;
    };
    const upper = new THREE.Group();
    const lower = new THREE.Group();
    upper.add(mandible(beakMat));
    lower.add(mandible(beakMat));
    lower.scale.set(0.9, 0.7, 0.85);
    beak.add(upper, lower);
    const throat = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), mouthMat);
    throat.position.set(0, -0.02, 0.05);
    beak.add(throat);

    // Wings, hinged at the shoulders.
    const wings: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.85, 0.25, 0);
      const w = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), wingMat);
      w.scale.set(0.3, 0.75, 0.16);
      w.position.set(side * 0.2, -0.55, 0);
      pivot.add(w);
      pivot.rotation.z = side * 0.15;
      bird.add(pivot);
      wings.push(pivot);
    }

    // Tail feathers.
    const tail = new THREE.Group();
    tail.position.set(0, -0.55, -0.8);
    bird.add(tail);
    for (const k of [-1, 0, 1]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.75), wingMat);
      f.position.set(k * 0.14, 0, -0.35);
      f.rotation.y = k * 0.25;
      tail.add(f);
    }

    // Perch and feet.
    const perch = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 12), wood);
    perch.rotation.z = Math.PI / 2;
    perch.position.set(0, -1.5, 0.25);
    scene.add(perch);
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.34), beakMat);
      foot.position.set(side * 0.3, -1.4, 0.3);
      bird.add(foot);
    }

    const glow = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.06, 12, 48), glowMat);
    glow.position.set(0, 0.5, -0.9);
    scene.add(glow);

    // Smoothed animation values.
    let open = 0, bright = 0.5, pitch = 0.4, strain = 0, shine = 0, loudS = 0, blink = 0, nextBlink = 2 + Math.random() * 3;
    let raf = 0;
    const t0 = performance.now();
    let last = t0;

    const resize = () => {
      const w = el.clientWidth || 200, h = el.clientHeight || 240;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // A tall, narrow panel would otherwise crop to a giant beak.
      camera.position.z = 5.7 * Math.max(1, Math.min(1.7, 0.9 / camera.aspect));
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

      // Beak opens with the voice; a bright vowel opens it wider and flatter.
      const gape = open * (0.55 + 0.25 * bright);
      upper.rotation.x = -gape * 0.55;
      lower.rotation.x = gape * 0.9;
      throat.scale.setScalar(0.4 + open);

      // Stretch up and lift the head and crest for high notes; the crest fans with brightness.
      head.rotation.x = 0.08 - 0.3 * pitch;
      head.position.y = 1.05 + 0.12 * pitch + 0.02 * Math.sin(t * 1.9);
      body.scale.set(1 + 0.08 * loudS, 1.12 + 0.1 * pitch + 0.05 * loudS, 0.95 + 0.06 * loudS);
      crest.rotation.x = 0.7 - 1.0 * pitch - 0.2 * open;
      crestFeathers.forEach((f, i) => { const side = i - 1; f.rotation.z = -side * (0.25 + 0.4 * bright + 0.3 * pitch); });

      // Brows and cheeks: cross and flush under strain.
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        brows[i].position.y = 0.38 + 0.1 * pitch - 0.1 * strain;
        brows[i].rotation.z = -side * 0.1 + side * (0.45 * strain - 0.12 * pitch);
      }
      cheekMat.emissiveIntensity = 0.9 * strain + 0.3 * loudS;

      // Wings lift with volume and flap when singing out; in fever they go wild.
      const flap = (s.voiced ? Math.sin(t * (s.fever ? 22 : 9)) : Math.sin(t * 1.2) * 0.2) * (0.25 + 0.5 * loudS);
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        wings[i].rotation.z = side * (0.15 + 0.9 * loudS + flap * 0.5 + (s.fever ? 0.4 : 0));
      }
      tail.rotation.x = 0.1 * Math.sin(t * 2.3) + 0.15 * loudS;
      tail.rotation.y = 0.2 * Math.sin(t * 1.1);

      // Idle sway and a little hop of the whole body when singing.
      bird.rotation.z = 0.05 * Math.sin(t * 1.3) + (s.voiced ? 0.03 * Math.sin(t * 5.5) : 0);
      bird.rotation.y = 0.15 * Math.sin(t * 0.6);
      bird.position.y = -0.1 + 0.05 * loudS * Math.abs(Math.sin(t * 6));
      head.rotation.y = 0.2 * Math.sin(t * 0.8) * (1 - loudS);

      // Blink.
      nextBlink -= dt;
      if (nextBlink <= 0) { blink = 1; nextBlink = 2.5 + Math.random() * 3.5; }
      blink = Math.max(0, blink - dt * 8);
      const lid = blink > 0.5 ? 1 - (1 - blink) * 2 : blink * 2;
      for (const e of eyes) e.scale.y = Math.max(0.08, 1 - lid);

      // Song glow: brightens with accuracy, pulses gold in fever.
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
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      for (const m of [feather, belly, wingMat, beakMat, mouthMat, dark, white, wood, cheekMat, glowMat]) m.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [state]);

  return <div ref={host} className={`buddy ${className ?? ""}`} role="img" aria-label="A little songbird who sings along with you" />;
}
