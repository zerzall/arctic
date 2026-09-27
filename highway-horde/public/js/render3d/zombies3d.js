// Zombies in the first-person view (ACTORS, SPEC §7.5): one GPU-rigged InstancedMesh per
// zombie type (bones posed on the CPU, bent in the vertex shader — see actor-rig.js), a
// second one per type for corpses, and one InstancedMesh of flying gibs. Each type has
// its own silhouette so a crowd reads at a glance even as dark shapes in the fog:
// walker (arms out, shuffling), runner (lean, pumping arms), crawler (prone, pulling
// itself along), bloater (swollen belly), spitter (glowing acid sacs), screamer (pale,
// long black hair), brute (huge lopsided shoulders, bone spurs), boss (spined hulk with
// a third arm). Flags: burning (flames + light), attacking (lunge), charging (brute
// head-down charge + dust / boss slam wind-up), buffed (red rim), elite (bright eyes).

import * as THREE from 'three';
import { ZOMBIES, ZOMBIE_IDS, ZFLAG } from '../shared/zombies.js';
import { PartBuilder, col, mixHex, shadeHex, hash01, angleDiff, damp } from './actor-kit.js';
import { RigInstances, rigPoint, B, SLOT, T_ROOT, T_SKIN, T_CLOTH, T_ACCENT, T_FX } from './actor-rig.js';
import { acquireFx, releaseFx, F_ADD, F_FIRE, F_BOUNCE, F_FLICKER, FR } from './fx-core.js';

const TAU = Math.PI * 2;
const CAPACITY = 320;
const CORPSE_CAP = 120;
const CORPSE_LIFE = 30;      // seconds before a corpse starts sinking away
const CORPSE_SINK = 4;
const GIB_CAP = 160;

// Height scale per type (the top-down look.scale is a sprite scale; giants would be
// absurd at 3.2× in first person).
const SCALE = { walker: 1, runner: 0.95, crawler: 0.9, bloater: 1.12, spitter: 1, screamer: 1.02, brute: 1.55, boss: 2.5 };
// stride length (units per full cycle at scale 1) — sets how fast legs cycle for a speed
const STRIDE = { walker: 46, runner: 70, crawler: 40, bloater: 40, spitter: 48, screamer: 50, brute: 58, boss: 70 };
const EYE = { walker: '#ffcf66', runner: '#ffd98a', crawler: '#ffcf66', bloater: '#e8ff7a', spitter: '#b8ff4a', screamer: '#d8e8ff', brute: '#ff9a3a', boss: '#ff4ad8' };

const SHOE = '#231d19', HAIR = ['#1b120c', '#3a2616', '#262626', '#4a3a2c', '#5a4632'], BONE = '#e6dfc8', MOUTH = '#1a0606', GORE = '#5a0f12';

// ---------------------------------------------------------------------------------------
// models

/** Humanoid skeleton pivots for the given proportions (shared layout, see actor-rig B). */
function skeleton(P) {
  const piv = [];
  piv[B.HIPS] = [0, P.hip, 0];
  piv[B.SPINE] = [0, P.hip + 2, 0];
  piv[B.HEAD] = [P.headX * 0.5, P.neck, 0];
  piv[B.UARM_L] = [0, P.shoulder, -P.sw];
  piv[B.FARM_L] = [0, P.shoulder - P.uarm, -P.sw];
  piv[B.UARM_R] = [0, P.shoulder, P.sw * P.rArm];
  piv[B.FARM_R] = [0, P.shoulder - P.uarm * P.rArmLen, P.sw * P.rArm];
  piv[B.THIGH_L] = [0, P.hip, -P.legGap];
  piv[B.SHIN_L] = [0, P.knee, -P.legGap];
  piv[B.THIGH_R] = [0, P.hip, P.legGap];
  piv[B.SHIN_R] = [0, P.knee, P.legGap];
  piv[B.X1] = P.x1 || [0, P.shoulder, 0];
  piv[B.X2] = P.x2 || [0, P.shoulder, 0];
  const parents = [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9, P.x1Parent ?? 1, P.x2Parent ?? 1];
  return { pivots: piv, parents };
}

const BASE = {
  hip: 27, knee: 14, legW: 4.4, legGap: 3.6, torsoH: 17, torsoD: 8, torsoW: 14.5, shoulder: 45, sw: 8.6,
  uarm: 12, farm: 11, armW: 3.7, head: [7.2, 8.4, 6.8], headX: 1, neck: 47.5, rArm: 1, rArmLen: 1, rArmW: 1,
  hair: true, claws: false, bareFeet: false,
};

