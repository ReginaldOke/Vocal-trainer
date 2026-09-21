import * as THREE from "three";

/** The five singing partners. */
export type BuddyKind = "frog" | "bird" | "snail" | "lizard" | "monk";
export const BUDDIES: { id: BuddyKind; label: string }[] = [
  { id: "frog", label: "Frog" },
  { id: "bird", label: "Bird" },
  { id: "snail", label: "Snail" },
  { id: "lizard", label: "Lizard" },
  { id: "monk", label: "Monk" },
];
export const nextBuddy = (k: BuddyKind): BuddyKind => BUDDIES[(BUDDIES.findIndex((b) => b.id === k) + 1) % BUDDIES.length].id;

/** Smoothed, 0..1 signals every rig animates from. */
export interface Pose {
  /** how open the mouth is */
  open: number;
  /** bright ("ee", "ah") vs dark ("oo") vowel */
  bright: number;
  /** where the pitch sits, low to high */
  pitch: number;
  strain: number;
  loud: number;
  /** on-target glow */
  shine: number;
  /** eyelid closure 0..1 */
  lid: number;
  fever: boolean;
  voiced: boolean;
  t: number;
}

export interface Rig {
  root: THREE.Group;
  /** camera height and distance that frame this character well */
  camera: { y: number; z: number; look: number };
  update(p: Pose): void;
  dispose(): void;
}

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
const sphere = (r: number, m: THREE.Material, w = 32, h = 24) => new THREE.Mesh(new THREE.SphereGeometry(r, w, h), m);
const capsule = (r: number, len: number, m: THREE.Material) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), m);

/** Two eyes with pupils and a blink, shared by every animal. */
function eyes(parent: THREE.Object3D, x: number, y: number, z: number, r: number, white: THREE.Material, dark: THREE.Material) {
  const groups: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * x, y, z);
    const ball = sphere(r, white);
    const pupil = sphere(r * 0.5, dark);
    pupil.position.z = r * 0.7;
    const shine = sphere(r * 0.18, white, 8, 6);
    shine.position.set(r * 0.2, r * 0.25, r * 1.1);
    eye.add(ball, pupil, shine);
    parent.add(eye);
    groups.push(eye);
  }
  return groups;
}

function disposeAll(root: THREE.Object3D, mats: THREE.Material[]) {
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
  mats.forEach((m) => m.dispose());
}

// ---------------------------------------------------------------- Frog
export function buildFrog(): Rig {
  const green = mat(0x5cbf5a), belly = mat(0xdcefb0, { roughness: 0.75 }), dark = mat(0x1f2a1a), white = mat(0xffffff, { roughness: 0.3 });
  const mouthMat = mat(0x7a1b2e, { roughness: 0.9 }), throat = mat(0xcfe7a0, { emissive: 0xff3b3b, emissiveIntensity: 0, roughness: 0.7 });
  const root = new THREE.Group();
  const body = sphere(1, green); body.scale.set(1.2, 0.8, 1); body.position.y = -0.35; root.add(body);
  const tum = sphere(0.7, belly); tum.position.set(0, -0.5, 0.55); tum.scale.set(1.1, 0.8, 0.6); root.add(tum);
  const head = new THREE.Group(); head.position.set(0, 0.25, 0.25); root.add(head);
  const skull = sphere(0.85, green); skull.scale.set(1.15, 0.8, 1); head.add(skull);
  const eyeGroups = eyes(head, 0.5, 0.55, 0.35, 0.3, white, dark);
  for (const e of eyeGroups) { const lid = sphere(0.32, green); lid.scale.set(1, 0.55, 1); lid.position.y = 0.16; e.add(lid); }
  // Mouth: a dark slit that opens as the lower jaw drops.
  const jaw = new THREE.Group(); jaw.position.set(0, -0.15, 0.3); head.add(jaw);
  const jawMesh = sphere(0.8, green); jawMesh.scale.set(1.1, 0.35, 0.9); jawMesh.position.set(0, -0.15, 0.1); jaw.add(jawMesh);
  const mouth = sphere(1, mouthMat); mouth.position.set(0, -0.12, 0.55); head.add(mouth);
  const sac = sphere(0.45, throat); sac.position.set(0, -0.55, 0.75); root.add(sac);
  for (const side of [-1, 1]) {
    const leg = capsule(0.16, 0.5, green); leg.position.set(side * 0.95, -0.75, 0.3); leg.rotation.z = side * 1.2; root.add(leg);
    const foot = sphere(0.2, green); foot.scale.set(1.6, 0.4, 1); foot.position.set(side * 1.2, -1.05, 0.55); root.add(foot);
  }
  const mats = [green, belly, dark, white, mouthMat, throat];
  return {
    root,
    camera: { y: 0.3, z: 5.4, look: -0.1 },
    update(p) {
      const w = 0.75 + 0.2 * p.bright;
      mouth.scale.set(w, 0.04 + 0.28 * p.open, 0.35);
      jaw.rotation.x = 0.5 * p.open;
      sac.scale.setScalar(0.55 + 0.9 * p.open);
      throat.emissiveIntensity = 0.7 * p.strain;
      head.rotation.x = 0.05 - 0.3 * p.pitch;
      head.position.y = 0.25 + 0.15 * p.pitch;
      for (const e of eyeGroups) e.scale.y = Math.max(0.08, 1 - p.lid);
      body.scale.set(1.2 + 0.1 * p.loud, 0.8 + 0.06 * p.loud + 0.04 * Math.sin(p.t * 2), 1 + 0.06 * p.loud);
      root.rotation.z = 0.04 * Math.sin(p.t * 1.3) + (p.voiced ? 0.02 * Math.sin(p.t * 6) : 0);
      root.rotation.y = 0.12 * Math.sin(p.t * 0.7);
      root.position.y = p.voiced ? 0.05 * p.loud * Math.abs(Math.sin(p.t * 5)) : 0;
    },
    dispose: () => disposeAll(root, mats),
  };
}

