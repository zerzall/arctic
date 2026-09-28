// Zombies in the first-person view (ACTORS, SPEC §7.5). Sculpted models per type and LOD
// (actor-zmodels.js) on the GPU crowd rig (actor-rig.js): every zombie and corpse of a
// type × LOD is one instanced draw, all posed in JS and uploaded as one bone texture, so
// 300 zombies + 120 corpses cost at most 24 draw calls (+ their shadow passes). Zombies
// outside the view frustum are not drawn at all; distance picks the LOD (with hysteresis).
//
// Animation (per type, phased by id): shambling gait with hip sway, head bob and a limp,
// sprinting runners, legless crawlers pulling themselves along, waddling bloaters with a
// pulsing belly, hunched spitters that rear back to spit, twitchy screamers that arch
// back to scream, lumbering brutes (head-down charge) and the stomping boss (slam
// wind-up); attack swipes with a bite, a flinch away from each flesh hit, a stagger when
// knocked back, flailing and charring while on fire, and ragdoll-ish death falls (back,
// face-down, sideways or crumpling at the knees — away from the killer) into corpses that
// stay and eventually sink away. Gibs: meat and bone chunks that bounce and settle.

import * as THREE from 'three';
import { ZOMBIES, ZOMBIE_IDS, ZFLAG } from '../shared/zombies.js';
import { col, mixHex, shadeHex, hash01, angleDiff, damp } from './actor-kit.js';
import { RigPool, Pose, B, T_SKIN, T_CLOTH, T_CLOTH2, T_ACCENT, T_HAIR, T_FX, T_FX2, TEX_W } from './actor-rig.js';
import { buildZombie, zombieSkeleton } from './actor-zmodels.js';
import { geometryFromArrays, ShapeBuilder, SLOT, MAT } from './actor-shape.js';
import { actorTextures } from './actor-tex.js';
import { acquireFx, releaseFx, F_ADD, F_FIRE, F_BOUNCE, F_FLICKER, FR } from './fx-core.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const CAPACITY = 320;
const CORPSE_CAP = 120;
const CORPSE_LIFE = 30;      // seconds before a corpse starts sinking away
const CORPSE_SINK = 4;
const GIB_CAP = 160;

// Height scale per type (look.scale is a top-down sprite scale; giants would be absurd
// at 3.2× in first person).
const SCALE = { walker: 1, runner: 0.95, crawler: 0.9, bloater: 1.12, spitter: 1, screamer: 1.02, brute: 1.55, boss: 2.5 };
// stride length (units per gait cycle at scale 1) — sets how fast legs cycle for a speed
const STRIDE = { walker: 44, runner: 74, crawler: 36, bloater: 36, spitter: 46, screamer: 50, brute: 58, boss: 72 };
const EYE = { walker: '#ffc84a', runner: '#ffd070', crawler: '#ffb84a', bloater: '#dcff5a', spitter: '#a8ff3a', screamer: '#cfe4ff', brute: '#ff8a2a', boss: '#ff3ad0' };
const PANTS = ['#34405a', '#2a2b30', '#5e5540', '#453526', '#4d5058', '#39466a'];
const HAIR = ['#1a120c', '#3a2616', '#262626', '#4a3a2c', '#5c4a36', '#6b6b66'];
// LOD distances (units) per quality; scaled by the zombie's size
const LOD_DIST = { ultra: [440, 1100], high: [290, 760], low: [160, 460] };

// Model arrays are pure CPU data: build once per page, share across games.
const modelCache = new Map();
function modelArrays(type, L) {
  const k = type + L;
  let a = modelCache.get(k);
  if (!a) { a = buildZombie(type, L).arrays(); modelCache.set(k, a); }
  return a;
}