/** Build the shared humanoid (+ per-type extras) into a PartBuilder. */
function humanoid(pb, P, variantSeed) {
  const hairCol = HAIR[variantSeed % HAIR.length];
  const legH1 = P.hip - P.knee, legH2 = P.knee;
  for (const s of [-1, 1]) {
    const t = s < 0 ? B.THIGH_L : B.THIGH_R, sh = s < 0 ? B.SHIN_L : B.SHIN_R;
    const z = s * P.legGap;
    pb.add('box', { at: [0, P.knee + legH1 / 2, z], size: [P.legW * 1.1, legH1 + 1, P.legW], color: '#ffffff', slot: SLOT.CLOTH, bone: t, taper: [0.85] });
    pb.add('box', { at: [0, legH2 / 2 + 1.5, z], size: [P.legW * 0.9, legH2 - 1, P.legW * 0.85], color: '#d8d8d8', slot: P.bareLegs ? SLOT.SKIN : SLOT.CLOTH, bone: sh, taper: [1.15] });
    pb.add('box', { at: [1.4, 1.1, z], size: [P.legW * 1.5, 2.2, P.legW * 0.95], color: P.bareFeet ? '#b0b0b0' : SHOE, slot: P.bareFeet ? SLOT.SKIN : SLOT.FIXED, bone: sh });
  }
  // pelvis + torso (slightly wider at the shoulders)
  pb.add('box', { at: [0, P.hip + 1, 0], size: [P.torsoD * 0.9, 5, P.torsoW * 0.8], color: '#bdbdbd', slot: SLOT.CLOTH, bone: B.HIPS });
  const ty = P.hip + 3 + P.torsoH / 2;
  pb.add('box', { at: [0, ty, 0], size: [P.torsoD, P.torsoH, P.torsoW * 0.86], color: '#ffffff', slot: SLOT.CLOTH, bone: B.SPINE, taper: [1.05, 1.18] });
  // torn shirt: a strip of rotten skin showing at the belly
  pb.add('box', { at: [P.torsoD * 0.5, P.hip + 5, 0], size: [0.6, 4, P.torsoW * 0.5], color: '#9aa88a', slot: SLOT.SKIN, bone: B.SPINE, ao: 0 });
  // neck + head
  const hx = P.headX, [hw, hh, hd] = P.head;
  pb.add('box', { at: [hx * 0.5, P.neck, 0], size: [3, 3.5, 3.2], color: '#d0d0d0', slot: SLOT.SKIN, bone: B.HEAD });
  const hy = P.neck + 1.5 + hh / 2;
  pb.add('box', { at: [hx, hy, 0], size: [hw, hh, hd], color: '#ffffff', slot: SLOT.SKIN, bone: B.HEAD, taper: [0.92] });
  pb.add('box', { at: [hx + hw * 0.42, hy - hh * 0.32, 0], size: [hw * 0.35, hh * 0.3, hd * 0.75], color: '#c8c8c8', slot: SLOT.SKIN, bone: B.HEAD }); // jaw
  pb.add('box', { at: [hx + hw * 0.5, hy - hh * 0.22, 0], size: [0.5, hh * 0.14, hd * 0.5], color: MOUTH, bone: B.HEAD, ao: 0 });
  for (const s of [-1, 1]) {
    pb.add('box', { at: [hx + hw * 0.5, hy + hh * 0.08, s * hd * 0.22], size: [0.5, hh * 0.16, hd * 0.2], color: '#ffffff', slot: SLOT.EYE, bone: B.HEAD, ao: 0 });
  }
  if (P.hair) pb.add('box', { at: [hx - 0.6, hy + hh * 0.45, 0], size: [hw * 0.95, hh * 0.22, hd * 1.05], color: hairCol, bone: B.HEAD });
  // arms hanging from the shoulders (the pose code swings them forward)
  for (const s of [-1, 1]) {
    const R = s > 0;
    const u = R ? B.UARM_R : B.UARM_L, f = R ? B.FARM_R : B.FARM_L;
    const z = s * P.sw * (R ? P.rArm : 1);
    const wk = R ? P.rArmW : 1, lk = R ? P.rArmLen : 1;
    const ua = P.uarm * lk, fa = P.farm * lk, aw = P.armW * wk;
    pb.add('box', { at: [0, P.shoulder - ua / 2 + 1, z], size: [aw * 1.1, ua + 2, aw * 1.1], color: '#ffffff', slot: P.bareArms ? SLOT.SKIN : SLOT.CLOTH, bone: u, taper: [1.1] });
    pb.add('box', { at: [0, P.shoulder - ua - fa / 2, z], size: [aw * 0.9, fa, aw * 0.9], color: '#e0e0e0', slot: SLOT.SKIN, bone: f, taper: [1.1] });
    pb.add('box', { at: [0.3, P.shoulder - ua - fa - 1.8, z], size: [aw * 1.05, 3.8 * wk, aw * 0.7], color: '#cfcfcf', slot: SLOT.SKIN, bone: f });
    if (P.claws) {
      for (let k = -1; k <= 1; k++) {
        pb.add('cone6', { at: [0.4, P.shoulder - ua - fa - 4.8 * wk, z + k * aw * 0.25], rot: [0, 0, Math.PI], size: [0.7 * wk, 2.4 * wk, 0.7 * wk], color: BONE, bone: f, ao: 0 });
      }
    }
  }
}