// ---------------------------------------------------------------- Bird
export function buildBird(): Rig {
  const feather = mat(0xf9d24a, { roughness: 0.65 }), belly = mat(0xfff1b3, { roughness: 0.7 }), wingMat = mat(0xe9b62a, { roughness: 0.65 });
  const beakMat = mat(0xf28c1e, { roughness: 0.45 }), mouthMat = mat(0x6b1020, { roughness: 0.9 }), dark = mat(0x2a1c14), white = mat(0xffffff, { roughness: 0.3 }), wood = mat(0x7a4a2a, { roughness: 0.9 });
  const cheekMat = mat(0xffb0a0, { emissive: 0xff4060, emissiveIntensity: 0, transparent: true, opacity: 0.6 });
  const root = new THREE.Group(); root.position.y = -0.1;
  const body = sphere(1, feather, 48, 32); body.scale.set(1, 1.12, 0.95); root.add(body);
  const tummy = sphere(0.72, belly); tummy.position.set(0, -0.25, 0.5); tummy.scale.set(1, 1.1, 0.7); root.add(tummy);
  const head = new THREE.Group(); head.position.set(0, 1.05, 0.25); root.add(head);
  head.add(sphere(0.74, feather, 48, 32));
  const crest = new THREE.Group(); crest.position.set(0, 0.62, -0.05); head.add(crest);
  const crestFeathers: THREE.Mesh[] = [];
  [-1, 0, 1].forEach((side, i) => { const f = capsule(0.07, 0.42, wingMat); f.geometry.translate(0, 0.25, 0); f.position.set(side * 0.16, 0, side === 0 ? 0.05 : -0.05); f.rotation.z = -side * 0.35; crest.add(f); crestFeathers[i] = f; });
  const eyeGroups = eyes(head, 0.3, 0.14, 0.6, 0.16, white, dark);
  const brows: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.08), dark); brow.position.set(side * 0.3, 0.38, 0.62); head.add(brow); brows.push(brow);
    const cheek = sphere(0.16, cheekMat); cheek.position.set(side * 0.5, -0.12, 0.5); cheek.scale.set(1, 0.7, 0.4); head.add(cheek);
  }
  const beak = new THREE.Group(); beak.position.set(0, -0.08, 0.66); head.add(beak);
  const mandible = () => { const geo = new THREE.ConeGeometry(0.19, 0.5, 4); geo.rotateX(Math.PI / 2); geo.translate(0, 0, 0.25); const m = new THREE.Mesh(geo, beakMat); m.rotation.z = Math.PI / 4; return m; };
  const upper = new THREE.Group(), lower = new THREE.Group(); upper.add(mandible()); lower.add(mandible()); lower.scale.set(0.9, 0.7, 0.85); beak.add(upper, lower);
  const throat = sphere(0.16, mouthMat); throat.position.set(0, -0.02, 0.05); beak.add(throat);
  const wings: THREE.Group[] = [];
  for (const side of [-1, 1]) { const pivot = new THREE.Group(); pivot.position.set(side * 0.85, 0.25, 0); const w = sphere(1, wingMat); w.scale.set(0.3, 0.75, 0.16); w.position.set(side * 0.2, -0.55, 0); pivot.add(w); root.add(pivot); wings.push(pivot); }
  const tail = new THREE.Group(); tail.position.set(0, -0.55, -0.8); root.add(tail);
  for (const k of [-1, 0, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.75), wingMat); f.position.set(k * 0.14, 0, -0.35); f.rotation.y = k * 0.25; tail.add(f); }
  const perch = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 12), wood); perch.rotation.z = Math.PI / 2; perch.position.set(0, -1.5, 0.25); root.add(perch);
  for (const side of [-1, 1]) { const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.34), beakMat); foot.position.set(side * 0.3, -1.4, 0.3); root.add(foot); }
  const mats = [feather, belly, wingMat, beakMat, mouthMat, dark, white, wood, cheekMat];
  return {
    root,
    camera: { y: 0.45, z: 5.7, look: 0.1 },
    update(p) {
      const gape = p.open * (0.55 + 0.25 * p.bright);
      upper.rotation.x = -gape * 0.55; lower.rotation.x = gape * 0.9; throat.scale.setScalar(0.4 + p.open);
      head.rotation.x = 0.08 - 0.3 * p.pitch; head.position.y = 1.05 + 0.12 * p.pitch + 0.02 * Math.sin(p.t * 1.9);
      body.scale.set(1 + 0.08 * p.loud, 1.12 + 0.1 * p.pitch + 0.05 * p.loud, 0.95 + 0.06 * p.loud);
      crest.rotation.x = 0.7 - 1.0 * p.pitch - 0.2 * p.open;
      crestFeathers.forEach((f, i) => { const side = i - 1; f.rotation.z = -side * (0.25 + 0.4 * p.bright + 0.3 * p.pitch); });
      brows.forEach((b, i) => { const side = i === 0 ? -1 : 1; b.position.y = 0.38 + 0.1 * p.pitch - 0.1 * p.strain; b.rotation.z = -side * 0.1 + side * (0.45 * p.strain - 0.12 * p.pitch); });
      cheekMat.emissiveIntensity = 0.9 * p.strain + 0.3 * p.loud;
      const flap = (p.voiced ? Math.sin(p.t * (p.fever ? 22 : 9)) : Math.sin(p.t * 1.2) * 0.2) * (0.25 + 0.5 * p.loud);
      wings.forEach((w, i) => { const side = i === 0 ? -1 : 1; w.rotation.z = side * (0.15 + 0.9 * p.loud + flap * 0.5 + (p.fever ? 0.4 : 0)); });
      tail.rotation.x = 0.1 * Math.sin(p.t * 2.3) + 0.15 * p.loud; tail.rotation.y = 0.2 * Math.sin(p.t * 1.1);
      root.rotation.z = 0.05 * Math.sin(p.t * 1.3) + (p.voiced ? 0.03 * Math.sin(p.t * 5.5) : 0); root.rotation.y = 0.15 * Math.sin(p.t * 0.6);
      root.position.y = -0.1 + 0.05 * p.loud * Math.abs(Math.sin(p.t * 6)); head.rotation.y = 0.2 * Math.sin(p.t * 0.8) * (1 - p.loud);
      for (const e of eyeGroups) e.scale.y = Math.max(0.08, 1 - p.lid);
    },
    dispose: () => disposeAll(root, mats),
  };
}