function instancedGeometry(a) {
  const g = geometryFromArrays(a);
  const ig = new THREE.InstancedBufferGeometry();
  for (const name in g.attributes) ig.setAttribute(name, g.attributes[name]);
  ig.setIndex(g.index);
  ig.boundingSphere = g.boundingSphere;
  return ig;
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
  let quality = ctx.quality || 'high';
  let high = quality !== 'low';

  const tex = actorTextures(quality === 'ultra' ? 16 : 8);
  const pool = new RigPool({ capacity: CAPACITY + CORPSE_CAP, textures: tex });
  const types = {};
  for (const t of ZOMBIE_IDS) {
    const sk = zombieSkeleton(t);
    const rim = t === 'boss' ? '#d8a0ff' : t === 'spitter' ? '#b8ff8a' : t === 'screamer' ? '#c8d8ff' : '#9fc0ff';
    const lods = [];
    for (let L = 0; L < 3; L++) {
      const m = pool.addModel(instancedGeometry(modelArrays(t, L)), sk, {
        rim, rimStrength: 0.38, castShadow: high && L === 0, receiveShadow: high && L === 0, name: 'z-' + t + L,
      });
      root.add(m.mesh);
      lods.push(m);
    }
    types[t] = { lods, P: sk.P, scale: SCALE[t] || 1, def: ZOMBIES[t] };
  }
  pool.warm();

  // per-type colour tables: skin variations, dirtied clothes, trousers, hair
  const skinCols = {}, clothCols = {}, eyeCols = {};
  for (const t of ZOMBIE_IDS) {
    const look = ZOMBIES[t].look;
    skinCols[t] = [0, 1, 2, 3].map((k) => new THREE.Color(mixHex(shadeHex(look.skin, 0.06 - k * 0.04), ['#a8a880', '#6a8a5a', '#8a7a8a', '#9a9a70'][k], 0.14 + k * 0.04)));
    clothCols[t] = look.clothes.map((c) => new THREE.Color(shadeHex(mixHex(c, '#4a463c', 0.25), -0.04)));
    eyeCols[t] = new THREE.Color(EYE[t] || '#ffcf66');
  }
  const pantsCols = PANTS.map((c) => new THREE.Color(c));
  const hairCols = HAIR.map((c) => new THREE.Color(c));
  const eliteEye = new THREE.Color('#ff3b1a');
  const bossPants = new THREE.Color('#2a1c30');

  // per-zombie animation state
  const state = new Map();
  let frameNo = 0;
  let lastView = null;
  const pose = new Pose();
  const frustum = new THREE.Frustum();
  const _pm = new THREE.Matrix4();
  const _sph = new THREE.Sphere();

  // corpses
  const corpses = [];

  // ---- gibs (meat chunks and bone shards) ----
  const gibMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0 });
  const gibGeos = [gibChunkGeometry(0), gibChunkGeometry(1)];
  const gibMeshes = gibGeos.map((g) => {
    const m = new THREE.InstancedMesh(g, gibMat, GIB_CAP);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GIB_CAP * 3), 3);
    m.count = 0;
    m.frustumCulled = false;
    root.add(m);
    return m;
  });
  const G = { x: new Float32Array(GIB_CAP), h: new Float32Array(GIB_CAP), y: new Float32Array(GIB_CAP),
    vx: new Float32Array(GIB_CAP), vh: new Float32Array(GIB_CAP), vy: new Float32Array(GIB_CAP),
    rx: new Float32Array(GIB_CAP), ry: new Float32Array(GIB_CAP), s: new Float32Array(GIB_CAP), age: new Float32Array(GIB_CAP),
    k: new Uint8Array(GIB_CAP), c: new Float32Array(GIB_CAP * 3) };
  let gn = 0;
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

  const stats = { zombies: 0, drawn: 0, corpses: 0, gibs: 0, lod: [0, 0, 0] };

  function getState(z) {
    let s = state.get(z.id);
    if (!s || s.type !== z.type) {
      const seed = hash01(z.id * 31 + 7);
      s = {
        type: z.type, x: z.x, y: z.y, a: z.angle, ph: hash01(z.id) * TAU, spd: 0, vx: 0, vy: 0,
        atk: 9, atkN: 0, scream: 9, flinch: 9, hitA: 0, stagger: 0, slam: 9, charge: 0, spit: 9,
        seen: 0, seed, seed2: hash01(z.id * 7 + 3), fl: 0, lod: -1, char: 0, burn: 0, twitch: 0,
        armsUp: seed < 0.5, limp: seed > 0.62, tilt: (hash01(z.id * 13) - 0.5) * 0.6,
      };
      state.set(z.id, s);
    }
    return s;
  }

  // ---- pose ---------------------------------------------------------------------------------
  function poseZombie(z, s, T, time) {
    const t = z.type;
    const ph = s.ph;
    const amp = Math.min(1.25, s.spd / Math.max(30, T.def.speed[0] * 0.85));
    const sw = Math.sin(ph), cw = Math.cos(ph);
    const seed = s.seed, seed2 = s.seed2;
    const f = z.flags | 0;
    const attacking = (f & ZFLAG.ATTACKING) !== 0;
    const charging = s.charge;
    const burning = s.burn;
    // attack: raise (0..0.22), slash down + lunge (0.22..0.5), recover (..0.75)
    const at = s.atk;
    const raise = at < 0.22 ? at / 0.22 : at < 0.5 ? 1 - (at - 0.22) / 0.28 : 0;
    const lunge = at < 0.75 ? Math.sin(Math.min(1, at / 0.75) * Math.PI) : 0;
    const slash = at >= 0.22 && at < 0.5 ? Math.sin(((at - 0.22) / 0.28) * Math.PI) : 0;
    const armSide = s.atkN & 1;
    const gnaw = attacking ? Math.sin(time * 9 + seed * 10) : 0;
    const fl = s.flinch < 0.3 ? Math.sin((s.flinch / 0.3) * Math.PI) * (1 - s.flinch / 0.3 * 0.5) : 0;
    const stg = s.stagger;
    const scr = s.scream < 1.4 ? Math.min(1, s.scream * 5) * Math.min(1, (1.4 - s.scream) * 3) : 0;
    const twitch = s.twitch;

    pose.reset();
    // ---- generic shamble ----
    let bob = -Math.abs(cw) * 1.2 * amp + 0.6 * amp;
    let hipsX = sw * 0.07 * amp, hipsY = sw * 0.1 * amp, hipsZ = 0;
    let spineZ = -0.12 - seed * 0.1, spineX = -sw * 0.05 * amp, spineY = -sw * 0.08 * amp;
    let chestZ = -0.1 - seed2 * 0.12, chestX = s.tilt * 0.2, chestY = -sw * 0.06 * amp;
    let neckZ = 0.12, headZ = 0.12 + Math.sin(ph * 2) * 0.05 * amp, headX = s.tilt + Math.sin(time * 1.3 + seed * 9) * 0.07, headY = Math.sin(time * 0.7 + seed * 5) * 0.2;
    let jaw = -(0.18 + seed2 * 0.28) - Math.max(0, Math.sin(time * 1.7 + seed * 7)) * 0.12;
    // arms: reaching (classic) or dangling
    let uaLZ, uaRZ, uaLX = 0.12, uaRX = -0.12, faLZ, faRZ, hdLZ = -0.25, hdRZ = -0.25;
    if (s.armsUp) {
      uaLZ = 1.25 + sw * 0.12 * amp + Math.sin(time * 1.1 + seed) * 0.06; uaRZ = 1.18 - sw * 0.12 * amp;
      faLZ = 0.15 + cw * 0.08; faRZ = 0.25 - cw * 0.08;
      uaLX = 0.05; uaRX = -0.08;
    } else {
      uaLZ = -sw * 0.35 * amp + 0.05; uaRZ = sw * 0.35 * amp + 0.1;
      faLZ = 0.3 + Math.max(0, -sw) * 0.3 * amp; faRZ = 0.25 + Math.max(0, sw) * 0.3 * amp;
    }
    const limp = s.limp ? 0.45 : 1;
    let thL = sw * 0.46 * amp, thR = -sw * 0.46 * amp * limp;
    let shL = -Math.max(0, Math.sin(ph + 1.4)) * 0.8 * amp - 0.06, shR = -Math.max(0, -Math.sin(ph + 1.4)) * 0.8 * amp * (s.limp ? 0.3 : 1) - 0.06;
    let ftL = Math.max(0, cw) * 0.3 * amp - 0.05, ftR = Math.max(0, -cw) * 0.3 * amp - 0.05;
    let thLX = 0, thRX = 0;
    let x1Z = 0, x1X = 0, x2Z = 0, x2X = 0, x1S = 1;
    let rootX = 0, rootY = 0, rootZ = 0;
    if (s.limp) { hipsX += 0.05; rootY -= Math.max(0, -sw) * 0.8 * amp; }

    switch (t) {
      case 'runner': {
        bob = -Math.abs(cw) * 2.6 * amp + 1.4 * amp;
        spineZ = -0.3 - 0.12 * amp; chestZ = -0.2; chestY = -sw * 0.2 * amp; spineY = sw * 0.12 * amp;
        neckZ = 0.25; headZ = 0.3; headX = s.tilt * 0.4;
        uaLZ = -sw * 1.05 * amp + 0.25; uaRZ = sw * 1.05 * amp + 0.25; uaLX = 0.18; uaRX = -0.18;
        faLZ = 1.45 + Math.max(0, sw) * 0.3; faRZ = 1.45 + Math.max(0, -sw) * 0.3;
        hdLZ = -0.5; hdRZ = -0.5;
        thL = sw * 0.9 * amp + 0.1; thR = -sw * 0.9 * amp + 0.1;
        shL = -Math.max(0, Math.sin(ph + 1.3)) * 1.55 * amp - 0.25; shR = -Math.max(0, -Math.sin(ph + 1.3)) * 1.55 * amp - 0.25;
        ftL = Math.max(0, cw) * 0.5 * amp - 0.25; ftR = Math.max(0, -cw) * 0.5 * amp - 0.25;
        jaw = -0.55 - Math.sin(time * 6 + seed * 3) * 0.12;
        break;
      }
      case 'crawler': {
        // legless: prone, pulling itself with alternating arms, stumps dragging
        bob = 0;
        hipsZ = -1.42; hipsX = sw * 0.06; hipsY = sw * 0.12;
        rootY = -22.5 + Math.max(0, sw) * 1.2; rootX = -2 + Math.max(0, -cw) * 2.5;
        spineZ = 0.06 + sw * 0.05; chestZ = 0.12; chestY = sw * 0.15; chestX = 0;
        neckZ = 0.55; headZ = 0.75 + Math.sin(time * 2 + seed) * 0.08; headX = s.tilt * 0.4; headY = sw * 0.2;
        uaLZ = 2.2 + sw * 0.8; uaRZ = 2.2 - sw * 0.8; uaLX = 0.35; uaRX = -0.35;
        faLZ = -0.2 - Math.max(0, cw) * 0.9; faRZ = -0.2 - Math.max(0, -cw) * 0.9;
        hdLZ = -0.6 - Math.max(0, cw) * 0.4; hdRZ = -0.6 - Math.max(0, -cw) * 0.4;
        thL = 0.15 + sw * 0.18; thR = 0.1 - sw * 0.18; thLX = 0.15; thRX = -0.15;
        shL = -0.3 + cw * 0.3; shR = -0.4 - cw * 0.3;
        ftL = 0; ftR = 0;
        jaw = -0.45 - Math.max(0, Math.sin(time * 3 + seed * 5)) * 0.25;
        break;
      }
      case 'bloater': {
        bob = -Math.abs(cw) * 1.4 * amp + 0.7 * amp;
        hipsX = sw * 0.16 * amp; hipsY = sw * 0.06 * amp;
        spineZ = 0.16; chestZ = 0.05; chestX = -sw * 0.08 * amp;
        neckZ = 0.1; headZ = 0.05; headX = s.tilt * 1.2 + Math.sin(time * 0.9 + seed * 3) * 0.12;
        uaLZ = 0.55 + sw * 0.15 * amp; uaRZ = 0.55 - sw * 0.15 * amp; uaLX = 0.6; uaRX = -0.6;
        faLZ = 0.35; faRZ = 0.35;
        thL = sw * 0.3 * amp; thR = -sw * 0.3 * amp; thLX = 0.1; thRX = -0.1;
        shL = -Math.max(0, Math.sin(ph + 1.4)) * 0.45 * amp; shR = -Math.max(0, -Math.sin(ph + 1.4)) * 0.45 * amp;
        // belly: wobble with the steps and a slow, sickly pulse
        const pulse = Math.sin(time * 2.6 + seed * 7) * 0.045 + Math.sin(time * 5.1 + seed) * 0.015;
        x1S = 1 + pulse;
        x1Z = Math.sin(ph * 2 + 0.6) * 0.035 * amp; x1X = sw * 0.05 * amp;
        jaw = -0.3;
        break;
      }
      case 'spitter': {
        spineZ = -0.2; chestZ = -0.28; neckZ = 0.45; headZ = 0.2;
        uaLZ = 0.35 + sw * 0.25 * amp; uaRZ = 0.35 - sw * 0.25 * amp; faLZ = 0.55; faRZ = 0.55;
        jaw = -0.55 - Math.sin(time * 2.2 + seed * 3) * 0.1;
        x1S = 1 + Math.sin(time * 3.4 + seed * 5) * 0.08;
        if (s.spit < 0.7) {                                   // rear back, then retch forward
          const k = s.spit / 0.7;
          const e = k < 0.45 ? -k / 0.45 : Math.sin(((k - 0.45) / 0.55) * Math.PI);
          chestZ += e * -0.5; neckZ += e * -0.3; headZ += e * -0.5;
          jaw = -0.5 - Math.max(0, e) * 0.5;
          x1S = 1 + (k < 0.45 ? k / 0.45 : 1 - (k - 0.45) / 0.55) * 0.35;
        }
        break;
      }
      case 'screamer': {
        // stiff, twitchy; arms dangle loosely; head cocked
        spineZ = -0.05; chestZ = -0.06;
        uaLZ = -sw * 0.25 * amp - 0.05; uaRZ = sw * 0.25 * amp - 0.05; uaLX = 0.12; uaRX = -0.12; faLZ = 0.12; faRZ = 0.12;
        hdLZ = -0.1; hdRZ = -0.1;
        headZ = 0.25; headX = s.tilt * 1.4 + twitch * 0.5;
        neckZ = 0.1;
        jaw = -0.35 - twitch * 0.3;
        if (scr > 0) {
          spineZ += scr * 0.25; chestZ += scr * 0.3; neckZ -= scr * 0.3; headZ += scr * 0.55;
          uaLZ += scr * 0.6; uaRZ += scr * 0.6; uaLX += scr * 1.0; uaRX -= scr * 1.0;
          faLZ += scr * 0.5; faRZ += scr * 0.5; hdLZ += scr * 0.6; hdRZ += scr * 0.6;
          jaw = -0.35 - scr * 0.95;
          headX += Math.sin(time * 42) * 0.06 * scr; chestX += Math.sin(time * 37) * 0.03 * scr;
        }
        break;
      }
      case 'brute': {
        bob = -Math.abs(cw) * 2.2 * amp + 1.1 * amp;
        hipsX = sw * 0.1 * amp; hipsY = sw * 0.12 * amp;
        spineZ = -0.25; chestZ = -0.25; chestY = -sw * 0.14 * amp; neckZ = 0.35; headZ = 0.3;
        uaLZ = 0.35 - sw * 0.35 * amp; uaRZ = 0.25 + sw * 0.4 * amp; uaLX = 0.25; uaRX = -0.3;
        faLZ = 0.5; faRZ = 0.35; hdLZ = -0.2; hdRZ = -0.1;
        thL = sw * 0.42 * amp; thR = -sw * 0.42 * amp; thLX = 0.08; thRX = -0.08;
        jaw = -0.2 - Math.max(0, Math.sin(time * 1.3 + seed * 4)) * 0.15;
        if (charging > 0) {
          spineZ -= charging * 0.45; chestZ -= charging * 0.25; neckZ += charging * 0.35; headZ += charging * 0.2;
          uaLZ -= charging * 0.9; uaRZ -= charging * 0.9; uaLX += charging * 0.25; uaRX -= charging * 0.25;
          bob += charging * Math.abs(sw) * 2;
          jaw = -0.5 - charging * 0.3;
        }
        break;
      }
      case 'boss': {
        bob = -Math.abs(cw) * 1.8 * amp + 0.9 * amp;
        hipsX = sw * 0.08 * amp;
        spineZ = -0.15; chestZ = -0.18; neckZ = 0.35; headZ = 0.2; headX = Math.sin(time * 0.8) * 0.1;
        uaLZ = 0.55 + sw * 0.25 * amp; uaRZ = 0.55 - sw * 0.25 * amp; uaLX = 0.35; uaRX = -0.35;
        faLZ = 0.55; faRZ = 0.55;
        thL = sw * 0.36 * amp; thR = -sw * 0.36 * amp; thLX = 0.1; thRX = -0.1;
        x2Z = 0.7 + Math.sin(time * 3.3 + seed) * 0.45; x2X = 0.5 + Math.sin(time * 2.1) * 0.2;   // third arm flails
        x1X = Math.sin(time * 1.2) * 0.04; x1S = 1 + Math.sin(time * 1.9) * 0.025;
        jaw = -0.3 - Math.max(0, Math.sin(time * 0.9)) * 0.3;
        if (charging > 0) {                                          // slam wind-up: arms overhead
          chestZ += charging * 0.3; headZ -= charging * 0.1; spineZ += charging * 0.15;
          uaLZ += charging * 2.3; uaRZ += charging * 2.3; faLZ -= charging * 0.4; faRZ -= charging * 0.4;
          jaw = -0.9 * charging;
        }
        if (s.slam < 0.5) {                                          // smash down
          const k = 1 - s.slam / 0.5;
          chestZ -= k * 0.55; spineZ -= k * 0.25; uaLZ = 1.25 + k * 0.2; uaRZ = 1.25 + k * 0.2; faLZ = -0.2; faRZ = -0.2;
          rootY -= k * 4; thL += k * 0.4; thR += k * 0.4; shL -= k * 0.8; shR -= k * 0.8;
        }
        break;
      }
      default:
        break;
    }

    // ---- attack: swipe with one arm (alternating), lunge and bite ----
    if (lunge > 0) {
      if (t === 'crawler') {
        uaLZ += raise * 0.7 + slash * 0.3; uaRZ += raise * 0.7; headZ += lunge * 0.3; rootX += lunge * 6; jaw -= lunge * 0.5;
      } else {
        spineZ -= lunge * 0.28; chestZ -= lunge * 0.22; rootX += lunge * 4;
        headZ -= lunge * 0.15; jaw -= lunge * 0.55;
        if (armSide) { uaRZ = uaRZ * (1 - raise) + (2.5 * raise) - slash * 1.6; faRZ -= raise * 0.6 - slash * 0.4; uaRX -= raise * 0.4; }
        else { uaLZ = uaLZ * (1 - raise) + (2.5 * raise) - slash * 1.6; faLZ -= raise * 0.6 - slash * 0.4; uaLX += raise * 0.4; }
        chestY += (armSide ? -1 : 1) * slash * 0.35;
      }
    } else if (attacking) {
      // pinned to its victim: gnawing, clawing
      chestZ -= 0.18 + gnaw * 0.05; neckZ += 0.1; headZ += gnaw * 0.15; jaw = -0.5 - Math.abs(gnaw) * 0.4;
      uaLZ = Math.max(uaLZ, 1.3) + gnaw * 0.2; uaRZ = Math.max(uaRZ, 1.3) - gnaw * 0.2;
    }
    // ---- burning: flailing, writhing ----
    if (burning > 0.01 && t !== 'crawler') {
      const b = burning;
      uaLZ = uaLZ * (1 - b * 0.7) + b * (1.8 + Math.sin(time * 7.3 + seed * 3) * 0.9);
      uaRZ = uaRZ * (1 - b * 0.7) + b * (1.6 + Math.sin(time * 6.1 + seed * 5) * 0.9);
      uaLX += b * 0.4 * Math.sin(time * 5 + seed); uaRX -= b * 0.4 * Math.sin(time * 4.3);
      faLZ += b * 0.6; faRZ += b * 0.6;
      headX += Math.sin(time * 9 + seed) * 0.15 * b; jaw = -0.6 - Math.abs(Math.sin(time * 8)) * 0.3 * b;
      chestX += Math.sin(time * 3.3) * 0.12 * b;
    }
    // ---- flinch away from the hit, stagger from knockback ----
    if (fl > 0) {
      const back = Math.cos(s.hitA), side = Math.sin(s.hitA);
      spineZ += fl * 0.28 * back; chestZ += fl * 0.25 * back; headZ += fl * 0.4 * back;
      chestX -= fl * 0.3 * side; headX -= fl * 0.35 * side;
      uaLZ += fl * 0.3; uaRZ += fl * 0.25; rootX -= fl * 1.6 * back;
    }
    if (stg > 0.01) {
      const k = stg;
      spineZ += k * 0.35; chestZ += k * 0.3; headZ += k * 0.35;
      uaLZ += k * (0.9 + Math.sin(time * 11) * 0.4); uaRZ += k * (0.7 + Math.sin(time * 9 + 1) * 0.4); uaLX += k * 0.5; uaRX -= k * 0.5;
      thL += k * 0.35; shL -= k * 0.5; thR -= k * 0.2;
      rootX -= k * 2;
    }

    // ---- write the pose ----
    pose.set(B.HIPS, hipsX, hipsY, hipsZ);
    pose.set(B.SPINE, spineX, spineY, spineZ);
    pose.set(B.CHEST, chestX, chestY, chestZ);
    pose.set(B.NECK, 0, headY * 0.4, neckZ);
    pose.set(B.HEAD, headX, headY * 0.6, headZ);
    pose.set(B.JAW, 0, 0, jaw);
    pose.set(B.UARM_L, uaLX, 0, uaLZ);
    pose.set(B.FARM_L, 0, 0, faLZ);
    pose.set(B.HAND_L, 0.1, 0, hdLZ);
    pose.set(B.UARM_R, uaRX, 0, uaRZ);
    pose.set(B.FARM_R, 0, 0, faRZ);
    pose.set(B.HAND_R, -0.1, 0, hdRZ);
    pose.set(B.THIGH_L, thLX, 0, thL);
    pose.set(B.SHIN_L, 0, 0, shL);
    pose.set(B.FOOT_L, 0, 0, ftL);
    pose.set(B.THIGH_R, thRX, 0, thR);
    pose.set(B.SHIN_R, 0, 0, shR);
    pose.set(B.FOOT_R, 0, 0, ftR);
    pose.set(B.X1, x1X, 0, x1Z);
    pose.scale(B.X1, x1S, x1S, x1S);
    pose.set(B.X2, x2X, 0, x2Z);
    pose.root[0] = rootX; pose.root[1] = rootY + bob; pose.root[2] = rootZ;
  }

  function writeColors(k, z, s, elite) {
    const t = z.type, id = z.id;
    pool.color(k, T_SKIN, skinCols[t][id & 3], t === 'screamer' ? 0.55 : 0.75 + s.seed2 * 0.25);
    const cl = clothCols[t];
    const tear = t === 'brute' || t === 'boss' ? 0.8 : 0.25 + s.seed * 0.55;
    pool.color(k, T_CLOTH, cl[id % cl.length], tear);
    pool.color(k, T_CLOTH2, t === 'boss' ? bossPants : pantsCols[(id >> 2) % pantsCols.length], 0.35 + s.seed2 * 0.55);
    pool.color(k, T_ACCENT, elite ? eliteEye : eyeCols[t], elite ? 7 : t === 'boss' ? 5 : 2.6);
    pool.color(k, T_HAIR, hairCols[(id >> 1) % hairCols.length], (id % 97) + s.seed * 13);
  }

  // ---- update ---------------------------------------------------------------------------
  const burning = [];
  const _o = { x: 0, y: 0, z: 0 };
  function update(view, frame) {
    fx.begin(frame);
    frameNo++;
    const dt = Math.min(0.1, frame.dt || 0);
    const time = frame.now || 0;
    lastView = view;
    pool.begin(time);
    burning.length = 0;
    const cam = ctx.camera;
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(_pm);
    const lodD = LOD_DIST[quality] || LOD_DIST.high;
    const list = (view && view.zombies) || [];
    const camX = frame.camX, camY = frame.camY;
    stats.lod[0] = stats.lod[1] = stats.lod[2] = 0;
    let drawn = 0;
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
        const tele = d > 60;
        const ivx = tele ? 0 : dx / dt, ivy = tele ? 0 : dy / dt;
        s.vx += (ivx - s.vx) * damp(8, dt); s.vy += (ivy - s.vy) * damp(8, dt);
        const v = tele ? 0 : d / dt;
        s.spd += (v - s.spd) * damp(6, dt);
        // knocked back: moving fast against its facing → stagger
        const along = s.vx * Math.cos(s.a) + s.vy * Math.sin(s.a);
        if (!tele && along < -60 && z.type !== 'boss') s.stagger = Math.min(1, s.stagger + dt * 6);
      }
      s.stagger = Math.max(0, s.stagger - dt * 2.2);
      if (z._spd !== undefined) s.spd = z._spd;          // sandbox treadmill hook (never in snapshots)
      s.x = z.x; s.y = z.y;
      s.a += angleDiff(s.a, z.angle) * damp(10, dt);
      const stride = STRIDE[z.type] * T.scale;
      s.ph += (Math.min(s.spd, T.def.speed[1] * 2) / stride) * TAU * dt;
      s.atk += dt; s.scream += dt; s.flinch += dt; s.slam += dt; s.spit += dt;
      const f = z.flags | 0;
      if ((f & ZFLAG.ATTACKING) && !(s.fl & ZFLAG.ATTACKING) && s.atk > 0.8) { s.atk = 0; s.atkN++; }
      s.fl = f;
      const chg = (f & ZFLAG.CHARGING) ? 1 : 0;
      s.charge += (chg - s.charge) * damp(chg ? 8 : 4, dt);
      const burn = (f & ZFLAG.BURNING) ? 1 : 0;
      s.burn += (burn - s.burn) * damp(burn ? 6 : 2, dt);
      if (burn) s.char = Math.min(1, s.char + dt * 0.22);
      if (z.type === 'screamer') {
        s.twitch *= 1 - damp(10, dt);
        if (fx.rng() < dt * 1.5) s.twitch = (fx.rng() - 0.5) * 2;
      }
      const elite = (f & ZFLAG.ELITE) !== 0;
      const sc = T.scale * (elite ? 1.08 : 1);
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
      // view-frustum cull (generous margin: flashlight shadows, big bodies)
      _sph.center.set(z.x, 30 * sc, z.y);
      _sph.radius = 42 * sc;
      if (!frustum.intersectsSphere(_sph)) continue;
      // LOD with hysteresis
      const dist = Math.sqrt(d2) / Math.max(1, sc * 0.8);
      let L = dist < lodD[0] ? 0 : dist < lodD[1] ? 1 : 2;
      if (s.lod >= 0 && L !== s.lod) {
        const edge = L > s.lod ? lodD[s.lod] : lodD[L];
        if (Math.abs(dist - edge) < edge * 0.08) L = s.lod;
      }
      s.lod = L;
      const model = T.lods[L];
      const i = pool.push(model);
      if (i < 0) continue;
      drawn++;
      stats.lod[L]++;
      poseZombie(z, s, T, time);
      pose.place(z.x, 0, z.y, s.a, sc);
      pool.solve(i, model, pose);
      writeColors(i, z, s, elite);
      const buff = (f & ZFLAG.BUFFED) ? 0.6 + Math.sin(time * 8 + s.seed * 6) * 0.4 : 0;
      const flash = s.flinch < 0.1 ? 1 - s.flinch / 0.1 : 0;
      pool.texel(i, T_FX, buff, s.char, flash, 1);
      const glowK = z.type === 'bloater' ? 0.9 + Math.sin(time * 2.6 + s.seed * 7) * 0.4
        : z.type === 'spitter' ? 0.8 + Math.sin(time * 3.4 + s.seed * 5) * 0.3 + (s.spit < 0.7 ? 1.4 : 0) : 2.2;
      pool.texel(i, T_FX2, s.burn, glowK, 0, 0);
      if ((elite || z.type === 'boss') && d2 < 1600 * 1600) eyeGlow(i, z, T, elite);
    }
    stats.zombies = list.length;
    stats.drawn = drawn;
    // forget zombies that vanished (without a zdie we saw)
    if (frameNo % 30 === 0) for (const [id, s] of state) if (frameNo - s.seen > 30) state.delete(id);
    burnLights();
    updateCorpses(dt, time, lodD);
    pool.end();
    updateGibs(dt);
  }

  function eyeGlow(i, z, T, elite) {
    const P = T.P;
    const c = elite ? eliteEye : eyeCols[z.type];
    for (const sgn of [-1, 1]) {
      pool.point(i, B.HEAD, P.headC[0] + P.headR[0] * 0.95, P.headC[1] + P.headR[1] * 0.12, sgn * P.headR[2] * 0.36, _o);
      fx.glow(_o.x, _o.y, _o.z, elite ? 6 : 10, c, elite ? 0.7 : 0.5);
    }
  }

  const flameCol = new THREE.Color(1, 1, 1);
  function emitFlames(z, sc, d2, dt) {
    if (d2 > 2200 * 2200 || fx.load() > 0.8) return;
    const near = d2 < 700 * 700;
    const rate = (near ? (high ? 24 : 10) : (high ? 7 : 3)) * Math.min(2.2, sc);
    let n = rate * dt;
    while (n > 0) {
      if (n < 1 && fx.rng() > n) break;
      n -= 1;
      const a = fx.rng() * TAU, r = fx.rng() * 7 * sc;
      const h = (8 + fx.rng() * 42) * sc * (z.type === 'crawler' ? 0.3 : 1);
      const idx = fx.spawn(z.x + Math.cos(a) * r, h, z.y + Math.sin(a) * r, (fx.rng() - 0.5) * 12, 30 + fx.rng() * 40, (fx.rng() - 0.5) * 12,
        0.35 + fx.rng() * 0.3, (7 + fx.rng() * 6) * Math.sqrt(sc), 2, flameCol, 0.9, FR.FLAME, F_ADD | F_FIRE | F_FLICKER, -40, 1.2);
      fx.stretchLast(idx, 1.5);
      if (near && fx.rng() < 0.12) {
        fx.spawn(z.x + Math.cos(a) * r, h + 10, z.y + Math.sin(a) * r, (fx.rng() - 0.5) * 8, 26, (fx.rng() - 0.5) * 8,
          1.4 + fx.rng(), 6, 22, col('#1e1a18'), 0.3, FR.SMOKE, 0, -4, 0.5);
      }
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

  // ---- corpses: death falls -----------------------------------------------------------------
  function addCorpse(e) {
    const type = ZOMBIES[e.ztype] ? e.ztype : 'walker';
    if (corpses.length >= CORPSE_CAP) corpses.shift();
    const s = state.get(e.id);
    const seed = hash01((e.id | 0) * 13 + frameNo);
    const facing = s ? s.a : (e.angle || 0);
    // fall away from the killer when we know where they stood
    let push = facing + Math.PI;
    const killer = e.by && lastView && lastView.players ? lastView.players.find((p) => p.id === e.by) : null;
    if (killer) push = Math.atan2(e.y - killer.y, e.x - killer.x);
    else if (s && s.flinch < 1) push = facing + Math.PI + s.hitA;
    const rel = angleDiff(facing, push);          // 0 = pushed forward (falls on its face)
    let kind;
    if (type === 'crawler') kind = 'flat';
    else if (seed < 0.2) kind = 'crumple';
    else if (Math.abs(rel) < 0.8) kind = 'front';
    else if (Math.abs(rel) > 2.3) kind = 'back';
    else kind = 'side';
    corpses.push({
      type, x: e.x, y: e.y, a: facing, t: 0, id: e.id | 0, seed, kind, side: rel > 0 ? 1 : -1,
      char: s ? s.char : 0, burn: s ? s.burn : 0, elite: false, lod: -1, spd: s ? Math.min(1, s.spd / 120) : 0,
      armsUp: s ? s.armsUp : true, tilt: s ? s.tilt : 0, cache: null,
    });
  }

  function poseCorpse(c, T) {
    const t = c.t, seed = c.seed;
    pose.reset();
    const P = T.P;
    // fall: gravity ease-in to the ground, a small bounce, then settled
    const TF = c.kind === 'crumple' ? 0.85 : 0.62;
    const f = Math.min(1, t / TF);
    const e = f * f;
    const settle = t > TF ? Math.exp(-(t - TF) * 7) * Math.sin((t - TF) * 22) * 0.07 : 0;
    const flail = Math.max(0, 1 - t / 0.9);
    const limp = Math.min(1, t / 0.5);
    const lieDepth = P.headR[2] * 0.9 + 0.5;
    let jaw = -0.6 * limp - seed * 0.3;
    if (c.kind === 'flat') {
      pose.set(B.HIPS, 0, 0, -1.45);
      pose.root[1] = -22.5 - e * 2;
      pose.set(B.CHEST, 0, 0, 0.1);
      pose.set(B.NECK, 0, 0, 0.3 - e * 0.3);
      pose.set(B.HEAD, (seed - 0.5) * 1.2 * e, (seed - 0.5) * 0.8, 0.5 - e * 0.9);
      pose.set(B.UARM_L, 0.4, 0, 2.2 - e * 0.6); pose.set(B.FARM_L, 0, 0, -0.4);
      pose.set(B.UARM_R, -0.5, 0, 2.3 - e * 0.9); pose.set(B.FARM_R, 0, 0, -0.2);
      pose.set(B.THIGH_L, 0.2, 0, 0.1); pose.set(B.THIGH_R, -0.15, 0, 0.05);
      pose.set(B.JAW, 0, 0, jaw);
      return;
    }
    if (c.kind === 'back' || c.kind === 'front' || c.kind === 'side') {
      const dir = c.kind === 'back' ? 1 : -1;
      const th = e * (HALF_PI - 0.04) + settle;
      if (c.kind === 'side') {
        pose.rootRot[0] = c.side * th;         // roll onto the side
        pose.rootPivot[2] = -c.side * 3;
        pose.root[1] = Math.sin(th) * (P.sw * 0.55);
      } else {
        pose.rootRot[2] = dir * th;
        pose.rootPivot[0] = dir > 0 ? -2.5 : 3.5;
        pose.root[1] = Math.sin(th) * (dir > 0 ? P.headR[0] * 0.9 : 4.8 * P.depth);
      }
      // knees give a little, arms fly up then fall slack, head whips and lolls
      pose.set(B.HIPS, 0, 0, dir * 0.15 * e);
      pose.set(B.SPINE, 0, 0, -dir * 0.1 * e);
      pose.set(B.CHEST, (seed - 0.5) * 0.3 * e, 0, -dir * 0.08 * e);
      pose.set(B.NECK, 0, 0, dir * 0.2 * e);
      pose.set(B.HEAD, (seed - 0.5) * 2.2 * e, (seed - 0.5) * 1.2 * e, dir * (0.35 * e - flail * 0.5));
      const up = flail * Math.sin(Math.min(1, t / 0.45) * Math.PI);
      pose.set(B.UARM_L, 0.3 + e * (0.5 + seed * 0.7), 0, (c.armsUp ? 1.2 : 0.3) * (1 - limp) + up * 1.4 + dir * e * (0.5 + seed));
      pose.set(B.FARM_L, 0, 0, 0.3 + e * 0.4);
      pose.set(B.HAND_L, 0, 0, -0.4 * e);
      pose.set(B.UARM_R, -0.3 - e * (0.9 - seed * 0.5), 0, (c.armsUp ? 1.1 : 0.3) * (1 - limp) + up * 1.2 + dir * e * (1.4 - seed));
      pose.set(B.FARM_R, 0, 0, 0.2 + seed * 0.6 * e);
      pose.set(B.HAND_R, 0, 0, -0.3 * e);
      pose.set(B.THIGH_L, -0.12 * e, 0, dir * 0.25 * e + (1 - e) * 0.2);
      pose.set(B.SHIN_L, 0, 0, -0.35 * e - 0.4 * (1 - e) * f);
      pose.set(B.THIGH_R, 0.18 * e, 0, -dir * 0.1 * e + (seed - 0.5) * 0.5 * e);
      pose.set(B.SHIN_R, 0, 0, -0.15 - seed * 0.8 * e);
      pose.set(B.FOOT_L, 0, 0, dir * 0.4 * e);
      pose.set(B.FOOT_R, 0.2, 0, dir * 0.3 * e);
      pose.set(B.JAW, 0, 0, jaw);
      pose.set(B.X2, 0.8, 0, 0.4);
      return;
    }
    // crumple: the knees fold first, then it topples forward onto its face
    const k1 = Math.min(1, t / 0.35), k1e = k1 * k1;
    const k2 = Math.max(0, Math.min(1, (t - 0.3) / 0.55)), k2e = k2 * k2;
    const knee = P.knee;
    pose.set(B.THIGH_L, 0, 0, 1.35 * k1e); pose.set(B.SHIN_L, 0, 0, -2.3 * k1e); pose.set(B.FOOT_L, 0, 0, -0.6 * k1e);
    pose.set(B.THIGH_R, 0.1, 0, 1.2 * k1e); pose.set(B.SHIN_R, 0, 0, -2.2 * k1e); pose.set(B.FOOT_R, 0, 0, -0.6 * k1e);
    pose.root[1] = -knee * 0.9 * k1e;
    pose.rootRot[2] = -(k2e * 1.25 + (k2 >= 1 ? settle : 0));
    pose.rootRot[0] = c.side * 0.35 * k2e;
    pose.rootPivot[0] = 4; pose.rootPivot[1] = knee * 0.2;
    pose.root[1] += k2e * 3;
    pose.set(B.SPINE, 0, 0, -0.2 * k1e);
    pose.set(B.CHEST, 0, 0, -0.25 * k1e + 0.25 * k2e);
    pose.set(B.NECK, 0, c.side * 0.6 * k2e, 0.3 * k2e);
    pose.set(B.HEAD, c.side * 0.9 * k2e, c.side * 0.4 * k2e, 0.4 * k2e);
    pose.set(B.UARM_L, 0.4 * k2e, 0, 0.3 * (1 - k2e) + 2.4 * k2e);
    pose.set(B.FARM_L, 0, 0, 0.5 * k2e);
    pose.set(B.UARM_R, -0.6 * k2e, 0, 0.2 + 0.4 * k2e);
    pose.set(B.FARM_R, 0, 0, 0.6);
    pose.set(B.JAW, 0, 0, jaw);
  }

  const corpseSkin = new THREE.Color(), corpseCloth = new THREE.Color();
  function updateCorpses(dt, time, lodD) {
    let w = 0;
    const camX = ctx.camera.position.x, camY = ctx.camera.position.z;
    for (let k = 0; k < corpses.length; k++) {
      const c = corpses[k];
      c.t += dt;
      if (c.t > CORPSE_LIFE + CORPSE_SINK) continue;
      corpses[w++] = c;
      c.burn = Math.max(0, c.burn - dt * 0.4);
      const T = types[c.type];
      _sph.center.set(c.x, 8, c.y);
      _sph.radius = 40 * T.scale;
      if (!frustum.intersectsSphere(_sph)) continue;
      const d = Math.hypot(c.x - camX, c.y - camY) / Math.max(1, T.scale * 0.8);
      const L = d < lodD[0] ? 0 : d < lodD[1] ? 1 : 2;
      const model = T.lods[L];
      const i = pool.push(model);
      if (i < 0) continue;
      const sink = c.t > CORPSE_LIFE ? -((c.t - CORPSE_LIFE) / CORPSE_SINK) * 16 : 0;
      // settled corpses reuse their last solved bones (they only change when sinking)
      const W4 = TEX_W * 4;
      if (c.cache && c.t > 2 && sink === 0 && c.cacheL === L && c.burn < 0.01) {
        pool.stage.set(c.cache, i * W4);
        continue;
      }
      poseCorpse(c, T);
      pose.place(c.x, sink, c.y, c.a, T.scale);
      pool.solve(i, model, pose);
      const skin = skinCols[c.type][c.id & 3];
      // dulled: the dead should not compete with the living for attention
      corpseSkin.copy(skin).multiplyScalar(0.7);
      pool.color(i, T_SKIN, corpseSkin, 0.95);
      const cl = clothCols[c.type];
      corpseCloth.copy(cl[c.id % cl.length]).multiplyScalar(0.75);
      pool.color(i, T_CLOTH, corpseCloth, 0.5);
      pool.color(i, T_CLOTH2, pantsCols[(c.id >> 2) % pantsCols.length], 0.9);
      pool.texel(i, T_ACCENT, 0.05, 0.03, 0.02, 0);
      pool.color(i, T_HAIR, hairCols[(c.id >> 1) % hairCols.length], (c.id % 97) + c.seed * 13);
      pool.texel(i, T_FX, 0, c.char, 0, 0.3);
      pool.texel(i, T_FX2, c.burn, c.type === 'bloater' || c.type === 'spitter' ? 0.25 : 0.6, 0.35, 0);
      if (c.t > 2 && sink === 0) {
        if (!c.cache) c.cache = new Float32Array(W4);
        c.cache.set(pool.stage.subarray(i * W4, (i + 1) * W4));
        c.cacheL = L;
      }
    }
    corpses.length = w;
    stats.corpses = w;
  }

  // ---- gibs -------------------------------------------------------------------------------
  const gibCols = ['#6a1418', '#8a1c1c', '#4a0c0c', '#a0786a', '#7a2a2a'];
  function spawnGibs(x, y, count, size, green) {
    for (let k = 0; k < count; k++) {
      let i;
      if (gn < GIB_CAP) i = gn++;
      else i = Math.floor(fx.rng() * GIB_CAP);
      const a = fx.rng() * TAU, sp = 60 + fx.rng() * 220;
      G.x[i] = x + Math.cos(a) * 6; G.y[i] = y + Math.sin(a) * 6; G.h[i] = 18 + fx.rng() * 25;
      G.vx[i] = Math.cos(a) * sp; G.vy[i] = Math.sin(a) * sp; G.vh[i] = 150 + fx.rng() * 280;
      G.rx[i] = fx.rng() * TAU; G.ry[i] = fx.rng() * TAU; G.age[i] = 0;
      G.s[i] = size * (0.6 + fx.rng() * 0.9);
      G.k[i] = k % 4 === 3 ? 1 : 0;
      const c = col(G.k[i] ? '#d8ccb0' : green && k % 2 ? '#6f8f3a' : gibCols[k % gibCols.length]);
      G.c[i * 3] = c.r; G.c[i * 3 + 1] = c.g; G.c[i * 3 + 2] = c.b;
    }
  }

  function updateGibs(dt) {
    let w = 0;
    const counts = [0, 0];
    for (let i = 0; i < gn; i++) {
      G.age[i] += dt;
      if (G.age[i] > 9) continue;
      if (G.h[i] > 0.8 || G.vh[i] > 0) {
        G.vh[i] -= 900 * dt;
        G.x[i] += G.vx[i] * dt; G.y[i] += G.vy[i] * dt; G.h[i] += G.vh[i] * dt;
        G.rx[i] += dt * 9; G.ry[i] += dt * 7;
        if (G.h[i] < 0.8) {
          G.h[i] = 0.8;
          if (Math.abs(G.vh[i]) > 120) {
            G.vh[i] = -G.vh[i] * 0.25;
            if (fx.rng() < 0.35) ctx.ground.decal('blood', G.x[i], G.y[i], 3 + G.s[i] * 1.5, fx.rng() * TAU, 0.7);
          } else G.vh[i] = 0;
          G.vx[i] *= 0.4; G.vy[i] *= 0.4;
        }
      }
      if (w !== i) {
        for (const key of ['x', 'h', 'y', 'vx', 'vh', 'vy', 'rx', 'ry', 's', 'age', 'k']) G[key][w] = G[key][i];
        G.c[w * 3] = G.c[i * 3]; G.c[w * 3 + 1] = G.c[i * 3 + 1]; G.c[w * 3 + 2] = G.c[i * 3 + 2];
      }
      const sink = G.age[w] > 7 ? (G.age[w] - 7) * 0.5 : 0;
      _p.set(G.x[w], G.h[w] - sink * G.s[w], G.y[w]);
      _q.setFromEuler(_e.set(G.rx[w], G.ry[w], 0));
      _s.set(G.s[w], G.s[w], G.s[w]);
      _m4.compose(_p, _q, _s);
      const mesh = gibMeshes[G.k[w]];
      const j = counts[G.k[w]]++;
      mesh.setMatrixAt(j, _m4);
      mesh.instanceColor.setXYZ(j, G.c[w * 3], G.c[w * 3 + 1], G.c[w * 3 + 2]);
      w++;
    }
    gn = w;
    for (let m = 0; m < 2; m++) {
      const mesh = gibMeshes[m], n = counts[m];
      mesh.count = n;
      mesh.visible = n > 0;
      if (n) {
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, n * 16);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, n * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
    stats.gibs = gn;
  }

  // ---- events -------------------------------------------------------------------------------
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

  function hitZombie(z, fromX, fromY) {
    const s = state.get(z.id);
    if (!s) return;
    s.flinch = 0;
    // angle of the incoming hit relative to the zombie's facing (0 = from the front)
    s.hitA = angleDiff(s.a, Math.atan2(fromY - z.y, fromX - z.x));
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
            spawnGibs(e.x, e.y, high ? 14 : 7, 3.2, true);
          } else if (e.gib) {
            ctx.ground.decal('gore', e.x, e.y, r * 1.1, fx.rng() * TAU, 0.95);
            spawnGibs(e.x, e.y, (high ? 10 : 5) + Math.round(r / 5), 2.4 * (r / 14) ** 0.5, false);
          } else {
            addCorpse(e);
            ctx.ground.decal('blood', e.x - Math.cos(e.angle || 0) * r * 0.6, e.y - Math.sin(e.angle || 0) * r * 0.6, r * 0.9, fx.rng() * TAU, 0.9);
          }
          state.delete(e.id);
          break;
        }
        case 'zattack': {
          const s = state.get(e.id);
          if (s && s.atk > 0.5) { s.atk = 0; s.atkN++; }
          break;
        }
        case 'scream': { const s = state.get(e.id); if (s) s.scream = 0; break; }
        case 'spit': { const s = state.get(e.id); if (s) s.spit = 0; break; }
        case 'slam': { const s = state.get(e.id); if (s) s.slam = 0; break; }
        case 'charge': { const s = state.get(e.id); if (s) s.charge = Math.max(s.charge, 0.6); break; }
        case 'shot': {
          if (e.echo) break;
          const rays = e.rays;
          if (!rays) break;
          for (let j = 0; j < rays.length; j++) {
            const r = rays[j];
            if (!r || r.hit !== 1) continue;
            const z = nearestZombie(r.x, r.y, 40);
            if (z) hitZombie(z, e.x, e.y);
          }
          break;
        }
        case 'chain': {
          const pts = e.points || [];
          for (let j = 1; j < pts.length; j++) {
            const z = nearestZombie(pts[j].x, pts[j].y, 30);
            if (z) hitZombie(z, pts[j - 1].x, pts[j - 1].y);
          }
          break;
        }
        case 'melee': {
          if (!(e.hits > 0)) break;
          const x = e.x + Math.cos(e.angle) * 30, y = e.y + Math.sin(e.angle) * 30;
          const z = nearestZombie(x, y, 50);
          if (z) { hitZombie(z, e.x, e.y); const s = state.get(z.id); if (s) s.stagger = 1; }
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
      quality = q;
      high = q !== 'low';
      for (const t of ZOMBIE_IDS) {
        types[t].lods.forEach((m, L) => { m.mesh.castShadow = high && L === 0; m.mesh.receiveShadow = high && L === 0; });
      }
    },
    dispose() {
      pool.dispose();
      tex.detail.dispose();
      tex.normal.dispose();
      for (const g of gibGeos) g.dispose();
      for (const m of gibMeshes) m.dispose();
      gibMat.dispose();
      root.removeFromParent();
      releaseFx(ctx);
    },
  };
}

/** Gib chunk geometry: 0 = lumpy meat, 1 = bone shard. */
function gibChunkGeometry(kind) {
  const sb = new ShapeBuilder();
  if (kind === 0) {
    sb.ellipsoid([0, 0, 0], [1, 0.75, 0.85], { segW: 8, segH: 6, color: '#ffffff', slot: SLOT.FIXED, mat: MAT.FLESH,
      deform: (p) => { const k = 1 + 0.25 * Math.sin(p.x * 5 + 1) * Math.sin(p.y * 4) + 0.15 * Math.sin(p.z * 7); p.x *= k; p.y *= k; p.z *= k; } });
    sb.ellipsoid([0.5, 0.4, 0.2], [0.4, 0.3, 0.35], { segW: 5, segH: 4, color: '#e8d8b0', slot: SLOT.FIXED, mat: MAT.FLESH });
  } else {
    sb.tube([{ c: [-1.2, 0, 0], r: 0.32 }, { c: [0, 0.05, 0], r: 0.24 }, { c: [1.2, 0, 0], r: 0.3 }], { seg: 6, cap0: 'round', cap1: 'round', capRings: 1, color: '#ffffff' });
  }
  const a = sb.arrays();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  return g;
}

export { createZombies3D as createZombies };