function buildModel(type) {
  const pb = new PartBuilder();
  let P = { ...BASE };
  switch (type) {
    case 'runner':
      P = { ...P, torsoW: 13, legW: 4, armW: 3.3, head: [6.8, 8, 6.4] };
      break;
    case 'crawler':
      P = { ...P, legW: 3.8, armW: 3.4, bareArms: true, claws: true, head: [7.4, 8, 7] };
      break;
    case 'bloater':
      P = { ...P, legW: 5.6, legGap: 5, torsoW: 17, torsoD: 11, sw: 11, armW: 4.4, head: [6.4, 7.4, 6.2], hair: false, bareArms: true, x1: [2, 38, 0] };
      break;
    case 'spitter':
      P = { ...P, torsoW: 13.5, armW: 3.4, head: [7.6, 8.6, 6.8], x1: [4, 49, 0], x1Parent: B.HEAD };
      break;
    case 'screamer':
      P = { ...P, torsoW: 12.5, torsoD: 7, armW: 3, uarm: 13, farm: 12, head: [7, 8.8, 6.6], hair: false, bareFeet: true };
      break;
    case 'brute':
      P = { ...P, legW: 6, legGap: 4.6, torsoW: 19, torsoD: 11, torsoH: 16, sw: 11.5, armW: 5, uarm: 13, farm: 12, head: [6.4, 7.2, 6.4], headX: 2.5,
        neck: 46, rArm: 1.08, rArmLen: 1.08, rArmW: 1.45, hair: false, claws: true, bareArms: true, x1: [0, 44, 0] };
      break;
    case 'boss':
      P = { ...P, legW: 6.4, legGap: 5, torsoW: 20, torsoD: 12, torsoH: 17, sw: 12, armW: 5.2, uarm: 13.5, farm: 13, head: [6, 6.8, 6], headX: 3, neck: 46,
        hair: false, claws: true, bareArms: true, bareLegs: true, bareFeet: true, x1: [-2, 44, 0], x2: [-1, 44, -9] };
      break;
    default:
      break;
  }
  humanoid(pb, P, ZOMBIE_IDS.indexOf(type) + 3);
  // ---- per-type extras ----
  if (type === 'bloater') {
    pb.add('ico1', { at: [4.5, 37, 0], size: [17, 19, 21], color: '#ffffff', slot: SLOT.SKIN, bone: B.X1, ao: 0.35 });
    for (let k = 0; k < 7; k++) {
      const a = hash01(k * 7 + 1) * TAU, h = 30 + hash01(k * 3 + 2) * 14;
      pb.add('ico0', { at: [4.5 + Math.cos(a) * 8.6, h, Math.sin(a) * 10], size: [2.4, 2.4, 2.4], color: '#d8d070', slot: SLOT.GLOW, bone: B.X1, ao: 0 });
    }
    pb.add('box', { at: [-2.5, 44, 0], size: [7, 5, 16], color: '#ffffff', slot: SLOT.CLOTH, bone: B.SPINE }); // shirt rag on the back
  } else if (type === 'spitter') {
    for (const s of [-1, 1]) {
      pb.add('ico1', { at: [2.4, 47.5, s * 3.6], size: [4.6, 5.2, 4.6], color: '#9fe03a', slot: SLOT.GLOW, bone: B.SPINE, ao: 0 });
    }
    pb.add('box', { at: [5.2, 47.5, 0], size: [2.6, 5.5, 4.4], color: '#caca9a', slot: SLOT.SKIN, bone: B.X1 }); // hanging jaw
    pb.add('box', { at: [5.6, 45.2, 0], size: [1.2, 3.2, 1.2], color: '#a6ff3a', slot: SLOT.GLOW, bone: B.X1, ao: 0 }); // drool
  } else if (type === 'screamer') {
    // long black hair falling over the shoulders and back
    pb.add('box', { at: [-1.4, 53, 0], size: [6.4, 10, 7.8], color: '#0e0e0e', bone: B.HEAD });
    pb.add('box', { at: [-3.2, 44.5, 0], size: [2.6, 10, 9], color: '#0e0e0e', bone: B.HEAD });
    pb.add('box', { at: [4.6, 50.6, 0], size: [0.6, 3.4, 2.4], color: '#050505', bone: B.HEAD, ao: 0 }); // gaping mouth
  } else if (type === 'brute') {
    pb.add('ico1', { at: [0, 45, 11], size: [11, 10, 11], color: '#ffffff', slot: SLOT.SKIN, bone: B.UARM_R }); // swollen shoulder
    pb.add('ico0', { at: [0, 45, -10.5], size: [8, 7.5, 8], color: '#ffffff', slot: SLOT.SKIN, bone: B.UARM_L });
    const spurs = [[-5, 44, -6, -0.5], [-5.5, 40, 2, 0.2], [-5, 46, 6, 0.6], [-4.5, 36, -3, -0.2]];
    for (const [x, y, z, r] of spurs) pb.add('cone6', { at: [x - 2, y, z], rot: [r, 0, 1.9], size: [1.6, 5.5, 1.6], color: BONE, bone: B.SPINE, ao: 0 });
  } else if (type === 'boss') {
    pb.add('ico1', { at: [-4, 47, 0], size: [13, 11, 17], color: '#ffffff', slot: SLOT.SKIN, bone: B.X1, ao: 0.3 }); // hump
    const spikes = [[-8, 50, -5, -0.5, 9], [-9, 47, 3, 0.4, 11], [-7, 42, -7, -0.7, 8], [-8, 41, 6, 0.8, 9], [-4, 53, 0, 0, 7], [-9, 36, 0, 0, 7],
      [0, 50, -12, -1.2, 6], [0, 50, 12, 1.2, 6]];
    for (const [x, y, z, r, L] of spikes) pb.add('cone6', { at: [x - L * 0.3, y, z], rot: [r, 0, 1.6 + Math.abs(r) * 0.3], size: [2.2, L, 2.2], color: BONE, bone: B.X1, ao: 0 });
    for (let k = 0; k < 6; k++) {
      const h = 32 + hash01(k * 11) * 16, z = (hash01(k * 5 + 3) - 0.5) * 16;
      pb.add('ico0', { at: [4.8, h, z], size: [3.2, 3.2, 3.2], color: '#c060c0', slot: SLOT.GLOW, bone: B.SPINE, ao: 0 });
    }
    // withered third arm from the left shoulder blade
    pb.add('box', { at: [-1, 38, -9], size: [2.4, 12, 2.4], color: '#ffffff', slot: SLOT.SKIN, bone: B.X2 });
    pb.add('box', { at: [-1, 30, -9], size: [2, 6, 3], color: '#d0d0d0', slot: SLOT.SKIN, bone: B.X2 });
    pb.add('box', { at: [7.5, 29, 0], size: [0.8, 10, 9], color: GORE, bone: B.SPINE, ao: 0 }); // flayed belly
  }
  return { geometry: pb.build({ rig: true }), rig: skeleton(P), P };
}

// ---------------------------------------------------------------------------------------

/**
 * @param {object} ctx renderer ctx (SPEC §7.5)
 * @returns {{update(view, frame), addEvents(events, opts), setQuality(q), dispose(), stats}}
 */