// ---------------------------------------------------------------- Snail
export function buildSnail(): Rig {
  const skin = mat(0xd9b48a, { roughness: 0.7 }), shellMat = mat(0xb86b3a, { roughness: 0.55 }), band = mat(0x7a3f1d, { roughness: 0.6 });
  const dark = mat(0x2a1c14), white = mat(0xffffff, { roughness: 0.3 }), mouthMat = mat(0x8a2a3a, { roughness: 0.9 }), cheek = mat(0xffb0a0, { emissive: 0xff4060, emissiveIntensity: 0, transparent: true, opacity: 0.6 });
  const root = new THREE.Group(); root.position.y = -0.4;
  const foot = capsule(0.42, 2.2, skin); foot.rotation.z = Math.PI / 2; foot.position.set(0.1, -0.3, 0); root.add(foot);
  const head = new THREE.Group(); head.position.set(1.15, 0.05, 0); root.add(head);
  head.add(sphere(0.5, skin));
  const stalks: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const stalk = new THREE.Group(); stalk.position.set(0.1, 0.3, side * 0.22); head.add(stalk);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.7, 10), skin); stem.position.y = 0.35; stalk.add(stem);
    const eye = new THREE.Group(); eye.position.y = 0.78; const ball = sphere(0.15, white); const pupil = sphere(0.075, dark); pupil.position.set(0.1, 0, 0); eye.add(ball, pupil); stalk.add(eye);
    stalk.rotation.z = -0.35; stalks.push(stalk);
    const c = sphere(0.12, cheek); c.position.set(0.3, -0.05, side * 0.35); c.scale.set(0.5, 0.7, 1); head.add(c);
  }
  const mouth = sphere(1, mouthMat); mouth.position.set(0.5, -0.12, 0); head.add(mouth);
  const shell = new THREE.Group(); shell.position.set(-0.55, 0.55, 0); root.add(shell);
  const dome = sphere(0.95, shellMat, 40, 28); dome.scale.set(1, 1, 0.85); shell.add(dome);
  for (const [r, z] of [[0.95, 0.0], [0.7, 0.35], [0.45, 0.6]] as const) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 40), band); ring.position.z = z * 0.85; shell.add(ring); }
  const mats = [skin, shellMat, band, dark, white, mouthMat, cheek];
  return {
    root,
    camera: { y: 0.4, z: 6.0, look: 0.0 },
    update(p) {
      mouth.scale.set(0.12 + 0.05 * p.bright, 0.03 + 0.2 * p.open, 0.18 + 0.12 * p.bright);
      // Eye stalks reach up for high notes and pull in under strain.
      stalks.forEach((s, i) => { const side = i === 0 ? -1 : 1; s.scale.y = 0.75 + 0.5 * p.pitch - 0.35 * p.strain; s.rotation.z = -0.35 + 0.35 * p.pitch; s.rotation.x = side * (0.1 + 0.2 * p.bright); });
      head.rotation.z = 0.25 * p.pitch; head.position.y = 0.05 + 0.15 * p.pitch;
      foot.scale.set(1 + 0.15 * p.loud, 1, 1 + 0.05 * p.loud);
      shell.rotation.z = 0.06 * Math.sin(p.t * 1.5) + (p.voiced ? 0.05 * Math.sin(p.t * 5) : 0);
      cheek.emissiveIntensity = 0.8 * p.strain + 0.3 * p.loud;
      root.rotation.y = -0.35 + 0.1 * Math.sin(p.t * 0.6);
      root.position.y = -0.4 + 0.04 * p.loud * Math.abs(Math.sin(p.t * 4));
      stalks.forEach((s) => { const eye = s.children[1]; if (eye) eye.scale.y = Math.max(0.08, 1 - p.lid); });
    },
    dispose: () => disposeAll(root, mats),
  };
}

// ---------------------------------------------------------------- Lizard
export function buildLizard(): Rig {
  const scale = mat(0x3fbf8f, { roughness: 0.55 }), belly = mat(0xc8f0d8, { roughness: 0.7 }), spine = mat(0x1f8f6a), dewMat = mat(0xff8c42, { roughness: 0.6, emissive: 0xff3b3b, emissiveIntensity: 0 });
  const dark = mat(0x102820), white = mat(0xffffff, { roughness: 0.3 }), mouthMat = mat(0x7a1b2e, { roughness: 0.9 }), tongueMat = mat(0xff5c7a);
  const root = new THREE.Group(); root.position.y = -0.3;
  const body = capsule(0.45, 1.6, scale); body.rotation.z = Math.PI / 2; body.position.set(-0.2, 0, 0); root.add(body);
  const tum = capsule(0.32, 1.4, belly); tum.rotation.z = Math.PI / 2; tum.position.set(-0.2, -0.18, 0.12); root.add(tum);
  const head = new THREE.Group(); head.position.set(1.0, 0.15, 0); root.add(head);
  const skull = sphere(0.5, scale); skull.scale.set(1.3, 0.8, 0.95); head.add(skull);
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 12), scale); snout.rotation.z = -Math.PI / 2; snout.position.set(0.7, -0.05, 0); head.add(snout);
  const jaw = new THREE.Group(); jaw.position.set(0.15, -0.2, 0); head.add(jaw);
  const jawMesh = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.9, 12), scale); jawMesh.rotation.z = -Math.PI / 2; jawMesh.position.set(0.45, -0.05, 0); jawMesh.scale.y = 0.6; jaw.add(jawMesh);
  const mouth = sphere(1, mouthMat); mouth.position.set(0.55, -0.12, 0); head.add(mouth);
  const tongue = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.7, 6), tongueMat); tongue.rotation.z = -Math.PI / 2; tongue.position.set(1.05, -0.12, 0); tongue.visible = false; head.add(tongue);
  const eyeGroups = eyes(head, 0.28, 0.25, 0.22, 0.14, white, dark);
  eyeGroups.forEach((e, i) => { e.position.set(0.15, 0.28, (i === 0 ? -1 : 1) * 0.36); e.rotation.y = (i === 0 ? -1 : 1) * 0.9; });
  const dewlap = sphere(0.35, dewMat); dewlap.position.set(0.35, -0.4, 0); dewlap.scale.set(0.9, 0.3, 0.6); head.add(dewlap);
  const spines: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.35, 6), spine); s.position.set(0.6 - i * 0.42, 0.38, 0); root.add(s); spines.push(s); }
  const tail = new THREE.Group(); tail.position.set(-1.05, 0, 0); root.add(tail);
  const tailMesh = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.8, 12), scale); tailMesh.rotation.z = Math.PI / 2; tailMesh.position.x = -0.9; tail.add(tailMesh);
  for (const x of [0.45, -0.75]) for (const side of [-1, 1]) { const leg = capsule(0.11, 0.4, scale); leg.position.set(x, -0.35, side * 0.5); leg.rotation.x = side * 1.2; root.add(leg); }
  const mats = [scale, belly, spine, dewMat, dark, white, mouthMat, tongueMat];
  return {
    root,
    camera: { y: 0.3, z: 6.2, look: -0.05 },
    update(p) {
      jaw.rotation.z = -0.45 * p.open;
      mouth.scale.set(0.35 + 0.1 * p.bright, 0.03 + 0.22 * p.open, 0.2);
      dewlap.scale.set(0.9 + 0.3 * p.loud, 0.3 + 1.0 * p.open, 0.6 + 0.2 * p.loud);
      dewMat.emissiveIntensity = 0.7 * p.strain;
      spines.forEach((s, i) => { s.scale.y = 0.6 + 0.9 * p.pitch + 0.15 * Math.sin(p.t * 3 + i); s.rotation.z = -0.1 * p.pitch; });
      head.rotation.z = 0.35 * p.pitch; head.position.y = 0.15 + 0.2 * p.pitch;
      tongue.visible = p.shine > 0.85 && Math.sin(p.t * 7) > 0.6;
      tail.rotation.y = 0.35 * Math.sin(p.t * (p.voiced ? 4 : 1.2)) * (0.4 + 0.6 * p.loud);
      for (const e of eyeGroups) e.scale.y = Math.max(0.08, 1 - p.lid);
      root.rotation.y = -0.3 + 0.08 * Math.sin(p.t * 0.5);
      root.position.y = -0.3 + 0.04 * p.loud * Math.abs(Math.sin(p.t * 5));
    },
    dispose: () => disposeAll(root, mats),
  };
}