export function createZombies3D(ctx) {
  const fx = acquireFx(ctx);
  const root = new THREE.Group();
  root.name = 'zombies3d';
  ctx.scene.add(root);
  let high = ctx.quality !== 'low';

  const types = {};
  for (const t of ZOMBIE_IDS) {
    const m = buildModel(t);
    const rim = t === 'boss' ? '#d8a0ff' : t === 'spitter' ? '#b8ff8a' : '#9fc0ff';
    const live = new RigInstances(m.geometry, m.rig, CAPACITY, { rim, rimStrength: 0.4 });
    const dead = new RigInstances(m.geometry, m.rig, CORPSE_CAP, { rim, rimStrength: 0.12 });
    live.mesh.castShadow = high;
    root.add(live.mesh, dead.mesh);
    types[t] = { m, live, dead, scale: SCALE[t] || 1, def: ZOMBIES[t] };
  }

  // per-type colour tables: skin variations and dirtied clothes
  const skinCols = {}, clothCols = {};
  for (const t of ZOMBIE_IDS) {
    const look = ZOMBIES[t].look;
    skinCols[t] = [0, 1, 2, 3].map((k) => new THREE.Color(mixHex(shadeHex(look.skin, 0.12), k % 2 ? '#a8a880' : '#6a8a5a', 0.12 + k * 0.05)));
    clothCols[t] = look.clothes.map((c) => new THREE.Color(shadeHex(mixHex(c, '#45443d', 0.3), -0.02)));
  }
  const eyeCols = {};
  for (const t of ZOMBIE_IDS) eyeCols[t] = new THREE.Color(EYE[t] || '#ffcf66');
  const eliteEye = new THREE.Color('#ff3b1a');

  // per-zombie animation state
  const state = new Map();
  let frameNo = 0;
  let lastView = null;

  // corpses
  const corpses = [];
  // gibs (flying chunks)
  const gibGeo = new THREE.IcosahedronGeometry(1, 0);
  const gibMat = new THREE.MeshLambertMaterial({ vertexColors: false });
  const gibs = new THREE.InstancedMesh(gibGeo, gibMat, GIB_CAP);
  gibs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GIB_CAP * 3), 3);
  gibs.count = 0;
  gibs.frustumCulled = false;
  root.add(gibs);
  const G = { x: new Float32Array(GIB_CAP), h: new Float32Array(GIB_CAP), y: new Float32Array(GIB_CAP),
    vx: new Float32Array(GIB_CAP), vh: new Float32Array(GIB_CAP), vy: new Float32Array(GIB_CAP),
    rx: new Float32Array(GIB_CAP), ry: new Float32Array(GIB_CAP), s: new Float32Array(GIB_CAP), age: new Float32Array(GIB_CAP),
    c: new Float32Array(GIB_CAP * 3) };
  let gn = 0;
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

  const stats = { zombies: 0, corpses: 0, gibs: 0 };

  function getState(z) {
    let s = state.get(z.id);
    if (!s || s.type !== z.type) {
      s = { type: z.type, x: z.x, y: z.y, a: z.angle, ph: hash01(z.id) * TAU, spd: 0, atk: 9, scream: 9, flinch: 9, slam: 9,
        charge: 0, spit: 9, seen: 0, seed: hash01(z.id * 31 + 7), fl: 0 };
      state.set(z.id, s);
    }
    return s;
  }

  // ---- pose -----------------------------------------------------------------------------
  function pose(inst, i, z, s, T, time) {
    const t = z.type;
    const ph = s.ph, amp = Math.min(1.2, s.spd / Math.max(30, T.def.speed[0] * 0.9));
    const sw = Math.sin(ph), cw = Math.cos(ph);
    const seed = s.seed;
    const f = z.flags | 0;
    const attacking = (f & ZFLAG.ATTACKING) !== 0;
    const charging = s.charge;
    // attack swipe: raise (0..0.35) then slash down (0.35..0.6)
    const at = s.atk;
    const swipe = at < 0.6 ? (at < 0.25 ? at / 0.25 : Math.max(0, 1 - (at - 0.25) / 0.35)) : 0;
    const lunge = at < 0.6 ? Math.sin(Math.min(1, at / 0.6) * Math.PI) : 0;
    const gnaw = attacking ? Math.sin(time * 9 + seed * 10) : 0;
    const fl = s.flinch < 0.25 ? Math.sin((s.flinch / 0.25) * Math.PI) : 0;
    const scr = s.scream < 1.4 ? Math.min(1, s.scream * 5) * Math.min(1, (1.4 - s.scream) * 3) : 0;
    const tilt = (seed - 0.5) * 0.5;
    const limp = seed > 0.6 ? 0.45 : 1;

    let bob = Math.abs(sw) * 1.4 * amp;
    let hipsZ = 0, hipsX = sw * 0.05 * amp, hipsY = sw * 0.12 * amp;
    let spineZ = -0.22, spineX = cw * 0.06 * amp;
    let headZ = 0.18, headX = tilt + Math.sin(time * 1.3 + seed * 9) * 0.08;
    let uaLZ = 1.25 + sw * 0.18 * amp, uaRZ = 1.3 - sw * 0.18 * amp, uaLX = -0.12, uaRX = 0.12;
    let faLZ = -0.12 + cw * 0.1, faRZ = -0.18 - cw * 0.1;
    let thL = sw * 0.5 * amp, thR = -sw * 0.5 * amp * limp;
    let shL = -Math.max(0, Math.sin(ph + 1.4)) * 0.7 * amp, shR = -Math.max(0, -Math.sin(ph + 1.4)) * 0.7 * amp * limp;
    let x1Z = 0, x1X = 0, x2Z = 0, x2X = 0;
    let rootX = 0, rootY = 0;

    switch (t) {
      case 'runner':
        bob = Math.abs(sw) * 2.4 * amp;
        spineZ = -0.42 - 0.1 * amp;
        headZ = 0.35;
        uaLZ = -sw * 1.0 * amp + 0.3; uaRZ = sw * 1.0 * amp + 0.3; uaLX = -0.15; uaRX = 0.15;
        faLZ = 1.35; faRZ = 1.35;
        thL = sw * 0.85 * amp; thR = -sw * 0.85 * amp;
        shL = -Math.max(0, Math.sin(ph + 1.3)) * 1.3 * amp - 0.2; shR = -Math.max(0, -Math.sin(ph + 1.3)) * 1.3 * amp - 0.2;
        break;
      case 'crawler':
        bob = 0;
        hipsZ = -1.38; hipsX = sw * 0.08; hipsY = sw * 0.1;
        rootY = -21.5; rootX = -4;
        spineZ = 0.1; spineX = 0;
        headZ = 1.05; headX = tilt * 0.5;
        uaLZ = 2.35 + sw * 0.55; uaRZ = 2.35 - sw * 0.55; uaLX = -0.25; uaRX = 0.25;
        faLZ = -0.5 - Math.max(0, cw) * 0.6; faRZ = -0.5 - Math.max(0, -cw) * 0.6;
        thL = 0.1 + sw * 0.08; thR = 0.05 - sw * 0.08; shL = -0.2 + cw * 0.2; shR = -0.5 - cw * 0.2;
        break;
      case 'bloater':
        bob = Math.abs(sw) * 1.0 * amp;
        hipsX = sw * 0.12 * amp;
        spineZ = 0.08; headZ = 0.25;
        uaLZ = 0.75 + sw * 0.12; uaRZ = 0.75 - sw * 0.12; uaLX = 0.45; uaRX = -0.45;
        faLZ = 0.2; faRZ = 0.2;
        thL = sw * 0.32 * amp; thR = -sw * 0.32 * amp;
        x1Z = Math.sin(time * 2.2 + seed * 7) * 0.04;      // belly wobble
        x1X = Math.sin(time * 1.7 + seed * 5) * 0.05;
        break;
      case 'spitter':
        uaLZ = 0.45 + sw * 0.2 * amp; uaRZ = 0.45 - sw * 0.2 * amp; faLZ = 0.3; faRZ = 0.3;
        spineZ = -0.18;
        if (s.spit < 0.6) {                               // rear back, then retch forward
          const k = s.spit / 0.6;
          const e = k < 0.4 ? -k / 0.4 : Math.sin(((k - 0.4) / 0.6) * Math.PI);
          spineZ += e * -0.45; headZ += e * -0.6;
          x1Z = Math.max(0, e) * 0.7;
        } else {
          x1Z = 0.15 + Math.sin(time * 5 + seed * 3) * 0.1;  // jaw hangs and twitches
        }
        break;
      case 'screamer':
        uaLZ = -0.3 + sw * 0.15 * amp; uaRZ = -0.3 - sw * 0.15 * amp; uaLX = -0.18; uaRX = 0.18;
        faLZ = 0.2; faRZ = 0.2;
        spineZ = -0.12; headZ = 0.45;
        if (scr > 0) {
          spineZ += scr * 0.35; headZ -= scr * 1.25;
          uaLZ += scr * 0.3; uaRZ += scr * 0.3; uaLX -= scr * 1.1; uaRX += scr * 1.1;
          faLZ += scr * 0.6; faRZ += scr * 0.6;
          headX += Math.sin(time * 40) * 0.05 * scr;
        }
        break;
      case 'brute':
        bob = Math.abs(sw) * 2.0 * amp;
        spineZ = -0.3; headZ = 0.35;
        uaLZ = 0.5 + sw * 0.25 * amp; uaRZ = 0.45 - sw * 0.25 * amp; uaLX = -0.35; uaRX = 0.4;
        faLZ = 0.5; faRZ = 0.35;
        thL = sw * 0.45 * amp; thR = -sw * 0.45 * amp;
        if (charging > 0) {
          spineZ -= charging * 0.55; headZ += charging * 0.5;
          uaLZ -= charging * 0.9; uaRZ -= charging * 0.9; uaLX -= charging * 0.3; uaRX += charging * 0.3;
          bob += charging * Math.abs(sw) * 2;
        }
        break;
      case 'boss': {
        bob = Math.abs(sw) * 1.6 * amp;
        spineZ = -0.2; headZ = 0.2;
        uaLZ = 0.7 + sw * 0.2 * amp; uaRZ = 0.7 - sw * 0.2 * amp; uaLX = -0.3; uaRX = 0.3;
        faLZ = 0.4; faRZ = 0.4;
        thL = sw * 0.38 * amp; thR = -sw * 0.38 * amp;
        x2Z = 0.8 + Math.sin(time * 3 + seed) * 0.4; x2X = -0.6;     // third arm flails
        x1X = Math.sin(time * 1.2) * 0.04;
        if (charging > 0) {                                          // slam wind-up: arms overhead
          spineZ += charging * 0.25; headZ -= charging * 0.3;
          uaLZ += charging * 2.1; uaRZ += charging * 2.1; faLZ -= charging * 0.6; faRZ -= charging * 0.6;
        }
        if (s.slam < 0.5) {                                          // smash down
          const k = 1 - s.slam / 0.5;
          spineZ -= k * 0.6; uaLZ = 1.2 + k * 0.2; uaRZ = 1.2 + k * 0.2; faLZ = -0.3; faRZ = -0.3;
          rootY -= k * 3;
        }
        break;
      }
      default:
        break;
    }
    // attack swipe / bite lunge (all types)
    if (lunge > 0 || swipe > 0) {
      if (t === 'crawler') {
        uaLZ += swipe * 0.6; uaRZ += swipe * 0.6; headZ += lunge * 0.3; rootX += lunge * 5;
      } else {
        spineZ -= lunge * 0.4;
        uaLZ += swipe * 1.1 - lunge * 0.2; uaRZ += swipe * 1.25 - lunge * 0.3;
        faLZ -= swipe * 0.4; faRZ -= swipe * 0.4;
        rootX += lunge * 4;
        headZ -= lunge * 0.3;
      }
    } else if (attacking) {
      spineZ -= 0.1 + gnaw * 0.06;
      headZ += gnaw * 0.15;
      uaLZ += 0.2 + gnaw * 0.15; uaRZ += 0.2 - gnaw * 0.15;
    }
    // hit flinch: snap back
    if (fl > 0) { spineZ += fl * 0.3; headZ += fl * 0.4; rootX -= fl * 1.5; }

    inst.bone(i, B.HIPS, hipsX, hipsY, hipsZ);
    inst.bone(i, B.SPINE, spineX, 0, spineZ);
    inst.bone(i, B.HEAD, headX, 0, headZ);
    inst.bone(i, B.UARM_L, uaLX, 0, uaLZ);
    inst.bone(i, B.FARM_L, 0, 0, faLZ);
    inst.bone(i, B.UARM_R, uaRX, 0, uaRZ);
    inst.bone(i, B.FARM_R, 0, 0, faRZ);
    inst.bone(i, B.THIGH_L, 0, 0, thL);
    inst.bone(i, B.SHIN_L, 0, 0, shL);
    inst.bone(i, B.THIGH_R, 0, 0, thR);
    inst.bone(i, B.SHIN_R, 0, 0, shR);
    inst.bone(i, B.X1, x1X, 0, x1Z);
    inst.bone(i, B.X2, x2X, 0, x2Z);
    inst.texel(i, T_ROOT, rootX, rootY + bob, 0, 0);
  }

  function colors(inst, i, z, s, elite, id) {
    const t = z.type;
    inst.color(i, T_SKIN, skinCols[t][id & 3], elite ? 3.2 : (t === 'boss' ? 2.2 : 0.9));
    const cl = clothCols[t];
    inst.color(i, T_CLOTH, cl[id % cl.length]);
    inst.color(i, T_ACCENT, elite ? eliteEye : eyeCols[t]);
  }

  // ---- update ---------------------------------------------------------------------------
  const burning = [];
  function update(view, frame) {
    fx.begin(frame);
    frameNo++;
    const dt = Math.min(0.1, frame.dt || 0);
    const time = frame.now || 0;
    lastView = view;
    for (const t of ZOMBIE_IDS) types[t].live.begin();
    burning.length = 0;
    const list = (view && view.zombies) || [];
    const camX = frame.camX, camY = frame.camY;
    for (let k = 0; k < list.length; k++) {
      const z = list[k];
      const T = types[z.type];
      if (!T) continue;
      const s = getState(z);
      s.seen = frameNo;
      // speed from rendered motion (interpolated positions), smoothed
      const dx = z.x - s.x, dy = z.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (dt > 0) {
        const v = d > 60 ? 0 : d / dt;       // teleports (spawn/id reuse) don't count
        s.spd += (v - s.spd) * damp(6, dt);
      }
      s.x = z.x; s.y = z.y;
      s.a += angleDiff(s.a, z.angle) * damp(10, dt);
      const stride = STRIDE[z.type] * T.scale;
      s.ph += (s.spd / stride) * TAU * dt * (z.type === 'crawler' ? 0.8 : 1);
      s.atk += dt; s.scream += dt; s.flinch += dt; s.slam += dt; s.spit += dt;
      const f = z.flags | 0;
      if ((f & ZFLAG.ATTACKING) && !(s.fl & ZFLAG.ATTACKING) && s.atk > 0.8) s.atk = 0;
      s.fl = f;
      const chg = (f & ZFLAG.CHARGING) ? 1 : 0;
      s.charge += (chg - s.charge) * damp(chg ? 8 : 4, dt);

      const inst = T.live;
      const i = inst.push();
      if (i < 0) continue;
      const elite = (f & ZFLAG.ELITE) !== 0;
      const sc = T.scale * (elite ? 1.08 : 1);
      inst.place(i, z.x, 0, z.y, s.a, sc);
      pose(inst, i, z, s, T, time);
      colors(inst, i, z, s, elite, z.id);
      const burn = (f & ZFLAG.BURNING) ? 1 : 0;
      const buff = (f & ZFLAG.BUFFED) ? 0.6 + Math.sin(time * 8 + s.seed * 6) * 0.4 : 0;
      const flash = s.flinch < 0.12 ? 1 - s.flinch / 0.12 : 0;
      inst.texel(i, T_FX, buff, burn ? 0.55 : 0, flash, 1);

      const d2 = (z.x - camX) * (z.x - camX) + (z.y - camY) * (z.y - camY);
      if (burn) {
        burning.push(z, d2);
        emitFlames(z, sc, d2, dt);
      }
      if (s.charge > 0.3 && z.type === 'brute' && d2 < 1400 * 1400 && fx.rng() < dt * 30) {
        const back = s.a + Math.PI + (fx.rng() - 0.5) * 1.2;
        fx.spawn(z.x + Math.cos(back) * 14, 4, z.y + Math.sin(back) * 14, Math.cos(back) * 40, 14, Math.sin(back) * 40,
          0.9, 10, 34, col('#5d5040'), 0.4, FR.SMOKE, 0, -6, 1.5);
      }
      if ((elite || z.type === 'boss') && d2 < 1600 * 1600) eyeGlow(inst, i, z, elite);
    }
    stats.zombies = list.length;
    for (const t of ZOMBIE_IDS) types[t].live.end();
    // forget zombies that vanished (without a zdie we saw)
    if (frameNo % 30 === 0) for (const [id, s] of state) if (frameNo - s.seen > 30) state.delete(id);
    burnLights();
    updateCorpses(dt, time);
    updateGibs(dt);
  }

  const _o = { x: 0, y: 0, z: 0 };
  function eyeGlow(inst, i, z, elite) {
    const T = types[z.type];
    const P = T.m.P;
    const hy = P.neck + 1.5 + P.head[1] * 0.58;
    const hx = P.headX + P.head[0] * 0.55;
    const c = elite ? eliteEye : eyeCols[z.type];
    for (const sgn of [-1, 1]) {
      rigPoint(inst, i, B.HEAD, [hx, hy, sgn * P.head[2] * 0.22], _o);
      fx.glow(_o.x, _o.y, _o.z, elite ? 7 : 12, c, elite ? 0.9 : 0.7);
    }
  }

  const flameCol = new THREE.Color(1, 1, 1);
  function emitFlames(z, sc, d2, dt) {
    if (d2 > 2200 * 2200 || fx.load() > 0.8) return;
    const near = d2 < 700 * 700;
    const rate = (near ? (high ? 26 : 12) : (high ? 8 : 4)) * Math.min(2.2, sc);
    let n = rate * dt;
    while (n > 0) {
      if (n < 1 && fx.rng() > n) break;
      n -= 1;
      const a = fx.rng() * TAU, r = fx.rng() * 7 * sc;
      const h = (8 + fx.rng() * 42) * sc * (z.type === 'crawler' ? 0.3 : 1);
      const idx = fx.spawn(z.x + Math.cos(a) * r, h, z.y + Math.sin(a) * r, (fx.rng() - 0.5) * 12, 30 + fx.rng() * 40, (fx.rng() - 0.5) * 12,
        0.35 + fx.rng() * 0.3, (7 + fx.rng() * 6) * Math.sqrt(sc), 2, flameCol, 0.9, FR.FLAME, F_ADD | F_FIRE | F_FLICKER, -40, 1.2);
      fx.stretchLast(idx, 1.5);
    }
  }

  function burnLights() {
    // the two burning zombies nearest the camera get a real light
    let b1 = -1, b2 = -1, d1 = Infinity, d2 = Infinity;
    for (let k = 0; k < burning.length; k += 2) {
      const d = burning[k + 1];
      if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = k; } else if (d < d2) { d2 = d; b2 = k; }
    }
    for (const k of [b1, b2]) {
      if (k < 0 || burning[k + 1] > 1200 * 1200) continue;
      const z = burning[k];
      ctx.lights.steady('zburn' + z.id, z.x, z.y, 34, '#ff8a33', 1.3, 200);
    }
  }

  // ---- corpses --------------------------------------------------------------------------
  function addCorpse(e) {
    const type = ZOMBIES[e.ztype] ? e.ztype : 'walker';
    if (corpses.length >= CORPSE_CAP) {
      // oldest non-sinking corpse starts sinking; hard cap drops the very oldest
      corpses.shift();
    }
    const seed = hash01((e.id | 0) * 13 + corpses.length);
    const back = seed < 0.55;                         // most fall backward from the hit
    const s = state.get(e.id);
    corpses.push({
      type, x: e.x, y: e.y, a: s ? s.a : (e.angle || 0), t: 0, id: e.id | 0, back, seed, ph: s ? s.ph : 0,
      elite: false,
    });
  }

  function updateCorpses(dt, time) {
    for (const t of ZOMBIE_IDS) types[t].dead.begin();
    let w = 0;
    for (let k = 0; k < corpses.length; k++) {
      const c = corpses[k];
      c.t += dt;
      if (c.t > CORPSE_LIFE + CORPSE_SINK) continue;
      corpses[w++] = c;
      const T = types[c.type];
      const inst = T.dead;
      const i = inst.push();
      if (i < 0) continue;
      const fall = Math.min(1, c.t / 0.45);
      const e = fall * fall;                                   // gravity ease-in
      const bounce = fall >= 1 ? Math.max(0, Math.sin((c.t - 0.45) * 18) * Math.exp(-(c.t - 0.45) * 10)) * 0.06 : 0;
      const dir = c.back ? 1 : -1;
      const crawl = c.type === 'crawler';
      const hipsZ = crawl ? -1.38 : dir * (e * 1.5 - bounce);
      const P = T.m.P;
      const lie = crawl ? -21.5 : -(P.hip - P.torsoD * 0.45) * e;
      const sink = c.t > CORPSE_LIFE ? -((c.t - CORPSE_LIFE) / CORPSE_SINK) * 14 : 0;
      inst.place(i, c.x, 0, c.y, c.a + (c.seed - 0.5) * 0.8, T.scale);
      inst.bone(i, B.HIPS, (c.seed - 0.5) * 0.3 * e, 0, hipsZ);
      inst.bone(i, B.SPINE, 0, 0, crawl ? 0.1 : -0.1 * e * dir);
      inst.bone(i, B.HEAD, (c.seed - 0.5) * 1.6 * e, 0, dir * 0.4 * e);
      const splay = 0.4 + e * 0.9;
      inst.bone(i, B.UARM_L, -splay - c.seed * 0.4, 0, dir * (0.4 + c.seed * 1.4) * e);
      inst.bone(i, B.FARM_L, 0, 0, 0.5 * e);
      inst.bone(i, B.UARM_R, splay * (0.6 + c.seed), 0, dir * (1.6 - c.seed) * e);
      inst.bone(i, B.FARM_R, 0, 0, -0.4 * e);
      inst.bone(i, B.THIGH_L, -0.15 * e, 0, dir * 0.2 * e);
      inst.bone(i, B.SHIN_L, 0, 0, -0.5 * e);
      inst.bone(i, B.THIGH_R, 0.2 * e, 0, -dir * 0.15 * e);
      inst.bone(i, B.SHIN_R, 0, 0, -0.2 * e);
      inst.bone(i, B.X1, 0, 0, 0);
      inst.bone(i, B.X2, 0.4, 0, 0.3);
      inst.texel(i, T_ROOT, 0, lie + sink, 0, 0);
      const skin = skinCols[c.type][c.id & 3];
      const cl = clothCols[c.type];
      // dulled and darkened: the dead should not compete with the living for attention
      inst.texel(i, T_SKIN, skin.r * 0.62, skin.g * 0.62, skin.b * 0.6, 0);
      const cc = cl[c.id % cl.length];
      inst.texel(i, T_CLOTH, cc.r * 0.6, cc.g * 0.6, cc.b * 0.6, 0);
      inst.texel(i, T_ACCENT, 0.05, 0.03, 0.02, 0);
      inst.texel(i, T_FX, 0, 0.2, 0, 0.35);
    }
    corpses.length = w;
    stats.corpses = w;
    for (const t of ZOMBIE_IDS) types[t].dead.end();
  }

  // ---- gibs -------------------------------------------------------------------------------
  const gibCols = ['#6a1418', '#8a1c1c', '#4a0c0c', '#a0786a', '#d8ccb0'];
  function spawnGibs(x, y, count, size, green) {
    for (let k = 0; k < count; k++) {
      let i;
      if (gn < GIB_CAP) i = gn++;
      else i = Math.floor(fx.rng() * GIB_CAP);
      const a = fx.rng() * TAU, sp = 60 + fx.rng() * 200;
      G.x[i] = x + Math.cos(a) * 6; G.y[i] = y + Math.sin(a) * 6; G.h[i] = 18 + fx.rng() * 25;
      G.vx[i] = Math.cos(a) * sp; G.vy[i] = Math.sin(a) * sp; G.vh[i] = 150 + fx.rng() * 260;
      G.rx[i] = fx.rng() * TAU; G.ry[i] = fx.rng() * TAU; G.age[i] = 0;
      G.s[i] = size * (0.6 + fx.rng() * 0.9);
      const c = col(green && k % 2 ? '#6f8f3a' : gibCols[k % gibCols.length]);
      G.c[i * 3] = c.r; G.c[i * 3 + 1] = c.g; G.c[i * 3 + 2] = c.b;
    }
  }

  function updateGibs(dt) {
    let w = 0;
    for (let i = 0; i < gn; i++) {
      G.age[i] += dt;
      if (G.age[i] > 9) continue;
      if (G.h[i] > 0.8 || G.vh[i] > 0) {
        G.vh[i] -= 900 * dt;
        G.x[i] += G.vx[i] * dt; G.y[i] += G.vy[i] * dt; G.h[i] += G.vh[i] * dt;
        G.rx[i] += dt * 9; G.ry[i] += dt * 7;
        if (G.h[i] < 0.8) {
          G.h[i] = 0.8;
          G.vh[i] = Math.abs(G.vh[i]) > 120 ? -G.vh[i] * 0.25 : 0;
          G.vx[i] *= 0.4; G.vy[i] *= 0.4;
        }
      }
      if (w !== i) {
        for (const k of ['x', 'h', 'y', 'vx', 'vh', 'vy', 'rx', 'ry', 's', 'age']) G[k][w] = G[k][i];
        G.c[w * 3] = G.c[i * 3]; G.c[w * 3 + 1] = G.c[i * 3 + 1]; G.c[w * 3 + 2] = G.c[i * 3 + 2];
      }
      const sink = G.age[w] > 7 ? (G.age[w] - 7) * 0.5 : 0;
      _p.set(G.x[w], G.h[w] - sink * G.s[w], G.y[w]);
      _q.setFromEuler(_e.set(G.rx[w], G.ry[w], 0));
      _s.set(G.s[w], G.s[w] * 0.7, G.s[w] * 0.85);
      _m4.compose(_p, _q, _s);
      gibs.setMatrixAt(w, _m4);
      gibs.instanceColor.setXYZ(w, G.c[w * 3], G.c[w * 3 + 1], G.c[w * 3 + 2]);
      w++;
    }
    gn = w;
    gibs.count = gn;
    gibs.visible = gn > 0;
    if (gn) {
      gibs.instanceMatrix.clearUpdateRanges();
      gibs.instanceMatrix.addUpdateRange(0, gn * 16);
      gibs.instanceMatrix.needsUpdate = true;
      gibs.instanceColor.clearUpdateRanges();
      gibs.instanceColor.addUpdateRange(0, gn * 3);
      gibs.instanceColor.needsUpdate = true;
    }
    stats.gibs = gn;
  }

  // ---- events -------------------------------------------------------------------------------
  const bloodCol = new THREE.Color('#7a0c0c');
  function nearestZombie(x, y, maxD) {
    const list = lastView && lastView.zombies;
    if (!list) return null;
    let best = null, bd = maxD * maxD;
    for (let k = 0; k < list.length; k++) {
      const z = list[k];
      const d = (z.x - x) * (z.x - x) + (z.y - y) * (z.y - y);
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }

  function addEvents(events) {
    if (!events) return;
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      switch (e.type) {
        case 'zdie': {
          const def = ZOMBIES[e.ztype] || ZOMBIES.walker;
          const r = def.radius;
          if (e.ztype === 'bloater') {
            ctx.ground.decal('acid', e.x, e.y, r * 1.3, fx.rng() * TAU, 0.8);
            ctx.ground.decal('gore', e.x, e.y, r * 0.8, fx.rng() * TAU, 0.8);
            spawnGibs(e.x, e.y, high ? 12 : 6, 3.2, true);
          } else if (e.gib) {
            ctx.ground.decal('gore', e.x, e.y, r * 1.1, fx.rng() * TAU, 0.95);
            spawnGibs(e.x, e.y, (high ? 8 : 4) + Math.round(r / 5), 2.2 * (r / 14) ** 0.5, false);
            for (let j = 0; j < (high ? 18 : 8); j++) {
              const a = fx.rng() * TAU, sp = 60 + fx.rng() * 160;
              fx.spawn(e.x, 20 + fx.rng() * 20, e.y, Math.cos(a) * sp, 80 + fx.rng() * 160, Math.sin(a) * sp, 0.7 + fx.rng() * 0.5, 3 + fx.rng() * 3, 2, bloodCol, 0.95, FR.CHUNK, F_BOUNCE, 700, 0.4);
            }
          } else {
            addCorpse(e);
            ctx.ground.decal('blood', e.x - Math.cos(e.angle || 0) * r * 0.6, e.y - Math.sin(e.angle || 0) * r * 0.6, r * 0.9, fx.rng() * TAU, 0.9);
          }
          state.delete(e.id);
          break;
        }
        case 'zattack': {
          const s = state.get(e.id);
          if (s) s.atk = 0;
          break;
        }
        case 'scream': {
          const s = state.get(e.id);
          if (s) s.scream = 0;
          break;
        }
        case 'spit': {
          const s = state.get(e.id);
          if (s) s.spit = 0;
          break;
        }
        case 'slam': {
          const s = state.get(e.id);
          if (s) s.slam = 0;
          break;
        }
        case 'charge': {
          const s = state.get(e.id);
          if (s) s.charge = Math.max(s.charge, 0.6);
          break;
        }
        case 'shot': {
          if (e.echo) break;
          const rays = e.rays;
          if (!rays) break;
          for (let j = 0; j < rays.length; j++) {
            const r = rays[j];
            if (!r || r.hit !== 1) continue;
            const z = nearestZombie(r.x, r.y, 40);
            if (z) { const s = state.get(z.id); if (s) s.flinch = 0; }
          }
          break;
        }
        case 'chain': {
          const pts = e.points || [];
          for (let j = 1; j < pts.length; j++) {
            const z = nearestZombie(pts[j].x, pts[j].y, 30);
            if (z) { const s = state.get(z.id); if (s) s.flinch = 0; }
          }
          break;
        }
        default:
          break;
      }
    }
  }

  return {
    stats,
    update,
    addEvents,
    setQuality(q) {
      high = q !== 'low';
      for (const t of ZOMBIE_IDS) types[t].live.mesh.castShadow = high;
    },
    dispose() {
      for (const t of ZOMBIE_IDS) { types[t].live.dispose(); types[t].dead.material.dispose(); types[t].dead.depthMaterial.dispose(); types[t].dead.texture.dispose(); }
      gibGeo.dispose();
      gibMat.dispose();
      gibs.dispose();
      root.removeFromParent();
      releaseFx(ctx);
    },
  };
}

export { createZombies3D as createZombies };