// ---------------------------------------------------------------- Monk
export function buildMonk(): Rig {
  const skin = mat(0xf0c49c, { roughness: 0.55 }), dark = mat(0x3a2418, { roughness: 0.7 }), white = mat(0xffffff, { roughness: 0.3 }), maroon = mat(0x8b1e2d, { roughness: 0.8 }), saffron = mat(0xf2a21b, { roughness: 0.8 });
  const mouthMat = mat(0x5a0f1c, { roughness: 0.9 }), lipMat = mat(0xc9806a), cheekMat = mat(0xf0a090, { emissive: 0xff4060, emissiveIntensity: 0, transparent: true, opacity: 0.55 });
  const root = new THREE.Group();
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 1.25, 1.9, 32), maroon); robe.position.y = -1.15; root.add(robe);
  const sash = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.7, 0.22), saffron); sash.position.set(-0.28, -0.95, 0.55); sash.rotation.z = 0.35; root.add(sash);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.12, 12, 32), saffron); collar.rotation.x = Math.PI / 2; collar.position.y = -0.2; root.add(collar);
  const hands = new THREE.Group(); for (const side of [-1, 1]) { const hand = capsule(0.16, 0.5, skin); hand.position.set(side * 0.16, 0, 0); hand.rotation.z = side * 0.12; hands.add(hand); } hands.position.set(0, -0.75, 0.95); root.add(hands);
  const head = new THREE.Group(); head.position.y = 0.72; root.add(head);
  head.add(sphere(1, skin, 48, 32));
  for (const side of [-1, 1]) { const ear = sphere(0.2, skin); ear.position.set(side * 0.98, -0.05, 0); ear.scale.set(0.6, 1, 0.8); head.add(ear); }
  const nose = sphere(0.13, skin); nose.position.set(0, -0.05, 0.98); head.add(nose);
  const eyeGroups = eyes(head, 0.36, 0.22, 0.82, 0.17, white, dark);
  const brows: THREE.Mesh[] = [], cheeks: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.09), dark); brow.position.set(side * 0.36, 0.5, 0.86); brow.rotation.z = -side * 0.12; head.add(brow); brows.push(brow);
    const cheek = sphere(0.2, cheekMat); cheek.position.set(side * 0.55, -0.2, 0.78); cheek.scale.set(1, 0.7, 0.4); head.add(cheek); cheeks.push(cheek);
  }
  const mouth = new THREE.Group(); mouth.position.set(0, -0.4, 0.86); head.add(mouth);
  const cavity = sphere(1, mouthMat); mouth.add(cavity);
  const upperLip = new THREE.Mesh(new THREE.TorusGeometry(1, 0.16, 8, 24, Math.PI), lipMat); mouth.add(upperLip);
  const lowerLip = new THREE.Mesh(new THREE.TorusGeometry(1, 0.16, 8, 24, Math.PI), lipMat); lowerLip.rotation.z = Math.PI; mouth.add(lowerLip);
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 0.2), white); teeth.position.set(0, 0.55, 0.1); mouth.add(teeth);
  const mats = [skin, dark, white, maroon, saffron, mouthMat, lipMat, cheekMat];
  return {
    root,
    camera: { y: 0.4, z: 6.4, look: 0.1 },
    update(p) {
      const w = 0.22 + 0.16 * p.bright + 0.04 * p.open, h = 0.03 + 0.34 * p.open * (1 - 0.35 * p.bright);
      cavity.scale.set(w, h, 0.18); upperLip.scale.set(w, Math.max(0.06, h * 0.9), 0.5); lowerLip.scale.set(w, Math.max(0.06, h * 0.9), 0.5);
      teeth.scale.set(w, 1, 1); teeth.visible = p.open > 0.25; teeth.position.y = h * 0.55;
      head.rotation.x = 0.06 - 0.28 * p.pitch; head.position.y = 0.72 + 0.08 * p.pitch + 0.02 * Math.sin(p.t * 1.7);
      brows.forEach((b, i) => { const side = i === 0 ? -1 : 1; b.position.y = 0.5 + 0.14 * p.pitch - 0.08 * p.strain; b.rotation.z = -side * (0.12 + 0.35 * p.strain) + side * 0.1 * p.pitch; });
      cheeks.forEach((c) => { c.scale.x = 1 + 0.4 * p.open; });
      cheekMat.emissiveIntensity = 0.9 * p.strain + 0.25 * p.loud;
      root.rotation.z = 0.05 * Math.sin(p.t * 1.3) + (p.voiced ? 0.025 * Math.sin(p.t * 5.5) : 0); root.rotation.y = 0.12 * Math.sin(p.t * 0.7);
      root.scale.setScalar(1 + 0.015 * Math.sin(p.t * 2.2) + 0.02 * p.open); hands.position.y = -0.75 + 0.05 * p.open;
      for (const e of eyeGroups) e.scale.y = Math.max(0.08, 1 - p.lid);
    },
    dispose: () => disposeAll(root, mats),
  };
}

export const BUILDERS: Record<BuddyKind, () => Rig> = { frog: buildFrog, bird: buildBird, snail: buildSnail, lizard: buildLizard, monk: buildMonk };
